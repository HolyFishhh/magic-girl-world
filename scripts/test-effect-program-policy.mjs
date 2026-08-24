import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { compileCompactEffectList, validateEffectProgramPolicy } = require(resolve('src/game-core/index.ts'));

const compile = (effects, options = {}) => {
  const result = compileCompactEffectList(effects, options);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.value;
};
const codes = result => (result.ok ? [] : result.issues.map(issue => issue.code));

const xCost = compile([{ damage: 'spent_energy * 4' }]);
assert.equal(validateEffectProgramPolicy(xCost, { allowSpentEnergy: true, triggerPolicy: 'forbid' }).ok, true);
assert.ok(codes(validateEffectProgramPolicy(xCost, { triggerPolicy: 'forbid' })).includes('SPENT_ENERGY_NOT_ALLOWED'));

const statusFormula = compile([{ block: 'stacks * 2' }]);
assert.equal(validateEffectProgramPolicy(statusFormula, { allowStatusStacks: true }).ok, true);
assert.ok(codes(validateEffectProgramPolicy(statusFormula)).includes('STATUS_STACKS_NOT_ALLOWED'));

const power = compile([{ block: 4 }, { draw: 1 }], { trigger: 'turn_start' });
assert.equal(
  validateEffectProgramPolicy(power, { triggerPolicy: 'require_root', modifierPolicy: 'forbid' }).ok,
  true,
);
const recursiveDraw = compile([{ draw: 1 }], { trigger: 'on_draw' });
assert.ok(
  codes(validateEffectProgramPolicy(recursiveDraw, { triggerPolicy: 'require_root' })).includes(
    'RECURSIVE_DRAW_NOT_ALLOWED',
  ),
  'modern on_draw hooks must not create an unbounded draw loop',
);
assert.ok(codes(validateEffectProgramPolicy(power, { triggerPolicy: 'forbid' })).includes('TRIGGER_NOT_ALLOWED'));
assert.ok(
  codes(validateEffectProgramPolicy(compile([{ block: 4 }]), { triggerPolicy: 'require_root' })).includes(
    'ROOT_TRIGGER_REQUIRED',
  ),
);

const event = compile([{ narrate: '战斗终止，返回剧情。' }]);
assert.equal(
  validateEffectProgramPolicy(event, { allowNarrate: true, requireSingleNarrate: true, triggerPolicy: 'forbid' }).ok,
  true,
);
const eventWithDamage = compile([{ narrate: '返回剧情。' }, { damage: 1 }]);
assert.ok(
  codes(
    validateEffectProgramPolicy(eventWithDamage, {
      allowNarrate: true,
      requireSingleNarrate: true,
      triggerPolicy: 'forbid',
    }),
  ).includes('SINGLE_NARRATE_REQUIRED'),
);
assert.ok(codes(validateEffectProgramPolicy(event, { triggerPolicy: 'forbid' })).includes('NARRATE_NOT_ALLOWED'));

const modifier = compile([{ modify: 'damage', add: 2 }]);
assert.equal(validateEffectProgramPolicy(modifier, { modifierPolicy: 'only' }).ok, true);
assert.ok(codes(validateEffectProgramPolicy(modifier, { modifierPolicy: 'forbid' })).includes('MODIFIER_NOT_ALLOWED'));
assert.ok(
  codes(validateEffectProgramPolicy(compile([{ block: 2 }]), { modifierPolicy: 'only' })).includes(
    'ONLY_MODIFIERS_ALLOWED',
  ),
);

const knownStatus = compile([{ apply_status: 'bleed', stacks: 2 }]);
assert.equal(validateEffectProgramPolicy(knownStatus, { knownStatusIds: new Set(['bleed']) }).ok, true);
assert.ok(
  codes(validateEffectProgramPolicy(knownStatus, { knownStatusIds: new Set(['focus']) })).includes('UNKNOWN_STATUS'),
);

const generated = compile([{ add_card: 'spark' }], {
  creates: [
    {
      id: 'spark',
      name: '火花',
      type: 'Attack',
      cost: 0,
      effects: [{ damage: 'spent_energy + 1' }],
    },
  ],
});
assert.ok(
  codes(validateEffectProgramPolicy(generated, { triggerPolicy: 'forbid' })).includes('SPENT_ENERGY_NOT_ALLOWED'),
  'generated non-X cards must not smuggle in spent_energy',
);

const source = await readFile(resolve('src/game-core/effectProgramPolicy.ts'), 'utf8');
assert.doesNotMatch(source, /from ['"].*(fish|runtime|ui|tavern|jquery)/i);
assert.doesNotMatch(source, /\b(document|window|localStorage|eval|Function)\b/);

console.log('Portable effect-program policy owns trigger, context, modifier, Event, and status usage rules.');
