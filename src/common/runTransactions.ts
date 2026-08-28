import {
  applyCardUpgradeToDeck,
  completeRunNode,
  planRestHeal,
  planShopPurchase,
  requireActiveRunNode,
  type RunState,
} from '../game-core';
import { consumePendingRunResultInStat, readRunState } from '../runtime/runStateAdapter';
import {
  applyRewardSelectionsToStat,
  normalizeMvuList,
  readRewardLimits,
  type RewardSelections,
  type RewardSelectionSummary,
} from './rewardTransactions';
import { normalizeMvuStatusDefinitions } from '../runtime/mvuArrays';

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
  const upgraded = applyCardUpgradeToDeck(cards, stat.run_upgrade, { statusDefinitions });
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
