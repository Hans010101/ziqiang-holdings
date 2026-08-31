import assert from 'node:assert/strict';
import test from 'node:test';
import { parse13F, parseArk, parseCsv, parseHkexDisclosures } from '../src/parsers';
import { aggregatePositions, normalizeIssuer, parse13fCusips, pickInfoTableFile, secValueMultiplier } from '../src/sync';

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

test('validates CUSIPs against the SEC fixed-width list', () => {
  assert.deepEqual([...parse13fCusips('B38564108*CMB.TECH NV\n02079K107 ALPHABET INC\ninvalid\n')], ['B38564108', '02079K107']);
});

test('corrects legacy thousand-dollar values still used in a current filing', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ cusip: String(i), issuer: 'ACME', title: 'COM', ticker: '', shares: 1000, value: 50, weight: 0, putCall: '', discretion: '', sole: 0, shared: 0, noneVotes: 0 }));
  assert.equal(secValueMultiplier(rows, '2026-08-14'), 1000);
  assert.equal(secValueMultiplier(rows.map((row) => ({ ...row, value: 50000 })), '2026-08-14'), 1);
});

test('parses official HKEX long-position disclosure without calling it a trade', () => {
  const rows = parseHkexDisclosures(`<table><tr><td><a href="NSForm2.aspx?fn=CS20260812E00001&amp;sid=312028">CS20260812E00001</a></td><td>H&amp;H International Investment, LLC</td><td>11032(L)<br></td><td>28,646,000(L)</td><td>&nbsp;</td><td>102,576,000(L)</td><td>7.70(L)</td><td>06/08/2026</td></tr></table>`, 'H&H International Investment, LLC');
  assert.deepEqual(rows[0], { id:'CS20260812E00001', positionType:'好仓', shares:102576000, ownershipPercent:7.7, involvedShares:28646000, reasonCode:'11032', eventDate:'2026-08-06', filedDate:'2026-08-12', sourceUrl:'https://di.hkex.com.hk/di/NSForm2.aspx?fn=CS20260812E00001&sid=312028' });
});
