// Execute the exact resource examples sent to the model, never a live save.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const tower = require('../src/game-core/towerRequest.ts');
const core = require('../src/game-core/index.ts');
const { convertMvuCards, convertMvuEnemies } = require('../src/fish/core/mvuBattleAdapter.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { CardSystem } = require('../src/fish/combat/cardSystem.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const { BattleManager } = require('../src/fish/combat/battleManager.ts');
const { initialDraftAuthoringPrompt } = require('../src/sillytavern-extension/initialDraftPrompt.ts');

const prompt = tower.formatCompactEffectAuthoringContract();
assert.match(prompt, /reset 是每回合开始补满到 max，不是归零或恢复 start/);
assert.match(prompt, /amount 为正数是增加，为负数是减少/);
assert.match(prompt, /负数 resource 效果不是出牌费用/);
const prefix = '资源语义示例（只说明规则，不是必须生成的内容）：';
const exampleLine = prompt.split('\n').find(line => line.startsWith(prefix));
assert.ok(exampleLine, 'the examples must actually be delivered in the full authoring contract');
const examples = JSON.parse(exampleLine.slice(prefix.length));
const original = structuredClone(examples);
const draftPrompt = initialDraftAuthoringPrompt({
  startPrompt: '测试资源积累与支付', config: {}, narrative: '已由原预设生成的剧情', currentStat: {}, designGuidance: null,
});
assert.equal(draftPrompt.split(exampleLine).length, 2, 'registry first draft receives the exact examples once');
assert.ok(draftPrompt.includes(tower.formatCompactEffectAuthoringContract('initial-draft')), 'draft receives the full contract in its own definition placement');
const {formatCombatResourceAuthoringContract}=require('../src/game-core/resourceAuthoringContract.ts');
assert.deepEqual(formatCombatResourceAuthoringContract('initial-draft').split('\n').slice(1),
  formatCombatResourceAuthoringContract().split('\n').slice(1), 'all resource execution semantics and examples are identical across placement modes');

const schema = tower.createTowerInitialContentJsonSchema().value;
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validate = def => ajv.compile({ $defs: schema.$defs, $ref: `#/$defs/${def}` });
assert.equal(validate('mwgCombatResource')(examples.resource), true);
const effectSchema = validate('resourceEffect');
assert.equal(effectSchema(examples.gain.effects), true);
assert.equal(effectSchema(examples.loss.effects), true, 'negative deltas are valid, unlike negative costs');

const [enemy] = convertMvuEnemies([{
  id: 'resource_dummy', name: '资源测试目标', emoji: '◇', hp: 100, max_hp: 100, lust: 0, max_lust: 100,
  actions: [{ name: '等待', effects: { block: 1 } }],
}]);
const manager = GameStateManager.getInstance();
const cards = CardSystem.getInstance();
const executor = UnifiedEffectExecutor.getInstance();
const battle = BattleManager.getInstance();
const quiet = new Proxy({}, { get: () => async () => undefined });
cards.presentation = quiet;
executor.presentation = quiet;
battle.relicTriggerHost.presentation = quiet;
battle.enemyIntentPresenter = quiet;

function setup(example, current, refresh = examples.resource.refresh) {
  const [card] = convertMvuCards([{
    id: 'resource_test', name: '规则示例', emoji: '◇', type: 'Skill', rarity: 'Common', quantity: 1, ...example,
  }]);
  assert.ok(card, 'prompt example must compile through the real MVU adapter');
  const state = core.createEmptyBattleState();
  state.phase = 'player_turn';
  state.player.energy = 3;
  state.player.maxEnergy = 3;
  state.player.resources = core.normalizeCombatResourceStates([{ ...examples.resource, current, refresh }]);
  state.player.hand = [card];
  state.player.deck = [card];
  manager.replaceState(state);
  manager.setEnemies([structuredClone(enemy)], enemy.id);
  return card;
}

for (const refresh of ['retain', 'reset']) {
  setup(examples.gain, examples.resource.start, refresh);
  battle.prepareInitialPlayerTurn();
  await battle.beginInitialPlayerTurn();
  assert.equal(manager.getPlayer().resources.charge.current, refresh === 'retain' ? 0 : examples.resource.max,
    'first actual player turn obeys the documented retain/refill distinction');
}

for (const [example, before, expectedResource, expectedEnergy, expectedHp] of [
  [examples.gain, 0, 2, 2, 100],
  [examples.gain, 5, 6, 2, 100],
  [examples.loss, 2, 0, 2, 100],
  [examples.loss, 1, 0, 2, 100], // Effect clamps at zero; it is NOT an affordability check.
  [examples.spend, 2, 0, 2, 90],
  [examples.spend, 5, 3, 2, 90],
]) {
  const card = setup(example, before);
  assert.equal(cards.previewCardPlay(card.id).ok, true);
  assert.equal(await cards.playCard(card.id), true);
  assert.equal(manager.getPlayer().resources.charge.current, expectedResource);
  assert.equal(manager.getPlayer().energy, expectedEnergy);
  assert.equal(manager.getEnemy().currentHp, expectedHp);
}

for (const available of [0, 1]) {
  const card = setup(examples.spend, available);
  const before = structuredClone(manager.getGameState());
  assert.equal(cards.previewCardPlay(card.id).ok, false);
  assert.equal(await cards.playCard(card.id), false, 'mandatory composite cost rejects resource shortage');
  assert.deepEqual(manager.getGameState(), before, 'rejection pays no energy, deals no damage, and moves no card');
}
assert.deepEqual(examples, original, 'compilation and battle execution leave the authored examples unchanged');
console.log('Prompt resource examples pass shared schema, actual MVU/card execution, signs, clamps, refresh, and atomic payment.');
