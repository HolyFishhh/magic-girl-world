// Actual evidence renderer and its production CSS in a fresh browser profile.
// Synthetic records only; no Tavern page, chat, or model is touched.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import ts from 'typescript';

const profile = mkdtempSync(resolve('tmp/evidence-view-browser-'));
const renderer = ts.transpileModule(readFileSync('src/runtime/generationEvidenceView.ts', 'utf8').replace(/^export /gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const runtime = readFileSync('src/runtime/characterRuntime.ts', 'utf8');
const css = runtime.split('\n').filter(line => line.startsWith('#mwg-mvu-monitor .mwg-process-block') || line.startsWith('#mwg-mvu-monitor *')).join('\n');
assert.ok(css.includes('overflow-wrap:anywhere'));
const fixture = `
window.reads=0; window.fail=true; window.downloads=[];
window.original='<img src=x onerror="window.injected=true">'+'黑暗仪式完整原文'.repeat(3000);
URL.createObjectURL=blob=>{window.downloads.push(blob);return 'blob:synthetic';};
URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){};
window.render=()=>renderGenerationEvidencePage(document.querySelector('#records'),{total:1,records:[{key:'tower:1',requestId:'synthetic',stage:'response',kind:'爬塔生成',recordedAt:1}]},()=>{},async()=>{window.reads++;if(window.fail)throw Error('文件暂时离线');return {text:window.original,full:{response:window.original}};});
window.render();window.ready=true;`;
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><style>${css}</style></head><body><div id="mwg-mvu-monitor"><div id="records"></div></div><script>${renderer}\n${fixture}</script></body></html>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const child = spawn(process.env.MWG_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket, sequence = 0, browserError;
child.on('error', error => { browserError = error; });
const pending = new Map(), pause = ms => new Promise(done => setTimeout(done, ms));
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (browserError) throw browserError;
    try { port = Number(readFileSync(`${profile}/DevToolsActivePort`, 'utf8').split('\n')[0]); if (port) break; } catch {}
    await pause(100);
  }
  assert.ok(port);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { done, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.on('message', raw => {
    const message = JSON.parse(raw), handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id); clearTimeout(handler.timeout);
    if (message.error) handler.reject(Error(JSON.stringify(message.error))); else handler.done(message.result);
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate('window.ready===true')) break; await pause(50); }
  assert.equal(await evaluate('window.ready'), true);
  assert.equal(await evaluate('window.reads'), 0);
  await evaluate(`document.querySelector('summary').click()`); await pause(50);
  assert.equal(await evaluate(`document.querySelector('pre').textContent`), '文件暂时离线');
  await evaluate(`window.fail=false;document.querySelector('details button').click()`);
  assert.equal(await evaluate(`document.querySelector('pre').textContent === window.original.slice(0,12000)`), true);
  const sizes = [];
  for (const width of [320, 390, 1200]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    const measured = await evaluate(`(()=>{const pre=document.querySelector('pre'),rect=pre.getBoundingClientRect();return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,preHeight:rect.height,preScrollHeight:pre.scrollHeight,textLength:pre.textContent.length};})()`);
    assert.ok(measured.documentWidth <= width); assert.ok(measured.preHeight <= 231); assert.ok(measured.preScrollHeight > measured.preHeight);
    sizes.push(measured);
    if (width === 390) { const shot = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${profile}/390.png`, Buffer.from(shot.data, 'base64')); }
  }
  await evaluate(`while(!document.querySelector('details button').hidden) document.querySelector('details button').click()`);
  assert.equal(await evaluate(`document.querySelector('pre').textContent===window.original`), true);
  assert.equal(await evaluate(`!!window.injected || !!document.querySelector('pre img')`), false);
  await evaluate(`document.querySelectorAll('details button')[1].click()`);
  assert.equal(await evaluate(`window.downloads[0].text().then(text=>JSON.parse(text).response===window.original)`), true);
  writeFileSync(`${profile}/evidence.json`, JSON.stringify({ passed: true, productionRenderer: true, productionRecordCss: true, sizes, lazyRead: true, failureRetry: true, exactDownload: true, safeText: true, fullTavernPlaytest: false }, null, 2));
  console.log(`PASS isolated browser: lazy read, retry, complete download, text safety and 320/390/1200 layout; ${profile}/evidence.json`);
  await call('Browser.close');
} finally {
  socket?.close(); child.kill(); server.close();
  for (const handler of pending.values()) clearTimeout(handler.timeout);
}
