import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const adapter = require(resolve('src/fish/core/mvuBattleAdapter.ts'));
const settlement = require(resolve('src/runtime/battleSettlementAdapter.ts'));
const { TavernBattleEndHost } = require(resolve('src/fish/core/battleEndHost.ts'));

const definitions = [{
  id: 'echo_blade', name: '回响刃', emoji: 'E', type: 'Attack', rarity: 'Common', cost: 1, quantity: 1,
  description: '造成伤害。', effects: { damage: 6 },
}];
const [base] = adapter.convertMvuCards(definitions);
assert.ok(base.runInstanceId);
const expandedPair = core.migratePersistentRunDeck([{ ...definitions[0], quantity: 2 }]);
assert.equal(adapter.mergeMvuCards(expandedPair).length, 2, 'owned instances sharing one template are not collapsed');
assert.equal(adapter.convertMvuCards(adapter.mergeMvuCards(expandedPair)).length, 2);

let root = core.applyCardUpgradeBundle(base, {
  source: { kind: 'card', id: 'temporary_growth' }, scope: 'combat', createdTurn: 2,
  changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 3 }],
});
root = core.applyCardUpgradeBundle(root, {
  source: { kind: 'card', id: 'permanent_echo' }, scope: 'permanent', createdTurn: 2,
  changes: [{ kind: 'replay', extra: 1 }],
});
root = core.applyCardAttachment(root, {
  id: 'run_forge', kind: 'enchantment', name: '整局锻造', source: { kind: 'card', id: 'forge' },
  scope: 'run', appliedTurn: 2, removeOn: 'run_end',
  changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 2 }],
});
root = core.applyCardAttachment(root, {
  id: 'combat_fault', kind: 'affliction', name: '本场故障', source: { kind: 'enemy_action', id: 'fault' },
  scope: 'combat', appliedTurn: 2, removeOn: 'combat_end',
  changes: [{ kind: 'cost', operator: 'add', value: 1 }],
});
root = core.appendCardPatch(root, {
  id: 'forge:stable_writeback:2:1', source: { kind: 'card', id: 'forge' }, scope: 'permanent',
  createdTurn: 2, priority: 10, removeOn: 'manual',
  target: { match: 'instance', combatInstanceId: root.combatInstanceId },
  kind: 'numeric', stat: 'damage', operator: 'add', value: 1,
});
assert.equal(root.effectProgram.steps[0].amount, 12);
assert.equal(root.replayCount, 1);
assert.equal(root.cost, 2);

const temporary = {
  ...structuredClone(root),
  id: 'echo_blade__temporary',
  combatInstanceId: 'echo_blade__temporary',
  parentCombatInstanceId: root.combatInstanceId,
  origin: 'copied',
};
const firstWrite = adapter.writeBackMvuCardProgression(definitions, [base], [temporary, root]);
assert.deepEqual(firstWrite.ignoredCombatInstanceIds, ['echo_blade__temporary']);
assert.deepEqual(firstWrite.updatedRunInstanceIds, [base.runInstanceId]);
assert.equal(firstWrite.cards[0].effects.damage, 6, 'compact MVU effects remain the immutable base');
assert.equal(firstWrite.cards[0].runInstanceId, base.runInstanceId);
const metadata = firstWrite.cards[0].$meta.mwg_card_progression;
assert.deepEqual(metadata.patches.map(patch => patch.scope), ['permanent', 'run', 'permanent']);
assert.equal(metadata.patches.at(-1).target.match, 'run_instance');
assert.equal(metadata.patches.at(-1).target.runInstanceId, base.runInstanceId, 'instance patches are retargeted to stable ownership');
assert.deepEqual(metadata.attachments.map(entry => entry.id), ['run_forge']);

const [restored] = adapter.convertMvuCards(firstWrite.cards);
assert.equal(restored.runInstanceId, base.runInstanceId, 'save restore keeps the owned-card identity');
assert.equal(restored.effectProgram.steps[0].amount, 9, 'run attachment and permanent Forge patch restore exactly once');
assert.equal(restored.replayCount, 1, 'permanent Replay is restored exactly once');
assert.equal(restored.cost, 1, 'combat-only affliction is not written back');
const secondWrite = adapter.writeBackMvuCardProgression(firstWrite.cards, [restored], [restored]);
assert.deepEqual(secondWrite.cards, firstWrite.cards, 'repeated save restoration does not duplicate patches');

const runEnded = core.cleanupCardProgression(restored, 'run_end');
const afterRun = adapter.writeBackMvuCardProgression(firstWrite.cards, [runEnded], [runEnded]).cards;
const [nextRun] = adapter.convertMvuCards(afterRun);
assert.equal(nextRun.effectProgram.steps[0].amount, 7, 'run-scoped forge is removed while permanent Forge survives');
assert.equal(nextRun.replayCount, 1, 'permanent Replay survives the run boundary');
assert.deepEqual(nextRun.attachments || [], []);

const variables = {
  stat_data: {
    battle: {
      core: { hp: 20, max_hp: 20, lust: 0, max_lust: 100 },
      cards: structuredClone(definitions), items: [], player_abilities: [], player_status_effects: [],
      enemy: { name: '敌人', emoji: 'X', hp: 0, max_hp: 10, lust: 0, max_lust: 100, actions: [], abilities: [], status_effects: [], lust_effect: {} },
    },
  },
};
settlement.settleTavernBattleVariables(variables, {
  result: 'victory', player: { currentHp: 15, currentLust: 2 }, turns: 2, persistentCards: firstWrite.cards,
});
assert.deepEqual(variables.stat_data.battle.cards, firstWrite.cards, 'settlement commits the complete persistent deck');

const invalidVariables = {
  stat_data: {
    battle: {
      core: { hp: 20, max_hp: 20, lust: 0, max_lust: 100 }, cards: structuredClone(definitions),
      items: [], player_abilities: [], player_status_effects: [],
      enemy: { name: '敌人', emoji: 'X', hp: 0, max_hp: 10, lust: 0, max_lust: 100, actions: [], abilities: [], status_effects: [], lust_effect: {} },
    },
  },
};
const beforeInvalid = structuredClone(invalidVariables);
const duplicate = { ...firstWrite.cards[0], runInstanceId: 'duplicate' };
assert.throws(() => settlement.settleTavernBattleVariables(invalidVariables, {
  result: 'victory', player: { currentHp: 1, currentLust: 9 }, turns: 3,
  persistentCards: [duplicate, structuredClone(duplicate)],
}), /duplicate run card identity/);
assert.deepEqual(invalidVariables, beforeInvalid, 'invalid write-back fails before any settlement field mutates');

const hostVariables = { stat_data: { battle: { cards: structuredClone(definitions) } }, mwg: { battle_session: { turn: 2 } } };
const hostBox = { value: structuredClone(hostVariables), runtime: 'live' };
const hostLifecycle = [];
let settledInput;
const immediateContinuation = {
  continueWithPrompt: async ({ prepare }) => prepare(),
};
const host = new TavernBattleEndHost(immediateContinuation, {
  getState: () => ({
    currentTurn: 2,
    battleRequest: undefined,
    player: { currentHp: 12, currentLust: 3, resources: {}, items: [] },
  }),
  saveBattleSession: async () => hostLifecycle.push('save'),
  finalizeCardProgression: runEnded => {
    hostLifecycle.push(`finalize:${runEnded}`);
    hostBox.runtime = 'cleaned';
    return structuredClone(firstWrite.cards);
  },
  clearBattleSession: async () => {
    hostLifecycle.push('clear');
    delete hostBox.value.mwg.battle_session;
  },
  reloadBattleState: async () => {
    hostLifecycle.push('reload');
    hostBox.runtime = 'live';
    return true;
  },
  readVariables: () => structuredClone(hostBox.value),
  replaceVariables: async value => {
    hostLifecycle.push('replace');
    hostBox.value = structuredClone(value);
  },
  settleBattle: async input => {
    hostLifecycle.push('settle');
    settledInput = structuredClone(input);
  },
  reloadPage: () => undefined,
});
await host.confirmBattleEnd('victory', '继续');
assert.deepEqual(hostLifecycle, ['save', 'finalize:false', 'clear', 'settle']);
assert.deepEqual(settledInput.persistentCards, firstWrite.cards, 'the real host forwards finalized cards to settlement');

const rollbackLifecycle = [];
hostBox.value = structuredClone(hostVariables);
hostBox.runtime = 'live';
const rollbackHost = new TavernBattleEndHost(immediateContinuation, {
  getState: () => ({ currentTurn: 2, battleRequest: undefined, player: { currentHp: 12, currentLust: 3, items: [] } }),
  saveBattleSession: async () => rollbackLifecycle.push('save'),
  finalizeCardProgression: () => {
    rollbackLifecycle.push('finalize');
    hostBox.runtime = 'cleaned';
    return structuredClone(firstWrite.cards);
  },
  clearBattleSession: async () => {
    rollbackLifecycle.push('clear');
    delete hostBox.value.mwg.battle_session;
  },
  reloadBattleState: async () => {
    rollbackLifecycle.push('reload');
    hostBox.runtime = 'live';
    return true;
  },
  readVariables: () => structuredClone(hostBox.value),
  replaceVariables: async value => {
    rollbackLifecycle.push('replace');
    hostBox.value = structuredClone(value);
  },
  settleBattle: async () => {
    rollbackLifecycle.push('settle-failed');
    hostBox.value.stat_data.partial = true;
    throw new Error('write-back failed');
  },
  reloadPage: () => undefined,
});
await assert.rejects(rollbackHost.confirmBattleEnd('victory', '继续'), /write-back failed/);
assert.deepEqual(rollbackLifecycle, ['save', 'finalize', 'clear', 'settle-failed', 'replace', 'reload']);
assert.deepEqual(hostBox.value, hostVariables, 'failed host settlement restores the complete MVU snapshot');
assert.equal(hostBox.runtime, 'live', 'failed host settlement reloads the pre-cleanup combat snapshot');

console.log('Persistent combat card progression write-back, cleanup, stable identity, rollback, and restore idempotence passed.');
