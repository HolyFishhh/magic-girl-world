import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const fixed = { metrics: { attack: 8, defense: 0, sustain: 0, draw: 0, energy: 0 }, dynamicMetrics: new Set() };
const defense = { metrics: { attack: 0, defense: 5, sustain: 0, draw: 0, energy: 0 }, dynamicMetrics: new Set() };
const dynamicAttack = {
  metrics: { attack: 0, defense: 0, sustain: 0, draw: 0, energy: 0 },
  dynamicMetrics: new Set(['attack']),
};

assert.deepEqual(
  core.assessDeckPlayability([
    { type: 'Attack', cost: 1, quantity: 5, analysis: fixed },
    { type: 'Skill', cost: 4, quantity: 2, analysis: defense },
    { type: 'Curse', quantity: 1, analysis: null },
  ]),
  {
    deckQuantity: 8,
    hasPlayableCard: true,
    hasVictoryPressure: true,
    hasDefenseOrRecovery: true,
  },
);

assert.equal(
  core.assessDeckPlayability([{ type: 'Skill', cost: 4, quantity: 1, analysis: fixed }]).hasPlayableCard,
  false,
  'cards above the base energy budget are not considered playable',
);
assert.equal(
  core.assessDeckPlayability([{ type: 'Skill', cost: 3, quantity: 1, analysis: dynamicAttack }]).hasVictoryPressure,
  true,
  'formula-driven attack remains visible through the shared analysis result',
);
assert.equal(
  core.assessDeckPlayability([{ type: 'Event', cost: 0, quantity: 1, analysis: null }]).hasVictoryPressure,
  true,
  'event cards provide an explicit battle-ending pressure path',
);

const preflight = await readFile(resolve('src/fish/core/battleContentPreflight.ts'), 'utf8');
assert.match(preflight, /assessDeckPlayability\(/);
assert.match(preflight, /hasContentMetric\(/);
assert.doesNotMatch(preflight, /let\s+(?:deckQuantity|hasPlayableCard|hasVictoryPressure|hasDefenseOrRecovery)\s*=/);

const enemyBudget = await readFile(resolve('src/game-core/enemyBudget.ts'), 'utf8');
assert.match(enemyBudget, /hasContentMetric\(/);
assert.doesNotMatch(enemyBudget, /metrics\.attack\s*>\s*0\s*\|\|\s*analysis\.dynamicMetrics\.has/);

const [contentContract, rewardValidation, tavernAdapter] = await Promise.all([
  readFile(resolve('src/game-core/contentContract.ts'), 'utf8'),
  readFile(resolve('src/game-core/rewardCandidateValidation.ts'), 'utf8'),
  readFile(resolve('src/fish/core/battleContentAdapter.ts'), 'utf8'),
]);
for (const source of [contentContract, rewardValidation, tavernAdapter]) {
  assert.match(source, /contentCatalog|CARD_TYPE_SET/);
  assert.doesNotMatch(source, /const\s+(?:CARD_TYPES|CARD_RARITIES|RELIC_RARITIES)\s*=\s*new Set/);
}

console.log('Deck playability diagnostics are shared by game-core and Tavern preflight.');
