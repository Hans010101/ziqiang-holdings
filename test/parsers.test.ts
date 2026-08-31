import assert from 'node:assert/strict';
import test from 'node:test';
import { parse13F, parse13FCover, parse13FNotice, parseArk, parseCsv } from '../src/parsers';
import { aggregatePositions, arkPositionDate, normalizeIssuer, parse13fCusips, pickInfoTableFile, secValueMultiplier, validate13FCover } from '../src/sync';

test('parses namespaced 13F rows and dollar values', () => {
  const rows = parse13F(`<informationTable><ns:infoTable><ns:nameOfIssuer>ACME &amp; CO</ns:nameOfIssuer><ns:titleOfClass>COM</ns:titleOfClass><ns:cusip>123456789</ns:cusip><ns:value>1200456</ns:value><ns:shrsOrPrnAmt><ns:sshPrnamt>7,500</ns:sshPrnamt><ns:sshPrnamtType>SH</ns:sshPrnamtType></ns:shrsOrPrnAmt><ns:votingAuthority><ns:Sole>7500</ns:Sole><ns:Shared>0</ns:Shared><ns:None>0</ns:None></ns:votingAuthority></ns:infoTable></informationTable>`);
  assert.deepEqual(rows[0], { cusip: '123456789', issuer: 'ACME & CO', title: 'COM', ticker: '', shares: 7500, amountType: 'SH', value: 1200456, weight: 0, putCall: '', discretion: '', sole: 7500, shared: 0, noneVotes: 0 });
});

test('rejects malformed required SEC amounts', () => {
  assert.throws(() => parse13F('<informationTable><infoTable><nameOfIssuer>ACME</nameOfIssuer><cusip>123456789</cusip><value>not-a-number</value><shrsOrPrnAmt><sshPrnamt>75</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>'), /Invalid SEC value/);
  assert.throws(() => parse13F('<informationTable><infoTable><nameOfIssuer>ACME</nameOfIssuer><cusip>123456789</cusip><value>1200</value><shrsOrPrnAmt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>'), /Invalid SEC sshPrnamt/);
});

test('parses quoted ARK CSV fields', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n')[1], ['x, y', '2']);
  const parsed = parseArk('date,fund,company,ticker,cusip,shares,market value ($),weight (%)\n08/28/2026,ARKK,"ACME, INC",ACME,123456789,"1,200","$4,567.89",5.25%\n"Legal disclosure footer"\n');
  assert.equal(parsed.reportDate, '08/28/2026');
  assert.equal(parsed.fund, 'ARKK');
  assert.equal(parsed.positions[0].amountType, 'SH');
  assert.equal(parsed.positions[0].value, 4568);
  assert.equal(parsed.positions[0].shares, 1200);
  assert.equal(arkPositionDate('09/01/2026'), '2026-08-31');
  assert.equal(arkPositionDate('08/31/2026'), '2026-08-28');
  assert.throws(() => parseArk('date,fund,company,ticker,cusip,shares,market value ($),weight (%)\n08/28/2026,ARKK,ACME,ACME,123456789,1,2,50\n08/28/2026,ARKG,BETA,BETA,987654321,1,2,50\n'), /mixes dates or funds/);
});

test('selects an information table when SEC primaryDocument contains an XSL path', () => {
  const files = [{ name: 'primary_doc.xml' }, { name: 'renaissance13Fq22026_holding.xml' }];
  assert.equal(pickInfoTableFile(files, 'xslForm13F_X02/primary_doc.xml')?.name, 'renaissance13Fq22026_holding.xml');
});

test('aggregates repeated 13F lines for one security without losing shares or value', () => {
  const base = { cusip: '123456789', issuer: 'ACME', title: 'COM', ticker: '', amountType: 'SH', weight: 0, putCall: '', discretion: 'SOLE', shared: 0, noneVotes: 0 };
  const rows = aggregatePositions([{ ...base, shares: 10, value: 100, sole: 10 }, { ...base, shares: 25, value: 300, sole: 25 }, { ...base, amountType: 'PRN', shares: 50, value: 50, sole: 0 }]);
  assert.equal(rows.length, 2);
  assert.deepEqual({ shares: rows[0].shares, value: rows[0].value, sole: rows[0].sole }, { shares: 35, value: 400, sole: 35 });
});

test('normalizes filing and market issuer names to the same key', () => {
  assert.equal(normalizeIssuer('APPLE INC'), normalizeIssuer('Apple Inc. Common Stock'));
  assert.equal(normalizeIssuer('COCA COLA CO'), normalizeIssuer('Coca-Cola Company Common Stock'));
});

test('validates CUSIPs against the SEC fixed-width list', () => {
  assert.deepEqual([...parse13fCusips('B38564108*CMB.TECH NV\n02079K107 ALPHABET INC\ninvalid\n')], ['B38564108', '02079K107']);
});

test('detects only strong whole-filing evidence of a post-2023 thousand-dollar unit anomaly', () => {
  const base = { issuer: 'ACME', title: 'COM', ticker: '', amountType: 'SH', weight: 0, putCall: '', discretion: '', sole: 0, shared: 0, noneVotes: 0 };
  const anomalous = Array.from({ length: 5 }, (_, i) => ({ ...base, cusip: String(i), shares: 1000, value: 350 }));
  const normal = anomalous.map((row) => ({ ...row, value: 350_000 }));
  assert.equal(secValueMultiplier(anomalous, '2022-12-31'), 1000);
  assert.equal(secValueMultiplier(anomalous, '2026-08-14'), 1000);
  assert.equal(secValueMultiplier(normal, '2026-08-14'), 1);
});

test('reconciles the information table against the official 13F cover summary', () => {
  const rows = parse13F(`<informationTable><infoTable><nameOfIssuer>ACME</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>123456789</cusip><value>1200</value><shrsOrPrnAmt><sshPrnamt>75</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable></informationTable>`);
  const cover = parse13FCover('<summaryPage><otherIncludedManagersCount>0</otherIncludedManagersCount><tableEntryTotal>1</tableEntryTotal><tableValueTotal>1,200</tableValueTotal></summaryPage>');
  assert.deepEqual(validate13FCover(rows, cover), { positionsCount: 1, totalValue: 1200, valueDifference: 0 });
  assert.equal(validate13FCover(rows, { positionsCount: 1, totalValue: 1195 }).valueDifference, 5);
  assert.throws(() => validate13FCover(rows, { positionsCount: 1, totalValue: 1189 }), /cover mismatch/);
  assert.throws(() => validate13FCover(rows, { positionsCount: 2, totalValue: 1200 }), /cover mismatch/);
});

test('reads the reporting entities named by an official 13F notice', () => {
  const notice = parse13FNotice('<otherManagersInfo><otherManager><cik>933478</cik><name>VANGUARD FIDUCIARY TRUST CO</name></otherManager></otherManagersInfo>');
  assert.deepEqual(notice.otherManagers, [{ cik: '0000933478', name: 'VANGUARD FIDUCIARY TRUST CO' }]);
});
