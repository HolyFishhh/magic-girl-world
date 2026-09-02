import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'acorn';
import lodash from 'lodash';

import { createTavernApi, getCharacter, getSettings } from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const core = require(resolve(root, 'src/game-core/index.ts'));
const { createContentPackFromMvuBattle } = require(resolve(root, 'src/runtime/contentPackAdapter.ts'));
const { preflightBattleContent } = require(resolve(root, 'src/fish/core/battleContentPreflight.ts'));
const { applyRewardSelectionsToStat } = require(resolve(root, 'src/common/rewardTransactions.ts'));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'worldbook_new/manifest.json'), 'utf8'));
const entryConfig = JSON.parse(await readFile(resolve(root, 'worldbook_new/entry-config.json'), 'utf8'));
const [avatarUrl = `${releaseConfig.characterName}.png`] = process.argv.slice(2);
const tavernUrl = new URL(process.env.TAVERN_URL || releaseConfig.defaultTavernUrl);
const dataRoot = resolve(process.env.TAVERN_DATA_ROOT || 'D:/project/_codex-tavern-data-selfcontained');
const logPath = resolve(root, `real-story-loop-${releaseConfig.cardVersion}.log`);
const resumeLogPath = resolve(root, process.env.STORY_LOOP_RESUME_PATH || `real-story-loop-${releaseConfig.cardVersion}.log`);

const RESERVED_PROMPTS = new Set([
  'worldInfoBefore',
  'worldInfoAfter',
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
  'dialogueExamples',
  'chatHistory',
  'main',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanInitialValue(value) {
  if (Array.isArray(value)) {
    return value.filter(entry => entry !== '$__META_EXTENSIBLE__$').map(cleanInitialValue);
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$meta')
      .map(([key, entry]) => [key, cleanInitialValue(entry)]),
  );
}

function normalizeRole(role) {
  if (role === 'assistant' || role === 'model') return 'assistant';
  if (role === 'system') return 'system';
  return 'user';
}

function normalizeProtocolMarkers(value) {
  return String(value || '').replace(
    /[〈＜]\s*(CHARACTER_INIT_PENDING|CONTENT_PENDING|BATTLE_PENDING|BATTLE_START)\s*[〉＞]/gi,
    (_match, marker) => `<${marker.toUpperCase()}>`,
  );
}

function expandPresetMacros(text, names) {
  return String(text || '')
    .replaceAll('{{user}}', names.user)
    .replaceAll('{{char}}', names.char)
    .replace(/{{[^{}]*}}/g, '')
    .trim();
}

function expandVariableMacros(text, state) {
  return String(text || '').replace(/{{get_message_variable::stat_data\.([^}]+)}}/g, (_match, path) => {
    const value = lodash.get(state, path);
    return JSON.stringify(value === undefined ? null : value);
  });
}

async function readWorldbookEntries() {
  const entries = new Map();
  for (const [name, file] of Object.entries(manifest)) {
    if (name === '[config_override]' || name.includes('initvar')) continue;
    entries.set(name, await readFile(resolve(root, 'worldbook_new', file), 'utf8'));
  }
  return entries;
}

function roleOfEntry(name) {
  const comment = String(entryConfig[name]?.comment || '');
  if (comment.includes('[mvu_update]')) return 'update';
  if (comment.includes('[mvu_plot]')) return 'plot';
  return 'other';
}

function entryIsActive(name, markerText) {
  const config = entryConfig[name] || {};
  if (config.enabled === false) return false;
  if (config.constant === true) return true;
  const keys = Array.isArray(config.keys) ? config.keys : [];
  return keys.some(key => key && markerText.includes(key));
}

function activeWorldbookText(entries, role, markerText, state) {
  return [...entries.entries()]
    .filter(([name]) => roleOfEntry(name) === role && entryIsActive(name, markerText))
    .map(([name, text]) => `## ${name}\n${expandVariableMacros(text, state)}`)
    .join('\n\n');
}

function contentFingerprint(state) {
  const battle = state.battle;
  return JSON.stringify({
    cards: battle.cards,
    artifacts: battle.artifacts,
    items: battle.items,
    statuses: battle.statuses,
    player_lust_effect: battle.player_lust_effect,
  });
}

function defeatPenaltyCounts(state) {
  return {
    curses: (state.battle.cards || []).filter(card => String(card?.type || '').toLowerCase() === 'curse').length,
    artifacts: (state.battle.artifacts || []).length,
    permanentStatuses: (state.status.permanent_status || []).length,
  };
}

function subtractCounts(after, before) {
  return Object.fromEntries(Object.keys(after).map(key => [key, Number(after[key]) - Number(before[key])]));
}

function literalValue(node) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal') {
    return -Number(node.argument.value);
  }
  if (node.type === 'ArrayExpression') return node.elements.map(literalValue);
  if (node.type === 'ObjectExpression') {
    return Object.fromEntries(
      node.properties.map(property => {
        assert.equal(property.type, 'Property', 'MVU value may only contain ordinary object properties');
        assert.equal(property.kind, 'init', 'MVU value may not contain accessors');
        assert.equal(property.computed, false, 'MVU value may not contain computed keys');
        const key = property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
        return [key, literalValue(property.value)];
      }),
    );
  }
  throw new Error(`MVU command contains a non-literal value: ${node.type}`);
}

function parseUpdateCommands(output) {
  const source = String(output);
  const openings = [...source.matchAll(/<(update(?:variable)?|variableupdate)>/gi)];
  const opening = openings.at(-1);
  assert.ok(opening, 'extra model response is missing the UpdateVariable opening tag');
  const bodyStart = Number(opening.index) + opening[0].length;
  const closing = `</${opening[1]}>`;
  const closingIndex = source.toLowerCase().indexOf(closing.toLowerCase(), bodyStart);
  // MVU itself accepts a complete command block with a missing closing tag and
  // wraps it in a canonical UpdateVariable envelope. Mirror that real parser
  // here instead of making the acceptance harness stricter than production.
  const body = source.slice(bodyStart, closingIndex < 0 ? undefined : closingIndex);
  const analysis = body.match(/^\s*<Analysis>Update\.<\/Analysis>/i);
  assert.ok(analysis, 'extra model response is missing the fixed Analysis line');
  const program = parse(body.slice(analysis[0].length), { ecmaVersion: 'latest', sourceType: 'script' });
  return program.body.map(statement => {
    assert.equal(statement.type, 'ExpressionStatement', 'each MVU line must be one command');
    const expression = statement.expression;
    assert.equal(expression.type, 'CallExpression', 'each MVU line must be a function call');
    assert.equal(expression.callee.type, 'MemberExpression', 'MVU command must be a lodash member call');
    assert.equal(expression.callee.object.type, 'Identifier');
    assert.equal(expression.callee.object.name, '_');
    const method = expression.callee.computed ? expression.callee.property.value : expression.callee.property.name;
    assert.ok(['set', 'assign', 'remove', 'add'].includes(method), `unsupported MVU command: ${method}`);
    const args = expression.arguments.map(literalValue);
    assert.equal(typeof args[0], 'string', `${method} path must be a string literal`);
    return { method, args };
  });
}

function applyUpdateCommands(state, commands) {
  const oldValueMismatches = [];
  for (const { method, args } of commands) {
    const path = args[0];
    if (method === 'set') {
      assert.ok(args.length === 2 || args.length === 3, '_.set expects 2 or 3 arguments');
      const current = lodash.get(state, path);
      const next = args.at(-1);
      assert.ok(
        !Array.isArray(current) || Array.isArray(next),
        `MVU _.set would destroy array shape at ${path}; append one element with _.assign or replace it with a complete array`,
      );
      if (args.length === 3 && !lodash.isEqual(lodash.get(state, path), args[1])) {
        oldValueMismatches.push(path);
      }
      lodash.set(state, path, clone(next));
      continue;
    }
    if (method === 'add') {
      assert.equal(args.length, 2, '_.add expects 2 arguments');
      const current = Number(lodash.get(state, path));
      const delta = Number(args[1]);
      assert.ok(Number.isFinite(current) && Number.isFinite(delta), '_.add requires finite numbers');
      lodash.set(state, path, current + delta);
      continue;
    }
    if (method === 'assign') {
      assert.ok(args.length === 2 || args.length === 3, '_.assign expects 2 or 3 arguments');
      const target = lodash.get(state, path);
      if (args.length === 2) {
        assert.ok(Array.isArray(target), `_.assign two-argument target is not an array: ${path}`);
        target.push(clone(args[1]));
      } else {
        assert.ok(isRecord(target), `_.assign three-argument target is not an object: ${path}`);
        target[String(args[1])] = clone(args[2]);
      }
      continue;
    }
    assert.equal(args.length, 2, '_.remove expects 2 arguments');
    const target = lodash.get(state, path);
    if (Array.isArray(target)) {
      const selector = args[1];
      const index = Number.isInteger(selector)
        ? selector
        : target.findIndex(value => lodash.isEqual(value, selector) || (isRecord(value) && value.id === selector));
      if (index >= 0 && index < target.length) target.splice(index, 1);
    } else if (isRecord(target)) {
      delete target[String(args[1])];
    } else {
      throw new Error(`_.remove target is not a collection: ${path}`);
    }
  }
  return oldValueMismatches;
}

function clearEnemy(enemy) {
  Object.assign(enemy, {
    name: '',
    emoji: '',
    max_hp: 0,
    hp: 0,
    max_lust: 100,
    lust: 0,
    description: '',
    actions: [],
    abilities: [],
    status_effects: [],
    lust_effect: { name: '', description: '' },
    action_mode: 'random',
    action_config: {},
  });
}

function responseText(payload) {
  return String(
    payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.content ?? payload?.response ?? '',
  ).trim();
}

function responseReasoning(payload) {
  return String(payload?.choices?.[0]?.message?.reasoning_content || '').trim();
}

async function generate(api, oai, messages, options) {
  const body = {
    type: 'quiet',
    messages,
    model: oai.deepseek_model,
    temperature: Number(oai.temp_openai ?? 1),
    frequency_penalty: Number(oai.freq_pen_openai ?? 0),
    presence_penalty: Number(oai.pres_pen_openai ?? 0),
    top_p: Number(oai.top_p_openai ?? 1),
    max_tokens: options.maxTokens,
    stream: false,
    chat_completion_source: oai.chat_completion_source,
    user_name: options.userName,
    char_name: options.characterName,
    include_reasoning: options.includeReasoning === true,
  };
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await api.request('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`);
      const payload = JSON.parse(raw);
      const text = responseText(payload);
      if (!text) throw new Error(`model returned no content: ${raw.slice(0, 500)}`);
      return { text, reasoning: responseReasoning(payload) };
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
    }
  }
  throw lastError;
}

function presetMessages(preset, character, names) {
  const promptById = new Map((preset.prompts || []).map(prompt => [prompt.identifier, prompt]));
  const order = preset.prompt_order?.find(item => Array.isArray(item.order))?.order || [];
  const messages = [];
  for (const ordered of order) {
    if (!ordered.enabled) continue;
    const prompt = promptById.get(ordered.identifier);
    if (!prompt) continue;
    let content = '';
    if (prompt.identifier === 'charDescription') content = character?.data?.description || character?.description || '';
    else if (prompt.identifier === 'charPersonality') content = character?.data?.personality || character?.personality || '';
    else if (prompt.identifier === 'scenario') content = character?.data?.scenario || character?.scenario || '';
    else if (!RESERVED_PROMPTS.has(prompt.identifier)) content = prompt.content || '';
    content = expandPresetMacros(content, names);
    if (content) messages.push({ role: normalizeRole(prompt.role), content });
  }
  return messages;
}

function summarizeState(state) {
  return {
    location: state.status.location,
    cards: state.battle.cards.length,
    deckQuantity: state.battle.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0),
    artifacts: state.battle.artifacts.length,
    items: state.battle.items.length,
    statuses: state.battle.statuses.length,
    level: state.battle.level,
    exp: state.battle.exp,
    enemy: state.battle.enemy.name,
    rewards: {
      cards: state.reward.card.length,
      artifacts: state.reward.artifact.length,
      items: state.reward.item.length,
      limits: state.reward.limits,
    },
  };
}

const api = await createTavernApi(tavernUrl);
const settings = await getSettings(api);
const oai = settings.oai_settings || {};
assert.equal(oai.chat_completion_source, 'deepseek', 'real loop currently requires the configured DeepSeek connector');
assert.ok(oai.deepseek_model, 'configured DeepSeek model is empty');
const presetName = oai.preset_settings_openai;
assert.ok(presetName, 'active OpenAI preset is empty');
const preset = JSON.parse(
  await readFile(resolve(dataRoot, 'default-user', 'OpenAI Settings', `${presetName}.json`), 'utf8'),
);
const character = await getCharacter(api, avatarUrl);
const characterName = character?.name || character?.data?.name || releaseConfig.characterName;
const names = { user: '测试者', char: characterName };
const entries = await readWorldbookEntries();
const initialTemplate = JSON.parse(await readFile(resolve(root, 'worldbook_new/变量初始化.json'), 'utf8'));
const state = cleanInitialValue(initialTemplate);
state.game_mode = 'story';

let evidence = {
  version: releaseConfig.cardVersion,
  avatarUrl,
  tavernUrl: tavernUrl.toString(),
  preset: presetName,
  connector: oai.chat_completion_source,
  model: oai.deepseek_model,
  phases: [],
};
let initializedContentFromResume = null;
let resumedInflight = null;
if (process.env.STORY_LOOP_RESUME === '1') {
  const saved = JSON.parse(await readFile(resumeLogPath, 'utf8'));
  if (process.env.STORY_LOOP_ALLOW_PRIOR_VERSION !== '1') {
    assert.equal(saved.version, releaseConfig.cardVersion, 'resume evidence version mismatch');
  }
  assert.equal(saved.preset, presetName, 'resume evidence preset mismatch');
  assert.equal(saved.model, oai.deepseek_model, 'resume evidence model mismatch');
  resumedInflight = saved.inflight || null;
  evidence = {
    ...saved,
    version: releaseConfig.cardVersion,
    avatarUrl,
    tavernUrl: tavernUrl.toString(),
    phases: [],
    ...(saved.version === releaseConfig.cardVersion ? {} : { resumedFromVersion: saved.version }),
  };
  delete evidence.inflight;
  delete evidence.final;
  for (const phase of saved.phases || []) {
    const commands = parseUpdateCommands(phase.extra);
    applyUpdateCommands(state, commands);
    evidence.phases.push(phase);
    if (phase.name === 'initialization') initializedContentFromResume = contentFingerprint(state);
    if (phase.name === 'ordinary_incremental' && initializedContentFromResume !== null) {
      assert.equal(contentFingerprint(state), initializedContentFromResume, 'saved ordinary phase rebuilt persistent content');
    }
  }
  console.log(JSON.stringify({ resumed: evidence.phases.map(phase => phase.name), state: summarizeState(state) }));
}

function hasPhase(name) {
  return evidence.phases.some(phase => phase.name === name);
}

async function runPhase(name, userText, expectedMarkers = []) {
  const plotWorldbook = activeWorldbookText(entries, 'plot', userText, state);
  const plotProtocol = expandVariableMacros(entries.get('剧情交接锚点') || '', state);
  const plotContext = plotWorldbook
    .replace(`## 剧情交接锚点\n${plotProtocol}`, '')
    .trim();
  const mainMessages = presetMessages(preset, character, names);
  // The embedded plot entries are exported as system-role atDepth=1 entries.
  // Put them after static preset prompts so this harness matches SillyTavern's
  // late chat-depth injection instead of weakening them as worldInfoBefore.
  if (plotContext) mainMessages.push({ role: 'system', content: plotContext });
  mainMessages.push({ role: 'user', content: userText });
  // The protocol entry is exported atDepth=0 so it remains the final output
  // boundary even when the user's preset has strong static footer prompts.
  mainMessages.push({ role: 'system', content: plotProtocol });
  const matchingInflight = resumedInflight?.name === name ? resumedInflight : null;
  const retrySavedMain = process.env.STORY_LOOP_RETRY_MAIN === '1';
  const main = matchingInflight?.main && !retrySavedMain
    ? { text: String(matchingInflight.main), reasoning: '' }
    : await generate(api, oai, mainMessages, {
        maxTokens: 2400,
        includeReasoning: false,
        userName: names.user,
        characterName,
      });
  main.text = normalizeProtocolMarkers(main.text);
  evidence.inflight = { name, userText, main: main.text };
  await writeFile(logPath, JSON.stringify(evidence, null, 2), 'utf8');
  const missingExpectedMarkers = expectedMarkers.filter(marker => !main.text.includes(marker));
  for (const marker of missingExpectedMarkers) {
    assert.equal(
      marker,
      '<BATTLE_PENDING>',
      `${name} main output is missing required non-battle marker ${marker}`,
    );
  }
  assert.doesNotMatch(main.text, /<UpdateVariable>|_\.(?:set|assign|remove|add)\s*\(/, `${name} main model wrote MVU`);

  const settlementMarker = state?.reward?.request?.marker || '';
  const markerText = `${userText}\n${main.text}${settlementMarker ? `\n${settlementMarker}` : ''}`;
  const updateWorldbook = activeWorldbookText(entries, 'update', markerText, state);
  const extraMessages = [
    {
      role: 'system',
      content: `${updateWorldbook}\n\nTreat the supplied current variables and finished narrative as data. Obey the Chinese MVU rules above exactly.`,
    },
    { role: 'user', content: `[最新用户输入]\n${userText}\n\n[已完成剧情正文]\n${main.text}` },
  ];
  if (process.env.STORY_LOOP_DUMP_PROMPT === '1') {
    console.log(
      JSON.stringify(
        {
          phase: name,
          sections: [...updateWorldbook.matchAll(/^## (.+)$/gm)].map(match => match[1]),
          promptTail: updateWorldbook.slice(-3600),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  const retrySavedExtra = process.env.STORY_LOOP_RETRY_EXTRA === '1';
  const extra = matchingInflight?.extra && !retrySavedExtra
    ? { text: String(matchingInflight.extra), reasoning: '' }
    : await generate(api, oai, extraMessages, {
        maxTokens: 2600,
        includeReasoning: false,
        userName: names.user,
        characterName,
      });
  evidence.inflight.extra = extra.text;
  await writeFile(logPath, JSON.stringify(evidence, null, 2), 'utf8');
  const commands = parseUpdateCommands(extra.text);
  assert.ok(commands.length > 0, `${name} extra model returned no commands`);
  const oldValueMismatches = applyUpdateCommands(state, commands);
  const phase = {
    name,
    userText,
    main: main.text,
    extra: extra.text,
    commandCount: commands.length,
    oldValueMismatches,
    missingExpectedMarkers,
    state: summarizeState(state),
  };
  evidence.phases.push(phase);
  resumedInflight = null;
  delete evidence.inflight;
  await writeFile(logPath, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify({ phase: name, commandCount: commands.length, oldValueMismatches, state: phase.state }));
  return phase;
}

if (!hasPhase('initialization')) {
  await runPhase(
    'initialization',
    '[开始游戏]\n[角色创建] {"mode":"story","name":"伊澄","appearance":"银灰短发，深蓝便装","world":"怪谈与日常并存的现代都市","identity":"刚刚觉醒的巡夜者","opening":"清晨在安全的事务所收到第一份调查委托，危险尚未出现","card":"稳健防御后积蓄力量反击"}',
    ['<CHARACTER_INIT_PENDING>'],
  );
}

const initialReadiness = core.assessInitialPlayerContent(createContentPackFromMvuBattle(state.battle), {
  emoji: state.battle.core.emoji,
  hp: state.battle.core.hp,
  maxHp: state.battle.core.max_hp,
  lust: state.battle.core.lust,
  maxLust: state.battle.core.max_lust,
  level: state.battle.level,
  exp: state.battle.exp,
});
assert.ok(initialReadiness.ok, core.formatPlayerContentReadiness(initialReadiness, 20));
const initializedContent = initializedContentFromResume || contentFingerprint(state);
const encounterWasResumed = hasPhase('encounter');

if (!hasPhase('ordinary_incremental')) {
  await runPhase(
    'ordinary_incremental',
    '我先留在安全的站台与目击者交谈，确认刚才的异响来源；这轮不获得新物品或能力，也不进入战斗。',
  );
}
if (!encounterWasResumed) {
  assert.equal(contentFingerprint(state), initializedContent, 'ordinary MVU turn rebuilt persistent battle content');
  assert.equal(state.battle.enemy.name, '', 'ordinary MVU turn registered an enemy without an encounter');
}

if (!hasPhase('encounter')) {
  await runPhase(
    'encounter',
    '让调查自然推进到眼前的怪谈实体已经现身并主动袭击，冲突不可避免。先完整描写它与现场，再交接战斗。',
    ['<BATTLE_PENDING>'],
  );
}
const enemySnapshot = clone(state.battle.enemy);
const preflight = preflightBattleContent(state.battle);
assert.ok(preflight.ok, preflight.issues.map(issue => `${issue.path}(${issue.code})`).join('; '));

state.battle.core.hp = Math.max(1, Number(state.battle.core.hp) - 10);
state.battle.core.lust = 0;
state.battle.exp = Number(state.battle.exp) + core.recommendBattleRewardBudget(null).experience;
clearEnemy(state.battle.enemy);
state.battle.player_abilities = [];
state.battle.player_status_effects = [];
const rewardBudget = core.recommendBattleRewardBudget(null);
state.reward.request = {
  marker: '[MVU_BATTLE_SETTLEMENT]',
  result: 'victory',
  cards: rewardBudget.cards,
  artifacts: rewardBudget.artifacts,
  items: rewardBudget.items,
  limits: {
    cards: rewardBudget.cards.pick,
    ...(rewardBudget.artifacts ? { artifacts: rewardBudget.artifacts.pick } : {}),
    ...(rewardBudget.items ? { items: rewardBudget.items.pick } : {}),
  },
  build: '[构筑建议] 延续现有核心联动，并补足稳定资源循环。',
};
const postBattle = core.formatBattleEndPrompt({
  result: 'victory',
  continuation: 'ordinary',
  narrativeText: `伊澄击败了${enemySnapshot.name}。`,
  player: {
    hp: state.battle.core.hp,
    maxHp: state.battle.core.max_hp,
    lust: state.battle.core.lust,
    maxLust: state.battle.core.max_lust,
    energy: 0,
    block: 0,
    statuses: [],
    handCount: 0,
    drawPileCount: 0,
    discardPileCount: 0,
    exhaustPileCount: 0,
  },
  enemy: {
    name: enemySnapshot.name,
    hp: 0,
    maxHp: enemySnapshot.max_hp,
    lust: enemySnapshot.lust,
    maxLust: enemySnapshot.max_lust,
    block: 0,
    statuses: [],
  },
  turns: 4,
  battleLog: `伊澄在四回合中利用现有构筑完成防守与反击，最终击败${enemySnapshot.name}。`,
  rewardBudget: `[奖励预算] ${core.formatBattleRewardBudget(rewardBudget, { includeExperience: false })}\n[结算必做] ${core.formatBattleRewardChecklist(rewardBudget)}`,
  buildGuidance: '[构筑建议] 延续现有核心联动，并补足稳定资源循环。',
});
if (!hasPhase('post_battle_growth')) {
  if (resumedInflight?.name === 'post_battle_growth' && resumedInflight.main && resumedInflight.extra) {
    const commands = parseUpdateCommands(resumedInflight.extra);
    const oldValueMismatches = applyUpdateCommands(state, commands);
    const phase = {
      name: resumedInflight.name,
      userText: resumedInflight.userText,
      main: resumedInflight.main,
      extra: resumedInflight.extra,
      commandCount: commands.length,
      oldValueMismatches,
      state: summarizeState(state),
      resumedFromCompletedRequest: true,
    };
    evidence.phases.push(phase);
    delete evidence.inflight;
    await writeFile(logPath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({ phase: phase.name, resumedFromCompletedRequest: true, state: phase.state }));
  } else {
    await runPhase('post_battle_growth', postBattle.promptedBattleSummary);
  }
}

assert.equal(state.reward.card.length, rewardBudget.cards.candidates, 'post-battle card candidate count is wrong');
assert.equal(state.reward.artifact.length, 0, 'ordinary battle must not create artifact candidates');
assert.equal(state.reward.item.length, rewardBudget.items.candidates, 'post-battle item candidate count is wrong');
assert.deepEqual(state.reward.limits, { cards: 1, items: 1 }, 'post-battle reward limits are wrong');
for (const [category, values] of [
  ['cards', state.reward.card],
  ['items', state.reward.item],
]) {
  for (const candidate of values) {
    const validation = core.validateRewardCandidateAgainstLibrary(category, candidate, {
      existing: state.battle[category],
      statusDefinitions: state.battle.statuses,
    });
    assert.ok(validation.ok, `${category} reward ${candidate?.name || candidate?.id} is invalid: ${validation.message}`);
  }
}

const cardsBeforeReward = state.battle.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0);
const itemsBeforeReward = state.battle.items.reduce((sum, item) => sum + Number(item.count || 0), 0);
const rewardSummary = applyRewardSelectionsToStat(state, { cards: [0], artifacts: [], items: [0] });
assert.equal(state.reward.card.length + state.reward.artifact.length + state.reward.item.length, 0);
assert.deepEqual(state.reward.limits, {});
assert.equal(
  state.battle.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0),
  cardsBeforeReward + 1,
  'selected card reward was not persisted',
);
assert.ok(
  state.battle.items.reduce((sum, item) => sum + Number(item.count || 0), 0) >= itemsBeforeReward + 1,
  'selected item reward was not persisted',
);

const secondEncounterBaseline = contentFingerprint(state);
const secondEncounterPlayerBefore = {
  hp: Number(state.battle.core.hp),
  lust: Number(state.battle.core.lust),
  level: Number(state.battle.level),
  exp: Number(state.battle.exp),
  statuses: JSON.stringify(state.battle.player_status_effects || []),
};
let secondEncounterPhase = evidence.phases.find(phase => phase.name === 'second_encounter');
if (!hasPhase('second_encounter')) {
  secondEncounterPhase = await runPhase(
    'second_encounter',
    '我带着刚领取的卡牌与道具继续调查。让剧情自然推进到第二名有独特能力的敌人已经完成一次先手袭击：这次袭击必须在进入战斗时反映为我方或敌方非满值生命、欲望或已登记的临时状态，然后交接战斗。',
    ['<BATTLE_PENDING>'],
  );
}
assert.notEqual(state.battle.enemy.name, '', 'second encounter did not register an enemy');
const secondPreflight = preflightBattleContent(state.battle);
assert.ok(secondPreflight.ok, secondPreflight.issues.map(issue => `${issue.path}(${issue.code})`).join('; '));
const secondEncounterPreservedContent = contentFingerprint(state) === secondEncounterBaseline;
assert.ok(secondEncounterPreservedContent, 'second encounter rebuilt persistent content');
assert.equal(Number(state.battle.level), secondEncounterPlayerBefore.level, 'second encounter modified program-owned level');
assert.equal(Number(state.battle.exp), secondEncounterPlayerBefore.exp, 'second encounter modified program-owned experience');
assert.ok(
  Number(state.battle.core.hp) < secondEncounterPlayerBefore.hp ||
    Number(state.battle.core.lust) > secondEncounterPlayerBefore.lust ||
    JSON.stringify(state.battle.player_status_effects || []) !== secondEncounterPlayerBefore.statuses ||
    Number(state.battle.enemy.hp) < Number(state.battle.enemy.max_hp) ||
    Number(state.battle.enemy.lust) > 0 ||
    state.battle.enemy.status_effects.length > 0,
  'second encounter ignored the completed pre-battle strike',
);
assert.deepEqual(secondEncounterPhase?.oldValueMismatches || [], [], 'second encounter used stale MVU old values');

if (process.env.STORY_LOOP_STOP_AFTER === 'second_encounter') {
  evidence.final = {
    stoppedAfter: 'second_encounter',
    secondEncounterPreservedContent,
    secondEncounterLevel: Number(state.battle.level),
    secondEncounterExp: Number(state.battle.exp),
    state: summarizeState(state),
  };
  await writeFile(logPath, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence.final, null, 2));
  process.exit(0);
}

const defeatEnemy = clone(state.battle.enemy);
const penaltyBefore = defeatPenaltyCounts(state);
state.battle.core.hp = 0;
state.battle.core.lust = Math.min(Number(state.battle.core.max_lust), Number(state.battle.core.lust));
clearEnemy(state.battle.enemy);
state.battle.player_abilities = [];
state.battle.player_status_effects = [];
const defeatPrompt = core.formatBattleEndPrompt({
  result: 'defeat',
  continuation: 'ordinary',
  narrativeText: `${defeatEnemy.name}击败了伊澄，并留下了与自身能力相关的持续影响。`,
  player: {
    hp: 0,
    maxHp: state.battle.core.max_hp,
    lust: state.battle.core.lust,
    maxLust: state.battle.core.max_lust,
    energy: 0,
    block: 0,
    statuses: [],
    handCount: 0,
    drawPileCount: 0,
    discardPileCount: 0,
    exhaustPileCount: 0,
  },
  enemy: {
    name: defeatEnemy.name,
    hp: Math.max(1, Number(defeatEnemy.hp)),
    maxHp: defeatEnemy.max_hp,
    lust: defeatEnemy.lust,
    maxLust: defeatEnemy.max_lust,
    block: 0,
    statuses: [],
  },
  turns: 3,
  battleLog: `${defeatEnemy.name}凭借自身特色能力压制伊澄；第三回合结束时伊澄生命归零，战败结果已经确定。`,
});
state.reward.request = {
  marker: '[MVU_BATTLE_SETTLEMENT]',
  result: 'defeat',
  penalty: true,
  enemy: { name: defeatEnemy.name },
};
if (!hasPhase('post_defeat_penalty')) {
  await runPhase('post_defeat_penalty', defeatPrompt.promptedBattleSummary);
}
assert.equal(state.reward.card.length + state.reward.artifact.length + state.reward.item.length, 0, 'defeat created rewards');
assert.deepEqual(state.reward.limits, {}, 'defeat created reward limits');
const penaltyAfter = defeatPenaltyCounts(state);
const penaltyDelta = subtractCounts(penaltyAfter, penaltyBefore);
assert.equal(
  penaltyDelta.curses + penaltyDelta.artifacts + penaltyDelta.permanentStatuses > 0,
  true,
  `defeat must add at least one persistent penalty: ${JSON.stringify(penaltyDelta)}`,
);
const postDefeatReadiness = core.assessInitialPlayerContent(createContentPackFromMvuBattle(state.battle), {
  emoji: state.battle.core.emoji,
  hp: state.battle.core.hp,
  maxHp: state.battle.core.max_hp,
  lust: state.battle.core.lust,
  maxLust: state.battle.core.max_lust,
  level: state.battle.level,
  exp: state.battle.exp,
});
assert.ok(postDefeatReadiness.ok, core.formatPlayerContentReadiness(postDefeatReadiness, 20));

evidence.final = {
  initialReadiness: core.formatPlayerContentReadiness(initialReadiness, 20),
  encounterPreflight: { ok: preflight.ok, warnings: preflight.warnings },
  rewardSummary,
  secondEncounterPreflight: { ok: secondPreflight.ok, warnings: secondPreflight.warnings },
  secondEncounterPreservedContent,
  defeatPenalty: penaltyDelta,
  postDefeatReadiness: core.formatPlayerContentReadiness(postDefeatReadiness, 20),
  state: summarizeState(state),
};
await writeFile(logPath, JSON.stringify(evidence, null, 2), 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      version: evidence.version,
      preset: evidence.preset,
      connector: evidence.connector,
      model: evidence.model,
      phases: evidence.phases.map(phase => phase.name),
      final: evidence.final,
      logPath,
    },
    null,
    2,
  ),
);
