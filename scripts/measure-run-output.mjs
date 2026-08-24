import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const root = resolve('worldbook_new');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const entryConfig = JSON.parse(await readFile(resolve(root, 'entry-config.json'), 'utf8'));
const sources = new Map(
  await Promise.all(
    Object.entries(manifest).map(async ([name, file]) => [name, await readFile(resolve(root, file), 'utf8')]),
  ),
);
const worldbook = [...sources.values()].join('\n');
const alwaysOnWorldbook = [...sources.entries()]
  .filter(([name]) => entryConfig[name]?.constant !== false && entryConfig[name]?.enabled !== false)
  .map(([, content]) => content)
  .join('\n');
const startWorldbook = [...sources.entries()]
  .filter(([name]) => entryConfig[name]?.enabled !== false)
  .filter(([name]) => entryConfig[name]?.constant !== false || entryConfig[name]?.keys?.includes('[开始游戏]'))
  .map(([, content]) => content)
  .join('\n');
const repairWorldbook = [...sources.entries()]
  .filter(([name]) => entryConfig[name]?.enabled !== false)
  .filter(([name]) => entryConfig[name]?.constant !== false || entryConfig[name]?.keys?.includes('[战斗内容修复]'))
  .map(([, content]) => content)
  .join('\n');
const battleRepairWorldbook = [...sources.entries()]
  .filter(([name]) => entryConfig[name]?.enabled !== false)
  .filter(([name]) => entryConfig[name]?.constant !== false || entryConfig[name]?.keys?.includes('[战斗场景修复]'))
  .map(([, content]) => content)
  .join('\n');

const route = { act: 1, floor: 4, kind: 'elite', danger: 2, nodeId: 'a1_f4_elite_7_1' };
const routeDirection = core.formatRunNodeDirection(
  { id: route.nodeId, kind: route.kind, act: route.act, floor: route.floor, danger: route.danger },
  42,
);
const worldContinuity = core.formatWorldContinuityHint({
  status: { location: '白木市（旧天文台）' },
  factions: { invasion: 3 },
  npcs: { elara: { name: '艾拉', tracking: true, current_action: '正在调查失踪者留下的月纹' } },
});
const reward = kind =>
  `[奖励预算] ${core.formatBattleRewardBudget(core.recommendBattleRewardBudget({ ...route, kind }))}`;
const shopRoute = { act: 1, floor: 4, kind: 'shop', danger: 0, floorsPerAct: 10 };
const shop = `[商店预算] ${core.formatShopBudget(core.recommendShopBudget(shopRoute))}`;
const guidancePack = core.createContentPack({
  cards: [
    { id: 'strike', quantity: 5, effects: [{ damage: 8 }] },
    { id: 'guard', quantity: 5, effects: [{ block: 6 }] },
  ],
});
const guidanceBudget = core.summarizeBuildBudget(guidancePack, { hp: 63, maxHp: 80 });
const guidance = `[构筑建议] ${core.formatBuildGuidance(core.recommendBuildGuidance(guidancePack, guidanceBudget))}`;
const brokenInitial = core.assessInitialPlayerContent(
  core.createContentPack({
    cards: [
      {
        id: 'too_costly',
        name: '过载',
        type: 'Attack',
        rarity: 'Common',
        cost: 4,
        quantity: 2,
        effects: { damage: 8 },
      },
    ],
    statuses: [],
  }),
  { hp: 80, maxHp: 80, lust: 0, maxLust: 100, level: 1, exp: 0 },
);
const initialRepairPrompt = core.formatPlayerContentRepairPrompt(brokenInitial);
const battleRepairPrompt = core.formatBoundedContentRepairPrompt('[战斗场景修复]', [
  { path: 'battle.enemy.actions[0].effects.damage', code: 'UNKNOWN_VARIABLE' },
  { path: 'battle.enemy.action_config.probability.裂光', code: 'INVALID_WEIGHT' },
]);
const routeWithBuildBudget = core.formatRoutePrompt({
  node: { id: route.nodeId, kind: route.kind, act: route.act, floor: route.floor, danger: route.danger },
  runSeed: 42,
  worldContinuity: null,
  buildBudget: '[构筑摘要] deck=10 atk=24 def=12 heal=0 draw=0 energy=0 hp=63/80',
  enemyBudget: '[敌人预算] hp=72..120 hit=5..15',
});
const eventRoute = core.formatRoutePrompt({
  node: { id: 'a1_f3_event_4_0', kind: 'event', act: 1, floor: 3, danger: 0 },
  runSeed: 42,
  worldContinuity,
});
const samples = {
  worldbook_total: worldbook,
  worldbook_always_on: alwaysOnWorldbook,
  worldbook_start: startWorldbook,
  worldbook_repair: repairWorldbook,
  worldbook_battle_repair: battleRepairWorldbook,
  initial_content_repair_prompt: initialRepairPrompt,
  battle_scene_repair_prompt: battleRepairPrompt,
  route_marker: core.formatRoutePrompt({
    node: { id: route.nodeId, kind: route.kind, act: route.act, floor: route.floor, danger: route.danger },
    runSeed: 42,
  }),
  route_with_build_budget: routeWithBuildBudget,
  event_route_with_continuity: eventRoute,
  reward_normal: reward('battle'),
  reward_with_guidance: `${reward('battle')}\n${guidance}`,
  reward_elite: reward('elite'),
  reward_boss: reward('boss'),
  shop_budget: shop,
  shop_with_guidance: `${shop}\n${guidance}`,
  event_result: `_.set('run_result', null, {"node_id":"a1_f3_event_4_0","outcome":"cleared","gold":12,"hp":-8});`,
  simple_upgrade: `_.set('run_upgrade', null, {"card_id":"moon_slash","effects":[{"damage":10}]});`,
  complex_upgrade: `_.set('run_upgrade', null, {"card_id":"blood_guard","effects":[{"block":6},{"draw":1,"when":"self.hp < self.max_hp / 2"}]});`,
  persisted_run_not_prompted: JSON.stringify({
    schemaVersion: 1,
    seed: 42,
    rngCursor: 4,
    phase: 'awaiting_choice',
    act: 1,
    actCount: 3,
    floor: 3,
    floorsPerAct: 10,
    currentNode: null,
    choices: [
      { id: 'a1_f4_battle_4_0', kind: 'battle', act: 1, floor: 4, danger: 1 },
      { id: 'a1_f4_event_4_1', kind: 'event', act: 1, floor: 4, danger: 0 },
      { id: 'a1_f4_rest_4_2', kind: 'rest', act: 1, floor: 4, danger: 0 },
    ],
    gold: 119,
    nodeCounts: { battle: 2, elite: 0, event: 1, rest: 0, shop: 0, boss: 0 },
    lastNodeKind: 'event',
  }),
};

console.table(
  Object.entries(samples).map(([sample, text]) => ({
    sample,
    characters: text.length,
    o200kTokens: encode(text).length,
    scope:
      sample === 'worldbook_always_on'
        ? 'ordinary turn'
        : sample === 'worldbook_start'
          ? 'first generation only'
          : sample === 'worldbook_repair'
            ? 'repair turn only'
            : sample === 'worldbook_battle_repair'
              ? 'battle repair turn only'
              : sample === 'persisted_run_not_prompted'
                ? 'save only'
                : sample === 'worldbook_total'
                  ? 'all entries reference'
                  : 'matching node only',
  })),
);
