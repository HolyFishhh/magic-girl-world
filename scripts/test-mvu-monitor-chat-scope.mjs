import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { redactDiagnosticText } = require('../src/runtime/diagnosticRedaction.ts');

// Execute current runtime source, not an older dist bundle. No network or MVU writes.
// The browser runtime is bundled before execution. Strip source-only imports so
// this focused VM shell can exercise its published-script behavior directly.
const source = readFileSync('src/runtime/characterRuntime.ts', 'utf8')
  .replace(/^import[^;]+;\r?\n/gm, '');
const timers = new Map();
const stored = new Map();
let serial = 0;
let activeChatId = 'chat-a';
let now = 1_000_000;
class ControlledDate extends Date { static now() { return now; } }
class FakeElement {
  constructor(ownerDocument) { this.ownerDocument = ownerDocument; this.style = {}; this.dataset = {}; this.children = []; this.listeners = new Map(); this.isConnected = false; this.textContent = ''; this.id = ''; }
  set innerHTML(value) {
    this._innerHTML = value;
    for (const selector of String(value).matchAll(/(data-(?:action|mwg-[^\s=>]+))(?:="([^"]+)")?/g)) {
      const key = selector[2] ? `[${selector[1]}="${selector[2]}"]` : `[${selector[1]}]`;
      this.lookup(key);
    }
  }
  get innerHTML() { return this._innerHTML || ''; }
  lookup(selector) { if (!this.elements) this.elements = new Map(); if (!this.elements.has(selector)) this.elements.set(selector, new FakeElement(this.ownerDocument)); return this.elements.get(selector); }
  querySelector(selector) { return this.lookup(selector); }
  querySelectorAll() { return []; }
  appendChild(child) { this.children.push(child); child.isConnected = true; if (child.id) this.ownerDocument.byId.set(child.id, child); return child; }
  append(...children) { for (const child of children) this.appendChild(child); }
  replaceChildren(...children) { this.children = children; }
  remove() { this.isConnected = false; }
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 40, height: 40, right: 40, bottom: 40 }; }
  focus() {}
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get('click')?.({ currentTarget: this }); }
}
class FakeDocument {
  constructor() { this.byId = new Map(); this.body = new FakeElement(this); this.head = new FakeElement(this); this.documentElement = { clientWidth: 1280, clientHeight: 720 }; }
  createElement() { return new FakeElement(this); }
  getElementById(id) { return this.byId.get(id) || null; }
  querySelectorAll() { return []; }
}
const document = new FakeDocument();
const context = {
  localStorage: {getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},
  console, __MWG_BUILD_INFO__: { cardVersion: 'test', views: {} },
  __MWG_VIEW_ASSETS__: Object.fromEntries(['start','common','fish','update'].map(name => [name, {}])),
  document, redactDiagnosticText,
  Date: ControlledDate,
  assessMeasuredBuild: () => null,
  SillyTavern: { getContext: () => ({ chatId: activeChatId }) },
  setTimeout(fn) { timers.set(++serial, fn); return serial; },
  clearTimeout(id) { timers.delete(id); },
  setInterval() { return ++serial; }, clearInterval() {},
  eventOn() {}, eventRemoveListener() {}, initializeGlobal(name, value) { context[name] = value; },
};
context.globalThis = context;
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const monitor = context.MagicGirlWorldMvuMonitor;
const startupTimers = new Set(timers.keys());
assert.ok(monitor, 'real runtime exposes the monitor');
monitor.beginStructuredOperation({ generationId: 'a-request', detail: 'A running' });
monitor.captureMvuRequest({ payload: { messages: ['A private request'] } });
monitor.fail('A failed', 'a-request');
monitor.resetForChat('chat-a');
assert.equal(monitor.getSnapshot().phase, 'error', 'same-chat refresh must preserve real errors');
monitor.resetForChat('chat-b');
let state = monitor.getSnapshot();
assert.equal(state.chatId, 'chat-b');
assert.equal(state.phase, 'idle');
for (const key of ['output','rawOutput','pendingOutput','reasoning','requestContent','generationId']) assert.equal(state[key], '');
assert.equal(state.timeline.length, 0);
assert.equal(state.open, false);
monitor.fail('late A failure', 'a-request');
monitor.stream('late A tokens', 'a-request');
monitor.completeStructuredOperation({ generationId: 'a-request', summary: 'late A success' });
assert.equal(monitor.getSnapshot().phase, 'idle');
assert.equal(monitor.getSnapshot().pendingOutput, '');
monitor.beginStructuredOperation({ generationId: 'b-request', detail: 'B running' });
monitor.fail('late A failure', 'a-request');
assert.equal(monitor.getSnapshot().phase, 'generating');
monitor.completeStructuredOperation({ generationId: 'b-request', summary: 'B completed' });
assert.equal(monitor.getSnapshot().phase, 'success');
assert.equal(monitor.getSnapshot().output, 'B completed');
monitor.begin({ generationId: 'b-mvu' });
monitor.applying();
assert.ok(timers.size > 0);
monitor.resetForChat(null);
assert.deepEqual(new Set(timers.keys()), startupTimers, 'chat change cancels monitor timers without cancelling unrelated runtime startup');
assert.equal(monitor.getSnapshot().phase, 'idle');
const controller = readFileSync('src/sillytavern-extension/controller.ts', 'utf8');
assert.match(controller, /onChatChanged = \(\): void => \{\s*this\.retainInitialGenerationEvidence\(this\.currentChatId\(\)\);\s*(?:this\.retainTowerGenerationEvidence\(this\.currentChatId\(\)\);\s*)?this\.towerMonitor\(\)\?\.resetForChat\?\.\(this\.currentChatId\(\)\)/);
assert.match(controller, /monitor\?\.fail\?\.\(event\.error \|\| new Error\(event\.detail\), event\.generationId\)/);
console.log('PASS current-source monitor chat reset, same-chat error preservation, stale structured callbacks and timer cleanup; not live Tavern proof.');
monitor.resetForChat('persist-test');
monitor.beginStructuredOperation({generationId:'same-request',detail:'first stage'});
const began=monitor.getSnapshot().startedAt;
monitor.beginStructuredOperation({generationId:'same-request',detail:'repair stage',rawOutput:'rejected candidate'});
assert.equal(monitor.getSnapshot().startedAt,began);
assert.equal(monitor.getSnapshot().rawOutput,'rejected candidate');
assert.ok(monitor.getSnapshot().timeline.some(e=>e.detail==='first stage'));
monitor.captureMvuRequest({payload:{messages:['private prompt must not persist']}});
monitor.fail('battle.cards[6].effects: INVALID_TEST https://private.invalid/?token=secret Bearer credential sk-privatekey', 'same-request');
const report=monitor.getDiagnosticReport();
assert.match(report.detail,/battle.cards\[6\]/);
const saved=stored.get('mwg-generation-diagnostics-v1');
assert.ok(saved);
assert.doesNotMatch(saved,/private prompt|private\.invalid|credential|sk-privatekey|rejected candidate/);
monitor.resetForChat('unrelated');
assert.equal(monitor.getDiagnosticReport(),null);
monitor.resetForChat('persist-test');
assert.equal(monitor.getSnapshot().phase,'idle');
assert.equal(monitor.getDiagnosticReport().generationId,'same-request');
console.log('PASS bounded redacted diagnostic persistence, chat isolation and same-request elapsed timeline.');

monitor.beginStructuredOperation({generationId:'finished-opening',detail:'opening'});
monitor.completeStructuredOperation({generationId:'finished-opening',summary:'11 cards committed'});
const finished=JSON.stringify(monitor.getSnapshot());
for(const source of ['official','tavern-helper','official']) monitor.captureMvuRequest({source,payload:{purpose:'preset-narrative',messages:['later scene']}});
assert.equal(JSON.stringify(monitor.getSnapshot()),finished,'later stories must not extend a completed opening timeline');
monitor.receiveTowerGenerationStatus({requestId:'next',phase:'running',attempt:1});
assert.equal(monitor.getSnapshot().generationId,'tower-task:next');
monitor.receiveTowerGenerationCompleted({requestId:'old',response:'late'});
assert.equal(monitor.getSnapshot().phase,'generating');
monitor.receiveTowerGenerationCompleted({requestId:'next',response:'node data'});
assert.equal(monitor.getSnapshot().phase,'success');
monitor.receiveTowerGenerationStatus({requestId:'failed',phase:'running',attempt:1});
monitor.receiveTowerGenerationStatus({requestId:'failed',phase:'failed',error:{message:'provider disconnected'}});
assert.equal(monitor.getSnapshot().phase,'error');
assert.match(monitor.getSnapshot().detail,/provider disconnected/);
console.log('PASS completed opening isolation and task-scoped background running/completed/failed monitor lifecycle.');
monitor.beginStructuredOperation({generationId:'initial-owner',detail:'initial'});
monitor.receiveTowerGenerationStatus({nodeId:'__initial_preset_story',requestId:'initial-owner__story',phase:'running'});
assert.equal(monitor.getSnapshot().generationId,'initial-owner','initial publication owns its own progress');
monitor.completeStructuredOperation({generationId:'initial-owner',summary:'initial complete'});
monitor.receiveTowerGenerationStatus({requestId:'repair-parent',phase:'running'});
const repairStart = monitor.getSnapshot().startedAt;
monitor.receiveTowerGenerationStatus({requestId:'repair-parent__structure_repair_1',phase:'running'});
assert.equal(monitor.getSnapshot().generationId,'tower-task:repair-parent');
assert.equal(monitor.getSnapshot().startedAt,repairStart);
monitor.receiveTowerGenerationCompleted({requestId:'repair-parent',response:'repaired'});
assert.equal(monitor.getSnapshot().phase,'success','parent commit terminates repair progress');
monitor.receiveTowerGenerationStatus({requestId:'validation-failure',phase:'running'});
monitor.receiveTowerGenerationFailed({requestId:'validation-failure',error:'invalid content after provider completed'});
assert.equal(monitor.getSnapshot().phase,'error');
console.log('PASS initial ownership, structure-repair parent completion and post-transport validation failure.');
monitor.resetForChat('rapid-captures');
const narrativeRequest={purpose:'preset-narrative',messages:['scene']};
monitor.captureMvuRequest({source:'official',payload:narrativeRequest});
assert.equal(monitor.getSnapshot().phase,'idle');
assert.ok(monitor.getSnapshot().requestContent.includes('scene'));
monitor.captureMvuRequest({payload:{messages:['ordinary MVU']}});
monitor.beginStructuredOperation({generationId:'new-initial',detail:'new operation'});
monitor.captureMvuRequest({source:'official',payload:narrativeRequest});
assert.equal(monitor.getSnapshot().timeline.at(-1).label,'捕获 preset 剧情请求','new operations cannot inherit deduplication from a previous request');
const length=monitor.getSnapshot().timeline.length;
monitor.captureMvuRequest({source:'tavern-helper',payload:narrativeRequest});
assert.equal(monitor.getSnapshot().timeline.length,length,'two hooks observing the same request add one timeline entry');

// Structured generation follows the enabled automatic-window preference.
monitor.resetForChat('silent-background');
monitor.begin({generationId:'normal-mvu'});
assert.equal(monitor.getSnapshot().open,true,'ordinary MVU retains its configured window');
monitor.beginStructuredOperation({generationId:'silent',detail:'后台生成'});
assert.equal(monitor.getSnapshot().open,true);
assert.equal(monitor.getSnapshot().background,true);
monitor.stream('partial','silent');
monitor.beginStructuredOperation({generationId:'silent',detail:'有限修复'});
assert.equal(monitor.getSnapshot().open,true);
monitor.fail('test failure','silent');
assert.equal(monitor.getSnapshot().open,true);
monitor.beginStructuredOperation({generationId:'retry-silent',detail:'用户重试'});
monitor.openSettings();
assert.equal(monitor.getSnapshot().settingsVisible,true,'manual diagnostics remain accessible');
monitor.completeStructuredOperation({generationId:'retry-silent',summary:'完成'});
assert.equal(monitor.getSnapshot().open,true);
assert.equal(monitor.getSnapshot().settingsVisible,true,'completion does not close manually opened settings');
monitor.beginStructuredOperation({generationId:'silent-timeout',detail:'后台写入'});
monitor.applying();
for(const [id,fn] of [...timers])if(!startupTimers.has(id))fn();
assert.equal(monitor.getSnapshot().phase,'error');
assert.equal(monitor.getSnapshot().open,true,'write timeout preserves the configured open window');
console.log('PASS configured background start, stream, retry, failure, completion, timeout and manual diagnostics.');

monitor.resetForChat('chat-a');
activeChatId = 'chat-a';
let cancelledRequest;
context.MagicGirlDesignAssistant = { cancelTowerInitialStart: request => { cancelledRequest = request; return true; } };
monitor.beginStructuredOperation({ generationId: 'mwg-single-floor-start-2333-story', detail: '正在生成开局剧情' });
const root = document.getElementById('mwg-mvu-monitor');
const stop = root.querySelector('[data-action="cancel-tower-initial-start"]');
assert.equal(stop.style.display, 'inline-flex', 'only an active single-floor start exposes manual stop');
stop.click();
assert.equal(cancelledRequest.sourceMessageId, 2333);
assert.equal(cancelledRequest.generationId, 'mwg-single-floor-start-2333-story');
assert.equal(monitor.getSnapshot().phase, 'error');
assert.equal(monitor.getSnapshot().detail, '已停止本次开局生成');
monitor.beginStructuredOperation({ generationId: 'tower-task:background', detail: '后台预生成' });
assert.equal(stop.style.display, 'none', 'background node generation never exposes the opening-stop control');
monitor.beginStructuredOperation({ generationId: 'mwg-single-floor-start-2334-story', detail: '正在生成开局剧情' });
now += 120_000;
monitor.openSettings();
assert.equal(root.querySelector('[data-mwg-initial-wait-advisory]').style.display, 'block');
assert.match(root.querySelector('[data-mwg-initial-wait-advisory]').textContent, /120秒没有新的进度记录；请求仍在等待，可继续等待或手动停止本次开局生成/);
context.MagicGirlDesignAssistant.cancelTowerInitialStart = () => false;
stop.click();
assert.equal(monitor.getSnapshot().phase, 'generating', 'a refused cancellation leaves the exact current generation running');
assert.match(root.querySelector('[data-mwg-initial-stop-feedback]').textContent, /未被接受/);
activeChatId = 'chat-other';
stop.click();
assert.equal(monitor.getSnapshot().phase, 'generating', 'a changed chat cannot cancel the old generation');
assert.match(root.querySelector('[data-mwg-initial-stop-feedback]').textContent, /聊天已切换/);
console.log('PASS opening-only manual stop uses exact source/generation IDs, honors controller refusal and chat scope; no model request is made.');

// Manual requests start with a UI placeholder, while the direct repair host owns
// the actual stat-data generation ID. A later tower task must never be completed
// by the manual handler's eventual Promise resolution.
activeChatId = 'manual-direct-repair';
monitor.resetForChat(activeChatId);
let finishManualRepair;
context.MagicGirlWorld.registerCardRepairHandler(() => new Promise(resolve => { finishManualRepair = resolve; }));
monitor.openSettings();
const manualRoot = document.getElementById('mwg-mvu-monitor');
manualRoot.querySelector('[data-action="open-card-repair"]').click();
manualRoot.querySelector('[data-mwg-card-repair-input]').value = '把卡牌改成测试值';
manualRoot.querySelector('[data-action="submit-card-repair"]').click();
await Promise.resolve();
const directRepairId = 'mwg-stat-data-repair-42-1000000';
monitor.beginStructuredOperation({ generationId: directRepairId, detail: '直接修复开始' });
monitor.applyStructuredOperation({ generationId: directRepairId, detail: '写入补丁', rawOutput: '{"operations":[]}' });
monitor.completeStructuredOperation({ generationId: directRepairId, summary: '直接修复完成', rawOutput: '{"operations":[]}' });
monitor.beginStructuredOperation({ generationId: 'tower-task:prefetch', detail: '后台预取' });
finishManualRepair();
await Promise.resolve();
await Promise.resolve();
assert.equal(monitor.getSnapshot().generationId, 'tower-task:prefetch');
assert.equal(monitor.getSnapshot().phase, 'generating', 'manual completion cannot complete the replacing tower task');
const manualExport = (await monitor.getDiagnosticExportReport());
assert.equal(manualExport.manualRepairEvidence.generationId, directRepairId);
assert.equal(manualExport.manualRepairEvidence.association, 'matching-manual-monitor-output-fallback');
assert.equal(manualExport.manualRepairEvidence.liveOutput.text, '{"operations":[]}');
context.MagicGirlDesignAssistant.getInitialGenerationEvidence = () => ({
  spec: 'mwg.initial-generation-evidence/v2', chatId: activeChatId,
  runs: [{ generationId: directRepairId, startedAt: now, updatedAt: now, outcome: 'completed',
    records: [{ stage: 'repair-final', text: '{"operations":[]}', capturedAt: now }], validationErrors: [] }],
});
const durableManualExport = (await monitor.getDiagnosticExportReport());
assert.equal(durableManualExport.manualRepairEvidence.association, 'matching-manual-direct-repair-id');
assert.equal(durableManualExport.manualRepairEvidence.run.generationId, directRepairId);
console.log('PASS manual direct-repair ID ownership, tower replacement isolation, raw-output fallback and matching durable evidence.');

const repairEvidenceError = () => Object.assign(new Error('rejected repair'), {
  mvuRepairEvidence: { response: 'private prior-chat response', variableWriteObserved: false, eventActivityObserved: false, bareCommandObserved: false },
});
activeChatId = 'manual-failure';
monitor.resetForChat(activeChatId);
context.MagicGirlWorld.registerCardRepairHandler(async () => { throw repairEvidenceError(); });
monitor.openSettings();
manualRoot.querySelector('[data-action="open-card-repair"]').click();
manualRoot.querySelector('[data-mwg-card-repair-input]').value = '触发失败证据';
manualRoot.querySelector('[data-action="submit-card-repair"]').click();
await Promise.resolve();
await new Promise(resolve => setImmediate(resolve));
assert.equal((await monitor.getDiagnosticExportReport()).manualRepairFailureEvidence.response, 'private prior-chat response');
activeChatId = 'manual-failure-cleared';
monitor.resetForChat(activeChatId);
assert.equal((await monitor.getDiagnosticExportReport()).manualRepairFailureEvidence, null, 'manual failure evidence cannot cross chat boundaries');

let rejectLateRepair;
context.MagicGirlWorld.registerCardRepairHandler(() => new Promise((resolve, reject) => { rejectLateRepair = reject; }));
monitor.openSettings();
manualRoot.querySelector('[data-action="open-card-repair"]').click();
manualRoot.querySelector('[data-mwg-card-repair-input]').value = '延迟失败';
manualRoot.querySelector('[data-action="submit-card-repair"]').click();
await Promise.resolve();
activeChatId = 'manual-late-failure-cleared';
monitor.resetForChat(activeChatId);
rejectLateRepair(repairEvidenceError());
await Promise.resolve();
await new Promise(resolve => setImmediate(resolve));
assert.equal(monitor.getSnapshot().phase, 'idle', 'late manual failure cannot overwrite the new chat monitor');
assert.equal((await monitor.getDiagnosticExportReport()).manualRepairFailureEvidence, null, 'late manual failure cannot retain old-chat raw evidence');
console.log('PASS manual failure evidence and pending callbacks are isolated by original chat ID.');

monitor.resetForChat('story-battle-summary');
monitor.begin({ generationId: 'encounter-update' });
monitor.complete('<UpdateVariable>_.set(\'status.time\', \'旧\', \'新\');</UpdateVariable>');
monitor.success();
const completedEncounter = JSON.stringify(monitor.getSnapshot());
monitor.applying();
monitor.complete('【战斗结果】胜利\n请根据以下按回合战斗摘要继续剧情。'.padEnd(848, '。'));
monitor.stream('late unscoped tokens'); monitor.reasoning('late unrelated reasoning'); monitor.success();
assert.equal(JSON.stringify(monitor.getSnapshot()), completedEncounter, 'the battle-summary user message cannot replace a completed response or fabricate a failure');
monitor.begin({ generationId: 'actual-next-update' });
monitor.success(); monitor.complete('没有更新块的真实第二轮返回');
assert.equal(monitor.getSnapshot().phase, 'error', 'an actual new request without an update block must still fail');
assert.match(monitor.getSnapshot().detail, /未得到可解析/);
console.log('PASS story battle-summary late parse isolation and real next-request failure preservation.');


// Regression: COMMAND_PARSED can echo the unchanged story after the second stage
// fails. Never label that echo as provider output; keep transport evidence separate.
activeChatId = 'ordinary-mvu-provenance';
monitor.resetForChat(activeChatId);
monitor.syncExtraAnalysis(false);
monitor.syncExtraAnalysis(true);
monitor.captureMvuRequest({ source: 'official', payload: {
  api_key: 'SECRET_REQUEST_KEY', messages: [
    {role:'system', content:'固定顺序：<UpdateVariable> _.set( 紧急变量更新任务 [当前 MVU 游戏事实]'},
    {role:'user', content:'PRIVATE_STORY_REQUEST'},
  ],
} });
monitor.captureHelperFinal('PRIVATE_OTHER_GENERATION', 'ordinary-response'); // binds the MVU temporary ID
monitor.captureHelperFinal('WRONG_ID_OUTPUT', 'unrelated-response');
monitor.captureHelperFinal('FINAL_RESPONSE <Analysis>HIDDEN_REASONING</Analysis> token=private-final-token', 'ordinary-response');
monitor.complete('既有剧情正文\n<CHARACTER_INIT_PENDING>');
monitor.success();
for (const [id, callback] of [...timers]) if (!startupTimers.has(id)) { timers.delete(id); callback(); }
assert.equal(monitor.getSnapshot().phase, 'error');
assert.match(monitor.getSnapshot().detail, /解析事件可能仅含原楼层剧情/);
const provenance = await monitor.getDiagnosticExportReport();
assert.equal(provenance.originalResponse.availability, 'missing', 'helper and parser events are not raw provider responses');
assert.equal(provenance.evidence.liveOutput.stage, 'mvu-command-parsed');
assert.equal(provenance.mvuRequestAudit.hasUpdateVariable, true);
assert.equal(provenance.mvuRequestAudit.hasMvuTask, true);
assert.equal(provenance.mvuRequestAudit.hasOutputContract, true);
assert.equal(provenance.mvuRequestAudit.hasCurrentMvuFacts, true);
assert.equal(provenance.mvuRequestAudit.messageCount, 2);
assert.equal(provenance.mvuHelperFinal.generationId, 'ordinary-response');
assert.match(provenance.mvuHelperFinal.text, /FINAL_RESPONSE/);
assert.doesNotMatch(JSON.stringify(provenance), /SECRET_REQUEST_KEY|PRIVATE_STORY_REQUEST|WRONG_ID_OUTPUT|PRIVATE_OTHER_GENERATION|HIDDEN_REASONING|private-final-token/);
assert.doesNotMatch(stored.get('mwg-generation-diagnostics-v1'), /FINAL_RESPONSE|PRIVATE_STORY_REQUEST/);
monitor.syncExtraAnalysis(false);
monitor.syncExtraAnalysis(true);
assert.equal((await monitor.getDiagnosticExportReport()).mvuHelperFinal, null, 'new operation clears prior final output');
monitor.captureMvuRequest({payload:{messages:[{role:'user',content:'Only story, no variable protocol'}]}});
monitor.captureHelperFinal('', 'empty-response');
const emptyTransport = await monitor.getDiagnosticExportReport();
assert.equal(emptyTransport.mvuHelperFinal.text, '', 'an observed empty final is distinguishable from no final event');
assert.equal(emptyTransport.mvuRequestAudit.hasUpdateVariable, false);
monitor.resetForChat('other-provenance-chat');
monitor.captureHelperFinal('STALE_OUTPUT', 'empty-response');
const otherExport = await monitor.getDiagnosticExportReport();
assert.equal(otherExport.mvuHelperFinal, null);
assert.equal(otherExport.mvuRequestAudit, null);
assert.equal(monitor.getSnapshot().phase, 'idle');
console.log('PASS ordinary MVU parser/transport provenance, content-free request audit, empty final, redaction and chat/operation isolation.');
