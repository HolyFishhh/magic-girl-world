import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const tower = require('../src/game-core/towerRequest.ts');
const enemyActions = require('../src/game-core/enemyActionSelector.ts');

const job = {
  nodeId: 'act-1-floor-2-col-0',
  requestId: 'tower_1_1_test',
  basedOnRevision: 1,
  kind: 'battle',
  act: 1,
  floor: 2,
  // This broad transport suite also covers saved legacy single-enemy envelopes.
  // New generated jobs with contentSeed are covered by test-tower-encounter-plan.
  rewardSeed: 11,
  difficultyMultiplier: 1,
};
const budget = require('../src/game-core/contentBudget.ts').recommendTowerBattleRewardBudget(job);
const prompt = tower.formatTowerNodeGenerationPrompt(job, {
  worldContext: '当前世界与剧情摘要',
  playerContext: '玩家状态摘要',
  deckBalanceContext: '卡组评分与敌人数值范围',
  enemyLineageContext: '敌人谱系',
  customRequirements: '玩家偏好',
  difficultyPercent: 80,
});
assert.match(prompt, /只生成这个节点/);
assert.match(prompt, /reward 必须存在并预先给出本场胜利候选/);
assert.match(prompt, /爬塔没有经验值和等级成长/);
assert.match(prompt, /不得生成、修改或以任何叙事奖励形式承诺 level 或 exp/);
assert.match(prompt, /cards=3\/1/);
assert.match(prompt, /card:\[恰好3个卡牌对象\],artifact:\[恰好0个遗物对象\],item:\[恰好0个道具对象\]/);
assert.match(prompt, /0 项必须逐字写成空数组 \[\]/);
assert.match(prompt, /不得复制当前 reward 的 request、disabled_categories、pool_revision、reroll_count/);
assert.match(prompt, /已有非唯一卡的名称、类型、费用和可执行规则完全相同时可复用当前稳定 id/);
assert.match(prompt, /战斗效果结构边界/);
assert.match(prompt, /battle_start 是时机而非永久寿命/);
assert.match(prompt, /程序不按描述搬移机制或补造遗物/);
assert.match(prompt, /不输出旧 effect 或内部 spec\/op\/steps/);
assert.match(prompt, /不使用通用 operation\/target\/condition\/operator\/value\/amount\/source 包装/);
assert.match(prompt, /嵌套结构的合法字段以该操作契约为准/);
assert.match(prompt, /敌人 abilities 每项必须有稳定英文 id/);
assert.match(prompt, /narrate 不能出现在敌人 action、ability 或 lust_effect/);
assert.match(prompt, /actions 必须是至少一项的 JSON 数组/);
assert.match(prompt, /统一使用 enemies:\[敌人对象\]/);
assert.match(prompt, /escape_when:"条件公式"/);
assert.match(
  prompt,
  /defeat_reward:\{cards\?:完整卡牌数组,artifacts\?:完整遗物数组,items\?:完整道具数组,gold\?:非负整数\}/,
);
assert.match(prompt, /targets\.team 只能是 self 或 opponent，必须和 to 一致/);
assert.match(prompt, /优先使用该 action 的稳定英文 id/);
assert.match(prompt, /状态 triggers\.hold 只能放 modify\/出牌规则/);
assert.match(prompt, /系统没有任何按名称自动生效的内置状态/);
assert.match(prompt, /批量结果中的每个节点各自闭合/);
assert.match(prompt, /监听事件直接用triggers的对应事件键，不能嵌入hold/);
assert.match(prompt, /apply\/stack\/tick\/remove及事件键只承载一次性effects/);
assert.match(prompt, /事件开始冻结已有状态，本事件中新获得的状态不追溯响应/);
assert.match(prompt, /事件键不接受scope\/ordinal\/n\/event等结构化筛选/);
assert.match(prompt, /event\.damage_type.*attack\/effect\/hp_loss\/retaliation\/damage_over_time\/execute/);
assert.match(prompt, /作==或!=比较，不用于数值公式，不读取未公开的amount\/damage/);
assert.match(prompt, /\[流派与敌人创作方法\]/);
assert.match(prompt, /启动→运转→收益/);
assert.match(prompt, /召唤作为核心时必须真实使用 spawn_summon/);
assert.ok(prompt.includes('{modify_summon:{selector,stat,add/subtract/multiply/divide/set}}'));
assert.ok(prompt.includes('获得格挡用本体 stat:block'));
assert.ok(prompt.includes('伤害强化用输出 stat:damage'));
assert.match(prompt, /不存在 block_summon/);
assert.match(prompt, /spawn_summon 已经在自身对象内包含完整召唤定义/);
assert.ok(
  prompt.includes('| 召唤对敌人输出 | 召唤 actions/abilities 内普通 damage/lust/apply_status，不是 damage_summon |'),
);
assert.ok(
  prompt.includes('| 外部效果伤害/治疗召唤 | {damage_summon:{selector,amount}} / {heal_summon:{selector,amount}}'),
);
assert.match(prompt, /Attack\/Skill\/Event\/Curse 模板一律不写 trigger/);
assert.match(prompt, /模板内部也不能用 add_card\/ensure_card 引用自己/);
assert.match(prompt, /add_card:"模板ID",to\?:"hand"\|"deck"\|"discard"/);
assert.match(prompt, /discard 表示新实例直接进入弃牌堆，不算手牌弃牌/);
assert.match(prompt, /Curse 必须省略整个 cost（null 不是省略）/);
assert.match(prompt, /已有 discard_effects 也不能代替可打出的根 effects/);
assert.match(prompt, /draw\/scry\/seek 只操作玩家牌区/);
assert.match(prompt, /cost:"energy" 只会支付能量/);
assert.ok(prompt.includes('不能放 passive/hold，可由状态 apply/stack 执行'));
assert.match(prompt, /不存在 scope:"summon" 或 modify:"summon_damage"/);
assert.match(prompt, /状态自身 hold 中读取层数必须写裸 stacks/);
assert.match(prompt, /一个主压力与零到两个有因果协同的副机制/);
assert.match(prompt, /新爬塔战斗人数严格使用程序预定结果/);
assert.match(prompt, /单敌也要制造回合压力/);
assert.match(prompt, /每2至3回合蓄力兑现/);
assert.match(prompt, /易伤提高承受伤害，虚弱降低造成伤害，脆弱降低获得格挡/);
assert.match(prompt, /action_priority\/speed 只决定同一轮内谁先行动，不会自动交替回合/);
assert.match(prompt, /A施加标记后B从 opponent\.status/);
assert.match(prompt, /不要所有分支都复制单敌或同一支援组合/);
assert.match(prompt, /floor\/ceil\/abs\/min\/max 五个纯数学函数/);
assert.doesNotMatch(prompt, /```|<UpdateVariable>/);
assert.match(prompt, /只输出一个 JSON 对象/);

const completeMvuContext = JSON.stringify({
  stat_data: { padding: 'x'.repeat(3500) },
  mvu_tail_probe: 'LATEST_MVU_TAIL_IS_VISIBLE',
});
const completePrompt = tower.formatTowerNodeGenerationPrompt(job, {
  completeMvuContext,
  contentReferenceContext: '{"statuses":[{"id":"overcharged","name":"超载"}],"resources":[{"id":"stardust"}]}',
  worldContext: '不应重复的世界摘要',
  playerContext: '不应重复的玩家摘要',
  difficultyPercent: 80,
});
assert.match(completePrompt, /\[当前完整游戏事实\]/);
assert.match(completePrompt, /LATEST_MVU_TAIL_IS_VISIBLE/, 'latest MVU tail must not be cut at the old 1800 limit');
assert.match(completePrompt, /现有内容精确 ID 表/);
assert.match(completePrompt, /overcharged/);
assert.match(completePrompt, /逐字复制表内 ID/);
assert.doesNotMatch(completePrompt, /不应重复的世界摘要|不应重复的玩家摘要/);

const oversizedGameplayContext = JSON.stringify({
  battle: { cards: [{ id: 'context_probe', description: 'x'.repeat(40_000) }] },
  gameplay_tail: 'COMPLETE_GAMEPLAY_CONTEXT_TAIL',
});
const oversizedDesignContext = `${'评分机制'.repeat(2500)}-COMPLETE_BALANCE_CONTEXT_TAIL`;
const oversizedLineageContext = `${'谱系机制'.repeat(1000)}-COMPLETE_LINEAGE_CONTEXT_TAIL`;
const oversizedContextPrompt = tower.formatTowerNodeGenerationPrompt(job, {
  completeMvuContext: oversizedGameplayContext,
  deckBalanceContext: oversizedDesignContext,
  enemyLineageContext: oversizedLineageContext,
  difficultyPercent: 80,
});
assert.match(oversizedContextPrompt, /COMPLETE_GAMEPLAY_CONTEXT_TAIL/);
assert.match(oversizedContextPrompt, /COMPLETE_BALANCE_CONTEXT_TAIL/);
assert.match(oversizedContextPrompt, /COMPLETE_LINEAGE_CONTEXT_TAIL/);

const longCustomRequirements = `开头要求-${'保留玩法要求'.repeat(500)}-PLAYER_REQUIREMENT_TAIL`;
const completeRequirementPrompt = tower.formatTowerNodeGenerationPrompt(job, {
  worldContext: '世界摘要',
  playerContext: '玩家摘要',
  customRequirements: longCustomRequirements,
  difficultyPercent: 80,
});
assert.match(
  completeRequirementPrompt,
  /PLAYER_REQUIREMENT_TAIL/,
  'player-authored generation requirements must not be truncated as prompt optimization',
);

const battleReward = {
  card: [
    {
      id: 'reward_strike',
      name: '追击',
      type: 'Attack',
      rarity: 'Common',
      cost: 1,
      quantity: 1,
      effects: { damage: 7 },
    },
    { id: 'reward_guard', name: '守势', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 7 } },
    { id: 'reward_cycle', name: '轮转', type: 'Skill', rarity: 'Uncommon', cost: 1, quantity: 1, effects: { draw: 1 } },
  ],
  artifact: [{ id: 'should_be_trimmed', name: '普通战不应发放的遗物' }],
  item: [{ id: 'reward_salve', name: '星露药剂', count: 1, effects: { heal: 6 } }],
  limits: { cards: 3, artifacts: 1, items: 1 },
};
battleReward.card.forEach((card, index) => {
  card.rarity = budget.cards.slotRarities[index];
});
const validBattle = `<TOWER_NODE_RESULT>${JSON.stringify({
  spec: tower.TOWER_NODE_RESULT_SPEC,
  node_id: job.nodeId,
  request_id: job.requestId,
  based_on_revision: job.basedOnRevision,
  kind: job.kind,
  title: '遭遇',
  narrative: '短暂的敌意在道路前方凝聚。',
  payload: {
    battle: {
      enemy: {
        name: '敌人',
        hp: 40,
        max_hp: 40,
        lust: 0,
        max_lust: 100,
        actions: [{ name: '试探', effects: { damage: 6 } }],
      },
    },
  },
  reward: battleReward,
})}</TOWER_NODE_RESULT>`;
const parsedBattle = tower.parseTowerNodeResult(validBattle, job);
for (const duplicate of [
  validBattle.replace('"effects":{"damage":6}', '"effects":{"damage":6},"effects":{"block":4}'),
  validBattle.replace('"title":"遭遇"', '"title":"原值","\\u0074itle":"遭遇"'),
])
  assert.throws(
    () => tower.parseTowerNodeResult(duplicate, job),
    /重复/,
    'tagged parser must not hide duplicate authored fields',
  );
assert.throws(
  () => tower.parseTowerNodeResult(validBattle.replace('"damage":6', '"damage":'), job),
  /空值|缺失值/,
  'tagged punctuation recovery must not invent a missing effect value',
);
assert.equal(
  tower.parseTowerNodeResult(validBattle.replace('"damage":6', '"damage":6,'), job).title,
  '遭遇',
  'trailing comma remains recoverable without changing effect value',
);
assert.equal(parsedBattle.title, '遭遇');
assert.equal(parsedBattle.reward.card.length, 3);
assert.equal(parsedBattle.reward.artifact.length, 0, 'program budget removes forbidden normal-battle relics');
assert.equal(parsedBattle.reward.item.length, budget.items?.candidates || 0);
assert.deepEqual(parsedBattle.reward.limits, { cards: 1, artifacts: 0, items: budget.items?.pick || 0 });
assert.equal(
  tower.parseTowerNodeResult(`${validBattle}${validBattle}`, job).title,
  '遭遇',
  'identical provider echoes should collapse to one scoped result',
);
assert.equal(
  tower.parseTowerNodeResult(
    `\`\`\`json\n${validBattle.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length)}\n\`\`\``,
    job,
  ).title,
  '遭遇',
  'one unwrapped scoped JSON object should survive providers that strip XML tags',
);
const conflictingBattle = validBattle.replace('"遭遇"', '"另一个遭遇"');
assert.throws(
  () => tower.parseTowerNodeResult(`${validBattle}${conflictingBattle}`, job),
  /multiple different scoped blocks/,
);
assert.throws(
  () => tower.parseTowerNodeResult(validBattle.replace(job.requestId, 'stale'), job),
  /stale or mismatched/,
);
const missingActionEffects = validBattle.replace('"effects":{"damage":6}', '"description":"只有动作说明"');
assert.throws(
  () => tower.parseTowerNodeResult(missingActionEffects, job),
  /payload is invalid/,
  'battle nodes must reject enemies whose actions have no executable effects',
);
assert.throws(
  () => tower.parseTowerNodeResult(missingActionEffects, job),
  /payload\.battle\.enemy\.actions\[0\]\.effects/,
  'node parsing must preserve the exact invalid enemy path for the one bounded repair',
);
const mappedActionPayload = JSON.parse(validBattle.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length));
mappedActionPayload.payload.battle.enemy.actions = {
  strike: { id: 'strike', name: '突击', effects: { damage: 6 } },
};
delete mappedActionPayload.payload.battle.enemy.lust;
delete mappedActionPayload.payload.battle.enemy.max_lust;
assert.throws(
  () => tower.parseTowerNodeResult(JSON.stringify(mappedActionPayload), job),
  error =>
    /actions 必须是至少一项的数组/.test(error.message) &&
    /\.lust 必须是非负数/.test(error.message) &&
    /\.max_lust 必须是正数/.test(error.message),
  'enemy diagnostics must report both the object-map action shape and missing desire vitals',
);

const idReferencedActions = {
  action_mode: 'sequence_then_probability',
  actions: [
    { id: 'pierce', name: '穿刺', effects: { damage: 5 } },
    { id: 'guard', name: '防守', effects: { block: 4 } },
  ],
  action_config: {
    sequence: ['guard', 'pierce'],
    probability: { pierce: 3, guard: 1 },
  },
};
assert.deepEqual(
  enemyActions.normalizeEnemyActionSelectionInput(idReferencedActions).actionConfig,
  { sequence: ['防守', '穿刺'], probability: { 穿刺: 3, 防守: 1 } },
  'new stable action IDs and legacy visible names must resolve to one runtime action identity',
);
assert.equal(enemyActions.selectEnemyAction(idReferencedActions, () => 0).action.name, '防守');
const ownerIdMistakenForOnlyMissingAction = {
  id: 'mirror_soldier_a',
  name: '镜兵俑·左',
  action_mode: 'probability',
  actions: [
    { id: 'sweep_attack', name: '横扫', effects: { damage: 7 } },
    { id: 'reinforce_shell', name: '强化外壳', effects: { block: 5 } },
  ],
  action_config: { probability: { mirror_soldier_a: 60, reinforce_shell: 20 } },
};
assert.deepEqual(
  enemyActions.normalizeEnemyActionSelectionInput(ownerIdMistakenForOnlyMissingAction).actionConfig,
  { probability: { 强化外壳: 20, 横扫: 60 } },
  'an enemy id used as the sole invalid weight key maps to the sole uncovered action without guessing',
);
const uniquelyTruncatedActionId = {
  action_mode: 'probability',
  actions: [
    { id: 'mirror_swing', name: '镜刃横斩', effects: { damage: 6 } },
    { id: 'reflective_guard', name: '反射防御', effects: { block: 5 } },
  ],
  action_config: { probability: { mirror_swing: 3, reflect_guard: 2 } },
};
assert.deepEqual(
  enemyActions.normalizeEnemyActionSelectionInput(uniquelyTruncatedActionId).actionConfig,
  { probability: { 镜刃横斩: 3, 反射防御: 2 } },
  'one unknown weight key maps to the one uncovered action without fuzzy matching',
);
const ambiguousOwnerIdProbability = {
  ...ownerIdMistakenForOnlyMissingAction,
  actions: [...ownerIdMistakenForOnlyMissingAction.actions, { id: 'mirror_glare', name: '镜光', effects: { lust: 3 } }],
};
assert.deepEqual(
  enemyActions.normalizeEnemyActionSelectionInput(ambiguousOwnerIdProbability).actionConfig,
  { probability: { mirror_soldier_a: 60, 强化外壳: 20 } },
  'multiple uncovered actions remain invalid instead of being guessed by the normalizer',
);
const misplacedBattleMetadata = validBattle.replace('"battle":{', '"battle":{"act":1,');
assert.throws(
  () => tower.parseTowerNodeResult(misplacedBattleMetadata, job),
  /payload is invalid/,
  'program-owned metadata cannot be placed inside the generated battle patch',
);

const eventJob = { ...job, nodeId: 'event', requestId: 'event-request', kind: 'event' };
const eventText = `<TOWER_NODE_RESULT>${JSON.stringify({
  spec: tower.TOWER_NODE_RESULT_SPEC,
  node_id: eventJob.nodeId,
  request_id: eventJob.requestId,
  based_on_revision: eventJob.basedOnRevision,
  kind: 'event',
  title: '岔路事件',
  narrative: '道路旁出现了需要立即判断的异象。',
  payload: {
    event: {
      choices: [
        { id: 'observe', label: '观察', outcome: { gold: 5, lust: 7 } },
        { id: 'leave', label: '离开', outcome: {} },
      ],
    },
  },
})}</TOWER_NODE_RESULT>`;
assert.equal(tower.parseTowerNodeResult(eventText, eventJob).kind, 'event');
const eventWithResourceDeltaValue = JSON.parse(
  eventText.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length),
);
eventWithResourceDeltaValue.payload.event.choices[0].outcome.resources = { star_charge: 2 };
assert.deepEqual(
  tower.parseTowerNodeResult(JSON.stringify(eventWithResourceDeltaValue), eventJob).payload.event.choices[0].outcome
    .resources,
  { star_charge: 2 },
  'event outcomes preserve explicit registered-resource deltas for activation-time validation',
);
const eventWithRewardResourceValue = structuredClone(eventWithResourceDeltaValue);
eventWithRewardResourceValue.payload.event.choices[0].outcome.reward = { resources: { star_charge: 2 } };
assert.equal(
  tower.parseTowerNodeResult(JSON.stringify(eventWithRewardResourceValue), eventJob).kind,
  'event',
  'reward candidates are validated with the current player library at the activation boundary',
);
const invalidEventOutcome = eventText.replace('"gold":5', '"energy":2');
assert.throws(
  () => tower.parseTowerNodeResult(invalidEventOutcome, eventJob),
  /payload is invalid/,
  'event outcomes must reject fields that the program cannot settle',
);
const eventWithTopLevelRewardValue = JSON.parse(
  eventText.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length),
);
eventWithTopLevelRewardValue.reward = {
  cards: [],
  artifacts: [],
  items: [],
  limits: { cards: 0, artifacts: 0, items: 0 },
};
const eventWithTopLevelReward = `<TOWER_NODE_RESULT>${JSON.stringify(eventWithTopLevelRewardValue)}</TOWER_NODE_RESULT>`;
assert.throws(() => tower.parseTowerNodeResult(eventWithTopLevelReward, eventJob), /事件节点顶层不得写 reward/);
const eventWithEmptyTopLevelRewardValue = JSON.parse(
  eventText.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length),
);
eventWithEmptyTopLevelRewardValue.reward = {};
const eventWithEmptyTopLevelReward = tower.parseTowerNodeResult(
  `<TOWER_NODE_RESULT>${JSON.stringify(eventWithEmptyTopLevelRewardValue)}</TOWER_NODE_RESULT>`,
  eventJob,
);
assert.equal(
  eventWithEmptyTopLevelReward.reward,
  undefined,
  'empty event reward envelopes are removed without changing authored content',
);

const treasureJob = { ...job, nodeId: 'treasure', requestId: 'treasure-request', kind: 'treasure', floor: 1 };
const treasureReward = {
  cards: [],
  artifacts: [1, 2, 3].map(index => ({
    id: `treasure_core_${index}`,
    name: `星核${index}`,
    rarity: 'Common',
    trigger: { on: 'battle_start', effects: { energy: index } },
  })),
  items: [],
  limits: { cards: 0, artifacts: 1, items: 0 },
};
const treasureText = `<TOWER_NODE_RESULT>${JSON.stringify({
  spec: tower.TOWER_NODE_RESULT_SPEC,
  node_id: treasureJob.nodeId,
  request_id: treasureJob.requestId,
  based_on_revision: treasureJob.basedOnRevision,
  kind: 'treasure',
  title: '星核宝箱',
  narrative: '尘封箱盖打开，星核在其中发亮。',
  payload: { treasure: {} },
  reward: treasureReward,
})}</TOWER_NODE_RESULT>`;
assert.equal(tower.parseTowerNodeResult(treasureText, treasureJob).kind, 'treasure');
const overlargeEmptyTreasureLimit = treasureText.replace(
  JSON.stringify(treasureReward),
  JSON.stringify({
    ...treasureReward,
    artifacts: [],
    items: [{ id: 'tonic', name: '药剂', count: 1, effects: { heal: 3 } }],
    limits: { cards: 0, artifacts: 1, items: 1 },
  }),
);
assert.throws(
  () => tower.parseTowerNodeResult(overlargeEmptyTreasureLimit, treasureJob),
  /宝箱 reward\.artifacts 必须恰好包含 3 项|宝箱 reward\.items 必须为空数组/,
  'a treasure cannot substitute items or a second selectable category for its relic choices',
);
const treasureWithChoices = treasureText.replace(
  JSON.stringify(treasureReward),
  JSON.stringify({ choices: [{ id: 'take', outcome: { gold: 10 } }] }),
);
assert.throws(
  () => tower.parseTowerNodeResult(treasureWithChoices, treasureJob),
  /宝箱 reward 不支持字段 choices/,
  'a treasure is a direct candidate pool rather than an event choice wrapper',
);
const emptyTreasure = treasureText.replace(
  JSON.stringify(treasureReward),
  JSON.stringify({ cards: [], artifacts: [], items: [], limits: { cards: 0, artifacts: 0, items: 0 } }),
);
assert.throws(() => tower.parseTowerNodeResult(emptyTreasure, treasureJob), /artifacts 必须恰好包含 3 项/);

const shopJob = { ...job, nodeId: 'shop', requestId: 'shop-request', kind: 'shop', floor: 2 };
const shopReward = {
  cards: [
    { id: 'shop_strike', name: '星击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 6 } },
    { id: 'shop_guard', name: '星盾', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 6 } },
  ],
  artifacts: [
    { id: 'shop_core', name: '商店星核', rarity: 'Common', trigger: { on: 'battle_start', effects: { energy: 1 } } },
  ],
  items: [{ id: 'shop_salve', name: '商店药剂', count: 1, effects: { heal: 6 } }],
  limits: { cards: 2, artifacts: 1, items: 1 },
};
for (let i = 2; i < 5; i++) shopReward.cards.push({ ...shopReward.cards[0], id: 'extra_shop_card_' + i });
shopReward.artifacts.push({ ...shopReward.artifacts[0], id: 'extra_shop_relic' });
shopReward.items.push({ ...shopReward.items[0], id: 'extra_shop_item' });
shopReward.limits = { cards: 5, artifacts: 2, items: 2 };
const shopText = `<TOWER_NODE_RESULT>${JSON.stringify({
  spec: tower.TOWER_NODE_RESULT_SPEC,
  node_id: shopJob.nodeId,
  request_id: shopJob.requestId,
  based_on_revision: shopJob.basedOnRevision,
  kind: 'shop',
  title: '星尘商铺',
  narrative: '商人把商品整齐摆上柜台。',
  payload: { shop: {} },
  reward: shopReward,
})}</TOWER_NODE_RESULT>`;
assert.equal(tower.parseTowerNodeResult(shopText, shopJob).kind, 'shop');
const shortShop = shopText.replace(JSON.stringify(shopReward.cards), JSON.stringify(shopReward.cards.slice(0, 1)));
assert.throws(() => tower.parseTowerNodeResult(shortShop, shopJob), /reward\.cards 必须恰好包含 5 项/);

const openingInput = {
  requestId: 'opening-1',
  basedOnRevision: 0,
  seed: 7,
  context: { worldContext: '世界', playerContext: '玩家', difficultyPercent: 100 },
};
const openingPrompt = tower.formatTowerOpeningGenerationPrompt(openingInput);
assert.match(openingPrompt, /固定提供三个彼此独立的中文选择/);
assert.match(openingPrompt, /馈赠可提供已有非唯一卡的完全相同副本/);
assert.match(openingPrompt, /\[流派与敌人创作方法\]/);
const completeOpeningPrompt = tower.formatTowerOpeningGenerationPrompt({
  ...openingInput,
  context: { completeMvuContext, difficultyPercent: 100 },
});
assert.match(completeOpeningPrompt, /LATEST_MVU_TAIL_IS_VISIBLE/);
const openingText = `<TOWER_OPENING_RESULT>${JSON.stringify({
  spec: tower.TOWER_OPENING_RESULT_SPEC,
  request_id: openingInput.requestId,
  based_on_revision: 0,
  title: '旅途开始',
  narrative: '某个与世界相符的存在在旅途起点等待。',
  choices: [
    { id: 'gift', label: '接受馈赠', outcome: { reward: {} } },
    { id: 'trade', label: '承担代价', outcome: { hp: -5, reward: {} } },
    { id: 'prepare', label: '整备行装', outcome: { gold: 20 } },
  ],
})}</TOWER_OPENING_RESULT>`;
assert.equal(tower.parseTowerOpeningResult(openingText, openingInput).choices.length, 3);
assert.equal(
  tower.parseTowerOpeningResult(
    openingText.slice('<TOWER_OPENING_RESULT>'.length, -'</TOWER_OPENING_RESULT>'.length),
    openingInput,
  ).choices.length,
  3,
);
const missingCommaOpening = openingText.replace('"旅途开始","narrative"', '"旅途开始""narrative"');
assert.equal(
  tower.parseTowerOpeningResult(missingCommaOpening, openingInput).choices.length,
  3,
  'transport-only JSON punctuation mistakes should be repaired without another model call or changing gameplay data',
);
const openingSchema = tower.createTowerOpeningJsonSchema().value;
assert.equal(openingSchema.properties.spec.const, tower.TOWER_OPENING_RESULT_SPEC);
assert.equal(openingSchema.properties.choices.minItems, 3);
assert.equal(openingSchema.properties.choices.maxItems, 3);
assert.equal(openingSchema.$defs.mwgRewardArtifact.properties.statuses.type, 'array');
assert.equal(openingSchema.$defs.mwgRewardArtifact.properties.statuses.minItems, 1);
assert.equal(openingSchema.$defs.mwgRewardArtifact.properties.statuses.maxItems, 16);
assert.equal(openingSchema.$defs.mwgRewardArtifact.properties.statuses.items.$ref, '#/$defs/mwgStatusDefinition');
assert.equal(openingSchema.$defs.mwgRewardArtifact.properties.status.$ref, '#/$defs/mwgStatusDefinition');
const tooFewOpeningChoices = JSON.parse(
  openingText.slice('<TOWER_OPENING_RESULT>'.length, -'</TOWER_OPENING_RESULT>'.length),
);
tooFewOpeningChoices.choices = tooFewOpeningChoices.choices.slice(0, 1);
assert.throws(
  () => tower.parseTowerOpeningResult(JSON.stringify(tooFewOpeningChoices), openingInput),
  /opening\.choices：需要恰好 3 项，实际为 1 项/,
  'opening diagnostics must identify the exact choice count instead of returning one generic error',
);
const battleSchema = tower.createTowerNodeJsonSchema('battle', {
  nodeId: job.nodeId,
  act: job.act,
  floor: job.floor,
}).value;
assert.equal(battleSchema.properties.kind.const, 'battle');
assert.ok(battleSchema.required.includes('reward'));
assert.deepEqual(battleSchema.properties.payload.required, ['battle']);
assert.equal(battleSchema.properties.payload.properties.battle.additionalProperties, false);
assert.equal(battleSchema.properties.reward.additionalProperties, false);
assert.deepEqual(battleSchema.properties.reward.required, ['card', 'artifact', 'item', 'limits']);
assert.equal(battleSchema.properties.reward.properties.card.minItems, 3);
assert.equal(battleSchema.properties.reward.properties.card.maxItems, 3);
assert.equal(battleSchema.properties.reward.properties.artifact.maxItems, 0);
assert.equal(battleSchema.properties.reward.properties.item.minItems, 1);
assert.equal(battleSchema.properties.reward.properties.limits.properties.cards.const, 1);
assert.deepEqual(Object.keys(battleSchema.properties.reward.properties.limits.properties), [
  'cards',
  'artifacts',
  'items',
]);
const battleEnemySchema = battleSchema.$defs.mwgEnemy;
const battleEnemyActionSchema = battleSchema.$defs.mwgEnemyAction;
const battleAbilitySchema = battleSchema.$defs.mwgAbility;
assert.deepEqual(battleEnemyActionSchema.required, ['name', 'effects']);
assert.deepEqual(battleAbilitySchema.required, ['id', 'name', 'trigger']);
assert.deepEqual(battleSchema.$defs.mwgAbilityTrigger.oneOf[0].required, ['on', 'effects']);
assert.equal(battleEnemySchema.properties.id.pattern, '^[A-Za-z_][A-Za-z0-9_]*$');
assert.ok(battleEnemySchema.required.includes('id'), 'multi-enemy roster entries require runtime-safe stable IDs');
assert.deepEqual(battleSchema.$defs.mwgStatusDefinition.required, ['id', 'name', 'emoji', 'type', 'triggers']);
const eventSchema = tower.createTowerNodeJsonSchema('event').value;
const eventPayloadSchema = eventSchema.properties.payload;
const eventFlowSchema = eventPayloadSchema.properties.event;
const legacyEventSchema = eventFlowSchema.oneOf[0];
const stagedEventSchema = eventFlowSchema.oneOf[1];
const eventChoiceSchema = legacyEventSchema.properties.choices.items;
const eventOutcomeSchema = eventChoiceSchema.properties.outcome;
assert.equal(eventPayloadSchema.additionalProperties, false);
assert.equal(legacyEventSchema.additionalProperties, false);
assert.equal(stagedEventSchema.additionalProperties, false);
assert.equal(eventChoiceSchema.additionalProperties, false);
assert.equal(eventOutcomeSchema.additionalProperties, false);
assert.deepEqual(Object.keys(eventOutcomeSchema.properties), [
  'outcome',
  'hp',
  'max_hp',
  'lust',
  'max_lust',
  'gold',
  'card_removals',
  'gain_cards',
  'resources',
  'reward',
  'cost',
  'deck_actions',
  'grant',
]);
assert.equal(eventOutcomeSchema.properties.resources.maxProperties, 16);
assert.deepEqual(eventOutcomeSchema.properties.resources.additionalProperties, {
  type: 'integer',
  minimum: -999,
  maximum: 999,
});
assert.equal(eventOutcomeSchema.properties.reward.additionalProperties, false);
assert.equal(eventOutcomeSchema.properties.deck_actions.items.additionalProperties, false);
assert.equal(stagedEventSchema.properties.stages.items.properties.choices.minItems, 1);

assert.deepEqual(eventSchema.$defs.mwgCard.anyOf, [
  { required: ['effects'] },
  { required: ['trigger'] },
  { properties: { type: { const: 'Curse' } }, required: ['type'] },
]);
const treasureSchema = tower.createTowerNodeJsonSchema('treasure').value;
assert.deepEqual(treasureSchema.properties.reward.required, ['cards', 'artifacts', 'items', 'limits']);
assert.equal(treasureSchema.properties.reward.properties.card, undefined);
assert.equal(treasureSchema.properties.reward.properties.cards.maxItems, 0);
assert.equal(treasureSchema.properties.reward.properties.artifacts.minItems, 3);
assert.equal(treasureSchema.properties.reward.properties.artifacts.maxItems, 3);
assert.equal(treasureSchema.properties.reward.properties.limits.properties.artifacts.const, 1);
assert.equal(treasureSchema.properties.reward.anyOf, undefined);
const shopSchema = tower.createTowerNodeJsonSchema('shop', { act: 1, floor: 2 }).value;
assert.deepEqual(shopSchema.properties.reward.required, ['cards', 'artifacts', 'items', 'limits']);
assert.equal(shopSchema.properties.reward.properties.cards.minItems, 5);
assert.equal(shopSchema.properties.reward.properties.artifacts.minItems, 2);
assert.equal(shopSchema.properties.reward.properties.items.minItems, 2);
assert.equal(shopSchema.properties.reward.properties.limits.properties.cards.const, 5);
assert.match(
  tower.formatTowerNodeStructureRepairPrompt(job, missingActionEffects, new Error('missing effects')),
  /每个 action 必须有非空 name 和可执行 effects/,
);
assert.match(
  tower.formatTowerNodeGenerationPrompt(eventJob, { difficultyPercent: 80 }),
  /描述中的数值不能代替 effects/,
);
assert.match(tower.formatTowerNodeGenerationPrompt(eventJob, { difficultyPercent: 80 }), /outcome\.resources/);
assert.match(
  tower.formatTowerNodeStructureRepairPrompt(job, missingActionEffects, new Error('missing effects')),
  /不得把 trigger 塞进 effects 数组项/,
);
assert.match(
  tower.formatTowerNodeStructureRepairPrompt(job, missingActionEffects, new Error('missing effects')),
  /## effects 结构与目标/,
  'a focused node repair must still include the complete public gameplay DSL',
);
assert.match(
  tower.formatTowerNodeStructureRepairPrompt(job, missingActionEffects, new Error('已有内容包含重复 ID')),
  /只把冲突候选的 id 改成/,
);
assert.match(
  tower.formatTowerNodeStructureRepairPrompt(job, missingActionEffects, new Error('持续规则只允许用于 passive')),
  /纯持续能力改成 trigger\.on="passive"/,
);
assert.match(
  tower.formatTowerNodeStructureRepairPrompt(job, missingActionEffects, new Error('pool_revision')),
  /删除 request、disabled_categories、pool_revision、reroll_count/,
);
const powerRepairPrompt = tower.formatTowerNodeStructureRepairPrompt(
  { ...job, kind: 'shop' },
  missingActionEffects,
  new Error('tower reward cards is invalid: $.steps: Power 必须至少注册一个触发器，或只施加已注册状态'),
);
assert.match(powerRepairPrompt, /无条件持续规则改成 trigger:\{on:"passive",effects:modify或card_rule\}/);
assert.match(powerRepairPrompt, /passive 不得携带事件筛选/);
assert.match(powerRepairPrompt, /Power 不得使用 battle_start/);
assert.match(powerRepairPrompt, /可与 trigger 同时保留/);
assert.match(powerRepairPrompt, /不要删除合法即时效果/);
const powerGenerationPrompt = tower.formatTowerNodeGenerationPrompt(
  { ...job, kind: 'shop' },
  { difficultyPercent: 80 },
);
assert.match(powerGenerationPrompt, /Power 是持续能力牌/);
assert.match(powerGenerationPrompt, /trigger:\{on:"passive",effects:modify或card_rule\}，打出后会登记为本场能力/);
assert.match(powerGenerationPrompt, /可以同时保留根 effects/);
assert.match(powerGenerationPrompt, /\[输出前结构自检；不改变题材、机制或数值设计\]/);
assert.match(powerGenerationPrompt, /hits 永远只能是字面正整数/);
assert.match(powerGenerationPrompt, /recover\/reduce_cost\/copy\/double\/auto_play\/remove_card 的操作值不得再包对象/);
assert.ok(
  powerGenerationPrompt.includes(tower.formatCompactEffectAuthoringContract()),
  'node prompt includes the complete shared protocol, not merely a claim of completeness',
);
assert.match(powerGenerationPrompt, /bypass_block 仅 true/);
assert.match(powerGenerationPrompt, /不再附加 `lust>=max_lust`/);
assert.match(powerGenerationPrompt, /仅有额外条件时填写根 `when`，值必须是合法布尔公式/);
assert.match(powerGenerationPrompt, /threshold_execute 是回合末独立处决阶段/);
assert.match(powerGenerationPrompt, /绝不存在 pick:"any"/);
assert.match(powerGenerationPrompt, /card_rule 的值同样直接是规则字符串，绝不能写成对象/);
assert.match(powerGenerationPrompt, /逐项搜索每个 card_rule/);
assert.match(
  powerGenerationPrompt,
  /hand_size\/draw_pile_size\/discard_pile_size\/exhaust_pile_size.*必须逐个写出 self\. 或 opponent\. 前缀/,
);
assert.match(powerGenerationPrompt, /普通 Attack\/Skill\/Event\/Curse 的根 effects 绝不能直接放 card_rule/);
assert.match(powerGenerationPrompt, /card_rule 本身没有 scope:"turn"/);
assert.match(powerGenerationPrompt, /card_rule 额外不接受 trigger 专用的 ordinal\/n\/scope/);
assert.match(powerGenerationPrompt, /“每回合第一张”只写 limit:1/);
assert.match(powerGenerationPrompt, /history\.event 与根 trigger\.on 是两套不同枚举/);
assert.match(powerGenerationPrompt, /伤害记录使用 damage_resolved，不能写 deal_damage\/take_damage/);
assert.match(powerGenerationPrompt, /事件筛选枚举：trigger\.event 与 history\.event 使用/);
assert.match(powerGenerationPrompt, /不是 trigger\.on 的触发名/);
assert.match(powerGenerationPrompt, /apply_status:"临时状态ID"/);
assert.match(powerGenerationPrompt, /stacks_change:"reset"/);
assert.match(powerGenerationPrompt, /没有效果的键必须完全省略，绝不能写 \[\] 或 \{\}/);
assert.match(powerGenerationPrompt, /召唤能力只响应该召唤/);
assert.match(powerGenerationPrompt, /triggers.tick只在持有者自身行动边界执行/);
assert.match(powerGenerationPrompt, /tick_timing可为before_action或after_action，省略默认before_action/);
assert.match(powerGenerationPrompt, /持有者回合末只执行根stacks_change、零层移除及triggers.remove，与tick_timing无关/);
assert.match(powerGenerationPrompt, /减1层写根stacks_change:-1/);
assert.match(powerGenerationPrompt, /行动期施加且设置回合末衰减的状态，从施加当回合末就开始衰减/);
assert.match(powerGenerationPrompt, /层数不是剩余回合或触发次数/);
assert.match(powerGenerationPrompt, /有限未来收益要同时落实触发时点与结束机制/);
assert.match(powerGenerationPrompt, /scope:"turn"仅重置计数，不改变内容寿命/);
assert.match(prompt, /每个权重都必须是严格大于 0 的有限数字/);
const flattenedModifierRepair = tower.formatTowerNodeStructureRepairPrompt(
  job,
  missingActionEffects,
  new Error('battle.statuses[0].triggers.hold.modify: Unsupported modifier: [object Object]'),
);
assert.match(flattenedModifierRepair, /必须把它展开为一个浅层持续规则/);
assert.match(flattenedModifierRepair, /\{modify:"damage",add:1\}/);
const flattenedStatusRepair = tower.formatTowerNodeStructureRepairPrompt(
  job,
  missingActionEffects,
  new Error('battle.player_lust_effect.effects[1].apply_status：规则字段不符合浅层 effects 契约'),
);
assert.match(flattenedStatusRepair, /状态 ID 直接作为操作值，stacks 与 to 移到/);
const unsupportedWhenRepair = tower.formatTowerNodeStructureRepairPrompt(
  job,
  missingActionEffects,
  new Error('battle.cards[5].effects[1].when：Unsupported boolean CEL node: Identifier'),
);
assert.match(unsupportedWhenRepair, /保留失败，不删除对应收益或说明承诺/);
assert.match(unsupportedWhenRepair, /胜利奖励只能由节点 reward\/结算事务承担/);
const redundantOverflowRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.player_lust_effect.effects.when.left：公式引用了不支持的变量（具体原因：不支持的变量 lust）'),
);
assert.doesNotMatch(redundantOverflowRepair, /删除这个重复|因此删除/);
assert.match(redundantOverflowRepair, /不能仅凭报错路径认定条件重复并删除/);
assert.match(redundantOverflowRepair, /self\.max_lust\/opponent\.max_lust/);
const thresholdExecuteRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0].triggers.threshold_execute[0]：状态定义不合法'),
);
assert.match(thresholdExecuteRepair, /只允许处决状态持有者/);
assert.match(thresholdExecuteRepair, /锁定原事件、条件、发生者与持有者、目标、阈值、时机、次数及寿命/);
assert.match(thresholdExecuteRepair, /否则保留失败，不删除原处决收益/);
assert.doesNotMatch(thresholdExecuteRepair, /应把它移到真实可收到事件/);
assert.match(prompt, /打出后持续修改规则：根 trigger:\{on:"passive",effects:modify\/card_rule\}/);
assert.match(prompt, /Power 每场需实际打出，战后不保留获得的持续规则/);
assert.match(prompt, /targets:\{mode:"active"\|"by_id"\|"all"\|"random"\|"random_n"/);
assert.match(prompt, /绝不能写 targets:"enemies"/);
assert.match(prompt, /模板绝不写 quantity、tags、innate 或嵌套 creates/);
assert.match(
  prompt,
  /battle.player_lust_effect 与敌人 lust_effect：仅在存在真实欲望体系时生成；一旦生成必填 name\/effects/,
);
assert.match(prompt, /仅可选 emoji\/description\/creates\/when/);
assert.match(prompt, /to 只能是 self\/opponent/);
assert.match(prompt, /status_effects 只列实际生效状态/);
assert.match(prompt, /禁止自造变量/);
assert.match(prompt, /draw:0、damage:0/);
assert.match(prompt, /trigger\.effects 必须非空/);
assert.match(prompt, /无法用公开触发器表达的可选能力不要生成/);
assert.match(prompt, /结构自检必须保留原条件、时机、目标、数值和收益/);
assert.match(prompt, /没有可执行变量或触发器能等价表达时保留失败/);
assert.doesNotMatch(prompt, /就改选另一种可由当前 DSL 完整实现的机制/);
for (const placement of ['runtime', 'initial-draft']) {
  const contract = tower.formatCompactEffectAuthoringContract(placement);
  assert.match(contract, /若玩家明确要求该机制，只能采用语义等价实现/);
  assert.doesNotMatch(contract, /必须改选其他可完整执行的牌区、状态或负面牌机制/);
}
assert.match(prompt, /绝不能在 trigger 根部写 when/);
assert.match(prompt, /不存在 enemy；敌人行动不是卡牌/);
assert.match(prompt, /action 与 lust_effect 都是一次性结算/);
assert.match(prompt, /该候选自身必须同级携带 statuses:\[全部完整定义\]/);
assert.match(prompt, /闭合字段只允许 enemy、enemies、statuses、player_abilities、player_status_effects/);
assert.match(prompt, /给召唤施加状态必须改用独占项/);
assert.match(prompt, /数值效果的三元式可嵌入算式及数值函数/);
assert.match(prompt, /Power 的 passive 会在打出后登记为本场能力/);
assert.doesNotMatch(powerGenerationPrompt, /卡牌的 trigger[^\n]*不允许 battle_start\/passive/);
assert.doesNotMatch(powerGenerationPrompt, /modify 与出牌规则[^\n]*不能放进[^\n]*卡牌/);
assert.doesNotMatch(powerGenerationPrompt, /根 trigger 与根 effects 不并存/);
const openingGenerationPrompt = tower.formatTowerOpeningGenerationPrompt(openingInput);
assert.match(powerGenerationPrompt, /targets:\{mode:"by_id",id:"敌人ID"\}/);
assert.match(powerGenerationPrompt, /\{spawn_enemy:\{完整敌人字段\.\.\.,count\?:数量,capacity\?:场上容量\}\}/);
assert.ok(
  openingGenerationPrompt.includes(tower.formatCompactEffectAuthoringContract()),
  'opening gifts can author cards, relics, and items, so they must receive the complete gameplay DSL',
);
const treasureGenerationPrompt = tower.formatTowerNodeGenerationPrompt(
  { ...job, kind: 'treasure' },
  { difficultyPercent: 80 },
);
assert.match(treasureGenerationPrompt, /遗物只能放 artifacts/);
assert.match(treasureGenerationPrompt, /绝不能把 type:"Relic" 的对象塞进 cards/);
const unknownTargetRepair = tower.formatTowerNodeStructureRepairPrompt(
  job,
  missingActionEffects,
  new Error('enemy.actions[2].effects.to: Unknown field: to'),
);
assert.match(unknownTargetRepair, /不支持字段 to：必须从该路径删除/);
assert.match(unknownTargetRepair, /敌人行动的伤害与欲望伤害默认作用于玩家/);
const aggregatedForbiddenFieldRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.statuses[1].triggers.hold[0]：状态定义不合法（具体原因：triggers.hold[0].when: Unknown field: when）；battle.cards[1].effects[1].to：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 to）',
  ),
);
assert.match(aggregatedForbiddenFieldRepair, /路径 battle\.cards\[1\]\.effects\[1\]\.to 不允许字段 to/);
assert.doesNotMatch(aggregatedForbiddenFieldRepair, /路径 battle\.statuses\[1\]\.triggers\.hold\[0\] 不允许字段 to/);
const summonStatRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[0].effects[1].modify_summon.stat：damage is unsupported'),
);
assert.match(summonStatRepair, /操作改为 modify_summon_effect/);
const summonActionDamageRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[0].effects[0].spawn_summon.actions[0].effects[0].damage_summon.selector.pick：规则字段不符合浅层 effects 契约',
  ),
);
assert.match(summonActionDamageRepair, /action\/ability 向敌人造成伤害或欲望时使用普通/);
assert.match(summonActionDamageRepair, /\{damage:原数值\}/);
const unsupportedFormulaVariableRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[1].effects[0].resource.amount.condition.left：公式引用了不支持的变量'),
);
const playerPileVariableRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[0].trigger.effects.when.left：不支持变量 discard_pile_size'),
);
assert.match(playerPileVariableRepair, /裸写的 discard_pile_size 指的是玩家自己的牌区/);
assert.match(playerPileVariableRepair, /self\.discard_pile_size/);
assert.match(playerPileVariableRepair, /不要改成 opponent/);
const enemyPileVariableRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.enemies[0].abilities[0].trigger.effects[0].when.left：Unsupported variable: hand_size'),
);
assert.match(enemyPileVariableRepair, /敌人自身没有牌区/);
assert.match(enemyPileVariableRepair, /opponent\.hand_size/);
assert.match(enemyPileVariableRepair, /不得在不读原描述的情况下盲猜阵营/);
assert.match(enemyPileVariableRepair, /无法等价表达原要求时保留失败，不替换为另一机制/);
assert.doesNotMatch(enemyPileVariableRepair, /通常应改选一个真实可执行机制/);

const unpaidResourceRepair = tower.formatCompactEffectRepairContract(
  'opening.choices 奖励：cards[0].effects[0].amount.right.left: 当前卡牌不会支付资源 code',
);
assert.match(unpaidResourceRepair, /同一张卡的 cost 改为包含该资源 ID 的费用对象/);
assert.match(unpaidResourceRepair, /x_value 等价改成 x_resource\.energy/);
assert.match(unpaidResourceRepair, /self\.resource\.资源ID\.current/);
assert.match(unsupportedFormulaVariableRepair, /不能把错误变量改成猜测出来的近义字段/);
assert.match(unsupportedFormulaVariableRepair, /保留失败，不删除条件分支/);
assert.doesNotMatch(unsupportedFormulaVariableRepair, /删除该条件分支、保留描述中的基础数值/);
const unsupportedTurnCounterRepair = tower.formatCompactEffectRepairContract(
  new Error('cards[0].effects.damage.right: Unsupported variable: self.block_gained_this_turn'),
);
assert.match(unsupportedTurnCounterRepair, /block_gained_this_turn 不是可用变量/);
assert.match(
  unsupportedTurnCounterRepair,
  /仅支持 cards_played_this_turn、attacks_played_this_turn、skills_played_this_turn/,
);
assert.match(unsupportedTurnCounterRepair, /不能等价表达时保留失败，不删除条件或加成/);
assert.doesNotMatch(unsupportedTurnCounterRepair, /保留原效果的无条件基础值/);
const quotedHistoryRepair = tower.formatCompactEffectRepairContract(
  new Error('relics[0].trigger.effects[0].block: Unexpected "{" at character 0'),
);
assert.match(quotedHistoryRepair, /把 history 对象写成了字符串或伪 JSON/);
assert.match(quotedHistoryRepair, /"block":\{"history":\{"metric":"last_hp_loss"\}\}/);
const relativeHpRepair = tower.formatCompactEffectRepairContract(
  new Error('cards[1].effects[1].hp: Unknown compact effect: hp'),
);
assert.match(relativeHpRepair, /浅层 effects 不存在 hp 操作/);
assert.match(relativeHpRepair, /damage:N,damage_type:"hp_loss",to:原目标/);
assert.match(relativeHpRepair, /不得把负数 hp 错改成治疗/);
const numericPercentRepair = tower.formatCompactEffectRepairContract(
  new Error('statuses[1].triggers.hold[0].add: Expected expression after % at character 3'),
);
assert.match(numericPercentRepair, /公式不支持 % 后缀/);
assert.match(numericPercentRepair, /modify:"damage_taken",multiply:1\.5/);
const bareSummonCountRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[2].effects[0].when.left：Unsupported variable: summon_count'),
);
assert.match(bareSummonCountRepair, /召唤数量必须写成 self\.summon_count 或 opponent\.summon_count/);
assert.match(bareSummonCountRepair, /存在性条件可写 self\.has_summon 或 opponent\.has_summon/);
assert.doesNotMatch(bareSummonCountRepair, /公式不存在 summon_count/);
const englishUnsupportedOpponentRootRepair = tower.formatCompactEffectRepairContract(
  new Error('Unsupported variable: self.opponent.status.corrosion.stacks'),
);
assert.match(englishUnsupportedOpponentRootRepair, /self 与 opponent 是并列根对象/);
assert.match(englishUnsupportedOpponentRootRepair, /self\.opponent\.xxx.*opponent\.xxx/);
assert.match(powerGenerationPrompt, /正式卡与 creates 模板都只有 type:"Power" 可以有根 trigger/);
assert.match(powerGenerationPrompt, /count\/capacity 必须位于 spawn_enemy 对象内部/);
assert.match(powerGenerationPrompt, /只有其自身存在真实欲望体系时才附带闭合的 lust_effect/);
assert.match(powerGenerationPrompt, /读取敌方状态必须写 opponent\.status\.ID\.stacks/);
assert.match(powerGenerationPrompt, /不能写 self\.history 点链/);
assert.match(powerGenerationPrompt, /不存在 self\.opponent 或 opponent\.self/);
assert.match(
  powerGenerationPrompt,
  /实体数值：以下每个路径都须加 self\. 或 opponent\. 前缀：[^\n]*hand_size、draw_pile_size、discard_pile_size、exhaust_pile_size/,
);
assert.match(
  powerGenerationPrompt,
  /实体条件：self\.\/opponent\. 下的 has_buff、has_debuff、has_neutral、has_status、has_summon/,
);
assert.match(powerGenerationPrompt, /self\.summon_count\/opponent\.summon_count/);
assert.match(powerGenerationPrompt, /敌人来源的 opponent 牌区数量就是玩家牌区/);
assert.match(powerGenerationPrompt, /type:"Relic" 不是卡牌类型，遗物绝不能塞进 cards/);
assert.match(powerGenerationPrompt, /不存在card_rule:"energy_gain"或modify:"energy"/);
assert.match(powerGenerationPrompt, /永久眩晕本身不是结构错误/);
assert.ok(powerGenerationPrompt.includes('tags 为唯一非空稳定ID数组，与召唤定义的 tags 精确匹配'));
assert.ok(powerGenerationPrompt.includes('选择已知种类优先用 template_id，不能凭中文类别猜 tags'));
assert.match(powerGenerationPrompt, /绝不写 name:""、origin:""/);
assert.match(powerGenerationPrompt, /若满溢时强化当前已有召唤物，直接使用独占项 modify_summon/);
assert.match(powerGenerationPrompt, /recover 的固定目的地是手牌/);
assert.match(powerGenerationPrompt, /left\/right 表示手牌在界面中的最左\/最右，只能与 from:"hand" 使用/);
assert.match(powerGenerationPrompt, /draw\/discard\/exhaust 是有顺序牌堆/);
assert.match(powerGenerationPrompt, /复制现有牌使用 copy，double 是现有牌的额外结算而非复制/);
assert.match(powerGenerationPrompt, /copy 复制选中的现有牌并把新副本加入手牌/);
assert.match(powerGenerationPrompt, /仅允许显式 to:"hand"/);
assert.match(powerGenerationPrompt, /double 不生成副本/);
assert.match(powerGenerationPrompt, /不另设 Token\/Special 类型或稀有度/);
assert.match(powerGenerationPrompt, /不以未登记状态或描述替代实现/);
const unsupportedEnergyGainRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[1].triggers.hold.card_rule: Unsupported card rule: energy_gain'),
);
assert.match(unsupportedEnergyGainRepair, /不存在 card_rule:"energy_gain"/);
assert.match(unsupportedEnergyGainRepair, /也不能改猜成 modify:"energy"/);
assert.match(unsupportedEnergyGainRepair, /trigger:\{on:"turn_start",effects:\{energy:原数值\}\}/);
const invalidSummonTagsRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[4].effects.activate_summon.selector.tags：规则字段不符合浅层 effects 契约（具体原因：summon tags must be unique stable English ids）',
  ),
);
assert.match(invalidSummonTagsRepair, /被选择的 spawn_summon\.tags 必须登记完全相同的标签/);
assert.match(invalidSummonTagsRepair, /selector:\{template_id:"该召唤英文ID",pick:"all"\}/);
const numericSummonSlotRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[2].effects[0].spawn_summon.slot：规则字段不符合浅层 effects 契约'),
);
assert.match(numericSummonSlotRepair, /spawn_summon\.slot 是召唤物在所属阵营内的稳定英文槽位 ID/);
assert.match(numericSummonSlotRepair, /把数字 N 机械改成字符串 "slot_N"/);
const emptyCardFilterRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.statuses[0].triggers.hold[0].name：规则字段不符合浅层 effects 契约（具体原因：name must be a non-empty card name）',
  ),
);
assert.match(emptyCardFilterRepair, /删除 name:""、origin:""、空数组等占位/);
const unsupportedOpeningBlockRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices[1].outcome：开局馈赠不支持字段：block'),
);
assert.match(unsupportedOpeningBlockRepair, /opening choice\.outcome 是开局节点结算，不是战斗 effects/);
assert.match(unsupportedOpeningBlockRepair, /不得把 block 猜成 hp 或 max_hp/);
const unsupportedOpeningMaxEnergyRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices[1].outcome：开局馈赠不支持字段：max_energy'),
);
assert.match(unsupportedOpeningMaxEnergyRepair, /max_energy 不是 opening outcome 的可结算字段/);
assert.match(unsupportedOpeningMaxEnergyRepair, /若无法等价实现则保留失败/);
assert.match(unsupportedOpeningMaxEnergyRepair, /绝不能把 max_energy 改猜成 max_hp/);
const openingStructureRepair = tower.formatTowerOpeningStructureRepairPrompt(
  openingInput,
  '{"choices":[{"outcome":{"max_energy":1}}]}',
  new Error('opening.choices[0].outcome：开局馈赠不支持字段：max_energy'),
);
assert.match(openingStructureRepair, /outcome 不支持 energy、max_energy、block/);
assert.match(openingStructureRepair, /不得把 max_energy 猜成 max_hp/);
assert.match(openingPrompt, /不能直接写 block、energy、status 或 effects/);
assert.match(openingPrompt, /lust 会直接改变玩家当前欲望/);
assert.match(openingPrompt, /奖励内容引入一个或多个新状态时/);
assert.match(openingPrompt, /该卡牌、遗物或道具自身同级附带 statuses/);
const lustModifierRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.player_lust_effect.effects[0]：规则字段不符合浅层 effects 契约（具体原因：持续规则只允许用于 passive 或状态 hold）',
  ),
);
assert.match(lustModifierRepair, /player_lust_effect 是满溢时的一次性结算/);
assert.match(lustModifierRepair, /modify_summon_effect/);
assert.match(lustModifierRepair, /绝不能引用未登记状态/);
const generatedTemplateQuantityRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[0].creates[0].quantity：规则字段不符合浅层 effects 契约（具体原因：unsupported content field: quantity）',
  ),
);
assert.match(generatedTemplateQuantityRepair, /必须删除模板内的 quantity/);

const generatedCurseTriggerRepair = tower.formatCompactEffectRepairContract(
  'enemy.lust_effect.creates[0].trigger: Only Power templates can register a trigger',
);
assert.match(generatedCurseTriggerRepair, /Attack\/Skill\/Event\/Curse 模板必须删除 trigger/);
assert.match(generatedCurseTriggerRepair, /模板绝不能嵌套 creates/);
const generatedCurseCostRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.player_lust_effect.creates[0].cost：诅咒牌不能填写费用'),
);
assert.match(generatedCurseCostRepair, /彻底删除整个 cost 字段/);
assert.match(generatedCurseCostRepair, /cost:null、cost:0/);
const generatedDiscardOnlySkillRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[6].creates[0]：缺少 effects'),
);
assert.match(generatedDiscardOnlySkillRepair, /已有 discard_effects 不能替代这些牌的根 effects/);
assert.match(generatedDiscardOnlySkillRepair, /改为 Curse、彻底删除 cost 字段并保留真实 discard_effects/);
assert.match(generatedTemplateQuantityRepair, /player\.cards 自身的 quantity 必须保留/);
const invalidRecoverTopRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[2].effects[0].pick：规则字段不符合浅层 effects 契约（具体原因：recover pick must be random, choose, or all）',
  ),
);
assert.match(invalidRecoverTopRepair, /recover 表示从 discard\/exhaust 回到手牌/);
assert.match(invalidRecoverTopRepair, /move_card:原数量.*destination:"draw".*position:"top"/);
const recoverFromDrawRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[2].effects[0].from: recover from must be discard or exhaust'),
);
assert.match(recoverFromDrawRepair, /from:"draw".*move_card:原数量.*destination:"hand"/);
assert.match(recoverFromDrawRepair, /绝不能把 from:"draw" 原样返回/);
const selfPickRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'opening.choices[1].outcome.reward.cards[0].effects[1].pick: pick must be random, choose, left, right, top, bottom, or all: this',
  ),
);
assert.match(selfPickRepair, /当前卡根部已经有 exhaust:true.*删除.*冗余效果/);
assert.match(selfPickRepair, /禁止把数字操作机械改成 pick:"all"/);
const invalidOrderedPileSideRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[1].effects[1].pick：规则字段不符合浅层 effects 契约（具体原因：left/right can only select cards from hand）',
  ),
);
assert.match(invalidOrderedPileSideRepair, /保持 from、数量、操作和筛选不变/);
assert.match(invalidOrderedPileSideRepair, /left 等价改为 top、right 等价改为 bottom/);
assert.match(invalidOrderedPileSideRepair, /绝不能为了让字段通过而把 from 改成 hand/);
const unknownGeneratedCardRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[3].effects[1].add_card：规则字段不符合浅层 effects 契约（具体原因：Unknown card template: echo_repeat）',
  ),
);
assert.match(unknownGeneratedCardRepair, /不能引用玩家现有牌、当前牌自身/);
assert.match(unknownGeneratedCardRepair, /同一 effects 前一步已经完成该 copy，删除多余的 add_card/);
const unknownStatusGeneratedCardRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[2].triggers.card_played[0].add_card: Unknown card template: echo_repeat'),
);
assert.match(unknownStatusGeneratedCardRepair, /该状态自身 creates/);
assert.match(unknownStatusGeneratedCardRepair, /不能改成不存在的 spawn_card/);
const nonPassiveRelicRuleRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'opening.choices 奖励：开局馈赠 gift_mirror_echo.artifacts[0] 回声碎片 无效：relics[0].trigger.effects: 持续规则只允许用于 passive 或状态 hold',
  ),
);
assert.match(nonPassiveRelicRuleRepair, /非 passive 根 trigger/);
assert.match(nonPassiveRelicRuleRepair, /on 改为 "passive"/);
assert.match(nonPassiveRelicRuleRepair, /不能只删除 event 后把 card_rule\/modify 原样留在非 passive/);
const unknownStatusRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.player_lust_effect.effects[1].status：引用了未注册状态'),
);
assert.match(unknownStatusRepair, /每个报错的未注册状态引用都必须在本次修复中闭合/);
assert.match(unknownStatusRepair, /保留失败，不删除对应 apply_status\/remove_status 效果或说明承诺/);
assert.match(unknownStatusRepair, /不得为了通过校验而把它随意改名成另一个已存在但机制不同的状态/);
const numericPoolStatusRepair = tower.formatCompactEffectRepairContract(
  new Error('statuses[1].triggers: status trigger references an unregistered status: block'),
);
assert.match(numericPoolStatusRepair, /block 是角色数值池，不是状态 ID/);
assert.match(numericPoolStatusRepair, /set_block:0/);
assert.doesNotMatch(numericPoolStatusRepair, /补入同 ID、字段完整且可执行的唯一状态定义/);
const unknownOpeningStatusRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices 奖励：开局馈赠 gift_loop.cards[0] 无效：引用了未注册状态: opening_loop_buff'),
);
assert.match(unknownOpeningStatusRepair, /奖励卡、遗物或道具引用 player\.statuses 尚无的一个或多个新状态/);
assert.match(unknownOpeningStatusRepair, /具体候选同级添加 statuses/);
assert.match(unknownOpeningStatusRepair, /不要给 reward 容器写 statuses/);
assert.match(unknownOpeningStatusRepair, /已有机制完全相同则直接复用/);
const nestedUnknownOpeningStatusRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'opening.choices 奖励：开局馈赠 echolocation.cards[0] 回声定位 无效：statuses[0].triggers: status trigger references an unregistered status: strength',
  ),
);
assert.match(nestedUnknownOpeningStatusRepair, /来自爬塔节点 reward 候选/);
assert.match(nestedUnknownOpeningStatusRepair, /沿每个新状态 triggers 中的引用继续展开/);
assert.match(nestedUnknownOpeningStatusRepair, /本次未注册状态来自 opening 馈赠候选/);
const nestedStatusEventRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'opening.choices 奖励：开局馈赠 seed_cycle.cards[0] 递归重奏 无效：statuses[0]: triggers.skill_played: Effect must contain one operation plus optional to/when fields',
  ),
);
assert.match(nestedStatusEventRepair, /状态事件 triggers\.skill_played/);
assert.match(nestedStatusEventRepair, /数组各项的 when 在执行到该项时重新判断/);
assert.match(nestedStatusEventRepair, /不能机械展开/);
assert.match(nestedStatusEventRepair, /不删除条件或收益/);
assert.doesNotMatch(nestedStatusEventRepair, /必须机械改成/);
assert.match(nestedStatusEventRepair, /self\.status\.状态ID\.stacks > 0/);
assert.match(nestedStatusEventRepair, /has_status 仅表示“任意状态是否存在”的无参数布尔字段/);
assert.match(nestedStatusEventRepair, /triggers\.hold 写 \{card_rule:"replay"/);
assert.match(nestedStatusEventRepair, /stacks_change:"reset"/);
assert.match(nestedStatusEventRepair, /出现 modify\/card_rule，不能留在这个一次性事件槽/);
assert.match(nestedStatusEventRepair, /modify:"damage".*原样移到同一状态 triggers\.hold/);
assert.doesNotMatch(
  nestedStatusEventRepair,
  /trigger 固定写在内容根部 \{on,effects\}/,
  'status events must not receive the incompatible root ability-trigger repair',
);
const unknownTowerRewardStatusRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'act-1-floor-1-col-2: tower reward cards is invalid at cards[0] (reward_shattered_prism): 引用了未注册状态: brittle',
  ),
);
assert.match(unknownTowerRewardStatusRepair, /来自爬塔节点 reward 候选/);
assert.match(unknownTowerRewardStatusRepair, /每一张引用新状态的具体奖励卡、遗物或道具/);
assert.match(unknownTowerRewardStatusRepair, /每个候选各自闭合/);
assert.match(unknownTowerRewardStatusRepair, /绝不能把 status\/statuses 放到节点顶层/);
assert.match(unknownTowerRewardStatusRepair, /玩家最终可能只取得其中任意一个/);
assert.doesNotMatch(unknownTowerRewardStatusRepair, /在该内容所属的状态定义容器补入/);
const unknownTowerRewardStatusRepairRuntimeWording = tower.formatCompactEffectRepairContract(
  new Error(
    'act-1-floor-4-col-1: tower reward cards is invalid at cards[2] (reward_stone_echo): cards[0].effects[1].status: 状态未注册: temp_attack_boost',
  ),
);
assert.match(unknownTowerRewardStatusRepairRuntimeWording, /来自爬塔节点 reward 候选/);
assert.match(unknownTowerRewardStatusRepairRuntimeWording, /具体奖励卡、遗物或道具/);
assert.match(unknownTowerRewardStatusRepairRuntimeWording, /payload\.battle\.statuses/);
const nullRewardStatusRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'tower reward cards is invalid at cards[0] (plain_guard): 候选 status 必须是一个状态定义对象；tower reward cards is invalid at cards[1] (plain_draw): 候选 status 必须是一个状态定义对象',
  ),
);
assert.match(nullRewardStatusRepair, /statuses 是可选的新状态定义数组/);
assert.match(nullRewardStatusRepair, /扫描全部 cards\/artifacts\/items/);
assert.match(nullRewardStatusRepair, /未被该候选直接或经状态依赖链引用的定义都必须移除/);
assert.match(nullRewardStatusRepair, /绝不能为普通数值内容凭空编造状态/);
assert.match(powerGenerationPrompt, /没有引入并引用新状态的候选必须完全省略它/);
assert.match(powerGenerationPrompt, /绝不能输出 status:null、statuses:null/);
const singleChoiceOptionRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[5].effects[0].options：规则字段不符合浅层 effects 契约'),
);
assert.match(
  singleChoiceOptionRepair,
  /choose\/options 表示预先写好的不同效果分支：options 至少 1 项/,
);
assert.match(
  singleChoiceOptionRepair,
  /count 省略为 1，写出时必须是 1 到 options 数量的整数/,
);
assert.match(singleChoiceOptionRepair, /删除整个 choose\/options 外壳/);
assert.match(singleChoiceOptionRepair, /auto_play:1,from:"hand",pick:"choose",card_type:"Skill",free:true/);
assert.match(powerGenerationPrompt, /它不用于选择牌区中的卡牌/);
assert.match(powerGenerationPrompt, /同级写 pick:"choose"/);
const conditionalCardRuleRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[3].trigger.effects[0].when：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 when）',
  ),
);
assert.match(conditionalCardRuleRepair, /card_rule 是持续规则，不接受 when 或 on/);
assert.match(conditionalCardRuleRepair, /移动到该状态定义的 triggers\.hold/);
assert.match(conditionalCardRuleRepair, /不要直接删除条件后把原本有条件的规则扩大为永久无条件生效/);
assert.match(powerGenerationPrompt, /card_rule 不接受 when\/on/);
const internalBlockOperationRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'act-1-floor-2-col-0: tower reward items is invalid at items[0] (reward_glittering_dust): $[0].gain_block: Unknown compact effect: gain_block',
  ),
);
assert.match(internalBlockOperationRepair, /gain_block 是程序内部动作名/);
assert.match(internalBlockOperationRepair, /\{block:原数值/);
assert.match(internalBlockOperationRepair, /绝不能改成 damage:0、block:0/);
const copiedCardModifierRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.player_abilities[0].trigger.effects[0].to_modify：该操作必须单独占一个 effects 数组项'),
);
assert.match(copiedCardModifierRepair, /to_modify 不是任何公开 effects 操作/);
assert.match(copiedCardModifierRepair, /必须保留副本零费/);
assert.match(copiedCardModifierRepair, /不把副本改为原费用/);
const nestedResourceConditionRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[2].trigger.effects.resource.amount.when：该效果不允许字段 when'),
);
assert.match(nestedResourceConditionRepair, /when 必须移到整个 resource 操作的同级/);
assert.match(nestedResourceConditionRepair, /cards_played_this_turn % N == 0/);
assert.match(nestedResourceConditionRepair, /不得自造 equals:0/);
const mixedStatusRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[1].status：规则字段不符合浅层 effects 契约（具体原因：unsupported content field: status）；battle.player_lust_effect.effects[1].status：引用了未注册状态；opening.choices 奖励：开局馈赠 gift.cards[0] 无效：Unknown compact effect: replay',
  ),
);
assert.match(mixedStatusRepair, /把全部定义原样移动到全局 player\.statuses/);
assert.match(mixedStatusRepair, /本次未注册状态来自 player_lust_effect/);
assert.match(mixedStatusRepair, /不是奖励候选/);
assert.doesNotMatch(mixedStatusRepair, /本次未注册状态来自 opening 馈赠候选/);
const rewardDescriptionRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices[2].outcome：开局馈赠 reward 不支持字段：description'),
);
assert.match(rewardDescriptionRepair, /reward 容器只允许 cards、artifacts、items 数组/);
assert.match(rewardDescriptionRepair, /把文字移动到该卡牌、遗物或道具自身的 description/);
assert.match(rewardDescriptionRepair, /不得删除或重写合法候选数组/);
const immediatePowerRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[4].effects：Power 必须至少注册一个触发器，或只施加已注册状态'),
);
assert.match(immediatePowerRepair, /保留这些 effects 和原 type/);
assert.match(immediatePowerRepair, /缺少触发器不授权改为 Skill 或 Attack/);
assert.match(immediatePowerRepair, /无法等价恢复则保留失败/);
for (const error of ['ROOT_TRIGGER_REQUIRED', 'Power 必须至少注册一个触发器', 'passive/hold 项不合法']) {
  const repaired = tower.formatCompactEffectRepairContract(new Error(error));
  assert.doesNotMatch(
    repaired,
    /并把 (?:type|Power) 改为 Skill|即时效果牌没有持续 trigger 时改为|保留即时 effects 并改为/,
  );
}
assert.match(powerGenerationPrompt, /已有或明确要求的 Power 不因缺少触发器而改类型/);
assert.match(powerRepairPrompt, /只有即时效果不足以证明类型无关/);
const battleStartPowerRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices[2].outcome.reward.cards[0].trigger.on：Power trigger.on="battle_start" 不受支持'),
);
assert.match(battleStartPowerRepair, /Power 绝不能使用 battle_start/);
assert.match(battleStartPowerRepair, /开战触发只属于遗物、独立能力或状态/);
const redundantFirstOrdinalRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.player_abilities[0].trigger.n：事件次序字段组合不合法（具体原因：ordinal 为 first 或省略时不能填写 n）',
  ),
);
assert.match(redundantFirstOrdinalRepair, /ordinal:"first".*必须删除 n/);
assert.match(redundantFirstOrdinalRepair, /scope、on、effects、数值和其他筛选保持不变/);
const unsupportedEnemySourceRepair = tower.formatCompactEffectRepairContract(
  new Error('enemy.abilities[0].trigger.filter.sourceKind: unsupported event source kind: enemy'),
);
assert.match(unsupportedEnemySourceRepair, /不存在 source_kind:"enemy"/);
assert.match(unsupportedEnemySourceRepair, /敌人行动不会产生 card_played/);
const unsupportedSummonActedRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices 奖励：relics[0].trigger.on: unsupported trigger: summon_acted'),
);
assert.match(unsupportedSummonActedRepair, /遗物也无法监听“任意召唤物行动”/);
assert.match(unsupportedSummonActedRepair, /禁止把它改成拼写错误的 eal_damage/);
assert.match(unsupportedSummonActedRepair, /资源操作仍只能写 \{resource/);
const triggerWhenRepair = tower.formatCompactEffectRepairContract(
  new Error('enemy.abilities[0].trigger.when: unsupported trigger field: when'),
);
assert.match(triggerWhenRepair, /根 trigger 不支持 when/);
assert.match(triggerWhenRepair, /单个效果可将条件移到该效果同级 when/);
assert.match(triggerWhenRepair, /前序效果及其触发联动不会改变条件真假时才能逐项复制/);
const enemyActionModifierRepair = tower.formatCompactEffectRepairContract(
  new Error('enemy.actions[2].effects[1]: 持续规则只允许用于 passive 或状态 hold'),
);
assert.match(enemyActionModifierRepair, /敌人 action 是一次性行动/);
const filteredTriggerModifierRepair = tower.formatCompactEffectRepairContract(
  new Error('cards[0].trigger.effects[0]: 持续规则只允许用于 passive 或状态 hold'),
);
assert.match(filteredTriggerModifierRepair, /非 passive 的真实事件 trigger/);
assert.match(filteredTriggerModifierRepair, /改成该 trigger\.effects 的一次性 \{damage:N\}/);
assert.match(enemyActionModifierRepair, /改成 apply_status/);
const nestedCardRuleRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'opening.choices 奖励：洞察透镜无效：relics[0].trigger.effects.card_rule: Unsupported card rule: [object Object]',
  ),
);
assert.match(nestedCardRuleRepair, /card_rule 的值必须直接是公开规则字符串/);
assert.match(nestedCardRuleRepair, /禁止猜成 limit_draw/);
const cardRuleOrdinalRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0].triggers.hold.card_rule: 该操作必须单独占一个 effects 数组项'),
);
assert.match(cardRuleOrdinalRepair, /只删除误塞进同一对象的 trigger 事件字段 ordinal\/n\/scope/);
assert.match(cardRuleOrdinalRepair, /card_rule:"replay",limit:1,extra:次数/);
assert.match(cardRuleOrdinalRepair, /不能把它拆成两个效果项/);
const triggeredReplayRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'opening.choices 奖励：递归协议无效：relics[0].trigger.effects: replay_current 只允许用于当前正在结算的非 Power、非 Event 卡牌主效果',
  ),
);
assert.match(triggeredReplayRepair, /只有那里存在“当前卡”/);
assert.match(triggeredReplayRepair, /card_rule:"replay",limit:N,extra:原次数/);
assert.match(triggeredReplayRepair, /必须彻底删除原事件的 ordinal、n、scope/);
assert.match(triggeredReplayRepair, /不要改成重复 damage、copy\/double、0 值或空效果/);
const emptyFilteredRelicRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices[2].outcome.reward.artifacts[0].trigger.effects: EMPTY_EFFECTS'),
);
assert.match(emptyFilteredRelicRepair, /on:"card_played",card_type:"Attack"/);
assert.match(emptyFilteredRelicRepair, /禁止在 effects\.when 中自造 event\.card\.type/);
const openingResourceRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices[0].outcome：开局馈赠不支持字段：resource'),
);
assert.match(openingResourceRepair, /outcome 不支持直接修改自定义战斗资源/);
assert.match(openingResourceRepair, /不得留下全零字段与全空 reward 的无效果馈赠/);
const modifierFormulaRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0].triggers.hold.add: Modifier formulas may only use numbers and status stacks'),
);
assert.match(modifierFormulaRepair, /当前状态的裸变量 stacks/);
assert.match(modifierFormulaRepair, /self\.status\.该状态ID\.stacks/);
const statusSelfStacksRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices 奖励：cards[0].statuses[0].triggers.hold[0].add: Unsupported variable: self.stacks'),
);
assert.match(statusSelfStacksRepair, /当前状态层数只写裸变量 stacks/);
assert.match(statusSelfStacksRepair, /把 self\.stacks 逐字等价改成 stacks/);
const passiveSummonScopeRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[4].trigger.effects[0].scope：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 scope）',
  ),
);
assert.match(passiveSummonScopeRepair, /绝不能只把 passive 内的操作改成 modify_summon/);
assert.match(passiveSummonScopeRepair, /不得为通过校验将 Power 改成 Skill/);
assert.doesNotMatch(passiveSummonScopeRepair, /应删除 passive trigger|将 type 改成 Skill|把 description 改为/);
const passiveOneShotRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[4].trigger.effects[0]：passive 与状态 hold 只能包含持续修饰或出牌规则'),
);
assert.match(passiveOneShotRepair, /modify_summon_effect.*绝不能留在 passive\/hold/);
const numericPickAllRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[4].effects[1].exhaust：规则字段不符合浅层 effects 契约'),
);
assert.match(numericPickAllRepair, /操作值是数字 N 时，pick 绝不能是 "all"/);
assert.match(numericPickAllRepair, /描述没有明确随机\/位置时使用 pick:"choose"/);
const combatPickRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'opening.choices 奖励：fragment_growth.artifacts[0].trigger.effects.pick: from: all/combat requires pick: all',
  ),
);
assert.match(combatPickRepair, /from:"all"\/"combat" 固定使用 pick:"all"/);
const emptyOptionalEffectRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.player_lust_effect.effects：effects 不能为空；可选内容若没有真实机制应整个省略'),
);
assert.match(emptyOptionalEffectRepair, /不能保留 effects:\[\] 或 effects:\{\}/);
assert.match(emptyOptionalEffectRepair, /可选是指允许不创作，不代表修复时可以删除已承诺的机制/);
const ownedRewardRepair = tower.formatCompactEffectRepairContract(
  new Error('opening.choices 奖励：开局馈赠 choice_energy_core.artifacts[0] 契约星核 无效：遗物已持有: star_core'),
);
assert.match(ownedRewardRepair, /已有非唯一卡的名称、类型、费用和可执行规则完全相同时/);
assert.match(ownedRewardRepair, /新的稳定英文 id 和完整规则/);
const enemyNarrateRepair = tower.formatCompactEffectRepairContract(
  new Error('enemy.abilities[0].trigger.effects: narrate 只允许作为 Event 的唯一顶层主效果'),
);
assert.match(enemyNarrateRepair, /narrate 只能是 Event 卡唯一的顶层主效果/);
assert.match(enemyNarrateRepair, /删除整个 ability/);
const spawnEnemyRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'enemy.actions[2].effects[0].spawn_enemy: This operation must remain a separate effect object; enemy.actions[2].effects[0].capacity: This operation must remain a separate effect object',
  ),
);
assert.match(spawnEnemyRepair, /\{spawn_enemy:\{完整敌人字段\.\.\.,count\?:数量,capacity\?:场上容量\}\}/);
assert.match(spawnEnemyRepair, /移动到 spawn_enemy 对象内部/);
assert.match(spawnEnemyRepair, /无欲望体系的增援可省略 lust_effect/);
assert.match(spawnEnemyRepair, /若已经提供，必须修成闭合的 \{name,effects\}/);
const enemyAllyTargetRepair = tower.formatCompactEffectRepairContract(
  new Error('enemy.actions[0].effects[0].to: Target must be self or opponent: warden_prime'),
);
assert.match(enemyAllyTargetRepair, /to 只接受 "self" 或 "opponent"/);
assert.match(enemyAllyTargetRepair, /targets:\{mode:"by_id",id:"队友ID"\}/);
const summonCollectionRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'cards[0].effects[1].targets: targets can only address the opponent combatant collection in this source context',
  ),
);
assert.match(summonCollectionRepair, /若目标是召唤物/);
assert.match(summonCollectionRepair, /heal_summon/);
assert.match(summonCollectionRepair, /不得为了修这一项把格挡牌改成攻击牌/);
const passiveEnergyRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[0].trigger.effects[0].modify：passive energy is unsupported'),
);
assert.match(passiveEnergyRepair, /改用 trigger\.on="turn_start"/);
const holdRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0].triggers.hold[0]：状态 hold 只能包含持续修饰或出牌规则'),
);
assert.match(holdRepair, /移到 triggers\.apply 或 triggers\.stack/);
assert.match(holdRepair, /不能复制到 Power\/遗物\/能力的 passive/);
assert.match(holdRepair, /同级 triggers\.事件名/);
assert.match(holdRepair, /不得改成空 hold/);
const unknownScopeRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0].triggers.hold[0].scope: Unknown field: scope'),
);
assert.match(unknownScopeRepair, /必须从该路径删除 scope/);
assert.match(unknownScopeRepair, /modify 与 card_rule 都没有 scope:"summon"/);
assert.match(unknownScopeRepair, /reduce_cost 只立即修改当前已选中的卡牌/);
assert.match(unknownScopeRepair, /不能把“下一张牌”改成当前任意牌/);
assert.match(unknownScopeRepair, /不能改写 description 掩盖差异/);
assert.doesNotMatch(
  unknownScopeRepair,
  /replay_current/,
  'an unrelated scope error must not receive current-card replay repair noise',
);
const temporaryCardRuleScopeRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[7].effects[1].scope：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 scope）'),
);
assert.match(temporaryCardRuleScopeRepair, /不能只删除 scope 后把 card_rule 留在根 effects/);
assert.match(temporaryCardRuleScopeRepair, /stacks_change:"reset"/);
const zeroOwnedCardRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[1].quantity：数量必须是 1 到 100 的整数'),
);
assert.match(zeroOwnedCardRepair, /quantity:0 表示实际未拥有/);
assert.match(zeroOwnedCardRepair, /不能擅自改成 1/);
const templateRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'battle.cards[0].effects[1].template(temp).quantity：规则字段不符合浅层 effects 契约（具体原因：该效果不允许字段 quantity）',
  ),
);
assert.match(templateRepair, /模板本身不写 quantity、tags 或 innate/);
const nestedTernaryRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.cards[0].effects[0].block.right：公式写法不受支持'),
);
assert.match(nestedTernaryRepair, /数值三元式可用于数值效果的算式或数值函数/);
const historyEmbeddedInWhenRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.artifacts[0].trigger.effects[0].when: Unexpected "{" at character 0'),
);
assert.match(historyEmbeddedInWhenRepair, /伪 JSON 塞进字符串/);
assert.match(historyEmbeddedInWhenRepair, /事件、时间范围、归属和数量完全等价/);
assert.match(historyEmbeddedInWhenRepair, /禁止删除条件后改成无条件触发/);
assert.match(historyEmbeddedInWhenRepair, /禁止修改 description 来掩盖机制丢失/);
assert.match(historyEmbeddedInWhenRepair, /保留失败由校验阻止写入/);
assert.doesNotMatch(historyEmbeddedInWhenRepair, /必须删除这段非法 history 条件|同步修改 description/);
assert.doesNotMatch(
  historyEmbeddedInWhenRepair,
  /去掉包住整个对象的引号/,
  'a history object embedded in when cannot be repaired as a numeric history formula',
);
const explicitHistoryWhenRepair = tower.formatCompactEffectRepairContract(
  new Error(
    "battle.artifacts[0].trigger.effects[0].when：\"{history:{metric:'last_hp_loss',scope:'turn'}} > 10\" 不受支持",
  ),
);
assert.match(explicitHistoryWhenRepair, /当前语法不支持在 when 中比较 history 对象/);
assert.match(explicitHistoryWhenRepair, /必须保留原效果、数值、目标与触发条件/);
const invalidHistoryEventRepair = tower.formatCompactEffectRepairContract(
  new Error('relics[0].trigger.effects[0].effects[0].amount.filter.kind: unsupported event kind: deal_damage'),
);
assert.match(invalidHistoryEventRepair, /history\.event 不能使用 trigger\.on 的名字/);
assert.match(invalidHistoryEventRepair, /伤害改用 event:"damage_resolved"/);
assert.match(invalidHistoryEventRepair, /保留 metric、scope、source_kind、card_type、actor_id、target_id/);
const unsupportedResourceTriggerRepair = tower.formatCompactEffectRepairContract(
  new Error('relics[0].trigger.on: unsupported trigger: resource_changed'),
);
assert.match(unsupportedResourceTriggerRepair, /resource_changed 是底层历史事件名/);
assert.match(unsupportedResourceTriggerRepair, /当前根触发器没有“资源变化时”/);
assert.match(unsupportedResourceTriggerRepair, /必须保留资源变化这个触发条件/);
const statusEventScopeRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0]：状态定义不合法（具体原因：triggers.attack_played.scope: Unknown field: scope）'),
);
assert.match(statusEventScopeRepair, /状态事件 triggers\.attack_played 的效果项不接受 scope\/ordinal\/n\/event/);
assert.match(statusEventScopeRepair, /状态自身 stacks_change/);
assert.match(statusEventScopeRepair, /根 trigger:\{on,effects,筛选字段\}/);
const applyRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0].triggers.apply：状态 apply 不能包含持续修饰或出牌规则'),
);
assert.match(applyRepair, /持续规则原样移动到同一状态的 triggers\.hold/);
const decayRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0].triggers.tick[0].stacks: Unknown field: stacks; remove_status cannot use stacks'),
);
assert.match(decayRepair, /同一状态定义根部写 stacks_change:-1/);
assert.match(decayRepair, /不要把逐层衰减改成整状态立即移除/);
const invalidStacksChangeRepair = tower.formatCompactEffectRepairContract(
  new Error('battle.statuses[0]：状态定义不合法（具体原因：状态 stacks_change 无效）'),
);
assert.match(invalidStacksChangeRepair, /禁止 decrement\/decay\/subtract:1/);
assert.match(invalidStacksChangeRepair, /每回合减少 1 层写 stacks_change:-1/);
assert.match(invalidStacksChangeRepair, /依据该状态现有 description 保持寿命语义/);
const layeredInvalidStatusRepair = tower.formatCompactEffectRepairContract(
  new Error(
    'opening.choices 奖励：候选 statuses[0] 无效: 状态 stacks_change 无效；候选 statuses[0] 无效: triggers.hold.modify: Unsupported modifier: actions_per_activation',
  ),
);
assert.match(layeredInvalidStatusRepair, /必须同时复核该状态的全部字段/);
assert.match(
  layeredInvalidStatusRepair,
  /hold 的 modify 只允许 damage\/damage_taken\/lust\/lust_taken\/heal\/block\/summon_capacity/,
);
assert.match(layeredInvalidStatusRepair, /actions_per_activation 只能由一次性的 modify_summon 修改/);
assert.match(layeredInvalidStatusRepair, /modify_summon/);
const probabilityRepair = tower.formatTowerNodeStructureRepairPrompt(
  job,
  missingActionEffects,
  new Error(
    'enemy.action_config.probability.core_heat: probability must reference an existing action with a positive weight',
  ),
);
assert.match(probabilityRepair, /每个权重都必须是严格大于 0 的有限数字/);
assert.match(probabilityRepair, /绝不能用权重 0 排除/);

const invalidRosterPayload = JSON.parse(
  validBattle.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length),
);
invalidRosterPayload.payload.battle.enemies = [
  {
    ...invalidRosterPayload.payload.battle.enemy,
    id: 'machine:front:1',
  },
];
delete invalidRosterPayload.payload.battle.enemy;
const invalidRosterId = `<TOWER_NODE_RESULT>${JSON.stringify(invalidRosterPayload)}</TOWER_NODE_RESULT>`;
assert.throws(
  () => tower.parseTowerNodeResult(invalidRosterId, job),
  /payload is invalid/,
  'multi-enemy IDs with transport punctuation must be repaired before a node becomes ready',
);

const batchId = 'batch-current-window';
const batchJobs = [job, eventJob];
const batchPrompt = tower.formatTowerNodeBatchGenerationPrompt(batchId, batchJobs, {
  completeMvuContext,
  deckBalanceContext: '共享卡组强度预算',
  enemyLineageContext: '共享敌人谱系',
  customRequirements: '共享玩家要求',
  difficultyPercent: 80,
});
assert.match(batchPrompt, /必须在这一次响应中全部生成/);
assert.match(batchPrompt, /node_count=2/);
assert.match(batchPrompt, /results 必须恰好 2 项/);
assert.match(batchPrompt, /\[流派与敌人创作方法\]/);
for (const generatedPrompt of [prompt, batchPrompt]) {
  const { towerGameplayDesignGuidance } = require('../src/game-core/towerGameplayGuidance.ts');
  assert.equal(
    generatedPrompt.split(towerGameplayDesignGuidance()).length,
    2,
    'single and batch jobs carry the complete shared design guide exactly once',
  );
  assert.match(generatedPrompt, /\[遭遇玩法复核，仅内部推演\]/);
  assert.match(generatedPrompt, /人数严格遵守本节点程序预定的1至5名敌人；选择单敌时也要有回合压力/);
  assert.match(generatedPrompt, /不能假造 ally_died 或敌人 card_played 事件/);
  assert.match(generatedPrompt, /sequence_then_probability 仅执行一次前缀再转随机/);
}
assert.match(batchPrompt, /比较同批与近期遭遇，在程序预定人数内主动变化职责、行动周期和核心联动/);
assert.match(batchPrompt, /\[最终逐节点结构复核\]/);
assert.match(batchPrompt, new RegExp(`${eventJob.nodeId} \\(event\\).*outcome\\.resources`));
assert.match(batchPrompt, /\[最终逐节点数量复核\]/);
assert.match(batchPrompt, new RegExp(`${job.nodeId}: reward\\.card 恰好`));
assert.match(batchPrompt, /引用新状态的候选自身必须携带完整 statuses/);
assert.match(batchPrompt, /spawn_summon\.modifiers 的六种 modifier 值必须是有限数字/);
assert.match(batchPrompt, /creates 必须与 trigger 同级放在内容根部/);
assert.match(batchPrompt, /召唤 action 要让主人获得收益必须使用 summoner_effects/);
assert.match(batchPrompt, /pick:"all" 时 discard\/exhaust\/recover\/copy\/double\/remove_card 的操作值也必须是 "all"/);
assert.match(batchPrompt, /cards\/card 只放 Attack\/Skill\/Power\/Event\/Curse/);
assert.equal((batchPrompt.match(/LATEST_MVU_TAIL_IS_VISIBLE/g) || []).length, 1);
const batchSchema = tower.createTowerNodeBatchJsonSchema(batchId, batchJobs).value;
assert.equal(batchSchema.properties.batch_id.const, batchId);
assert.equal(batchSchema.properties.results.minItems, 2);
assert.equal(batchSchema.properties.results.maxItems, 2);
assert.equal(batchSchema.properties.results.items.oneOf.length, 2);
const battleRewardSchema = batchSchema.properties.results.items.oneOf[0].properties.reward;
assert.match(battleRewardSchema.properties.card.description, /必须恰好包含/);
assert.equal(batchSchema.$defs.mwgEnemy.properties.action_config.properties.probability.minProperties, 1);
assert.equal(
  batchSchema.$defs.mwgEnemy.properties.action_config.properties.probability.additionalProperties.exclusiveMinimum,
  0,
);
const battleEntry = JSON.parse(validBattle.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length));
const eventEntry = JSON.parse(eventText.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length));
const batchText = JSON.stringify({
  spec: tower.TOWER_NODE_BATCH_RESULT_SPEC,
  batch_id: batchId,
  based_on_revision: job.basedOnRevision,
  results: [eventEntry, battleEntry],
});
const parsedBatch = tower.parseTowerNodeBatchResult(batchText, batchId, batchJobs);
assert.deepEqual(
  parsedBatch.results.map(entry => entry.node_id),
  batchJobs.map(entry => entry.nodeId),
);
const redundantNullEnemyEntry = structuredClone(battleEntry);
redundantNullEnemyEntry.payload.battle.enemies = [
  {
    ...redundantNullEnemyEntry.payload.battle.enemy,
    id: redundantNullEnemyEntry.payload.battle.enemy.id || 'single_enemy',
  },
];
redundantNullEnemyEntry.payload.battle.enemy = null;
const parsedRedundantNullEnemy = tower.parseTowerNodeResult(JSON.stringify(redundantNullEnemyEntry), job);
assert.equal('enemy' in parsedRedundantNullEnemy.payload.battle, false);
assert.equal(parsedRedundantNullEnemy.payload.battle.enemies.length, 1);
const extraCloserBatch = batchText.replace(
  `},{"spec":"${tower.TOWER_NODE_RESULT_SPEC}"`,
  `}},{"spec":"${tower.TOWER_NODE_RESULT_SPEC}"`,
);
assert.deepEqual(
  tower.parseTowerNodeBatchResult(extraCloserBatch, batchId, batchJobs).results.map(entry => entry.node_id),
  batchJobs.map(entry => entry.nodeId),
  'an impossible extra object closer between array entries is a deterministic transport repair',
);
const semicolonBatch = batchText.replace(',"batch_id"', ';"batch_id"');
assert.deepEqual(
  tower.parseTowerNodeBatchResult(semicolonBatch, batchId, batchJobs).results.map(entry => entry.node_id),
  batchJobs.map(entry => entry.nodeId),
  'a semicolon outside JSON strings is a deterministic mistyped member separator',
);
assert.equal(
  tower.removeImpossibleJsonClosers('{"text":"literal } ] and \\\" quote","list":[1]}'),
  '{"text":"literal } ] and \\\" quote","list":[1]}',
  'transport repair must never alter braces inside JSON strings',
);
assert.equal(
  tower.replaceOutsideStringJsonSemicolons('{"text":"keep; ；","value":1;"next":2}'),
  '{"text":"keep; ；","value":1,"next":2}',
  'transport repair must not alter semicolons inside JSON strings',
);
assert.throws(
  () =>
    tower.parseTowerNodeBatchResult(
      JSON.stringify({
        spec: tower.TOWER_NODE_BATCH_RESULT_SPEC,
        batch_id: batchId,
        based_on_revision: job.basedOnRevision,
        results: [battleEntry],
      }),
      batchId,
      batchJobs,
    ),
  /exactly 2 results/,
);
assert.match(
  tower.formatTowerNodeBatchStructureRepairPrompt(batchId, batchJobs, '{}', new Error('missing event')),
  /不得遗漏节点、增加节点、交换 request_id/,
);
assert.match(
  tower.formatTowerNodeBatchStructureRepairPrompt(batchId, batchJobs, '{}', new Error('mapped actions')),
  /VALIDATION_ERROR=mapped actions/,
);
assert.match(
  tower.formatTowerNodeBatchStructureRepairPrompt(batchId, batchJobs, '{}', new Error('mapped actions')),
  /actions 是对象映射，保留每个行动内容并转换成数组/,
);
assert.match(
  tower.formatTowerNodeBatchStructureRepairPrompt(batchId, batchJobs, '{}', new Error('mapped actions')),
  /按本次错误修复并复核/,
);
assert.match(
  tower.formatTowerNodeBatchStructureRepairPrompt(batchId, batchJobs, '{}', new Error('mapped actions')),
  /## effects 结构与目标/,
  'a focused batch repair must still include the complete public gameplay DSL',
);

const slotRepairSchema = tower.createTowerInitialSlotRepairJsonSchema([
  {
    token: 'r0',
    slots: [
      { token: 's0', kind: 'effect_sequence', action: 'replace_effect_sequence' },
      { token: 's1', kind: 'trigger_on', action: 'replace_value' },
    ],
  },
  {
    token: 'r1',
    slots: [{ token: 's0', kind: 'discard_strategy', action: 'replace_effect_sequence' }],
  },
]).value;
assert.equal(slotRepairSchema.properties.spec.const, tower.TOWER_INITIAL_SLOT_REPAIR_SPEC);
assert.deepEqual(slotRepairSchema.properties.roots.required, ['r0', 'r1']);
assert.equal(slotRepairSchema.properties.roots.additionalProperties, false);
assert.deepEqual(slotRepairSchema.properties.roots.properties.r0.properties.slots.required, ['s0', 's1']);
assert.equal(slotRepairSchema.properties.roots.properties.r0.properties.slots.additionalProperties, false);
const finiteEffectRefs =
  slotRepairSchema.properties.roots.properties.r0.properties.slots.properties.s0.properties.value.items.oneOf.map(
    entry => entry.allOf[0].$ref,
  );
assert.deepEqual(finiteEffectRefs, [
  '#/$defs/amountEffect',
  '#/$defs/healEffect',
  '#/$defs/blockEffect',
  '#/$defs/energyEffect',
  '#/$defs/lustEffect',
  '#/$defs/setEffect',
  '#/$defs/drawEffect',
  '#/$defs/applyStatusEffect',
  '#/$defs/removeStatusEffect',
  '#/$defs/resourceEffect',
  '#/$defs/moveCardEffect',
  '#/$defs/recoverEffect',
  '#/$defs/advancedZoneEffect',
  '#/$defs/selectCardEffect',
  '#/$defs/reduceCostEffect',
]);
assert.equal(
  JSON.stringify(slotRepairSchema).includes('"eal_damage"'),
  false,
  'misspelled effects cannot be emitted by a finite slot',
);
assert.equal(
  JSON.stringify(slotRepairSchema).includes('"to_modify"'),
  false,
  'unsupported effect fields cannot be emitted by a finite slot',
);
const discardStrategy = slotRepairSchema.properties.roots.properties.r1.properties.slots.properties.s0.properties.value;
assert.deepEqual(
  discardStrategy.oneOf.map(entry => entry.properties.mode.const),
  ['discard_all', 'discard_selected'],
);
assert.throws(
  () =>
    tower.createTowerInitialSlotRepairJsonSchema([
      {
        token: 'r0',
        slots: [],
        allowSupportStatuses: true,
        supportStatusIds: [],
      },
    ]),
  /状态 ID 已被程序提取/,
  'support status output cannot be enabled without a finite program-extracted ID set',
);
assert.throws(
  () =>
    tower.createTowerInitialSlotRepairJsonSchema([
      {
        token: 'r0',
        slots: [],
        allowSupportResources: true,
        supportResourceIds: [],
      },
    ]),
  /资源 ID 已被程序提取/,
  'support resource output cannot be enabled without a finite program-extracted ID set',
);

// Repair context is an exact read-only dependency boundary, even when the
// rejected text cannot be parsed. Do not serialize unrelated save metadata.
{
  const { formatTowerRepairDefinitionContext } = require('../src/game-core/towerRepairContext.ts');
  const statuses = [
    {
      id: 'debt',
      name: '债',
      emoji: '🧾',
      type: 'debuff',
      stacks_change: -1,
      triggers: { turn_start: [{ damage: 3, damage_type: 'hp_loss', to: 'self' }] },
    },
    { id: 'linked', name: '关联', type: 'buff', triggers: { apply: { apply_status: 'debt', stacks: 2 } } },
  ];
  const resources = [{ id: 'spark', name: '火花', emoji: '✨', current: 2, max: 7, refresh: 'retain' }];
  const battle = {
    statuses,
    core: { resources, private_note: 'DO_NOT_INCLUDE_CORE_NOTE' },
    cards: [
      { id: 'owned_card', runInstanceId: 'one' },
      { id: 'owned_card', runInstanceId: 'two' },
    ],
    artifacts: [{ id: 'owned_relic' }],
    items: [{ id: 'owned_item' }],
    future_nodes: { statuses: [{ id: 'not_owned' }] },
    private_note: 'DO_NOT_INCLUDE_BATTLE_NOTE',
  };
  const before = structuredClone(battle);
  for (const prompt of [
    formatTowerRepairDefinitionContext(battle),
    tower.formatTowerNodeStructureRepairPrompt(job, 'invalid JSON', new Error('syntax'), battle),
    tower.formatTowerNodeBatchStructureRepairPrompt(batchId, batchJobs, 'invalid JSON', new Error('syntax'), battle),
    tower.formatTowerOpeningStructureRepairPrompt(
      { requestId: 'opening', basedOnRevision: 0 },
      'invalid JSON',
      new Error('syntax'),
      battle,
    ),
  ]) {
    const line = prompt.split('\n').find(line => line.startsWith('EXISTING_DEFINITIONS='));
    assert.ok(line);
    assert.deepEqual(JSON.parse(line.slice('EXISTING_DEFINITIONS='.length)), {
      statuses,
      resources,
      owned_content_ids: { cards: ['owned_card'], artifacts: ['owned_relic'], items: ['owned_item'] },
    });
    assert.doesNotMatch(prompt, /DO_NOT_INCLUDE_|not_owned|runInstanceId/);
    assert.match(prompt, /不得把它替换成已有机制来消除冲突/);
  }
  assert.deepEqual(battle, before, 'formatting never mutates authored definitions or ownership');
  for (const missing of [undefined, null, [], 12]) assert.equal(formatTowerRepairDefinitionContext(missing), '');
}
console.log('tower node and opening prompt/result contracts passed');
