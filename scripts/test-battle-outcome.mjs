import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { settleBattleOutcomeVitals } = require(resolve('src/game-core/battleOutcome.ts'));

assert.deepEqual(settleBattleOutcomeVitals({ currentHp: 23, currentLust: 17 }, { max_hp: 80, max_lust: 100 }), {
  hp: 23,
  lust: 17,
});
assert.deepEqual(settleBattleOutcomeVitals({ currentHp: -4, currentLust: 120 }, { max_hp: 80, max_lust: 100 }), {
  hp: 0,
  lust: 100,
});
assert.deepEqual(
  settleBattleOutcomeVitals({ currentHp: Number.NaN, currentLust: undefined }, { max_hp: 0, max_lust: 'bad' }),
  { hp: 0, lust: 0 },
);

console.log('Post-battle persistent vitals are deterministic and clamped.');
for(const [hp,expected] of [[20.2,20],[20.5,21],[20.8,21],[0.2,0],[0.5,1]]){
 const input={currentHp:hp,currentLust:1.25};assert.equal(settleBattleOutcomeVitals(input,{max_hp:50,max_lust:100}).hp,expected);assert.equal(input.currentHp,hp,'rounding does not mutate in-combat state');
}
