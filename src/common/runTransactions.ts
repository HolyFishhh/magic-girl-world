import { validateTowerOpeningRewardCandidates } from '../game-core/towerOpeningOutcome';
import { applyOpeningDeckTransforms } from '../game-core/towerOpeningTransforms';
import { preparePersistentReplacement } from './persistentReplacement';
import { hasPendingInitialArtifactAcquisition, settleInitialArtifactAcquisitionInStat } from './initialArtifactAcquisition';
import { applyNonCombatSettlementInStat, type NonCombatAnswers } from './nonCombatSettlementTransactions';
import { parseTowerEventFlow, requireTowerEventStage, towerEventRandomKey, type TowerEventFlowState } from '../game-core/towerEventFlow';
import { materializeTowerEventStageInStat } from '../runtime/towerEventState';
import { towerShopRemovalPrice } from '../game-core/contentBudget';
import {
  applyCardUpgrade,
  applyCardUpgradeToDeck,
  applyPersistentDeckMutation,
  consumeTowerOpening,
  completeRunNode,
  enterRunNode,
  getOpeningTreasureNode,
  migratePersistentRunDeck,
  planTowerEventOutcome,
  planTowerEventResourceSettlement,
  planTowerOpeningOutcome,
  fitTowerRewardItems,
  planRestHeal,
  planShopPurchase,
  requireActiveRunNode,
  spendRunGold,
  type RunState,
} from '../game-core';
import { consumePendingRunResultInStat, readRunState } from '../runtime/runStateAdapter';
import {
  applyRewardSelectionsToStat,
  applyFixedRewardGrant,
  mutateRewardPoolInStat,
  normalizeMvuList,
  readRewardLimits,
  type RewardPoolMutationResult,
  type RewardSelections,
  type RewardSelectionSummary,
  type RewardApplicationOptions,
} from './rewardTransactions';
import { normalizeMvuStatusDefinitions } from '../runtime/mvuArrays';
import type { RewardPoolMutation } from '../game-core/rewardSettlement';
import { CAMPFIRE_RULES, campfireGold } from '../game-core/towerCampfire';
import { availableTowerMemoryCards } from '../runtime/towerCardMemory';
import { rememberTowerCardOffer } from '../game-core/towerCardMemory';
import {
  readRewardCandidateSupportStatuses,
  rewardStatusDefinitionsEqual,
  validateRewardCandidateAgainstLibrary,
} from '../game-core/rewardCandidateValidation';
import { executeRunTransactionTriggers, type RunTriggerInvocation } from './runTransactionTriggers';

export interface CampfireResult { action: 'train' | 'scavenge' | 'recall'; summary: string; run: RunState }

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

export interface TowerOpeningSettlementResult extends RewardSelectionSummary {
  choiceId: string;
  hp: number;
  maxHp: number;
  gold: number;
  cardRemovalCount: number;
  run: RunState;
}

export interface TowerEventChoiceSettlementResult {
  choiceId: string;
  pendingReward: boolean;
  stageAdvanced?: boolean;
  hp: number;
  maxHp: number;
  gold: number;
  cardRemovalCount: number;
  resourceChanges: Array<{
    id: string;
    name: string;
    delta: number;
    before: number;
    after: number;
  }>;
  run: RunState;
}

export type RunTransactionSourceKind = 'player' | 'artifact' | 'ability' | 'status' | 'event' | 'system';

export interface RunTransactionSource {
  kind: RunTransactionSourceKind;
  id: string;
}

export type RunTransactionEventType =
  | 'reward_claimed'
  | 'treasure_claimed'
  | 'event_reward_claimed'
  | 'event_step_settled'
  | 'initial_artifacts_acquired'
  | 'reward_pool_changed'
  | 'shop_purchased'
  | 'shop_left'
  | 'rest_healed'
  | 'rest_completed'
  | 'card_removed'
  | 'card_duplicated'
  | 'card_transformed'
  | 'card_upgraded';

export type UnifiedRunTransactionRequest = (
  | { kind: 'reward_claim'; selections: RewardSelections; partial?: boolean; claimGold?: boolean; discardGold?: boolean; cardGroupId?: string }
  | { kind: 'treasure_reward_claim'; selections: RewardSelections }
  | { kind: 'event_reward_claim'; selections: RewardSelections }
  | { kind: 'event_step'; choiceId: string; stageId?: string; expectedEventRevision?: number; answers?: NonCombatAnswers }
  | { kind: 'initial_artifact_acquisition'; generationId: string; answers: Record<string, NonCombatAnswers> }
  | { kind: 'reward_pool'; mutation: RewardPoolMutation; goldCost?: number }
  | { kind: 'shop_purchase'; selections: RewardSelections }
  | { kind: 'shop_leave' }
  | { kind: 'shop_remove_card'; runInstanceId: string }
  | { kind: 'allowance_remove_card'; runInstanceId: string }
  | { kind: 'rest_heal'; ratio?: number }
  | { kind: 'rest_action'; action: 'train' | 'scavenge' | 'recall'; cardId?: string }
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
) & { expectedRevision?: number; source?: RunTransactionSource; acquisitionAnswers?: Record<string, NonCombatAnswers>;
  acquisitionPreview?: RewardApplicationOptions['acquisitionPreview'] };

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
    | CampfireResult
    | TowerEventChoiceSettlementResult
    | { artifactNames: string[] }
    | RunState
    | { runInstanceId: string; cardName: string }
    | { sourceRunInstanceId: string; createdRunInstanceId: string; cardName: string };
}

const RUN_TRANSACTION_LOG_LIMIT = 200;
const RUN_TRANSACTION_EVENT_LIMIT = 200;
const RUN_SOURCE_KINDS = new Set<RunTransactionSourceKind>([
  'player',
  'artifact',
  'ability',
  'status',
  'event',
  'system',
]);

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
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('run transaction counters are invalid');
  const total = Number(value.total ?? 0);
  if (!Number.isInteger(total) || total < 0) throw new Error('run transaction counter total is invalid');
  const byEvent = value.by_event ?? {};
  const bySource = value.by_source ?? {};
  if (!byEvent || typeof byEvent !== 'object' || Array.isArray(byEvent))
    throw new Error('run event counters are invalid');
  if (!bySource || typeof bySource !== 'object' || Array.isArray(bySource))
    throw new Error('run source counters are invalid');
  for (const count of [...Object.values(byEvent), ...Object.values(bySource)]) {
    if (!Number.isInteger(count) || Number(count) < 0) throw new Error('run transaction counter is invalid');
  }
  return { total, by_event: clone(byEvent), by_source: clone(bySource) };
}

function transactionSource(request: UnifiedRunTransactionRequest): RunTransactionSource {
  const source = request.source || { kind: 'player' as const, id: 'common-ui' };
  if (
    !RUN_SOURCE_KINDS.has(source.kind) ||
    typeof source.id !== 'string' ||
    !source.id.trim() ||
    source.id.length > 96
  ) {
    throw new Error('run transaction source is invalid');
  }
  return { kind: source.kind, id: source.id.trim() };
}

function transactionEventType(kind: UnifiedRunTransactionRequest['kind']): RunTransactionEventType {
  const events: Record<UnifiedRunTransactionRequest['kind'], RunTransactionEventType> = {
    reward_claim: 'reward_claimed',
    treasure_reward_claim: 'treasure_claimed',
    event_reward_claim: 'event_reward_claimed',
    event_step: 'event_step_settled',
    initial_artifact_acquisition: 'initial_artifacts_acquired',
    reward_pool: 'reward_pool_changed',
    shop_purchase: 'shop_purchased',
    shop_leave: 'shop_left',
    shop_remove_card: 'card_removed',
    allowance_remove_card: 'card_removed',
    rest_heal: 'rest_healed',
    rest_action: 'rest_completed',
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
    throw new Error(
      matches.length === 0 ? 'selected run card was not found' : 'selected run card identity is ambiguous',
    );
  }
  return matches[0];
}


function logSummary(request: UnifiedRunTransactionRequest, value: UnifiedRunTransactionResult['value'], goldDelta = 0): string {
  if (request.kind === 'initial_artifact_acquisition') return '已结算初始遗物的获得时效果';
  if (request.kind === 'event_step') return `事件选择：${request.choiceId}`;
  if (request.kind === 'reward_claim') {
    const summary = value as RewardSelectionSummary;
    return `领取奖励：${[...(request.claimGold ? [`${Math.max(0, goldDelta)} 金币`] : []), ...summary.cards, ...summary.artifacts, ...summary.items].join('、') || '跳过'}`;
  }
  if (request.kind === 'treasure_reward_claim') {
    const summary = value as RewardSelectionSummary;
    return `开启宝箱：${[...summary.cards, ...summary.artifacts, ...summary.items].join('、') || '未取得物品'}`;
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
  if (request.kind === 'allowance_remove_card') return `使用删卡次数：${(value as {cardName:string}).cardName}`;
  if (request.kind === 'shop_remove_card') return `商店删卡：${(value as {cardName:string}).cardName}`;
  if (request.kind === 'rest_heal') return `营火恢复：${(value as RestHealResult).healed} 生命`;
  if (request.kind === 'rest_action') return (value as CampfireResult).summary;
  if (request.kind === 'rest_upgrade_card') return `营火升级：${(value as RestUpgradeResult).cardName}`;
  if (request.kind === 'rest_duplicate_card') return `营火复制：${(value as { cardName: string }).cardName}`;
  if (request.kind === 'rest_transform_card') return `营火变形：${(value as { cardName: string }).cardName}`;
  return `营火删卡：${(value as { cardName: string }).cardName}`;
}

function requireActiveNode(stat: Record<string, any>, kind: 'rest' | 'shop' | 'event' | 'treasure'): RunState {
  const run = readRunState(stat);
  if (!run) {
    const labels = { rest: '营火', shop: '商店', event: '事件', treasure: '宝箱' } as const;
    throw new Error(`当前不在${labels[kind]}节点`);
  }
  try {
    requireActiveRunNode(run, kind);
  } catch {
    const labels = { rest: '营火', shop: '商店', event: '事件', treasure: '宝箱' } as const;
    throw new Error(`当前不在${labels[kind]}节点`);
  }
  return run;
}

function clearTowerNodePayload(stat: Record<string, any>): void {
  stat.run_node = null;
  stat.run_node_reward = null;
  stat.run_event = null;
  stat.run_event_state = null;
  stat.run_shop = null;
  stat.run_treasure = null;
  stat.run_rest = null;
}

function hasRewardCandidates(reward: Record<string, any>): boolean {
  return ['card', 'artifact', 'item'].some(key => normalizeMvuList(reward[key]).length > 0);
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
  clearTowerNodePayload(stat);
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
  const upgraded = applyCardUpgradeToDeck(cards, stat.run_upgrade, {
    playerDesireEffect: battle.player_lust_effect,
    statusDefinitions,
    knownResourceIds,
  });
  if (!upgraded.ok) throw new Error(`卡牌升级失败：${upgraded.message}`);
  if (!upgraded.cards) throw new Error('卡牌升级失败：升级牌组未生成');
  const nextRun = completeRunNode(run, { outcome: 'cleared' });
  replaceMvuList(battle, 'cards', upgraded.cards);
  stat.run = nextRun;
  stat.run_upgrade = null;
  clearTowerNodePayload(stat);
  return { cardName: String(upgraded.card.name || upgraded.card.id), level: upgraded.level, run: nextRun };
}

function stripShopPrices(reward: Record<string, any>): void {
  for (const key of ['card', 'artifact', 'item']) {
    for (const candidate of normalizeMvuList<Record<string, unknown>>(reward[key])) delete candidate.price;
  }
}

/** Validate on a clone, then commit the purchase while keeping the shop open. */
export function settleShopSelectionsInStat(statValue: unknown, selections: RewardSelections, acquisitionAnswers?: Record<string, NonCombatAnswers>, acquisitionPreview?: RewardApplicationOptions['acquisitionPreview']): ShopSettlementResult {
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
  draft.run = purchase.run;
  stripShopPrices(requireRecord(draft.reward, 'reward 数据不存在'));
  const summary = applyRewardSelectionsToStat(draft, purchase.selections, { acquisitionAnswers, acquisitionPreview });
  {
    for (const [key, category] of [['card','cards'],['artifact','artifacts'],['item','items']] as const)
      draft.reward[key] = normalizeMvuList(reward[key]).filter((_, index) => !purchase.selections[category].includes(index));
    draft.reward.limits = {cards:draft.reward.card.length, artifacts:draft.reward.artifact.length, items:draft.reward.item.length};
    draft.reward.pool_revision = Number(reward.pool_revision || 0) + 1;
  }
  stat.battle = draft.battle;
  stat.reward = draft.reward;
  stat.run = draft.run;
  stat.run_upgrade = null;
  return { ...summary, spentGold: purchase.spentGold, remainingGold: stat.run.gold, run: stat.run };
}

/** Commit an event outcome and its optional reward selection as one MUV transaction. */
export function settleEventRewardSelectionsInStat(
  statValue: unknown,
  selections: RewardSelections,
  acquisitionAnswers?: Record<string, NonCombatAnswers>,
  acquisitionPreview?: RewardApplicationOptions['acquisitionPreview'],
): EventRewardSettlementResult {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  requireActiveNode(stat, 'event');
  if (stat.run_result == null) throw new Error('事件结果尚未生成');

  const draft = clone(stat);
  const summary = applyRewardSelectionsToStat(draft, selections, { acquisitionAnswers, acquisitionPreview });
  if (Array.isArray(draft.run_event?.choices)) {
    const offers = draft.run_event.choices.flatMap((choice: any) => { const r = choice?.outcome?.reward; return r?.cards || r?.card || []; });
    draft.run = rememberTowerCardOffer(draft.run, offers, normalizeMvuList<Record<string, any>>(draft.battle?.cards).map(card => card.id));
  }
  const state = draft.run_event_state as TowerEventFlowState | undefined;
  if (state?.phase === 'reward' && state.next_stage) {
    draft.run_result = null;
    materializeTowerEventStageInStat(draft, state.next_stage, state.revision + 1);
  } else {
    const settlement = consumePendingRunResultInStat(draft);
    if (!settlement) throw new Error('事件结果尚未生成');
    clearTowerNodePayload(draft);
  }
  replaceRecord(stat, draft);
  return { ...summary, run: draft.run };
}

/**
 * Select one pre-generated tower event option without asking the narrative AI
 * to repeat the event. Scalar costs are applied to a draft, while optional
 * reward candidates continue through the established event reward transaction.
 */
export function settleTowerEventChoiceInStat(statValue: unknown, choiceId: string, options: {
  stageId?: string; expectedEventRevision?: number; answers?: NonCombatAnswers;
} = {}): TowerEventChoiceSettlementResult {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  const run = requireActiveNode(stat, 'event');
  if (run.routeMode !== 'map' || run.schemaVersion !== 3) throw new Error('当前事件不是爬塔预生成事件');
  if (stat.run_result != null) throw new Error('当前事件选项已经选择，请先完成结算');
  const event = requireRecord(stat.run_event, '事件内容不存在');
  const flow = parseTowerEventFlow(event, planTowerEventOutcome);
  if (flow.version === 2 && (typeof options.stageId !== 'string' || !Number.isInteger(options.expectedEventRevision))) {
    throw new Error('分阶段事件缺少当前阶段身份，请重新打开选择');
  }
  const draft = clone(stat);
  const state: TowerEventFlowState = draft.run_event_state ?? materializeTowerEventStageInStat(draft);
  if (state.node_id !== run.currentNode!.id || state.phase !== 'choosing'
    || (options.stageId !== undefined && state.stage_id !== options.stageId)
    || (options.expectedEventRevision !== undefined && state.revision !== options.expectedEventRevision)) {
    throw new Error('事件阶段已变化，请重新选择');
  }
  const stage = requireTowerEventStage(flow, state.stage_id);
  const matches = stage.choices.filter(choice => choice.id === choiceId);
  if (matches.length !== 1) throw new Error(matches.length ? '事件选项重复' : '事件选项不存在');
  const selected = requireRecord(matches[0], '事件选项无效');
  const outcome = requireRecord(selected.outcome, '事件结果无效');
  const outcomePlan = planTowerEventOutcome(outcome);

  const before = requireRecord(stat.battle?.core, '事件结算失败：玩家状态不存在');
  const settlement = { ...outcome };
  delete settlement.outcome;
  delete settlement.reward;
  const randomTargets = Object.fromEntries(outcomePlan.deckActions.filter(action => action.pick === 'random')
    .map(action => [action.id, state.random_targets[towerEventRandomKey(choiceId, action.id)]]));
  const randomSeeds = Object.fromEntries(outcomePlan.deckActions.filter(action => action.pick === 'random')
    .flatMap(action => {
      const seed = state.random_seeds?.[towerEventRandomKey(choiceId, action.id)];
      return seed === undefined ? [] : [[action.id, seed]];
    }));
  applyNonCombatSettlementInStat(draft, settlement, options.answers ?? {}, {
    seed: JSON.stringify([run.seed, run.currentNode!.id, stage.id, choiceId]),
    randomTargets, randomSeeds, requireFrozenRandom: true, grant: applyFixedRewardGrant,
  });
  const core = draft.battle.core;
  if (outcomePlan.routeOutcome === 'failed') {
    core.hp = Math.min(core.max_hp, Math.max(0, Number(before.hp) - outcomePlan.cost.hp + outcomePlan.hpDelta));
  }
  const hp = core.hp, maxHp = core.max_hp, gold = draft.run.gold;
  const cardRemovalCount = Number(core.card_removal_count ?? 0);
  const beforeResources = new Map(normalizeMvuList<Record<string, any>>(before.resources).map(entry => [entry.id, entry]));
  const resourceChanges = normalizeMvuList<Record<string, any>>(core.resources).flatMap(entry => {
    const old = beforeResources.get(entry.id);
    const oldValue = Number(old?.current ?? old?.start ?? 0), nextValue = Number(entry.current ?? entry.start ?? 0);
    return oldValue === nextValue ? [] : [{ id: String(entry.id), name: String(entry.name || entry.id),
      delta: nextValue - oldValue, before: oldValue, after: nextValue }];
  });
  const offers = stage.choices.flatMap((choice: any) => choice.outcome?.reward?.card || choice.outcome?.reward?.cards || []);
  draft.run = rememberTowerCardOffer(draft.run, offers, normalizeMvuList<Record<string, any>>(draft.battle?.cards).map(card=>card.id));

  const reward =
    outcomePlan.reward === null
      ? { card: [], artifact: [], item: [], limits: {}, disabled_categories: [], pool_revision: 0, reroll_count: 0 }
      : requireRecord(outcome.reward, '事件奖励无效');
  draft.reward = clone(reward);
  draft.run_result = { node_id: run.currentNode!.id, outcome: outcomePlan.routeOutcome };
  if (flow.version === 1) draft.run_event = { ...clone(event), selected_choice_id: choiceId };
  draft.run_event_reveal = { node_id: run.currentNode!.id, choice_id: choiceId,
    label: String(selected.label || ''), outcome: { ...clone(outcome),
      hp: hp - Number(before.hp), max_hp: maxHp - Number(before.max_hp), gold: gold - run.gold,
      lust: Number(core.lust ?? 0) - Number(stat.battle.core.lust ?? 0),
      card_removals: cardRemovalCount - Number(before.card_removal_count ?? 0),
      resources: Object.fromEntries(resourceChanges.map(change => [change.id, change.delta])),
    } };

  let settledRun = draft.run as RunState;
  const pendingReward = hasRewardCandidates(reward);
  const nextStage = outcomePlan.routeOutcome === 'failed' ? undefined : selected.next_stage;
  if (pendingReward) {
    draft.run_event_state = { ...state, phase: 'reward', revision: state.revision + 1,
      ...(nextStage ? { next_stage: nextStage } : {}) };
  } else if (nextStage) {
    draft.run_result = null;
    materializeTowerEventStageInStat(draft, nextStage, state.revision + 1);
  } else {
    const settlement = consumePendingRunResultInStat(draft);
    if (!settlement) throw new Error('事件结算失败：路线结果未生成');
    settledRun = settlement.run;
    clearTowerNodePayload(draft);
  }
  replaceRecord(stat, draft);
  return {
    choiceId,
    pendingReward,
    stageAdvanced: Boolean(nextStage && !pendingReward),
    hp,
    maxHp,
    gold,
    cardRemovalCount,
    resourceChanges,
    run: clone(settledRun),
  };
}

export function leaveShopInStat(statValue: unknown): RunState {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  const run = requireActiveNode(stat, 'shop');
  let nextRun = completeRunNode(run, { outcome: 'cleared' });
  nextRun = rememberTowerCardOffer(nextRun, normalizeMvuList(stat.reward?.card), []);
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
    delete reward.card_choice_groups;
  }
  stat.run = nextRun;
  stat.run_upgrade = null;
  clearTowerNodePayload(stat);
  return nextRun;
}

/**
 * Apply one AI-authored opening choice through existing reward validation. The
 * whole choice is committed once; malformed cards, relics, items, or scalar
 * costs leave both the player and the opening state untouched.
 */
export function settleTowerOpeningChoiceInStat(statValue: unknown, choiceId: string, acquisitionAnswers?: Record<string, NonCombatAnswers>, acquisitionPreview?: RewardApplicationOptions['acquisitionPreview']): TowerOpeningSettlementResult {
  const stat = requireRecord(statValue, 'stat_data 不存在');
  if (hasPendingInitialArtifactAcquisition(stat)) throw new Error('请先完成初始遗物的选择');
  const run = readRunState(stat);
  if (
    !run ||
    run.routeMode !== 'map' ||
    run.phase !== 'awaiting_choice' ||
    run.floor !== 0 ||
    run.opening.phase !== 'ready' ||
    !run.opening.content
  ) {
    throw new Error('当前没有可结算的开局馈赠');
  }
  const content = requireRecord(run.opening.content, '开局馈赠内容无效');
  if (!Array.isArray(content.choices)) throw new Error('开局馈赠选项无效');
  const matches = content.choices.filter(
    (choice: unknown) =>
      choice &&
      typeof choice === 'object' &&
      !Array.isArray(choice) &&
      (choice as Record<string, unknown>).id === choiceId,
  );
  if (matches.length !== 1) throw new Error(matches.length ? '开局馈赠选项重复' : '开局馈赠选项不存在');
  const selected = requireRecord(matches[0], '开局馈赠选项无效');
  const plan = planTowerOpeningOutcome(selected.outcome);
  if (plan.deckTransforms.length) validateTowerOpeningRewardCandidates([selected], stat.battle);

  const draft = clone(stat);
  const battle = requireRecord(draft.battle, '开局馈赠结算失败：battle 数据不存在');
  const core = requireRecord(battle.core, '开局馈赠结算失败：battle.core 数据不存在');
  const reward = requireRecord(draft.reward, '开局馈赠结算失败：reward 数据不存在');
  if (
    normalizeMvuList(reward.card).length ||
    normalizeMvuList(reward.artifact).length ||
    normalizeMvuList(reward.item).length
  ) {
    throw new Error('开局馈赠结算失败：仍有未处理的奖励');
  }

  const oldMaxHp = Number(core.max_hp);
  const oldHp = Number(core.hp);
  const oldRemovalCount = Number(core.card_removal_count ?? 0);
  if (!Number.isFinite(oldMaxHp) || oldMaxHp <= 0 || !Number.isFinite(oldHp) || oldHp < 0 || oldHp > oldMaxHp) {
    throw new Error('开局馈赠结算失败：玩家生命数据无效');
  }
  if (!Number.isInteger(oldRemovalCount) || oldRemovalCount < 0) {
    throw new Error('开局馈赠结算失败：删卡次数无效');
  }
  const maxHp = Math.max(1, oldMaxHp + plan.maxHpDelta);
  // A gift opens every act.  Its restorative transition is program-owned and
  // cannot be skipped by choosing a different authored reward bundle.
  const hp = maxHp;
  if (plan.lustDelta !== 0 || plan.maxLustDelta !== 0) {
    const oldMaxLust = Number(core.max_lust);
    const oldLust = Number(core.lust);
    if (!Number.isFinite(oldMaxLust) || oldMaxLust <= 0 || !Number.isFinite(oldLust) || oldLust < 0 || oldLust > oldMaxLust) {
      throw new Error('开局馈赠结算失败：玩家欲望数据无效');
    }
    core.max_lust = Math.max(1, oldMaxLust + plan.maxLustDelta);
    core.lust = Math.min(core.max_lust, Math.max(0, oldLust + plan.lustDelta));
  }
  const cardRemovalCount = Math.max(0, oldRemovalCount + plan.cardRemovalDelta);
  const gold = Math.min(999999, Math.max(0, run.gold + plan.goldDelta));
  core.max_hp = maxHp;
  core.hp = hp;
  core.card_removal_count = cardRemovalCount;

  if (plan.deckTransforms.length) battle.cards = applyOpeningDeckTransforms(normalizeMvuList(battle.cards), plan.deckTransforms,
    (replacement, cards, source) => preparePersistentReplacement(draft, cards, source, replacement));
  const openingItems = fitTowerRewardItems(plan.reward.items, battle);

  reward.card = plan.reward.cards;
  reward.artifact = plan.reward.artifacts;
  reward.item = openingItems;
  reward.limits = {
    cards: plan.reward.cards.length,
    artifacts: plan.reward.artifacts.length,
    items: openingItems.length,
  };
  reward.disabled_categories = [];
  draft.run.gold = gold;
  const summary = applyRewardSelectionsToStat(draft, {
    cards: plan.reward.cards.map((_entry, index) => index),
    artifacts: plan.reward.artifacts.map((_entry, index) => index),
    items: openingItems.map((_entry, index) => index),
  }, { acquisitionAnswers, acquisitionPreview });
  persistentDeck(draft);

  const consumed = consumeTowerOpening(run.opening);
  const allOpeningCards = content.choices.flatMap((entry: Record<string, any>) => {
    const reward = entry.outcome?.reward;
    return Array.isArray(reward?.cards) ? reward.cards.filter((card: Record<string, any>) => card.id) : [];
  });
  const rememberedRun = rememberTowerCardOffer(draft.run, allOpeningCards, plan.reward.cards.map(card => String(card.id)));
  const openingRun: RunState = {
    ...rememberedRun,
    gold: draft.run.gold,
    opening: consumed.opening,
    stateRevision: run.stateRevision + 1,
  };
  const start = getOpeningTreasureNode(openingRun);
  // New maps begin with an ordinary battle and the opening is not a map room.
  // Preserve old floor-one treasure maps: their already-saved start node still
  // resolves here exactly once, without changing its generated content.
  const nextRun = start
    ? completeRunNode(enterRunNode(openingRun, start.id), { outcome: 'cleared' })
    : openingRun;
  draft.run = nextRun;
  replaceRecord(stat, draft);
  return {
    choiceId,
    ...summary,
    hp: draft.battle.core.hp,
    maxHp: draft.battle.core.max_hp,
    gold: nextRun.gold,
    cardRemovalCount: draft.battle.core.card_removal_count,
    run: clone(nextRun),
  };
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

  if (request.kind === 'initial_artifact_acquisition') {
    if (draft.initial_artifact_acquisition?.generationId !== request.generationId) throw new Error('初始遗物来源已变化，请重新打开');
    const receipt = settleInitialArtifactAcquisitionInStat(draft, request.answers);
    if (!receipt) throw new Error('初始遗物已处理，无需重复领取');
    value = { artifactNames: receipt.artifacts.map(artifact => String(artifact.name || artifact.id)) };
    persistentDeck(draft);
  } else if (request.kind === 'reward_claim') {
    value = applyRewardSelectionsToStat(draft, request.selections, { partial: request.partial === true, cardGroupId: request.cardGroupId, acquisitionAnswers: request.acquisitionAnswers, acquisitionPreview: request.acquisitionPreview });
    if (request.claimGold || request.discardGold) {
      if (request.claimGold && request.discardGold) throw new Error('金币奖励不能同时领取和放弃');
      const reward = requireRecord(draft.reward, 'reward 数据不存在');
      const amount = Number(reward.gold);
      if (request.claimGold && (!Number.isInteger(amount) || amount <= 0 || reward.gold_claimed === true)) throw new Error('金币奖励不可领取');
      if (request.claimGold) {
        if (!draft.run) throw new Error('金币奖励需要远征状态');
        draft.run = { ...draft.run, gold: Math.min(999999, draft.run.gold + amount) };
      }
      reward.gold_claimed = true;
    }
    persistentDeck(draft);
  } else if (request.kind === 'treasure_reward_claim') {
    const run = requireActiveNode(draft, 'treasure');
    const summary = applyRewardSelectionsToStat(draft, request.selections, { acquisitionAnswers: request.acquisitionAnswers, acquisitionPreview: request.acquisitionPreview });
    persistentDeck(draft);
    const nextRun = completeRunNode(draft.run, { outcome: 'cleared' });
    draft.run = nextRun;
    clearTowerNodePayload(draft);
    value = { ...summary, run: nextRun };
  } else if (request.kind === 'event_reward_claim') {
    value = settleEventRewardSelectionsInStat(draft, request.selections, request.acquisitionAnswers, request.acquisitionPreview);
    persistentDeck(draft);
  } else if (request.kind === 'event_step') {
    value = settleTowerEventChoiceInStat(draft, request.choiceId, request);
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
    value = settleShopSelectionsInStat(draft, request.selections, request.acquisitionAnswers, request.acquisitionPreview);
    persistentDeck(draft);
  } else if (request.kind === 'allowance_remove_card') {
    const core = requireRecord(draft.battle?.core, '删卡缺少玩家状态');
    const count = Number(core.card_removal_count ?? 0);
    if (!Number.isInteger(count) || count <= 0) throw new Error('删卡次数不足');
    const cards = persistentDeck(draft);
    const card = selectedRunCard(cards, request.runInstanceId);
    const result = applyPersistentDeckMutation(cards, { kind: 'remove', runInstanceId: card.runInstanceId });
    replaceMvuList(draft.battle, 'cards', result.cards);
    core.card_removal_count = count - 1;
    cardRunInstanceIds.push(card.runInstanceId);
    value = { runInstanceId: card.runInstanceId, cardName: String(card.name || card.id) };
  } else if (request.kind === 'shop_remove_card') {
    const run = requireActiveNode(draft, 'shop');
    if (draft.run_shop?.removal_used) throw new Error('本次商店已经删过一张牌');
    const cards = persistentDeck(draft);
    const card = selectedRunCard(cards, request.runInstanceId);
    const paid = spendRunGold(run, towerShopRemovalPrice(run));
    const result = applyPersistentDeckMutation(cards, {kind:'remove',runInstanceId:request.runInstanceId});
    replaceMvuList(draft.battle, 'cards', result.cards);
    draft.run = {...paid, shopRemovalCount:(run.shopRemovalCount || 0) + 1};
    draft.run_shop = {...draft.run_shop, removal_used:true};
    cardRunInstanceIds.push(request.runInstanceId);
    value = {runInstanceId:request.runInstanceId, cardName:String(card.name || card.id)};
  } else if (request.kind === 'shop_leave') {
    value = leaveShopInStat(draft);
  } else if (request.kind === 'rest_heal') {
    value = settleRestHealInStat(draft, request.ratio);
  } else if (request.kind === 'rest_action') {
    const run = requireActiveNode(draft, 'rest');
    if (!['train', 'scavenge', 'recall'].includes(request.action)) throw new Error('营火行动无效');
    const core = requireRecord(draft.battle?.core, 'battle.core 数据不存在');
    let summary: string;
    if (request.action === 'train') {
      const maxHp = Number(core.max_hp);
      if (!Number.isFinite(maxHp) || maxHp <= 0) throw new Error('生命上限无效');
      core.max_hp = maxHp + CAMPFIRE_RULES.maxHpGain;
      summary = `营火锻炼：生命上限增加 ${CAMPFIRE_RULES.maxHpGain}`;
    } else if (request.action === 'scavenge') {
      const gold = campfireGold(run.seed, run.currentNode!.id);
      draft.run = { ...run, gold: Math.min(999999, run.gold + gold) };
      summary = `营火搜刮：获得 ${gold} 金币`;
    } else {
      const candidates = availableTowerMemoryCards(draft, run.currentNode!.id, 'recall');
      const card = candidates.find(card => card.id === request.cardId);
      if (!card) throw new Error('这张牌不在本次可回忆的候选中');
      draft.reward = { card: [card], artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 } };
      applyRewardSelectionsToStat(draft, { cards: [0], artifacts: [], items: [] });
      persistentDeck(draft);
      summary = `营火回忆：获得 ${String(card.name || card.id)}`;
    }
    draft.run = completeRunNode(draft.run, { outcome: 'cleared' });
    draft.run_upgrade = null;
    clearTowerNodePayload(draft);
    value = { action: request.action, summary, run: draft.run } satisfies CampfireResult;
  } else {
    const run = requireActiveNode(draft, 'rest');
    if (run.routeMode === 'map') throw new Error('营火只支持休息、锻炼、搜刮和回忆');
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
          playerDesireEffect: battle.player_lust_effect,
          statusDefinitions: normalizeMvuStatusDefinitions(battle.statuses),
          knownResourceIds: normalizeMvuList<Record<string, any>>(battle.core?.resources)
            .map(resource => String(resource?.id || ''))
            .filter(Boolean),
        },
      );
      if (!upgraded.ok) throw new Error(`卡牌升级失败：${upgraded.message}`);
      const index = cards.findIndex(card => card.runInstanceId === source.runInstanceId);
      cards[index] = {
        ...upgraded.card,
        runInstanceId: source.runInstanceId,
        templateId: source.templateId,
        quantity: 1,
      };
      replaceMvuList(battle, 'cards', cards);
      const nextRun = completeRunNode(run, { outcome: 'cleared' });
      draft.run = nextRun;
      draft.run_upgrade = null;
      delete draft.run_upgrade_target;
      clearTowerNodePayload(draft);
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
      clearTowerNodePayload(draft);
      value = { runInstanceId: source.runInstanceId, cardName: String(replacement.name || replacement.id) };
    } else if (request.kind === 'rest_duplicate_card') {
      const result = applyPersistentDeckMutation(cards, {
        kind: 'duplicate',
        runInstanceId: source.runInstanceId,
      });
      replaceMvuList(battle, 'cards', result.cards);
      draft.run = completeRunNode(run, { outcome: 'cleared' });
      draft.run_upgrade = null;
      clearTowerNodePayload(draft);
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
      clearTowerNodePayload(draft);
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
    summary: logSummary(request, value, primaryGoldAfter === null || goldBefore === null ? 0 : primaryGoldAfter - goldBefore),
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
