import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const securityNames = readFileSync(new URL('../migrations/0004_chinese_security_names.sql', import.meta.url), 'utf8');
const verification = readFileSync(new URL('../migrations/0006_filing_verification.sql', import.meta.url), 'utf8');
const multimarket = readFileSync(new URL('../migrations/0007_multimarket_disclosures.sql', import.meta.url), 'utf8');

function workerFunction(name: string) {
  const start = worker.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} 函数不存在`);
  const end = worker.indexOf('\nasync function ', start + 1);
  return worker.slice(start, end === -1 ? worker.length : end);
}

test('全部机构都有独立肖像资产且详情页切换回到顶部', () => {
  assert.match(app, /scrollTo\(\{top:0,behavior:'auto'\}\)/);
  const generated = ['icahn','scion','himalaya','altimeter','bridgewater','pershing-square','appaloosa','baupost','third-point','soros','greenlight','tiger-global','lone-pine','viking','elliott','citadel','millennium','point72','renaissance','de-shaw','bank-of-america','blackrock','fidelity','goldman-sachs','jpmorgan','morgan-stanley','state-street','t-rowe-price','ubs','vanguard'];
  for (const id of generated) assert.ok(existsSync(new URL(`../public/assets/${id}.jpg`, import.meta.url)), `${id} 缺少肖像`);
  for (const image of ['duan-yongping.png', 'warren-buffett.png', 'cathie-wood.png']) assert.ok(existsSync(new URL(`../public/assets/${image}`, import.meta.url)), `${image} 不存在`);
  assert.match(app, /generatedPortraitIds/);
  assert.doesNotMatch(app, /investor-trio/);
});

test('机构列表整行可访问并展示关键组合摘要', () => {
  assert.match(app, /<a class="manager-row" href="#\/manager\//);
  assert.match(app, /前三大普通股/);
  assert.match(app, /前十集中度/);
  assert.doesNotMatch(app, /class="row-action"/);
});

test('证券中文常用名统一展示并保留英文申报名', () => {
  assert.match(securityNames, /CREATE TABLE security_names/);
  assert.match(securityNames, /\('AAPL','苹果'\)/);
  assert.match(securityNames, /\('722304102','拼多多'\)/);
  assert.match(app, /const securityName =/);
  assert.match(app, /中文名称与行业用于辅助阅读/);
  assert.match(app, /\$\{esc\(r\.issuer\)\} · \$\{esc\(r\.cusip\)\}/);
});

test('港股与A股披露使用独立文档和权益行模型', () => {
  assert.match(multimarket, /CREATE TABLE(?: IF NOT EXISTS)? disclosure_documents/i);
  assert.match(multimarket, /CREATE TABLE(?: IF NOT EXISTS)? ownership_rows/i);
  assert.match(multimarket, /threshold_interest_event/);
  assert.match(multimarket, /top10_shareholders/);
  assert.match(multimarket, /泡泡玛特[\s\S]{0,300}09992|09992[\s\S]{0,300}泡泡玛特/);
  assert.match(multimarket, /\('CNINFO-[^']+','A股'/);
  assert.match(multimarket, /https:\/\/(?:[\w-]+\.)?cninfo\.com\.cn\//);
});

test('多市场披露拥有隔离接口和明确的非组合口径', () => {
  assert.match(worker, /\bFROM\s+disclosure_documents\b/i);
  assert.match(worker, /\b(?:FROM|JOIN)\s+ownership_rows\b/i);
  assert.match(worker, /['"]\/api\/disclosures['"]/);
  assert.match(app, /港股与A股公开披露/);
  assert.match(app, /不是完整组合/);
});

test('组合统计继续只使用申报与持仓表', () => {
  const portfolioCode = [
    worker.slice(worker.indexOf('const verifiedLatestCte'), worker.indexOf('async function summary')),
    ...['summary', 'managers', 'managerDetail', 'stocks', 'stockDetail', 'compare', 'exportCsv', 'feed'].map(workerFunction),
  ].join('\n');
  assert.match(portfolioCode, /\bFROM\s+filings\b/i);
  assert.match(portfolioCode, /\b(?:FROM|JOIN)\s+positions\b/i);
  assert.doesNotMatch(portfolioCode, /\b(?:FROM|JOIN)\s+(?:disclosure_documents|ownership_rows)\b/i);
});

test('普通股共识与其他证券类型、原始金额口径分开', () => {
  assert.match(verification, /amount_type TEXT NOT NULL DEFAULT 'SH'/);
  assert.match(verification, /declared_raw_total_value/);
  assert.match(verification, /value_multiplier/);
  assert.match(worker, /amount_type\s*=\s*'SH'/);
  assert.match(worker, /put_call\s*=\s*''/);
  assert.match(worker, /amount_type/);
  assert.match(app, /证券类型/);
});
