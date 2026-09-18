import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));
const { BattleSessionHost } = require(resolve('src/fish/core/battleSessionHost.ts'));
const { convertMvuEnemies } = require(resolve('src/fish/core/mvuBattleAdapter.ts'));

const enemy = id => ({
  id, name: id, emoji: '👾', hp: 20, max_hp: 20, lust: 0, max_lust: 100,
  actions: [], abilities: [], status_effects: [], action_mode: 'random', action_config: {},
  lust_effect: { name: '失控', effects: { damage: 1 } },
});
const summon = id => ({ id, name: id, emoji: '◇', maxHp: 10, actions: [], abilities: [] });

function setup(seed) {
  const store = GameStateManager.getInstance();
  const state = core.createEmptyBattleState();
  state.random = core.createBattleRandomState(seed);
  state.player.currentHp = state.player.maxHp = 30;
  store.replaceState(state);
  const enemies = convertMvuEnemies([enemy('enemy_a'), enemy('enemy_b')], () => 0);
  store.setEnemies(enemies, 'enemy_a');
  store.spawnSummons('player', summon('player_pet'), 1, 3, 'replace_oldest', 'player');
  store.spawnSummons('enemy', summon('enemy_pet'), 1, 3, 'replace_oldest', 'enemy_a');
  return store;
}

const executor = UnifiedEffectExecutor.getInstance();
// The real executor records presentation through this singleton; keep the test
// headless while retaining GameStateManager, event and summon mutation paths.
executor.presentation = new Proxy({}, { get: () => () => undefined });
executor.completeBattleEnd = async () => {};

const playerProgram = core.compileCompactEffectList({
  damage: 4, to: 'self', targets: { mode: 'random_n', count: 2, team: 'self' },
});
assert.equal(playerProgram.ok, true, JSON.stringify(playerProgram.issues));
const store = setup(4242);
const beforePlayer = structuredClone(store.getGameState());
await executor.executeEffectProgram(playerProgram.value, true);
const afterPlayer = store.getGameState();
const playerChanged = [
  afterPlayer.player.currentHp !== beforePlayer.player.currentHp ? 'player' : null,
  ...afterPlayer.summons.living.filter(unit => unit.owner === 'player' && unit.currentHp !== beforePlayer.summons.living.find(before => before.instanceId === unit.instanceId)?.currentHp).map(unit => unit.instanceId),
].filter(Boolean);
assert.equal(playerChanged.length, 2, 'random_n without repetition must affect two different self-team entities');
assert.equal(afterPlayer.enemies.every((entry, index) => entry.currentHp === beforePlayer.enemies[index].currentHp), true, 'player source must not be rewritten to an enemy target');
assert.equal(afterPlayer.summons.living.find(unit => unit.owner === 'enemy').currentHp, beforePlayer.summons.living.find(unit => unit.owner === 'enemy').currentHp);

const enemyProgram = core.compileCompactEffectList({
  damage: 3, to: 'self', targets: { mode: 'random_n', count: 2, team: 'self' },
}, { enemyCollectionTarget: 'self' });
assert.equal(enemyProgram.ok, true, JSON.stringify(enemyProgram.issues));
const enemyBefore = structuredClone(store.getGameState());
await executor.executeEffectProgram(enemyProgram.value, false, { battleContext: { enemyId: 'enemy_a' } });
const enemyAfter = store.getGameState();
const enemyChanged = [
  ...enemyAfter.enemies.filter((entry, index) => entry.currentHp !== enemyBefore.enemies[index].currentHp).map(entry => entry.id),
  ...enemyAfter.summons.living.filter(unit => unit.owner === 'enemy' && unit.currentHp !== enemyBefore.summons.living.find(before => before.instanceId === unit.instanceId)?.currentHp).map(unit => unit.instanceId),
];
assert.equal(enemyChanged.length, 2, 'enemy self pool includes formal enemies and enemy summons as independent identities');
assert.equal(enemyAfter.player.currentHp, enemyBefore.player.currentHp, 'enemy source must remain enemy-owned while selecting self team');

const replayStore = setup(4242);
await executor.executeEffectProgram(playerProgram.value, true);
assert.deepEqual(
  replayStore.getGameState().random,
  afterPlayer.random,
  'the production GameStateManager consumes the same deterministic random cursor for the same seed and selector',
);

const session = BattleSessionHost.getInstance();
const rollbackStore = setup(99);
const rollbackBefore = structuredClone(rollbackStore.getGameState());
const token = session.beginScopedTransaction('random_team_target_cancel');
await executor.executeEffectProgram(playerProgram.value, true);
assert.notDeepEqual(rollbackStore.getGameState().random, rollbackBefore.random, 'selection advances the persisted random cursor before cancellation');
session.rollbackTransaction(token);
assert.deepEqual(rollbackStore.getGameState(), rollbackBefore, 'battle transaction cancellation restores both entity targets and random cursor');

console.log('Production executor random team targets cover player/summon and enemy/summon pools, deterministic draws, source ownership, non-repeat, and transaction rollback.');

// All-team status grants must override the acting enemy's outer resolution scope.
const { DynamicStatusManager } = require(resolve('src/fish/combat/dynamicStatusManager.ts'));
const statuses = DynamicStatusManager.getInstance();
const ward = { id:'team_ward', name:'全队守护', emoji:'🛡️', type:'buff', stacks_change:'keep', triggers:{apply:{block:3}} };
for (const team of [undefined, 'self']) {
  const party = setup(101);
  statuses.replaceDefinitions([ward]);
  const input = { apply_status:'team_ward', stacks:2, to:'self', targets:{mode:'all', ...(team ? {team} : {})} };
  const compiled = core.compileCompactEffectList(input, {enemyCollectionTarget:'self'});
  assert.equal(compiled.ok,true,JSON.stringify(compiled.issues));
  assert.match(core.describeCompactContent({effects:input}), /全体|所有/);
  assert.match(core.effectProgramToDisplayTags(compiled.value).map(t=>t.text).join('；'), /所有/);
  const saved = JSON.parse(JSON.stringify({state:party.getGameState(),program:compiled.value}));
  party.replaceState(saved.state);
  assert.equal(party.beginEnemyResolution('enemy_a'),true);
  try {
    await executor.executeEffectProgram(saved.program,false,{battleContext:{enemyId:'enemy_a'}});
    assert.equal(party.getEnemy().id,'enemy_a','outer actor scope restored');
  } finally { party.endEnemyResolution('enemy_a'); }
  for (const enemy of party.getEnemies()) assert.equal(enemy.statusEffects.find(s=>s.id==='team_ward')?.stacks,2,`${team}: ${enemy.id} receives exactly one grant`);
  assert.equal(party.getPlayer().statusEffects.length,0);
  for(const enemy of party.getEnemies()) assert.equal(enemy.block,3,'status apply trigger follows its precise recipient');
  const enemyPet=party.getSummons('enemy')[0];
  assert.equal(enemyPet.statusEffects?.find(s=>s.id==='team_ward')?.stacks,team ? 2 : undefined,'relative team includes its summon, legacy enemy roster does not');
  const remove = core.compileCompactEffectList({remove_status:'team_ward',to:'self',targets:{mode:'all',...(team?{team}:{})}},{enemyCollectionTarget:'self'});
  assert.equal(remove.ok,true,JSON.stringify(remove.issues));
  party.beginEnemyResolution('enemy_a');
  try { await executor.executeEffectProgram(remove.value,false,{battleContext:{enemyId:'enemy_a'}}); }
  finally { party.endEnemyResolution('enemy_a'); }
  assert.ok(party.getEnemies().every(e=>!e.statusEffects.some(s=>s.id==='team_ward')),'removal reaches every selected enemy');
}
console.log('PASS all-enemy status recipient scopes, removal, save restoration and description');
