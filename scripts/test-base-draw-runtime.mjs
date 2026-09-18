import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (!process.argv[2]) {
  for (const scenario of ['ordinary', 'innate', 'stacked', 'enemy']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), scenario], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    process.stdout.write(result.stdout);
  }
  process.exit(0);
}
const scenario = process.argv[2];
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { createBattleRequestFromMvu } = require('../src/fish/core/battleContractAdapter.ts');
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { DynamicStatusManager } = require('../src/fish/combat/dynamicStatusManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
const { CardSystem } = require('../src/fish/combat/cardSystem.ts');
const { BattleManager } = require('../src/fish/combat/battleManager.ts');
const status = { id: 'slow', name: '减抽', emoji: '◇', type: 'debuff', stacks_change: -1,
  triggers: { hold: { modify: 'draw_per_turn', subtract: 'stacks' } } };
const battle = {
  core: { emoji: '◇', hp: 100, max_hp: 100, lust: 0, max_lust: 100 },
  cards: [
    { id: 'normal', name: '普通', type: 'Skill', rarity: 'Common', cost: 0, quantity: 12, effects: { block: 1 } },
    ...(scenario === 'innate' ? [{ id: 'innate', name: '固有', type: 'Skill', rarity: 'Common', cost: 0, quantity: 4, innate: true, effects: { block: 1 } }] : []),
  ],
  statuses: [status], artifacts: [], items: [],
  player_abilities: scenario === 'stacked' ? [{ id: 'plus', name: '额外基础抽牌', trigger: { on: 'passive', effects: { modify: 'draw_per_turn', add: 1 } } }] : [],
  player_status_effects: scenario === 'enemy' ? [] : [{ id: 'slow', stacks: 2 }],
  enemy: { id: 'fixture', name: '隔离目标', emoji: '◇', hp: 100, max_hp: 100, lust: 0, max_lust: 100,
    status_effects: scenario === 'enemy' ? [{ id: 'slow', stacks: 2 }] : [],
    actions: [{ name: '等待', effects: { block: 0 } }] },
};
const original = structuredClone(battle);
const store = GameStateManager.getInstance(), executor = UnifiedEffectExecutor.getInstance();
const cards = CardSystem.getInstance(), manager = BattleManager.getInstance();
const quiet = new Proxy({}, { get: () => async () => undefined });
executor.presentation = quiet; cards.presentation = quiet;
manager.relicTriggerHost.presentation = quiet; manager.enemyIntentPresenter = quiet;
store.convertMVUToGameState(createBattleRequestFromMvu({ stat_data: { battle } }, battle));
assert.deepEqual(DynamicStatusManager.getInstance().registry.replace(battle.statuses).rejected, []);
if (scenario === 'enemy') assert.equal(store.getEnemy().statusEffects.find(s => s.id === 'slow')?.stacks, 2,
  'enemy isolation must test a genuinely applied modifier');
manager.prepareInitialPlayerTurn(); await manager.beginInitialPlayerTurn();
const expected = scenario === 'enemy' ? 5 : scenario === 'ordinary' ? 3 : 4;
assert.equal(store.getPlayer().hand.length, expected, scenario + ' initial draw');
if (scenario === 'innate') assert.ok(store.getPlayer().hand.every(c => c.innate));
assert.equal((await cards.drawCards(1)).length, 1, 'active draw remains independent');
const saved = JSON.stringify(store.getGameState()); store.replaceState(JSON.parse(saved));
assert.equal(JSON.stringify(store.getGameState()), saved);
await manager.endPlayerTurn();
if (scenario !== 'enemy') assert.equal(store.getPlayer().statusEffects.find(s => s.id === 'slow')?.stacks, 1);
assert.equal(store.getPlayer().hand.length, scenario === 'stacked' || scenario === 'enemy' ? 5 : 4,
  'full turn decays status before next automatic draw');
assert.equal(store.getPlayer().drawPerTurn, 5);
assert.deepEqual(battle, original);
console.log(`PASS base draw ${scenario}: opening, active draw, JSON restore, full player/enemy turn, status decay; source unchanged.`);
