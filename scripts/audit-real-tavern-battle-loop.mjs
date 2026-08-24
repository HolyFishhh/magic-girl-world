import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createTavernApi, getChat } from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const core = require(resolve('src/game-core/index.ts'));
const { parseOptionTags } = require(resolve('src/common/optionTags.ts'));
const JSON5 = require('json5');
const releaseConfig = JSON.parse(await readFile(resolve('release.config.json'), 'utf8'));
const [avatarUrl, chatFile] = process.argv.slice(2);
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);

if (!avatarUrl?.endsWith('.png') || !chatFile) {
  throw new Error('Usage: node scripts/audit-real-tavern-battle-loop.mjs <avatar.png> <chat-file>');
}

function statData(message) {
  const layers = Array.isArray(message?.variables) ? message.variables : [message?.variables];
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index]?.stat_data) return layers[index].stat_data;
  }
  return null;
}

function directList(value) {
  return Array.isArray(value) ? value : [];
}

function parseRewardBudget(message) {
  const line = String(message || '').match(/^\[奖励预算\]\s+(.+)$/m)?.[1] || '';
  const category = name => {
    const match = line.match(new RegExp(`(?:^|\\s)${name}=(\\d+)\\/(\\d+)`));
    return match ? { candidates: Number(match[1]), selectable: Number(match[2]) } : null;
  };
  return {
    cards: category('cards'),
    artifacts: category('artifacts'),
    items: category('items'),
    exp: Number(line.match(/(?:^|\s)exp=(\d+)/)?.[1] || 0),
  };
}

function extractRewardCandidates(response) {
  const result = { cards: [], artifacts: [], items: [] };
  const categoryByPath = {
    'reward.card': 'cards',
    'reward.artifact': 'artifacts',
    'reward.item': 'items',
  };

  for (const rawLine of String(response || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^_\.assign\(\s*(['"])(reward\.(?:card|artifact|item))\1\s*,\s*(\{.*\})\s*\);?$/);
    if (!match) continue;
    const category = categoryByPath[match[2]];
    try {
      result[category].push(JSON5.parse(match[3]));
    } catch (error) {
      throw new Error(`Failed to parse ${match[2]} candidate from assistant response: ${error.message}`);
    }
  }

  return result;
}

function resolveCandidates(stat, response) {
  const pending = {
    cards: directList(stat?.reward?.card),
    artifacts: directList(stat?.reward?.artifact),
    items: directList(stat?.reward?.item),
  };
  const pendingCount = Object.values(pending).reduce((sum, values) => sum + values.length, 0);
  return pendingCount > 0 ? { source: 'pending-mvu', values: pending } : { source: 'assistant-response', values: extractRewardCandidates(response) };
}

function validateCandidates(values, stat, category, battleKey) {
  const existing = directList(stat?.battle?.[battleKey]);
  const statusDefinitions = directList(stat?.battle?.statuses);
  return values.map(value => {
    const result = core.validateRewardCandidateAgainstLibrary(category, value, { existing, statusDefinitions });
    return {
      id: value?.id ?? null,
      name: value?.name ?? null,
      ok: result.ok,
      issue: result.ok ? null : result.message,
    };
  });
}

function claimedRewardNames(message) {
  const summary = String(message || '').match(/^\{\{user\}\}已获得：(.+)$/m)?.[1] || '';
  const read = label => {
    const match = summary.match(new RegExp(`${label}\\[([^\\]]*)\\]`));
    return match ? match[1].split(/[、,]/).map(value => value.trim()).filter(Boolean) : [];
  };
  return { cards: read('卡牌'), artifacts: read('遗物'), items: read('道具') };
}

function isRewardOperationOption(text, candidateNames) {
  const normalized = String(text || '').trim();
  if (/(?:领取|放弃|跳过|确认).{0,8}(?:奖励|战利品|候选|卡牌|遗物|道具)/.test(normalized)) return true;
  if (/(?:奖励|战利品|候选).{0,8}(?:领取|放弃|跳过|确认|查看|选择)/.test(normalized)) return true;
  if (/(?:查看|选择).{0,6}(?:奖励列表|奖励候选|候选奖励|本次奖励|战利品)/.test(normalized)) return true;
  return /^(?:领取|拿走|收下|选择|放弃|跳过)/.test(normalized) && candidateNames.some(name => normalized.includes(name));
}

function hasNamedEntry(values, name) {
  return directList(values).some(value => value?.name === name);
}

const api = await createTavernApi(tavernUrl);
const chat = await getChat(api, avatarUrl, chatFile);
let userIndex = -1;
for (let index = chat.length - 1; index >= 1; index -= 1) {
  if (chat[index]?.is_user && String(chat[index]?.mes || '').includes('[战斗后续] ordinary')) {
    userIndex = index;
    break;
  }
}
if (userIndex < 0) throw new Error('No ordinary post-battle user message was found');

const userMessage = chat[userIndex];
const assistantMessage = chat.slice(userIndex + 1).find(message => !message?.is_user && !message?.is_system);
if (!assistantMessage) throw new Error('The ordinary post-battle message has no assistant response');
const assistantIndex = chat.indexOf(assistantMessage);
const continuationUserIndex = chat.findIndex(
  (message, index) => index > assistantIndex && message?.is_user && String(message?.mes || '').includes('用户的选择是：'),
);
const continuationUser = continuationUserIndex >= 0 ? chat[continuationUserIndex] : null;
const continuationAssistant =
  continuationUserIndex >= 0
    ? chat.slice(continuationUserIndex + 1).find(message => !message?.is_user && !message?.is_system)
    : null;

const before = statData(userMessage);
const after = statData(assistantMessage);
const finalStat = statData(continuationAssistant) || after;
const response = String(assistantMessage.mes || '');
const options = parseOptionTags(response);
const budget = parseRewardBudget(userMessage.mes);
const candidates = resolveCandidates(after, response);
const candidateValidation = before
  ? {
      cards: validateCandidates(candidates.values.cards, before, 'cards', 'cards'),
      artifacts: validateCandidates(candidates.values.artifacts, before, 'artifacts', 'artifacts'),
      items: validateCandidates(candidates.values.items, before, 'items', 'items'),
    }
  : { cards: [], artifacts: [], items: [] };
const allCandidateNames = Object.values(candidateValidation)
  .flat()
  .map(candidate => candidate.name)
  .filter(Boolean);
const claimed = claimedRewardNames(continuationUser?.mes);

const issues = [];
if (!response.includes('<Options>')) issues.push('assistant response omitted <Options>');
if (options.length < 2 || options.length > 5) issues.push(`ordinary option count is ${options.length}, expected 2..5`);
const forbiddenOption = options.find(option => isRewardOperationOption(option.text, allCandidateNames));
if (forbiddenOption) issues.push(`reward operation leaked into Option: ${forbiddenOption.text}`);
if (!response.includes('<UpdateVariable>')) issues.push('assistant response omitted <UpdateVariable>');
if (!after) issues.push('assistant response has no stat_data layer after MUV processing');

for (const [category, expected] of Object.entries(budget)) {
  if (category === 'exp' || !expected) continue;
  const actual = candidateValidation[category].length;
  if (actual !== expected.candidates) {
    issues.push(`${category} candidate count is ${actual}, expected ${expected.candidates}`);
  }
}

for (const [category, candidates] of Object.entries(candidateValidation)) {
  const valid = candidates.filter(candidate => candidate.ok).length;
  const selectable = budget[category]?.selectable ?? Math.min(1, candidates.length);
  if (candidates.length > 0 && valid < selectable) {
    issues.push(`${category} has ${valid} valid candidates, fewer than selectable limit ${selectable}`);
  }
}

if (before && finalStat) {
  const beforeTotal = core.totalExperienceAt(before.battle?.level, before.battle?.exp);
  const afterTotal = core.totalExperienceAt(finalStat.battle?.level, finalStat.battle?.exp);
  if (afterTotal - beforeTotal !== budget.exp) {
    issues.push(`experience delta is ${afterTotal - beforeTotal}, expected ${budget.exp}`);
  }
  if (finalStat.run !== null) issues.push('ordinary battle unexpectedly initialized run state');
  if (finalStat.battle?.enemy?.name) issues.push(`settled enemy was restored: ${finalStat.battle.enemy.name}`);
}

if (continuationUser) {
  for (const [category, names] of Object.entries(claimed)) {
    const battleKey = category;
    for (const name of names) {
      if (!hasNamedEntry(finalStat?.battle?.[battleKey], name)) {
        issues.push(`claimed ${category} reward was not persisted: ${name}`);
      }
    }
  }
  if (directList(finalStat?.reward?.card).length > 0) issues.push('card rewards remain after story continuation');
  if (directList(finalStat?.reward?.artifact).length > 0) issues.push('artifact rewards remain after story continuation');
  if (directList(finalStat?.reward?.item).length > 0) issues.push('item rewards remain after story continuation');
  if (!continuationAssistant) {
    issues.push('reward selection returned no ordinary story response');
  } else {
    const continuationResponse = String(continuationAssistant.mes || '');
    const continuationOptions = parseOptionTags(continuationResponse);
    if (!continuationResponse.includes('<UpdateVariable>')) issues.push('ordinary story continuation omitted <UpdateVariable>');
    if (continuationOptions.length < 2 || continuationOptions.length > 5) {
      issues.push(`story continuation option count is ${continuationOptions.length}, expected 2..5`);
    }
  }
}

const report = {
  avatarUrl,
  chatFile,
  model: assistantMessage.extra?.model ?? null,
  userMessageId: userIndex - 1,
  assistantMessageId: chat.indexOf(assistantMessage) - 1,
  response: {
    characters: response.length,
    options: options.map(option => ({ kind: option.kind, text: option.text })),
    hasUpdateVariable: response.includes('<UpdateVariable>'),
  },
  phase: continuationAssistant ? 'story-resumed' : 'rewards-pending',
  budget,
  candidateSource: candidates.source,
  candidateValidation,
  claimed,
  progression:
    before && finalStat
      ? {
          before: { level: before.battle?.level, exp: before.battle?.exp },
          after: { level: finalStat.battle?.level, exp: finalStat.battle?.exp },
        }
      : null,
  continuation:
    continuationAssistant
      ? {
          userMessageId: continuationUserIndex - 1,
          assistantMessageId: chat.indexOf(continuationAssistant) - 1,
          model: continuationAssistant.extra?.model ?? null,
          options: parseOptionTags(String(continuationAssistant.mes || '')).map(option => option.text),
          hasUpdateVariable: String(continuationAssistant.mes || '').includes('<UpdateVariable>'),
        }
      : null,
  run: finalStat?.run ?? null,
  enemyName: finalStat?.battle?.enemy?.name ?? null,
  ok: issues.length === 0,
  issues,
};

console.log(JSON.stringify(report, null, 2));
if (issues.length > 0) process.exitCode = 1;
