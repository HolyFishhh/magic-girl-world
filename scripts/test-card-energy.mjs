import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { resolveCardEnergyPayment } = require(resolve('src/game-core/cardRules.ts'));

assert.deepEqual(resolveCardEnergyPayment({ cost: 2 }, 3), { requiredEnergy: 2, spentEnergy: 2, xValue: 0 });
assert.deepEqual(resolveCardEnergyPayment({ cost: 'energy' }, 3), { requiredEnergy: 0, spentEnergy: 3, xValue: 3 });
assert.deepEqual(resolveCardEnergyPayment({ cost: 'energy', xValueBonus: 2 }, 3), { requiredEnergy: 0, spentEnergy: 3, xValue: 5 });
assert.deepEqual(resolveCardEnergyPayment({ cost: 'energy' }, 0), { requiredEnergy: 0, spentEnergy: 0, xValue: 0 });
assert.deepEqual(resolveCardEnergyPayment({ cost: undefined }, 3), { requiredEnergy: 0, spentEnergy: 0, xValue: 0 });

console.log('Typed card energy payment passed.');
