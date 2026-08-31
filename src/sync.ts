import { parse13F, parse13FCover, parse13FNotice, parseArk, type ParsedPosition } from './parsers';

type Manager = { id: string; cik: string | null; source: 'SEC' | 'ARK'; sync_depth: number };
type RecentFilings = { recent: Record<string, string[]> };
type MarketRow = { symbol: string; name: string; sector: string; industry: string };

const ARK_FILES: Record<string, string> = {
  arkk: 'ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv',
  arkg: 'ARK_GENOMIC_REVOLUTION_ETF_ARKG_HOLDINGS.csv',
  arkq: 'ARK_AUTONOMOUS_TECH._%26_ROBOTICS_ETF_ARKQ_HOLDINGS.csv',
  arkw: 'ARK_NEXT_GENERATION_INTERNET_ETF_ARKW_HOLDINGS.csv',
  arkf: 'ARK_BLOCKCHAIN_%26_FINTECH_INNOVATION_ETF_ARKF_HOLDINGS.csv',
  arkx: 'ARK_SPACE_%26_DEFENSE_INNOVATION_ETF_ARKX_HOLDINGS.csv',
};

const jsonInsert = `INSERT OR REPLACE INTO positions
  (filing_id,cusip,issuer,title,ticker,shares,amount_type,value,weight,put_call,discretion,sole,shared,none_votes)
SELECT json_extract(value,'$.filingId'),json_extract(value,'$.cusip'),json_extract(value,'$.issuer'),
  json_extract(value,'$.title'),json_extract(value,'$.ticker'),json_extract(value,'$.shares'),
  json_extract(value,'$.amountType'),json_extract(value,'$.value'),json_extract(value,'$.weight'),json_extract(value,'$.putCall'),
  json_extract(value,'$.discretion'),json_extract(value,'$.sole'),json_extract(value,'$.shared'),
  json_extract(value,'$.noneVotes') FROM json_each(?1)`;

const securityInsert = `INSERT OR REPLACE INTO securities (cusip,ticker,sector,industry,source,updated_at)
SELECT json_extract(value,'$.cusip'),json_extract(value,'$.ticker'),json_extract(value,'$.sector'),
  json_extract(value,'$.industry'),json_extract(value,'$.source'),datetime('now') FROM json_each(?1)`;

const headers = (env: Env) => ({ 'User-Agent': env.SEC_USER_AGENT, Accept: 'application/json, application/xml, text/xml, text/csv, text/html' });
const xmlTag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'i'))?.[1]?.trim() ?? '';
const isoDate = (value: string) => {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : value;
};
export function arkPositionDate(value: string) {
  const date = new Date(`${isoDate(value)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  do date.setUTCDate(date.getUTCDate() - 1); while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

export function pickInfoTableFile(files: { name: string }[], primary: string) {
  const primaryName = primary.split('/').at(-1)?.toLowerCase();
  const candidates = files.filter((file) => file.name.toLowerCase().endsWith('.xml') && file.name.toLowerCase() !== primaryName);
  return candidates.find((file) => /info.*table|holding|13f/i.test(file.name)) ?? candidates[0];
}

export function aggregatePositions(positions: ParsedPosition[]) {
  const grouped = new Map<string, ParsedPosition>();
  for (const row of positions) {
    const key = `${row.cusip}|${row.title}|${row.putCall}|${row.amountType}`;
    const current = grouped.get(key);
    if (!current) grouped.set(key, { ...row });
    else grouped.set(key, {
      ...current, shares: current.shares + row.shares, value: current.value + row.value,
      sole: current.sole + row.sole, shared: current.shared + row.shared, noneVotes: current.noneVotes + row.noneVotes,
    });
  }
  return [...grouped.values()];
}

export function normalizeIssuer(value: string) {
  return value.toUpperCase().replace(/&/g, ' AND ').replace(/\([^)]*\)/g, ' ')
    .replace(/\b(COMMON|STOCK|SHARES?|ORDINARY|CLASS|CL|ADS|ADR|NEW|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|HOLDINGS|HLDGS|GROUP|PLC|LLC|LP|LTD|LIMITED|AG|SA|NV|SE)\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '');
}

export function parse13fCusips(text: string) {
  return new Set(text.split(/\r?\n/).map((line) => line.slice(0, 9).toUpperCase()).filter((cusip) => /^[0-9A-Z]{9}$/.test(cusip)));
}

export function secValueMultiplier(_positions: ParsedPosition[], filedDate: string) {
  if (filedDate < '2023-01-03') return 1000;
  const ratios = _positions.filter((row) => row.amountType === 'SH' && !row.putCall && row.shares > 0 && row.value > 0)
    .map((row) => row.value / row.shares).sort((a, b) => a - b);
  if (ratios.length < 5) return 1;
  const median = ratios[Math.floor(ratios.length / 2)];
  // ponytail: flag only strong whole-filing evidence; add a licensed price source if filer-side unit errors become common.
  return median > 0.005 && median < 1 && median * 1000 >= 5 && median * 1000 <= 5000 ? 1000 : 1;
}

export function validate13FCover(positions: ParsedPosition[], cover: { positionsCount: number; totalValue: number }) {
  const parsedTotal = positions.reduce((sum, row) => sum + row.value, 0);
  const valueDifference = parsedTotal - cover.totalValue;
  if (!cover.positionsCount || !cover.totalValue) throw new Error('13F cover summary is missing');
  if (positions.length !== cover.positionsCount || Math.abs(valueDifference) > 10) {
    throw new Error(`13F cover mismatch: rows ${positions.length}/${cover.positionsCount}, value ${parsedTotal}/${cover.totalValue}`);
  }
  return { positionsCount: cover.positionsCount, totalValue: cover.totalValue, valueDifference };
}

async function syncSecurities(env: Env) {
  const fresh = await env.DB.prepare("SELECT 1 ok FROM securities WHERE updated_at>datetime('now','-1 day') LIMIT 1").first();
  if (fresh) return { skipped: true, matched: 0 };
  const latest = await env.DB.prepare("SELECT MAX(f.report_date) report_date FROM filings f JOIN managers m ON m.id=f.manager_id WHERE m.source='SEC'")
    .first<{ report_date: string }>();
  if (!latest?.report_date) throw new Error('No SEC report period available for security validation');
  const [year, month] = latest.report_date.split('-').map(Number);
  const quarter = Math.ceil(month / 3);
  const officialCusips = parse13fCusips(await fetchText(`https://www.sec.gov/files/investment/13flist${year}q${quarter}-txt.txt`, env));
  if (!officialCusips.size) throw new Error(`Empty SEC 13F security list for ${year} Q${quarter}`);
  const response = await fetch('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.nasdaq.com/market-activity/stocks/screener',
    },
  });
  if (!response.ok) throw new Error(`NASDAQ metadata ${response.status}`);
  const market = ((await response.json()) as { data?: { rows?: MarketRow[] } }).data?.rows ?? [];
  const byTicker = new Map(market.map((row) => [row.symbol.toUpperCase(), row]));
  const byName = new Map<string, MarketRow | null>();
  for (const row of market) {
    const key = normalizeIssuer(row.name);
    byName.set(key, byName.has(key) ? null : row);
  }
  const holdings = (await env.DB.prepare('SELECT cusip,MAX(issuer) issuer,MAX(ticker) ticker FROM positions GROUP BY cusip').all<{ cusip: string; issuer: string; ticker: string }>()).results;
  const matched = holdings.flatMap((holding) => {
    const official = officialCusips.has(holding.cusip.replace(/[^0-9A-Z]/gi, '').slice(0, 9).toUpperCase());
    const row = (holding.ticker && byTicker.get(holding.ticker.toUpperCase())) || (official && byName.get(normalizeIssuer(holding.issuer)));
    return row ? [{ cusip: holding.cusip, ticker: row.symbol, sector: row.sector || '', industry: row.industry || '', source: official ? 'SEC+NASDAQ' : 'ARK+NASDAQ' }] : [];
  });
  const statements = [env.DB.prepare('DELETE FROM securities')];
  for (let i = 0; i < matched.length; i += 250) statements.push(env.DB.prepare(securityInsert).bind(JSON.stringify(matched.slice(i, i + 250))));
  await env.DB.batch(statements);
  return { skipped: false, matched: matched.length };
}

async function fetchText(url: string, env: Env) {
  const response = await fetch(url, { headers: headers(env) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function sha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function saveFiling(env: Env, filing: {
  id: string; managerId: string; reportDate: string; filedDate: string; form: string; sourceUrl: string;
  declaredPositionsCount: number; declaredTotalValue: number; declaredRawTotalValue: number; valueMultiplier: number;
  validationStatus: 'reconciled' | 'reconciled_composite' | 'reconciled_unit_inferred' | 'source_only'; validationDetail: string;
  contributingAccessions: string[]; contentHash: string;
}, positions: ParsedPosition[]) {
  const aggregated = aggregatePositions(positions);
  const total = aggregated.reduce((sum, row) => sum + row.value, 0);
  const weighted = aggregated.map((row) => ({ ...row, weight: total ? row.value / total * 100 : row.weight }));
  const statements = [env.DB.prepare(`INSERT INTO filings
    (id,manager_id,report_date,filed_date,form,source_url,total_value,positions_count,is_amendment,declared_positions_count,declared_total_value,declared_raw_total_value,value_multiplier,validation_status,validation_detail,contributing_accessions,content_hash,fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET report_date=excluded.report_date,filed_date=excluded.filed_date,
    form=excluded.form,source_url=excluded.source_url,total_value=excluded.total_value,positions_count=excluded.positions_count,
    declared_positions_count=excluded.declared_positions_count,declared_total_value=excluded.declared_total_value,
    declared_raw_total_value=excluded.declared_raw_total_value,value_multiplier=excluded.value_multiplier,
    validation_status=excluded.validation_status,validation_detail=excluded.validation_detail,
    contributing_accessions=excluded.contributing_accessions,content_hash=excluded.content_hash,fetched_at=datetime('now')`)
    .bind(filing.id, filing.managerId, filing.reportDate, filing.filedDate, filing.form, filing.sourceUrl, total, weighted.length,
      filing.form.endsWith('/A') ? 1 : 0, filing.declaredPositionsCount, filing.declaredTotalValue, filing.declaredRawTotalValue,
      filing.valueMultiplier, filing.validationStatus, filing.validationDetail, JSON.stringify(filing.contributingAccessions), filing.contentHash),
    env.DB.prepare('DELETE FROM positions WHERE filing_id=?').bind(filing.id)];
  for (let i = 0; i < weighted.length; i += 250) {
    statements.push(env.DB.prepare(jsonInsert).bind(JSON.stringify(weighted.slice(i, i + 250).map((row) => ({ filingId: filing.id, ...row })))));
  }
  await env.DB.batch(statements);
}

async function syncArk(manager: Manager, env: Env) {
  const file = ARK_FILES[manager.id];
  if (!file) throw new Error(`Unknown ARK fund: ${manager.id}`);
  const sourceUrl = `https://assets.ark-funds.com/fund-documents/funds-etf-csv/${file}`;
  const csv = await fetchText(sourceUrl, env);
  const { reportDate: rawDate, fund, positions } = parseArk(csv);
  const reportDate = arkPositionDate(rawDate);
  if (!reportDate || !positions.length) throw new Error(`Empty ARK data for ${manager.id}`);
  if (fund !== manager.id.toUpperCase()) throw new Error(`Wrong ARK fund in CSV: ${fund}`);
  const age = (Date.now() - new Date(`${reportDate}T00:00:00Z`).getTime()) / 86_400_000;
  if (age < -1 || age > 10) throw new Error(`Stale ARK data for ${manager.id}: ${reportDate}`);
  const weight = positions.reduce((sum, row) => sum + row.weight, 0);
  if (weight < 90 || weight > 110) throw new Error(`Invalid ARK weight total for ${manager.id}: ${weight}`);
  await saveFiling(env, {
    id: `${manager.id}-${reportDate}`, managerId: manager.id, reportDate, filedDate: reportDate, form: 'ARK-DAILY',
    sourceUrl,
    declaredPositionsCount: positions.length,
    declaredTotalValue: positions.reduce((sum, row) => sum + row.value, 0),
    declaredRawTotalValue: positions.reduce((sum, row) => sum + row.value, 0),
    valueMultiplier: 1,
    validationStatus: 'source_only',
    validationDetail: '已核对基金代码、单一日期、字段完整性、新鲜度与权重合计；无独立日频监管总表。',
    contributingAccessions: [],
    contentHash: await sha256(csv),
  }, positions);
  return positions.length;
}

async function syncSec(manager: Manager, env: Env, limit?: number) {
  const cik = manager.cik!;
  const submissions = await fetchText(`https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`, env);
  const recent = (JSON.parse(submissions).filings as RecentFilings).recent;
  const all = recent.form.map((form, i) => ({
    form, accession: recent.accessionNumber[i], reportDate: recent.reportDate[i], filedDate: recent.filingDate[i], primary: recent.primaryDocument[i],
  }));
  const notices = all.filter((item) => item.form === '13F-NT' || item.form === '13F-NT/A').slice(0, 4);
  for (const item of notices) {
    const accessionPath = item.accession.replaceAll('-', '');
    const directory = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath}`;
    const primaryName = item.primary.split('/').at(-1)!;
    const { otherManagers } = parse13FNotice(await fetchText(`${directory}/${primaryName}`, env));
    const detail = otherManagers.length
      ? `本主体提交 13F-NT，持仓由 ${otherManagers.length} 个所列申报主体分别披露。`
      : '本主体提交 13F-NT，本文件无持仓表；以原文说明的申报去向为准。';
    await env.DB.prepare(`INSERT INTO filing_notices (id,manager_id,report_date,filed_date,form,source_url,other_managers,detail)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET report_date=excluded.report_date,filed_date=excluded.filed_date,
      form=excluded.form,source_url=excluded.source_url,other_managers=excluded.other_managers,detail=excluded.detail`)
      .bind(item.accession, manager.id, item.reportDate, item.filedDate, item.form, `${directory}/${item.accession}-index.html`, JSON.stringify(otherManagers), detail).run();
  }

  const candidates = all.filter((item) => item.form === '13F-HR' || item.form === '13F-HR/A');
  const periods = [...new Set(candidates.map((item) => item.reportDate))].slice(0, limit ?? manager.sync_depth);
  const selected = candidates.filter((item) => periods.includes(item.reportDate));

  let count = 0;
  for (const item of selected.reverse()) {
    const existing = await env.DB.prepare('SELECT positions_count,validation_status FROM filings WHERE id=?').bind(item.accession)
      .first<{ positions_count: number; validation_status: string }>();
    if (existing?.positions_count && existing.validation_status !== 'pending') { count += existing.positions_count; continue; }
    const accessionPath = item.accession.replaceAll('-', '');
    const directory = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath}`;
    const index = JSON.parse(await fetchText(`${directory}/index.json`, env)) as { directory: { item: { name: string }[] } };
    const info = pickInfoTableFile(index.directory.item, item.primary);
    if (!info) throw new Error(`No information table in ${item.accession}: ${index.directory.item.map((file) => file.name).join(', ')}`);
    const primaryName = item.primary.split('/').at(-1)!;
    const primary = await fetchText(`${directory}/${primaryName}`, env);
    const informationTable = await fetchText(`${directory}/${info.name}`, env);
    const sourcePositions = parse13F(informationTable);
    let cover;
    try {
      cover = validate13FCover(sourcePositions, parse13FCover(primary));
    } catch (error) {
      const laterRestatement = selected.find((candidate) => candidate.reportDate === item.reportDate && candidate.form.endsWith('/A') &&
        (candidate.filedDate > item.filedDate || (candidate.filedDate === item.filedDate && candidate.accession > item.accession)));
      if (!laterRestatement) throw error;
      const laterPath = laterRestatement.accession.replaceAll('-', '');
      const laterPrimary = await fetchText(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${laterPath}/${laterRestatement.primary.split('/').at(-1)}`, env);
      if (xmlTag(laterPrimary, 'amendmentType').toUpperCase() !== 'RESTATEMENT') throw error;
      continue;
    }
    let positions = sourcePositions;
    const valueMultiplier = secValueMultiplier(positions, item.filedDate);
    if (valueMultiplier !== 1) {
      positions = positions.map((row) => ({ ...row, value: row.value * valueMultiplier }));
    }

    let contributingAccessions = [item.accession];
    let composite = false;
    if (item.form.endsWith('/A')) {
      const amendmentType = xmlTag(primary, 'amendmentType').toUpperCase();
      if (amendmentType === 'NEW HOLDINGS') {
        const previous = await env.DB.prepare(`SELECT id,contributing_accessions FROM filings
          WHERE manager_id=? AND report_date=? AND id<>? AND validation_status IN ('reconciled','reconciled_composite','reconciled_unit_inferred')
          ORDER BY filed_date DESC,id DESC LIMIT 1`).bind(manager.id, item.reportDate, item.accession)
          .first<{ id: string; contributing_accessions: string }>();
        if (!previous) throw new Error(`No prior filing for NEW HOLDINGS amendment ${item.accession}`);
        const base = await env.DB.prepare('SELECT * FROM positions WHERE filing_id=?').bind(previous.id).all<Record<string, string | number>>();
        positions = [...base.results.map((row) => ({
          cusip: String(row.cusip), issuer: String(row.issuer), title: String(row.title), ticker: String(row.ticker),
          shares: Number(row.shares), amountType: String(row.amount_type), value: Number(row.value), weight: Number(row.weight), putCall: String(row.put_call),
          discretion: String(row.discretion), sole: Number(row.sole), shared: Number(row.shared), noneVotes: Number(row.none_votes),
        })), ...positions];
        const priorAccessions = JSON.parse(previous.contributing_accessions || '[]');
        contributingAccessions = [...(priorAccessions.length ? priorAccessions : [previous.id]), item.accession];
        composite = true;
      } else if (amendmentType !== 'RESTATEMENT') throw new Error(`Unknown amendment type in ${item.accession}: ${amendmentType || 'missing'}`);
    }
    if (!positions.length) throw new Error(`Parsed zero positions from ${item.accession}`);
    const inferredUnit = item.filedDate >= '2023-01-03' && valueMultiplier === 1000;
    const validationStatus = inferredUnit ? 'reconciled_unit_inferred' : composite ? 'reconciled_composite' : 'reconciled';
    const differenceDetail = cover.valueDifference
      ? `信息表价值合计与封面相差 ${cover.valueDifference > 0 ? '+' : ''}${cover.valueDifference} 美元；保留申报原始微差。`
      : '';
    const validationDetail = inferredUnit
      ? `信息表与封面原始合计已核对，但逐行价值/数量显示申报人仍沿用千美元；保留原值并以 ×1000 推断归一。${differenceDetail}`
      : composite
        ? `本修正表与封面已核对；按 NEW HOLDINGS 规则与此前 ${contributingAccessions.length - 1} 份已核验申报合成季度快照。${differenceDetail}`
        : differenceDetail || '信息表逐行合计与同份 13F 封面申报条数、申报总值完全一致。';
    await saveFiling(env, {
      id: item.accession, managerId: manager.id, reportDate: item.reportDate, filedDate: item.filedDate, form: item.form,
      sourceUrl: `${directory}/${item.accession}-index.html`,
      declaredPositionsCount: cover.positionsCount,
      declaredTotalValue: cover.totalValue * valueMultiplier,
      declaredRawTotalValue: cover.totalValue,
      valueMultiplier,
      validationStatus,
      validationDetail,
      contributingAccessions,
      contentHash: await sha256(`${primary}\n${informationTable}`),
    }, positions);
    count += positions.length;
  }
  return count;
}

export async function syncManagers(env: Env, managerId?: string, limit?: number) {
  const runId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO sync_runs (id,source,status,started_at) VALUES (?,?,?,datetime('now'))`).bind(runId, managerId ?? 'all', 'running').run();
  const query = managerId ? 'SELECT * FROM managers WHERE active=1 AND id=?' : 'SELECT * FROM managers WHERE active=1 ORDER BY source,id';
  const managers = managerId
    ? [await env.DB.prepare(query).bind(managerId).first<Manager>()].filter(Boolean) as Manager[]
    : (await env.DB.prepare(query).all<Manager>()).results;
  if (!managers.length) throw new Error('Manager not found');
  const results: { id: string; positions?: number; error?: string }[] = [];
  for (const manager of managers) {
    try {
      const positions = manager.source === 'ARK' ? await syncArk(manager, env) : await syncSec(manager, env, limit);
      await env.DB.prepare(`UPDATE managers SET last_synced_at=datetime('now') WHERE id=?`).bind(manager.id).run();
      results.push({ id: manager.id, positions });
    } catch (error) {
      results.push({ id: manager.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!managerId) {
    try { results.push({ id: 'market-metadata', positions: (await syncSecurities(env)).matched }); }
    catch (error) { results.push({ id: 'market-metadata', error: error instanceof Error ? error.message : String(error) }); }
  }
  const failed = results.filter((row) => row.error).length;
  await env.DB.prepare(`UPDATE sync_runs SET status=?,finished_at=datetime('now'),detail=? WHERE id=?`)
    .bind(failed === results.length ? 'failed' : failed ? 'partial' : 'success', JSON.stringify(results), runId).run();
  return { runId, results };
}
