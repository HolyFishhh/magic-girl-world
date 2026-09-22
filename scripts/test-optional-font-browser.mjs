import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import ts from 'typescript';

const profile = mkdtempSync(resolve('tmp/optional-font-browser-'));
const loader = ts.transpileModule(readFileSync('src/runtime/optionalFonts.ts', 'utf8').replace('export function', 'function'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<html><head><meta charset="utf-8"></head><body><button id="action">继续冒险</button><script>${loader}\nensureOptionalFonts(); document.querySelector('#action').onclick = () => { window.clicked = true; }; window.initialized = true;</script></body></html>`);
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const child = spawn(process.env.MWG_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket, sequence = 0, browserError;
child.on('error', error => { browserError = error; });
const pending = new Map(), blocked = [];
const pause = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (browserError) throw browserError;
    try { port = Number(readFileSync(`${profile}/DevToolsActivePort`, 'utf8').split('\n')[0]); if (port) break; } catch {}
    await pause(100);
  }
  assert.ok(port, 'isolated headless browser started');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.once('open', done); socket.once('error', reject); });
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { done, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.method === 'Fetch.requestPaused') blocked.push(message.params.requestId);
    if (!message.id) return;
    const handler = pending.get(message.id); if (!handler) return;
    pending.delete(message.id); clearTimeout(handler.timeout);
    if (message.error) handler.reject(Error(JSON.stringify(message.error))); else handler.done(message.result);
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: 'https://fonts.googleapis.com/*' }] });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (blocked.length && await evaluate('window.initialized === true')) break;
    await pause(50);
  }
  assert.ok(blocked.length > 0, 'font request is held indefinitely');
  assert.equal(await evaluate('window.initialized === true'), true);
  assert.equal(await evaluate('document.querySelector("#mwg-optional-fonts").media'), 'print');
  await evaluate('document.querySelector("#action").click()');
  assert.equal(await evaluate('window.clicked'), true, 'actions work before decorative CSS arrives');
  await evaluate('ensureOptionalFonts()');
  assert.equal(await evaluate('document.querySelectorAll("#mwg-optional-fonts").length'), 1);
  for (const requestId of blocked) await call('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
  assert.equal(await evaluate('window.initialized'), true, 'failed fonts do not undo initialization');
  writeFileSync(`${profile}/evidence.json`, JSON.stringify({ passed: true, productionFontLoader: true, remoteCssHeld: true, actionWorksWhileHeld: true, fullTavernPlaytest: false }, null, 2));
  console.log(`PASS isolated Chromium: initialization and action remain usable with held/offline font CSS; ${profile}/evidence.json`);
  await call('Browser.close');
} finally {
  socket?.close(); child.kill(); server.close();
  for (const handler of pending.values()) clearTimeout(handler.timeout);
}
