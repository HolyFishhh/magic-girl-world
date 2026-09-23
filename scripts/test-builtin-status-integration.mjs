import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { BUILTIN_STATUS_DEFINITIONS, builtinStatusReferenceContract, builtinStatusUsageContract } = require('../src/game-core/builtinStatusCatalog.ts');
const { compileInitialDraftToMvu, INITIAL_DRAFT_SPEC } = require('../src/game-core/initialDraft.ts');
const { createContentPackFromMvuBattle } = require('../src/runtime/contentPackAdapter.ts');
const { prepareTowerBattleForActivation } = require('../src/runtime/towerContentActivation.ts');
const { applyRewardSelectionsToStat } = require('../src/common/rewardTransactions.ts');
const { presentCompactContent } = require('../src/game-core/contentPresentation.ts');

const ids = values => values.map(value => value.id);
const requiredBuiltinIds = ['sts_strength', 'sts_weak', 'sts_poison', 'sts_ritual', 'sts_barricade', 'sts_vigor'];
for (const id of requiredBuiltinIds) assert.ok(ids(BUILTIN_STATUS_DEFINITIONS).includes(id), `${id} is catalogued`);

const starter = {
  id: 'builtin_start', name: '仪式开端', type: 'Skill', rarity: 'Common', cost: 1, quantity: 1,
  effects: { apply_status: 'sts_ritual', stacks: 1, to: 'self' },
};
const draft = {
  spec: INITIAL_DRAFT_SPEC,
  narrative: '测试内置状态。',
  player: { core: { emoji: '✨', hp: 50, max_hp: 50, lust: 0, max_lust: 100 }, cards: [starter] },
  opening: { title: '开局', narrative: '测试', choices: [] },
  registry: { statuses: [], resources: [], templates: [] },
};
const compiled = compileInitialDraftToMvu(draft);
assert.equal(compiled.ok, true, JSON.stringify(compiled));
assert.deepEqual(ids(compiled.value.player.statuses).sort(), ['sts_ritual', 'sts_strength'],
  'initial draft materializes only referenced built-ins and ritual dependency');
const requestedStrength = { ...starter, id: 'requested_strength', name: '通用力量',
  effects: { apply_status: 'sts_strength', stacks: 1, to: 'self' } };
const strengthOnly = compileInitialDraftToMvu({ ...draft,
  player: { ...draft.player, cards: [requestedStrength] },
});
assert.equal(strengthOnly.ok, true, JSON.stringify(strengthOnly));
assert.deepEqual(ids(strengthOnly.value.player.statuses), ['sts_strength'],
  'explicit player request can directly use the executable strength preset without fabricating a duplicate status');


const baseBattle = () => ({
  core: { emoji: '✨', hp: 50, max_hp: 50, lust: 0, max_lust: 100, resources: [] },
  cards: [
    { id: 'strike', name: '打击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 6 } },
  ],
  statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [], enemy: null, enemies: [],
});

const rewardCard = {
  id: 'ritual_reward', name: '仪式馈赠', type: 'Skill', rarity: 'Rare', cost: 1, quantity: 1,
  effects: { apply_status: 'sts_ritual', stacks: 2, to: 'self' },
};
const rewardStat = {
  battle: baseBattle(),
  reward: { card: [rewardCard], artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 } },
};
applyRewardSelectionsToStat(rewardStat, { cards: [0], artifacts: [], items: [] });
assert.deepEqual(ids(rewardStat.battle.statuses).sort(), ['sts_ritual', 'sts_strength'],
  'claiming a wrapper-free built-in reward persists its complete dependency closure');
assert.equal(rewardStat.battle.cards.some(card => card.id === 'ritual_reward'), true);

const generatedBattle = {
  enemies: [{
    id: 'venom_test', name: '毒雾试炼者', emoji: '☠️', hp: 24, max_hp: 24, lust: 0, max_lust: 100,
    actions: [{ name: '下毒', effects: { apply_status: 'sts_poison', stacks: 2, to: 'opponent' } }],
    status_effects: [{ id: 'sts_barricade', stacks: 1 }], action_mode: 'random', action_config: {},
  }],
};
const activated = prepareTowerBattleForActivation(baseBattle(), generatedBattle);
assert.deepEqual(ids(activated.statuses).sort(), ['sts_barricade', 'sts_poison'],
  'enemy activation stores the complete built-in definitions used by actions and active statuses');

const restoredPack = createContentPackFromMvuBattle({
  ...baseBattle(), cards: [rewardCard], enemy: generatedBattle.enemies[0], enemies: generatedBattle.enemies,
});
assert.deepEqual(ids(restoredPack.statuses).sort(), ['sts_barricade', 'sts_poison', 'sts_ritual', 'sts_strength'],
  'content-pack restoration closes player and enemy built-in references even for an older sparse snapshot');
const statusNames = Object.fromEntries(restoredPack.statuses.map(status => [status.id, status.name]));
const display = presentCompactContent(rewardCard, 'card', { statusNames, statusDefinitions: Object.fromEntries(restoredPack.statuses.map(status => [status.id, status])) });
assert.match(display.rulesText, /仪式/);
assert.doesNotMatch(display.rulesText, /sts_ritual/);

console.log('Builtin status integration: initial draft, reward claim, enemy activation, sparse restore, and Chinese rule display passed.');

const reference = builtinStatusReferenceContract();
const usage = builtinStatusUsageContract();
for (const requirement of ['默认仅用于低质量敌人', '或偏中立卡牌', '未明确要求时应避免', '玩家明确要求通用状态', '允许直接引用对应预设ID', 'sts_strength', '剧情相关敌人和复杂敌人', '不能给玩家卡组或重要敌人只改名字', '不是程序质量硬门槛', '结构修复不得据此拒绝、删除或改写已合法']) {
  assert.ok(usage.includes(requirement), `preset scope keeps authoring requirement: ${requirement}`);
}
assert.ok(reference.includes(usage));
for (const file of ['2战斗内容生成要求.md', '3战斗场景生成.md', '4首条消息变量更新.md', '5变量更新.MD', '7初始战斗内容修复.md', '8战斗场景修复.md', '9卡牌常驻规范.md']) {
  const text = readFileSync(`worldbook_new/${file}`, 'utf8').replaceAll('\r\n', '\n');
  assert.equal(text.split('<!-- shared:builtin-status-reference -->\n')[1].split('\n<!-- /shared:builtin-status-reference -->')[0], reference, `${file} shares the executable preset whitelist`);
  assert.doesNotMatch(text, /程序没有内置状态|系统没有任何按名称自动生效的内置状态|主要供小兵|预设优先用于|玩家核心流派.*应优先/);
}
const guide = readFileSync('worldbook_new/2战斗内容生成要求.md', 'utf8');
assert.equal(guide.split('### 程序内置通用状态目录').length, 2, 'catalog appears once, avoiding stale conflicting rule copies');
for (const definition of BUILTIN_STATUS_DEFINITIONS) {
  assert.equal(guide.split(`| \`${definition.id}\` |`).length, 2, `${definition.id} has one documented rule row`);
  assert.ok(guide.includes('| `' + definition.id + '` | ' + definition.name + ' | ' + (definition.type === 'buff' ? '增益' : '减益') + ' |'), 'worldbook names and categories match executable definitions');
}
assert.match(guide, /`sly:true` 为灵巧/);
assert.match(guide, /只想要弃牌触发独立效果用 `discard_effects`/);
assert.match(guide, /`on_discard:"purge"` 的公开词条名为“遗忘”/);
const { formatCompactEffectAuthoringContract, createTowerNodeJsonSchema, formatCompactEffectRepairContract } = require('../src/game-core/towerRequest.ts');
for (const placement of ['runtime', 'initial-draft']) assert.ok(formatCompactEffectAuthoringContract(placement).includes(reference));
for (const placement of ['runtime', 'initial-draft']) assert.match(formatCompactEffectAuthoringContract(placement), /玩家明确要求通用力量buff.*sts_strength/);
console.log('Builtin status worldbooks and both authoring protocols share one whitelist; sly/forget are documented.');

for (const kind of ['battle', 'elite', 'boss']) assert.ok(JSON.stringify(createTowerNodeJsonSchema(kind)).includes(JSON.stringify(reference).slice(1, -1)), `${kind} response schema carries the same preset whitelist`);
assert.match(formatCompactEffectRepairContract('apply_status: INVALID_STATUS_REFERENCE'), /非预设/);
