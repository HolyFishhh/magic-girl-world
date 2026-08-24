import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { runBattleTriggerDispatches } = require(resolve('src/game-core/index.ts'));

const events = [];
await runBattleTriggerDispatches(
  [
    { consumer: 'ability', target: 'player', trigger: 'card_played', context: { cardId: 'a' } },
    { consumer: 'relic', target: 'player', trigger: 'card_played', context: { cardId: 'a' } },
    { consumer: 'ability', target: 'enemy', trigger: 'deal_damage', context: { damage: 2 } },
  ],
  {
    runAbility: async (target, trigger, context) => events.push(['ability', target, trigger, context]),
    runRelic: async (trigger, context) => events.push(['relic', 'player', trigger, context]),
  },
);

assert.deepEqual(events, [
  ['ability', 'player', 'card_played', { cardId: 'a' }],
  ['relic', 'player', 'card_played', { cardId: 'a' }],
  ['ability', 'enemy', 'deal_damage', { damage: 2 }],
]);

await assert.rejects(
  runBattleTriggerDispatches(
    [
      { consumer: 'ability', target: 'player', trigger: 'card_played', context: {} },
      { consumer: 'relic', target: 'player', trigger: 'card_played', context: {} },
    ],
    {
      runAbility: () => {
        throw new Error('ability failed');
      },
      runRelic: () => events.push(['unexpected']),
    },
  ),
  /ability failed/,
);
assert.equal(events.includes('unexpected'), false, 'a failed consumer must stop later dispatches');

console.log('Portable battle-trigger runtime preserves declared order and failure short-circuiting.');
