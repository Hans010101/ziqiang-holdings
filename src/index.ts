import { syncManagers } from './sync';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=60' : 'no-store', 'x-content-type-options': 'nosniff' },
});
const error = (message: string, status = 400) => json({ error: message }, status);

const secExpectedReport = `date(date('now','-45 days'),'start of month',
  printf('-%d months',(CAST(strftime('%m',date('now','-45 days')) AS INTEGER)-1)%3),'-1 day')`;
const verifiedLatestCte = `WITH verified AS (
  SELECT * FROM filings WHERE validation_status IN ('reconciled','reconciled_composite','reconciled_unit_inferred','source_only')
), latest AS (
  SELECT f.*,ROW_NUMBER() OVER (PARTITION BY manager_id ORDER BY report_date DESC,filed_date DESC,id DESC) rank FROM verified f
)`;
const currentLatestCte = `${verifiedLatestCte}, current AS (
  SELECT l.* FROM latest l JOIN managers m ON m.id=l.manager_id
  WHERE l.rank=1 AND l.positions_count>0 AND l.report_date>=CASE m.source WHEN 'ARK' THEN date('now','-10 days') ELSE ${secExpectedReport} END
)`;

async function summary(env: Env) {
  const [stats, latest, sync] = await env.DB.batch([
    env.DB.prepare(`${currentLatestCte} SELECT COUNT(DISTINCT m.id) managers,COUNT(DISTINCT c.manager_id) synced,
      COALESCE(SUM(c.total_value),0) total_value,COALESCE(SUM(c.positions_count),0) positions
      FROM managers m LEFT JOIN current c ON c.manager_id=m.id WHERE m.active=1`),
    env.DB.prepare(`${currentLatestCte} SELECT m.id,m.display_name,m.category,m.source,c.report_date,c.filed_date,c.total_value,c.positions_count,c.source_url
      FROM current c JOIN managers m ON m.id=c.manager_id ORDER BY c.filed_date DESC LIMIT 10`),
    env.DB.prepare('SELECT status,started_at,finished_at,detail FROM sync_runs ORDER BY started_at DESC LIMIT 1'),
  ]);
  return json({ stats: stats.results[0] ?? {}, latest: latest.results, sync: sync.results[0] ?? null });
}

async function managers(env: Env) {
  const rows = await env.DB.prepare(`${verifiedLatestCte} SELECT m.*,f.report_date,f.filed_date,f.total_value,f.positions_count,f.validation_status,f.validation_detail,
    CASE WHEN f.id IS NULL OR f.report_date<CASE m.source WHEN 'ARK' THEN date('now','-10 days') ELSE ${secExpectedReport} END THEN 1 ELSE 0 END is_stale,
    n.report_date notice_report_date,n.filed_date notice_filed_date,n.form notice_form,n.source_url notice_source_url,n.detail notice_detail,n.other_managers,
    (SELECT ROUND(SUM(weight),2) FROM (SELECT weight FROM positions WHERE filing_id=f.id AND amount_type='SH' AND put_call='' ORDER BY value DESC LIMIT 10)) top10_weight,
    (SELECT COALESCE(sn.name_cn,NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.issuer) FROM positions p LEFT JOIN securities s ON s.cusip=p.cusip LEFT JOIN security_names sn ON sn.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip) WHERE p.filing_id=f.id AND p.amount_type='SH' AND p.put_call='' ORDER BY p.value DESC LIMIT 1) top_holding_1,
    (SELECT COALESCE(sn.name_cn,NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.issuer) FROM positions p LEFT JOIN securities s ON s.cusip=p.cusip LEFT JOIN security_names sn ON sn.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip) WHERE p.filing_id=f.id AND p.amount_type='SH' AND p.put_call='' ORDER BY p.value DESC LIMIT 1 OFFSET 1) top_holding_2,
    (SELECT COALESCE(sn.name_cn,NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.issuer) FROM positions p LEFT JOIN securities s ON s.cusip=p.cusip LEFT JOIN security_names sn ON sn.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip) WHERE p.filing_id=f.id AND p.amount_type='SH' AND p.put_call='' ORDER BY p.value DESC LIMIT 1 OFFSET 2) top_holding_3
    FROM managers m LEFT JOIN latest f ON f.manager_id=m.id AND f.rank=1
    LEFT JOIN filing_notices n ON n.id=(SELECT id FROM filing_notices WHERE manager_id=m.id ORDER BY report_date DESC,filed_date DESC,id DESC LIMIT 1)
    WHERE m.active=1 ORDER BY
    CASE m.category WHEN '知名投资人' THEN 1 WHEN '主动基金' THEN 2 WHEN '大型机构' THEN 3 ELSE 4 END,m.display_name`).all();
  return json(rows.results);
}

async function managerDetail(id: string, env: Env) {
  const manager = await env.DB.prepare('SELECT * FROM managers WHERE id=?').bind(id).first();
  if (!manager) return error('机构不存在', 404);
  const [filingsResult, noticesResult, currentResult, historicalResult] = await env.DB.batch([
    env.DB.prepare(`SELECT id,report_date,filed_date,form,source_url,total_value,positions_count,declared_positions_count,
      declared_total_value,declared_raw_total_value,value_multiplier,validation_status,validation_detail,contributing_accessions,fetched_at
      FROM filings WHERE manager_id=? ORDER BY report_date DESC,filed_date DESC LIMIT 24`).bind(id),
    env.DB.prepare(`SELECT * FROM filing_notices WHERE manager_id=? ORDER BY report_date DESC,filed_date DESC,id DESC LIMIT 12`).bind(id),
    env.DB.prepare(`${currentLatestCte} SELECT * FROM current WHERE manager_id=?`).bind(id),
    env.DB.prepare(`${verifiedLatestCte} SELECT * FROM latest WHERE manager_id=? AND rank=1`).bind(id),
  ]);
  const filings = filingsResult.results as Record<string, unknown>[];
  const current = currentResult.results[0] as Record<string, unknown> | undefined;
  const historical = historicalResult.results[0] as Record<string, unknown> | undefined;
  if (!current) return json({ manager, filings, notices: noticesResult.results, current: null, historical: historical ?? null, previous: null, positions: [] });
  const previous = await env.DB.prepare(`SELECT * FROM filings WHERE manager_id=? AND report_date<?
    AND validation_status IN ('reconciled','reconciled_composite','reconciled_unit_inferred','source_only')
    ORDER BY report_date DESC,filed_date DESC,id DESC LIMIT 1`).bind(id, current.report_date).first<Record<string, unknown>>();
  const rows = await env.DB.prepare(`SELECT c.cusip,c.issuer,c.title,COALESCE(NULLIF(c.ticker,''),s.ticker,'') ticker,n.name_cn,s.sector,s.industry,c.shares,c.amount_type,c.value,c.weight,c.put_call,
    p.shares previous_shares,p.value previous_value,
    CASE WHEN p.cusip IS NULL THEN 'new' WHEN c.shares>p.shares THEN 'increase' WHEN c.shares<p.shares THEN 'decrease' ELSE 'unchanged' END change_type
    FROM positions c LEFT JOIN positions p ON p.filing_id=? AND p.cusip=c.cusip AND p.title=c.title AND p.put_call=c.put_call AND p.amount_type=c.amount_type
    LEFT JOIN securities s ON s.cusip=c.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(c.ticker,''),NULLIF(s.ticker,''),c.cusip)
    WHERE c.filing_id=? ORDER BY c.value DESC`).bind(previous?.id ?? '', current.id).all();
  const sold = previous ? (await env.DB.prepare(`SELECT p.cusip,p.issuer,p.title,COALESCE(NULLIF(p.ticker,''),s.ticker,'') ticker,n.name_cn,s.sector,s.industry,0 shares,p.amount_type,0 value,0 weight,p.put_call,p.shares previous_shares,p.value previous_value,'sold' change_type
    FROM positions p LEFT JOIN positions c ON c.filing_id=? AND c.cusip=p.cusip AND c.title=p.title AND c.put_call=p.put_call AND c.amount_type=p.amount_type
    LEFT JOIN securities s ON s.cusip=p.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE p.filing_id=? AND c.cusip IS NULL ORDER BY p.value DESC`).bind(current.id, previous.id).all()).results : [];
  return json({ manager, filings, notices: noticesResult.results, current, historical: current, previous: previous ?? null, positions: [...rows.results, ...sold] });
}

async function stocks(url: URL, env: Env) {
  const q = `%${url.searchParams.get('q')?.trim() ?? ''}%`;
  const sector = url.searchParams.get('sector')?.trim() ?? '';
  const rows = await env.DB.prepare(`${currentLatestCte} SELECT p.cusip,MAX(p.issuer) issuer,MAX(COALESCE(NULLIF(p.ticker,''),s.ticker,'')) ticker,MAX(COALESCE(n.name_cn,'')) name_cn,
    MAX(COALESCE(s.sector,'')) sector,MAX(COALESCE(s.industry,'')) industry,COUNT(DISTINCT c.manager_id) managers,
    SUM(p.value) total_value,SUM(p.shares) total_shares
    FROM current c JOIN positions p ON p.filing_id=c.id LEFT JOIN securities s ON s.cusip=p.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE p.amount_type='SH' AND p.put_call='' AND (p.issuer LIKE ? OR p.ticker LIKE ? OR s.ticker LIKE ? OR p.cusip LIKE ? OR n.name_cn LIKE ?)
    AND (?='' OR s.sector=? OR s.industry=?) GROUP BY p.cusip ORDER BY managers DESC,total_value DESC LIMIT 200`)
    .bind(q, q, q, q, q, sector, sector, sector).all();
  return json(rows.results);
}

async function sectors(env: Env) {
  const rows = await env.DB.prepare(`SELECT sector,COUNT(*) securities FROM securities WHERE sector<>'' GROUP BY sector ORDER BY sector`).all();
  return json(rows.results);
}

async function stockDetail(cusip: string, env: Env) {
  const rows = await env.DB.prepare(`${currentLatestCte} SELECT p.cusip,MAX(p.issuer) issuer,MAX(p.title) title,
    MAX(COALESCE(NULLIF(p.ticker,''),s.ticker,'')) ticker,MAX(n.name_cn) name_cn,MAX(s.sector) sector,MAX(s.industry) industry,
    SUM(p.shares) shares,SUM(p.value) value,SUM(p.weight) weight,
    m.id manager_id,m.display_name,m.category,c.report_date,c.filed_date,c.source_url
    FROM current c JOIN positions p ON p.filing_id=c.id JOIN managers m ON m.id=c.manager_id LEFT JOIN securities s ON s.cusip=p.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE p.amount_type='SH' AND p.put_call='' AND p.cusip=? GROUP BY m.id,c.id ORDER BY value DESC`).bind(cusip).all();
  if (!rows.results.length) return error('证券不存在', 404);
  return json({ security: rows.results[0], holders: rows.results });
}

async function compare(url: URL, env: Env) {
  const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 5);
  if (ids.length < 2) return error('请选择至少两家机构');
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`${currentLatestCte} SELECT m.id,m.display_name,c.report_date,c.total_value,c.positions_count,
    p.cusip,MAX(p.issuer) issuer,MAX(COALESCE(NULLIF(p.ticker,''),s.ticker,'')) ticker,MAX(n.name_cn) name_cn,
    SUM(p.value) value,SUM(p.weight) weight,SUM(p.shares) shares FROM current c JOIN managers m ON m.id=c.manager_id
    JOIN positions p ON p.filing_id=c.id LEFT JOIN securities s ON s.cusip=p.cusip
    LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE p.amount_type='SH' AND p.put_call='' AND m.id IN (${placeholders}) GROUP BY m.id,c.id,p.cusip ORDER BY value DESC`).bind(...ids).all();
  return json(rows.results);
}

function csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
async function exportCsv(url: URL, env: Env) {
  const id = url.searchParams.get('manager');
  if (!id) return error('缺少 manager 参数');
  const filing = await env.DB.prepare(`${currentLatestCte} SELECT * FROM current WHERE manager_id=?`).bind(id).first<Record<string, unknown>>();
  if (!filing) return error('暂无当前可用数据', 404);
  const rows = (await env.DB.prepare(`SELECT p.*,COALESCE(NULLIF(p.ticker,''),s.ticker,'') ticker,n.name_cn,s.sector,s.industry
    FROM positions p LEFT JOIN securities s ON s.cusip=p.cusip LEFT JOIN security_names n ON n.alias=COALESCE(NULLIF(p.ticker,''),NULLIF(s.ticker,''),p.cusip)
    WHERE p.filing_id=? ORDER BY p.value DESC`).bind(filing.id).all()).results;
  const fields = ['name_cn','issuer','ticker','cusip','title','amount_type','sector','industry','shares','value','weight','put_call'];
  const csv = [`机构,报告期,中文名称,英文申报名,交易代码,证券识别码,证券类别,数量类型,板块,行业,披露数量,市值,权重,期权类型`, ...rows.map((row) => [id, filing.report_date, ...fields.map((field) => (row as Record<string, unknown>)[field])].map(csvCell).join(','))].join('\n');
  return new Response(`\uFEFF${csv}`, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${id}-${filing.report_date}.csv"` } });
}

async function feed(env: Env, origin: string, threshold: number) {
  const rows = (await env.DB.prepare(`${currentLatestCte}, paired AS (
    SELECT c.*,(SELECT id FROM verified p WHERE p.manager_id=c.manager_id AND p.report_date<c.report_date ORDER BY p.report_date DESC,p.filed_date DESC,p.id DESC LIMIT 1) previous_id FROM current c
  ) SELECT m.display_name,c.*,
    (SELECT COUNT(*) FROM positions cp LEFT JOIN positions pp ON pp.filing_id=c.previous_id AND pp.cusip=cp.cusip AND pp.title=cp.title AND pp.amount_type=cp.amount_type AND pp.put_call=cp.put_call WHERE cp.filing_id=c.id AND cp.amount_type='SH' AND cp.put_call='' AND pp.cusip IS NULL) new_count,
    (SELECT COUNT(*) FROM positions pp LEFT JOIN positions cp ON cp.filing_id=c.id AND cp.cusip=pp.cusip AND cp.title=pp.title AND cp.amount_type=pp.amount_type AND cp.put_call=pp.put_call WHERE pp.filing_id=c.previous_id AND pp.amount_type='SH' AND pp.put_call='' AND cp.cusip IS NULL) sold_count,
    (SELECT COUNT(*) FROM positions cp JOIN positions pp ON pp.filing_id=c.previous_id AND pp.cusip=cp.cusip AND pp.title=cp.title AND pp.amount_type=cp.amount_type AND pp.put_call=cp.put_call WHERE cp.filing_id=c.id AND cp.amount_type='SH' AND cp.put_call='' AND pp.shares<>0 AND ABS(cp.shares-pp.shares)/ABS(pp.shares)>=?) significant_count
    FROM paired c JOIN managers m ON m.id=c.manager_id ORDER BY c.filed_date DESC LIMIT 30`).bind(threshold / 100).all()).results;
  const escape = (value: unknown) => String(value ?? '').replace(/[<>&'"]/g, (char) => ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[char]!));
  const items = rows.map((row) => `<item><title>${escape(row.display_name)}：${escape(row.report_date)} 持仓披露</title><link>${escape(row.source_url)}</link><guid>${escape(row.id)}-${threshold}</guid><pubDate>${new Date(String(row.filed_date)).toUTCString()}</pubDate><description>${row.previous_id ? `普通股新出现 ${escape(row.new_count)} 项；不再披露 ${escape(row.sold_count)} 项；披露股数变化至少 ${threshold}% 的有 ${escape(row.significant_count)} 项。` : '首次记录，已建立变化比较基准。'}</description></item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>点金雷达提醒（${threshold}% 阈值）</title><link>${origin}</link><description>知名投资人与机构公开持仓更新</description>${items}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=900' } });
}

async function sources(env: Env) {
  const [coverage, validation, notices, metadata, sync] = await env.DB.batch([
    env.DB.prepare(`${verifiedLatestCte} SELECT m.source,COUNT(*) managers,COUNT(CASE WHEN l.rank=1 THEN 1 END) synced,
      COUNT(CASE WHEN l.rank=1 AND l.report_date>=CASE m.source WHEN 'ARK' THEN date('now','-10 days') ELSE ${secExpectedReport} END THEN 1 END) current,
      COUNT(CASE WHEN l.rank=1 AND l.report_date<CASE m.source WHEN 'ARK' THEN date('now','-10 days') ELSE ${secExpectedReport} END THEN 1 END) stale,
      MAX(m.last_synced_at) updated_at FROM managers m LEFT JOIN latest l ON l.manager_id=m.id AND l.rank=1 WHERE m.active=1 GROUP BY m.source`),
    env.DB.prepare(`SELECT COUNT(CASE WHEN validation_status IN ('reconciled','reconciled_composite','reconciled_unit_inferred') THEN 1 END) securities,
      COUNT(CASE WHEN validation_status='reconciled_unit_inferred' THEN 1 END) unit_inferred,MAX(fetched_at) updated_at FROM filings`),
    env.DB.prepare('SELECT COUNT(*) securities,MAX(filed_date) updated_at FROM filing_notices'),
    env.DB.prepare("SELECT COUNT(*) securities,COUNT(CASE WHEN source LIKE 'SEC+%' THEN 1 END) sec_mapped,MAX(updated_at) updated_at FROM securities"),
    env.DB.prepare('SELECT status,started_at,finished_at FROM sync_runs ORDER BY started_at DESC LIMIT 1'),
  ]);
  const counts = Object.fromEntries(coverage.results.map((row) => {
    const record = row as Record<string, unknown>;
    return [String(record.source), record];
  }));
  const securityCounts = metadata.results[0] as Record<string, unknown> | undefined;
  return json({ sources: [
    { id:'sec', name:'美国证监会 EDGAR 原始申报', cadence:'季度法定披露', official_url:'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', detail:'逐主体读取 SEC submissions、13F 封面和信息表；只把已通过校验且达到当前应披露季度的申报纳入当前持仓。', ...(counts.SEC ?? {}) },
    { id:'sec-cover', name:'13F 封面与信息表交叉校验', cadence:'每份申报', official_url:'https://www.sec.gov/files/form13f.pdf', detail:'逐份核对封面申报条数、封面总值与信息表逐行合计；修正表按 RESTATEMENT 或 NEW HOLDINGS 法定语义处理，异常金额单位单独标记。', ...(validation.results[0] ?? {}), count_label:'份申报已对账' },
    { id:'sec-notice', name:'13F-NT 申报去向', cadence:'每份通知', official_url:'https://www.sec.gov/submit-filings/technical-specifications', detail:'识别没有持仓表的 13F-NT，并保留其列出的其他申报主体；该主体历史组合不再冒充当前持仓。', ...(notices.results[0] ?? {}), count_label:'份通知已识别' },
    { id:'sec-list', name:'美国证监会 13F 官方证券清单', cadence:'季度校验', official_url:'https://www.sec.gov/rules-regulations/staff-guidance/official-list-section-13f-securities', detail:'用报告季度官方 CUSIP 清单限定 13F 合格证券；交易代码与行业仍是辅助匹配，不把同名推断写成官方确认。', securities:securityCounts?.sec_mapped, count_label:'只证券完成清单约束与元数据匹配', updated_at:securityCounts?.updated_at },
    { id:'sec-bulk', name:'美国证监会 13F 批量数据集', cadence:'官方延后发布', official_url:'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets', detail:'作为整季二次核验源；当前季度尚未进入官方批量包时，以逐份 EDGAR 原文与封面对账为准，不伪造“已交叉通过”。', status:'本季度批量包待官方发布' },
    { id:'ark', name:'ARK 基金官方每日持仓', cadence:'交易日更新', official_url:'https://helpcenter.ark-funds.com/where-can-i-download-the-latest-etf-holdings', detail:'直接读取六只主动管理基金官方 CSV，并核对基金代码、单一日期、字段完整性、新鲜度和权重合计；官网日期按其规则还原为持仓日。', ...(counts.ARK ?? {}) },
    { id:'nasdaq', name:'纳斯达克证券目录（辅助）', cadence:'每日补全', official_url:'https://www.nasdaq.com/market-activity/stocks/screener', detail:'仅补全交易代码、板块与行业，不参与持仓、金额、股数和变化计算。', ...(securityCounts ?? {}), count_label:'证券元数据已补全' },
    { id:'sec-other', name:'SEC ADV、N-PORT 与 13D/G', cadence:'独立法律口径', official_url:'https://www.sec.gov/data-research/sec-markets-data', detail:'用于主体身份、基金级持仓或重大权益事件的辅助核对；它们与 13F 的主体、频率和覆盖范围不同，当前不相加、不冒充同一组合。', status:'参考源，不并表' },
    { id:'hkex-policy', name:'香港交易所权益披露', cadence:'授权边界', official_url:'https://www.hkex.com.hk/global/exchange/terms-of-use?sc_lang=zh-HK', detail:'港股权益披露不是完整组合；因交易所条款限制系统化提取与再发布，当前已停用并撤下自动抓取数据，取得书面授权后再接入。', status:'未获再分发授权，未接入' },
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
