export type ParsedPosition = {
  cusip: string;
  issuer: string;
  title: string;
  ticker: string;
  shares: number;
  amountType: string;
  value: number;
  weight: number;
  putCall: string;
  discretion: string;
  sole: number;
  shared: number;
  noneVotes: number;
};

const decodeXml = (value: string) => value
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();

const tag = (xml: string, name: string) => {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'i'));
  return decodeXml(match?.[1]?.replace(/<[^>]+>/g, '') ?? '');
};

const number = (value: string) => Number(value.replace(/[$,%",]/g, '')) || 0;
const requiredNumber = (value: string, field: string) => {
  const normalized = value.replace(/[$,%",]/g, '');
  if (!normalized || !Number.isFinite(Number(normalized))) throw new Error(`Invalid SEC ${field}: ${value || 'missing'}`);
  return Number(normalized);
};

export function parse13FCover(xml: string) {
  return {
    positionsCount: number(tag(xml, 'tableEntryTotal')),
    totalValue: number(tag(xml, 'tableValueTotal')),
  };
}

export function parse13FNotice(xml: string) {
  const otherManagers = (xml.match(/<(?:\w+:)?otherManager\b[\s\S]*?<\/(?:\w+:)?otherManager>/gi) ?? []).flatMap((block) => {
    const cik = tag(block, 'cik'), name = tag(block, 'name');
    return cik && name ? [{ cik: cik.padStart(10, '0'), name }] : [];
  });
  return { otherManagers };
}

// ponytail: SEC's information-table schema is stable; replace with a streaming XML parser if a filing fails schema validation.
export function parse13F(xml: string): ParsedPosition[] {
  const blocks = xml.match(/<(?:\w+:)?infoTable\b[\s\S]*?<\/(?:\w+:)?infoTable>/gi) ?? [];
  return blocks.map((block) => ({
    cusip: tag(block, 'cusip'), issuer: tag(block, 'nameOfIssuer'), title: tag(block, 'titleOfClass'), ticker: '',
    shares: requiredNumber(tag(block, 'sshPrnamt'), 'sshPrnamt'), amountType: tag(block, 'sshPrnamtType').toUpperCase(),
    value: requiredNumber(tag(block, 'value'), 'value'), weight: 0,
    putCall: tag(block, 'putCall'), discretion: tag(block, 'investmentDiscretion'),
    sole: number(tag(block, 'Sole')), shared: number(tag(block, 'Shared')), noneVotes: number(tag(block, 'None')),
  })).filter((row) => row.cusip && row.issuer && (row.amountType === 'SH' || row.amountType === 'PRN'));
}

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"' && quoted && csv[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[i + 1] === '\n') i += 1;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseArk(csv: string): { reportDate: string; fund: string; positions: ParsedPosition[] } {
  const [headers = [], ...rows] = parseCsv(csv);
  const index = Object.fromEntries(headers.map((header, i) => [header.trim().toLowerCase(), i]));
  for (const field of ['date','fund','company','ticker','cusip','shares','market value ($)','weight (%)']) {
    if (index[field] === undefined) throw new Error(`Missing ARK CSV column: ${field}`);
  }
  const dataRows = rows.filter((row) => row[index.cusip]?.trim() && row[index.company]?.trim() && row[index.fund]?.trim());
  const dates = new Set(dataRows.map((row) => row[index.date]?.trim()).filter(Boolean));
  const funds = new Set(dataRows.map((row) => row[index.fund]?.trim().toUpperCase()).filter(Boolean));
  if (dates.size !== 1 || funds.size !== 1) throw new Error('ARK CSV mixes dates or funds');
  const positions = dataRows.map((row) => ({
    cusip: row[index.cusip]?.trim() ?? '', issuer: row[index.company]?.trim() ?? '', title: 'SH',
    ticker: row[index.ticker]?.trim() ?? '', shares: number(row[index.shares] ?? ''),
    amountType: 'SH',
    value: Math.round(number(row[index['market value ($)']] ?? '')), weight: number(row[index['weight (%)']] ?? ''),
    putCall: '', discretion: '', sole: 0, shared: 0, noneVotes: 0,
  })).filter((row) => row.cusip && row.issuer);
  return { reportDate: [...dates][0] ?? '', fund: [...funds][0] ?? '', positions };
}
