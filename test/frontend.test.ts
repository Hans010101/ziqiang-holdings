import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('全部机构都有独立肖像资产且详情页切换回到顶部', () => {
  assert.match(app, /scrollTo\(\{top:0,behavior:'auto'\}\)/);
  const generated = ['icahn','scion','himalaya','altimeter','bridgewater','pershing-square','appaloosa','baupost','third-point','soros','greenlight','tiger-global','lone-pine','viking','elliott','citadel','millennium','point72','renaissance','de-shaw','bank-of-america','blackrock','fidelity','goldman-sachs','jpmorgan','morgan-stanley','state-street','t-rowe-price','ubs','vanguard'];
  for (const id of generated) assert.ok(existsSync(new URL(`../public/assets/${id}.jpg`, import.meta.url)), `${id} 缺少肖像`);
  for (const image of ['duan-yongping.png', 'warren-buffett.png', 'cathie-wood.png']) assert.ok(existsSync(new URL(`../public/assets/${image}`, import.meta.url)), `${image} 不存在`);
  assert.match(app, /generatedPortraitIds/);
  assert.doesNotMatch(app, /investor-trio/);
});
