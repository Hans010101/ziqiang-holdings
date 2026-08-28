import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('详情页切换回到顶部并使用三张独立人物图', () => {
  assert.match(app, /scrollTo\(\{top:0,behavior:'auto'\}\)/);
  for (const image of ['duan-yongping.png', 'warren-buffett.png', 'cathie-wood.png']) assert.match(app, new RegExp(image));
  assert.doesNotMatch(app, /investor-trio/);
});
