import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { createTavernApi, getChat } from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { createContentPackFromMvuBattle } = require(resolve('src/runtime/contentPackAdapter.ts'));

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const args = process.argv.slice(2);
let avatarUrl;
let chatFile;
let requestedMessageId;
let chat;

if (args[0] === '--file') {
  const sourcePath = resolve(args[1] || '');
  if (!args[1]) throw new Error('Usage: node scripts/calibrate-tavern-content.mjs --file <chat.jsonl> [message-id]');
  chat = (await readFile(sourcePath, 'utf8'))
    .split(/\r?\n/g)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  avatarUrl = `${basename(dirname(sourcePath))}.png`;
  chatFile = basename(sourcePath, '.jsonl');
  requestedMessageId = args[2];
} else {
  [avatarUrl, chatFile, requestedMessageId] = args;
  if (!avatarUrl?.endsWith('.png') || !chatFile) {
    throw new Error(
      'Usage: node scripts/calibrate-tavern-content.mjs <avatar.png> <chat-file> [message-id]\n' +
      '   or: node scripts/calibrate-tavern-content.mjs --file <chat.jsonl> [message-id]',
    );
  }
  const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
  const api = await createTavernApi(tavernUrl);
  chat = await getChat(api, avatarUrl, chatFile);
}

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
const contentContract = core.validateContentPackContract(content, { requireExecutable: true });
let request = null;
let requestError = null;
try {
  request = core.createBattleRequest({ content, player, route: null, seed: 0 });
} catch (error) {
  requestError = error instanceof Error ? error.message : String(error);
}
const enemyAssessment = request
  ? core.assessEnemyBudget(request, build)
  : { budget: core.recommendEnemyBudget(build, 1, 1), warnings: [] };
const startedAt = performance.now();
const designAssessment = core.assessContentDesign({
  pack: content,
  budget: build,
  player,
  previous: battle.design_context,
  rewardCandidates: Array.isArray(selected.layer.stat_data.reward?.card)
    ? selected.layer.stat_data.reward.card
    : [],
});
const designDurationMs = Math.round((performance.now() - startedAt) * 100) / 100;

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
  contentContract: {
    ok: contentContract.ok,
    issues: contentContract.ok ? [] : contentContract.issues,
    requestError,
  },
  enemyBudget: enemyAssessment.budget,
  enemyWarnings: enemyAssessment.warnings,
  designAssistant: {
    durationMs: designDurationMs,
    fingerprint: designAssessment.context.fingerprint,
    build: designAssessment.build,
    enemy: designAssessment.enemy,
    forecast: designAssessment.forecast,
    reward: designAssessment.reward,
    adaptiveEnemyBudget: designAssessment.budget,
    diagnostics: designAssessment.diagnostics,
    recentEnemySignatures: designAssessment.context.recentEnemySignatures,
    lastBattle: designAssessment.context.lastBattle ?? null,
    performance: designAssessment.context.performance ?? null,
    brief: designAssessment.context.brief,
    shadow: designAssessment.simulation,
  },
  cards: content.cards.map(describe),
  relics: content.relics.map(describe),
  abilities: content.abilities.map(describe),
  enemyActions: Array.isArray(content.enemy?.actions) ? content.enemy.actions.map(describe) : [],
};

console.log(JSON.stringify(report, null, 2));
