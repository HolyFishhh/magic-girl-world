import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { commitMvuUpdate, withMvuWriteLock } = require('../src/runtime/mvuWriteCoordinator.ts');
const core = require('../src/game-core/battleEventJournal.ts');
const adapter = require('../src/runtime/runStateAdapter.ts');

let root = { stat_data: { run: { stateRevision: 7 }, cards: ['original'], narrative: 'before' } };
const base = structuredClone(root), narrative = structuredClone(base), cards = structuredClone(base);
narrative.stat_data.narrative = 'new story'; cards.stat_data.cards.push('reward');
const pending = [];
const ports = { read: () => structuredClone(root), write: data => new Promise(resolve => pending.push(() => { root = data; resolve(); })), assertCurrent() {} };
const a = commitMvuUpdate({ ...ports, base, next: narrative });
const b = commitMvuUpdate({ ...ports, base, next: cards });
await new Promise(resolve => setImmediate(resolve));
assert.equal(pending.length, 1, 'only one host write may be in flight');
pending.shift()(); await a;
await new Promise(resolve => setImmediate(resolve));
assert.equal(pending.length, 1); pending.shift()(); await b;
assert.deepEqual(root.stat_data.cards, ['original', 'reward']);
assert.equal(root.stat_data.narrative, 'new story');
await assert.rejects(commitMvuUpdate({ ...ports, base, next: { stat_data: { ...base.stat_data, cards: ['conflicting reward'] } } }), /本次操作未保存/);
let current = true, blocked;
const hold = withMvuWriteLock(() => new Promise(resolve => { blocked = resolve; }));
await new Promise(resolve => setImmediate(resolve));
const stale = commitMvuUpdate({ ...ports, base: root, next: root, assertCurrent() { if (!current) throw Error('stale scope'); } });
current = false; blocked(); await hold;
await assert.rejects(stale, /stale scope/);
assert.equal(pending.length, 0);
await assert.rejects(withMvuWriteLock(async () => { throw Error('host failed'); }), /host failed/);
assert.equal(await withMvuWriteLock(async () => 42), 42, 'failure does not poison the queue');
await assert.rejects(commitMvuUpdate({ ...ports, base: { stat_data: { run: { seed: 1 } } }, next: root }), /当前冒险已变化/);
const unreadableNext = structuredClone(root); unreadableNext.stat_data.narrative = 'unconfirmed';
await assert.rejects(commitMvuUpdate({ ...ports, base: root, next: unreadableNext, write() {} }), /保存结果未确认/);

// Real character-runtime update wrapper: freeze latest, do not replay updaters,
// and cancel writes after changing a chat/message/swipe while UI work awaits.
const runtimeSource = readFileSync('src/runtime/characterRuntime.ts', 'utf8');
const runtimeCode = runtimeSource.slice(runtimeSource.indexOf('  const messageVariableUpdateQueues ='), runtimeSource.indexOf('  const replaceMvuMessageVariables ='));
let chatId = 'chat', messageId = 3, swipeId = 0, updaterRelease;
let updates = 0, writes = 0;
const runtimeContext = vm.createContext({
  Map, Promise, Number, Error, destroyed: false, commitMvuUpdate,
  host: { getLastMessageId: () => messageId, getChatMessages: () => [{ swipe_id: swipeId }] },
  mvuMonitor: { getSnapshot: () => ({ chatId }) },
  getMvuApi: () => ({ replaceMvuData: data => { writes++; root = data; } }),
  readMvuMessageVariables: () => structuredClone(root), cloneSettlementValue: structuredClone,
  isSettlementRecord: value => value && typeof value === 'object' && !Array.isArray(value),
});
vm.runInContext(ts.transpileModule(`${runtimeCode}\nthis.update = updateMvuMessageVariablesWith;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, runtimeContext);
for (const change of [() => chatId = 'other', () => messageId++, () => swipeId++]) {
  const work = runtimeContext.update('latest', async data => { updates++; await new Promise(resolve => { updaterRelease = resolve; }); return data; });
  await new Promise(resolve => setImmediate(resolve));
  change(); updaterRelease();
  await assert.rejects(work, /已取消旧页面保存/);
}
assert.equal(updates, 3); assert.equal(writes, 0);
await runtimeContext.update('latest', data => { updates++; data.stat_data.confirmed = true; return data; });
assert.equal(updates, 4); assert.equal(writes, 1);

// Separate bundles/realms coordinate through their same-origin top window.
const registry = {};
const coordinatorCode = ts.transpileModule(readFileSync('src/runtime/mvuWriteCoordinator.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const bundle = () => { const ctx = vm.createContext({ exports: {}, require: () => require('../src/runtime/messageVariableMerge.ts'), window: { top: registry } }); vm.runInContext(coordinatorCode, ctx); return ctx.exports; };
const firstBundle = bundle(), secondBundle = bundle();
const order = []; let release;
const first = firstBundle.withMvuWriteLock(async () => { order.push('first'); await new Promise(resolve => { release = resolve; }); });
const second = secondBundle.withMvuWriteLock(async () => order.push('second'));
await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(order, ['first']);
release(); await Promise.all([first, second]); assert.deepEqual(order, ['first', 'second']);

// Exercise the real UI functions while a node activation is unresolved.
const source = readFileSync('src/common/index.ts', 'utf8');
const functions = ['activateTowerNode', 'renderActionArea', 'setSendingState', 'clearSendingOwner'].map(name => source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))?.[0]);
assert.ok(functions.every(Boolean));
const waiting = [], calls = [];
const context = vm.createContext({ Symbol, __sendingOwner: undefined, __IS_SENDING_ACTION: false, document: { querySelector: () => ({ style: {} }) }, renderRewardInline() {}, setRunButtonsDisabled() {}, runActionHost: { activateTowerRunNode: id => { calls.push(id); return new Promise(resolve => waiting.push(resolve)); } }, requestUserFocus() {}, loadGameData: async () => {}, showRunError() {}, __PENDING_REWARD_SUMMARY: null, __PENDING_RUN_SUMMARY: null, __RUN_ERROR: null });
vm.runInContext(ts.transpileModule(functions.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const action = context.activateTowerNode({ id: 'node_a' });
context.renderActionArea();
assert.equal(context.__IS_SENDING_ACTION, true);
await context.activateTowerNode({ id: 'node_a' });
assert.equal(calls.length, 1, 'render cannot admit a duplicate node activation');
context.clearSendingOwner();
const newAction = context.activateTowerNode({ id: 'node_b' });
waiting.shift()(); await action;
assert.equal(context.__IS_SENDING_ACTION, true, 'old completion cannot release a new action owner');
waiting.shift()(); await newAction; assert.equal(context.__IS_SENDING_ACTION, false);

let journal = core.createBattleEventJournal();
for (let i = 0; i < 1000; i++) {
  const result = core.appendBattleEvent(journal, { turn: Math.floor(i / 50) + 1, phase: 'after', kind: 'card_played', cause: { source: { kind: 'card', id: 'combo' }, reason: 'player_choice' }, actorId: 'player', cardInstanceId: 'combo_' + i, templateId: 'combo', cardType: 'Attack', paidEnergy: 0, automatic: false, replayIndex: 0 });
  assert.equal(result.ok, true); journal = result.state;
}
const stat = {};
for (let battle = 0; battle < 21; battle++) adapter.archiveBattleEventJournalInStat(stat, 'encounter_' + battle, journal);
assert.equal(adapter.readRunEventHistoryInStat(JSON.parse(JSON.stringify(stat))).records.length, 21000);
adapter.archiveBattleEventJournalInStat(stat, 'encounter_22', journal);
assert.equal(stat.run_event_history.records.length, 22000);
adapter.archiveBattleEventJournalInStat(stat, 'encounter_22', journal);
assert.equal(stat.run_event_history.records.length, 22000, 'settlement retry archives idempotently');
const invalid = { run_event_history: { schemaVersion: 99, records: [] } }, retained = structuredClone(invalid);
assert.throws(() => adapter.archiveBattleEventJournalInStat(invalid, 'new', journal), /已停止保存/);
assert.deepEqual(invalid, retained, 'invalid history is never silently replaced');
console.log('PASS shared MVU writes, same-revision merging, conflicts, stale scope, failure recovery, UI action ownership, and 22,000-event save/restore');
