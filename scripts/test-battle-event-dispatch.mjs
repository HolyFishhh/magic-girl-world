import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

const files = ['battleTriggers.ts', 'battleEventDispatch.ts'];
const sources = await Promise.all(files.map(file => readFile(resolve('src/game-core', file), 'utf8')));
const transpiled = sources.map(source =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
const triggerUrl = `data:text/javascript;base64,${Buffer.from(transpiled[0]).toString('base64')}`;
const dispatchSource = transpiled[1].replace("from './battleTriggers'", `from '${triggerUrl}'`);
const dispatch = await import(`data:text/javascript;base64,${Buffer.from(dispatchSource).toString('base64')}`);

const playerContext = { card: { id: 'card-1' } };
assert.deepEqual(dispatch.resolvePlayerTriggerDispatch('on_draw', playerContext), [
  { consumer: 'ability', target: 'player', trigger: 'on_draw', context: playerContext },
  { consumer: 'relic', target: 'player', trigger: 'on_draw', context: playerContext },
]);
assert.deepEqual(dispatch.resolvePlayerTriggerDispatch('turn_start'), [
  { consumer: 'ability', target: 'player', trigger: 'turn_start', context: {} },
  { consumer: 'relic', target: 'player', trigger: 'turn_start', context: {} },
]);

assert.deepEqual(
  dispatch.resolveAttributeTriggerDispatch({ attribute: 'hp', change: -5, target: 'enemy', source: 'player' }),
  [
    { consumer: 'ability', target: 'enemy', trigger: 'take_damage', context: { damage: 5 } },
    { consumer: 'ability', target: 'player', trigger: 'deal_damage', context: { damage: 5 } },
    { consumer: 'relic', target: 'player', trigger: 'deal_damage', context: { damage: 5 } },
  ],
);
assert.deepEqual(
  dispatch.resolveAttributeTriggerDispatch({ attribute: 'hp', change: -3, target: 'player', source: 'enemy' }),
  [
    { consumer: 'ability', target: 'player', trigger: 'take_damage', context: { damage: 3 } },
    { consumer: 'ability', target: 'enemy', trigger: 'deal_damage', context: { damage: 3 } },
    { consumer: 'relic', target: 'player', trigger: 'take_damage', context: { damage: 3 } },
  ],
);
assert.deepEqual(
  dispatch.resolveAttributeTriggerDispatch({ attribute: 'hp', change: 4, target: 'player', source: 'player' }),
  [
    { consumer: 'ability', target: 'player', trigger: 'take_heal', context: { amount: 4 } },
    { consumer: 'relic', target: 'player', trigger: 'take_heal', context: { amount: 4 } },
  ],
  'self-healing must not emit deal_heal',
);
assert.deepEqual(
  dispatch.resolveAttributeTriggerDispatch({ attribute: 'lust', change: 2, target: 'enemy', source: 'player' }),
  [
    { consumer: 'ability', target: 'enemy', trigger: 'lust_increase', context: { amount: 2 } },
    { consumer: 'ability', target: 'player', trigger: 'deal_lust_increase', context: { amount: 2 } },
    { consumer: 'relic', target: 'player', trigger: 'deal_lust_increase', context: { amount: 2 } },
  ],
);
assert.deepEqual(
  dispatch.resolveAttributeTriggerDispatch({ attribute: 'block', change: -6, target: 'player', source: 'enemy' }),
  [
    { consumer: 'ability', target: 'player', trigger: 'lose_block', context: { amount: 6 } },
    { consumer: 'relic', target: 'player', trigger: 'lose_block', context: { amount: 6 } },
  ],
);
assert.deepEqual(
  dispatch.resolveAttributeTriggerDispatch({ attribute: 'energy', change: 1, target: 'player', source: 'player' }),
  [],
);
assert.deepEqual(
  dispatch.resolveAttributeTriggerDispatch({ attribute: 'hp', change: 0, target: 'player', source: 'enemy' }),
  [],
);

assert.deepEqual(
  dispatch.resolveStatusOwnershipTriggerDispatch({ target: 'player', statusType: 'buff', change: 'gain' }),
  [
    {
      consumer: 'ability',
      target: 'player',
      trigger: 'gain_buff',
      context: { targetType: 'player', statusType: 'buff' },
    },
    {
      consumer: 'ability',
      target: 'enemy',
      trigger: 'enemy_gain_buff',
      context: { targetType: 'player', statusType: 'buff' },
    },
    {
      consumer: 'relic',
      target: 'player',
      trigger: 'gain_buff',
      context: { targetType: 'player', statusType: 'buff' },
    },
  ],
);
assert.deepEqual(
  dispatch.resolveStatusOwnershipTriggerDispatch({ target: 'enemy', statusType: 'debuff', change: 'lose' }).map(
    entry => [entry.consumer, entry.target, entry.trigger],
  ),
  [
    ['ability', 'enemy', 'lose_debuff'],
    ['ability', 'player', 'enemy_lose_debuff'],
    ['relic', 'player', 'enemy_lose_debuff'],
  ],
);
assert.deepEqual(
  dispatch.resolveStatusOwnershipTriggerDispatch({ target: 'player', statusType: 'neutral', change: 'gain' }),
  [],
);

console.log('Portable event dispatch preserves receiver/source order and player-relic ownership semantics.');
