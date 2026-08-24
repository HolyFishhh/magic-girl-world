import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const {
  compactCardForUpgrade,
  formatEventSelectionContext,
  formatOptionPrompt,
  formatRestUpgradePrompt,
  formatRoutePrompt,
} = require(resolve('src/game-core/index.ts'));

assert.equal(formatEventSelectionContext(null), '');
assert.equal(formatEventSelectionContext({ id: 'a1_f3_battle_1_0', kind: 'battle' }), '');
assert.equal(
  formatEventSelectionContext({ id: 'a1_f3_event_1_0', kind: 'event' }),
  '\n[事件选择] node_id=a1_f3_event_1_0\n非战斗结局写 run_result；node_id 保持不变，outcome 只用 cleared/failed/escaped，gold/hp 用实际 JSON 整数变化量且无变化时省略。',
);

const battleNode = { id: 'a1_f4_elite_7_1', kind: 'elite', act: 1, floor: 4, danger: 2 };
const battleRoute = formatRoutePrompt({
  node: battleNode,
  runSeed: 42,
  worldContinuity: '[世界连续性] 地点“白木市”；长期威胁3/7',
  buildBudget: '[构筑摘要] deck=10 atk=24 def=12 heal=0 draw=0 energy=0 hp=63/80',
  enemyBudget: '[敌人预算] hp=72..120 hit=5..15',
  pending: '[已获得] 月轮斩',
});
assert.match(battleRoute, /^\[路线节点\] act=1 floor=4 kind=elite danger=2 node_id=a1_f4_elite_7_1\n/);
assert.match(battleRoute, /\n\[世界连续性\] 地点“白木市”；长期威胁3\/7\n\[构筑摘要\]/);
assert.match(battleRoute, /\n\[构筑摘要\].*\n\[敌人预算\].*\n\[已获得\] 月轮斩\n\[开始战斗\]$/);
assert.doesNotMatch(battleRoute, /\[商店生成\]/);

const shopNode = { id: 'a2_f6_shop_12_0', kind: 'shop', act: 2, floor: 6, danger: 0 };
const shopRoute = formatRoutePrompt({
  node: shopNode,
  runSeed: 42,
  shopBudget: '[商店预算] cards=3 artifacts=1 items=2',
  buildGuidance: '[构筑建议] need=防御 roles=补短板,强联动,转方向',
});
assert.match(shopRoute, /\n\[商店生成\]\n\[商店预算\].*\n\[构筑建议\].*$/);
assert.doesNotMatch(shopRoute, /\[开始战斗\]/);

const eventRoute = formatRoutePrompt({
  node: { id: 'a1_f3_event_4_0', kind: 'event', act: 1, floor: 3, danger: 0 },
  runSeed: 42,
  worldContinuity: '[世界连续性] 地点“白木市”；承接人物 艾拉[elara]：调查月纹',
});
assert.match(eventRoute, /\n\[世界连续性\] 地点“白木市”；承接人物 艾拉\[elara\]：调查月纹$/);

assert.equal(
  formatOptionPrompt({ optionText: '继续调查', battle: false, node: { id: 'a1_f3_event_1_0', kind: 'event' } }),
  '用户的选择是：继续调查\n[事件选择] node_id=a1_f3_event_1_0\n非战斗结局写 run_result；node_id 保持不变，outcome 只用 cleared/failed/escaped，gold/hp 用实际 JSON 整数变化量且无变化时省略。',
);
assert.equal(
  formatOptionPrompt({
    optionText: '拔剑迎战',
    battle: true,
    node: { id: 'a1_f3_event_1_0', kind: 'event' },
    pending: '[已获得] 星尘',
    buildBudget: '[构筑摘要] deck=10 atk=20',
  }),
  '用户选择了战斗选项：拔剑迎战\n[事件选择] node_id=a1_f3_event_1_0\n非战斗结局写 run_result；node_id 保持不变，outcome 只用 cleared/failed/escaped，gold/hp 用实际 JSON 整数变化量且无变化时省略。\n\n[已获得] 星尘\n[构筑摘要] deck=10 atk=20\n\n[开始战斗]',
);

const upgradePrompt = formatRestUpgradePrompt({
  node: { id: 'a1_f5_rest_2_0', kind: 'rest' },
  card: {
    id: 'guard',
    name: '守护',
    type: 'Skill',
    rarity: 'Common',
    cost: 1,
    effects: [{ block: 5 }],
    description: '不应重复发送给 AI',
    quantity: 3,
    runtimeId: 'host-only',
  },
});
assert.match(upgradePrompt, /^\[营火升级\] node_id=a1_f5_rest_2_0\n/);
assert.match(upgradePrompt, /"id":"guard","name":"守护","cost":1,"effects":\[\{"block":5\}\]/);
const upgradeCardLine = upgradePrompt.split('\n')[1];
assert.doesNotMatch(upgradeCardLine, /description|quantity|runtimeId|rarity|"type"/);
assert.match(upgradePrompt, /node_id="a1_f5_rest_2_0"/);
assert.deepEqual(compactCardForUpgrade({ id: 'x', innate: true, ignored: 1 }), { id: 'x', innate: true });
assert.throws(() => compactCardForUpgrade({ name: 'missing id' }), /stable id/);
assert.throws(
  () => formatRestUpgradePrompt({ node: { id: 'battle', kind: 'battle' }, card: { id: 'x' } }),
  /active rest node/,
);

console.log('One portable route, option, and campfire-upgrade prompt contract serves every host.');
