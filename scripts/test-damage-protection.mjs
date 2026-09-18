import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { UnifiedEffectExecutor } = require(resolve('src/fish/combat/unifiedEffectExecutor.ts'));
const { GameStateManager } = require(resolve('src/fish/core/gameStateManager.ts'));
const { DynamicStatusManager } = require(resolve('src/fish/combat/dynamicStatusManager.ts'));
const { normalizeAbilityDefinition } = require(resolve('src/fish/core/battleContentAdapter.ts'));

const manager = GameStateManager.getInstance();
const executor = UnifiedEffectExecutor.getInstance();
executor.presentation = new Proxy({}, { get: () => () => {} });
const statuses = DynamicStatusManager.getInstance();

const attack = (amount, extra = {}) => ({ spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount, damageKind: 'attack', ...extra }] });
const protectionAbility = (id, protection) => {
  const normalized = normalizeAbilityDefinition({
    id, name: id, emoji: '🛡️', description: '保护', source: 'test',
    trigger: { on: 'passive', effects: {} }, protection,
  });
  assert.ok(normalized, 'a pure protection ability must normalize from its public passive shape');
  return normalized;
};
function enemy(id, currentHp = 20, extra = {}) {
  return {
    id, name: ({ guard_a: '甲卫', guard_b: '乙卫', target_b: '目标乙', active_c: '活动丙' })[id] || id,
    emoji: 'E', maxHp: 20, currentHp, maxLust: 100, currentLust: 0, energy: 0, maxEnergy: 0,
    block: 0, statusEffects: [], abilities: [], intent: { type: 'attack', description: '', emoji: '' },
    actions: [], nextAction: null, dialogue: '', ...extra,
  };
}
function reset(enemies, activeId = enemies[0].id, definitions = []) {
  manager.resetGame();
  manager.updatePlayer({ maxHp: 80, currentHp: 80, maxLust: 100, currentLust: 0, energy: 3, maxEnergy: 3, block: 0, modifiers: {}, abilities: [], statusEffects: [] });
  statuses.replaceDefinitions(definitions);
  manager.setEnemies(enemies, activeId);
}
async function strikeTarget(targetId, amount) {
  await executor.executeEffectProgram(attack(amount), true, { cardContext: { type: 'Attack' }, boundEnemyTargetId: targetId });
}

// Exact target rules remain tied to target_b even while another enemy is active.
reset([
  enemy('guard_a', 20, { abilities: [protectionAbility('bodyguard', { mode: 'intercept', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b'), enemy('active_c'),
], 'active_c');
await strikeTarget('target_b', 7);
assert.equal(manager.getEnemyById('guard_a').currentHp, 13);
assert.equal(manager.getEnemyById('target_b').currentHp, 20);
assert.equal(manager.getEnemyById('active_c').currentHp, 20);

// A full interception consumes the packet before the original target’s additive
// vulnerability; zero remaining damage must not be resurrected as +5 damage.
reset([
  enemy('guard_a', 20, { abilities: [protectionAbility('full_guard', { mode: 'intercept', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b', 20, { modifiers: { damage_taken_modifier: 5 } }),
]);
await strikeTarget('target_b', 6);
assert.equal(manager.getEnemyById('guard_a').currentHp, 14);
assert.equal(manager.getEnemyById('target_b').currentHp, 20, 'full protection leaves no packet for the original target vulnerability');

// Existing summon interception reaches the same zero-packet boundary: after its
// exact summoner absorbs the entire hit, original-target vulnerability cannot add damage.
reset([enemy('target_b', 20, { modifiers: { damage_taken_modifier: 5 } })]);
const exactInterceptor = manager.spawnSummons('enemy', {
  id: 'exact_interceptor', name: '精准拦截', emoji: '🛡️', maxHp: 10,
  intercept: { mode: 'unblocked_attack' },
}, 1, Number.MAX_SAFE_INTEGER, 'replace_oldest', 'target_b').spawned[0];
await strikeTarget('target_b', 6);
assert.equal(manager.getSummonById(exactInterceptor.instanceId).currentHp, 4);
assert.equal(manager.getEnemyById('target_b').currentHp, 20, 'a fully intercepting summon also leaves no vulnerability-resurrected damage');

// Interception follows priority and carries only post-recipient overflow onward.
reset([
  enemy('guard_a', 3, { abilities: [protectionAbility('first', { mode: 'intercept', scope: 'specific', targetId: 'target_b', priority: 2 })] }),
  enemy('guard_b', 4, { abilities: [protectionAbility('second', { mode: 'intercept', scope: 'specific', targetId: 'target_b', priority: 1 })] }),
  enemy('target_b'),
]);
await strikeTarget('target_b', 10);
assert.deepEqual(manager.getGameState().defeatedEnemies.map(entry => entry.id).sort(), ['guard_a', 'guard_b']);
assert.equal(manager.getEnemyById('target_b').currentHp, 17, '3 + 4 are intercepted before the 3-point remainder reaches the target');

// specific sharing includes only the original target and matching living holders.
reset([
  enemy('guard_a', 20, { abilities: [protectionAbility('specific_share', { mode: 'share_damage', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b'), enemy('active_c'),
]);
await strikeTarget('target_b', 10);
assert.equal(manager.getEnemyById('guard_a').currentHp, 15);
assert.equal(manager.getEnemyById('target_b').currentHp, 15);
assert.equal(manager.getEnemyById('active_c').currentHp, 20);

// all_allies sharing really means every living teammate, not merely rule holders.
reset([
  enemy('guard_a', 20, { abilities: [protectionAbility('all_share', { mode: 'share_damage', scope: 'all_allies' })] }),
  enemy('target_b'), enemy('active_c'),
]);
await strikeTarget('target_b', 10);
assert.equal(manager.getEnemyById('guard_a').currentHp, 16.67);
assert.equal(manager.getEnemyById('active_c').currentHp, 16.67);
assert.equal(manager.getEnemyById('target_b').currentHp, 16.66, 'rounding remainder is retained by the original target');

// Outgoing modifiers belong to the original attacker and are applied exactly once
// before protection dispatch, never once again for the redirected command.
reset([
  enemy('guard_a', 20, { abilities: [protectionAbility('plus_guard', { mode: 'intercept', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b'),
]);
manager.updatePlayer({ modifiers: { damage_modifier: 5 } });
await strikeTarget('target_b', 10);
assert.equal(manager.getEnemyById('guard_a').currentHp, 5, 'a +5 outgoing modifier produces one 15-point intercepted packet, not 20');
assert.equal(manager.getEnemyById('target_b').currentHp, 20);

const doubleDamageProgram = core.compileCompactEffectList({ modify: 'damage', multiply: 2 });
assert.equal(doubleDamageProgram.ok, true);
reset([
  enemy('guard_a', 30, { abilities: [protectionAbility('double_guard', { mode: 'intercept', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b'),
]);
manager.updatePlayer({ abilities: [{ id: 'double_damage', name: '双倍伤害', trigger: 'passive', effectProgram: doubleDamageProgram.value }] });
await strikeTarget('target_b', 10);
assert.equal(manager.getEnemyById('guard_a').currentHp, 10, 'a ×2 outgoing modifier is applied exactly once before interception, not twice');
assert.equal(manager.getEnemyById('target_b').currentHp, 20);

// The originally selected target's vulnerability does not leak into the guard.
// The guard's reduction and block do apply, and only its post-mitigation overflow
// reaches the original target, which then receives its own incoming modifier.
reset([
  enemy('guard_a', 5, { block: 2, modifiers: { damage_taken_modifier: -2 }, abilities: [protectionAbility('overflow_guard', { mode: 'intercept', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b', 20, { modifiers: { damage_taken_modifier: 5 } }),
]);
manager.updatePlayer({ modifiers: { damage_modifier: 5 } });
await strikeTarget('target_b', 10);
assert.equal(manager.getEnemyById('guard_a'), null, 'the guard receives 15 - 2, then spends its own 2 block and 5 HP before defeat removal');
assert.equal(manager.getEnemyById('target_b').currentHp, 9, 'only the 6-point overflow receives the original target’s +5 vulnerability');

// Sharing splits the once-modified attack packet, then each real recipient resolves
// only its own incoming mitigation and block.
reset([
  enemy('guard_a', 20, { block: 1, modifiers: { damage_taken_modifier: -1 }, abilities: [protectionAbility('share_guard', { mode: 'share_damage', scope: 'all_allies' })] }),
  enemy('target_b', 20, { modifiers: { damage_taken_modifier: 3 } }),
  enemy('active_c'),
]);
manager.updatePlayer({ modifiers: { damage_modifier: 5 } });
await strikeTarget('target_b', 10);
assert.equal(manager.getEnemyById('guard_a').currentHp, 17, 'guard share is 5, reduced to 4, then its own block absorbs 1');
assert.equal(manager.getEnemyById('active_c').currentHp, 15, 'an unmodified teammate takes its one 5-point share');
assert.equal(manager.getEnemyById('target_b').currentHp, 12, 'the target receives its 5-point share plus only its own +3 incoming modifier');

// Lifesteal uses actual HP lost by the guard even when the original target loses no HP.
reset([
  enemy('guard_a', 20, { abilities: [protectionAbility('lifesteal_guard', { mode: 'intercept', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b'),
]);
manager.updatePlayer({ currentHp: 50, maxHp: 80 });
await executor.executeEffectProgram(attack(10, { lifesteal: 1 }), true, { cardContext: { type: 'Attack' }, boundEnemyTargetId: 'target_b' });
assert.equal(manager.getEnemyById('guard_a').currentHp, 10);
assert.equal(manager.getEnemyById('target_b').currentHp, 20);
assert.equal(manager.getPlayer().currentHp, 60, 'full interception still lifesteals from the guard’s actual 10 HP loss');

// The persisted rule remains semantically active after manager restoration, not just
// as an inert enemy ID in the snapshot.
reset([
  enemy('guard_a', 20, { abilities: [protectionAbility('saved_guard', { mode: 'intercept', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b'), enemy('active_c'),
], 'active_c');
manager.replaceState(structuredClone(manager.getGameState()));
await strikeTarget('target_b', 6);
assert.equal(manager.getEnemyById('guard_a').currentHp, 14, 'restored ability protection still absorbs the selected target’s hit');
assert.equal(manager.getEnemyById('target_b').currentHp, 20);

// An enemy source retains its stable source ID while a formal self-team by-id
// selector chooses another enemy. The redirect applies its outgoing modifier once
// and preserves bypassBlock on the protector rather than falling through to player.
reset([
  enemy('source_enemy'),
  enemy('guard_a', 20, { block: 5, abilities: [protectionAbility('enemy_guard', { mode: 'intercept', scope: 'specific', targetId: 'target_b' })] }),
  enemy('target_b'), enemy('active_c'),
], 'active_c');
await executor.executeEffectProgram(attack(10, {
  bypassBlock: true,
  targetSelector: { mode: 'by_id', id: 'target_b', team: 'self' },
}), false, {
  cardContext: { type: 'Attack' }, battleContext: { enemyId: 'source_enemy' },
});
assert.equal(manager.getPlayer().currentHp, 80, 'enemy self-team selected damage never falls through to the player');
assert.equal(manager.getEnemyById('guard_a').currentHp, 10, 'the selected enemy damage redirects once and bypasses the protector block');
assert.equal(manager.getEnemyById('guard_a').block, 5, 'redirected bypass-block damage does not consume protector block');
assert.equal(manager.getEnemyById('target_b').currentHp, 20);

// Status-provided protection uses the same normalized definition and disappears with its holder/status.
const ward = { id: 'ward', name: '护卫姿态', emoji: '🛡️', type: 'buff', stacks_change: 'keep', triggers: {},
  protection: { mode: 'intercept', scope: 'all_allies' } };
reset([enemy('guard_a', 20, { statusEffects: [{ id: 'ward', name: '护卫姿态', emoji: '🛡️', type: 'buff', stacks: 1 }] }), enemy('target_b')], 'target_b', [ward]);
const savedWardBattle = JSON.parse(JSON.stringify({ battle: manager.getGameState(), definitions: [ward] }));
manager.resetGame(); statuses.replaceDefinitions([]);
manager.replaceState(savedWardBattle.battle); statuses.replaceDefinitions(savedWardBattle.definitions);
assert.equal(statuses.getStatusDefinition('ward').protection.mode, 'intercept', 'saved authored status recompiles its protection after restore');
await strikeTarget('target_b', 4);
assert.equal(manager.getEnemyById('guard_a').currentHp, 16);
assert.equal(manager.getEnemyById('target_b').currentHp, 20);
manager.updateEnemyById('guard_a', { statusEffects: [] });
await strikeTarget('target_b', 4);
assert.equal(manager.getEnemyById('target_b').currentHp, 16);

// Old enemy summons without an exact summoner binding cannot drift with the active alias.
const summonStore = new core.BattleStateStore(core.createEmptyBattleState());
summonStore.setEnemies([enemy('guard_a'), enemy('target_b')], 'target_b');
const exactSummon = summonStore.spawnSummons('enemy', { id: 'a_summon', name: '甲召唤', emoji: 'A', maxHp: 5, intercept: { mode: 'unblocked_attack' } }, 1, Number.MAX_SAFE_INTEGER, 'replace_oldest', 'guard_a').spawned[0];
summonStore.spawnSummons('enemy', { id: 'legacy_summon', name: '旧召唤', emoji: 'L', maxHp: 5, intercept: { mode: 'unblocked_attack' } }, 1, Number.MAX_SAFE_INTEGER, 'replace_oldest', null);
const targetIntercept = summonStore.interceptDamageWithSummons('enemy', 4, 'target_b');
assert.equal(targetIntercept.hits.length, 0);
const guardIntercept = summonStore.interceptDamageWithSummons('enemy', 4, 'guard_a');
assert.deepEqual(guardIntercept.hits.map(hit => hit.summonId), [exactSummon.instanceId]);

const schemaValidator = new Ajv2020({ strict: false, allErrors: true });
for (const path of ['schemas/mwg-effect-v1.schema.json', 'schemas/mwg-card-effects-v1.schema.json']) {
  const schema = JSON.parse(await readFile(resolve(path), 'utf8'));
  const validate = schemaValidator.compile(schema.$defs.damageProtection);
  assert.equal(validate({ mode: 'share_damage', scope: 'specific', target_id: 'target_b' }), true, `${path} must accept a specific target`);
  assert.equal(validate({ mode: 'share_damage', scope: 'all_allies' }), true, `${path} must accept all-allies sharing`);
  assert.equal(validate({ mode: 'share_damage', scope: 'specific' }), false, `${path} must require target_id for specific protection`);
  assert.equal(validate({ mode: 'share_damage', scope: 'all_allies', target_id: 'target_b' }), false, `${path} must reject target_id for all_allies protection`);
}

const validRule = { mode: 'share_damage', scope: 'specific', target_id: 'target_b' };
assert.deepEqual(core.normalizeDamageProtectionRule(validRule), { mode: 'share_damage', scope: 'specific', targetId: 'target_b' });
assert.equal(core.normalizeDamageProtectionRule({ mode: 'intercept', scope: 'specific' }), null);
assert.equal(core.normalizeDamageProtectionRule({ mode: 'intercept', scope: 'all_allies', target_id: 'target_b' }), null);
const normalizedPureProtection = normalizeAbilityDefinition({
  id: 'ward', name: '守护', emoji: '🛡️', description: '守护同伴', source: '测试',
  trigger: { on: 'passive', effects: {} }, protection: validRule,
});
assert.ok(normalizedPureProtection, 'the public passive empty-effects protection shape compiles through normalizeAbilityDefinition');
assert.deepEqual(normalizedPureProtection.effectProgram, { spec: 'mwg.effect/v1', steps: [] });
assert.match(core.describeCompactContent({ protection: validRule }, { enemyNames: { target_b: '目标乙' } }), /目标乙（target_b）/);
assert.match(core.describeCompactStatus({ ...ward, protection: validRule }, { enemyNames: { target_b: '目标乙' } }), /目标乙（target_b）/);
assert.match(core.compactContentToDisplayTags({ protection: validRule }, { enemyNames: { target_b: '目标乙' } }).map(tag => tag.text).join('；'), /目标乙（target_b）/);

const saved = structuredClone(manager.getGameState());
const restored = new core.BattleStateStore(saved);
assert.equal(restored.getEnemyById('guard_a').id, 'guard_a', 'snapshot restore preserves stable enemy identity');
console.log('Damage protection contract passed.');
