import { syncManagers } from './sync';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=60' : 'no-store', 'x-content-type-options': 'nosniff' },
});
const error = (message: string, status = 400) => json({ error: message }, status);

const latestCte = `WITH latest AS (
  SELECT f.*, ROW_NUMBER() OVER (PARTITION BY manager_id ORDER BY report_date DESC, filed_date DESC) rank
  FROM filings f
)`;

async function summary(env: Env) {
  const [stats, latest, sync] = await env.DB.batch([
    env.DB.prepare(`${latestCte} SELECT COUNT(DISTINCT m.id) managers,COUNT(DISTINCT CASE WHEN l.rank=1 AND l.positions_count>0 THEN m.id END) synced,
      COALESCE(SUM(CASE WHEN l.rank=1 THEN l.total_value END),0) total_value,COALESCE(SUM(CASE WHEN l.rank=1 THEN l.positions_count END),0) positions
      FROM managers m LEFT JOIN latest l ON l.manager_id=m.id`),
    env.DB.prepare(`${latestCte} SELECT m.id,m.display_name,m.category,m.source,l.report_date,l.filed_date,l.total_value,l.positions_count,l.source_url
      FROM latest l JOIN managers m ON m.id=l.manager_id WHERE l.rank=1 ORDER BY l.filed_date DESC LIMIT 10`),
    env.DB.prepare('SELECT status,started_at,finished_at,detail FROM sync_runs ORDER BY started_at DESC LIMIT 1'),
  ]);
  return json({ stats: stats.results[0] ?? {}, latest: latest.results, sync: sync.results[0] ?? null });
}

async function managers(env: Env) {
  const rows = await env.DB.prepare(`SELECT m.*,f.report_date,f.filed_date,f.total_value,f.positions_count,
    (SELECT ROUND(SUM(weight),2) FROM (SELECT weight FROM positions WHERE filing_id=f.id ORDER BY value DESC LIMIT 10)) top10_weight,
    (SELECT COALESCE(n.name_cn,NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.issuer) FROM positions p LEFT JOIN securities s ON s.cusip=p.cusip LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip) WHERE p.filing_id=f.id ORDER BY p.value DESC LIMIT 1) top_holding_1,
    (SELECT COALESCE(n.name_cn,NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.issuer) FROM positions p LEFT JOIN securities s ON s.cusip=p.cusip LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip) WHERE p.filing_id=f.id ORDER BY p.value DESC LIMIT 1 OFFSET 1) top_holding_2,
    (SELECT COALESCE(n.name_cn,NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.issuer) FROM positions p LEFT JOIN securities s ON s.cusip=p.cusip LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip) WHERE p.filing_id=f.id ORDER BY p.value DESC LIMIT 1 OFFSET 2) top_holding_3
    FROM managers m LEFT JOIN filings f ON f.id=(SELECT id FROM filings WHERE manager_id=m.id ORDER BY report_date DESC,filed_date DESC LIMIT 1)
    WHERE m.active=1 ORDER BY
    CASE m.category WHEN '知名投资人' THEN 1 WHEN '主动基金' THEN 2 WHEN '大型机构' THEN 3 ELSE 4 END,m.display_name`).all();
  return json(rows.results);
}

async function managerDetail(id: string, env: Env) {
  const manager = await env.DB.prepare('SELECT * FROM managers WHERE id=?').bind(id).first();
  if (!manager) return error('机构不存在', 404);
  const filings = (await env.DB.prepare(`SELECT id,report_date,filed_date,form,source_url,total_value,positions_count
    FROM filings WHERE manager_id=? ORDER BY report_date DESC,filed_date DESC LIMIT 24`).bind(id).all()).results;
  if (!filings.length) return json({ manager, filings: [], positions: [] });
  const current = filings[0] as Record<string, unknown>;
  const previous = filings.find((filing) => String(filing.report_date) < String(current.report_date)) as Record<string, unknown> | undefined;
  const rows = await env.DB.prepare(`SELECT c.cusip,c.issuer,c.title,COALESCE(NULLIF(c.ticker,''),s.ticker,'') ticker,n.name_cn,s.sector,s.industry,c.shares,c.value,c.weight,c.put_call,
    p.shares previous_shares,p.value previous_value,
    CASE WHEN p.cusip IS NULL THEN 'new' WHEN c.shares>p.shares THEN 'increase' WHEN c.shares<p.shares THEN 'decrease' ELSE 'unchanged' END change_type
    FROM positions c LEFT JOIN positions p ON p.filing_id=? AND p.cusip=c.cusip AND p.title=c.title AND p.put_call=c.put_call
    LEFT JOIN securities s ON s.cusip=c.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(c.ticker,''),NULLIF(s.ticker,''),c.cusip)
    WHERE c.filing_id=? ORDER BY c.value DESC`).bind(previous?.id ?? '', current.id).all();
  const sold = previous ? (await env.DB.prepare(`SELECT p.cusip,p.issuer,p.title,COALESCE(NULLIF(p.ticker,''),s.ticker,'') ticker,n.name_cn,s.sector,s.industry,0 shares,0 value,0 weight,p.put_call,p.shares previous_shares,p.value previous_value,'sold' change_type
    FROM positions p LEFT JOIN positions c ON c.filing_id=? AND c.cusip=p.cusip AND c.title=p.title AND c.put_call=p.put_call
    LEFT JOIN securities s ON s.cusip=p.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE p.filing_id=? AND c.cusip IS NULL ORDER BY p.value DESC`).bind(current.id, previous.id).all()).results : [];
  return json({ manager, filings, current, previous: previous ?? null, positions: [...rows.results, ...sold] });
}

async function stocks(url: URL, env: Env) {
  const q = `%${url.searchParams.get('q')?.trim() ?? ''}%`;
  const sector = url.searchParams.get('sector')?.trim() ?? '';
  const rows = await env.DB.prepare(`${latestCte} SELECT p.cusip,MAX(p.issuer) issuer,MAX(COALESCE(NULLIF(p.ticker,''),s.ticker,'')) ticker,MAX(COALESCE(n.name_cn,'')) name_cn,
    MAX(COALESCE(s.sector,'')) sector,MAX(COALESCE(s.industry,'')) industry,COUNT(DISTINCT l.manager_id) managers,
    SUM(p.value) total_value,SUM(p.shares) total_shares
    FROM latest l JOIN positions p ON p.filing_id=l.id LEFT JOIN securities s ON s.cusip=p.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE l.rank=1 AND (p.issuer LIKE ? OR p.ticker LIKE ? OR s.ticker LIKE ? OR p.cusip LIKE ? OR n.name_cn LIKE ?)
    AND (?='' OR s.sector=? OR s.industry=?) GROUP BY p.cusip ORDER BY managers DESC,total_value DESC LIMIT 200`)
    .bind(q, q, q, q, q, sector, sector, sector).all();
  return json(rows.results);
}

async function sectors(env: Env) {
  const rows = await env.DB.prepare(`SELECT sector,COUNT(*) securities FROM securities WHERE sector<>'' GROUP BY sector ORDER BY sector`).all();
  return json(rows.results);
}

async function stockDetail(cusip: string, env: Env) {
  const rows = await env.DB.prepare(`${latestCte} SELECT p.*,COALESCE(NULLIF(p.ticker,''),s.ticker,'') ticker,n.name_cn,s.sector,s.industry,
    m.id manager_id,m.display_name,m.category,l.report_date,l.filed_date,l.source_url
    FROM latest l JOIN positions p ON p.filing_id=l.id JOIN managers m ON m.id=l.manager_id LEFT JOIN securities s ON s.cusip=p.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE l.rank=1 AND p.cusip=? ORDER BY p.value DESC`).bind(cusip).all();
  if (!rows.results.length) return error('证券不存在', 404);
  return json({ security: rows.results[0], holders: rows.results });
}

async function compare(url: URL, env: Env) {
  const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 5);
  if (ids.length < 2) return error('请选择至少两家机构');
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`${latestCte} SELECT m.id,m.display_name,l.report_date,l.total_value,l.positions_count,
    p.cusip,p.issuer,COALESCE(NULLIF(p.ticker,''),s.ticker,'') ticker,n.name_cn,p.value,p.weight,p.shares FROM latest l JOIN managers m ON m.id=l.manager_id
    JOIN positions p ON p.filing_id=l.id LEFT JOIN securities s ON s.cusip=p.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE l.rank=1 AND m.id IN (${placeholders}) ORDER BY p.value DESC`).bind(...ids).all();
  return json(rows.results);
}

function csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
async function exportCsv(url: URL, env: Env) {
  const id = url.searchParams.get('manager');
  if (!id) return error('缺少 manager 参数');
  const filing = await env.DB.prepare('SELECT * FROM filings WHERE manager_id=? ORDER BY report_date DESC,filed_date DESC LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!filing) return error('暂无数据', 404);
  const rows = (await env.DB.prepare(`SELECT p.*,COALESCE(NULLIF(p.ticker,''),s.ticker,'') ticker,n.name_cn,s.sector,s.industry
    FROM positions p LEFT JOIN securities s ON s.cusip=p.cusip LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE p.filing_id=? ORDER BY p.value DESC`).bind(filing.id).all()).results;
  const fields = ['name_cn','issuer','ticker','cusip','title','sector','industry','shares','value','weight','put_call'];
  const csv = [`机构,报告期,中文名称,英文申报名,交易代码,证券识别码,证券类别,板块,行业,股数,市值,权重,期权类型`, ...rows.map((row) => [id, filing.report_date, ...fields.map((field) => (row as Record<string, unknown>)[field])].map(csvCell).join(','))].join('\n');
  return new Response(`\uFEFF${csv}`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${id}-${filing.report_date}.csv"` } });
}

async function feed(env: Env, origin: string, threshold: number) {
  const rows = (await env.DB.prepare(`WITH ranked AS (
    SELECT f.*,ROW_NUMBER() OVER (PARTITION BY manager_id ORDER BY report_date DESC,filed_date DESC) rank FROM filings f
  ) SELECT m.display_name,c.*,p.id previous_id,
    (SELECT COUNT(*) FROM positions cp LEFT JOIN positions pp ON pp.filing_id=p.id AND pp.cusip=cp.cusip AND pp.title=cp.title AND pp.put_call=cp.put_call WHERE cp.filing_id=c.id AND pp.cusip IS NULL) new_count,
    (SELECT COUNT(*) FROM positions pp LEFT JOIN positions cp ON cp.filing_id=c.id AND cp.cusip=pp.cusip AND cp.title=pp.title AND cp.put_call=pp.put_call WHERE pp.filing_id=p.id AND cp.cusip IS NULL) sold_count,
    (SELECT COUNT(*) FROM positions cp JOIN positions pp ON pp.filing_id=p.id AND pp.cusip=cp.cusip AND pp.title=cp.title AND pp.put_call=cp.put_call WHERE cp.filing_id=c.id AND pp.shares<>0 AND ABS(cp.shares-pp.shares)/ABS(pp.shares)>=?) significant_count
    FROM ranked c JOIN managers m ON m.id=c.manager_id LEFT JOIN ranked p ON p.manager_id=c.manager_id AND p.rank=2
    WHERE c.rank=1 ORDER BY c.filed_date DESC LIMIT 30`).bind(threshold / 100).all()).results;
  const escape = (value: unknown) => String(value ?? '').replace(/[<>&'"]/g, (char) => ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[char]!));
  const items = rows.map((row) => `<item><title>${escape(row.display_name)}：${escape(row.report_date)} 持仓披露</title><link>${escape(row.source_url)}</link><guid>${escape(row.id)}-${threshold}</guid><pubDate>${new Date(String(row.filed_date)).toUTCString()}</pubDate><description>${row.previous_id ? `新出现 ${escape(row.new_count)} 项；不再披露 ${escape(row.sold_count)} 项；披露股数变化至少 ${threshold}% 的有 ${escape(row.significant_count)} 项。` : '首次记录，已建立变化比较基准。'}</description></item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>点金雷达提醒（${threshold}% 阈值）</title><link>${origin}</link><description>知名投资人与机构公开持仓更新</description>${items}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=900' } });
}

async function sources(env: Env) {
  const [coverage, metadata, sync] = await env.DB.batch([
    env.DB.prepare(`${latestCte} SELECT m.source,COUNT(*) managers,COUNT(CASE WHEN l.rank=1 AND l.positions_count>0 THEN 1 END) synced,
      COUNT(CASE WHEN l.rank=1 AND l.positions_count>0 AND l.report_date>=CASE m.source WHEN 'ARK' THEN date('now','-7 days') ELSE date('now','-6 months') END THEN 1 END) current,
      COUNT(CASE WHEN l.rank=1 AND l.positions_count>0 AND l.report_date<CASE m.source WHEN 'ARK' THEN date('now','-7 days') ELSE date('now','-6 months') END THEN 1 END) stale,
      MAX(m.last_synced_at) updated_at FROM managers m LEFT JOIN latest l ON l.manager_id=m.id AND l.rank=1 GROUP BY m.source`),
    env.DB.prepare("SELECT COUNT(*) securities,COUNT(CASE WHEN source LIKE 'SEC+%' THEN 1 END) verified,MAX(updated_at) updated_at FROM securities"),
    env.DB.prepare('SELECT status,started_at,finished_at FROM sync_runs ORDER BY started_at DESC LIMIT 1'),
  ]);
  const counts = Object.fromEntries(coverage.results.map((row) => {
    const record = row as Record<string, unknown>;
    return [String(record.source), record];
  }));
  const securityCounts = metadata.results[0] as Record<string, unknown> | undefined;
  return json({ sources: [
    { id:'sec', name:'美国证监会 EDGAR 原始申报', cadence:'季度披露', official_url:'https://www.sec.gov/edgar/search/', detail:'持仓、股数、市值与报告期均取自原始 13F，并保留逐份申报链接；同时检查异常金额单位。', ...(counts.SEC ?? {}) },
    { id:'sec-list', name:'美国证监会 13F 官方证券清单', cadence:'季度校验', official_url:'https://www.sec.gov/rules-regulations/staff-guidance/official-list-section-13f-securities', detail:'按报告季度用官方 CUSIP 清单核验证券身份，阻断同名公司造成的错误代码匹配。', securities:securityCounts?.verified, count_label:'证券身份已核验', updated_at:securityCounts?.updated_at },
    { id:'ark', name:'木头姐基金官方每日持仓', cadence:'交易日更新', official_url:'https://www.ark-funds.com/download-fund-materials', detail:'直接读取六只主动管理基金官网每日 CSV；已适配更名后的金融科技与太空基金文件。', ...(counts.ARK ?? {}) },
    { id:'nasdaq', name:'纳斯达克证券目录（辅助）', cadence:'每日补全', official_url:'https://www.nasdaq.com/market-activity/stocks/screener', detail:'仅在 SEC 官方 CUSIP 校验或 ARK 官方代码确认后补全交易代码、板块与行业，不参与持仓与变化计算。', ...(securityCounts ?? {}), count_label:'证券元数据已补全' },
  ], sync: sync.results[0] ?? null });
}

async function safeEqual(a: string, b: string) {
  const [left, right] = await Promise.all([a, b].map((value) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
  return new Uint8Array(left).every((byte, i) => byte === new Uint8Array(right)[i]);
}

async function api(request: Request, env: Env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/health') return json({ ok: true, time: new Date().toISOString() });
  if (path === '/api/summary') return summary(env);
  if (path === '/api/managers') return managers(env);
  if (path.startsWith('/api/managers/')) return managerDetail(decodeURIComponent(path.slice(14)), env);
  if (path === '/api/stocks') return stocks(url, env);
  if (path === '/api/sectors') return sectors(env);
  if (path.startsWith('/api/stocks/')) return stockDetail(decodeURIComponent(path.slice(12)), env);
  if (path === '/api/compare') return compare(url, env);
  if (path === '/api/export.csv') return exportCsv(url, env);
  if (path === '/api/feed.xml') return feed(env, url.origin, Math.min(100, Math.max(1, Number(url.searchParams.get('threshold')) || 20)));
  if (path === '/api/sources') return sources(env);
  if (path === '/api/sync' && request.method === 'POST') {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!env.SYNC_SECRET || !(await safeEqual(token, env.SYNC_SECRET))) return error('未授权', 401);
    return json(await syncManagers(env, url.searchParams.get('manager') ?? undefined, Number(url.searchParams.get('limit')) || undefined));
  }
  return error('接口不存在', 404);
}

export default {
  async fetch(request: Request, env: Env) {
    try { return new URL(request.url).pathname.startsWith('/api/') ? await api(request, env) : env.ASSETS.fetch(request); }
    catch (cause) { console.error(JSON.stringify({ event:'request_failed', path:new URL(request.url).pathname, error:cause instanceof Error ? cause.message : String(cause) })); return error(cause instanceof Error ? cause.message : '服务器错误', 500); }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncManagers(env).catch((cause) => console.error(JSON.stringify({ event:'scheduled_sync_failed', error:cause instanceof Error ? cause.message : String(cause) }))));
  },
} satisfies ExportedHandler<Env>;
