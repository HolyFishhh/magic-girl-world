import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTavernApi, getChat } from './lib/tavern-api.mjs';

// Historical live fixture, not a general five-opening acceptance gate.
const read = name => JSON.parse(readFileSync(`tmp/${name}`, 'utf8'));
const legacy = read('play70-reward-reloaded.json');
const canonical = read('play70-canonical-reloaded-140.json');
assert.equal(canonical.chatId, legacy.chatId);
assert.equal(canonical.swipeId, legacy.swipeId);
assert.equal(canonical.message, legacy.message);
assert.deepEqual(canonical.metadata, legacy.metadata);
const differences = [];
function diff(a,b,path='root') {
  if (Object.is(a,b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a),...Object.keys(b)])) diff(a[key],b[key],`${path}.${key}`);
  } else differences.push({path,legacy:a,canonical:b});
}
diff(legacy.root,canonical.root);
assert.deepEqual(differences,[{
  path:'root.stat_data.battle.design_context.lastBattle.hpRatio',
  legacy:0.9333333333333332,canonical:0.9333333333333333,
}], 'historical typed-value capture differs only at the independently diagnosed transport field');
const disk=await getChat(await createTavernApi('http://127.0.0.1:8012/'),'魔法少女世界 0.6.6.png',canonical.chatId);
assert.deepEqual(disk[1].variables[canonical.swipeId],canonical.root);
assert.equal(disk[1].mes,canonical.message);
assert.deepEqual(disk[0].chat_metadata,canonical.metadata);
console.log('PASS sample70: browser-internal JSON and current disk root/story/metadata exactly equal; no numeric tolerance, no save mutation. Historical typed-value capture retained as transport evidence. Not overall usability acceptance.');
