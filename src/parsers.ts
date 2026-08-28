export type ParsedPosition = {
  cusip: string;
  issuer: string;
  title: string;
  ticker: string;
  shares: number;
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
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

const tag = (xml: string, name: string) => {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'i'));
  return decodeXml(match?.[1]?.replace(/<[^>]+>/g, '') ?? '');
};

const number = (value: string) => Number(value.replace(/[$,%",]/g, '')) || 0;

// ponytail: SEC's information-table schema is stable; replace with a streaming XML parser if a filing fails schema validation.
export function parse13F(xml: string): ParsedPosition[] {
  const blocks = xml.match(/<(?:\w+:)?infoTable\b[\s\S]*?<\/(?:\w+:)?infoTable>/gi) ?? [];
  return blocks.map((block) => ({
    cusip: tag(block, 'cusip'), issuer: tag(block, 'nameOfIssuer'), title: tag(block, 'titleOfClass'), ticker: '',
    shares: number(tag(block, 'sshPrnamt')), value: number(tag(block, 'value')), weight: 0,
    putCall: tag(block, 'putCall'), discretion: tag(block, 'investmentDiscretion'),
    sole: number(tag(block, 'Sole')), shared: number(tag(block, 'Shared')), noneVotes: number(tag(block, 'None')),
  })).filter((row) => row.cusip && row.issuer);
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

export function parseArk(csv: string): { reportDate: string; positions: ParsedPosition[] } {
  const [headers = [], ...rows] = parseCsv(csv);
  const index = Object.fromEntries(headers.map((header, i) => [header.trim().toLowerCase(), i]));
  const positions = rows.map((row) => ({
    cusip: row[index.cusip]?.trim() ?? '', issuer: row[index.company]?.trim() ?? '', title: 'SH',
    ticker: row[index.ticker]?.trim() ?? '', shares: number(row[index.shares] ?? ''),
    value: Math.round(number(row[index['market value ($)']] ?? '')), weight: number(row[index['weight (%)']] ?? ''),
    putCall: '', discretion: '', sole: 0, shared: 0, noneVotes: 0,
  })).filter((row) => row.cusip && row.issuer);
  return { reportDate: rows[0]?.[index.date]?.trim() ?? '', positions };
}
