import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { DesignAssistantEngine, enemyGenerationFingerprintFromVariables, normalizeDesignAssistantChatState } = require(
  resolve('src/sillytavern-extension/designEngine.ts'),
);
const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const { DesignWorkerClient } = require(resolve('src/sillytavern-extension/workerClient.ts'));
const { DesignKnowledgeGraph } = require(resolve('src/sillytavern-extension/knowledgeGraph.ts'));
const { isMagicGirlWorldCharacter } = require(resolve('src/sillytavern-extension/characterScope.ts'));
const { injectDesignContext, hasDesignContext } = require(resolve('src/sillytavern-extension/promptInjection.ts'));
const { looksLikeMvuExtraAnalysisRequest } = require(resolve('src/sillytavern-extension/mvuRequestDetection.ts'));
const { subscribeTavernHelperRequestEvent } = require(resolve('src/sillytavern-extension/tavernHelperEventSubscription.ts'));
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

const legacyAppliedState = normalizeDesignAssistantChatState({
  spec: 'mwg.st-design-assistant/v1',
  lastCalibration: {
    enemyFingerprint: 'legacy:applied',
    requestedRatio: 80,
    effectiveRatio: 78,
    appliedScale: 0.95,
    winnableAtCurrentResources: true,
    changedPaths: ['battle.enemy.max_hp'],
    warnings: [],
    calibratedAt: 1,
  },
});
assert.equal(legacyAppliedState.lastCalibration.mode, 'applied');

const legacyVerifiedState = normalizeDesignAssistantChatState({
  spec: 'mwg.st-design-assistant/v1',
  lastCalibration: {
    enemyFingerprint: 'legacy:verified',
    requestedRatio: 80,
    effectiveRatio: 80,
    appliedScale: 1,
    winnableAtCurrentResources: true,
    changedPaths: [],
    warnings: [],
    calibratedAt: 2,
  },
});
assert.equal(legacyVerifiedState.lastCalibration.mode, 'verified');

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
assert.equal(graph.stats().storage, 'memory');

let persistedGraph = null;
let graphSaveCalls = 0;
const firstPersistence = {
  storage: 'indexeddb',
  async load() { return null; },
  async save(snapshot) {
    graphSaveCalls += 1;
    persistedGraph = structuredClone(snapshot);
  },
};
const firstPersistedGraph = new DesignKnowledgeGraph(firstPersistence);
await firstPersistedGraph.initialize();
assert.equal(graphSaveCalls, 1, 'a missing IndexedDB snapshot must be populated from the bundled graph');
assert.equal(firstPersistedGraph.stats().storage, 'indexeddb');

const cachedPersistence = {
  storage: 'indexeddb',
  async load() { return structuredClone(persistedGraph); },
  async save() { throw new Error('a current graph snapshot must not be rewritten'); },
};
const cachedGraph = new DesignKnowledgeGraph(cachedPersistence);
await cachedGraph.initialize();
assert.equal(cachedGraph.stats().storage, 'indexeddb');
assert.deepEqual(cachedGraph.stats().nodes, firstPersistedGraph.stats().nodes);

let staleGraphReplaced = false;
const stalePersistence = {
  storage: 'indexeddb',
  async load() { return { ...structuredClone(persistedGraph), contentVersion: 'stale' }; },
  async save(snapshot) {
    staleGraphReplaced = snapshot.contentVersion === persistedGraph.contentVersion;
  },
};
const migratedGraph = new DesignKnowledgeGraph(stalePersistence);
await migratedGraph.initialize();
assert.equal(staleGraphReplaced, true, 'a stale graph snapshot must be replaced instead of queried');

const blockedGraph = new DesignKnowledgeGraph({
  storage: 'indexeddb',
  async load() { throw new Error('blocked'); },
  async save() {},
});
await blockedGraph.initialize();
assert.equal(blockedGraph.stats().storage, 'unavailable');
assert.ok(blockedGraph.query().nodes.length > 0, 'blocked IndexedDB must fall back to the bundled graph');

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

const realMvuFingerprintPayload = {
  prompt: [
    { role: 'system', content: '<must>\n紧急变量更新任务:\n必须立即停止角色扮演\n除了<UpdateVariable>块外不输出任何内容\n</must>' },
    { role: 'user', content: '遵循<must>指令' },
  ],
};
assert.equal(looksLikeMvuExtraAnalysisRequest(realMvuFingerprintPayload), true);
assert.equal(
  looksLikeMvuExtraAnalysisRequest({ prompt: [{ role: 'system', content: '卡牌变量可使用 <UpdateVariable> 更新' }] }),
  false,
  'ordinary worldbook documentation must not be mistaken for an MVU second-stage request',
);

const helperEventListeners = new Map();
const helperEventOwners = [];
const helperSubscription = subscribeTavernHelperRequestEvent({
  _bind: {
    _eventOn(eventName, listener) {
      helperEventOwners.push(this);
      helperEventListeners.set(eventName, listener);
    },
    _eventRemoveListener(eventName, listener) {
      helperEventOwners.push(this);
      if (helperEventListeners.get(eventName) === listener) helperEventListeners.delete(eventName);
    },
  },
}, 'generate_after_data', () => {});
assert.equal(typeof helperSubscription, 'function');
assert.equal(helperEventListeners.has('generate_after_data'), true);
helperSubscription();
assert.equal(helperEventListeners.has('generate_after_data'), false);
assert.equal(helperEventOwners[0], helperEventOwners[1], 'subscribe and cleanup must use the same synthetic owner');

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

// A lifecycle hook may run before SillyTavern has published its official
// context. That failed attempt must remain retryable instead of permanently
// latching the controller in an inactive-but-marked-active state.
let retryableContext = null;
const retryableEvents = new FakeEvents();
const retryableController = new DesignAssistantController({
  context: () => retryableContext,
  mvu: () => ({ getMvuData: () => variables(), isDuringExtraAnalysis: () => false }),
  now: () => 123,
  notify() {},
});
retryableController.activate();
assert.equal(retryableController.getStatus().phase, 'error');
retryableContext = { ...context, chatMetadata: {}, eventSource: retryableEvents };
retryableController.activate();
await retryableController.warmup();
assert.equal(retryableController.getStatus().phase, 'ready');
retryableController.deactivate();

let duringExtra = false;
let currentVariables = variables();
let hostNow = 123456;
const notifications = [];
const lifecyclePromptCalls = [];
let lifecyclePromptCleanupCount = 0;
globalThis.TavernHelper = {
  injectPrompts(prompts, options) {
    lifecyclePromptCalls.push({ prompts: structuredClone(prompts), options: structuredClone(options) });
    let active = true;
    return {
      uninject() {
        if (!active) return;
        active = false;
        lifecyclePromptCleanupCount += 1;
      },
    };
  },
};
const controller = new DesignAssistantController({
  context: () => context,
  mvu: () => ({
    getMvuData: () => currentVariables,
    isDuringExtraAnalysis: () => duringExtra,
  }),
  now: () => hostNow,
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
assert.equal(extraPayload.include_reasoning, false, 'MVU extra-model request must disable provider reasoning');
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionAt, 123456);
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionSource, 'official');
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionMessageId, 'latest');
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionCount, 1);
assert.equal(controller.getStatus().phase, 'ready');
const markerCountAfterPrimaryEvent = JSON.stringify(extraPayload).split(DESIGN_ASSISTANT_PROMPT_MARKER).length - 1;
await events.emit('chat_completion_settings_ready', extraPayload);
assert.equal(
  JSON.stringify(extraPayload).split(DESIGN_ASSISTANT_PROMPT_MARKER).length - 1,
  markerCountAfterPrimaryEvent,
  'compatibility event must keep the same request idempotent',
);
assert.equal(controller.getStatus().phase, 'ready', 'duplicate compatibility event must not report a false error');
assert.equal(
  context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionCount,
  1,
  'the same request exposed through two events must be recorded only once',
);

const clonedCompatibilityPayload = { prompt: [{ role: 'system', content: 'mvu' }, { role: 'user', content: 'update' }] };
await events.emit('chat_completion_settings_ready', clonedCompatibilityPayload);
assert.equal(hasDesignContext(clonedCompatibilityPayload), true);
assert.equal(
  context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionCount,
  1,
  'cloned compatibility payloads emitted in the same request window count as one logical injection',
);

duringExtra = false;
hostNow += 3000;
const fingerprintOnlyPayload = structuredClone(realMvuFingerprintPayload);
await events.emit('generate_after_data', fingerprintOnlyPayload);
assert.equal(
  hasDesignContext(fingerprintOnlyPayload),
  true,
  'the strict MVU request fingerprint must recover injection when the lifecycle flag is stale',
);
assert.equal(fingerprintOnlyPayload.include_reasoning, false);
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionCount, 2);

hostNow += 3000;
context.chatId = 'design-assistant-fixture';
context.chat = [{ is_user: true, is_system: false, mes: 'user action' }];
await events.emit('mag_variable_update_started', currentVariables);
assert.equal(
  lifecyclePromptCalls.length,
  0,
  'the user-floor MVU parse pass must not inject into the ordinary story request',
);
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionCount, 2);
context.chat.push({ is_user: false, is_system: false, mes: 'completed story' });
await events.emit('mag_variable_update_started', currentVariables);
assert.equal(lifecyclePromptCalls.length, 1, 'automatic MVU lifecycle must inject before generateRaw builds its prompt');
assert.deepEqual(lifecyclePromptCalls[0].options, { once: true });
assert.equal(lifecyclePromptCalls[0].prompts[0].id, 'mwg-design-context');
assert.equal(lifecyclePromptCalls[0].prompts[0].position, 'in_chat');
assert.equal(lifecyclePromptCalls[0].prompts[0].depth, 0);
assert.match(lifecyclePromptCalls[0].prompts[0].content, /^\[MWG_DESIGN_CONTEXT\/v1\]/);
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionSource, 'mvu-lifecycle');
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionMessageId, 1);
assert.equal(context.chatMetadata[DESIGN_ASSISTANT_METADATA_KEY].lastInjectionCount, 3);
await events.emit('mag_variable_update_ended', currentVariables, structuredClone(currentVariables));
assert.equal(lifecyclePromptCleanupCount, 1, 'MVU completion must remove any still-active lifecycle prompt');

context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID].enabled = false;
// The optional design switch does not disable the card-scoped request policy.
duringExtra = true;
const policyOnlyPayload = {
  include_reasoning: true,
  reasoning_effort: 'high',
  max_tokens: 65535,
  prompt: [{ role: 'user', content: 'mvu policy only' }],
};
await events.emit('generate_after_data', policyOnlyPayload);
assert.equal(policyOnlyPayload.include_reasoning, false, 'card-scoped MVU policy must survive optional assistant disable');
assert.equal('reasoning_effort' in policyOnlyPayload, false);
assert.equal(policyOnlyPayload.max_tokens, 20000);
assert.equal(hasDesignContext(policyOnlyPayload), false, 'disabled assistant must not inject design context');
context.extensionSettings[DESIGN_ASSISTANT_EXTENSION_ID].enabled = true;

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
calibrationVariables.stat_data.battle.artifacts = [];
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

const advisoryVariables = variables(false);
advisoryVariables.stat_data.battle.cards = [
  { id: 'strike', name: '攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
  {
    id: 'persistent_guard',
    name: '持续守势',
    type: 'Power',
    rarity: 'Uncommon',
    cost: 1,
    quantity: 2,
    trigger: { on: 'turn_start', effects: { block: 3 } },
  },
];
advisoryVariables.stat_data.battle.statuses = [];
advisoryVariables.stat_data.battle.artifacts = [];
advisoryVariables.stat_data.battle.enemy = enemy('complex_overstated_enemy', 320, 28);
const advisoryCalibration = engine.calibrateGeneratedEnemy(advisoryVariables, null, {
  ...settings,
  autoCalibration: true,
});
assert.equal(advisoryCalibration.changed, false, 'unsupported authored mechanics must not be auto-calibrated');
assert.equal(advisoryCalibration.state.lastCalibration.mode, 'advisory');
assert.match(advisoryCalibration.state.lastCalibration.warnings.join('\n'), /trigger/);

controller.deactivate();

// A selected assistant floor may still contain a durable settlement request
// after SillyTavern or the card iframe restarts. Lifecycle recovery must read
// the authoritative floor variables, start the structured repair exactly once,
// and ignore a stale mag_variable_update_ended payload.
{
  const settlementEvents = new FakeEvents();
  let settlementVariables = variables(false);
  settlementVariables.stat_data.status = {
    time: '134年07月17日 12:00',
    location: '镜像训练场',
    permanent_status: [],
  };
  settlementVariables.stat_data.battle.core.hp = 0;
  settlementVariables.stat_data.battle.core.max_hp = 90;
  settlementVariables.stat_data.battle.core.card_removal_count = 6;
  settlementVariables.stat_data.battle.level = 6;
  settlementVariables.stat_data.battle.exp = 225;
  settlementVariables.stat_data.reward = {
    card: [{ id: 'stale-card' }],
    artifact: [{ id: 'stale-artifact' }],
    item: [{ id: 'stale-item' }],
    limits: { cards: 1 },
    request: {
      marker: '[MVU_BATTLE_SETTLEMENT]',
      result: 'defeat',
      penalty: true,
      enemy: { names: ['星蚀前锋'] },
    },
  };
  let settlementMessage = '战败后的剧情正文。';
  const settlementContext = {
    characterId: 0,
    groupId: null,
    characters: [scopedCharacter],
    chatId: null,
    chat: [
      { is_user: true, mes: '开始' },
      { is_user: false, mes: settlementMessage, swipe_id: 0, variables: [structuredClone(settlementVariables)] },
    ],
    extensionSettings: { [DESIGN_ASSISTANT_EXTENSION_ID]: { ...settings, enabled: false } },
    saveSettingsDebounced() {},
    chatMetadata: {},
    saveMetadataDebounced() {},
    eventSource: settlementEvents,
    eventTypes: {
      GENERATE_AFTER_DATA: 'generate_after_data',
      CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
      CHAT_CHANGED: 'chat_id_changed',
      CHAT_LOADED: 'chatLoaded',
      GENERATION_ENDED: 'generation_ended',
    },
  };
  const structuredMonitorEvents = [];
  const delayedStructuredMonitor = {
    beginStructuredOperation: input => structuredMonitorEvents.push(['begin', structuredClone(input)]),
    applyStructuredOperation: input => structuredMonitorEvents.push(['applying', structuredClone(input)]),
    completeStructuredOperation: input => structuredMonitorEvents.push(['complete', structuredClone(input)]),
    fail: error => structuredMonitorEvents.push(['error', String(error)]),
    setDesignAssistant() {},
  };
  globalThis.TavernHelper = {
    getLastMessageId: () => 1,
    getChatMessages: () => [{ message: settlementMessage }],
    setChatMessages: async updates => {
      settlementMessage = updates[0].message;
      settlementContext.chat[1].mes = settlementMessage;
    },
    getVariables: options => structuredClone(settlementVariables),
    replaceVariables: async value => { settlementVariables = structuredClone(value); },
    getAllEnabledScriptButtons: () => ({}),
    getScriptTrees: () => [],
  };
  let settlementGenerationCalls = 0;
  const settlementController = new DesignAssistantController({
    context: () => settlementContext,
    mvu: () => ({
      getMvuData: () => structuredClone(settlementVariables),
      isDuringExtraAnalysis: () => false,
    }),
    now: () => 789,
    notify() {},
  }, undefined, {
    currentChatId: () => settlementContext.chatId,
    createChatMessages: async () => {},
    generate: async () => {
      settlementGenerationCalls += 1;
      return {
        reward: { card: [], artifact: [], item: [], limits: {} },
        add_cards: [{
          id: 'reload_eclipse_scar',
          name: '重启蚀痕',
          description: '重启后仍会被星蚀之力反噬。',
          effects: { damage: 3, to: 'self' },
        }],
        add_artifacts: [],
        add_permanent_status: [],
      };
    },
    stopGenerationById: () => false,
    emitInternalEvent: async () => {},
  });
  settlementController.activate();
  setTimeout(() => { settlementContext.chatId = 'settlement-reload-chat'; }, 20);
  setTimeout(() => { globalThis.MagicGirlWorldMvuMonitor = delayedStructuredMonitor; }, 60);
  const staleEventSnapshot = variables(false);
  await settlementEvents.emit('mag_variable_update_ended', staleEventSnapshot, variables(false));
  const deadline = Date.now() + 3_000;
  while (
    (settlementVariables.stat_data.reward.request || !settlementMessage.includes('Repair battle settlement.'))
    && Date.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(settlementVariables.stat_data.reward.request, null);
  assert.equal(settlementGenerationCalls, 1);
  assert.equal(settlementVariables.stat_data.battle.core.hp, 0);
  assert.equal(settlementVariables.stat_data.battle.exp, 225);
  assert.equal(settlementVariables.stat_data.battle.core.card_removal_count, 6);
  assert.ok(settlementVariables.stat_data.battle.cards.some(card => card.id === 'reload_eclipse_scar'));
  assert.match(settlementMessage, /<Analysis>Repair battle settlement\.<\/Analysis>/);
  assert.ok(structuredMonitorEvents.some(([phase]) => phase === 'begin'));
  assert.ok(structuredMonitorEvents.some(([phase]) => phase === 'complete'));

  await settlementEvents.emit('chatLoaded');
  await settlementEvents.emit('global_Mvu_initialized');
  await settlementEvents.emit('global_MagicGirlWorld_initialized');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(settlementGenerationCalls, 1, 'the same completed floor must not be repaired twice');
  settlementController.deactivate();
  delete globalThis.MagicGirlWorldMvuMonitor;
}

// The battle summary is posted as a user floor before the narrative response
// exists. Its inherited MVU snapshot may already contain reward.request, but
// settlement repair must wait for a persisted assistant floor instead of
// racing the story generation and then mistaking the new message id for a
// chat switch.
{
  const userFloorEvents = new FakeEvents();
  const userFloorVariables = variables(false);
  userFloorVariables.stat_data.status = {
    time: '2027-02-21 12:00',
    location: '终结记录训练场',
    permanent_status: [],
  };
  userFloorVariables.stat_data.reward = {
    card: [],
    artifact: [],
    item: [],
    limits: {},
    request: {
      marker: '[MVU_BATTLE_SETTLEMENT]',
      result: 'defeat',
      penalty: true,
      enemy: { names: ['一息靶机'] },
    },
  };
  const userFloorContext = {
    characterId: 0,
    groupId: null,
    characters: [scopedCharacter],
    chatId: 'settlement-user-floor-chat',
    chat: [
      { is_user: true, mes: '开始' },
      { is_user: false, mes: '战斗结束。', swipe_id: 0, variables: [structuredClone(userFloorVariables)] },
      { is_user: true, mes: '请根据以下按回合战斗摘要续写。', swipe_id: 0, variables: [structuredClone(userFloorVariables)] },
    ],
    extensionSettings: { [DESIGN_ASSISTANT_EXTENSION_ID]: { ...settings, enabled: false } },
    saveSettingsDebounced() {},
    chatMetadata: {},
    saveMetadataDebounced() {},
    eventSource: userFloorEvents,
    eventTypes: {
      GENERATE_AFTER_DATA: 'generate_after_data',
      CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
      CHAT_CHANGED: 'chat_id_changed',
      CHAT_LOADED: 'chatLoaded',
      GENERATION_ENDED: 'generation_ended',
    },
  };
  globalThis.TavernHelper = {
    getLastMessageId: () => userFloorContext.chat.length - 1,
    getChatMessages: messageId => [{ message: userFloorContext.chat[Number(messageId)]?.mes || '' }],
    setChatMessages: async () => {},
    getVariables: () => structuredClone(userFloorVariables),
    replaceVariables: async () => {},
    getAllEnabledScriptButtons: () => ({}),
    getScriptTrees: () => [],
  };
  globalThis.MagicGirlWorldMvuMonitor = {
    beginStructuredOperation() {},
    applyStructuredOperation() {},
    completeStructuredOperation() {},
    fail() {},
    setDesignAssistant() {},
  };
  let userFloorSettlementCalls = 0;
  const userFloorController = new DesignAssistantController({
    context: () => userFloorContext,
    mvu: () => ({
      getMvuData: () => structuredClone(userFloorVariables),
      isDuringExtraAnalysis: () => false,
    }),
    now: () => 790,
    notify() {},
  }, undefined, {
    currentChatId: () => userFloorContext.chatId,
    createChatMessages: async () => {},
    generate: async () => {
      userFloorSettlementCalls += 1;
      return {
        reward: { card: [], artifact: [], item: [], limits: {} },
        add_cards: [{
          id: 'should_not_be_generated_on_user_floor',
          name: '抢跑惩罚',
          description: '这个候选只用于证明用户楼层不应触发结算。',
          effects: { damage: 1, to: 'self' },
        }],
        add_artifacts: [],
        add_permanent_status: [],
      };
    },
    stopGenerationById: () => false,
    emitInternalEvent: async () => {},
  });
  userFloorController.activate();
  await userFloorEvents.emit('mag_variable_update_ended', structuredClone(userFloorVariables), variables(false));
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(userFloorSettlementCalls, 0, 'a transient user battle-summary floor must not start settlement repair');
  userFloorController.deactivate();
  delete globalThis.MagicGirlWorldMvuMonitor;
}

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
delete globalThis.TavernHelper;

console.log('SillyTavern design assistant injects only into MVU, queries the graph, persists lineage, and calibrates enemies.');
