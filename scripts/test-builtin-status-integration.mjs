import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { BUILTIN_STATUS_DEFINITIONS } = require('../src/game-core/builtinStatusCatalog.ts');
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
