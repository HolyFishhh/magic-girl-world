import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { summarizeBattleSnapshot, summarizeMvuBattle } from './lib/battle-snapshot-report.mjs';
import { createTavernApi, getChat, saveChat } from './lib/tavern-api.mjs';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const [action = 'inspect', avatarUrl, chatFile, rawMessageId = '1'] = process.argv.slice(2);
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
const messageId = Number(rawMessageId);

if (!['inspect', 'corrupt', 'clear'].includes(action)) {
  throw new Error('Action must be inspect, corrupt, or clear');
}
if (!avatarUrl?.endsWith('.png') || !chatFile || !Number.isInteger(messageId) || messageId < 0) {
  throw new Error('Usage: node scripts/test-real-tavern-corrupt-snapshot.mjs <action> <avatar.png> <chat-file> [message-id]');
}

const api = await createTavernApi(tavernUrl);
const chat = await getChat(api, avatarUrl, chatFile);
const target = chat[messageId + 1];
if (!target || typeof target !== 'object') throw new Error(`Message ${messageId} does not exist`);

const variableLayers = Array.isArray(target.variables) ? target.variables : [target.variables];
const variableLayer = variableLayers.find(layer => layer?.__magic_girl_world?.battle_session);
const namespace = variableLayer?.__magic_girl_world;
const snapshot = namespace?.battle_session;
const mvuLayer = variableLayers.find(layer => layer?.stat_data?.battle);
const run = mvuLayer?.stat_data?.run;
const report = {
  messageId,
  marker: String(target.mes || '').split('\n', 1)[0],
  variableLayers: variableLayers.length,
  hasSnapshot: Boolean(snapshot),
  mvuBattle: summarizeMvuBattle(mvuLayer?.stat_data?.battle),
  run: run
    ? {
        phase: run.phase,
        act: run.act,
        floor: run.floor,
        gold: run.gold,
        currentNodeId: run.currentNode?.id ?? null,
        choiceIds: Array.isArray(run.choices) ? run.choices.map(choice => choice?.id) : null,
      }
    : null,
  ...summarizeBattleSnapshot(snapshot),
};

if (action === 'inspect') {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (!snapshot) throw new Error(`Message ${messageId} has no battle snapshot to ${action}`);

  if (action === 'corrupt') {
    snapshot.state.player.currentHp = 'corrupt-snapshot-hp';
  } else {
    delete namespace.battle_session;
    if (Object.keys(namespace).length === 0) delete variableLayer.__magic_girl_world;
  }

  await saveChat(api, {
    ch_name: target.name || avatarUrl.replace(/\.png$/i, ''),
    avatar_url: avatarUrl,
    file_name: chatFile,
    chat,
    force: true,
  });
  console.log(JSON.stringify({ ...report, action }, null, 2));
}
