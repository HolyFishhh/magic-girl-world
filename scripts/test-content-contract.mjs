import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

assert.equal(
  core.contentPathToBattlePath('desireEffects.player.effects[1].status'),
  'battle.player_lust_effect.effects[1].status',
);
assert.equal(
  core.contentPathToBattlePath('desireEffects.enemy.effects[0].status'),
  'battle.enemy.lust_effect.effects[0].status',
);

const content = core.createContentPack({
  cards: [{ id: 'strike', name: '斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: [{ damage: 8 }] }],
  statuses: [{ id: 'focus', name: '专注', emoji: '✦', type: 'buff', triggers: { hold: [{ modify: 'block', add: 'stacks' }] } }],
  activeStatuses: [{ id: 'focus', stacks: 2 }],
  relics: [{ id: 'guard', name: '守护石', trigger: 'battle_start', effects: [{ block: 3 }] }],
  items: [{ id: 'tonic', name: '补剂', count: 1, effects: [{ heal: 5 }] }],
  abilities: [],
  enemy: { name: '训练靶', actions: [{ name: '攻击', effects: [{ damage: 4 }] }] },
});

assert.equal(core.validateContentPackContract(content, { requireEnemy: true, requireExecutable: true }).ok, true);

const structuredPassiveEnemyAbility = core.createContentPack({
  ...content,
  enemy: {
    name: '巡卫',
    actions: [{ name: '压杀', effects: [{ damage: 4 }] }],
    abilities: [{
      id: 'rail_pressure',
      name: '轨压',
      trigger: { on: 'passive', effects: [{ modify: 'damage', add: 1 }] },
    }],
  },
});
assert.equal(
  core.validateContentPackContract(structuredPassiveEnemyAbility, {
    requireEnemy: true,
    requireExecutable: true,
  }).ok,
  true,
  'enemy abilities must accept the same structured passive trigger used by player abilities and relics',
);

const invalidTimedEnemyModifier = core.createContentPack({
  ...structuredPassiveEnemyAbility,
  enemy: {
    ...structuredPassiveEnemyAbility.enemy,
    abilities: [{
      id: 'invalid_timed_modifier',
      name: '错误时序',
      trigger: { on: 'turn_start', effects: [{ modify: 'damage', add: 1 }] },
    }],
  },
});
const invalidTimedEnemyModifierResult = core.validateContentPackContract(invalidTimedEnemyModifier, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(invalidTimedEnemyModifierResult.ok, false);
assert.ok(invalidTimedEnemyModifierResult.issues.some(issue => issue.code === 'MODIFIER_NOT_ALLOWED'));

const malformed = core.createContentPack({
  ...content,
  cards: [{ id: 'bad', effects: [{ damage: 'unknown()' }] }],
});
const malformedResult = core.validateContentPackContract(malformed, { requireEnemy: true, requireExecutable: true });
assert.equal(malformedResult.ok, false);
assert.match(core.formatContentContractIssues(malformedResult.issues), /cards\[0\]\.effects/);

const duplicate = core.createContentPack({
  ...content,
  cards: [
    { id: 'same', effects: [{ damage: 1 }] },
    { id: 'same', effects: [{ block: 1 }] },
  ],
});
const duplicateResult = core.validateContentPackContract(duplicate, { requireEnemy: true, requireExecutable: true });
assert.equal(duplicateResult.ok, false);
assert.ok(duplicateResult.issues.some(issue => issue.code === 'DUPLICATE_ID'));

const persistentOwnedCopies = core.createContentPack({
  ...content,
  cards: [
    {
      id: 'same_owned_card', runInstanceId: 'same_owned_card__run__1', name: '鎸佷箙鍓湰 1',
      type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: [{ damage: 1 }],
    },
    {
      id: 'same_owned_card', runInstanceId: 'same_owned_card__run__2', name: '鎸佷箙鍓湰 2',
      type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: [{ damage: 1 }],
    },
  ],
});
assert.equal(
  core.validateContentPackContract(persistentOwnedCopies, { requireEnemy: true, requireExecutable: true }).ok,
  true,
  'one record per owned card may share a template id when every run identity is unique',
);

const duplicateOwnedIdentity = core.createContentPack({
  ...persistentOwnedCopies,
  cards: persistentOwnedCopies.cards.map(card => ({ ...card, runInstanceId: 'same_owned_card__run__1' })),
});
const duplicateOwnedIdentityResult = core.validateContentPackContract(duplicateOwnedIdentity, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(duplicateOwnedIdentityResult.ok, false);
assert.ok(duplicateOwnedIdentityResult.issues.some(issue => issue.code === 'DUPLICATE_RUN_INSTANCE_ID'));

const incompleteModern = core.createContentPack({
  ...content,
  cards: [{ id: 'bad_card', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 3 }, innate: 'true' }],
  relics: [{ id: 'bad_relic', name: '无触发遗物', rarity: 'Common', effects: { block: 2 } }],
});
const incompleteResult = core.validateContentPackContract(incompleteModern, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(incompleteResult.ok, false);
assert.ok(incompleteResult.issues.some(issue => issue.path === 'cards[0].name' && issue.code === 'INVALID_NAME'));
assert.ok(incompleteResult.issues.some(issue => issue.path === 'cards[0].innate' && issue.code === 'INVALID_BOOLEAN'));
assert.ok(incompleteResult.issues.some(issue => issue.path === 'relics[0].trigger' && issue.code === 'MISSING_TRIGGER'));

const lifecycleContent = core.createContentPack({
  ...content,
  relics: [
    { id: 'draw_guard', name: '抽牌护幕', rarity: 'Uncommon', trigger: 'on_draw', effects: { block: 1 } },
    { id: 'recycle_focus', name: '回洗专注', rarity: 'Rare', trigger: 'on_shuffle', effects: { energy: 1 } },
  ],
});
assert.equal(
  core.validateContentPackContract(lifecycleContent, { requireEnemy: true, requireExecutable: true }).ok,
  true,
);
const recursiveDrawContent = core.createContentPack({
  ...content,
  relics: [{ id: 'loop', name: '循环', rarity: 'Rare', trigger: 'on_draw', effects: { draw: 1 } }],
});
const recursiveDrawResult = core.validateContentPackContract(recursiveDrawContent, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(recursiveDrawResult.ok, false);
assert.ok(recursiveDrawResult.issues.some(issue => issue.code === 'RECURSIVE_DRAW_NOT_ALLOWED'));

const removedDiscardPayment = core.createContentPack({
  ...content,
  cards: [{ id: 'old_payment', name: '旧弃牌费用', type: 'Attack', rarity: 'Common', cost: 1, discard_requirement: 1, effects: { damage: 8 } }],
});
const removedDiscardPaymentResult = core.validateContentPackContract(removedDiscardPayment, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(removedDiscardPaymentResult.ok, false);
assert.ok(removedDiscardPaymentResult.issues.some(issue => issue.code === 'REMOVED_CARD_FIELD'));

const malformedEntryPack = core.createContentPack({ ...content, cards: ['bad-entry', content.cards[0]] });
const malformedEntryResult = core.validateContentPackContract(malformedEntryPack, {
  requireEnemy: true,
  requireExecutable: true,
});
assert.equal(malformedEntryResult.ok, false);
assert.equal(malformedEntryResult.issues[0].path, 'cards[0]');

let contractError = null;
try {
  core.createBattleRequest({ content: malformed, player: { hp: 10, maxHp: 20, lust: 0, maxLust: 100, level: 1 } });
} catch (error) {
  contractError = error;
}
assert.ok(contractError instanceof core.BattleContentContractError);
assert.match(contractError.message, /battle content contract is invalid/);
assert.ok(contractError.issues.some(issue => issue.path.startsWith('cards[0].effects')));

console.log('Portable content contract validates modern effects once and protects every BattleRequest host.');
