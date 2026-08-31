import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const securityNames = readFileSync(new URL('../migrations/0004_chinese_security_names.sql', import.meta.url), 'utf8');
const verification = readFileSync(new URL('../migrations/0006_filing_verification.sql', import.meta.url), 'utf8');

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

test('未获再分发授权的港交所抓取已停用', () => {
  assert.match(verification, /DELETE FROM regulatory_disclosures/);
  assert.doesNotMatch(worker, /FROM regulatory_disclosures/);
  assert.doesNotMatch(app, /其他市场权益披露/);
  assert.match(`${app}\n${worker}`, /香港交易所[\s\S]{0,160}授权/);
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
