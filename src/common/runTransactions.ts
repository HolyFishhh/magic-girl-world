import {
  applyCardUpgrade,
  applyCardUpgradeToDeck,
  applyPersistentDeckMutation,
  completeRunNode,
  migratePersistentRunDeck,
  planRestHeal,
  planShopPurchase,
  requireActiveRunNode,
  spendRunGold,
  type RunState,
} from '../game-core';
import { consumePendingRunResultInStat, readRunState } from '../runtime/runStateAdapter';
import {
  applyRewardSelectionsToStat,
  mutateRewardPoolInStat,
  normalizeMvuList,
  readRewardLimits,
  type RewardPoolMutationResult,
  type RewardSelections,
  type RewardSelectionSummary,
} from './rewardTransactions';
import { normalizeMvuStatusDefinitions } from '../runtime/mvuArrays';
import type { RewardPoolMutation } from '../game-core/rewardSettlement';
import { validateRewardCandidateAgainstLibrary } from '../game-core/rewardCandidateValidation';
import {
  executeRunTransactionTriggers,
  type RunTriggerInvocation,
} from './runTransactionTriggers';

export interface RestHealResult {
  healed: number;
  hp: number;
  run: RunState;
}

export interface RestUpgradeResult {
  cardName: string;
  level: number;
  run: RunState;
}

export interface ShopSettlementResult extends RewardSelectionSummary {
  spentGold: number;
  remainingGold: number;
  run: RunState;
}

export interface EventRewardSettlementResult extends RewardSelectionSummary {
  run: RunState;
}

export type RunTransactionSourceKind = 'player' | 'artifact' | 'ability' | 'status' | 'event' | 'system';

export interface RunTransactionSource {
  kind: RunTransactionSourceKind;
  id: string;
}

export type RunTransactionEventType =
  | 'reward_claimed'
  | 'event_reward_claimed'
  | 'reward_pool_changed'
  | 'shop_purchased'
  | 'shop_left'
  | 'rest_healed'
  | 'card_removed'
  | 'card_duplicated'
  | 'card_transformed'
  | 'card_upgraded';

export type UnifiedRunTransactionRequest = (
  | { kind: 'reward_claim'; selections: RewardSelections }
  | { kind: 'event_reward_claim'; selections: RewardSelections }
  | { kind: 'reward_pool'; mutation: RewardPoolMutation; goldCost?: number }
  | { kind: 'shop_purchase'; selections: RewardSelections }
  | { kind: 'shop_leave' }
  | { kind: 'rest_heal'; ratio?: number }
  | { kind: 'rest_remove_card'; runInstanceId: string }
  | { kind: 'rest_duplicate_card'; runInstanceId: string }
  | {
      kind: 'rest_transform_card';
      runInstanceId: string;
      replacement: Record<string, unknown>;
    }
  | {
      kind: 'rest_upgrade_card';
      runInstanceId: string;
      patch: Record<string, unknown>;
    }
) & { expectedRevision?: number; source?: RunTransactionSource };

export interface RunTransactionEvent {
  id: string;
  sequence: number;
  type: RunTransactionEventType;
  source: RunTransactionSource;
  nodeId: string | null;
  nodeKind: string | null;
  cardRunInstanceIds: string[];
  goldDelta: number;
}

export interface RunTransactionCounters {
  total: number;
  by_event: Partial<Record<RunTransactionEventType, number>>;
  by_source: Record<string, number>;
}

export interface RunTransactionLogEntry {
  id: string;
  revision: number;
  kind: UnifiedRunTransactionRequest['kind'];
  nodeId: string | null;
  goldBefore: number | null;
  goldAfter: number | null;
  cardRunInstanceIds: string[];
  source: RunTransactionSource;
  eventId: string;
  summary: string;
}

export interface UnifiedRunTransactionResult {
  revision: number;
  log: RunTransactionLogEntry;
  event: RunTransactionEvent;
  counters: RunTransactionCounters;
  triggerInvocations: RunTriggerInvocation[];
  value:
    | RewardSelectionSummary
    | RewardPoolMutationResult
    | ShopSettlementResult
    | RestUpgradeResult
    | RestHealResult
    | RunState
    | { runInstanceId: string; cardName: string }
    | { sourceRunInstanceId: string; createdRunInstanceId: string; cardName: string };
}

const RUN_TRANSACTION_LOG_LIMIT = 200;
const RUN_TRANSACTION_EVENT_LIMIT = 200;
const RUN_SOURCE_KINDS = new Set<RunTransactionSourceKind>(['player', 'artifact', 'ability', 'status', 'event', 'system']);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function requireRecord(value: unknown, message: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, any>;
}

function replaceMvuList(root: Record<string, any>, key: string, values: Record<string, unknown>[]): void {
  root[key] = values;
}

function replaceRecord(target: Record<string, any>, source: Record<string, any>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function transactionRevision(stat: Record<string, any>): number {
  const value = stat.run_transaction_revision ?? 0;
  if (!Number.isInteger(value) || value < 0 || value > 999999) {
    throw new Error('run transaction revision is invalid');
  }
  return value;
}

function transactionLog(stat: Record<string, any>): RunTransactionLogEntry[] {
  const value = stat.run_transaction_log ?? [];
  if (!Array.isArray(value)) throw new Error('run transaction log is invalid');
  return clone(value) as RunTransactionLogEntry[];
}

function transactionEvents(stat: Record<string, any>): RunTransactionEvent[] {
  const value = stat.run_transaction_events ?? [];
  if (!Array.isArray(value)) throw new Error('run transaction events are invalid');
  return clone(value) as RunTransactionEvent[];
}

function transactionCounters(stat: Record<string, any>): RunTransactionCounters {
  const value = stat.run_transaction_counters ?? { total: 0, by_event: {}, by_source: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('run transaction counters are invalid');
  const total = Number(value.total ?? 0);
  if (!Number.isInteger(total) || total < 0) throw new Error('run transaction counter total is invalid');
  const byEvent = value.by_event ?? {};
  const bySource = value.by_source ?? {};
  if (!byEvent || typeof byEvent !== 'object' || Array.isArray(byEvent)) throw new Error('run event counters are invalid');
  if (!bySource || typeof bySource !== 'object' || Array.isArray(bySource)) throw new Error('run source counters are invalid');
  for (const count of [...Object.values(byEvent), ...Object.values(bySource)]) {
    if (!Number.isInteger(count) || Number(count) < 0) throw new Error('run transaction counter is invalid');
  }
  return { total, by_event: clone(byEvent), by_source: clone(bySource) };
}

function transactionSource(request: UnifiedRunTransactionRequest): RunTransactionSource {
  const source = request.source || { kind: 'player' as const, id: 'common-ui' };
  if (!RUN_SOURCE_KINDS.has(source.kind) || typeof source.id !== 'string' || !source.id.trim() || source.id.length > 96) {
    throw new Error('run transaction source is invalid');
  }
  return { kind: source.kind, id: source.id.trim() };
}

function transactionEventType(kind: UnifiedRunTransactionRequest['kind']): RunTransactionEventType {
  const events: Record<UnifiedRunTransactionRequest['kind'], RunTransactionEventType> = {
    reward_claim: 'reward_claimed',
    event_reward_claim: 'event_reward_claimed',
    reward_pool: 'reward_pool_changed',
    shop_purchase: 'shop_purchased',
    shop_leave: 'shop_left',
    rest_heal: 'rest_healed',
    rest_remove_card: 'card_removed',
    rest_duplicate_card: 'card_duplicated',
    rest_transform_card: 'card_transformed',
    rest_upgrade_card: 'card_upgraded',
  };
  return events[kind];
}

function incrementTransactionCounters(
  counters: RunTransactionCounters,
  event: RunTransactionEvent,
): RunTransactionCounters {
  const sourceKey = `${event.source.kind}:${event.source.id}`;
  return {
    total: counters.total + 1,
    by_event: {
      ...counters.by_event,
      [event.type]: (counters.by_event[event.type] || 0) + 1,
    },
    by_source: {
      ...counters.by_source,
      [sourceKey]: (counters.by_source[sourceKey] || 0) + 1,
    },
  };
}

function currentNodeId(stat: Record<string, any>): string | null {
  return typeof stat.run?.currentNode?.id === 'string' ? stat.run.currentNode.id : null;
}

function currentNodeKind(stat: Record<string, any>): string | null {
  return typeof stat.run?.currentNode?.kind === 'string' ? stat.run.currentNode.kind : null;
}

function runGold(stat: Record<string, any>): number | null {
  return Number.isInteger(stat.run?.gold) ? Number(stat.run.gold) : null;
}

function persistentDeck(stat: Record<string, any>): Record<string, any>[] {
  const battle = requireRecord(stat.battle, 'battle 数据不存在');
  const cards = normalizeMvuList<Record<string, any>>(battle.cards);
  const migrated = migratePersistentRunDeck(cards);
  replaceMvuList(battle, 'cards', migrated);
  return migrated;
}

function selectedRunCard(cards: readonly Record<string, any>[], runInstanceId: string): Record<string, any> {
  const matches = cards.filter(card => card.runInstanceId === runInstanceId);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? 'selected run card was not found' : 'selected run card identity is ambiguous');
  }
  return matches[0];
}

function preparePersistentReplacement(
  stat: Record<string, any>,
  cards: readonly Record<string, any>[],
  sourceRunInstanceId: string,
  replacement: Record<string, unknown>,
): Record<string, unknown> {
  const battle = requireRecord(stat.battle, 'battle 数据不存在');
  const prepared = clone(replacement);
  for (const key of [
    'runInstanceId',
    'runInstanceIds',
    'combatInstanceId',
    'parentCombatInstanceId',
    'parentRunInstanceId',
    'templateId',
    'origin',
    '$meta',
    'upgrade_level',
  ]) delete prepared[key];
  const statusDefinitions = normalizeMvuStatusDefinitions(battle.statuses);
  const supportStatus = prepared.status;
  if (supportStatus !== undefined && (!supportStatus || typeof supportStatus !== 'object' || Array.isArray(supportStatus))) {
    throw new Error('卡牌变形失败：候选 status 必须是状态定义对象');
  }
  if (supportStatus && typeof supportStatus === 'object') {
    const supportId = String((supportStatus as Record<string, unknown>).id || '');
    const existing = statusDefinitions.find(status => status.id === supportId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(supportStatus)) {
        throw new Error(`卡牌变形失败：状态 ${supportId} 已存在但定义不同`);
      }
      delete prepared.status;
    }
  }
  const validation = validateRewardCandidateAgainstLibrary('cards', prepared, {
    existing: cards.filter(card => card.runInstanceId !== sourceRunInstanceId),
    statusDefinitions,
    knownResourceIds: normalizeMvuList<Record<string, any>>(battle.core?.resources)
      .map(resource => String(resource?.id || ''))
      .filter(Boolean),
  });
  if (!validation.ok) throw new Error(`卡牌变形失败：${validation.message}`);
  if (prepared.status && typeof prepared.status === 'object') {
    const statuses = Array.isArray(battle.statuses) ? battle.statuses : null;
    if (!statuses) throw new Error('卡牌变形失败：battle.statuses 不是数组');
    statuses.push(clone(prepared.status));
    delete prepared.status;
  }
  return prepared;
}

function logSummary(
  request: UnifiedRunTransactionRequest,
  value: UnifiedRunTransactionResult['value'],
): string {
  if (request.kind === 'reward_claim') {
    const summary = value as RewardSelectionSummary;
    return `领取奖励：${[...summary.cards, ...summary.artifacts, ...summary.items].join('、') || '跳过'}`;
  }
  if (request.kind === 'event_reward_claim') {
    const summary = value as RewardSelectionSummary;
    return `领取事件奖励：${[...summary.cards, ...summary.artifacts, ...summary.items].join('、') || '跳过'}`;
  }
  if (request.kind === 'reward_pool') {
    const pool = value as RewardPoolMutationResult;
    return `修改奖励池：${pool.changedCategories.join('、')}（版本 ${pool.revision}）`;
  }
  if (request.kind === 'shop_purchase') {
    return `商店结算：花费 ${(value as ShopSettlementResult).spentGold} 金币`;
  }
  if (request.kind === 'shop_leave') return '离开商店';
  if (request.kind === 'rest_heal') return `营火恢复：${(value as RestHealResult).healed} 生命`;
  if (request.kind === 'rest_upgrade_card') return `营火升级：${(value as RestUpgradeResult).cardName}`;
  if (request.kind === 'rest_duplicate_card') return `营火复制：${(value as { cardName: string }).cardName}`;
  if (request.kind === 'rest_transform_card') return `营火变形：${(value as { cardName: string }).cardName}`;
  return `营火删卡：${(value as { cardName: string }).cardName}`;
}

function requireActiveNode(stat: Record<string, any>, kind: 'rest' | 'shop' | 'event'): RunState {
  const run = readRunState(stat);
  if (!run) {
    const labels = { rest: '营火', shop: '商店', event: '事件' } as const;
    throw new Error(`当前不在${labels[kind]}节点`);
  }
  try {
    requireActiveRunNode(run, kind);
  } catch {
    const labels = { rest: '营火', shop: '商店', event: '事件' } as const;
    throw new Error(`当前不在${labels[kind]}节点`);
  }
  return run;
}

export function settleRestHealInStat(statValue: unknown, ratio = 0.3): RestHealResult {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  const run = requireActiveNode(stat, 'rest');
  const battle = requireRecord(stat.battle, 'battle 数据不存在');
  const core = requireRecord(battle.core, 'battle.core 数据不存在');
  const hp = Number(core.hp);
  const maxHp = Number(core.max_hp);
  const plan = planRestHeal({ run, hp, maxHp, ratio });
  core.hp = plan.hp;
  stat.run = plan.run;
  stat.run_upgrade = null;
  return plan;
}

export function settleRestUpgradeInStat(statValue: unknown): RestUpgradeResult {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  const run = requireActiveNode(stat, 'rest');
  const upgradeNodeId =
    stat.run_upgrade && typeof stat.run_upgrade === 'object' && !Array.isArray(stat.run_upgrade)
      ? stat.run_upgrade.node_id
      : undefined;
  if (typeof upgradeNodeId !== 'string' || upgradeNodeId !== run.currentNode?.id) {
    throw new Error('营火升级所属路线节点已过期');
  }
  const battle = requireRecord(stat.battle, 'battle 数据不存在');
  const cards = normalizeMvuList<Record<string, unknown>>(battle.cards);
  const statusDefinitions = normalizeMvuStatusDefinitions(battle.statuses);
  const knownResourceIds = normalizeMvuList<Record<string, any>>(battle.core?.resources)
    .map(resource => String(resource?.id || ''))
    .filter(Boolean);
  const upgraded = applyCardUpgradeToDeck(cards, stat.run_upgrade, { statusDefinitions, knownResourceIds });
  if (!upgraded.ok) throw new Error(`卡牌升级失败：${upgraded.message}`);
  if (!upgraded.cards) throw new Error('卡牌升级失败：升级牌组未生成');
  const nextRun = completeRunNode(run, { outcome: 'cleared' });
  replaceMvuList(battle, 'cards', upgraded.cards);
  stat.run = nextRun;
  stat.run_upgrade = null;
  return { cardName: String(upgraded.card.name || upgraded.card.id), level: upgraded.level, run: nextRun };
}

function stripShopPrices(reward: Record<string, any>): void {
  for (const key of ['card', 'artifact', 'item']) {
    for (const candidate of normalizeMvuList<Record<string, unknown>>(reward[key])) delete candidate.price;
  }
}

/** Validate on a clone, then commit rewards, gold, and route completion together. */
export function settleShopSelectionsInStat(
  statValue: unknown,
  selections: RewardSelections,
): ShopSettlementResult {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  const run = requireActiveNode(stat, 'shop');
  const reward = requireRecord(stat.reward, 'reward 数据不存在');
  const purchase = planShopPurchase({
    run,
    selections,
    limits: readRewardLimits(stat),
    candidates: {
      cards: normalizeMvuList(reward.card),
      artifacts: normalizeMvuList(reward.artifact),
      items: normalizeMvuList(reward.item),
    },
  });
  const draft = clone(stat);
  stripShopPrices(requireRecord(draft.reward, 'reward 数据不存在'));
  const summary = applyRewardSelectionsToStat(draft, purchase.selections);
  stat.battle = draft.battle;
  stat.reward = draft.reward;
  stat.run = purchase.run;
  stat.run_upgrade = null;
  return { ...summary, spentGold: purchase.spentGold, remainingGold: purchase.remainingGold, run: purchase.run };
}

/** Commit an event outcome and its optional reward selection as one MUV transaction. */
export function settleEventRewardSelectionsInStat(
  statValue: unknown,
  selections: RewardSelections,
): EventRewardSettlementResult {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  requireActiveNode(stat, 'event');
  if (stat.run_result == null) throw new Error('事件结果尚未生成');

  const draft = clone(stat);
  const summary = applyRewardSelectionsToStat(draft, selections);
  const settlement = consumePendingRunResultInStat(draft);
  if (!settlement) throw new Error('事件结果尚未生成');

  stat.battle = draft.battle;
  stat.reward = draft.reward;
  stat.run = draft.run;
  stat.run_result = draft.run_result;
  stat.run_upgrade = draft.run_upgrade;
  return { ...summary, run: settlement.run };
}

export function leaveShopInStat(statValue: unknown): RunState {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  const run = requireActiveNode(stat, 'shop');
  const nextRun = completeRunNode(run, { outcome: 'cleared' });
  let reward: Record<string, any> | null = null;
  try {
    reward = requireRecord(stat.reward, '');
  } catch {
    reward = null;
  }
  if (reward) {
    reward.card = [];
    reward.artifact = [];
    reward.item = [];
    reward.limits = {};
  }
  stat.run = nextRun;
  stat.run_upgrade = null;
  return nextRun;
}

/**
 * One atomic entry point for persistent reward/shop/campfire changes. The complete stat root is
 * drafted first; currency, candidates, deck, route, revision, and journal commit together only
 * after every validator succeeds.
 */
export function executeUnifiedRunTransactionInStat(
  statValue: unknown,
  request: UnifiedRunTransactionRequest,
): UnifiedRunTransactionResult {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  if (!request || typeof request !== 'object') throw new Error('run transaction request is invalid');
  const revision = transactionRevision(stat);
  if (request.expectedRevision !== undefined && request.expectedRevision !== revision) {
    throw new Error(`stale run transaction revision: expected ${request.expectedRevision}, actual ${revision}`);
  }

  const draft = clone(stat);
  const goldBefore = runGold(draft);
  const nodeId = currentNodeId(draft);
  const nodeKind = currentNodeKind(draft);
  const cardRunInstanceIds: string[] = [];
  let value: UnifiedRunTransactionResult['value'];

  if (request.kind === 'reward_claim') {
    value = applyRewardSelectionsToStat(draft, request.selections);
    persistentDeck(draft);
  } else if (request.kind === 'event_reward_claim') {
    value = settleEventRewardSelectionsInStat(draft, request.selections);
    persistentDeck(draft);
  } else if (request.kind === 'reward_pool') {
    if (request.goldCost !== undefined) {
      if (!Number.isInteger(request.goldCost) || request.goldCost < 0) {
        throw new Error('reward pool gold cost must be a non-negative integer');
      }
      if (!draft.run) throw new Error('reward pool gold cost requires an active run');
      draft.run = spendRunGold(draft.run, request.goldCost);
    }
    value = mutateRewardPoolInStat(draft, request.mutation);
  } else if (request.kind === 'shop_purchase') {
    value = settleShopSelectionsInStat(draft, request.selections);
    persistentDeck(draft);
  } else if (request.kind === 'shop_leave') {
    value = leaveShopInStat(draft);
  } else if (request.kind === 'rest_heal') {
    value = settleRestHealInStat(draft, request.ratio);
  } else {
    const run = requireActiveNode(draft, 'rest');
    const battle = requireRecord(draft.battle, 'battle 数据不存在');
    const cards = persistentDeck(draft);
    const source = selectedRunCard(cards, request.runInstanceId);
    cardRunInstanceIds.push(source.runInstanceId);

    if (request.kind === 'rest_upgrade_card') {
      if (!request.patch || typeof request.patch !== 'object' || Array.isArray(request.patch)) {
        throw new Error('营火升级补丁无效');
      }
      if (request.patch.node_id !== undefined && request.patch.node_id !== run.currentNode?.id) {
        throw new Error('营火升级所属路线节点已过期');
      }
      if (request.patch.card_id !== undefined && request.patch.card_id !== source.id) {
        throw new Error('营火升级卡牌身份不匹配');
      }
      const upgraded = applyCardUpgrade(
        source,
        { ...clone(request.patch), node_id: run.currentNode!.id, card_id: source.id },
        {
          statusDefinitions: normalizeMvuStatusDefinitions(battle.statuses),
          knownResourceIds: normalizeMvuList<Record<string, any>>(battle.core?.resources)
            .map(resource => String(resource?.id || ''))
            .filter(Boolean),
        },
      );
      if (!upgraded.ok) throw new Error(`卡牌升级失败：${upgraded.message}`);
      const index = cards.findIndex(card => card.runInstanceId === source.runInstanceId);
      cards[index] = { ...upgraded.card, runInstanceId: source.runInstanceId, templateId: source.templateId, quantity: 1 };
      replaceMvuList(battle, 'cards', cards);
      const nextRun = completeRunNode(run, { outcome: 'cleared' });
      draft.run = nextRun;
      draft.run_upgrade = null;
      delete draft.run_upgrade_target;
      value = {
        cardName: String(upgraded.card.name || upgraded.card.id),
        level: upgraded.level,
        run: nextRun,
      };
    } else if (request.kind === 'rest_transform_card') {
      const replacement = preparePersistentReplacement(draft, cards, source.runInstanceId, request.replacement);
      const result = applyPersistentDeckMutation(cards, {
        kind: 'transform',
        runInstanceId: source.runInstanceId,
        replacement: replacement as any,
      });
      replaceMvuList(battle, 'cards', result.cards);
      draft.run = completeRunNode(run, { outcome: 'cleared' });
      draft.run_upgrade = null;
      draft.run_transform = null;
      delete draft.run_transform_target;
      value = { runInstanceId: source.runInstanceId, cardName: String(replacement.name || replacement.id) };
    } else if (request.kind === 'rest_duplicate_card') {
      const result = applyPersistentDeckMutation(cards, {
        kind: 'duplicate',
        runInstanceId: source.runInstanceId,
      });
      replaceMvuList(battle, 'cards', result.cards);
      draft.run = completeRunNode(run, { outcome: 'cleared' });
      draft.run_upgrade = null;
      cardRunInstanceIds.push(result.createdRunInstanceId!);
      value = {
        sourceRunInstanceId: source.runInstanceId,
        createdRunInstanceId: result.createdRunInstanceId!,
        cardName: String(source.name || source.id),
      };
    } else {
      const result = applyPersistentDeckMutation(cards, {
        kind: 'remove',
        runInstanceId: source.runInstanceId,
      });
      replaceMvuList(battle, 'cards', result.cards);
      draft.run = completeRunNode(run, { outcome: 'cleared' });
      draft.run_upgrade = null;
      value = { runInstanceId: source.runInstanceId, cardName: String(source.name || source.id) };
    }
  }

  const nextRevision = revision + 1;
  const source = transactionSource(request);
  const primaryGoldAfter = runGold(draft);
  const event: RunTransactionEvent = {
    id: `${draft.run?.seed ?? 'story'}:${nextRevision}:${transactionEventType(request.kind)}`,
    sequence: nextRevision,
    type: transactionEventType(request.kind),
    source,
    nodeId,
    nodeKind,
    cardRunInstanceIds: [...cardRunInstanceIds],
    goldDelta: goldBefore === null || primaryGoldAfter === null ? 0 : primaryGoldAfter - goldBefore,
  };
  const triggerExecution = executeRunTransactionTriggers(draft, event);
  const goldAfter = runGold(draft);
  event.goldDelta = goldBefore === null || goldAfter === null ? 0 : goldAfter - goldBefore;
  const log: RunTransactionLogEntry = {
    id: `${draft.run?.seed ?? 'story'}:${nextRevision}:${request.kind}`,
    revision: nextRevision,
    kind: request.kind,
    nodeId,
    goldBefore,
    goldAfter,
    cardRunInstanceIds,
    source,
    eventId: event.id,
    summary: logSummary(request, value),
  };
  const logs = transactionLog(draft);
  const events = transactionEvents(draft);
  const counters = incrementTransactionCounters(transactionCounters(draft), event);
  logs.push(log);
  events.push(event);
  draft.run_transaction_revision = nextRevision;
  draft.run_transaction_log = logs.slice(-RUN_TRANSACTION_LOG_LIMIT);
  draft.run_transaction_events = events.slice(-RUN_TRANSACTION_EVENT_LIMIT);
  draft.run_transaction_counters = counters;
  replaceRecord(stat, draft);
  return {
    revision: nextRevision,
    log: clone(log),
    event: clone(event),
    counters: clone(counters),
    triggerInvocations: clone(triggerExecution.invocations),
    value: clone(value),
  };
}
