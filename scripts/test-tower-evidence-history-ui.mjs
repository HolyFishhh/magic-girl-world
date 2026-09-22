import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { renderGenerationEvidencePage } = require('../src/runtime/generationEvidenceView.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
class Element {
  children = []; listeners = {}; dataset = {}; style = {}; hidden = false; open = false;
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; }
  set textContent(value) { this.children = []; this.text = value; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent || '').join(''); }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  contains(child) { return this === child || this.children.some(value => value === child || value.contains?.(child)); }
  querySelectorAll(selector) { return this.children.filter(child => child.tag === 'details' && (selector !== 'details[open]' || child.open)); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  fire(type) { for (const handler of this.listeners[type] || []) handler({ currentTarget: this }); }
  get childElementCount() { return this.children.length; }
}
const doc = { createElement: tag => new Element(tag, doc), createTextNode: textContent => ({ textContent }) };
const container = new Element('div', doc);
let reads = 0, fail = true;
const original = '<script>never execute</script>' + '完整原文'.repeat(5000);
const page = { total: 1, records: [{ key: 'tower:1', requestId: 'r', stage: 'response', kind: '爬塔生成', recordedAt: 1, characters: original.length }] };
renderGenerationEvidencePage(container, page, () => {}, async () => { reads++; if (fail) throw Error('文件暂时离线'); return { text: original, full: { response: original } }; });
assert.equal(reads, 0, 'closed rows do not read full records');
const row = container.children.find(child => child.tag === 'details'), pre = row.children[1], more = row.children[2];
row.open = true; row.fire('toggle'); await flush();
assert.match(pre.textContent, /离线/); assert.equal(more.textContent, '重试读取原文');
fail = false; more.fire('click'); await flush(); assert.equal(reads, 2);
assert.equal(pre.textContent, original.slice(0, 12000));
more.fire('click'); assert.equal(pre.textContent, original); assert.equal(more.hidden, true);
assert.equal(row.children[3].hidden, false, 'complete single-record download remains available');

// Replace a row while its read is still in flight: no late text reaches the new row.
let finish; renderGenerationEvidencePage(container, page, () => {}, () => new Promise(resolve => { finish = resolve; }));
const detached = container.children.find(child => child.tag === 'details');
detached.open = true; detached.fire('toggle'); await flush();
renderGenerationEvidencePage(container, { total: 0, records: [] }, () => {});
finish({ text: 'private old chat', full: {} }); await flush(); assert.ok(!container.textContent.includes('private old chat'));

// Execute the production async history coordinator, including stale result gates.
const source = fs.readFileSync('src/runtime/characterRuntime.ts', 'utf8');
const start = source.indexOf('    const renderEvidenceHistory = (): void => {');
const end = source.indexOf('    const renderMvuProcess', start);
assert.ok(start >= 0 && end > start);
let revision = 1, calls = 0, slow = false, finishList;
const state = { settingsVisible: true, chatId: 'chat' };
const provider = {
  getGenerationEvidenceStatus: () => ({ revision }),
  getRecentGenerationEvidence: async () => { calls++; if (slow) return new Promise(resolve => { finishList = resolve; }); return { ...page, chatId: state.chatId }; },
  getGenerationEvidenceRecord: async () => ({ response: original }),
};
container.replaceChildren();
const context = vm.createContext({ root: { querySelector: () => container, contains: target => target === container }, monitorState: state,
  readEvidenceProvider: () => provider, renderGenerationEvidencePage, diagnosticText: String, console });
vm.runInContext(ts.transpileModule(`let evidenceHistorySignature = '', evidenceHistoryChat = null, evidenceHistoryLimit = 5, evidenceHistoryRequest = 0;\n${source.slice(start, end)}\nthis.render = renderEvidenceHistory;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
context.render(); await flush(); assert.equal(calls, 1);
const previous = container.children.find(child => child.tag === 'details');
context.render(); await flush(); assert.equal(calls, 1); assert.equal(container.children.find(child => child.tag === 'details'), previous);
revision++; context.render(); await flush(); assert.equal(calls, 2);
slow = true; revision++; context.render(); await flush();
state.chatId = 'new-chat'; finishList({ ...page, chatId: 'chat' }); await flush();
assert.ok(!container.textContent.includes('private old chat'));
console.log('PASS lazy evidence UI, exact text, bounded DOM, read failure/retry, stale row/list guards and unchanged-list reuse');
