import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import WebSocket from 'ws';

// Isolated real browser DOM, not the player's page. Only the navigation and
// scroll modules execute; Fish coordinator initialization is simulated by
// removing its actual HTML aria-busy gate, not running game/save/model code.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'tmp/navigation-focus-lifecycle');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(resolve(out, 'browser-'));
const browserPath = process.env.MWG_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert.ok(existsSync(browserPath), 'Set MWG_TEST_BROWSER to an installed Chromium browser; no install is performed');
const compile = file => ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
}).outputText;
const navigation = compile('src/runtime/navigationFocus.ts');
const scrolling = compile('src/common/userNavigationScroll.ts');
const html = readFileSync(resolve(root, 'src/fish/index.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '');
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws;
let launchError;
browser.on('error', error => { launchError = error; });
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  let port;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    const portFile = resolve(profile, 'DevToolsActivePort');
    if (existsSync(portFile)) { port = Number(readFileSync(portFile, 'utf8').split('\n')[0]); break; }
    await delay(100);
  }
  assert.ok(port, 'isolated browser starts within ten seconds');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0;
  const pending = new Map();
  ws.on('message', raw => {
    const result = JSON.parse(raw);
    const entry = pending.get(result.id);
    if (!entry) return;
    clearTimeout(entry.timer); pending.delete(result.id);
    result.error ? entry.reject(Error(JSON.stringify(result.error))) : entry.resolve(result.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params }));
  });
  await call('Page.enable');
  const evidence = [];
  for (const width of [390, 1000]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const tree = await call('Page.getFrameTree');
    await call('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html });
    const result = await call('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const check = (value, message) => { if (!value) throw Error(message); };
      const load = () => {
        const scroll = { exports: {} };
        new Function('module', 'exports', ${JSON.stringify(scrolling)})(scroll, scroll.exports);
        const nav = { exports: {} };
        new Function('require', 'module', 'exports', ${JSON.stringify(navigation)})(
          name => { check(name === '../common/userNavigationScroll', 'unexpected import'); return scroll.exports; }, nav, nav.exports);
        return nav.exports;
      };
      const common = load(), fish = load();
      check(common !== fish && common.requestNavigationFocus !== fish.requestNavigationFocus, 'modules must be independent instances');
      const stage = document.querySelector('#battle-stage');
      const scene = document.querySelector('#battle-scene');
      check(stage && scene && scene.contains(stage), 'real fish HTML stage/scene required');
      check(scene.getAttribute('aria-busy') === 'true', 'real initial loading gate required');
      let focuses = 0;
      const stageFocus = stage.focus.bind(stage);
      stage.focus = options => { focuses++; check(options?.preventScroll === true, 'focus must prevent duplicate scrolling'); stageFocus(options); };
      const steps = [];
      const blocked = reason => {
        check(fish.applyNavigationFocus() === false, reason + ' must not consume intent');
        check(focuses === 0, reason + ' must not focus'); steps.push(reason);
      };
      common.requestNavigationFocus('#battle-stage');
      const parent = stage.parentNode, next = stage.nextSibling;
      stage.remove(); blocked('missing'); parent.insertBefore(stage, next);
      scene.removeAttribute('aria-busy');
      scene.hidden = true; blocked('hidden ancestor'); scene.hidden = false;
      stage.style.display = 'none'; blocked('display:none'); stage.style.display = '';
      scene.inert = true; blocked('inert ancestor'); scene.inert = false;
      scene.setAttribute('aria-busy', 'true'); blocked('loading ancestor'); scene.removeAttribute('aria-busy');
      stage.setAttribute('aria-busy', 'true'); blocked('loading target'); stage.removeAttribute('aria-busy');
      check(stage.getClientRects().length > 0, 'stage becomes laid out');
      check(fish.applyNavigationFocus() === true, 'fish consumes common intent when ready');
      check(document.activeElement === stage && focuses === 1, 'exactly one actual stage focus: active=' + document.activeElement?.id + ', focuses=' + focuses + ', stage=' + stage.outerHTML.slice(0,250));
      check(stage.getAttribute('tabindex') === '-1', 'stage becomes programmatically focusable');
      for (let i = 0; i < 5; i++) {
        check(common.applyNavigationFocus() === false && fish.applyNavigationFocus() === false, 'passive apply must not repeat');
      }
      check(focuses === 1, 'passive renders leave focus count unchanged');
      const newer = document.createElement('button'); newer.id = 'new-navigation'; newer.textContent = 'new destination';
      newer.setAttribute('tabindex', '0'); document.body.append(newer);
      let newerFocuses = 0; const newerFocus = newer.focus.bind(newer);
      newer.focus = options => { newerFocuses++; newerFocus(options); };
      common.requestNavigationFocus('#missing-old-destination');
      fish.requestNavigationFocus('#new-navigation');
      check(common.applyNavigationFocus() === true, 'later request overwrites unresolved older request across module instances');
      check(document.activeElement === newer && newerFocuses === 1, 'newer destination wins');
      check(newer.getAttribute('tabindex') === '0', 'existing tabindex preserved');
      const old = document.createElement('button'); old.id = 'missing-old-destination'; document.body.append(old);
      check(fish.applyNavigationFocus() === false && document.activeElement === newer, 'superseded intent never revives');
      check(focuses === 1, 'old stage not refocused');
      return { blocked: steps, independentModules: true, stageFocuses: focuses, passiveApplyCalls: 10,
        newerFocuses, supersededIntentDiscarded: true, width: innerWidth };
    })()` });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    evidence.push(result.result.value);
    const image = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(out, `lifecycle-${width}.png`), Buffer.from(image.data, 'base64'));
  }
  const report = { passed: true, mode: 'isolated Chromium, real fish/index.html DOM and separately transpiled production modules',
    limitations: 'No production SCSS or coordinator execution; initialization readiness transition simulated. Same-global module instances only, not cross-window globals. Screenshots are DOM evidence, not game visual acceptance.', evidence };
  writeFileSync(resolve(out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { ws?.terminate(); browser.kill(); }


