import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTavernApi,getChat} from './lib/tavern-api.mjs';
const api=await createTavernApi('http://127.0.0.1:8012/');
const results=await Promise.all([69,71,72].map(async sample=>{
  const snapshot=JSON.parse(readFileSync(`tmp/initial${sample}-final-browser-v128.json`,'utf8'));
  const disk=await getChat(api,'魔法少女世界 0.6.6.png',snapshot.chatId);
  try {
    assert.deepEqual(disk[1].variables[snapshot.swipeId],snapshot.root);
    assert.equal(disk[1].mes,snapshot.message);
    assert.deepEqual(disk[0].chat_metadata,snapshot.metadata);
    return {sample,exactPersistence:true};
  } catch {
    // A mismatch is evidence to investigate, not permission to overwrite data
    // or dump an entire private save into terminal output.
    return {sample,exactPersistence:false};
  }
}));
console.log(JSON.stringify({results,note:'Read-only historical final snapshot vs current disk; does not turn failed generation into success.'},null,2));
assert.ok(results.every(result=>result.exactPersistence),'At least one snapshot differs; inspect scoped paths before any acceptance claim.');
