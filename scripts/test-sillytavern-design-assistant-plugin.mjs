import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { DesignAssistantEngine, enemyGenerationFingerprintFromVariables } = require(
  resolve('src/sillytavern-extension/designEngine.ts'),
);
const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const { DesignWorkerClient } = require(resolve('src/sillytavern-extension/workerClient.ts'));
const { DesignKnowledgeGraph } = require(resolve('src/sillytavern-extension/knowledgeGraph.ts'));
const { isMagicGirlWorldCharacter } = require(resolve('src/sillytavern-extension/characterScope.ts'));
const { injectDesignContext, hasDesignContext } = require(resolve('src/sillytavern-extension/promptInjection.ts'));
const {
  DESIGN_ASSISTANT_EXTENSION_ID,
  DESIGN_ASSISTANT_CARD_SCOPE,
  DESIGN_ASSISTANT_METADATA_KEY,
  DESIGN_ASSISTANT_PROMPT_MARKER,
} = require(resolve('src/sillytavern-extension/types.ts'));

function enemy(id, hp, damage, familyId = undefined) {
  return {
    id,
    name: id === 'slime_scout' ? '蚀光软泥斥候' : '蚀光软泥领主',
    family_id: familyId,
    stage: id === 'slime_scout' ? 'scout' : 'boss',
    emoji: '🟣',
    hp,
    max_hp: hp,
    lust: 0,
    max_lust: 100,
    actions: [
      { id: 'lash', name: '腐蚀鞭击', weight: 2, effects: { damage } },
      { id: 'veil', name: '黏膜防护', weight: 1, effects: { block: Math.max(1, Math.round(damage / 2)) } },
    ],
    abilities: [],
    status_effects: [],
    lust_effect: { name: '失衡吞噬', effects: { damage: Math.max(1, damage) } },
    action_mode: 'probability',
    action_config: { probability: { 腐蚀鞭击: 2, 黏膜防护: 1 } },
  };
}

function variables(withEnemy = true) {
  return {
    stat_data: {
      battle: {
        core: { emoji: '🧙', hp: 58, max_hp: 80, lust: 24, max_lust: 100 },
        cards: [
          { id: 'mark', name: '刻痕', type: 'Attack', rarity: 'Common', cost: 1, quantity: 4, effects: { damage: 5, apply_status: 'trace', stacks: 1, to: 'opponent' } },
          { id: 'detonate', name: '引爆', type: 'Attack', rarity: 'Uncommon', cost: 2, quantity: 2, effects: [{ damage: '4 + opponent.status.trace.stacks * 3' }, { remove_status: 'trace', to: 'opponent' }] },
          { id: 'guard', name: '回路屏障', type: 'Skill', rarity: 'Common', cost: 1, quantity: 4, effects: { block: 6 } },
          { id: 'cycle', name: '回路循环', type: 'Skill', rarity: 'Uncommon', cost: 0, quantity: 1, effects: { draw: 1, energy: 1 } },
        ],
        statuses: [{ id: 'trace', name: '轨迹', type: 'debuff', triggers: { tick: { effects: { damage: 'stacks' } } } }],
        artifacts: [{ id: 'lens', name: '回路透镜', trigger: 'battle_start', effects: { block: 4 } }],
        items: [],
        player_abilities: [],
        player_status_effects: [],
        player_lust_effect: { name: '过载回路', effects: { damage: 8, draw: 1 } },
        enemy: withEnemy ? enemy('slime_scout', 72, 9, 'corrosion_slime') : null,
        enemies: [],
      },
      reward: {},
    },
  };
}

const engine = new DesignAssistantEngine();
const settings = {
  enabled: true,
  difficultyPercent: 80,
  autoCalibration: false,
  simulationSeeds: 8,
  showNotifications: false,
  debug: false,
};
const first = engine.createSnapshot(variables(), null, settings);
assert.ok(first);
assert.ok(first.deckProfile.totalScore > 0);
assert.equal(first.enemyEnvelope.requestedRatio, 80);
assert.match(first.prompt, /^\[MWG_DESIGN_CONTEXT\/v1\]/);
assert.match(first.prompt, /当前流派：/);
assert.match(first.prompt, /知识图谱邻接路径：/);
assert.match(first.prompt, /self恒指该效果的拥有者/);
assert.match(first.prompt, /蚀光软泥斥候/);
assert.ok(first.prompt.length < 5000, `injected context must stay compact, got ${first.prompt.length}`);
assert.ok(first.knowledgeGraph.nodes.length > 0);
assert.ok(first.knowledgeGraph.edges.length > 0);

const graph = new DesignKnowledgeGraph();
const graphView = graph.query(first.deckProfile.archetypes.slice(0, 2).map(entry => entry.id), first.lineage, 1);
assert.ok(graphView.nodes.some(node => node.kind === 'archetype'));
assert.ok(graphView.edges.some(edge => edge.kind === 'evolves-to'));
assert.ok(graph.stats(first.lineage).nodes >= graphView.nodes.length);

const payload = {
  prompt: [
    { role: 'system', content: 'base' },
    { role: 'user', content: '遵循<must>指令' },
    { role: 'system', content: 'tail' },
  ],
};
assert.equal(injectDesignContext(payload, first.prompt), true);
assert.equal(payload.prompt[1].content.startsWith(DESIGN_ASSISTANT_PROMPT_MARKER), true);
assert.equal(payload.prompt[2].role, 'user');
assert.equal(hasDesignContext(payload), true);
assert.equal(injectDesignContext(payload, first.prompt), false, 'same request must never be injected twice');

const boundedPayload = {
  messages: [
    { role: 'system', content: '<past_observe>history</past_observe>' },
    { role: 'system', content: 'MVU task' },
    { role: 'user', content: 'latest action' },
  ],
};
assert.equal(injectDesignContext(boundedPayload, first.prompt), true);
assert.equal(boundedPayload.messages[1].content.startsWith(DESIGN_ASSISTANT_PROMPT_MARKER), true);
assert.equal(boundedPayload.messages[2].content, 'MVU task');

class FakeEvents {
  listeners = new Map();
  on(event, listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }
  async emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) await listener(...args);
  }
}

const events = new FakeEvents();
const scopedCharacter = {
  data: {
    extensions: {
      magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE },
    },
  },
};
const context = {
  characterId: 0,
  groupId: null,
  characters: [scopedCharacter],
  extensionSettings: { [DESIGN_ASSISTANT_EXTENSION_ID]: settings },
  saveSettingsDebounced() {},
  chatMetadata: {},
  saveMetadataDebounced() {},
  eventSource: events,
  eventTypes: {
    GENERATE_AFTER_DATA: 'generate_after_data',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_CHANGED: 'chat_id_changed',
  },
};
assert.equal(isMagicGirlWorldCharacter(context), true);
assert.equal(isMagicGirlWorldCharacter({ ...context, characters: [{ data: { extensions: {} } }] }), false);
assert.equal(isMagicGirlWorldCharacter({ ...context, groupId: 'group-1' }), false);
let duringExtra = false;
let currentVariables = variables();
const notifications = [];
const controller = new DesignAssistantController({
  context: () => context,
  mvu: () => ({
    getMvuData: () => currentVariables,
    isDuringExtraAnalysis: () => duringExtra,
  }),
  now: () => 123456,
  notify: (...args) => notifications.push(args),
});
controller.activate();
await controller.warmup();
assert.equal(controller.getStatus().phase, 'ready');
assert.ok(controller.getKnowledgeGraphStats().nodes > 0);

const ordinaryPayload = { prompt: [{ role: 'user', content: 'normal story request' }] };
await events.emit('generate_after_data', ordinaryPayload);
assert.equal(hasDesignContext(ordinaryPayload), false, 'ordinary story generation must not receive design context');

duringExtra = true;
const unrelatedPayload = { prompt: [{ role: 'user', content: 'another card extra request' }] };
context.characters = [{ data: { extensions: {} } }];
await events.emit('generate_after_data', unrelatedPayload);
assert.equal(hasDesignContext(unrelatedPayload), false, 'another character card must never receive design context');
const unrelatedMetadataBefore = JSON.stringify(context.chatMetadata);
const unrelatedBefore = variables();
const unrelatedAfter = variables();
unrelatedAfter.stat_data.battle.enemy = enemy('unrelated_enemy', 400, 40);
await events.emit('mag_variable_update_ended', unrelatedAfter, unrelatedBefore);
assert.equal(
  JSON.stringify(context.chatMetadata),
  unrelatedMetadataBefore,
  'another character card must never be scored or calibrated after MVU writes variables',
);
assert.equal(unrelatedAfter.stat_data.battle.enemy.max_hp, 400);
context.characters = [scopedCharacter];
const extraPayload = { prompt: [{ role: 'system', content: 'mvu' }, { role: 'user', content: 'update' }] };
await events.emit('generate_after_data', extraPayload);
assert.equal(hasDesignContext(extraPayload), true, 'MVU extra-model request must receive dynamic context');
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionAt, 123456);
assert.equal(controller.getStatus().phase, 'ready');
const markerCountAfterPrimaryEvent = JSON.stringify(extraPayload).split(DESIGN_ASSISTANT_PROMPT_MARKER).length - 1;
await events.emit('chat_completion_settings_ready', extraPayload);
assert.equal(
  JSON.stringify(extraPayload).split(DESIGN_ASSISTANT_PROMPT_MARKER).length - 1,
  markerCountAfterPrimaryEvent,
  'compatibility event must keep the same request idempotent',
);
assert.equal(controller.getStatus().phase, 'ready', 'duplicate compatibility event must not report a false error');

const beforeEnemy = structuredClone(currentVariables);
currentVariables.stat_data.battle.enemy = enemy('slime_boss', 180, 18, 'corrosion_slime');
assert.notEqual(
  enemyGenerationFingerprintFromVariables(beforeEnemy),
  enemyGenerationFingerprintFromVariables(currentVariables),
);
await events.emit('mag_variable_update_ended', currentVariables, beforeEnemy);
const lineage = context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lineage;
assert.equal(lineage.families[0].key, 'corrosion_slime');
assert.ok(lineage.families[0].memberNames.includes('蚀光软泥领主'));
const recentCount = lineage.recentEnemies.length;
await controller.warmup();
assert.equal(
  context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lineage.recentEnemies.length,
  recentCount,
  'repeated warmup must not duplicate the same encounter lineage',
);
assert.equal(notifications.length, 0);

// Switching chats while a background snapshot is still running must discard
// the old result and schedule one fresh warmup for the new chat.
const slowBaseEngine = new DesignAssistantEngine();
let slowCalls = 0;
let releaseFirstSnapshot;
const slowEngine = {
  initializeKnowledgeGraph: (...args) => slowBaseEngine.initializeKnowledgeGraph(...args),
  queryKnowledgeGraph: (...args) => slowBaseEngine.queryKnowledgeGraph(...args),
  knowledgeGraphStats: (...args) => slowBaseEngine.knowledgeGraphStats(...args),
  calibrateGeneratedEnemy: (...args) => slowBaseEngine.calibrateGeneratedEnemy(...args),
  createSnapshot: (...args) => {
    slowCalls += 1;
    if (slowCalls !== 1) return slowBaseEngine.createSnapshot(...args);
    return new Promise(resolveSnapshot => {
      releaseFirstSnapshot = () => resolveSnapshot(slowBaseEngine.createSnapshot(...args));
    });
  },
};
const slowEvents = new FakeEvents();
const slowContext = {
  ...context,
  chatId: 'chat-a',
  chatMetadata: {},
  eventSource: slowEvents,
};
const slowController = new DesignAssistantController({
  context: () => slowContext,
  mvu: () => ({ getMvuData: () => variables(), isDuringExtraAnalysis: () => false }),
  now: () => 654321,
  notify() {},
}, slowEngine);
slowController.activate();
const staleWarmup = slowController.warmup();
slowContext.chatId = 'chat-b';
slowContext.chatMetadata = {};
await slowEvents.emit('chat_id_changed');
releaseFirstSnapshot();
await staleWarmup;
await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
assert.ok(slowCalls >= 2, 'a chat switch during simulation must queue a warmup for the new chat');
assert.ok(
  slowContext.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY]?.lastDeckFingerprint,
  'only the new chat should receive the queued warmup result',
);
slowController.deactivate();

const calibrationVariables = variables(false);
calibrationVariables.stat_data.battle.cards = [
  { id: 'strike', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
  { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
];
calibrationVariables.stat_data.battle.statuses = [];
calibrationVariables.stat_data.battle.enemy = enemy('overstated_enemy', 320, 28);
const originalMaxHp = calibrationVariables.stat_data.battle.enemy.max_hp;
const calibrated = engine.calibrateGeneratedEnemy(calibrationVariables, null, {
  ...settings,
  autoCalibration: true,
});
assert.equal(calibrated.changed, true);
assert.notEqual(calibrationVariables.stat_data.battle.enemy.max_hp, originalMaxHp);
assert.equal(calibrated.state.lastCalibration.requestedRatio, 80);
assert.equal(calibrated.state.lastCalibration.winnableAtCurrentResources, true);
assert.ok(calibrated.state.lastCalibration.changedPaths.length > 0);

class FailingWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
  }
  postMessage() {
    queueMicrotask(() => this.onerror?.({ message: 'fixture worker failure' }));
  }
  terminate() {}
}
globalThis.location = { origin: 'http://fixture.invalid' };
globalThis.Worker = FailingWorker;
const failingWorkerClient = new DesignWorkerClient(new DesignAssistantEngine());
assert.equal(failingWorkerClient.threaded, true);
const fallbackSnapshot = await failingWorkerClient.createSnapshot(variables(), null, settings);
assert.ok(fallbackSnapshot, 'worker failure must transparently fall back to the local cached engine');
assert.equal(failingWorkerClient.threaded, false);
failingWorkerClient.dispose();
delete globalThis.Worker;
delete globalThis.location;

console.log('SillyTavern design assistant injects only into MVU, queries the graph, persists lineage, and calibrates enemies.');
