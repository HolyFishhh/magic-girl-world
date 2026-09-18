import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const port = 18167;
const profile = resolve('tmp/runtime-scroll-browser-profile-v466');
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });

let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.length) break;
    } catch {}
    await new Promise(resolveTimer => setTimeout(resolveTimer, 100));
  }
  assert.ok(targets?.length, 'isolated Edge must start');
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveSocket, rejectSocket) => { socket.once('open', resolveSocket); socket.once('error', rejectSocket); });
  let sequence = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    message.error ? request?.reject(message.error) : request?.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolveCall, reject: rejectCall });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = milliseconds => new Promise(resolveTimer => setTimeout(resolveTimer, milliseconds));
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `file:///${resolve('tmp/ui-v466/runtime-scroll-host.html').replaceAll('\\', '/')}` });
  await wait(3000);

  await evaluate(`(() => {
    const chat = document.getElementById('chat');
    const frame = document.getElementById('TH-message--scroll-fixture');
    if (!frame?.contentWindow?.resizeFrame) throw new Error('fixture iframe did not load');
    chat.scrollTop = 1070;
    window.__apiCalls = [];
    const patch = (target, key, label) => {
      const original = target[key];
      if (typeof original !== 'function') return;
      target[key] = function (...args) { window.__apiCalls.push({ label, args: args.map(value => String(value)), at: performance.now() }); return original.apply(this, args); };
    };
    patch(window, 'scrollTo', 'host.scrollTo'); patch(window, 'scrollBy', 'host.scrollBy');
    patch(HTMLElement.prototype, 'scrollIntoView', 'host.scrollIntoView'); patch(HTMLElement.prototype, 'focus', 'host.focus');
    const child = frame.contentWindow;
    patch(child, 'scrollTo', 'child.scrollTo'); patch(child, 'scrollBy', 'child.scrollBy');
    patch(child.HTMLElement.prototype, 'scrollIntoView', 'child.scrollIntoView'); patch(child.HTMLElement.prototype, 'focus', 'child.focus');
    window.__scrollEvidence.length = 0;
  })()`);

  const checkpoints = [];
  for (const seconds of [5, 10, 20]) {
    await wait(seconds === 5 ? 5000 : seconds === 10 ? 5000 : 10000);
    const evidence = await evaluate(`(() => {
      const chat = document.getElementById('chat');
      const frame = document.getElementById('TH-message--scroll-fixture');
      const before = chat.scrollTop;
      const height = String((Number.parseInt(frame.style.height || '0', 10) || 900) + 37) + 'px';
      frame.contentWindow.resizeFrame(frame, height);
      // Reproduce browser scroll anchoring after the iframe write, not a user action.
      requestAnimationFrame(() => { chat.scrollTop = before + 211; });
      return new Promise(resolveTimer => requestAnimationFrame(() => requestAnimationFrame(() => resolveTimer({ before, after: chat.scrollTop, height: frame.style.height, focus: document.activeElement?.id || document.activeElement?.tagName }))));
    })()`);
    assert.equal(evidence.after, evidence.before, `delayed ${seconds}s frame resize must retain host scroll`);
    checkpoints.push({ seconds, ...evidence });
  }

  const idle = await evaluate(`new Promise(resolveTimer => setTimeout(() => {
    const chat = document.getElementById('chat');
    resolveTimer({ top: chat.scrollTop, scrollEvents: window.__scrollEvidence, apiCalls: window.__apiCalls });
  }, 1200))`);
  assert.equal(idle.top, 1070, 'passive host timers must not move a reader after resizing settles');
  assert.equal(idle.apiCalls.length, 0, 'no passive scroll/focus API call is permitted during delayed resizing');
  const userInput = await evaluate(`(() => {
    const chat = document.getElementById('chat');
    const frame = document.getElementById('TH-message--scroll-fixture');
    const before = chat.scrollTop;
    frame.contentWindow.resizeFrame(frame, String((Number.parseInt(frame.style.height || '0', 10) || 900) + 37) + 'px');
    chat.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 60 }));
    chat.scrollTop = before + 83;
    return new Promise(resolveTimer => requestAnimationFrame(() => requestAnimationFrame(() => resolveTimer({ before, after: chat.scrollTop }))));
  })()`);
  assert.equal(userInput.after, userInput.before + 83, 'user scrolling during the guard must not be overwritten by restoration');
  const cleanup = await evaluate(`(() => {
    const child = document.getElementById('TH-message--scroll-fixture').contentWindow;
    child.fixture.appearance(true);
    child.fullAnim.playCombatAction('player', 'skill', '✨', 'cleanup probe');
    return new Promise(resolveTimer => requestAnimationFrame(() => {
      const before = child.document.getElementById('stage-player-emoji').textContent;
      child.fullAnim.clearTransientEffects();
      resolveTimer({ before, after: child.document.getElementById('stage-player-emoji').textContent, tokens: child.document.querySelectorAll('.stage-action-token,.physics-damage').length });
    }));
  })()`);
  assert.equal(cleanup.before, '😈', 'fixture must activate a character-form emoji before cleanup');
  assert.equal(cleanup.after, '😈', 'settlement cleanup must preserve character-form emoji');
  assert.equal(cleanup.tokens, 0, 'settlement cleanup must remove transient stage tokens');
  fs.writeFileSync('tmp/runtime-scroll-browser-evidence.json', JSON.stringify({ checkpoints, idle, userInput, cleanup }, null, 2));
  console.log(JSON.stringify({ checkpoints, idle: { top: idle.top, scrollEvents: idle.scrollEvents.length, apiCalls: idle.apiCalls.length }, userInput, cleanup }, null, 2));
} finally {
  socket?.close();
  edge.kill();
}
