import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const tower = require('../src/game-core/towerRequest.ts');

const job = {
  nodeId: 'act-1-floor-1-col-1',
  requestId: 'tower_1_1_test',
  basedOnRevision: 1,
  kind: 'battle',
  act: 1,
  floor: 1,
  contentSeed: 10,
  rewardSeed: 11,
  difficultyMultiplier: 1,
};
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
assert.match(prompt, /cards=3\/1/);
assert.match(prompt, /card=3项、artifact=0项、item=1项/);
assert.match(prompt, /不得复制当前 reward 的 request、disabled_categories、pool_revision、reroll_count/);
assert.match(prompt, /不得复用当前游戏事实里已经存在的 id/);
assert.match(prompt, /战斗效果结构边界/);
assert.match(prompt, /禁止旧 effect、内部 spec\/op\/steps，以及 target、condition、operator、value 字段/);
assert.match(prompt, /敌人 abilities 每项必须有稳定英文 id/);
assert.match(prompt, /状态 triggers\.hold 只能放 modify\/出牌规则/);
assert.doesNotMatch(prompt, /```|<UpdateVariable>/);
assert.match(prompt, /只输出一个 JSON 对象/);

const completeMvuContext = JSON.stringify({
  stat_data: { padding: 'x'.repeat(3500) },
  mvu_tail_probe: 'LATEST_MVU_TAIL_IS_VISIBLE',
});
const completePrompt = tower.formatTowerNodeGenerationPrompt(job, {
  completeMvuContext,
  worldContext: '不应重复的世界摘要',
  playerContext: '不应重复的玩家摘要',
  difficultyPercent: 80,
});
assert.match(completePrompt, /\[当前完整游戏事实\]/);
assert.match(completePrompt, /LATEST_MVU_TAIL_IS_VISIBLE/, 'latest MVU tail must not be cut at the old 1800 limit');
assert.doesNotMatch(completePrompt, /不应重复的世界摘要|不应重复的玩家摘要/);

const battleReward = {
  card: [
    { id: 'reward_strike', name: '追击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 7 } },
    { id: 'reward_guard', name: '守势', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1, effects: { block: 7 } },
    { id: 'reward_cycle', name: '轮转', type: 'Skill', rarity: 'Uncommon', cost: 1, quantity: 1, effects: { draw: 1 } },
  ],
  artifact: [{ id: 'should_be_trimmed', name: '普通战不应发放的遗物' }],
  item: [{ id: 'reward_salve', name: '星露药剂', count: 1, effects: { heal: 6 } }],
  limits: { cards: 3, artifacts: 1, items: 1 },
};
const validBattle = `<TOWER_NODE_RESULT>${JSON.stringify({
  spec: tower.TOWER_NODE_RESULT_SPEC,
  node_id: job.nodeId,
  request_id: job.requestId,
  based_on_revision: job.basedOnRevision,
  kind: job.kind,
  title: '遭遇',
  narrative: '短暂的敌意在道路前方凝聚。',
  payload: { battle: { enemy: {
    name: '敌人', hp: 40, max_hp: 40, lust: 0, max_lust: 100,
    actions: [{ name: '试探', effects: { damage: 6 } }],
  } } },
  reward: battleReward,
})}</TOWER_NODE_RESULT>`;
const parsedBattle = tower.parseTowerNodeResult(validBattle, job);
assert.equal(parsedBattle.title, '遭遇');
assert.equal(parsedBattle.reward.card.length, 3);
assert.equal(parsedBattle.reward.artifact.length, 0, 'program budget removes forbidden normal-battle relics');
assert.equal(parsedBattle.reward.item.length, 1);
assert.deepEqual(parsedBattle.reward.limits, { cards: 1, artifacts: 0, items: 1 });
assert.equal(
  tower.parseTowerNodeResult(`${validBattle}${validBattle}`, job).title,
  '遭遇',
  'identical provider echoes should collapse to one scoped result',
);
assert.equal(
  tower.parseTowerNodeResult(`\`\`\`json\n${validBattle.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length)}\n\`\`\``, job).title,
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
  payload: { event: { choices: [
    { id: 'observe', label: '观察', outcome: { gold: 5 } },
    { id: 'leave', label: '离开', outcome: {} },
  ] } },
})}</TOWER_NODE_RESULT>`;
assert.equal(tower.parseTowerNodeResult(eventText, eventJob).kind, 'event');
const invalidEventOutcome = eventText.replace('"outcome":{"gold":5}', '"outcome":{"energy":2}');
assert.throws(
  () => tower.parseTowerNodeResult(invalidEventOutcome, eventJob),
  /payload is invalid/,
  'event outcomes must reject fields that the program cannot settle',
);

const openingInput = {
  requestId: 'opening-1',
  basedOnRevision: 0,
  seed: 7,
  context: { worldContext: '世界', playerContext: '玩家', difficultyPercent: 100 },
};
const openingPrompt = tower.formatTowerOpeningGenerationPrompt(openingInput);
assert.match(openingPrompt, /二至四个中文选择/);
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
  ],
})}</TOWER_OPENING_RESULT>`;
assert.equal(tower.parseTowerOpeningResult(openingText, openingInput).choices.length, 2);
assert.equal(
  tower.parseTowerOpeningResult(openingText.slice('<TOWER_OPENING_RESULT>'.length, -'</TOWER_OPENING_RESULT>'.length), openingInput).choices.length,
  2,
);
assert.equal(tower.createTowerOpeningJsonSchema().value.properties.spec.const, tower.TOWER_OPENING_RESULT_SPEC);
const battleSchema = tower.createTowerNodeJsonSchema('battle').value;
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
assert.deepEqual(Object.keys(battleSchema.properties.reward.properties.limits.properties), ['cards', 'artifacts', 'items']);
assert.deepEqual(
  battleSchema.properties.payload.properties.battle.properties.enemy.properties.actions.items.required,
  ['name', 'effects'],
);
assert.deepEqual(
  battleSchema.properties.payload.properties.battle.properties.enemy.properties.abilities.items.required,
  ['id', 'name', 'source', 'trigger'],
);
assert.deepEqual(
  battleSchema.properties.payload.properties.battle.properties.enemy.properties.abilities.items.properties.trigger.required,
  ['on', 'effects'],
);
assert.equal(
  battleSchema.properties.payload.properties.battle.properties.enemies.items.properties.id.pattern,
  '^[A-Za-z_][A-Za-z0-9_]*$',
);
assert.ok(
  battleSchema.properties.payload.properties.battle.properties.enemies.items.required.includes('id'),
  'multi-enemy roster entries require runtime-safe stable IDs',
);
assert.deepEqual(
  battleSchema.properties.payload.properties.battle.properties.statuses.items.required,
  ['id', 'name', 'emoji', 'type', 'triggers'],
);
const eventSchema = tower.createTowerNodeJsonSchema('event').value;
const eventPayloadSchema = eventSchema.properties.payload;
const eventChoiceSchema = eventPayloadSchema.properties.event.properties.choices.items;
const eventOutcomeSchema = eventChoiceSchema.properties.outcome;
assert.equal(eventPayloadSchema.additionalProperties, false);
assert.equal(eventPayloadSchema.properties.event.additionalProperties, false);
assert.equal(eventChoiceSchema.additionalProperties, false);
assert.equal(eventOutcomeSchema.additionalProperties, false);
assert.deepEqual(
  Object.keys(eventOutcomeSchema.properties),
  ['outcome', 'hp', 'max_hp', 'gold', 'card_removals', 'reward'],
);
assert.equal(eventOutcomeSchema.properties.reward.additionalProperties, false);
assert.equal(eventOutcomeSchema.properties.reward.properties.cards.maxItems, 6);
assert.deepEqual(
  eventOutcomeSchema.properties.reward.properties.cards.items.required,
  ['id', 'name', 'type', 'rarity'],
);
assert.deepEqual(
  eventOutcomeSchema.properties.reward.properties.cards.items.anyOf,
  [{ required: ['effects'] }, { required: ['trigger'] }],
);
assert.deepEqual(
  eventOutcomeSchema.properties.reward.properties.artifacts.items.required,
  ['id', 'name', 'rarity', 'trigger'],
);
assert.deepEqual(
  eventOutcomeSchema.properties.reward.properties.items.items.required,
  ['id', 'name', 'count', 'effects'],
);
assert.deepEqual(
  Object.keys(eventOutcomeSchema.properties.reward.properties.limits.properties),
  ['cards', 'artifacts', 'items'],
);
assert.match(
  tower.formatTowerNodeStructureRepairPrompt(job, missingActionEffects, new Error('missing effects')),
  /每个 action 必须有非空 name 和可执行 effects/,
);
assert.match(
  tower.formatTowerNodeGenerationPrompt(eventJob, { difficultyPercent: 80 }),
  /描述中的数值不能代替 effects/,
);
assert.match(
  tower.formatTowerNodeStructureRepairPrompt(job, missingActionEffects, new Error('missing effects')),
  /不得把 trigger 塞进 effects 数组项/,
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
assert.match(powerRepairPrompt, /持续能力要改成 trigger:\{on:"合法触发时机",effects:浅层效果\}/);
assert.match(powerRepairPrompt, /只在打出当下结算的效果要把 type 改为 Skill 或 Attack/);
assert.match(
  tower.formatTowerNodeGenerationPrompt({ ...job, kind: 'shop' }, { difficultyPercent: 80 }),
  /Power 是持续能力牌/,
);
const unknownTargetRepair = tower.formatTowerNodeStructureRepairPrompt(
  job,
  missingActionEffects,
  new Error('enemy.actions[2].effects.to: Unknown field: to'),
);
assert.match(unknownTargetRepair, /不支持字段 to：必须从该路径删除/);
assert.match(unknownTargetRepair, /敌人行动的伤害与欲望伤害默认作用于玩家/);

const invalidRosterPayload = JSON.parse(
  validBattle.slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length),
);
invalidRosterPayload.payload.battle.enemies = [{
  ...invalidRosterPayload.payload.battle.enemy,
  id: 'machine:front:1',
}];
delete invalidRosterPayload.payload.battle.enemy;
const invalidRosterId = `<TOWER_NODE_RESULT>${JSON.stringify(invalidRosterPayload)}</TOWER_NODE_RESULT>`;
assert.throws(
  () => tower.parseTowerNodeResult(invalidRosterId, job),
  /payload is invalid/,
  'multi-enemy IDs with transport punctuation must be repaired before a node becomes ready',
);

console.log('tower node and opening prompt/result contracts passed');
