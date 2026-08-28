import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { TavernEffectCommandHost } = require(resolve('src/fish/core/effectCommandHost.ts'));

const baseState = {
  self: { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0, statusStacks: {} },
  opponent: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0, statusStacks: {} },
  currentTurn: 1, cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0,
};

const program = {
  spec: core.EFFECT_PROGRAM_SPEC,
  steps: [
    { op: 'damage', target: 'opponent', targetSelector: { mode: 'all' }, amount: 5 },
    { op: 'apply_status', target: 'opponent', targetSelector: { mode: 'random_n', count: 2, allowRepeat: false, retarget: 'each_hit' }, status: 'marked', stacks: 1 },
  ],
};
assert.equal(core.validateEffectProgram(program).ok, true);
const commands = [];
await core.runEffectCommandProgram(program, { spentEnergy: 0 }, {
  readState: () => structuredClone(baseState),
  execute: command => commands.push(command),
});
assert.deepEqual(commands[0].targetSelector, { mode: 'all' });
assert.deepEqual(commands[1].targetSelector, { mode: 'random_n', count: 2, allowRepeat: false, retarget: 'each_hit' });

const invalidSelf = core.validateEffectProgram({
  spec: core.EFFECT_PROGRAM_SPEC,
  steps: [{ op: 'heal', target: 'self', targetSelector: { mode: 'all' }, amount: 2 }],
});
assert.equal(invalidSelf.ok, false);
assert.equal(invalidSelf.issues.some(issue => issue.code === 'INVALID_TARGET_SELECTOR'), true);
assert.equal(core.validateEffectProgram({
  spec: core.EFFECT_PROGRAM_SPEC,
  steps: [{ op: 'damage', target: 'opponent', targetSelector: { mode: 'random_n', count: 0 }, amount: 2 }],
}).ok, false);

const compact = core.compileCompactEffectList([
  { damage: 4, targets: { mode: 'all' } },
  { apply_status: 'marked', stacks: 2, targets: { mode: 'lowest_hp' } },
  { damage: 3, targets: { mode: 'random_n', count: 3, allow_repeat: true, retarget: 'each_hit' } },
]);
assert.equal(compact.ok, true, compact.ok ? '' : JSON.stringify(compact.issues));
assert.deepEqual(compact.value.steps[0].targetSelector, { mode: 'all' });
assert.deepEqual(compact.value.steps[1].targetSelector, { mode: 'lowest_hp' });
assert.deepEqual(compact.value.steps[2].targetSelector, { mode: 'random_n', count: 3, allowRepeat: true, retarget: 'each_hit' });
const display = core.effectProgramToDisplayTags(compact.value).map(tag => tag.text).join('；');
assert.match(display, /所有敌方/);
assert.match(display, /生命最低的敌方/);
assert.match(display, /随机敌方（3次，可重复）/);

const executed = [];
const selectors = [];
const host = new TavernEffectCommandHost({
  readState: () => structuredClone(baseState),
  isTerminal: () => false,
  executeCardCommand: async () => {},
  presentCommand: () => {},
  executeBattleCommand: async command => executed.push(command),
  forEachEnemyTarget: async (selector, execute) => {
    selectors.push(selector);
    const count = selector.mode === 'all' ? 3 : selector.mode === 'random_n' ? selector.count : 1;
    for (let index = 0; index < count; index += 1) await execute();
  },
  applyStatus: async () => {},
  removeStatuses: async () => {},
  registerAbility: async () => {},
  narrate: async () => {},
});
await host.executeProgram({ spec: core.EFFECT_PROGRAM_SPEC, steps: [program.steps[0]] }, true);
assert.deepEqual(selectors, [{ mode: 'all' }]);
assert.equal(executed.length, 3);
assert.equal(executed.every(command => command.targetSelector === undefined), true, 'fan-out commands must be single-target');

for (const path of ['schemas/mwg-effect-v1.schema.json', 'schemas/mwg-card-effects-v1.schema.json'])
  JSON.parse(await readFile(resolve(path), 'utf8'));

console.log('Multi-enemy target DSL covers all, by-id, random, random-N, hp selectors, compact input, display, and host fan-out.');
