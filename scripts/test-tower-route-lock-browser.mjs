import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import webpack from 'webpack';
import * as sass from 'sass';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const runState = require('../src/game-core/runState.ts');
const adapter = require('../src/runtime/towerStateAdapter.ts');
const { runMapContentKind } = require('../src/game-core/runMap.ts');

function findRouteFixture() {
  for (let seed = 1; seed <= 2_000; seed += 1) {
    const opening = runState.createRunState({ seed });
    const queue = [{ state: opening, trail: [] }];
    while (queue.length > 0) {
      const { state, trail } = queue.shift();
      if (state.floor >= state.floorsPerAct || trail.length >= 15) continue;
      for (const choice of state.choices) {
        const afterNode = runState.completeRunNode(runState.enterRunNode(state, choice.id), { outcome: 'cleared' });
        const nextTreasure = afterNode.choices.find(candidate => candidate.kind === 'treasure');
        const prepared = adapter.collectTowerPreparationWindow(afterNode);
        const preparedIds = new Set(prepared.map(target => target.nodeId));
        const rest = nextTreasure && afterNode.map.nodes.find(node =>
          node.act === afterNode.act &&
          runMapContentKind(node) === 'rest' &&
          preparedIds.has(node.id) &&
          afterNode.map.edges.some(edge => edge.from === nextTreasure.id && edge.to === node.id),
        );
        if (choice.kind === 'battle' && nextTreasure && rest && preparedIds.has(nextTreasure.id)) {
          return { afterBattle: afterNode, battle: choice, treasure: nextTreasure, rest };
        }
        queue.push({ state: afterNode, trail: [...trail, choice.id] });
      }
    }
  }
  throw new Error('could not find a generated battle → treasure → prepared rest route');
}

const route = findRouteFixture();
const fixture = structuredClone(route.afterBattle);
fixture.nodeContent[route.treasure.id] = {
  ...fixture.nodeContent[route.treasure.id],
  phase: 'generating',
};
fixture.nodeContent[route.rest.id] = {
  ...fixture.nodeContent[route.rest.id],
  phase: 'ready',
  content: { narrative: '后方篝火已经准备好，但仍需先经过宝箱。' },
};

const directory = fs.mkdtempSync(resolve('tmp/tower-route-lock-'));
const evidenceDirectory = join(directory, 'evidence');
fs.mkdirSync(evidenceDirectory, { recursive: true });
const fixtureJson = JSON.stringify({ run: fixture, treasureId: route.treasure.id, restId: route.rest.id, battleId: route.battle.id }).replace(/</g, '\\u003c');

fs.writeFileSync(join(directory, 'entry.ts'), `
import { mountTowerApp } from '../../src/tower/towerApp';

declare global { interface Window { __towerRouteFixture: any; towerRouteLock: any; } }
const fixture = window.__towerRouteFixture;
let snapshot = fixture.run;
let selections = 0;
const controller = mountTowerApp({
  root: document.getElementById('tower-root')!,
  snapshot,
  title: '路线锁定视觉验收',
  callbacks: { onNodeSelect: () => { selections += 1; } },
});
window.towerRouteLock = {
  getSelections: () => selections,
  setRestPhase: phase => {
    snapshot={...snapshot,nodeContent:{...snapshot.nodeContent,[fixture.restId]:{...snapshot.nodeContent[fixture.restId],phase}}};
    controller.update(snapshot);
  },
  makeTreasureReady: () => {
    snapshot = {
      ...snapshot,
      nodeContent: {
        ...snapshot.nodeContent,
        [fixture.treasureId]: {
          ...snapshot.nodeContent[fixture.treasureId],
          phase: 'ready',
          content: { narrative: '宝箱已准备好，可以进入。' },
        },
      },
    };
    controller.update(snapshot);
  },
};
`);

await new Promise((resolveBuild, rejectBuild) => {
  const compiler = webpack({
    mode: 'development',
    entry: join(directory, 'entry.ts'),
    output: { path: directory, filename: 'bundle.js' },
    resolve: { extensions: ['.ts', '.js'] },
    module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } }] },
    devtool: false,
  });
  compiler.run((error, stats) => compiler.close(() => {
    if (error || stats?.hasErrors()) rejectBuild(error || new Error(stats?.toString({ all: false, errors: true })));
    else resolveBuild();
  }));
});

const towerCss = sass.compile('src/tower/index.scss', { logger: { warn() {}, debug() {} } }).css;
fs.writeFileSync(join(directory, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${towerCss}\nhtml,body{margin:0;min-height:100%;background:#060817}body{padding:8px}#tower-root{width:100%}</style><main id="tower-root"></main><script>window.__towerRouteFixture=${fixtureJson};window.addEventListener('error',event=>window.fixtureError=event.message);</script><script src="bundle.js"></script></html>`);

const contentType = pathname => pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html';
const server = http.createServer((request, response) => {
  const relative = decodeURIComponent((request.url || '/index.html').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = join(directory, relative);
  if (!file.startsWith(directory) || !fs.existsSync(file)) { response.statusCode = 404; response.end(); return; }
  response.setHeader('Content-Type', contentType(relative));
  response.end(fs.readFileSync(file));
});
await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
const serverAddress = server.address();
assert.ok(serverAddress && typeof serverAddress !== 'string');

const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'profile')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { port = Number(fs.readFileSync(join(directory, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port) break; } catch { port = undefined; }
    await wait(100);
  }
  assert.ok(port, 'isolated Edge starts');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Edge exposes an isolated page target');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => { socket.once('open', resolveOpen); socket.once('error', rejectOpen); });
  let requestId = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(message.error);
    else waiter.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
    const id = ++requestId;
    pending.set(id, { resolve: resolveCall, reject: rejectCall });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const screenshot = async name => fs.writeFileSync(
    join(evidenceDirectory, `${name}.png`),
    Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'),
  );

  await call('Page.enable');
  await call('Runtime.enable');
  const evidence = [];
  for (const width of [390, 1000]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: `http://127.0.0.1:${serverAddress.port}/index.html` });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate('Boolean(window.towerRouteLock)')) break;
      await wait(100);
    }
    assert.equal(await evaluate('window.fixtureError || null'), null, 'the real tower fixture loads without browser errors');
    const generating = await evaluate(`(() => {
      const treasure = document.querySelector('[data-node-id="${route.treasure.id}"]');
      const rest = document.querySelector('[data-node-id="${route.rest.id}"]');
      const sigil = rest.querySelector('.tower-node-sigil');
      const phase = rest.querySelector('.tower-node-phase');
      return {
        treasureText: treasure.textContent,
        treasureCanEnter: treasure.classList.contains('can-enter'),
        restText: rest.textContent,
        restDisabled: rest.disabled,
        restCanEnter: rest.classList.contains('can-enter'),
        restClasses: rest.className,
        restAria: rest.getAttribute('aria-label'),
        restOpacity: getComputedStyle(rest).opacity,
        restFilter: getComputedStyle(rest).filter,
        restPhaseColor: getComputedStyle(phase).color,
        restSigilColor: getComputedStyle(sigil).color,
      };
    })()`);
    assert.match(generating.treasureText, /准备中/);
    assert.equal(generating.treasureCanEnter, false);
    assert.match(generating.restText, /已备好·路线未到/);
    assert.equal(generating.restDisabled, true);
    assert.equal(generating.restCanEnter, false);
    assert.match(generating.restClasses, /is-locked/);
    assert.match(generating.restAria, /当前不可达/);
    assert.equal(generating.restOpacity, '0.44');
    assert.notEqual(generating.restFilter, 'none');
    await evaluate(`document.querySelector('[data-node-id="${route.rest.id}"]').click()`);
    assert.equal(await evaluate('window.towerRouteLock.getSelections()'), 0, 'locked prepared rest must not dispatch selection');
    for(const phase of ['queued','generating','failed','ready']) {
      await evaluate('window.towerRouteLock.setRestPhase('+JSON.stringify(phase)+')');
      const visual=await evaluate(`(() => {const n=document.querySelector('[data-node-id="${route.rest.id}"]');const s=getComputedStyle(n.querySelector('.tower-node-sigil'));const o=n.querySelector('.tower-node-orbit');return {locked:n.classList.contains('is-locked'),shadow:s.boxShadow,animation:s.animationName,orbit:o?getComputedStyle(o).display:'none'};})()`);
      assert.equal(visual.locked,true);assert.equal(visual.shadow,'none');assert.equal(visual.animation,'none');assert.equal(visual.orbit,'none');
    }
    await screenshot(`route-lock-generating-${width}`);

    await evaluate('window.towerRouteLock.makeTreasureReady()');
    const ready = await evaluate(`(() => {
      const treasure = document.querySelector('[data-node-id="${route.treasure.id}"]');
      return { text: treasure.textContent, disabled: treasure.disabled, canEnter: treasure.classList.contains('can-enter') };
    })()`);
    assert.match(ready.text, /可进入/);
    assert.equal(ready.disabled, false);
    assert.equal(ready.canEnter, true);
    await evaluate(`document.querySelector('[data-node-id="${route.treasure.id}"]').click()`);
    assert.equal(await evaluate('window.towerRouteLock.getSelections()'), 1, 'ready immediate treasure dispatches exactly one selection');
    await screenshot(`route-lock-ready-${width}`);
    evidence.push({ width, route: { battleId: route.battle.id, treasureId: route.treasure.id, restId: route.rest.id }, generating, ready });
  }
  const resultPath = join(evidenceDirectory, 'result.json');
  fs.writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ directory, resultPath, screenshots: fs.readdirSync(evidenceDirectory).filter(file => file.endsWith('.png')), evidence }, null, 2));
} finally {
  socket?.terminate();
  if (edge.pid) spawn('taskkill', ['/pid', String(edge.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  await new Promise(resolveClose => server.close(resolveClose));
}