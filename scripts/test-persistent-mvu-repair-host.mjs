import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { PersistentMvuRepairHost } = require(resolve('src/sillytavern-extension/persistentMvuRepairHost.ts'));

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
  baselineVariables = wrapBattle({ core: {}, cards: [] }),
  repairedVariables,
  eventDelayMs = 10,
  onEventStarted = () => {},
}) {
  const state = {
    message: originalMessage,
    variables: clone(originalVariables),
    chatVariables: clone(originalVariables),
    extraAnalysis: false,
    eventCalls: 0,
    iframeRebuilds: 0,
    replaceCalls: 0,
    refreshes: [],
  };

  const helper = {
    getLastMessageId: () => MESSAGE_ID,
    getChatMessages: () => [{ message: state.message }],
    setChatMessages: async (updates, options) => {
      const next = updates[0]?.message;
      if (typeof next === 'string') state.message = next;
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
      if (options?.type === 'chat') state.chatVariables = clone(value);
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

// The persistent extension, not the disposable message iframe, owns the full
// asynchronous transaction. A simulated iframe rebuild must not interrupt it.
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

// Initial-content repair is accepted only when the complete player package is
// ready, including resources outside battle.cards.
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
  assert.deepEqual(state.chatVariables, state.variables, 'chat snapshot must receive the same scoped commit');
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
      /battle\.artifacts/.test(error.message),
  );
  assert.equal(state.message, ORIGINAL_PROSE, 'failed repair must restore the original prose without stale markers');
  assert.doesNotMatch(state.message, /MWG_REPAIR_REQUEST|旧的中断请求/);
  assert.deepEqual(state.variables, originalVariables);
  assert.deepEqual(state.chatVariables, originalVariables);
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
        });
      }
      return JSON.stringify({
        reward: { card: [], artifact: [], item: [], limits: {} },
        add_cards: [{
          id: 'reload_eclipse_scar',
          name: '重启蚀痕',
          description: '星蚀力量在战败后留下持续反噬。',
          cost: 1,
          effects: [
            { damage: 3, to: 'self' },
            { apply_status: 'star_marrow_siphon', stacks: 1, to: 'self' },
          ],
          ethereal: true,
        }],
        add_artifacts: [{
          id: 'star_marrow_stain',
          name: '星髓污染',
          description: '星髓留下的持久污染。',
          effects: { apply_status: 'star_marrow_siphon', stacks: 1, to: 'self' },
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

console.log(
  'Persistent MVU repair survives iframe rebuilds, scopes cards, and safely completes structured battle settlement after reload.',
);
