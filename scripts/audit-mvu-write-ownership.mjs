// Read-only compatibility audit. Only extracted functions run, in synthetic hosts.
// The pinned third-party bundle must be supplied explicitly; no live APIs/network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const _ = require('lodash');
const bundlePath = process.argv[2];
assert.ok(bundlePath, 'Pass the locally available pinned MVU bundle path.');
const source = readFileSync(bundlePath, 'utf8');
const sha256 = createHash('sha256').update(source).digest('hex');
assert.equal(sha256, '3b510787a95c7a51523dcbbb2beff5f13b3bd069abf973dec1fdb1f21eeea61f');
const parsed = ts.createSourceFile(bundlePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map();
let parseMessageSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['Ga', 'Un', 'Mn'].includes(node.name?.text)) {
    assert.equal(functions.has(node.name.text), false);
    functions.set(node.name.text, node.getText(parsed));
  }
  if (ts.isPropertyAssignment(node) && node.name.getText(parsed) === 'parseMessage') {
    assert.equal(parseMessageSource, undefined);
    parseMessageSource = node.initializer.getText(parsed);
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.equal(functions.size, 3);
assert.ok(parseMessageSource?.includes('Mn('), 'Bind the public wrapper to the extracted parser.');
const clone = value => JSON.parse(JSON.stringify(value));
const silentConsole = { log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {} };
const events = Object.fromEntries(['VARIABLE_UPDATE_STARTED', 'VARIABLE_UPDATE_ENDED',
  'SINGLE_VARIABLE_UPDATED', 'COMMAND_PARSED', 'BEFORE_MESSAGE_UPDATE'].map(key => [key, key]));
const update = '<UpdateVariable>_.set("value", "A-model-result");</UpdateVariable>';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function writerCase({ entry = 'Ga', switchTo, cancel = false }) {
  const chats = Object.fromEntries(['A', 'B'].map(chat => [chat, [0, 1].map(swipe => ({
    message: `${chat} swipe ${swipe} original prose`,
    role: 'assistant', name: 'character', swipe_id: swipe,
    variables: { stat_data: { value: `${chat}-${swipe}-current` }, user_owned: `${chat}-${swipe}` },
  }))]));
  let currentChat = 'A', currentSwipe = 0;
  const before = clone(chats);
  const active = () => chats[currentChat][currentSwipe];
  const started = deferred(), release = deferred();
  const calls = [], writes = [];
  const settings = {
    effective_settings: { 更新方式: '额外模型解析', 兼容性: { 更新到聊天变量: false },
      额外模型解析配置: { 启用自动请求: true } },
    settings: { 额外模型解析配置: { 应答格式: '聊天消息', 请求方式: '依次请求，失败后重试', 请求次数: 2 }, 通知: {} },
    runtimes: {},
  };
  const host = {
    _, console: silentConsole, Ba: false, ga: 0, le: events,
    SillyTavern: { chat: [{}, {}], name2: 'character' }, mn: () => settings,
    at: key => key, ya: () => 'synthetic header', Rn: async () => true,
    Ia: async () => {}, Ea: async () => {}, toastr: { info() {}, error() {} },
    getChatMessages: id => { assert.equal(id, 1); return [clone(active())]; },
    setChatMessages: async (rows, options) => {
      assert.equal(rows.length, 1); assert.equal(rows[0].message_id, 1);
      writes.push({ kind: 'message', chat: currentChat, swipe: currentSwipe, refresh: options.refresh });
      active().message = rows[0].message;
    },
    vn: () => ({ stat_data: { value: `${currentChat}-${currentSwipe}-previous-floor` } }),
    updateVariablesWith: async (fn, options) => {
      assert.equal(options.type, 'message'); assert.equal(options.message_id, 1);
      writes.push({ kind: 'variables', chat: currentChat, swipe: currentSwipe });
      active().variables = fn(active().variables);
    },
    eventEmit: async name => { calls.push(name); },
    Ta: async () => {
      calls.push('model'); started.resolve(); await release.promise;
      if (cancel) throw 'Clicked stop button';
      return update;
    },
    Mn: async (text, variables) => {
      calls.push('parse');
      if (entry === 'Un') { started.resolve(); await release.promise; }
      if (!text.includes(update) && entry !== 'Un') return false;
      variables.stat_data.value = 'A-model-result';
      return true;
    },
  };
  const code = `${functions.get('Ga')}\n${functions.get('Un')}\n${entry}(1, {force:true})`;
  const pending = runInNewContext(code, host, { timeout: 1000 });
  await started.promise;
  if (switchTo === 'chat') currentChat = 'B';
  if (switchTo === 'swipe') currentSwipe = 1;
  const destinationBefore = clone(active());
  release.resolve();
  await pending;
  assert.ok(writes.length > 0);
  assert.notDeepEqual(active(), destinationBefore);
  assert.ok(writes.every(write => write.chat === currentChat && write.swipe === currentSwipe));
  if (switchTo) assert.deepEqual(chats.A[0], before.A[0], 'The old source stays untouched in this fixture.');
  if (cancel) {
    assert.equal(calls.filter(call => call === 'model').length, 1, 'Cancellation does not retry the model.');
    assert.equal(calls.filter(call => call === 'parse').length, 1, 'Cancellation still enters Un.');
    assert.equal(active().message.includes(update), false, 'No new model block is appended on cancellation.');
    assert.equal(active().variables.stat_data.value, `${currentChat}-${currentSwipe}-previous-floor`);
  } else {
    assert.equal(active().variables.stat_data.value, 'A-model-result');
  }
  return { entry, switchTo: switchTo ?? 'none', cancel, modelCalls: calls.filter(call => call === 'model').length,
    writes, syntheticActiveSelectionWriteObserved: !!switchTo, originalSourcePreserved: !!switchTo };
}

// Optionally run the real on-disk Helper emit bridge and Tavern EventEmitter,
// still against a new isolated bus, never the live browser's listeners.
function installedEventBridge() {
  const helperRoot = process.argv[3], tavernRoot = process.argv[4];
  if (!helperRoot && !tavernRoot) return null;
  assert.ok(helperRoot && tavernRoot, 'Supply both Helper and Tavern roots.');
  const bridgeSource = readFileSync(join(helperRoot, 'src/function/event.ts'), 'utf8');
  const bridgeAst = ts.createSourceFile('event.ts', bridgeSource, ts.ScriptTarget.Latest, true);
  const bridge = bridgeAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === '_eventEmit');
  assert.ok(bridge);
  const emitterSource = readFileSync(join(tavernRoot, 'public/lib/eventemitter.js'), 'utf8');
  const emitterAst = ts.createSourceFile('eventemitter.js', emitterSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const emitterCode = emitterAst.statements.filter(node => !ts.isExportDeclaration(node)).map(node => node.getText(emitterAst)).join('\n');
  const bridgeCode = ts.transpileModule(bridge.getText(bridgeAst).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let caughtListenerErrors = 0;
  const bus = runInNewContext(`${emitterCode}\nconst eventSource = new EventEmitter();\n${bridgeCode}\n({eventSource, emit: _eventEmit})`, {
    localStorage: { getItem: () => null },
    console: { ...silentConsole, error: () => { caughtListenerErrors += 1; } },
  }, { timeout: 1000 });
  return { ...bus, caughtListenerErrors: () => caughtListenerErrors,
    sourceHashes: { helperEvent: createHash('sha256').update(bridgeSource).digest('hex'),
      tavernEventEmitter: createHash('sha256').update(emitterSource).digest('hex') } };
}

// Empty parsed commands test event semantics without replacing Mn control flow.
// The public parseMessage wrapper is also extracted, not reimplemented here.
async function parseEventCase(bridge = null) {
  const original = { stat_data: { value: 'original' } };
  const emitted = [];
  let candidate;
  const eventNames = [events.VARIABLE_UPDATE_STARTED, events.COMMAND_PARSED,
    events.COMMAND_PARSED + '_for_zod', events.COMMAND_PARSED + '_ended_for_zod',
    events.VARIABLE_UPDATE_ENDED, events.VARIABLE_UPDATE_ENDED + '_for_zod'];
  const observe = async (name, value) => {
    emitted.push(name);
    if (candidate) assert.equal(value, candidate, 'The same candidate reaches each callback.');
    else candidate = value;
    if (name === events.VARIABLE_UPDATE_ENDED) {
      await Promise.resolve();
      value.stat_data.from_listener = true;
    }
  };
  if (bridge) {
    bridge.eventSource.on(events.VARIABLE_UPDATE_ENDED, () => { throw Error('synthetic listener refusal'); });
    eventNames.forEach(name => bridge.eventSource.on(name, value => observe(name, value)));
  }
  const result = await runInNewContext(`${functions.get('Mn')}\n(${parseMessageSource})('synthetic no-op text', original)`, {
    _, original, e: clone, kn: () => [], substitudeMacros: text => text, le: events,
    console: silentConsole, mn: () => ({ settings: { 通知: {} } }),
    eventEmit: bridge ? bridge.emit : observe,
    me: () => {},
  }, { timeout: 1000 });
  assert.equal(result, candidate, 'Public parseMessage returns the event-mutated clone.');
  assert.deepEqual(original, { stat_data: { value: 'original' } });
  assert.notEqual(candidate, original);
  assert.equal(candidate.stat_data.from_listener, true);
  assert.deepEqual(emitted, eventNames);
  if (bridge) assert.equal(bridge.caughtListenerErrors(), 1, 'A thrown listener does not abort the actual emitter.');
  return { inputClonePreserved: true, sourceEventCalls: emitted,
    syntheticListenerMutationObserved: true, bridge: bridge ? 'isolated-installed-source' : 'synthetic',
    sourceHashes: bridge?.sourceHashes, thrownListenerDoesNotAbortParser: bridge ? true : undefined };
}

const cases = [];
for (const entry of ['Ga', 'Un']) {
  for (const switchTo of [undefined, 'chat', 'swipe']) cases.push(await writerCase({ entry, switchTo }));
}
for (const switchTo of [undefined, 'chat', 'swipe']) cases.push(await writerCase({ switchTo, cancel: true }));
const bridge = installedEventBridge();
console.log(JSON.stringify({
  audit: 'pinned-mvu-write-ownership/v1', sha256,
  sourceFunctions: [...functions.keys()], cases, parseEventCase: await parseEventCase(),
  installedSourceEventCase: bridge ? await parseEventCase(bridge) : null,
  liveModelRequests: 0, liveWrites: 0, productionFixImplemented: false,
  limits: [
    'Synthetic hosts keep the old callback alive after selection changes; real iframe teardown is not simulated.',
    'Writer tests stub model generation and command parsing, not Ga/Un control flow.',
    'Event tests use synthetic listeners; the optional real-source bridge runs on an isolated bus, not live listeners.',
    'No claim of an observed cross-save write in the real browser or of current loaded-bundle identity.',
    'Passing this audit confirms an existing compatibility hazard, not a successful fix.',
  ],
}, null, 2));
