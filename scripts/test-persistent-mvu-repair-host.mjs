import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { PersistentMvuRepairHost } = require(resolve('src/sillytavern-extension/persistentMvuRepairHost.ts'));
const { createGlobalTowerGenerationPorts } = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));
const { formatCompactEffectAuthoringContract } = require(resolve('src/game-core/towerRequest.ts'));
const { createRunState } = require(resolve('src/game-core/runState.ts'));

const MESSAGE_ID = 3;
const PREVIOUS_MESSAGE_ID = 2;
const ORIGINAL_PROSE =
  '剧情正文\n\n<UpdateVariable>old</UpdateVariable>\n\n<StatusPlaceHolderImpl/>\n\n<CHARACTER_INIT_PENDING>';

function clone(value) {
  return structuredClone(value);
}

function wrapBattle(battle, status = { time: '01年01月01日 08:00', location: '测试地点' }) {
  return {
    stat_data: { status, battle },
    display_data: {},
    delta_data: {},
    schema: {},
  };
}

function readyBattle(cardName = '斩击') {
  return {
    core: { emoji: '🧙', hp: 80, max_hp: 80, lust: 0, max_lust: 100, card_removal_count: 1 },
    level: 1,
    exp: 0,
    cards: [
      {
        id: 'strike',
        name: cardName,
        type: 'Attack',
        rarity: 'Common',
        cost: 1,
        quantity: 5,
        effects: { damage: 7 },
      },
      {
        id: 'guard',
        name: '防御',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 5,
        effects: { block: 6 },
      },
    ],
    statuses: [],
    artifacts: [
      {
        id: 'stone',
        name: '生命之石',
        rarity: 'Common',
        trigger: 'battle_start',
        effects: { block: 2 },
      },
    ],
    items: [{ id: 'tonic', name: '微光药剂', count: 1, effects: { heal: 8 } }],
    player_abilities: [],
    player_status_effects: [],
    player_lust_effect: { name: '星蚀', effects: { damage: 6 } },
  };
}

function incompleteBattle() {
  const battle = readyBattle();
  delete battle.cards[0].effects;
  battle.artifacts = [];
  battle.items = [];
  battle.player_lust_effect = null;
  return battle;
}

function request(scope, prompt = `测试修复：${scope}`) {
  return { spec: 'mwg.mvu-repair-request/v1', scope, prompt };
}

function createRepairHelper({
  originalMessage = ORIGINAL_PROSE,
  originalVariables,
  originalChatVariables = { preset: { mode: 'story' }, user_owned: { counter: 17 } },
  baselineVariables = wrapBattle({ core: {}, cards: [] }),
  repairedVariables,
  eventDelayMs = 10,
  onEventStarted = () => {},
}) {
  const state = {
    message: originalMessage,
    swipeId: 0,
    variables: clone(originalVariables),
    chatVariables: clone(originalChatVariables),
    extraAnalysis: false,
    eventCalls: 0,
    iframeRebuilds: 0,
    replaceCalls: 0,
    chatReplaceCalls: 0,
    refreshes: [],
  };

  const helper = {
    getLastMessageId: () => MESSAGE_ID,
    getChatMessages: () => [{ message: state.message, swipe_id: state.swipeId }],
    setChatMessages: async (updates, options) => {
      const next = updates[0]?.message;
      if (typeof next === 'string') state.message = next;
      if (updates[0]?.data !== undefined) state.variables = clone(updates[0].data);
      state.refreshes.push(options?.refresh || '');
      if (state.message.includes('[MWG_REPAIR_REQUEST_BEGIN]')) {
        // Simulate the message iframe being destroyed and rebuilt. The
        // extension-owned helper and transaction deliberately survive it.
        state.iframeRebuilds += 1;
      }
    },
    getVariables: options => {
      if (options?.type === 'global') return { extra_analysis: state.extraAnalysis };
      if (options?.type === 'message' && options?.message_id === PREVIOUS_MESSAGE_ID) {
        return clone(baselineVariables);
      }
      if (options?.type === 'chat') return clone(state.chatVariables);
      return clone(state.variables);
    },
    replaceVariables: async (value, options) => {
      state.replaceCalls += 1;
      if (options?.type === 'chat') {
        state.chatReplaceCalls += 1;
        state.chatVariables = clone(value);
      }
      else state.variables = clone(value);
    },
    getAllEnabledScriptButtons: () => ({
      mvu: [{ button_id: 'mvu-retry-event', button_name: '重试额外模型解析' }],
    }),
    getScriptTrees: () => [],
    eventEmit: async event => {
      assert.equal(event, 'mvu-retry-event');
      assert.ok(state.iframeRebuilds > 0, 'repair must be emitted after the message iframe was rebuilt');
      state.eventCalls += 1;
      state.extraAnalysis = true;
      onEventStarted();
      setTimeout(() => {
        state.variables = clone(repairedVariables);
        state.message = state.message.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/i, '').trimEnd();
        state.message += '\n\n<UpdateVariable>repaired</UpdateVariable>';
        state.extraAnalysis = false;
      }, eventDelayMs);
    },
  };

  return { helper, state };
}

if (!process.argv.includes('--desire-growth-only')) {
for (const scope of ['initial-content', 'battle-settlement']) {
  for (const change of ['variables', 'prose', 'swipe', 'chat', 'render-edit', 'render-switch', 'render-silent-edit']) {
    const originalVariables = wrapBattle(scope === 'initial-content' ? incompleteBattle() : readyBattle());
    if (scope === 'battle-settlement') originalVariables.stat_data.reward = {
      card: [], artifact: [], item: [], limits: {},
      request: { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'defeat', penalty: false },
    };
    const { helper, state } = createRepairHelper({ originalVariables });
    let current = true;
    let preserved;
    let commits = 0;
    const progress = [];
    const render = helper.setChatMessages;
    const remember = () => preserved = { message: state.message, variables: clone(state.variables) };
    helper.setChatMessages = async (...args) => {
      commits += 1;
      await render(...args);
      if (change.startsWith('render-')) {
        state.variables.concurrent_owner = { value: 73 };
        if (change === 'render-switch') { state.swipeId = 1; state.message = 'another selected reply'; }
        remember();
        if (change !== 'render-silent-edit') throw new Error('concurrent render failure');
      }
    };
    const host = new PersistentMvuRepairHost({ onStructuredProgress: event => progress.push(event.phase), generate: async () => {
      if (change === 'variables') state.variables.concurrent_owner = { value: 73 };
      if (change === 'prose') state.message = 'new player-authored prose';
      if (change === 'swipe') { state.swipeId = 1; state.variables = wrapBattle(readyBattle('other reply')); }
      if (change === 'chat') { current = false; state.variables = wrapBattle(readyBattle('other chat')); }
      remember();
      return scope === 'initial-content' ? { battle: readyBattle('repair candidate') }
        : { reward: { card: [], artifact: [], item: [], limits: {} }, add_cards: [], add_artifacts: [], add_permanent_status: [] };
    } });
    await assert.rejects(host.request(helper, `conflict-${scope}-${change}`, request(scope), () => current));
    assert.deepEqual({ message: state.message, variables: state.variables }, preserved,
      `${scope}/${change}: stale commit and rollback cannot overwrite the new owner`);
    assert.equal(commits, change.startsWith('render-') ? 1 : 0);
    assert.equal(state.replaceCalls, 0, 'direct transaction uses paired Helper data/message update, never split variable writes');
    if (change === 'chat' || change === 'swipe' || change === 'render-switch') {
      assert.equal(progress.includes('error'), false, 'old repair must not publish an error into the newly selected view');
    }
  }
}

// A renderer can reject after the paired write. Roll back the exact owned
// pair, but only once; the separate concurrent-edit cases above cannot roll back.
{
  const originalVariables = wrapBattle(incompleteBattle());
  const { helper, state } = createRepairHelper({ originalVariables });
  const render = helper.setChatMessages;
  let calls = 0;
  helper.setChatMessages = async (...args) => {
    await render(...args);
    if (++calls === 1) throw new Error('after paired write failure');
  };
  await assert.rejects(new PersistentMvuRepairHost({ generate: async () => ({ battle: readyBattle() }) })
    .request(helper, 'owned-paired-rollback', request('initial-content')), /after paired write failure/);
  assert.equal(calls, 2);
  assert.equal(state.message, ORIGINAL_PROSE);
  assert.deepEqual(state.variables, originalVariables);
  assert.equal(state.replaceCalls, 0);
}

// Distinct selected replies cannot share an in-flight repair or clear each
// other's de-duplication entry when the old response finally arrives.
{
  const { helper, state } = createRepairHelper({ originalVariables: wrapBattle(incompleteBattle()) });
  const completions = [];
  const host = new PersistentMvuRepairHost({ generate: () => new Promise(resolve => completions.push(resolve)) });
  const input = request('initial-content');
  const old = host.request(helper, 'reply-dedupe', input);
  const oldRejected = assert.rejects(old, /聊天已切换|回复已变化/);
  state.swipeId = 1;
  state.variables = wrapBattle(incompleteBattle());
  const current = host.request(helper, 'reply-dedupe', input);
  assert.notEqual(old, current);
  completions[0]({ battle: readyBattle('old reply candidate') });
  await oldRejected;
  assert.equal(host.request(helper, 'reply-dedupe', input), current);
  completions[1]({ battle: readyBattle('current reply candidate') });
  await current;
  assert.equal(state.variables.stat_data.battle.cards[0].name, 'current reply candidate');
}

// Real Helper chat replacement replaces the entire user/preset dictionary.
// Direct repair may own the message MVU, never that separate dictionary.
{
  const { helper, state } = createRepairHelper({ originalVariables: wrapBattle(incompleteBattle()) });
  let owner = {};
  const firstOwner = owner;
  const completions = [];
  const host = new PersistentMvuRepairHost({ generate: () => new Promise(resolve => completions.push(resolve)) });
  const input = request('initial-content');
  const old = host.request(helper, 'same-id-reload', input, () => owner === firstOwner);
  const oldRejected = assert.rejects(old, /聊天已切换|回复已变化/);
  owner = {};
  const nextOwner = owner;
  const next = host.request(helper, 'same-id-reload', input, () => owner === nextOwner);
  assert.notEqual(next, old, 'same IDs after rematerialization cannot dedupe to an invalid owner');
  completions[0]({ battle: readyBattle('stale reloaded result') });
  await oldRejected;
  assert.equal(host.request(helper, 'same-id-reload', input, () => owner === nextOwner), next);
  completions[1]({ battle: readyBattle('new loaded result') });
  await next;
  assert.equal(state.variables.stat_data.battle.cards[0].name, 'new loaded result');
}

for (const scope of ['generic', 'cards-only', 'initial-content']) {
  const { helper, state } = createRepairHelper({ originalVariables: wrapBattle(incompleteBattle()) });
  const progress = [];
  const newVariables = { stat_data: { owner: 'new selected reply' } };
  helper.eventEmit = async () => {
    state.eventCalls += 1;
    state.swipeId = 1;
    state.message = 'new selected prose';
    state.variables = clone(newVariables);
  };
  const read = helper.getVariables;
  helper.getVariables = options => {
    assert.ok(state.swipeId === 0 || options.type !== 'message', 'no reconciliation reads of the new selected reply');
    return read(options);
  };
  await assert.rejects(new PersistentMvuRepairHost({ onStructuredProgress: event => progress.push(event.phase) })
    .request(helper, `legacy-swipe-${scope}`, request(scope)), /聊天已切换|回复已变化/);
  assert.equal(state.eventCalls, 1);
  assert.equal(state.replaceCalls, 0);
  assert.equal(state.refreshes.length, 1, 'only the pre-switch marker injection is allowed');
  assert.equal(state.message, 'new selected prose');
  assert.deepEqual(state.variables, newVariables);
  assert.equal(progress.includes('error'), false);
}

for (const missingSwipe of [undefined, -1, '0', NaN]) {
  const { helper, state } = createRepairHelper({ originalVariables: wrapBattle(incompleteBattle()) });
  state.swipeId = missingSwipe;
  let generated = 0;
  await assert.rejects(new PersistentMvuRepairHost({ generate: async () => { generated += 1; return {}; } })
    .request(helper, 'missing-reply-identity', request('initial-content')), /无法确定待修复楼层的当前回复/);
  assert.equal(generated, 0);
  assert.equal(state.replaceCalls, 0);
  assert.equal(state.refreshes.length, 0);
}

for (const scope of ['initial-content', 'battle-settlement']) {
  for (const outcome of ['success', 'model-reject', 'render-reject']) {
    const originalVariables = wrapBattle(scope === 'initial-content' ? incompleteBattle() : readyBattle());
    if (scope === 'battle-settlement') {
      originalVariables.stat_data.reward = {
        card: [], artifact: [], item: [], limits: {},
        request: { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'defeat', penalty: false },
      };
    }
    const originalChatVariables = {
      preset: { mode: 'story', version: 1 }, user_owned: { counter: 17 },
      stat_data: { legacy_cache_owned_by_mvu: true },
    };
    const { helper, state } = createRepairHelper({ originalVariables, originalChatVariables });
    const expectedChat = clone(originalChatVariables);
    let generations = 0;
    let renderFailurePending = outcome === 'render-reject';
    const render = helper.setChatMessages;
    helper.setChatMessages = async (...args) => {
      state.chatVariables.during_render = 'preserve';
      expectedChat.during_render = 'preserve';
      if (renderFailurePending) {
        renderFailurePending = false;
        throw new Error('owned test render failure');
      }
      return render(...args);
    };
    const host = new PersistentMvuRepairHost({
      generate: async () => {
        generations += 1;
        state.chatVariables.user_owned.counter += 1;
        expectedChat.user_owned.counter += 1;
        state.chatVariables.created_during_model = { retained: true };
        expectedChat.created_during_model = { retained: true };
        if (outcome === 'model-reject') throw new Error('owned test model failure');
        return scope === 'initial-content'
          ? { battle: readyBattle('AI authored repair') }
          : { reward: { card: [], artifact: [], item: [], limits: {} }, add_cards: [], add_artifacts: [], add_permanent_status: [] };
      },
    });
    const pending = host.request(helper, `${scope}-${outcome}-ownership`, request(scope));
    if (outcome === 'success') await pending;
    else await assert.rejects(pending, /owned test (?:model|render) failure/);
    assert.equal(generations, 1);
    assert.deepEqual(state.chatVariables, expectedChat, `${scope}/${outcome}: retain concurrent preset/user changes`);
    assert.equal(state.chatReplaceCalls, 0, `${scope}/${outcome}: no chat commit or rollback`);
    if (outcome !== 'success') assert.deepEqual(state.variables, originalVariables);
    else if (scope === 'initial-content') assert.equal(state.variables.stat_data.battle.cards[0].name, 'AI authored repair');
    else assert.equal(state.variables.stat_data.reward.request, null);
  }
}

// The persistent extension, not the disposable message iframe, owns the full
// asynchronous transaction. A simulated iframe rebuild must not interrupt it.
for (const scope of ['generic', 'cards-only', 'initial-content']) {
  for (const outcome of ['success', 'event-reject']) {
    const originalVariables = wrapBattle(scope === 'initial-content' ? incompleteBattle() : readyBattle());
    const expectedChat = { preset: { mode: 'story' }, user_owned: { counter: 18 }, during_event: 'preserve' };
    const { helper, state } = createRepairHelper({
      originalVariables, repairedVariables: wrapBattle(readyBattle('MVU authored repair')),
      onEventStarted: () => {
        state.chatVariables.user_owned.counter = 18;
        state.chatVariables.during_event = 'preserve';
        if (outcome === 'event-reject') throw new Error('owned test event failure');
      },
    });
    const host = new PersistentMvuRepairHost();
    const pending = host.request(helper, `event-${scope}-${outcome}`, request(scope));
    if (outcome === 'success') await pending;
    else await assert.rejects(pending, /owned test event failure/);
    assert.deepEqual(state.chatVariables, expectedChat, `event/${scope}/${outcome}: no chat erasure or stale rollback`);
    assert.equal(state.chatReplaceCalls, 0);
    if (outcome === 'success') assert.equal(state.variables.stat_data.battle.cards[0].name, 'MVU authored repair');
    else assert.deepEqual(state.variables, originalVariables);
  }
}

// Joining a first-pass MVU write while waiting for its listener is a separate
// commit path: it must not mirror or roll back the chat dictionary either.
{
  const originalVariables = wrapBattle(incompleteBattle());
  const { helper, state } = createRepairHelper({ originalVariables });
  const setMessage = helper.setChatMessages;
  helper.setChatMessages = async (...args) => {
    await setMessage(...args);
    if (state.message.includes('[MWG_REPAIR_REQUEST_BEGIN]')) {
      state.variables = wrapBattle(readyBattle('first pass finished'));
      state.chatVariables.user_owned.counter = 19;
    }
  };
  await new PersistentMvuRepairHost().request(helper, 'joined-first-pass-ownership', request('initial-content'));
  assert.equal(state.eventCalls, 0);
  assert.equal(state.variables.stat_data.battle.cards[0].name, 'first pass finished');
  assert.deepEqual(state.chatVariables, { preset: { mode: 'story' }, user_owned: { counter: 19 } });
  assert.equal(state.chatReplaceCalls, 0);
}

{
  const originalVariables = wrapBattle({ core: { emoji: '旧' }, cards: [] });
  const repairedVariables = wrapBattle({ core: { emoji: '新' }, cards: [{ id: 'new-card' }] });
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables });
  const host = new PersistentMvuRepairHost();
  await host.request(helper, 'chat-iframe-rebuild', request('generic'));
  assert.equal(state.iframeRebuilds, 1);
  assert.equal(state.eventCalls, 1);
  assert.equal(state.variables.stat_data.battle.core.emoji, '新');
  assert.doesNotMatch(state.message, /MWG_REPAIR_REQUEST/);
  assert.match(state.message, /<UpdateVariable>repaired<\/UpdateVariable>/);
}

// Identical requests for the same chat, floor and scope share one in-flight
// promise and therefore trigger only one model request.
{
  const originalVariables = wrapBattle({ core: { emoji: '旧' }, cards: [] });
  const repairedVariables = wrapBattle({ core: { emoji: '新' }, cards: [{ id: 'new-card' }] });
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables });
  const host = new PersistentMvuRepairHost();
  const input = request('generic', '完全相同的请求');
  const first = host.request(helper, 'chat-dedupe', input);
  const duplicate = host.request(helper, 'chat-dedupe', input);
  assert.equal(duplicate, first, 'same request must return its existing transaction promise');
  await Promise.all([first, duplicate]);
  assert.equal(state.eventCalls, 1, 'same request must emit the MVU retry event once');
}

// Initial-content repair is accepted only when the card package is structurally
// executable. Optional relics, items and lust effects do not create fake gates.
{
  const originalVariables = wrapBattle(incompleteBattle());
  const repairedBattle = readyBattle('direct-structured-repair');
  const { helper, state } = createRepairHelper({
    originalVariables,
    repairedVariables: wrapBattle(repairedBattle),
  });
  let generationConfig = null;
  const host = new PersistentMvuRepairHost({
    now: () => 123,
    generate: async config => {
      generationConfig = config;
      return JSON.stringify({ battle: repairedBattle });
    },
  });
  await host.request(helper, 'chat-initial-direct', request('initial-content'));
  assert.equal(state.eventCalls, 0, 'structured initial repair must not reuse the story-preset MVU retry event');
  assert.equal(state.variables.stat_data.battle.cards[0].name, 'direct-structured-repair');
  assert.equal(state.variables.stat_data.battle.artifacts.length, 1);
  assert.equal(state.variables.stat_data.battle.items.length, 1);
  assert.equal(generationConfig.max_chat_history, 0);
  assert.equal(generationConfig.should_silence, true);
  assert.equal(generationConfig.json_schema.name, 'mwg_initial_battle_repair');
  assert.equal(generationConfig.structured_delivery, 'text-json');
  assert.ok(generationConfig.user_input.includes(formatCompactEffectAuthoringContract()), 'complete shared authoring contract is delivered');
  assert.ok(generationConfig.user_input.includes('不使用通用 operation/target/condition/operator/value/amount/source 包装'), 'retain root-field restriction without incorrectly banning valid nested amount/value');
  assert.match(state.message, /_\.set\('battle',/);
  assert.doesNotMatch(state.message, /MWG_REPAIR_REQUEST/);
  assert.equal(state.refreshes.at(-1), 'affected');
}

{
  const originalVariables = wrapBattle(incompleteBattle());
  const repairedVariables = wrapBattle(readyBattle('完整修复后的斩击'));
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables });
  const host = new PersistentMvuRepairHost();
  await host.request(helper, 'chat-initial-valid', request('initial-content'));
  assert.equal(state.variables.stat_data.battle.cards[0].name, '完整修复后的斩击');
  assert.equal(state.variables.stat_data.battle.artifacts.length, 1);
  assert.equal(state.variables.stat_data.battle.items.length, 1);
  assert.equal(state.variables.stat_data.battle.player_lust_effect.name, '星蚀');
}

// A natural-language card repair may commit battle.cards and nothing else,
// even if the second model also tries to alter status, relics, or core values.
{
  const originalBattle = readyBattle('原卡牌');
  const originalVariables = wrapBattle(originalBattle, { time: '原时间', location: '原地点' });
  const changedBattle = readyBattle('修复后的卡牌');
  changedBattle.core.hp = 1;
  changedBattle.artifacts = [
    { id: 'intruder', name: '越权遗物', trigger: 'battle_start', effects: { block: 99 } },
  ];
  const repairedVariables = wrapBattle(changedBattle, { time: '越权时间', location: '越权地点' });
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables });
  const host = new PersistentMvuRepairHost();
  await host.request(helper, 'chat-cards-only', request('cards-only'));
  assert.equal(state.variables.stat_data.battle.cards[0].name, '修复后的卡牌');
  assert.equal(state.variables.stat_data.battle.core.hp, 80);
  assert.equal(state.variables.stat_data.battle.artifacts[0].id, 'stone');
  assert.deepEqual(state.variables.stat_data.status, { time: '原时间', location: '原地点' });
  assert.deepEqual(state.chatVariables, { preset: { mode: 'story' }, user_owned: { counter: 17 } });
  assert.equal(state.chatReplaceCalls, 0, 'scoped message commit cannot replace the chat dictionary');
}

// Failed complete validation rolls variables and prose back to the sanitized
// original. Neither an old marker nor the newly injected marker may survive.
{
  const staleMessage = `${ORIGINAL_PROSE}\n\n[MWG_REPAIR_REQUEST_BEGIN]\n旧的中断请求\n[MWG_REPAIR_REQUEST_END]`;
  const originalVariables = wrapBattle(incompleteBattle());
  const repairedVariables = wrapBattle(incompleteBattle());
  repairedVariables.stat_data.battle.cards[0].name = '只修了卡牌';
  const { helper, state } = createRepairHelper({
    originalMessage: staleMessage,
    originalVariables,
    repairedVariables,
  });
  const host = new PersistentMvuRepairHost();
  await assert.rejects(
    host.request(helper, 'chat-invalid-initial', request('initial-content')),
    error =>
      error?.name === 'ExtraModelCandidateRejectedError' &&
      /初始战斗内容仍未修复/.test(error.message) &&
      /battle\.cards\[0\]/.test(error.message),
  );
  assert.equal(state.message, ORIGINAL_PROSE, 'failed repair must restore the original prose without stale markers');
  assert.doesNotMatch(state.message, /MWG_REPAIR_REQUEST|旧的中断请求/);
  assert.deepEqual(state.variables, originalVariables);
  assert.deepEqual(state.chatVariables, { preset: { mode: 'story' }, user_owned: { counter: 17 } });
  assert.equal(state.refreshes.at(-1), 'affected');
}

// A delayed response must never be committed after the user switches chats.
// Tavern Helper's active-chat methods would otherwise write into the new save.
{
  let current = true;
  const originalVariables = wrapBattle({ core: { emoji: '旧' }, cards: [] });
  const repairedVariables = wrapBattle({ core: { emoji: '新' }, cards: [{ id: 'new-card' }] });
  const { helper, state } = createRepairHelper({
    originalVariables,
    repairedVariables,
    onEventStarted: () => { current = false; },
  });
  const host = new PersistentMvuRepairHost();
  await assert.rejects(
    host.request(helper, 'chat-switch', request('generic'), () => current),
    /当前聊天已切换/,
  );
  assert.equal(state.replaceCalls, 0, 'chat switch must suppress commit and rollback writes through the active helper');
}

// An unfinished defeat is repaired by a separate structured request. The
// first candidate is deliberately incomplete so the host must perform its one
// bounded correction instead of clearing reward.request early.
{
  const originalVariables = wrapBattle(readyBattle('保留的原始牌组'), {
    time: '134年07月17日 12:00',
    location: '镜像训练场',
    permanent_status: [{
      id: 'legacy_orphan_status',
      name: '旧存档孤立状态',
      emoji: '🩹',
      type: 'debuff',
      description: '旧存档中存在、但尚未登记到战斗状态表的持久后果。',
      triggers: { hold: { modify: 'damage_taken', add: 1 } },
    }],
  });
  originalVariables.stat_data.battle.cards.push({
    id: 'legacy_orphan_curse',
    name: '旧存档孤立诅咒',
    type: 'Curse',
    rarity: 'Corrupt',
    cost: 1,
    quantity: 1,
    effects: { apply_status: 'legacy_orphan_status', stacks: 1, to: 'self' },
  });
  originalVariables.stat_data.battle.core = {
    ...originalVariables.stat_data.battle.core,
    hp: 0,
    max_hp: 90,
    card_removal_count: 6,
  };
  originalVariables.stat_data.battle.level = 6;
  originalVariables.stat_data.battle.exp = 225;
  const settlementContextTailMarker = 'COMPLETE_SETTLEMENT_CONTEXT_TAIL';
  originalVariables.stat_data.battle.design_context = `${'x'.repeat(45_000)}${settlementContextTailMarker}`;
  originalVariables.stat_data.reward = {
    card: [{ id: 'stale-card' }],
    artifact: [{ id: 'stale-artifact' }],
    item: [{ id: 'stale-item' }],
    limits: { cards: 1 },
    request: {
      marker: '[MVU_BATTLE_SETTLEMENT]',
      result: 'defeat',
      penalty: true,
      enemy: { names: ['星蚀前锋'] },
    },
  };
  const { helper, state } = createRepairHelper({
    originalVariables,
    repairedVariables: originalVariables,
  });
  const generationConfigs = [];
  const progress = [];
  const rejectedCandidateTailMarker = 'COMPLETE_REJECTED_CANDIDATE_TAIL';
  const host = new PersistentMvuRepairHost({
    now: () => 456,
    onStructuredProgress: event => progress.push(structuredClone(event)),
    generate: async config => {
      generationConfigs.push(structuredClone(config));
      if (generationConfigs.length === 1) {
        return JSON.stringify({
          reward: { card: [], artifact: [], item: [], limits: {} },
          add_cards: [],
          add_artifacts: [],
          add_permanent_status: [],
          diagnostic: `${'y'.repeat(13_000)}${rejectedCandidateTailMarker}`,
        });
      }
      return JSON.stringify({
        reward: { card: [], artifact: [], item: [], limits: {} },
        add_cards: [{
          id: 'reload_eclipse_scar',
          name: '重启蚀痕',
          type: 'Curse',
          rarity: 'Corrupt',
          quantity: 1,
          description: '星蚀力量在战败后留下持续反噬。',
          effects: [
            { damage: 3, to: 'self' },
            { apply_status: 'star_marrow_siphon', stacks: 1, to: 'self' },
          ],
          ethereal: true,
        }],
        add_artifacts: [{
          id: 'star_marrow_stain',
          name: '星髓污染',
          rarity: 'Rare',
          description: '星髓留下的持久污染。',
          trigger: {
            on: 'battle_start',
            effects: { apply_status: 'star_marrow_siphon', stacks: 1, to: 'self' },
          },
        }],
        add_permanent_status: [{
          id: 'star_marrow_siphon',
          name: '星髓蚀吸',
          emoji: '✨',
          type: 'debuff',
          description: '受到的伤害随层数增加。',
          triggers: { hold: { modify: 'damage_taken', add: 'stacks' } },
        }],
      });
    },
  });
  await host.request(helper, 'chat-settlement-reload', request('battle-settlement', '[MVU_BATTLE_SETTLEMENT]'));
  assert.equal(generationConfigs.length, 2, 'missing defeat consequence must receive one bounded structured correction');
  assert.equal(generationConfigs[0].max_chat_history, 0);
  assert.equal(generationConfigs[0].should_silence, true);
  assert.equal(generationConfigs[0].json_schema.name, 'mwg_battle_settlement_repair');
  assert.equal(generationConfigs[0].structured_delivery, 'text-json');
  assert.match(generationConfigs[0].user_input, new RegExp(settlementContextTailMarker));
  assert.ok(generationConfigs[0].user_input.includes(formatCompactEffectAuthoringContract()), 'complete shared authoring contract is delivered');
  assert.match(generationConfigs[1].user_input, new RegExp(rejectedCandidateTailMarker));
  assert.equal(state.variables.stat_data.reward.request, null);
  assert.deepEqual(state.variables.stat_data.reward.card, []);
  assert.deepEqual(state.variables.stat_data.reward.artifact, []);
  assert.deepEqual(state.variables.stat_data.reward.item, []);
  assert.deepEqual(state.variables.stat_data.reward.limits, {});
  assert.equal(state.variables.stat_data.battle.core.hp, 0);
  assert.equal(state.variables.stat_data.battle.core.max_hp, 90);
  assert.equal(state.variables.stat_data.battle.core.card_removal_count, 6);
  assert.equal(state.variables.stat_data.battle.level, 6);
  assert.equal(state.variables.stat_data.battle.exp, 225);
  assert.equal(state.variables.stat_data.status.location, '镜像训练场');
  assert.equal(state.variables.stat_data.battle.artifacts[0].id, 'stone');
  assert.ok(state.variables.stat_data.battle.artifacts.some(artifact => artifact.id === 'star_marrow_stain'));
  const consequence = state.variables.stat_data.battle.cards.find(card => card.id === 'reload_eclipse_scar');
  assert.equal(consequence.type, 'Curse');
  assert.equal(consequence.rarity, 'Corrupt');
  assert.equal(consequence.quantity, 1);
  assert.equal('cost' in consequence, false, 'settlement curses must never retain an energy cost');
  const migratedLegacyCurse = state.variables.stat_data.battle.cards.find(card => card.id === 'legacy_orphan_curse');
  assert.equal('cost' in migratedLegacyCurse, false, 'legacy settlement curses must be migrated before the next battle');
  assert.ok(
    state.variables.stat_data.status.permanent_status.some(status => status.id === 'star_marrow_siphon'),
    'persistent consequence must remain visible outside battle',
  );
  assert.ok(
    state.variables.stat_data.battle.statuses.some(status => status.id === 'star_marrow_siphon'),
    'a newly referenced permanent status must also be registered for battle validation',
  );
  assert.ok(
    state.variables.stat_data.battle.statuses.some(status => status.id === 'legacy_orphan_status'),
    'a referenced permanent status from a legacy save must be backfilled into battle validation',
  );
  assert.match(state.message, /<Analysis>Repair battle settlement\.<\/Analysis>/);
  assert.match(state.message, /_\.set\('battle\.cards\[2\]', .*legacy_orphan_curse/);
  assert.match(state.message, /_\.assign\('battle\.statuses', .*star_marrow_siphon/);
  assert.match(state.message, /_\.assign\('battle\.statuses', .*legacy_orphan_status/);
  assert.match(state.message, /_\.set\('reward\.request', null\);/);
  assert.doesNotMatch(state.message, /MWG_REPAIR_REQUEST/);
  assert.equal(
    (state.message.match(/<UpdateVariable>/g) || []).length,
    1,
    'settlement commands must merge into the update block that owns the status page',
  );
  assert.ok(
    state.message.indexOf(`<Analysis>Repair battle settlement.</Analysis>`) < state.message.indexOf('</UpdateVariable>'),
    'the structured settlement must remain inside the merged update block',
  );
  assert.ok(
    state.message.indexOf('</UpdateVariable>') < state.message.indexOf('<StatusPlaceHolderImpl/>'),
    'no second fenced update page may appear after the common-interface marker',
  );
  assert.ok(progress.some(event => event.phase === 'begin'));
  assert.ok(progress.some(event => event.phase === 'complete'));
}

// If both structured candidates are invalid, the original request remains
// durable and no partial reward or punishment is committed.
{
  const originalVariables = wrapBattle(readyBattle());
  originalVariables.stat_data.reward = {
    card: [], artifact: [], item: [], limits: {},
    request: { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'defeat', penalty: true },
  };
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const host = new PersistentMvuRepairHost({
    generate: async () => ({
      reward: { card: [], artifact: [], item: [], limits: {} },
      add_cards: [], add_artifacts: [], add_permanent_status: [],
    }),
  });
  await assert.rejects(
    host.request(helper, 'chat-settlement-invalid', request('battle-settlement', '[MVU_BATTLE_SETTLEMENT]')),
    /持久惩罚/,
  );
  assert.equal(state.variables.stat_data.reward.request.marker, '[MVU_BATTLE_SETTLEMENT]');
  assert.deepEqual(state.variables, originalVariables);
  assert.equal(state.replaceCalls, 0);
}

}

// A complete retained reward pool only needs its pending marker cleared. Its
// quantities, definitions, and already-written growth must survive unchanged.
for (const existing of [false, true]) {
  for (const limits of [{ items: 1, cards: 1 }, { cards: 1, artifacts: 0, items: 1 }, { cards: 99, items: 2 }]) {
    const originalVariables = wrapBattle(readyBattle());
    const pool = {
      card: [0, 1, 2].map(index => ({ id: `reward_${index}`, name: `奖励${index}`, type: 'Attack',
        rarity: 'Common', cost: 1, quantity: 1, effects: { damage: 8 + index } })),
      artifact: [], item: [{ id: 'reward_tonic', name: '战后药剂', count: 1, effects: { heal: 5 } }], limits,
    };
    originalVariables.stat_data.reward = {
      ...(existing ? clone(pool) : { card: [], artifact: [], item: [], limits: {} }),
      pool_revision: 4,
      request: { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'victory',
        cards: { candidates: 3, pick: 1 }, items: { candidates: 1, pick: 1 }, limits: { cards: 1, items: 1 } },
    };
    const { helper, state } = createRepairHelper({ originalVariables });
    let calls = 0;
    const host = new PersistentMvuRepairHost({ generate: async () => {
      calls++;
      return { reward: clone(pool), add_cards: [], add_artifacts: [], add_permanent_status: [] };
    } });
    const run = () => host.request(helper, 'settlement-idempotence', request('battle-settlement'));
    await run();
    assert.equal(calls, existing ? 0 : 1, 'program-owned limits never require another model request');
    assert.equal(state.variables.stat_data.reward.request, null);
    assert.deepEqual(state.variables.stat_data.reward.card, pool.card);
    assert.deepEqual(state.variables.stat_data.reward.item, pool.item);
    assert.deepEqual(state.variables.stat_data.reward.limits, { cards: 1, items: 1 });
    assert.equal(state.variables.stat_data.reward.pool_revision, 4);
    assert.deepEqual(state.variables.stat_data.battle, originalVariables.stat_data.battle);
    if (existing) assert.doesNotMatch(state.message, /_\.set\('reward\.card'/);
    const completed = clone(state.variables);
    state.variables = JSON.parse(JSON.stringify(state.variables));
    await run();
    assert.equal(calls, existing ? 0 : 1, 'restored completed settlement must not generate again');
    assert.deepEqual(state.variables, completed);
  }
}

// An invalid retained pool is not mistaken for completed settlement.
{
  const originalVariables = wrapBattle(readyBattle());
  const valid = { id: 'reward_valid', name: '可执行奖励', type: 'Skill', cost: 1, rarity: 'Common', quantity: 1, effects: { block: 8 } };
  originalVariables.stat_data.reward = { card: [{ ...valid, effects: { apply_status: 'unknown_status', stacks: 1 } }],
    artifact: [], item: [], limits: { cards: 1 }, request: { marker: '[MVU_BATTLE_SETTLEMENT]', result: 'victory',
      cards: { candidates: 1, pick: 1 }, limits: { cards: 1 } } };
  const { helper, state } = createRepairHelper({ originalVariables });
  let calls = 0;
  const host = new PersistentMvuRepairHost({ generate: async () => {
    calls++;
    return { reward: { card: [valid], artifact: [], item: [], limits: { cards: 1 } },
      add_cards: [], add_artifacts: [], add_permanent_status: [] };
  } });
  await host.request(helper, 'settlement-invalid-pool', request('battle-settlement'));
  assert.equal(calls, 1);
  assert.deepEqual(state.variables.stat_data.reward.card, [valid]);
}

// Optional victory growth is persisted atomically, survives repair serialization,
// and never consumes or replaces ordinary rewards.
for (const scenario of ['grow', 'omit', 'missing-owner', 'defeat', 'invalid', 'new-status', 'conflicting-status']) {
  const originalVariables = wrapBattle(readyBattle());
  originalVariables.stat_data.battle.cards[0].effects = { lust: 25 };
  if (scenario === 'missing-owner') delete originalVariables.stat_data.battle.player_lust_effect;
  if (scenario === 'conflicting-status') originalVariables.stat_data.battle.statuses = [{
    id: 'desire_mark', name: '原印记', type: 'debuff', triggers: { tick: { damage: 2 } },
  }];
  originalVariables.stat_data.reward = {
    request: { marker: '[MVU_BATTLE_SETTLEMENT]', result: scenario === 'defeat' ? 'defeat' : 'victory',
      cards: { candidates: 0 }, limits: {} },
  };
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const grown = { name: '星蚀觉醒', effects: [{ damage: 50, to: 'opponent' }] };
  const payload = { reward: { card: [], artifact: [], item: [], limits: {} },
    add_cards: [], add_artifacts: [], add_permanent_status: [],
    ...(scenario === 'omit' ? {} : { player_lust_effect: scenario === 'invalid' ? { name: '空壳', effects: [] } : grown }),
  };
  if (scenario === 'new-status' || scenario === 'conflicting-status') {
    payload.player_lust_effect = { name: '星蚀印记', effects: [{ apply_status: 'desire_mark', stacks: 1, to: 'opponent' }] };
    payload.desire_statuses = [{ id: 'desire_mark', name: '星蚀印记', type: 'debuff', triggers: { tick: { damage: 30 } } }];
  }
  const host = new PersistentMvuRepairHost({ now: () => 999, generate: async () => JSON.stringify(payload) });
  const run = () => host.request(helper, `desire-growth-${scenario}`, request('battle-settlement', '[MVU_BATTLE_SETTLEMENT]'));
  if (['missing-owner', 'defeat', 'invalid', 'conflicting-status'].includes(scenario)) {
    await assert.rejects(run);
    assert.deepEqual(state.variables, originalVariables, 'rejected growth must not partially commit');
  } else {
    await run();
    assert.deepEqual(state.variables.stat_data.battle.player_lust_effect,
      scenario === 'omit' ? originalVariables.stat_data.battle.player_lust_effect : payload.player_lust_effect);
    assert.deepEqual(state.variables.stat_data.battle.cards, originalVariables.stat_data.battle.cards);
    assert.equal(state.variables.stat_data.reward.request, null);
    if (scenario !== 'omit') assert.match(state.message, /_\.set\('battle\.player_lust_effect'/);
    if (scenario === 'new-status') assert.equal(state.variables.stat_data.battle.statuses[0].id, 'desire_mark');
  }
}

// Player variable edits use the persistent structured endpoint rather than an
// un-attributable MVU current-message write. Only requested paths are changed.
{
  const originalVariables = wrapBattle(readyBattle());
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  let config;
  const progress = [];
  const host = new PersistentMvuRepairHost({
    now: () => 777,
    generate: async value => {
      config = structuredClone(value);
      return { operations: [{ op: 'set', path: ['status', 'time'], value: '第二天' }] };
    },
    onStructuredProgress: event => progress.push(structuredClone(event)),
  });
  await host.request(helper, 'chat-stat-data', request('stat-data', '把时间改为第二天'));
  assert.equal(state.variables.stat_data.status.time, '第二天');
  assert.deepEqual(state.variables.stat_data.battle, originalVariables.stat_data.battle);
  assert.equal(state.replaceCalls, 0, 'structured stat-data commit uses one guarded message snapshot');
  assert.equal(config.json_schema.name, 'mwg_stat_data_patch');
  assert.equal(config.structured_delivery, 'text-json');
  assert.match(state.message, /Apply player variable patch/);
  assert.match(progress.find(event => event.phase === 'complete').rawOutput, /"operations"/);
}

// A tower-only write during the structured request rebases with the disjoint
// player patch. The completed node survives without replaying any updater.
{
  const originalVariables = wrapBattle(readyBattle());
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const towerVariables = structuredClone(originalVariables);
  towerVariables.stat_data.run = { floor: 11, revision: 23, phase: 'ready', requestId: 'tower_18_1_18p9ku7' };
  const recorded = [];
  const host = new PersistentMvuRepairHost({
    onEvidence: e => recorded.push(e),
    generate: async () => {
      state.variables = structuredClone(towerVariables);
      return { operations: [{ op: 'set', path: ['status', 'time'], value: '第二天' }] };
    },
  });
  await host.request(helper, 'chat-stat-data-concurrent', request('stat-data', '把时间改为第二天'));
  assert.deepEqual(recorded.map(e=>e.stage),['request','response','outcome']);
  assert.match(recorded[0].prompt,/把时间改为第二天/);
  assert.match(recorded[1].response,/第二天/);
  assert.equal(state.variables.stat_data.status.time, '第二天');
  assert.deepEqual(state.variables.stat_data.run, towerVariables.stat_data.run);
  assert.equal(state.replaceCalls, 0, 'rebased stat-data commit must not replay a variable updater');
  assert.match(state.message, /Apply player variable patch/);
}

// A conflicting leaf is never rebased. The raw structured candidate remains
// available through the progress callback for local diagnostic export.
{
  const originalVariables = wrapBattle(readyBattle());
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const towerVariables = structuredClone(originalVariables);
  towerVariables.stat_data.status.time = '塔任务时间';
  const progress = [];
  const host = new PersistentMvuRepairHost({
    generate: async () => {
      state.variables = structuredClone(towerVariables);
      return { operations: [{ op: 'set', path: ['status', 'time'], value: '第二天' }] };
    },
    onStructuredProgress: event => progress.push(structuredClone(event)),
  });
  await assert.rejects(
    host.request(helper, 'chat-stat-data-conflict', request('stat-data', '把时间改为第二天')),
    /后台已更新.*status.*time/,
  );
  assert.deepEqual(state.variables, towerVariables);
  assert.equal(state.replaceCalls, 0);
  assert.equal(state.message, ORIGINAL_PROSE);
  const failure = progress.find(event => event.phase === 'error');
  assert.match(failure.rawOutput, /"operations"/);
}

// Runtime validation is stricter than schema transport: malformed paths get
// one bounded correction, then expose the final raw candidate as error evidence.
{
  const originalVariables = wrapBattle(readyBattle());
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  let calls = 0;
  const host = new PersistentMvuRepairHost({
    generate: async () => {
      calls += 1;
      return { operations: [{ op: 'remove', path: ['battle', 'cards', 0] }] };
    },
  });
  await assert.rejects(
    host.request(helper, 'chat-stat-data-invalid-path', request('stat-data', '移除第一张卡')),
    error => error?.mvuRepairEvidence?.response?.includes('operations'),
  );
  assert.equal(calls, 2, 'invalid structured patch gets exactly one bounded correction');
  assert.deepEqual(state.variables, originalVariables);
}

// Array removal is compacted, not serialized as a sparse JSON hole.
{
  const originalVariables = wrapBattle(readyBattle());
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const host = new PersistentMvuRepairHost({
    generate: async () => ({ operations: [{ op: 'remove', path: ['battle', 'cards', '0'] }] }),
  });
  await host.request(helper, 'chat-stat-data-array-remove', request('stat-data', '移除第一张卡'));
  assert.equal(state.variables.stat_data.battle.cards.length, 1);
  assert.equal(state.variables.stat_data.battle.cards[0].id, 'guard');
  assert.doesNotMatch(JSON.stringify(state.variables), /null/);
}

// A changed run must remain valid, while an unrelated story patch still works
// when an old save already carries an invalid run snapshot.
{
  const originalVariables = wrapBattle(readyBattle());
  originalVariables.stat_data.run = createRunState({ seed: 99 });
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const host = new PersistentMvuRepairHost({
    generate: async () => ({ operations: [{ op: 'set', path: ['run', 'seed'], value: -1 }] }),
  });
  await assert.rejects(host.request(helper, 'chat-stat-data-invalid-run', request('stat-data', '修改爬塔种子')), /无效爬塔状态/);
  assert.deepEqual(state.variables, originalVariables);
}
{
  const originalVariables = wrapBattle(readyBattle());
  originalVariables.stat_data.run = { broken: true };
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const host = new PersistentMvuRepairHost({
    generate: async () => ({ operations: [{ op: 'set', path: ['status', 'time'], value: '第二天' }] }),
  });
  await host.request(helper, 'chat-stat-data-old-invalid-run', request('stat-data', '把时间改为第二天'));
  assert.equal(state.variables.stat_data.status.time, '第二天');
  assert.deepEqual(state.variables.stat_data.run, { broken: true });
}
{
  const originalVariables = wrapBattle(readyBattle());
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const host = new PersistentMvuRepairHost({
    generate: async () => ({ operations: [{ op: 'set', path: ['game_mode'], value: 'unsupported' }] }),
  });
  await assert.rejects(host.request(helper, 'chat-stat-data-invalid-mode', request('stat-data', '改模式')), /无效游戏模式/);
  assert.deepEqual(state.variables, originalVariables);
}

// Exercise the actual ordinary-text transport, not just a direct model stub.
for (const provider of ['openai', 'deepseek', 'custom']) {
  const originalVariables = wrapBattle(readyBattle());
  const { helper, state } = createRepairHelper({ originalVariables, repairedVariables: originalVariables });
  const calls = [], progress = [];
  const raw = JSON.stringify({ operations: [{ op: 'set', path: ['status', 'time'], value: '第二天' }] });
  const ports = createGlobalTowerGenerationPorts({
    generateRaw: async config => { calls.push(config); return raw; },
  }, () => ({ chatCompletionSettings: { chat_completion_source: provider } }));
  const host = new PersistentMvuRepairHost({ generate: ports.generate, onStructuredProgress: e => progress.push(e) });
  await host.request(helper, `transport-${provider}`, request('stat-data', '把时间改为第二天'));
  assert.equal(calls.length, 1);
  assert.equal('json_schema' in calls[0], false, 'ordinary text transport cannot be overridden by Helper schema injection');
  const contract = calls[0].ordered_prompts.find(p => p.content?.startsWith('[MWG_SCHEMA_COMPATIBILITY/v1]'));
  assert.ok(contract, 'actual model request must include the patch output contract');
  assert.match(contract.content, /operations/);
  assert.equal(state.variables.stat_data.status.time, '第二天');
  assert.deepEqual(state.variables.stat_data.battle, originalVariables.stat_data.battle);
  assert.ok(progress.some(e => e.rawOutput?.includes('operations')), 'raw output survives diagnostic export callback');
}

console.log(
  'Persistent MVU repair survives iframe rebuilds, scopes cards, and safely completes structured battle settlement after reload.',
);
