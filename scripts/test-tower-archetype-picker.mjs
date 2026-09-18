import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as sass from 'sass';
import webpack from 'webpack';
fs.mkdirSync('tmp/tower-archetype-picker-e2e', {recursive:true});
await new Promise((ok, fail) => webpack({mode:'development',devtool:false,entry:resolve('scripts/fixtures/tower-archetype-picker.ts'),output:{path:resolve('tmp/tower-archetype-picker-e2e'),filename:'picker.js'},resolve:{extensions:['.ts','.js']},module:{rules:[{test:/\.ts$/,loader:'ts-loader',options:{transpileOnly:true,compilerOptions:{module:'esnext'}}},{test:/\.scss$/,type:'asset/source'}]}}, (error,stats)=>error||stats.hasErrors()?fail(error||Error(stats.toString({all:false,errors:true}))):ok()));
const delay = ms => new Promise(ok => setTimeout(ok, ms));
const shared = sass.compile('src/shared/towerArchetypePicker.scss', { logger: sass.Logger.silent }).css;
for (const surface of ['common', 'start']) {
  const css = sass.compile(`src/${surface}/index.scss`, { logger: sass.Logger.silent }).css + shared;
  const html = fs.readFileSync(`src/${surface}/index.html`, 'utf8').replace('</head>', `<style>${css} body{background:#15162b;margin:0} [hidden]{display:none!important}</style></head>`)
    .replace('</body>', `<script src="picker.js"></script><script>mountPicker('${surface}');</script></body>`);
  fs.writeFileSync(`tmp/tower-archetype-picker-e2e/archetype-${surface}.html`, html);
}
const browser = spawn(process.env.MWG_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=9339',
  `--user-data-dir=${resolve('tmp/tower-archetype-picker-e2e/browser-profile')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let ws;
const reports = [];
try {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9339/json')).json(); if (targets.length) break; } catch {} await delay(100); }
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let seq = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const [ok, fail] = pending.get(m.id); pending.delete(m.id); m.error ? fail(m.error) : m.result?.exceptionDetails ? fail(m.result.exceptionDetails) : ok(m.result); } else if (m.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(m.params)); };
  const cmd = (method, params = {}) => new Promise((ok, fail) => { const id = ++seq; pending.set(id, [ok, fail]); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expression => (await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await cmd('Page.enable');
  await cmd('Runtime.enable');
  for (const surface of ['common', 'start']) for (const width of [1000, 390]) {
    await cmd('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cmd('Page.navigate', { url: pathToFileURL(resolve(`tmp/tower-archetype-picker-e2e/archetype-${surface}.html`)).href });
    for (let ready = 0; ready < 40; ready++) {
      if (await ev('typeof pickerTest !== "undefined"')) break;
      await delay(100);
    }
    if (!await ev('typeof pickerTest !== "undefined"')) throw Error(JSON.stringify(await ev('({url:location.href,ready:document.readyState,title:document.title,text:document.body.innerText.slice(0,500),scripts:[...document.scripts].map(s=>s.src)})')));
    const initial = await ev(`(()=>{const {host,target,presets}=pickerTest; return {count:host.querySelectorAll('[data-archetype-id]').length,total:presets.length,expected:presets.filter(p=>p.category===host.querySelector('[data-archetype-category]').value).length,value:target.value}})()`);
    assert.equal(initial.count, initial.expected);
    assert.ok(initial.count > 0 && initial.count < initial.total, 'initial view shows only one first-level category');
    const checks = await ev(`(()=>{
      const {host,target,presets}=pickerTest;
      const check=(ok,message)=>{if(!ok)throw Error(message)};
      const input=(node,value,type='input')=>{node.value=value;node.dispatchEvent(new Event(type,{bubbles:true}))};
      input(target,'保留我的自定义补充\\n世界和角色自由发挥');
      const search=host.querySelector('[data-archetype-search]'),category=host.querySelector('[data-archetype-category]');
      let browsed=0;
      for(const option of category.options){input(category,option.value,'change');const shown=[...host.querySelectorAll('[data-archetype-id]')];check(shown.every(button=>presets.find(p=>p.id===button.dataset.archetypeId).category===option.value),'second-level category membership');browsed+=shown.length;}
      check(browsed===presets.length,'all second-level choices accessible without flattening');
      input(search,'自爆');
      check(host.querySelectorAll('[data-archetype-id]').length>0,'self-destruct discoverable');
      check(target.value==='保留我的自定义补充\\n世界和角色自由发挥','browsing must not change prompt');
      const button=host.querySelector('[data-archetype-id]');button.focus();button.click();
      check(document.activeElement?.dataset?.archetypeId===button.dataset.archetypeId,'selection retains keyboard focus after rerender');
      check([...host.querySelectorAll('[data-archetype-id]')].find(item=>item.dataset.archetypeId===button.dataset.archetypeId).getAttribute('aria-pressed')==='true','selected state');
      check(target.value==='保留我的自定义补充\\n世界和角色自由发挥','selection must not rewrite free card input');
      const chosen=target.value; const payload=JSON.parse(pickerTest.message().split('\\n')[1]);
      check(payload.card===chosen&&payload.selected_mechanics.includes('自爆'),'mechanics handoff is separate from card input');
      input(search,'没有这个玩法关键词XYZ');check(host.querySelectorAll('[data-archetype-id]').length===0,'empty search');
      check(target.value===chosen,'filtering selected card must not clear selection');
      input(search,'');input(category,presets[0].category,'change');
      check(host.querySelectorAll('[data-archetype-id]').length===presets.filter(p=>p.category===category.value).length,'category coverage');
      host.querySelector('[data-archetype-id]').click();
      check(target.value===chosen&&pickerTest.selected().length>=2,'second selection stays independent of card input');
      const manager=host.querySelector('[data-archetype-selected]');manager.click();check(manager.getAttribute('aria-expanded')==='true'&&host.querySelectorAll('[data-archetype-detail] button').length>=2&&host.querySelector('[data-archetype-detail]').textContent.includes('：'),'selected menu exposes each chosen mechanism and its explanation');
      host.querySelector('[data-archetype-detail] button').click();check(pickerTest.selected().length===1&&manager.getAttribute('aria-expanded')==='true'&&!host.querySelector('[data-archetype-detail]').hidden,'selected menu remains open after removal');
      host.querySelector('[data-archetype-clear]').click();
      check(target.value==='保留我的自定义补充\\n世界和角色自由发挥'&&pickerTest.selected().length===0,'clear preserves free input');
      input(category,'summons','change');input(search,'自爆');host.querySelector('[data-archetype-id]').click();
      target.disabled=true;host.querySelector('[data-archetype-clear]').click();check(pickerTest.selected().length===1,'disabled field cannot be edited');target.disabled=false;
      host.scrollIntoView({block:'start'});
      return {selected:host.querySelector('[data-archetype-selected]').textContent,count:presets.length,hierarchicalBrowse:browsed,overflow:document.documentElement.scrollWidth>innerWidth,host:host.getBoundingClientRect().toJSON()};
    })()`);
    assert.equal(checks.overflow, false, `${surface} ${width} horizontal overflow`);
    if (surface === 'common') {
      const save = await ev(`(()=>{const {target,data}=pickerTest;document.querySelector('#tower-preset-name').value='自爆与自由补充';document.querySelector('#tower-preset-save').click();const original=target.value;target.value='临时修改';document.querySelector('#tower-preset-select').value='0';document.querySelector('#tower-preset-load').click();if(target.value!==original)throw Error('named preset restore');if(!document.querySelector('[data-archetype-selected]').textContent.includes('自爆'))throw Error('picker restore');return {saved:[...data.values()][0],original}})()`);
      await cmd('Page.navigate', { url: `${pathToFileURL(resolve('tmp/tower-archetype-picker-e2e/archetype-common.html')).href}#${encodeURIComponent(save.saved)}` }); await delay(350);
      const restored = await ev(`({value:pickerTest.target.value,selected:document.querySelector('[data-archetype-selected]').textContent})`);
      assert.equal(restored.value, save.original); assert.match(restored.selected, /自爆/);
      await ev(`document.querySelector('[data-archetype-search]').value='自爆';document.querySelector('[data-archetype-search]').dispatchEvent(new Event('input'));document.querySelector('.tower-archetype-picker').scrollIntoView({block:'start'})`);
    }
    const screenshot = await cmd('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`tmp/tower-archetype-picker-e2e/archetype-${surface}-${width}.png`, Buffer.from(screenshot.data, 'base64'));
    reports.push({ surface, width, ...checks, selectionSwitchClear: true, promptHandoff: true, namedSaveRestore: surface === 'common' });
    console.log(JSON.stringify(reports.at(-1)));
  }
  fs.writeFileSync('tmp/tower-archetype-picker-e2e/archetype-ui-report.json', JSON.stringify(reports, null, 2));
} finally { ws?.close(); browser.kill(); }
