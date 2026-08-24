import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

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
