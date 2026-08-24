import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createRunPacingContext, formatRunNodeDirection, recommendRunNodePacing } = require(
  resolve('src/game-core/index.ts'),
);

const node = { id: 'a1_f3_event_4_0', kind: 'event', act: 1, floor: 3, danger: 0 };
assert.equal(formatRunNodeDirection(node, 42), formatRunNodeDirection(node, 42));
assert.match(
  formatRunNodeDirection(node, 42),
  /^围绕“.+”生成短事件；选择应体现.+。机制侧重“.+”。节奏：中段形成联动，明确取舍。章线：建立威胁与关键关系。$/,
);
assert.match(formatRunNodeDirection({ ...node, id: 'a1_f4_shop_5_0', kind: 'shop' }, 42), /价格由程序决定/);
assert.match(formatRunNodeDirection(node, 42), /机制侧重“(?:生命换收益|金币换成长|卡牌改造|遗物代价|路线情报)”/);
const varied = new Set(
  Array.from({ length: 20 }, (_, floor) =>
    formatRunNodeDirection({ ...node, id: `a1_f${floor}_event_${floor}_0`, floor }, 42),
  ),
);
assert.ok(varied.size >= 4, 'seeded event directions should not collapse into one repeated prompt');

const run = {
  actCount: 3,
  floorsPerAct: 10,
  nodeCounts: { battle: 3, elite: 0, event: 2, rest: 1, shop: 0, boss: 0 },
  lastNodeKind: 'battle',
};
const lateEvent = { ...node, id: 'a3_f8_event_20_0', act: 3, floor: 8 };
const pacing = recommendRunNodePacing(createRunPacingContext(lateEvent, run));
assert.deepEqual(pacing, {
  phase: 'pressure',
  intensity: 4,
  repeatCount: 2,
  eventCost: 'high',
  shopTier: 'none',
  rewardTier: 'enhanced',
  storyBeat: 'resolution',
});
assert.match(formatRunNodeDirection(lateEvent, 42, run), /高价值高代价/);
assert.match(formatRunNodeDirection(lateEvent, 42, run), /回收伏笔，推进最终决战/);
assert.match(formatRunNodeDirection(lateEvent, 42, run), /叙事身份与此前同类节点区分，机制允许复用/);

const early = recommendRunNodePacing({ ...createRunPacingContext(node, run), act: 1, floor: 1 });
const laterActOpening = recommendRunNodePacing({ ...createRunPacingContext(node, run), act: 2, floor: 1 });
assert.equal(early.eventCost, 'light');
assert.equal(laterActOpening.eventCost, 'tradeoff', 'later Acts must not reset event costs to tutorial strength');

console.log('One deterministic pacing contract drives Act, floor, repetition, and natural-language direction.');
