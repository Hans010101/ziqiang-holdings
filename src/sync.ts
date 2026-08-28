import { parse13F, parseArk, type ParsedPosition } from './parsers';

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
  (filing_id,cusip,issuer,title,ticker,shares,value,weight,put_call,discretion,sole,shared,none_votes)
SELECT json_extract(value,'$.filingId'),json_extract(value,'$.cusip'),json_extract(value,'$.issuer'),
  json_extract(value,'$.title'),json_extract(value,'$.ticker'),json_extract(value,'$.shares'),
  json_extract(value,'$.value'),json_extract(value,'$.weight'),json_extract(value,'$.putCall'),
  json_extract(value,'$.discretion'),json_extract(value,'$.sole'),json_extract(value,'$.shared'),
  json_extract(value,'$.noneVotes') FROM json_each(?1)`;

const securityInsert = `INSERT OR REPLACE INTO securities (cusip,ticker,sector,industry,source,updated_at)
SELECT json_extract(value,'$.cusip'),json_extract(value,'$.ticker'),json_extract(value,'$.sector'),
  json_extract(value,'$.industry'),json_extract(value,'$.source'),datetime('now') FROM json_each(?1)`;

const headers = (env: Env) => ({ 'User-Agent': env.SEC_USER_AGENT, Accept: 'application/json, application/xml, text/xml, text/csv' });
const xmlTag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'i'))?.[1]?.trim() ?? '';
const isoDate = (value: string) => {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : value;
};

export function pickInfoTableFile(files: { name: string }[], primary: string) {
  const primaryName = primary.split('/').at(-1)?.toLowerCase();
  const candidates = files.filter((file) => file.name.toLowerCase().endsWith('.xml') && file.name.toLowerCase() !== primaryName);
  return candidates.find((file) => /info.*table|holding|13f/i.test(file.name)) ?? candidates[0];
}

export function aggregatePositions(positions: ParsedPosition[]) {
  const grouped = new Map<string, ParsedPosition>();
  for (const row of positions) {
    const key = `${row.cusip}|${row.title}|${row.putCall}`;
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

export function secValueMultiplier(positions: ParsedPosition[], filedDate: string) {
  if (filedDate < '2023-01-03') return 1000;
  const ratios = positions.filter((row) => row.value > 0 && row.shares > 0 && !row.putCall)
    .map((row) => row.value / row.shares).sort((a, b) => a - b);
  // ponytail: catches legacy thousand-dollar filings accepted after the 2023 rule change; replace with filer-specific validation if false positives appear.
  return ratios.length >= 5 && ratios[Math.floor(ratios.length / 2)] < 1 ? 1000 : 1;
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

async function saveFiling(env: Env, filing: {
  id: string; managerId: string; reportDate: string; filedDate: string; form: string; sourceUrl: string;
}, positions: ParsedPosition[]) {
  const aggregated = aggregatePositions(positions);
  const total = aggregated.reduce((sum, row) => sum + row.value, 0);
  const weighted = aggregated.map((row) => ({ ...row, weight: total ? row.value / total * 100 : row.weight }));
  await env.DB.prepare(`INSERT INTO filings (id,manager_id,report_date,filed_date,form,source_url,total_value,positions_count,is_amendment)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET report_date=excluded.report_date,filed_date=excluded.filed_date,
    form=excluded.form,source_url=excluded.source_url,total_value=excluded.total_value,positions_count=excluded.positions_count`)
    .bind(filing.id, filing.managerId, filing.reportDate, filing.filedDate, filing.form, filing.sourceUrl, total, weighted.length, filing.form.endsWith('/A') ? 1 : 0).run();

  const statements = [env.DB.prepare('DELETE FROM positions WHERE filing_id=?').bind(filing.id)];
  for (let i = 0; i < weighted.length; i += 250) {
    statements.push(env.DB.prepare(jsonInsert).bind(JSON.stringify(weighted.slice(i, i + 250).map((row) => ({ filingId: filing.id, ...row })))));
  }
  await env.DB.batch(statements);
}

async function syncArk(manager: Manager, env: Env) {
  const file = ARK_FILES[manager.id];
  if (!file) throw new Error(`Unknown ARK fund: ${manager.id}`);
  const csv = await fetchText(`https://assets.ark-funds.com/fund-documents/funds-etf-csv/${file}`, env);
  const { reportDate: rawDate, positions } = parseArk(csv);
  const reportDate = isoDate(rawDate);
  if (!reportDate || !positions.length) throw new Error(`Empty ARK data for ${manager.id}`);
  await saveFiling(env, {
    id: `${manager.id}-${reportDate}`, managerId: manager.id, reportDate, filedDate: reportDate, form: 'ARK-DAILY',
    sourceUrl: `https://www.ark-funds.com/funds/${manager.id}`,
  }, positions);
  return positions.length;
}

async function syncSec(manager: Manager, env: Env, limit?: number) {
  const cik = manager.cik!;
  const submissions = await fetchText(`https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`, env);
  const recent = (JSON.parse(submissions).filings as RecentFilings).recent;
  const candidates = recent.form.map((form, i) => ({
    form, accession: recent.accessionNumber[i], reportDate: recent.reportDate[i], filedDate: recent.filingDate[i], primary: recent.primaryDocument[i],
  })).filter((item) => item.form === '13F-HR' || item.form === '13F-HR/A');
  const selected = candidates.slice(0, limit ?? manager.sync_depth);
  for (const amendment of selected.filter((item) => item.form.endsWith('/A'))) {
    const base = candidates.find((item) => item.form === '13F-HR' && item.reportDate === amendment.reportDate);
    if (base && !selected.some((item) => item.accession === base.accession)) selected.push(base);
  }

  let count = 0;
  for (const item of selected.reverse()) {
    const existing = await env.DB.prepare('SELECT positions_count FROM filings WHERE id=?').bind(item.accession).first<{ positions_count: number }>();
    if (existing?.positions_count) { count += existing.positions_count; continue; }
    const accessionPath = item.accession.replaceAll('-', '');
    const directory = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath}`;
    const index = JSON.parse(await fetchText(`${directory}/index.json`, env)) as { directory: { item: { name: string }[] } };
    const info = pickInfoTableFile(index.directory.item, item.primary);
    if (!info) throw new Error(`No information table in ${item.accession}: ${index.directory.item.map((file) => file.name).join(', ')}`);
    const primaryName = item.primary.split('/').at(-1)!;
    let positions = parse13F(await fetchText(`${directory}/${info.name}`, env));
    const valueMultiplier = secValueMultiplier(positions, item.filedDate);
    if (valueMultiplier !== 1) {
      console.warn(JSON.stringify({ event: 'sec_value_unit_corrected', manager: manager.id, accession: item.accession, multiplier: valueMultiplier }));
      positions = positions.map((row) => ({ ...row, value: row.value * valueMultiplier }));
    }

    if (item.form.endsWith('/A')) {
      const primary = await fetchText(`${directory}/${primaryName}`, env);
      if (/NEW HOLDINGS/i.test(xmlTag(primary, 'amendmentType'))) {
        const base = await env.DB.prepare(`SELECT p.* FROM positions p JOIN filings f ON f.id=p.filing_id
          WHERE f.manager_id=? AND f.report_date=? AND f.form='13F-HR' ORDER BY f.filed_date DESC`)
          .bind(manager.id, item.reportDate).all<Record<string, string | number>>();
        positions = [...base.results.map((row) => ({
          cusip: String(row.cusip), issuer: String(row.issuer), title: String(row.title), ticker: String(row.ticker),
          shares: Number(row.shares), value: Number(row.value), weight: Number(row.weight), putCall: String(row.put_call),
          discretion: String(row.discretion), sole: Number(row.sole), shared: Number(row.shared), noneVotes: Number(row.none_votes),
        })), ...positions];
      }
    }
    if (!positions.length) throw new Error(`Parsed zero positions from ${item.accession}`);
    await saveFiling(env, {
      id: item.accession, managerId: manager.id, reportDate: item.reportDate, filedDate: item.filedDate, form: item.form,
      sourceUrl: `${directory}/${item.accession}-index.html`,
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
