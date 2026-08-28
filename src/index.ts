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
  const rows = await env.DB.prepare(`${latestCte} SELECT m.*,l.report_date,l.filed_date,l.total_value,l.positions_count
    FROM managers m LEFT JOIN latest l ON l.manager_id=m.id AND l.rank=1 WHERE m.active=1 ORDER BY
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
  const rows = await env.DB.prepare(`SELECT c.cusip,c.issuer,c.title,c.ticker,c.shares,c.value,c.weight,c.put_call,
    p.shares previous_shares,p.value previous_value,
    CASE WHEN p.cusip IS NULL THEN 'new' WHEN c.shares>p.shares THEN 'increase' WHEN c.shares<p.shares THEN 'decrease' ELSE 'unchanged' END change_type
    FROM positions c LEFT JOIN positions p ON p.filing_id=? AND p.cusip=c.cusip AND p.title=c.title AND p.put_call=c.put_call
    WHERE c.filing_id=? ORDER BY c.value DESC`).bind(previous?.id ?? '', current.id).all();
  const sold = previous ? (await env.DB.prepare(`SELECT p.cusip,p.issuer,p.title,p.ticker,0 shares,0 value,0 weight,p.put_call,p.shares previous_shares,p.value previous_value,'sold' change_type
    FROM positions p LEFT JOIN positions c ON c.filing_id=? AND c.cusip=p.cusip AND c.title=p.title AND c.put_call=p.put_call
    WHERE p.filing_id=? AND c.cusip IS NULL ORDER BY p.value DESC`).bind(current.id, previous.id).all()).results : [];
  return json({ manager, filings, current, previous: previous ?? null, positions: [...rows.results, ...sold] });
}

async function stocks(url: URL, env: Env) {
  const q = `%${url.searchParams.get('q')?.trim() ?? ''}%`;
  const rows = await env.DB.prepare(`${latestCte} SELECT p.cusip,MAX(p.issuer) issuer,MAX(p.ticker) ticker,COUNT(DISTINCT l.manager_id) managers,
    SUM(p.value) total_value,SUM(p.shares) total_shares
    FROM latest l JOIN positions p ON p.filing_id=l.id WHERE l.rank=1 AND (p.issuer LIKE ? OR p.ticker LIKE ? OR p.cusip LIKE ?)
    GROUP BY p.cusip ORDER BY managers DESC,total_value DESC LIMIT 200`).bind(q, q, q).all();
  return json(rows.results);
}

async function stockDetail(cusip: string, env: Env) {
  const rows = await env.DB.prepare(`${latestCte} SELECT p.*,m.id manager_id,m.display_name,m.category,l.report_date,l.filed_date,l.source_url
    FROM latest l JOIN positions p ON p.filing_id=l.id JOIN managers m ON m.id=l.manager_id
    WHERE l.rank=1 AND p.cusip=? ORDER BY p.value DESC`).bind(cusip).all();
  if (!rows.results.length) return error('证券不存在', 404);
  return json({ security: rows.results[0], holders: rows.results });
}

async function compare(url: URL, env: Env) {
  const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 5);
  if (ids.length < 2) return error('请选择至少两家机构');
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`${latestCte} SELECT m.id,m.display_name,l.report_date,l.total_value,l.positions_count,
    p.cusip,p.issuer,p.ticker,p.value,p.weight,p.shares FROM latest l JOIN managers m ON m.id=l.manager_id
    JOIN positions p ON p.filing_id=l.id WHERE l.rank=1 AND m.id IN (${placeholders}) ORDER BY p.value DESC`).bind(...ids).all();
  return json(rows.results);
}

function csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
async function exportCsv(url: URL, env: Env) {
  const id = url.searchParams.get('manager');
  if (!id) return error('缺少 manager 参数');
  const filing = await env.DB.prepare('SELECT * FROM filings WHERE manager_id=? ORDER BY report_date DESC,filed_date DESC LIMIT 1').bind(id).first<Record<string, unknown>>();
  if (!filing) return error('暂无数据', 404);
  const rows = (await env.DB.prepare('SELECT * FROM positions WHERE filing_id=? ORDER BY value DESC').bind(filing.id).all()).results;
  const fields = ['issuer','ticker','cusip','title','shares','value','weight','put_call'];
  const csv = [`机构,报告期,${fields.join(',')}`, ...rows.map((row) => [id, filing.report_date, ...fields.map((field) => (row as Record<string, unknown>)[field])].map(csvCell).join(','))].join('\n');
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
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>自强持仓提醒（${threshold}% 阈值）</title><link>${origin}</link><description>知名投资人与机构公开持仓更新</description>${items}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=900' } });
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
  if (path.startsWith('/api/stocks/')) return stockDetail(decodeURIComponent(path.slice(12)), env);
  if (path === '/api/compare') return compare(url, env);
  if (path === '/api/export.csv') return exportCsv(url, env);
  if (path === '/api/feed.xml') return feed(env, url.origin, Math.min(100, Math.max(1, Number(url.searchParams.get('threshold')) || 20)));
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
    catch (cause) { console.error(cause); return error(cause instanceof Error ? cause.message : '服务器错误', 500); }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncManagers(env));
  },
} satisfies ExportedHandler<Env>;
