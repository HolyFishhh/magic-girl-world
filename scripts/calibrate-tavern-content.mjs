import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createTavernApi, getChat } from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { createContentPackFromMvuBattle } = require(resolve('src/runtime/contentPackAdapter.ts'));

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const [avatarUrl, chatFile, requestedMessageId] = process.argv.slice(2);
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);

if (!avatarUrl?.endsWith('.png') || !chatFile) {
  throw new Error('Usage: node scripts/calibrate-tavern-content.mjs <avatar.png> <chat-file> [message-id]');
}

const api = await createTavernApi(tavernUrl);
const chat = await getChat(api, avatarUrl, chatFile);

function layersFor(message) {
  return Array.isArray(message?.variables) ? message.variables : [message?.variables];
}

function findBattleLayer(message) {
  return layersFor(message).find(layer => layer?.stat_data?.battle);
}

const requested = requestedMessageId === undefined ? null : Number(requestedMessageId);
let selected = null;
for (let index = chat.length - 1; index >= 1; index -= 1) {
  const messageId = index - 1;
  if (requested !== null && messageId !== requested) continue;
  const layer = findBattleLayer(chat[index]);
  if (layer) {
    selected = { messageId, message: chat[index], layer };
    break;
  }
}
if (!selected) throw new Error(requested === null ? 'No message contains stat_data.battle' : `Message ${requested} has no stat_data.battle`);

const battle = selected.layer.stat_data.battle;
const content = createContentPackFromMvuBattle(battle);
const player = {
  hp: Number(battle.core?.hp),
  maxHp: Number(battle.core?.max_hp),
  lust: Number(battle.core?.lust),
  maxLust: Number(battle.core?.max_lust),
  level: Number(battle.level),
};
const build = core.summarizeBuildBudget(content, player);
const request = core.createBattleRequest({ content, player, route: null, seed: 0 });
const enemyAssessment = core.assessEnemyBudget(request, build);

function describe(definition) {
  const analysis = core.analyzeContentDefinition(definition);
  return {
    id: definition?.id ?? null,
    name: definition?.name ?? null,
    type: definition?.type ?? null,
    quantity: definition?.quantity ?? null,
    metrics: analysis.metrics,
    dynamicMetrics: [...analysis.dynamicMetrics].sort(),
    tags: [...analysis.tags].sort(),
    statusIds: [...analysis.statusIds].sort(),
    damage: analysis.damage,
    damageKnown: analysis.damageKnown,
  };
}

const report = {
  avatarUrl,
  chatFile,
  messageId: selected.messageId,
  messageMarker: String(selected.message?.mes || '').split('\n', 1)[0],
  battle: {
    core: battle.core,
    cardCount: content.cards.length,
    statusCount: content.statuses.length,
    relicCount: content.relics.length,
    itemCount: content.items.length,
    abilityCount: content.abilities.length,
    enemy: battle.enemy?.name ?? null,
  },
  buildBudget: build,
  enemyBudget: enemyAssessment.budget,
  enemyWarnings: enemyAssessment.warnings,
  cards: content.cards.map(describe),
  relics: content.relics.map(describe),
  abilities: content.abilities.map(describe),
  enemyActions: Array.isArray(content.enemy?.actions) ? content.enemy.actions.map(describe) : [],
};

console.log(JSON.stringify(report, null, 2));
