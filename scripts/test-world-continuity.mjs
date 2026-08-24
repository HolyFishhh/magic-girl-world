import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const stat = {
  status: { location: '白木市（旧天文台）' },
  factions: { invasion: 3 },
  npcs: {
    zeta: { name: '泽塔', tracking: false, current_action: '不会进入提示' },
    elara: { name: '艾拉', tracking: true, current_action: '正在调查失踪者留下的月纹' },
    aria: { name: '阿莉亚', tracking: true, current_action: '守在结界入口' },
    passerby: { name: '路人', tracking: false, current_action: '路过' },
  },
};
assert.deepEqual(core.summarizeWorldContinuity(stat), {
  location: '白木市（旧天文台）',
  invasion: 3,
  trackedNpcs: [
    { id: 'aria', name: '阿莉亚', currentAction: '守在结界入口' },
    { id: 'elara', name: '艾拉', currentAction: '正在调查失踪者留下的月纹' },
  ],
});
assert.equal(
  core.formatWorldContinuityHint(stat),
  '[世界连续性] 地点“白木市（旧天文台）”；长期威胁3/7；承接人物 阿莉亚[aria]：守在结界入口；艾拉[elara]：正在调查失踪者留下的月纹',
);
assert.equal(core.formatWorldContinuityHint({}), null);
assert.equal(core.summarizeWorldContinuity({ factions: { invasion: 9 } }).invasion, null);
assert.ok(core.formatWorldContinuityHint(stat).length < 180, 'route continuity hints remain bounded');

console.log('World continuity reuses bounded location, threat, and tracked-NPC facts without a second save.');
