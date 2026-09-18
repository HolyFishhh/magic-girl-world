// Apply an explicitly reviewed local plan; never reimport an entire character.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createTavernApi,getCharacter,getChat,getSettings} from './lib/tavern-api.mjs';
import {assertWorldbookInstallScope} from './lib/worldbook-install-scope.mjs';

const planPath=process.argv[2];
assert.ok(planPath,'Usage: node scripts/install-tavern-worldbook-plan.mjs <reviewed-plan.json>');
const plan=JSON.parse(await readFile(resolve(planPath),'utf8'));
assert.equal(basename(plan.avatar),plan.avatar);
assert.ok(plan.avatar.endsWith('.png')&&!plan.avatar.includes('\\'));
assert.ok(plan.changes.length>0);
const plotFlag=process.argv.indexOf('--plot-content-comment');
const plotComment=plotFlag>=0?process.argv[plotFlag+1]:undefined;
if(plotFlag>=0) assert.ok(plotComment?.startsWith('[mvu_plot]'),'exact plot comment required');
assertWorldbookInstallScope(plan,{contentOnlyPlotComments:plotComment?[plotComment]:[]});
const api=await createTavernApi('http://127.0.0.1:8012/');
async function post(path,body){
  const response=await api.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.ok(response.ok,`${path}: HTTP ${response.status}`);
  const text=await response.text();
  return text==='OK'?{ok:true}:JSON.parse(text);
}
const readBook=()=>post('/api/worldinfo/get',{name:plan.name});
const before=await getCharacter(api,plan.avatar),settings=await getSettings(api);
assert.equal(before.data.extensions.world,plan.name);
assert.deepEqual(before.data.character_book,plan.beforeEmbedded,'stale embedded plan');
assert.deepEqual(await readBook(),plan.beforeLive,'stale linked plan');
const chat=before.chat?await getChat(api,plan.avatar,before.chat):null;
const backupDir=resolve('tmp/tavern-worldbook-backups',randomUUID());
await mkdir(backupDir,{recursive:true});
await writeFile(resolve(backupDir,'restore.json'),JSON.stringify({spec:'mwg.worldbook-backup/v1',createdAt:new Date().toISOString(),...plan}),{flag:'wx'});
// Recheck immediately before writing. Preserve every other character field.
assert.deepEqual((await getCharacter(api,plan.avatar)).data,before.data);
assert.deepEqual(await readBook(),plan.beforeLive);
await post('/api/worldinfo/edit',{name:plan.name,data:plan.live});
assert.deepEqual(await readBook(),plan.live,`linked readback failed; backup ${backupDir}`);
await post('/api/characters/merge-attributes',{avatar:plan.avatar,data:{character_book:plan.embedded}});
const after=await getCharacter(api,plan.avatar);
assert.deepEqual(after.data,{...before.data,character_book:plan.embedded},`character readback failed; backup ${backupDir}`);
assert.equal(after.chat,before.chat);
if(before.chat) assert.deepEqual(await getChat(api,plan.avatar,before.chat),chat);
assert.deepEqual(await getSettings(api),settings,'settings changed during installation');
console.log(JSON.stringify({installed:true,backupDir,entries:plan.changes.map(x=>x.id),unrelatedCharacterDataUnchanged:true,settingsUnchanged:true,selectedChatUnchanged:true}));
