import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { summonIntentBadges } = require('../src/fish/ui/summonIntentDisplay.ts');
const state = { player: {}, enemies: [] };
const unit = { templateId: 'guard', name: '守卫', emoji: '🛡️', actionsPerActivation: 1, plannedActionIds: ['guard'], actions: [{ id: 'guard', name: '格挡', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 5 }] } }] };
assert.deepEqual(summonIntentBadges(unit, state), [{ icon: '🛡️', value: '5', label: '按当前状态获得5点格挡（单次行动）' }]);
const formula = { ...unit, actions: [{ id: 'strike', name: '斩击', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 'self.hp / 2' }] } }], plannedActionIds: ['strike'] };
assert.equal(summonIntentBadges(formula, state)[0].value, '?', 'a formula without a live runtime holder remains unknown');
const random = { ...unit, actions: [
  { id: 'block', name: '格挡', effectProgram: unit.actions[0].effectProgram },
  { id: 'strike', name: '突击', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 7 }] } },
], plannedActionIds: ['strike'] };
assert.deepEqual(summonIntentBadges(random, state)[0], { icon: '⚔️', value: '7', label: '按当前状态造成7点伤害（单次行动）' });
assert.deepEqual(summonIntentBadges({ ...unit, capabilities: { acts: false } }, state)[0], { icon: '⏸️', value: '', label: '该召唤物不能行动' });
assert.equal(summonIntentBadges({ ...unit, modifiers: { damage: 2 } }, state)[0].value, '5', 'the planned action reads its current transformed program');
const mixed = { ...unit, actions: [{ id: 'mixed', name: '混合', effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 5 }, { op: 'gain_lust', target: 'opponent', amount: 4 }] } }], plannedActionIds: ['mixed'] };
assert.equal(summonIntentBadges(mixed, state)[0].value, '?', 'mixed unsupported effects do not silently disappear from intent');
console.log('Summon compact intent badges preserve fixed values and mark formula/random uncertainty.');
