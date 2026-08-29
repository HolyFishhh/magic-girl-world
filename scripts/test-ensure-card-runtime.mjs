import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { ReferenceBattleRuntimeHost } = require(resolve('src/adapters/referenceBattleRuntimeHost.ts'));

const program = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'damage', target: 'opponent', amount: 5 }],
};
const definition = {
  id: 'forge_blade',
  name: '锻造兵刃',
  emoji: '⚔️',
  type: 'Attack',
  rarity: 'Rare',
  cost: 1,
  description: '造成伤害。',
  program,
};

function card(instanceId, origin = 'generated') {
  return {
    id: instanceId,
    originalId: definition.id,
    templateId: definition.id,
    runInstanceId: `${instanceId}__run`,
    combatInstanceId: instanceId,
    origin,
    name: definition.name,
    emoji: definition.emoji,
    type: definition.type,
    rarity: definition.rarity,
    cost: definition.cost,
    description: definition.description,
    effect: '',
    effectProgram: structuredClone(program),
  };
}

function createRuntime(state = core.createEmptyBattleState()) {
  const host = new ReferenceBattleRuntimeHost(state);
  const events = [];
  const runtime = host.createCardEffectRuntime({
    drawCards: async () => {},
    chooseCards: async candidates => candidates.map(entry => entry.id),
    onCardDiscarded: async () => {},
    onCardExhausted: async () => {},
    autoPlayCard: async () => true,
    present: event => events.push(event),
  });
  return { host, runtime, events };
}

const copiedOnlyState = core.createEmptyBattleState();
copiedOnlyState.player.hand = [card('forge_blade__copy', 'copied')];
const copiedOnly = createRuntime(copiedOnlyState);
const ensuredRoots = await copiedOnly.runtime.execute({
  type: 'ensure_card', zone: 'hand', card: definition, minimum: 1, includeCopies: false,
});
assert.equal(ensuredRoots.length, 1);
assert.equal(copiedOnly.host.getPlayer().hand.length, 2, 'a temporary copy does not satisfy the root minimum');
assert.equal(ensuredRoots[0].origin, 'generated');

const exhaustedState = core.createEmptyBattleState();
exhaustedState.player.exhaustPile = [card('forge_blade__root')];
const exhausted = createRuntime(exhaustedState);
await exhausted.runtime.execute({
  type: 'ensure_card', zone: 'hand', card: definition, minimum: 1, includeCopies: false,
});
assert.equal(exhausted.host.getPlayer().hand.length, 0);
assert.equal(exhausted.events.length, 0, 'an exhausted root is still a current combat instance');

exhausted.host.getPlayer().hand.push(card('forge_blade__copy', 'copied'));
await exhausted.runtime.execute({
  type: 'apply_card_patch',
  selector: {
    zone: 'combat', pick: 'all',
    filter: { templateId: definition.id, rootOnly: true },
  },
  patch: { kind: 'numeric', stat: 'damage', operator: 'add', value: 3, scope: 'combat' },
});
assert.equal(exhausted.host.getPlayer().exhaustPile[0].effectProgram.steps[0].amount, 8);
assert.equal(exhausted.host.getPlayer().hand[0].effectProgram.steps[0].amount, 5, 'root-only patch excludes copies');

const sameResolution = createRuntime();
await sameResolution.runtime.execute({
  type: 'ensure_card', zone: 'hand', card: definition, minimum: 1, includeCopies: false,
});
await sameResolution.runtime.execute({
  type: 'apply_card_patch',
  selector: { zone: 'combat', pick: 'all', filter: { templateId: definition.id, rootOnly: true } },
  patch: { kind: 'numeric', stat: 'damage', operator: 'add', value: 4, scope: 'combat' },
});
assert.equal(sameResolution.host.getPlayer().hand[0].effectProgram.steps[0].amount, 9, 'a first-time instance can be patched immediately');

const futureState = core.createEmptyBattleState();
futureState.player.hand = [card('forge_blade__old')];
const future = createRuntime(futureState);
await future.runtime.execute({
  type: 'apply_card_patch',
  selector: { zone: 'hand', pick: 'all', filter: { templateId: definition.id, rootOnly: true } },
  patch: {
    kind: 'numeric', stat: 'damage', operator: 'add', value: 10, scope: 'combat',
    match: 'template', includeFutureCopies: true,
  },
});
await future.runtime.execute({
  type: 'remove_cards',
  selector: { zone: 'hand', pick: 'all', filter: { templateId: definition.id } },
  amount: 1,
});
await future.runtime.execute({
  type: 'ensure_card', zone: 'hand', card: definition, minimum: 1, includeCopies: false,
});
assert.equal(future.host.getPlayer().hand[0].effectProgram.steps[0].amount, 5, 'ensure does not accumulate old future-template patches');
assert.equal(future.host.getPlayer().hand[0].patches?.length || 0, 0);

const overflowState = core.createEmptyBattleState();
overflowState.player.hand = Array.from({ length: 10 }, (_, index) => ({
  ...card(`filler_${index}`),
  originalId: `filler_${index}`,
  templateId: `filler_${index}`,
}));
const overflow = createRuntime(overflowState);
await overflow.runtime.execute({
  type: 'ensure_card', zone: 'hand', card: definition, minimum: 1, includeCopies: false,
});
assert.equal(overflow.host.getPlayer().hand.length, 10);
assert.equal(overflow.host.getPlayer().discardPile.length, 1);
assert.equal(overflow.events.at(-1).zone, 'discard', 'hand overflow uses the shared discard fallback');

const rollback = createRuntime();
const token = rollback.host.beginScopedTransaction('ensure_card_test');
try {
  await rollback.runtime.execute({
    type: 'ensure_card', zone: 'hand', card: definition, minimum: 1, includeCopies: false,
  });
  throw new Error('forced failure after ensure');
} catch {
  rollback.host.rollbackTransaction(token);
}
assert.equal(rollback.host.getPlayer().hand.length, 0, 'the ordinary battle transaction restores ensured instances');

const compact = core.compileCompactEffectList([
  { ensure_card: definition.id, to: 'hand', minimum: 1 },
  {
    patch_card: 'damage', add: 2, scope: 'combat', from: 'combat', pick: 'all',
    template_id: definition.id, root_only: true,
  },
], {
  creates: [{
    id: definition.id, name: definition.name, emoji: definition.emoji,
    type: definition.type, rarity: definition.rarity, cost: definition.cost,
    effects: [{ damage: 5 }],
  }],
});
assert.equal(compact.ok, true);
assert.equal(compact.value.steps[0].op, 'ensure_card');
assert.equal(compact.value.steps[1].selector.zone, 'combat');
assert.equal(compact.value.steps[1].selector.filter.rootOnly, true);
assert.equal(
  core.compileCompactEffectList([{ ensure_card: definition.id, include_copies: 'yes' }], {
    creates: [{ id: definition.id, name: definition.name, effects: [{ damage: 5 }] }],
  }).ok,
  false,
);

console.log('ensure_card preserves combat-instance identity, overflow, patch scope, and rollback semantics.');
