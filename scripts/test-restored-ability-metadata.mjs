import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { recoverRestoredAbilityMetadata } = require(resolve('src/fish/core/gameStateManager.ts'));

const registeredEffect = { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 2 }] };
const state = {
  player: {
    deck: [
      {
        id: 'alpha_bond',
        name: '狼王羁绊',
        emoji: '👑',
        description: '狼王会在攻击时主动守护契约者。',
        effectProgram: {
          spec: 'mwg.effect/v1',
          steps: [{ op: 'register_trigger', trigger: 'attack_played', effects: registeredEffect.steps }],
        },
      },
    ],
    relics: [],
    abilities: [
      {
        id: 'ability__1',
        trigger: 'attack_played',
        effectProgram: registeredEffect,
      },
    ],
  },
  enemy: null,
};

recoverRestoredAbilityMetadata(state);
assert.equal(state.player.abilities[0].name, '狼王羁绊');
assert.equal(state.player.abilities[0].source, '卡牌「狼王羁绊」');
assert.equal(state.player.abilities[0].emoji, '👑');
assert.match(state.player.abilities[0].description, /狼王/);

const unmatched = {
  player: {
    deck: [],
    relics: [],
    abilities: [{ id: 'ability__9', trigger: 'turn_start', effectProgram: registeredEffect }],
  },
  enemy: null,
};
recoverRestoredAbilityMetadata(unmatched);
assert.equal(unmatched.player.abilities[0].name, '临时能力 1');
assert.match(unmatched.player.abilities[0].source, /旧快照未记录具体来源/);

console.log('Restored battle abilities recover human-readable names and exact card sources when possible.');
