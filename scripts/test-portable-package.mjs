import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/portable');
const packageJson = JSON.parse(await readFile(resolve(output, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'));
const release = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));

assert.equal(packageJson.name, '@magic-girl-world/portable-core');
assert.equal(packageJson.version, release.cardVersion);
assert.equal(manifest.version, release.cardVersion);
assert.deepEqual(Object.keys(packageJson.exports), ['.', './card', './battle']);

for (const artifact of manifest.artifacts) {
  const file = resolve(output, artifact.name);
  assert.equal((await stat(file)).size, artifact.bytes);
  const hash = createHash('sha256').update(await readFile(file)).digest('hex').toUpperCase();
  assert.equal(hash, artifact.sha256);
  const source = await readFile(file, 'utf8');
  assert.doesNotMatch(source, /SillyTavern|Tavern Helper|MagVarUpdate|getChatMessages|updateVariablesWith/);
  assert.doesNotMatch(source, /(?:^|[;\n])\s*import\s*(?:\(|[\w*{])/m, `${artifact.name} must be a self-contained ESM bundle`);
}

const card = await import(pathToFileURL(resolve(output, 'card-backend.mjs')).href);
assert.equal(card.PORTABLE_API_SPEC, 'mwg.portable/v1');
for (const name of [
  'compileCompactEffectList',
  'validateContentPackContract',
  'describeCompactCard',
  'CardEffectRuntime',
  'applyCardUpgrade',
  'planRewardSelections',
]) {
  assert.equal(name in card, true, `card public API is missing ${name}`);
}
const compiled = card.compileCompactEffectList([{ damage: 'self.block + 3' }, { block: 5 }]);
assert.equal(compiled.ok, true);
assert.deepEqual(compiled.value.steps.map(step => step.op), ['damage', 'gain_block']);
assert.match(card.describeCompactCard({ effects: [{ damage: 8 }, { block: 5 }] }), /8/);
assert.equal('BattleStateStore' in card, false, 'card package must not expose the battle state host');

const battle = await import(pathToFileURL(resolve(output, 'battle-backend.mjs')).href);
for (const name of [
  'ReferenceBattleRuntimeHost',
  'BattleStateStore',
  'BattleEffectRuntime',
  'playBattleSessionCard',
  'advanceBattleSessionTurn',
  'StatusLifecycleRuntime',
  'createBattleSessionSnapshot',
  'readBattleSessionSnapshot',
]) {
  assert.equal(name in battle, true, `battle public API is missing ${name}`);
}
const runtimeProgram = {
  spec: 'mwg.effect/v1',
  steps: [{ op: 'damage', target: 'opponent', amount: 1 }],
};
const host = new battle.ReferenceBattleRuntimeHost({
  ...battle.createEmptyBattleState(),
  phase: 'player_turn',
  currentTurn: 1,
  random: battle.createBattleRandomState(78),
  battle: {
    player_lust_effect: { id: 'player_lust', name: 'Player Lust', effectProgram: runtimeProgram },
  },
});
host.setEnemy({
  id: 'portable_target',
  name: 'Portable Target',
  maxHp: 20,
  currentHp: 20,
  maxLust: 100,
  currentLust: 0,
  energy: 0,
  maxEnergy: 0,
  block: 2,
  statusEffects: [],
  intent: { type: 'attack', description: '', emoji: '' },
  emoji: '',
  actions: [],
  nextAction: null,
  lustEffect: { id: 'enemy_lust', name: 'Enemy Lust', effectProgram: runtimeProgram },
  dialogue: '',
});
const effects = host.createBattleEffectRuntime({
  readModifierSources: () => [],
  dispatchTriggers: async () => {},
  handleLustOverflow: async () => {},
});
await effects.execute({ type: 'damage', target: 'opponent', amount: 5 }, { source: 'player' });
assert.equal(host.getEnemy().currentHp, 17);
const fingerprint = battle.createBattleFingerprint({ battle: 'portable' });
const snapshot = battle.createBattleSessionSnapshot(fingerprint, host.getGameState(), 1234);
assert.deepEqual(battle.readBattleSessionSnapshot(snapshot), snapshot);

const combined = await import(pathToFileURL(resolve(output, 'magic-girl-core.mjs')).href);
assert.equal(combined.cardBackend.compileCompactEffectList instanceof Function, true);
assert.equal(combined.battleBackend.ReferenceBattleRuntimeHost instanceof Function, true);

for (const declaration of [
  'types/portable/index.d.ts',
  'types/portable/cardBackend.d.ts',
  'types/portable/battleBackend.d.ts',
]) {
  const source = await readFile(resolve(output, declaration), 'utf8');
  assert.doesNotMatch(source, /(?:^|[/'"])(?:fish|common|runtime)(?:[/'"]|$)|Tavern|MUV/m);
}

console.log('Portable card and battle packages are self-contained, typed, host-neutral, and executable.');
