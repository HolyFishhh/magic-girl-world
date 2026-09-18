// Reversible local development install through Tavern's character API.
// Only our runtime, four existing UI shells and exact character-scoped legacy
// shell recovery are updated. Global regexes/settings remain read-only.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createTavernApi, getCharacter, getChat, getSettings } from './lib/tavern-api.mjs';
import { planScopedFishShellCompatibility } from './lib/tavern-runtime-shell-compat.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const flatten = trees => trees.flatMap(tree => tree.type === 'folder' ? flatten(tree.scripts || []) : [tree]);
export function planRuntimeInstall(character, runtime, manifest, shells, {globalRegex=[]}={}) {
  assert.equal(character?.data?.extensions?.magic_girl_world?.design_assistant_scope, 'mwg.design-assistant-card/v1');
  assert.equal(manifest.spec, 'mwg.tavern-runtime/v1');
  assert.equal(manifest.cardVersion, character.data.extensions.magic_girl_world.card_version, 'do not silently upgrade card version');
  assert.equal(Buffer.byteLength(runtime), manifest.runtimeBytes);
  new vm.Script(runtime);
  const data = structuredClone(character.data);
  const scripts = flatten(data.extensions.tavern_helper.scripts);
  const matches = scripts.filter(script => script.name === '魔法少女世界运行时');
  assert.equal(matches.length, 1, 'exactly one existing character runtime is required');
  assert.equal(matches[0].id, `magic-girl-world-runtime-${manifest.cardVersion.replace(/[^a-z0-9]+/gi, '-')}`);
  matches[0].content = runtime;
  assert.equal(shells.length, 4);
  assert.deepEqual(new Set(shells.map(shell => shell.scriptName)), new Set(['开始模块', '变量更新展示', '通用模块', '战斗模块']));
  for (const shell of shells) {
    const targets = data.extensions.regex_scripts.filter(entry => entry.scriptName === shell.scriptName);
    assert.equal(targets.length, 1, `ambiguous or missing existing UI shell: ${shell.scriptName}`);
    assert.ok(shell.findRegex && shell.replaceString);
    Object.assign(targets[0], shell, { id: targets[0].id, disabled: targets[0].disabled });
    if (targets[0].disabled === undefined) delete targets[0].disabled;
  }
  const compat=planScopedFishShellCompatibility(data,globalRegex);
  data.extensions.regex_scripts=compat.regexScripts;
  return { data, runtimeId: matches[0].id, scopedShellCompatibility:compat.compatibility };
}

async function install() {
  const args = process.argv.slice(2);
  const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const avatar = value('--avatar');
  const source = value('--source');
  assert.ok(avatar && source, 'Usage: node scripts/install-tavern-character-runtime.mjs --source <isolated build root> --avatar <exact.png> [--url http://127.0.0.1:8012/]');
  assert.equal(basename(avatar), avatar); assert.ok(avatar.endsWith('.png') && !avatar.includes('\\'));
  const url = new URL(value('--url') || 'http://127.0.0.1:8012/');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'development install is loopback-only');
  const api = await createTavernApi(url);
  const before = await getCharacter(api, avatar);
  const settingsBefore=await getSettings(api);
  const globalRegex=settingsBefore.extension_settings?.regex||[];
  const runtime = await readFile(resolve(source, 'tavern/character-runtime.js'), 'utf8');
  const manifest = JSON.parse(await readFile(resolve(source, 'tavern/character-runtime-manifest.json'), 'utf8'));
  const shells = await Promise.all(['start','common','fish','update'].map(async view => JSON.parse(await readFile(resolve(source, `tavern/${view}-interface.json`), 'utf8'))));
  const plan = planRuntimeInstall(before, runtime, manifest, shells,{globalRegex});
  const chatBefore = before.chat ? hash(await getChat(api, avatar, before.chat)) : null;
  const backupDir = resolve('tmp/tavern-runtime-backups', randomUUID());
  await mkdir(backupDir, { recursive: true });
  const backup = { spec:'mwg.local-runtime-backup/v1', avatar, tavernUrl:url.href, beforeData:before.data,
    nextData:plan.data, runtimeSha256:hash(runtime), createdAt:new Date().toISOString() };
  await writeFile(resolve(backupDir, 'restore.json'), JSON.stringify(backup, null, 2));
  const current = await getCharacter(api, avatar);
  assert.equal(hash(current.data), hash(before.data), 'character changed during install preparation; refusing stale write');
  assert.equal(current.chat, before.chat, 'selected chat changed during preparation');
  assert.equal(hash((await getSettings(api)).extension_settings?.regex||[]),hash(globalRegex),
    'global regex changed during preparation; refusing stale scoped compatibility');
  const response = await api.request('/api/characters/merge-attributes', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ avatar, data:{ extensions:{ tavern_helper:{scripts:plan.data.extensions.tavern_helper.scripts}, regex_scripts:plan.data.extensions.regex_scripts } } }),
  });
  assert.ok(response.ok, `runtime update failed: HTTP ${response.status}; backup: ${backupDir}`);
  const after = await getCharacter(api, avatar);
  assert.equal(hash(after.data), hash(plan.data), `character readback differs; do not continue until examined; backup: ${backupDir}`);
  assert.equal(after.chat, before.chat);
  if (before.chat) assert.equal(hash(await getChat(api, avatar, before.chat)), chatBefore, 'install must not rewrite the selected chat');
  assert.equal(hash((await getSettings(api)).extension_settings?.regex||[]),hash(globalRegex),'global regexes must remain unchanged');
  console.log(JSON.stringify({installed:true, avatar, runtimeId:plan.runtimeId, runtimeSha256:hash(runtime), runtimeBytes:manifest.runtimeBytes,
    selectedChatUnchanged:true, unrelatedCharacterDataUnchanged:true, globalRegexUnchanged:true,
    scopedShellCompatibility:plan.scopedShellCompatibility,backupDir,
    note:'Reload the Tavern page once to refresh its in-memory character script store. No preset, MVU script, worldbook, version, or chat was replaced.'}, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await install();
