import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const { createRunState } = require(resolve('src/game-core/runState.ts'));
const content = require(resolve('src/game-core/towerContentState.ts'));
const tower = require(resolve('src/runtime/towerStateAdapter.ts'));
const { createTowerEncounterPlan } = require(resolve('src/game-core/towerEncounterPlan.ts'));
const { recommendTowerBattleRewardBudget } = require(resolve('src/game-core/contentBudget.ts'));
const { TOWER_GENERATION_EVIDENCE_METADATA_KEY } = require(resolve('src/sillytavern-extension/towerGenerationEvidence.ts'));
const { DESIGN_ASSISTANT_CARD_SCOPE, DESIGN_ASSISTANT_EXTENSION_ID, DEFAULT_DESIGN_ASSISTANT_SETTINGS } = require(resolve('src/sillytavern-extension/types.ts'));

function hash(value) { return JSON.stringify(value); }

function makeHarness({ unrepaired = false } = {}) {
  let variables = {
    stat_data: {
      game_mode: 'tower',
      game_mode_lock: { schemaVersion: 1, mode: 'tower' },
      battle: {
        core: { emoji: '🪡', hp: 28, max_hp: 30, lust: 0, max_lust: 100 },
        cards: [{ id: 'strike', name: '刺击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } }],
        statuses: [], artifacts: [], items: [], player_abilities: [], player_status_effects: [], enemy: null, enemies: [],
      },
      run: createRunState({ seed: 4401 }),
    },
    __magic_girl_world: { battle_session: { state: { marker: 'live battle', turn: 3 } } },
  };
  const nodes = variables.stat_data.run.map.nodes.filter(node => node.kind === 'battle').slice(0, 2);
  assert.equal(nodes.length, 2);
  const jobs = nodes.map(node => {
    const queued = content.queueTowerNodeContent(variables.stat_data.run.nodeContent, node.id, variables.stat_data.run.stateRevision);
    variables.stat_data.run.nodeContent = queued.store;
    return tower.claimTowerGenerationInStat(variables.stat_data, node.id, queued.envelope.requestId).request;
  });
  const context = {
    chatId: 'reward-repair-chat', chat: [{ mes: 'kept story' }], characterId: 0, groupId: null,
    characters: [{ data: { extensions: { magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE } } } }],
    extensionSettings: { [DESIGN_ASSISTANT_EXTENSION_ID]: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS, enabled: false } },
    chatMetadata: {}, saveMetadataDebounced() {}, saveSettingsDebounced() {},
    eventSource: { on() {}, removeListener() {} }, eventTypes: {},
  };
  const makeBattleResult = (job, reward, title = '合法兄弟节点') => {
    const plan = createTowerEncounterPlan({ nodeId: job.nodeId, kind: job.kind, contentSeed: job.contentSeed, act: job.act, floor: job.floor });
    const budget = recommendTowerBattleRewardBudget({ nodeId: job.nodeId, kind: job.kind, act: job.act, floor: job.floor, rewardSeed: job.rewardSeed, enemyCount: plan.enemyCount });
    const enemies = Array.from({ length: plan.enemyCount }, (_, index) => ({
      id: `enemy_${index}`, name: `敌人${index + 1}`, emoji: '🦋', hp: 40, max_hp: 40, lust: 0, max_lust: 100,
      actions: [{ id: 'hit', name: '振翅', effects: { damage: 5 } }],
    }));
    return {
      spec: 'mwg.tower-node-result/v1', node_id: job.nodeId, request_id: job.requestId,
      based_on_revision: job.revision, kind: job.kind, title, narrative: '固定回归叙事',
      payload: { battle: { enemies, statuses: [] } }, reward: {
        ...reward,
        card: reward.card ?? budget.cards.slotRarities.map((rarity, index) => ({ id: `card_${job.nodeId}_${index}`, name: `候选${index}`, type: 'Attack', rarity, cost: 1, effects: { damage: 8 } })),
        artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
      },
    };
  };
  const validReward = {};
  const recoverableReward = () => {
    const reward = makeBattleResult(jobs[0], validReward).reward;
    reward.card[0] = { id: 'recoverable_reward', name: '可还原奖励', type: 'Attack', rarity: reward.card[0].rarity, cost: 1, effects: { damage: 3 } };
    return reward;
  };
  const initialResponse = () => {
    const malformed = makeBattleResult(jobs[0], validReward);
    const originalReward = recoverableReward();
    // The successful fixture has only an outer-array defect: its sole element
    // is the complete, plan-valid reward object, so unwrapping it is lossless.
    // The negative fixture substitutes reward=[] to prove no reward can be invented.
    malformed.reward = unrepaired ? [] : [structuredClone(originalReward)];
    return {
      spec: 'mwg.tower-node-batch-result/v1', batch_id: 'bounded-reward-repair', based_on_revision: jobs[0].revision,
      results: [malformed, makeBattleResult(jobs[1], validReward)],
    };
  };
  const repairedResponse = () => {
    const value = initialResponse();
    value.results[0] = makeBattleResult(jobs[0], recoverableReward(), '修复后的节点');
    value.results[1] = makeBattleResult(jobs[1], validReward, '不应覆盖的兄弟');
    value.results[1].narrative = '不应覆盖的兄弟原文';
    return value;
  };
  const calls = [];
  const host = {
    context: () => context,
    mvu: () => ({ getMvuData: () => variables, replaceMvuData: async next => { variables = structuredClone(next); } }),
    now: () => 44, notify() {},
  };
  const ports = {
    currentChatId: () => context.chatId,
    createChatMessages: async () => { throw new Error('hidden chat archive must not be called'); },
    generate: async config => {
      calls.push(config);
      return JSON.stringify(calls.length === 1 || unrepaired ? initialResponse() : repairedResponse());
    },
    stopGenerationById: () => true,
    emitInternalEvent: async () => undefined,
  };
  const controller = new DesignAssistantController(host, undefined, ports, { towerCoordinator: false });
  controller.activate();
  const request = { generationType: 'batch', batchId: 'bounded-reward-repair', requestId: 'bounded-reward-repair', basedOnRevision: jobs[0].revision, jobs, prompt: '只修复 reward 容器类型', maxAttempts: 1 };
  return { controller, context, jobs, request, calls, variables: () => variables, initialResponse, repairedResponse };
}

const success = makeHarness();
const siblingBefore = structuredClone(success.initialResponse().results[1]);
const comparable = value => ({ title: value.title, narrative: value.narrative, payload: value.payload, reward: { ...value.reward, gold: undefined, gold_claimed: undefined } });
const siblingHash = hash(comparable(siblingBefore));
await success.controller.requestTowerGeneration(success.request);
assert.equal(success.calls.length, 2, 'must use exactly one bounded structural repair');
const successStore = success.variables().stat_data.run.nodeContent;
assert.equal(successStore[success.jobs[0].nodeId].phase, 'ready');
assert.equal(successStore[success.jobs[1].nodeId].phase, 'ready');
assert.equal(hash(comparable(successStore[success.jobs[1].nodeId].content)), siblingHash, 'valid sibling must remain byte-equivalent');
const successHistory = success.context.chatMetadata[TOWER_GENERATION_EVIDENCE_METADATA_KEY];
assert.ok(successHistory);
assert.ok(successHistory.records.some(record => record.requestId === success.request.requestId && record.stage === 'request' && record.prompt.includes('只修复 reward')));
assert.ok(successHistory.records.some(record => record.requestId === success.request.requestId && record.stage === 'response' && record.response.includes('recoverable_reward')));
const repairId = `${success.request.requestId}__structure_repair_1`;
assert.ok(successHistory.records.some(record => record.requestId === repairId && record.parentRequestId === success.request.requestId && record.stage === 'request'));
assert.ok(successHistory.records.some(record => record.requestId === repairId && record.stage === 'response' && record.response.includes('recoverable_reward')));
assert.ok(successHistory.records.some(record => record.requestId === repairId && record.stage === 'outcome'));
assert.ok(successHistory.records.some(record => record.requestId === success.request.requestId && record.stage === 'outcome'));
assert.equal(successHistory.records.filter(record => record.requestId === repairId && record.stage === 'response').length, 1);
success.controller.deactivate();

const failure = makeHarness({ unrepaired: true });
await failure.controller.requestTowerGeneration(failure.request);
assert.equal(failure.calls.length, 2, 'unrepairable reward shape still spends only the single bounded repair');
const failureStore = failure.variables().stat_data.run.nodeContent;
assert.equal(failureStore[failure.jobs[0].nodeId].phase, 'failed');
assert.equal(Object.hasOwn(failureStore[failure.jobs[0].nodeId], 'reward'), false, 'must not invent a reward');
assert.equal(Object.hasOwn(failureStore[failure.jobs[0].nodeId], 'content'), false, 'must not publish an unproven candidate');
assert.equal(failureStore[failure.jobs[1].nodeId].phase, 'ready');
const failureHistory = failure.context.chatMetadata[TOWER_GENERATION_EVIDENCE_METADATA_KEY];
assert.ok(failureHistory.records.some(record => record.requestId === failure.request.requestId && record.stage === 'outcome' && record.outcome?.outcome === 'partial'));
assert.equal(failureHistory.records.filter(record => record.requestId === `${failure.request.requestId}__structure_repair_1` && record.stage === 'response').length, 1);
assert.ok(failureHistory.records.some(record => record.requestId === `${failure.request.requestId}__structure_repair_1` && record.stage === 'outcome'));
failure.controller.deactivate();

console.log('bounded reward structure repair chain: ok');