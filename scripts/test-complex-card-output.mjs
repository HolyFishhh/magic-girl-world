import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const fixture = JSON.parse(await readFile(resolve('scripts/fixtures/ai-complex-content-v1.json'), 'utf8'));

function containerDepth(value, depth = 0) {
  if (!value || typeof value !== 'object') return depth;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.reduce((maximum, child) => Math.max(maximum, containerDepth(child, depth + 1)), depth + 1);
}

function forbiddenProtocolKeys(value, path = '$', issues = []) {
  if (!value || typeof value !== 'object') return issues;
  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    if (['spec', 'op', 'steps', 'effect', 'effect_program', 'effectProgram', 'discard_effect'].includes(key)) {
      issues.push(childPath);
    }
    forbiddenProtocolKeys(child, childPath, issues);
  }
  return issues;
}

const content = core.createContentPack(fixture);
const contract = core.validateContentPackContract(content, { requireExecutable: true });
assert.equal(contract.ok, true, contract.ok ? '' : core.formatContentContractIssues(contract.issues, 20));
assert.deepEqual(forbiddenProtocolKeys(fixture), [], 'AI fixture must contain only the public shallow protocol');

const cardMeasurements = fixture.cards.map(card => {
  const json = JSON.stringify(card);
  const compilation = core.compileCompactEffectList(card.effects, {
    trigger: card.trigger,
    creates: card.creates,
    statusNames: { focus: '星辉专注' },
  });
  assert.equal(compilation.ok, true, `${card.id}: ${JSON.stringify(compilation.issues)}`);
  const description = core.describeCompactCard(card, { statusNames: { focus: '星辉专注' } });
  assert.ok(description.length > 0, `${card.id} must have a generated description`);
  return { id: card.id, depth: containerDepth(card), tokens: encode(json).length, program: compilation.value };
});

assert.ok(cardMeasurements.every(card => card.depth <= 4), JSON.stringify(cardMeasurements));
assert.ok(cardMeasurements.every(card => card.tokens <= 130), JSON.stringify(cardMeasurements));
assert.ok(encode(JSON.stringify(fixture)).length <= 650, 'complete first-turn content fixture exceeded 650 tokens');
assert.equal(fixture.cards.reduce((total, card) => total + card.quantity, 0), 14);

const xCard = cardMeasurements.find(card => card.id === 'last_light');
const state = {
  self: {
    hp: 30,
    maxHp: 50,
    lust: 0,
    maxLust: 100,
    energy: 3,
    maxEnergy: 3,
    block: 0,
    statusStacks: { focus: 2 },
  },
  opponent: { hp: 50, maxHp: 50, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 0 },
};
const executed = core.executeEffectProgram(xCard.program, state, { spentEnergy: 3 });
assert.equal(executed.ok, true);
assert.equal(executed.state.opponent.hp, 31, 'X-cost formula must use spent energy and status stacks');
assert.equal(executed.state.self.block, 6);

const power = cardMeasurements.find(card => card.id === 'prism_oath').program;
assert.deepEqual(
  power.steps.map(step => step.trigger),
  ['turn_start', 'card_played', 'take_damage'],
  'one flat effects array must represent multiple triggers without nested AI AST',
);

const generated = cardMeasurements.find(card => card.id === 'spark_forge').program;
assert.equal(generated.steps[0].op, 'add_card');
assert.equal(generated.steps[0].card.program.steps.length, 2);

const bad = core.createContentPack({
  ...fixture,
  cards: fixture.cards.map(card =>
    card.id === 'last_light' ? { ...card, effects: { ...card.effects, damage: 'unknown_power * 5' } } : card,
  ),
});
const badContract = core.validateContentPackContract(bad, { requireExecutable: true });
assert.equal(badContract.ok, false);
assert.ok(
  badContract.issues.some(issue => issue.path === 'cards[2].effects.damage.left'),
  core.formatContentContractIssues(badContract.issues, 20),
);

console.table(cardMeasurements.map(({ id, depth, tokens }) => ({ id, depth, tokens })));
console.log(`Complex first-turn fixture: ${encode(JSON.stringify(fixture)).length} o200k tokens; shallow protocol and formulas passed.`);
