import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import webpack from 'webpack';
import WebSocket from 'ws';

const root = resolve('.');
const workspaceTmp = resolve(root, 'tmp');
const fixtureRoot = resolve(workspaceTmp, `floating-orb-browser-runtime-${process.pid}`);
const evidencePath = resolve('tmp/floating-orb-browser-evidence.json');
const screenshotPath = resolve('tmp/floating-orb-browser.png');
const port = 18231;
const browserProfile = resolve(workspaceTmp, `floating-orb-browser-profile-${process.pid}`);
const browserPath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function assertWorkspaceTmpChild(candidate, label) {
  const absolute = resolve(candidate);
  const relativePath = relative(workspaceTmp, absolute);
  assert.ok(
    relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath),
    `${label} must be an absolute child of this workspace tmp directory: ${absolute}`,
  );
  return absolute;
}

async function removeOwnedWorkspaceTmpDirectory(candidate, label) {
  const absolute = assertWorkspaceTmpChild(candidate, label);
  await rm(absolute, { recursive: true, force: true });
}

async function bundleRuntime() {
  // This only removes the unique fixture directory after its absolute path has
  // been verified to be below this workspace's tmp directory.
  await removeOwnedWorkspaceTmpDirectory(fixtureRoot, 'browser fixture directory');
  await mkdir(fixtureRoot, { recursive: true });
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack({
      mode: 'production', target: ['web', 'es2022'], entry: resolve(root, 'src/runtime/characterRuntime.ts'),
      output: { path: fixtureRoot, filename: 'runtime.js', iife: true },
      module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } }] },
      resolve: { extensions: ['.ts', '.js'] },
      plugins: [new webpack.DefinePlugin({
        __MWG_VIEW_ASSETS__: '{}',
        __MWG_BUILD_INFO__: JSON.stringify({ cardVersion: 'orb-browser-test', views: {} }),
      })],
      optimization: { minimize: false, splitChunks: false, runtimeChunk: false },
      devtool: false, performance: { hints: false },
    });
    compiler.run((error, stats) => compiler.close(closeError => {
      if (error || closeError || stats?.hasErrors()) reject(error || closeError || new Error(stats.toString({ all: false, errors: true })));
      else resolveBuild();
    }));
  });
  return readFile(resolve(fixtureRoot, 'runtime.js'), 'utf8');
}

const runtimeSource = await bundleRuntime();
const setup = `
  localStorage.setItem('mwg:settings-center:v2', JSON.stringify({ orbPosition: { x: 960, y: 900 } }));
  const listeners = new Map();
  const visualState = { width: null, height: null, offsetLeft: 0, offsetTop: 0 };
  const visual = {
    get width() { return visualState.width ?? window.innerWidth; },
    get height() { return visualState.height ?? window.innerHeight; },
    get offsetLeft() { return visualState.offsetLeft; },
    get offsetTop() { return visualState.offsetTop; },
    addEventListener(type, listener) { const set = listeners.get(type) || new Set(); set.add(listener); listeners.set(type, set); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  window.__setOrbVisualViewport = values => {
    Object.assign(visualState, values);
    for (const type of ['resize', 'scroll']) for (const listener of listeners.get(type) || []) listener(new Event(type));
  };
  window.__orbVisualListenerCount = () => [...listeners.values()].reduce((total, set) => total + set.size, 0);
  window.initializeGlobal = (name, value) => { window[name] = value; };
  window.eventOn = () => undefined;
  window.eventRemoveListener = () => undefined;
  window.SillyTavern = { extensionSettings: {} };
`;
await writeFile(resolve(fixtureRoot, 'index.html'), `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><script>${setup}</script><script>eval(new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(runtimeSource).toString('base64')}'), byte => byte.charCodeAt(0))))</script></body>`, 'utf8');

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${browserProfile}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws;
const evidence = { browser: 'Microsoft Edge headless via CDP', visualViewportMode: 'Native scale probe plus controlled VisualViewport facade for deterministic offset/scroll events', sizes: [], visualViewport: null, drag: null, cleanup: null, fixedProbe: null };
try {
  let targets;
  for (let index = 0; index < 100; index += 1) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.ok(targets?.length, 'isolated browser must start');
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => { ws.once('open', resolveOpen); ws.once('error', rejectOpen); });
  let sequence = 0;
  const pending = new Map();
  ws.on('message', raw => { const message = JSON.parse(raw); if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request?.reject(message.error) : request?.resolve(message.result); } });
  const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => { const id = ++sequence; pending.set(id, { resolve: resolveCall, reject: rejectCall }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  await call('Page.enable'); await call('Runtime.enable');
  const setSize = async width => {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    // CDP acknowledges the dimensions before the browser dispatches resize.
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  };
  await setSize(1000);
  await call('Page.navigate', { url: 'data:text/html,<div id=probe style=\"position:fixed;left:137px;top:0;width:1px;height:1px\"></div>' });
  await new Promise(resolveWait => setTimeout(resolveWait, 50));
  await call('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
  await new Promise(resolveWait => setTimeout(resolveWait, 50));
  evidence.fixedProbe = await evaluate(`(()=>{const rect=document.getElementById('probe').getBoundingClientRect(), vv=visualViewport; return {cssLeft:137,rectLeft:rect.left,visualViewportWidth:vv.width,visualViewportOffsetLeft:vv.offsetLeft,visualViewportScale:vv.scale};})()`);
  assert.equal(Math.round(evidence.fixedProbe.rectLeft), evidence.fixedProbe.cssLeft, 'native fixed left coordinates must stay in layout-viewport coordinates under page scale');
  assert.ok(evidence.fixedProbe.visualViewportWidth < 1000, 'native page scale must reduce the visual viewport');
  await call('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await call('Page.navigate', { url: `file:///${resolve(fixtureRoot, 'index.html').replaceAll('\\', '/')}` });
  await new Promise(resolveWait => setTimeout(resolveWait, 500));

  const readOrb = () => evaluate(`(()=>{const root=document.getElementById('mwg-mvu-monitor'), orb=root?.querySelector('.mwg-tool-orb'), rect=orb?.getBoundingClientRect(), vv=visualViewport; return {root:!!root, rect:rect&&{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}, style:{left:root?.style.left,top:root?.style.top}, vv:{left:vv.offsetLeft,top:vv.offsetTop,width:vv.width,height:vv.height}, listeners:__orbVisualListenerCount()};})()`);
  const assertVisible = (snapshot, label) => {
    assert.ok(snapshot.root && snapshot.rect, `${label}: orb must exist`);
    assert.ok(snapshot.rect.left >= snapshot.vv.left + 7 && snapshot.rect.right <= snapshot.vv.left + snapshot.vv.width + 1, `${label}: horizontal bounds ${JSON.stringify(snapshot)}`);
    assert.ok(snapshot.rect.top >= snapshot.vv.top + 7 && snapshot.rect.bottom <= snapshot.vv.top + snapshot.vv.height + 1, `${label}: vertical bounds ${JSON.stringify(snapshot)}`);
  };

  let snapshot = await readOrb();
  assertVisible(snapshot, '1000px restored coordinate');
  assert.equal(Math.round(snapshot.rect.left), 942); assert.equal(Math.round(snapshot.rect.top), 742);
  evidence.sizes.push({ width: 1000, ...snapshot });

  for (const width of [390, 540]) {
    await setSize(width);
    snapshot = await readOrb();
    assertVisible(snapshot, `${width}px resize`);
    evidence.sizes.push({ width, ...snapshot });
  }
  assert.equal(Math.round(evidence.sizes[1].rect.left), 336, '1000→390 must re-clamp the old position using the mobile orb size');
  assert.equal(Math.round(evidence.sizes[2].rect.left), 336, '390→540 must preserve the reachable position');

  await evaluate(`__setOrbVisualViewport({width:390,height:500,offsetLeft:400,offsetTop:80})`);
  snapshot = await readOrb();
  assertVisible(snapshot, 'shifted visual viewport');
  assert.equal(Math.round(snapshot.rect.left), 408, 'visual viewport offset must move an unreachable coordinate into its visible layout range');
  assert.equal(Math.round(snapshot.rect.top), 522, 'keyboard-height visual viewport must clamp vertically');
  const shifted = snapshot;
  await evaluate(`__setOrbVisualViewport({width:540,height:800,offsetLeft:0,offsetTop:0})`);
  snapshot = await readOrb();
  assertVisible(snapshot, 'restored visual viewport');
  evidence.visualViewport = { shifted, restored: snapshot };

  const rect = snapshot.rect;
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.left + 25, y: rect.top + 25, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 535, y: 795, button: 'left' });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 535, y: 795, button: 'left', clickCount: 1 });
  await new Promise(resolveWait => setTimeout(resolveWait, 50));
  snapshot = await readOrb();
  assertVisible(snapshot, 'real pointer drag');
  assert.equal(Math.round(snapshot.rect.left), 482); assert.equal(Math.round(snapshot.rect.top), 742);
  evidence.drag = snapshot;
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));

  await setSize(390);
  await evaluate(`__setOrbVisualViewport({width:390,height:800,offsetLeft:0,offsetTop:0});
    document.body.style.color='#eee';
    MagicGirlWorldMvuMonitor.begin({generationId:'browser-encounter'});
    MagicGirlWorldMvuMonitor.complete("<UpdateVariable>_.set('status.time', '战后');</UpdateVariable>",'browser-encounter');
    MagicGirlWorldMvuMonitor.success('browser-encounter');
    window.__completedSnapshot=JSON.stringify(MagicGirlWorldMvuMonitor.getSnapshot());
    MagicGirlWorldMvuMonitor.complete('【战斗结果】胜利。请根据摘要续写剧情。');
    MagicGirlWorldMvuMonitor.stream('迟到的正文');
    MagicGirlWorldMvuMonitor.reasoning('迟到的分析');`);
  assert.equal(await evaluate('JSON.stringify(MagicGirlWorldMvuMonitor.getSnapshot())===__completedSnapshot'), true,
    'bundled runtime ignores late user battle summaries after success');
  await evaluate('MagicGirlWorldMvuMonitor.openProgress()');
  evidence.diagnostics = await evaluate(`(()=>{const p=document.querySelector('.mwg-mvu-panel'), r=p.getBoundingClientRect(),
    text=document.querySelector('[data-mwg-diagnostic-feedback]');return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
    color:getComputedStyle(text).color,font:getComputedStyle(text).fontSize,phase:MagicGirlWorldMvuMonitor.getSnapshot().phase}})()`);
  assert.ok(evidence.diagnostics.left>=0 && evidence.diagnostics.right<=390 && evidence.diagnostics.bottom<=800);
  assert.equal(evidence.diagnostics.color,'rgb(113, 91, 101)', 'diagnostics must remain readable over a light panel in dark Tavern themes');
  assert.equal(evidence.diagnostics.phase,'success');
  await writeFile(resolve('tmp/story-ui-diagnostic-390.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));

  assert.equal(snapshot.listeners, 2, 'runtime must register exactly visualViewport resize and scroll listeners');
  await evaluate(`window.__MAGIC_GIRL_WORLD_CHARACTER_RUNTIME__.destroy()`);
  const cleanup = await evaluate(`({root:!!document.getElementById('mwg-mvu-monitor'),listeners:__orbVisualListenerCount()})`);
  assert.equal(cleanup.root, false); assert.equal(cleanup.listeners, 0, 'destroy must remove visualViewport listeners');
  evidence.cleanup = cleanup;
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  ws?.close();
  if (!child.killed) {
    await new Promise(resolveExit => {
      child.once('exit', resolveExit);
      child.kill();
      setTimeout(resolveExit, 1_000);
    });
  }
  await removeOwnedWorkspaceTmpDirectory(fixtureRoot, 'browser fixture directory');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // Never remove a browser profile unless its absolute path is verified as
      // this test's unique child directory under the current workspace tmp.
      await removeOwnedWorkspaceTmpDirectory(browserProfile, 'browser test profile directory');
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 250));
    }
  }
}
