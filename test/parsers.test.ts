import assert from 'node:assert/strict';
import test from 'node:test';
import { parse13F, parseArk, parseCsv } from '../src/parsers';
import { aggregatePositions, normalizeIssuer, pickInfoTableFile } from '../src/sync';

test('parses namespaced 13F rows and dollar values', () => {
  const rows = parse13F(`<informationTable><ns:infoTable><ns:nameOfIssuer>ACME &amp; CO</ns:nameOfIssuer><ns:titleOfClass>COM</ns:titleOfClass><ns:cusip>123456789</ns:cusip><ns:value>1200456</ns:value><ns:shrsOrPrnAmt><ns:sshPrnamt>7,500</ns:sshPrnamt></ns:shrsOrPrnAmt><ns:votingAuthority><ns:Sole>7500</ns:Sole><ns:Shared>0</ns:Shared><ns:None>0</ns:None></ns:votingAuthority></ns:infoTable></informationTable>`);
  assert.deepEqual(rows[0], { cusip: '123456789', issuer: 'ACME & CO', title: 'COM', ticker: '', shares: 7500, value: 1200456, weight: 0, putCall: '', discretion: '', sole: 7500, shared: 0, noneVotes: 0 });
});

test('parses quoted ARK CSV fields', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n')[1], ['x, y', '2']);
  const parsed = parseArk('date,fund,company,ticker,cusip,shares,market value ($),weight (%)\n08/28/2026,ARKK,"ACME, INC",ACME,123456789,"1,200","$4,567.89",5.25%\n');
  assert.equal(parsed.reportDate, '08/28/2026');
  assert.equal(parsed.positions[0].value, 4568);
  assert.equal(parsed.positions[0].shares, 1200);
});

test('selects an information table when SEC primaryDocument contains an XSL path', () => {
  const files = [{ name: 'primary_doc.xml' }, { name: 'renaissance13Fq22026_holding.xml' }];
  assert.equal(pickInfoTableFile(files, 'xslForm13F_X02/primary_doc.xml')?.name, 'renaissance13Fq22026_holding.xml');
});

test('aggregates repeated 13F lines for one security without losing shares or value', () => {
  const base = { cusip: '123456789', issuer: 'ACME', title: 'COM', ticker: '', weight: 0, putCall: '', discretion: 'SOLE', shared: 0, noneVotes: 0 };
  const rows = aggregatePositions([{ ...base, shares: 10, value: 100, sole: 10 }, { ...base, shares: 25, value: 300, sole: 25 }]);
  assert.equal(rows.length, 1);
  assert.deepEqual({ shares: rows[0].shares, value: rows[0].value, sole: rows[0].sole }, { shares: 35, value: 400, sole: 35 });
});

test('normalizes filing and market issuer names to the same key', () => {
  assert.equal(normalizeIssuer('APPLE INC'), normalizeIssuer('Apple Inc. Common Stock'));
  assert.equal(normalizeIssuer('COCA COLA CO'), normalizeIssuer('Coca-Cola Company Common Stock'));
});
