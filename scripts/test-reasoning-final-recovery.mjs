import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  createOfficialReasoningRecoveryRuntime,
  ReasoningFinalRecoveryHost,
  extractDisplayableOpeningFromReasoning,
  extractDisplayableStoryFinalFromReasoning,
} = require(resolve('src/sillytavern-extension/reasoningFinalRecovery.ts'));
const { createEventBridgedTavernHelper } = require(resolve('src/sillytavern-extension/tavernHelperBridge.ts'));
const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const {
  DESIGN_ASSISTANT_CARD_SCOPE,
  DESIGN_ASSISTANT_EXTENSION_ID,
} = require(resolve('src/sillytavern-extension/types.ts'));

const time = '<Time>血月历第七纪-雾月17日–03:20-废弃车站-浓雾</Time>';
const marker = '<CHARACTER_INIT_PENDING>';
const storyResponsePrefix = '好的，我将进行符合需求的创作：';
const storyParagraphs = [
  '灰羽睁开眼，先看见倒悬在穹顶下的钢筋。废弃车站深处传来缓慢的齿轮声，他扶着潮湿的墙面站稳。',
  '黑羽笔记摊在水洼旁，最新一页多出陌生的暗红字迹。他拾起笔记，确认自己的记录能力仍然存在。',
  '月台尽头亮起微弱灯光，照出通往高塔深处的旧轨道。他收好羽毛笔，沿着轨道向前走。',
  '柱面上的刻痕在他经过时重新排列，像是在提醒来客这里记得每次失败。灰羽没有停步。',
];

const boundedReasoning = [
  '此前是普通模型推理，不得展示。',
  time,
  '好的，我将进行符合需求的创作：',
  ...storyParagraphs,
  '我需要继续分析用户要求、输出格式和标记；这整段普通推理绝不能进入正文。'.repeat(80),
  marker,
  '标记后的隐私推理也不得展示。',
].join('\n\n');

const recovered = extractDisplayableOpeningFromReasoning(boundedReasoning);
assert.ok(recovered, 'a fully bounded displayable opening should be recoverable');
assert.ok(recovered.startsWith(time));
assert.ok(recovered.endsWith(marker));
assert.ok(recovered.length <= 1200, `recovered opening must stay compact, got ${recovered.length}`);
assert.doesNotMatch(recovered, /好的，我将|用户要求|输出格式|普通推理|隐私推理/);
for (const paragraph of storyParagraphs) assert.match(recovered, new RegExp(paragraph.slice(0, 12)));

assert.equal(
  extractDisplayableOpeningFromReasoning(`${time}\n\n普通剧情，没有初始化协议。`),
  null,
  'a time tag without the initialization marker is ordinary reasoning and must stay private',
);
assert.equal(
  extractDisplayableOpeningFromReasoning(`${storyParagraphs.join('\n\n')}\n\n${marker}`),
  null,
  'an initialization marker without a complete Time block must not recover',
);
assert.equal(
  extractDisplayableOpeningFromReasoning(`${time}\n\n好的，我将按用户要求输出正文。\n\n${marker}`),
  null,
  'meta reasoning alone is not displayable narrative',
);
assert.equal(
  extractDisplayableOpeningFromReasoning(`${time}\n\n${storyParagraphs[0]}\n\n${marker}`),
  null,
  'one isolated paragraph is not the complete 2–4 paragraph opening protocol',
);
assert.equal(
  extractDisplayableOpeningFromReasoning(`${time}\n\n${storyParagraphs.join('\n\n')}\n\n〈CHARACTER_INIT_PENDING〉`),
  null,
  'only the authoritative ASCII initialization marker may authorize recovery',
);

const storyTime = '『2027年2月21日-星期天–12,43-二号综合训练区-场地边沿-云层渐薄，风凉』';
const fencedStoryFinal = [
  '这部分是模型的私有规划，绝不能显示。',
  '```',
  storyResponsePrefix,
  storyTime,
  storyParagraphs[0],
  storyParagraphs[1],
].join('\n\n');
const recoveredStoryFinal = extractDisplayableStoryFinalFromReasoning(fencedStoryFinal);
assert.ok(recoveredStoryFinal, 'a final fenced story with the preset protocol should be recoverable');
assert.ok(recoveredStoryFinal.startsWith(storyResponsePrefix));
assert.ok(recoveredStoryFinal.includes(storyTime));
assert.doesNotMatch(recoveredStoryFinal, /私有规划/);
assert.equal(
  extractDisplayableStoryFinalFromReasoning(`${storyResponsePrefix}\n\n${storyTime}\n\n${storyParagraphs.join('\n\n')}`),
  null,
  'ordinary unfenced reasoning must never be exposed',
);
assert.equal(
  extractDisplayableStoryFinalFromReasoning(`\`\`\`\n${storyResponsePrefix}\n\n${storyParagraphs.join('\n\n')}`),
  null,
  'the fenced answer still requires a leading time header',
);
assert.equal(
  extractDisplayableStoryFinalFromReasoning(`\`\`\`\n${storyResponsePrefix}\n\n${storyTime}\n\n<UpdateVariable>_.set('status.time', 'x');</UpdateVariable>`),
  null,
  'variable commands are not a displayable story fallback',
);

function makeRuntime(message) {
  const state = { message: structuredClone(message) };
  const writes = [];
  const events = [];
  return {
    state,
    writes,
    events,
    getLastMessageId: () => state.message.message_id,
    getChatMessages: () => [structuredClone(state.message)],
    async setChatMessages(updates, options) {
      writes.push({ updates: structuredClone(updates), options: structuredClone(options) });
      state.message.message = updates.at(-1).message;
    },
    async eventEmit(name, ...args) { events.push([name, ...args]); },
  };
}

const runtime = makeRuntime({
  message_id: 7,
  role: 'assistant',
  message: '',
  extra: { reasoning: boundedReasoning },
});
const host = new ReasoningFinalRecoveryHost();
let currentChatId = 'chat-a';
const scope = {
  chatId: 'chat-a',
  messageReceivedEvent: 'message_received',
  isCurrent: () => currentChatId === 'chat-a',
};
const result = await host.auditLatest(runtime, scope);
assert.equal(result.status, 'recovered');
assert.equal(runtime.writes.length, 1);
assert.equal(runtime.writes[0].options.refresh, 'affected');
assert.deepEqual(runtime.events, [['message_received', 7, 'extension']]);
assert.equal(runtime.state.message.message, recovered);
const duplicate = await host.auditLatest(runtime, scope);
assert.equal(duplicate.status, 'skipped');
assert.equal(duplicate.reason, 'already-recovered');
assert.equal(runtime.writes.length, 1, 'chatId/messageId recovery must be idempotent');
const replayed = await host.replayLatestAfterRuntimeReady(runtime, scope);
assert.equal(replayed.status, 'replayed');
assert.deepEqual(runtime.events, [
  ['message_received', 7, 'extension'],
  ['message_received', 7, 'extension'],
]);
assert.equal((await host.replayLatestAfterRuntimeReady(runtime, scope)).reason, 'already-replayed');

const reentrantRuntime = makeRuntime({
  message_id: 8,
  role: 'assistant',
  message: '',
  extra: { reasoning: boundedReasoning },
});
const reentrantHost = new ReasoningFinalRecoveryHost();
let nestedReplay;
reentrantRuntime.eventEmit = async (name, messageId) => {
  reentrantRuntime.events.push([name, messageId]);
  if (reentrantRuntime.events.length === 1) {
    nestedReplay = await reentrantHost.replayLatestAfterRuntimeReady(reentrantRuntime, {
      chatId: 'chat-reentrant',
      messageReceivedEvent: 'message_received',
      isCurrent: () => true,
    });
  }
};
assert.equal((await reentrantHost.auditLatest(reentrantRuntime, {
  chatId: 'chat-reentrant',
  messageReceivedEvent: 'message_received',
  isCurrent: () => true,
})).status, 'recovered');
assert.equal(nestedReplay?.status, 'replayed', 'MVU readiness emitted inside message_received must see the pending recovered floor');
assert.deepEqual(reentrantRuntime.events, [
  ['message_received', 8],
  ['message_received', 8],
]);

const restartRuntime = makeRuntime({
  message_id: 9,
  role: 'assistant',
  message: recovered,
  extra: { reasoning: boundedReasoning },
});
const restartedHost = new ReasoningFinalRecoveryHost();
const restartAudit = await restartedHost.auditLatest(restartRuntime, {
  chatId: 'chat-restart',
  messageReceivedEvent: 'message_received',
  isCurrent: () => true,
});
assert.equal(restartAudit.reason, 'already-recovered', 'a restarted extension must reconstruct pending recovery from the strict protocol');
assert.equal((await restartedHost.replayLatestAfterRuntimeReady(restartRuntime, {
  chatId: 'chat-restart',
  messageReceivedEvent: 'message_received',
  isCurrent: () => true,
})).status, 'replayed');
assert.deepEqual(restartRuntime.events, [['message_received', 9, 'extension']]);

const storyRuntime = makeRuntime({
  message_id: 10,
  role: 'assistant',
  message: '',
  extra: { reasoning: fencedStoryFinal },
});
const storyHost = new ReasoningFinalRecoveryHost();
assert.equal((await storyHost.auditLatest(storyRuntime, {
  chatId: 'chat-story',
  messageReceivedEvent: 'message_received',
  isCurrent: () => true,
})).status, 'recovered');
assert.equal(storyRuntime.state.message.message, recoveredStoryFinal);
assert.deepEqual(storyRuntime.events, [['message_received', 10, 'extension']]);

const restartedStoryRuntime = makeRuntime({
  message_id: 11,
  role: 'assistant',
  message: recoveredStoryFinal,
  extra: { reasoning: fencedStoryFinal },
});
const restartedStoryHost = new ReasoningFinalRecoveryHost();
assert.equal((await restartedStoryHost.auditLatest(restartedStoryRuntime, {
  chatId: 'chat-story-restart',
  messageReceivedEvent: 'message_received',
  isCurrent: () => true,
})).reason, 'already-recovered');
assert.equal((await restartedStoryHost.replayLatestAfterRuntimeReady(restartedStoryRuntime, {
  chatId: 'chat-story-restart',
  messageReceivedEvent: 'message_received',
  isCurrent: () => true,
})).status, 'replayed');
assert.deepEqual(restartedStoryRuntime.events, [['message_received', 11, 'extension']]);

const officialEvents = [];
const officialMessages = [{
  is_user: false,
  is_system: false,
  mes: '',
  swipe_id: 0,
  swipes: [''],
  extra: { reasoning: boundedReasoning },
}];
let officialSaveCount = 0;
let officialRenderCount = 0;
const officialRuntime = createOfficialReasoningRecoveryRuntime({
  chat: officialMessages,
  async saveChat() { officialSaveCount += 1; },
  updateMessageBlock(messageId, message) {
    officialRenderCount += 1;
    assert.equal(messageId, 0);
    assert.equal(message, officialMessages[0]);
  },
  eventSource: {
    async emit(event, ...args) { officialEvents.push([event, ...args]); },
  },
});
assert.ok(officialRuntime, 'official SillyTavern chat context should provide a recovery runtime');
const officialResult = await new ReasoningFinalRecoveryHost().auditLatest(officialRuntime, {
  chatId: 'official-chat',
  messageReceivedEvent: 'message_received',
  isCurrent: () => true,
});
assert.equal(officialResult.status, 'recovered');
assert.equal(officialMessages[0].mes, recovered);
assert.equal(officialMessages[0].swipes[0], recovered);
assert.equal(officialSaveCount, 1);
assert.equal(officialRenderCount, 1);
assert.deepEqual(officialEvents, [['message_received', 0, 'extension']]);

const bridgedEvents = [];
const publicHelper = {
  marker: 'helper-this',
  getLastMessageId() {
    assert.equal(this.marker, 'helper-this', 'public helper methods must keep their original receiver');
    return 5;
  },
};
const bridgedHelper = createEventBridgedTavernHelper(publicHelper, {
  eventSource: {
    async emit(event, ...args) { bridgedEvents.push([event, ...args]); },
  },
});
assert.ok(bridgedHelper);
assert.equal(bridgedHelper.getLastMessageId(), 5);
await bridgedHelper.eventEmit('message_received', 5, 'extension');
assert.deepEqual(bridgedEvents, [['message_received', 5, 'extension']]);
assert.equal('eventEmit' in publicHelper, false, 'the bridge must not mutate Tavern Helper itself');

const nonEmpty = makeRuntime({
  message_id: 1,
  role: 'assistant',
  message: '模型已经返回正文。',
  extra: { reasoning: boundedReasoning },
});
assert.equal((await new ReasoningFinalRecoveryHost().auditLatest(nonEmpty, {
  chatId: 'chat-nonempty',
  isCurrent: () => true,
})).reason, 'final-answer-not-empty');
assert.equal(nonEmpty.writes.length, 0);

for (const role of ['user', 'system']) {
  const wrongRole = makeRuntime({ message_id: 2, role, message: '', extra: { reasoning: boundedReasoning } });
  const wrongRoleResult = await new ReasoningFinalRecoveryHost().auditLatest(wrongRole, {
    chatId: `chat-${role}`,
    isCurrent: () => true,
  });
  assert.equal(wrongRoleResult.reason, 'not-latest-assistant');
  assert.equal(wrongRole.writes.length, 0);
}
const ambiguousRole = makeRuntime({ message_id: 2, message: '', extra: { reasoning: boundedReasoning } });
assert.equal((await new ReasoningFinalRecoveryHost().auditLatest(ambiguousRole, {
  chatId: 'chat-ambiguous-role',
  isCurrent: () => true,
})).reason, 'not-latest-assistant');
assert.equal(ambiguousRole.writes.length, 0, 'missing role metadata must not be guessed from private reasoning');

const stale = makeRuntime({ message_id: 3, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } });
currentChatId = 'chat-b';
assert.equal((await new ReasoningFinalRecoveryHost().auditLatest(stale, scope)).reason, 'stale-chat-scope');
assert.equal(stale.writes.length, 0, 'a stale chat must never mutate the newly active chat');

class FakeEvents {
  listeners = new Map();
  on(event, listener) {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }
  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) || []).filter(candidate => candidate !== listener));
  }
  async emit(event, ...args) {
    for (const listener of this.listeners.get(event) || []) await listener(...args);
  }
}

const scopedCharacter = {
  data: {
    extensions: {
      magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE },
    },
  },
};
const controllerEvents = new FakeEvents();
const controllerContext = {
  chatId: 'saved-chat',
  characterId: 0,
  groupId: null,
  characters: [scopedCharacter],
  extensionSettings: {
    [DESIGN_ASSISTANT_EXTENSION_ID]: {
      enabled: false,
      difficultyPercent: 80,
      autoCalibration: false,
      simulationSeeds: 4,
      showNotifications: false,
      debug: false,
    },
  },
  saveSettingsDebounced() {},
  chatMetadata: {},
  saveMetadataDebounced() {},
  eventSource: controllerEvents,
  eventTypes: {
    GENERATE_AFTER_DATA: 'generate_after_data',
    CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_ENDED: 'generation_ended',
    MESSAGE_RECEIVED: 'message_received',
  },
};

const savedMessages = new Map([
  ['saved-chat', { message_id: 11, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } }],
  ['next-chat', { message_id: 11, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } }],
  ['event-chat', { message_id: 12, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } }],
]);
const controllerWrites = [];
const controllerEmits = [];
controllerEvents.on('message_received', async (messageId, source) => {
  controllerEmits.push([controllerContext.chatId, 'message_received', messageId, source]);
});
globalThis.TavernHelper = {
  getLastMessageId: () => savedMessages.get(controllerContext.chatId).message_id,
  getChatMessages: () => [structuredClone(savedMessages.get(controllerContext.chatId))],
  async setChatMessages(updates) {
    const current = savedMessages.get(controllerContext.chatId);
    current.message = updates.at(-1).message;
    controllerWrites.push([controllerContext.chatId, current.message_id]);
  },
};

const inertEngine = {
  async initializeKnowledgeGraph() {},
  createSnapshot() { return null; },
  calibrateGeneratedEnemy(variables) {
    return { changed: false, variables, snapshot: null, state: null };
  },
  queryKnowledgeGraph() { return { nodes: [], edges: [] }; },
  knowledgeGraphStats() { return { nodes: 0, edges: 0, version: 'test', storage: 'memory' }; },
};
const controller = new DesignAssistantController({
  context: () => controllerContext,
  mvu: () => null,
  now: () => 1,
  notify() {},
}, inertEngine, undefined, { towerCoordinator: false });
controller.activate();
await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
assert.deepEqual(controllerWrites, [['saved-chat', 11]], 'extension activation must audit an already persisted blank floor');
assert.deepEqual(controllerEmits, [['saved-chat', 'message_received', 11, 'extension']]);
await controllerEvents.emit('global_Mvu_initialized');
await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
assert.deepEqual(
  controllerEmits,
  [
    ['saved-chat', 'message_received', 11, 'extension'],
    ['saved-chat', 'message_received', 11, 'extension'],
  ],
  'MVU ready must replay a recovered floor once when the original recovery happened before MVU listeners mounted',
);

controllerContext.chatId = 'next-chat';
await controllerEvents.emit('chat_id_changed');
await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
assert.deepEqual(controllerWrites.at(-1), ['next-chat', 11], 'chat switching must audit the new chat independently');

controllerContext.chatId = 'event-chat';
await controllerEvents.emit('chat_id_changed');
await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
savedMessages.get('event-chat').message = '';
// A second empty assistant floor uses a new id, so generation_ended owns a new dedupe key.
savedMessages.get('event-chat').message_id = 13;
await controllerEvents.emit('generation_ended', 14);
await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
assert.deepEqual(controllerWrites.at(-1), ['event-chat', 13]);
assert.deepEqual(controllerEmits.at(-1), ['event-chat', 'message_received', 13, 'extension']);

const writesBeforeUnrelated = controllerWrites.length;
controllerContext.characters = [{ data: { extensions: {} } }];
savedMessages.get('event-chat').message = '';
savedMessages.get('event-chat').message_id = 14;
await controllerEvents.emit('generation_ended', 15);
await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
assert.equal(controllerWrites.length, writesBeforeUnrelated, 'other character cards must never use the recovery bridge');

controller.deactivate();
delete globalThis.TavernHelper;

function delayedControllerFixture(chatId, messages) {
  const events = new FakeEvents();
  const context = {
    ...controllerContext,
    chatId,
    characters: [scopedCharacter],
    chatMetadata: {},
    eventSource: events,
  };
  const writes = [];
  const runtime = {
    getLastMessageId: () => messages.get(context.chatId).message_id,
    getChatMessages: () => [structuredClone(messages.get(context.chatId))],
    async setChatMessages(updates) {
      const current = messages.get(context.chatId);
      current.message = updates.at(-1).message;
      writes.push([context.chatId, current.message_id]);
    },
    async eventEmit() {},
  };
  const delayedController = new DesignAssistantController({
    context: () => context,
    mvu: () => null,
    now: () => 1,
    notify() {},
  }, inertEngine, undefined, { towerCoordinator: false });
  return { context, events, writes, runtime, controller: delayedController };
}

const delayedMessages = new Map([
  ['delayed-chat', { message_id: 21, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } }],
]);
const delayedFixture = delayedControllerFixture('delayed-chat', delayedMessages);
delayedFixture.controller.activate();
await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
globalThis.TavernHelper = delayedFixture.runtime;
await new Promise(resolveDelay => setTimeout(resolveDelay, 140));
assert.deepEqual(
  delayedFixture.writes,
  [['delayed-chat', 21]],
  'extension activation must wait briefly when TavernHelper is mounted after the card-scoped extension',
);
delayedFixture.controller.deactivate();
delete globalThis.TavernHelper;

const lateScopedMessages = new Map([
  ['late-scoped-chat', { message_id: 26, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } }],
]);
const lateScopedFixture = delayedControllerFixture('late-scoped-chat', lateScopedMessages);
lateScopedFixture.context.characters = [{ data: { extensions: {} } }];
globalThis.TavernHelper = lateScopedFixture.runtime;
lateScopedFixture.controller.activate();
await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
assert.equal(lateScopedFixture.writes.length, 0, 'an unscoped character context must not recover private reasoning');
lateScopedFixture.context.characters = [scopedCharacter];
await lateScopedFixture.events.emit('global_MagicGirlWorld_initialized');
await new Promise(resolveDelay => setTimeout(resolveDelay, 0));
assert.deepEqual(
  lateScopedFixture.writes,
  [['late-scoped-chat', 26]],
  'the card runtime ready event must retry recovery after CHAT_CHANGED raced ahead of character scope',
);
lateScopedFixture.controller.deactivate();
delete globalThis.TavernHelper;

const switchedMessages = new Map([
  ['stale-delayed-chat', { message_id: 31, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } }],
  ['fresh-delayed-chat', { message_id: 32, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } }],
]);
const switchedFixture = delayedControllerFixture('stale-delayed-chat', switchedMessages);
switchedFixture.controller.activate();
await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
switchedFixture.context.chatId = 'fresh-delayed-chat';
await switchedFixture.events.emit('chat_id_changed');
globalThis.TavernHelper = switchedFixture.runtime;
await new Promise(resolveDelay => setTimeout(resolveDelay, 140));
assert.deepEqual(
  switchedFixture.writes,
  [['fresh-delayed-chat', 32]],
  'a delayed runtime must never let the activation audit write into the chat that was left behind',
);
switchedFixture.controller.deactivate();
delete globalThis.TavernHelper;

const stoppedMessages = new Map([
  ['stopped-delayed-chat', { message_id: 41, role: 'assistant', message: '', extra: { reasoning: boundedReasoning } }],
]);
const stoppedFixture = delayedControllerFixture('stopped-delayed-chat', stoppedMessages);
stoppedFixture.controller.activate();
await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
stoppedFixture.controller.deactivate();
globalThis.TavernHelper = stoppedFixture.runtime;
await new Promise(resolveDelay => setTimeout(resolveDelay, 140));
assert.equal(
  stoppedFixture.writes.length,
  0,
  'deactivation must cancel a pending runtime audit before TavernHelper appears',
);
delete globalThis.TavernHelper;

console.log('Bounded reasoning final recovery is card-scoped, compact, idempotent, restart-safe, and never exposes ordinary reasoning.');
