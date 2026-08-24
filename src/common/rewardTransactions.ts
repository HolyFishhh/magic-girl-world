import {
  validateRewardCandidateAgainstLibrary,
  type RewardCandidateValidationResult,
} from '../game-core/rewardCandidateValidation';
import { planRewardSelections } from '../game-core/rewardSettlement';
import type { RewardCategory, RewardSelections } from '../game-core/rewardSelection';
import { flattenMvuArray } from '../runtime/mvuArrays';

export type { RewardCategory, RewardSelections } from '../game-core/rewardSelection';

export interface RewardSelectionSummary {
  cards: string[];
  artifacts: string[];
  items: string[];
}

export interface CardRemovalResult {
  cardName: string;
  remainingQuantity: number;
  remainingRemovals: number;
}

export type RewardCandidateInspections = Record<RewardCategory, RewardCandidateValidationResult[]>;

const REWARD_KEYS = {
  cards: 'card',
  artifacts: 'artifact',
  items: 'item',
} as const;

function clonePlainValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): Record<string, any> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

export function normalizeMvuList<T = any>(value: unknown): T[] {
  return flattenMvuArray<T>(value);
}

export function readRewardRoot(statRoot: unknown): Record<string, any> | null {
  if (!isRecord(statRoot) || !isRecord(statRoot.reward)) return null;
  return statRoot.reward;
}

export function hasSelectableRewards(statRoot: unknown): boolean {
  const reward = readRewardRoot(statRoot);
  return Boolean(
    reward && ['card', 'artifact', 'item'].some(key => normalizeMvuList(reward[key]).length > 0),
  );
}

function getMutableMvuList(root: Record<string, any>, key: string): any[] {
  const value = root[key];
  if (!Array.isArray(value)) throw new Error(`奖励写入失败：battle.${key} 不是数组`);
  return value;
}

function readLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 1;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return 1;
  return numeric;
}

export function readRewardLimits(statRoot: unknown): Record<RewardCategory, number> {
  const reward = readRewardRoot(statRoot);
  if (!reward) return { cards: 1, artifacts: 1, items: 1 };
  const limits = isRecord(reward.limits) ? reward.limits : {};
  return {
    cards: readLimit(limits.cards),
    artifacts: readLimit(limits.artifacts),
    items: readLimit(limits.items),
  };
}

/** Reuse the commit validator so malformed AI candidates can be disabled before selection. */
export function inspectRewardCandidates(statRoot: unknown): RewardCandidateInspections {
  const stat = isRecord(statRoot) ? statRoot : {};
  const reward = readRewardRoot(stat) || {};
  const battle = isRecord(stat.battle) ? stat.battle : {};
  const candidates: Record<RewardCategory, Record<string, any>[]> = {
    cards: normalizeMvuList<Record<string, any>>(reward.card),
    artifacts: normalizeMvuList<Record<string, any>>(reward.artifact),
    items: normalizeMvuList<Record<string, any>>(reward.item),
  };
  const existing: Record<RewardCategory, Record<string, any>[]> = {
    cards: normalizeMvuList<Record<string, any>>(battle.cards),
    artifacts: normalizeMvuList<Record<string, any>>(battle.artifacts),
    items: normalizeMvuList<Record<string, any>>(battle.items),
  };
  const statusDefinitions = normalizeMvuList<Record<string, any>>(battle.statuses);

  return {
    cards: candidates.cards.map(candidate =>
      validateRewardCandidateAgainstLibrary('cards', candidate, { existing: existing.cards, statusDefinitions }),
    ),
    artifacts: candidates.artifacts.map(candidate =>
      validateRewardCandidateAgainstLibrary('artifacts', candidate, {
        existing: existing.artifacts,
        statusDefinitions,
      }),
    ),
    items: candidates.items.map(candidate =>
      validateRewardCandidateAgainstLibrary('items', candidate, { existing: existing.items, statusDefinitions }),
    ),
  };
}

function rewardName(value: Record<string, any>): string {
  return String(value.name || value.id || '未知');
}

function rewardQuantity(value: Record<string, any>, category: RewardCategory): number {
  const raw = category === 'items' ? (value.count ?? 1) : (value.quantity ?? 1);
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`奖励 ${rewardName(value)} 的数量无效`);
  return quantity;
}

function findByIdentity(list: any[], value: Record<string, any>): Record<string, any> | undefined {
  const identity = value.id || value.name;
  if (!identity) return undefined;
  return list.find(entry => isRecord(entry) && (entry.id || entry.name) === identity);
}

function appendReward(target: any[], value: Record<string, any>, category: RewardCategory): void {
  const copy = clonePlainValue(value);
  delete copy.status;
  if (category === 'cards') {
    const quantity = rewardQuantity(copy, category);
    const existing = findByIdentity(target, copy);
    if (existing) {
      existing.quantity = rewardQuantity(existing, category) + quantity;
    } else {
      copy.quantity = quantity;
      target.push(copy);
    }
    return;
  }

  if (category === 'items') {
    const count = rewardQuantity(copy, category);
    const existing = findByIdentity(target, copy);
    if (existing) {
      existing.count = rewardQuantity(existing, category) + count;
    } else {
      copy.count = count;
      delete copy.quantity;
      target.push(copy);
    }
    return;
  }

  target.push(copy);
}

/** Mutates one stat_data root. Call it only from an atomic MUV updater. */
export function applyRewardSelectionsToStat(
  statRoot: Record<string, any>,
  selections: RewardSelections,
): RewardSelectionSummary {
  const stat = requireRecord(statRoot, '奖励领取失败：stat_data 不存在');
  const reward = requireRecord(stat.reward, '奖励领取失败：reward 数据不存在');
  const battle = requireRecord(stat.battle, '奖励领取失败：battle 数据不存在');
  const limits = readRewardLimits(stat);
  const candidates = {
    cards: normalizeMvuList<Record<string, any>>(reward.card),
    artifacts: normalizeMvuList<Record<string, any>>(reward.artifact),
    items: normalizeMvuList<Record<string, any>>(reward.item),
  };
  const statusDefinitions = normalizeMvuList<Record<string, any>>(battle.statuses);
  const validationLibraries: Record<RewardCategory, Record<string, any>[]> = {
    cards: normalizeMvuList<Record<string, any>>(battle.cards).map(clonePlainValue),
    artifacts: normalizeMvuList<Record<string, any>>(battle.artifacts).map(clonePlainValue),
    items: normalizeMvuList<Record<string, any>>(battle.items).map(clonePlainValue),
  };
  const plan = planRewardSelections({
    selections,
    candidates,
    existing: validationLibraries,
    statusDefinitions,
    limits,
  });

  const targets = {} as Partial<Record<RewardCategory, any[]>>;
  plan.entries.forEach(entry => {
    if (!targets[entry.category]) targets[entry.category] = getMutableMvuList(battle, entry.category);
  });
  const targetStatuses = plan.statuses.length > 0 ? getMutableMvuList(battle, 'statuses') : null;

  plan.entries.forEach(entry => {
    appendReward(targets[entry.category]!, entry.value, entry.category);
  });
  plan.statuses.forEach(status => targetStatuses!.push(status));

  reward.card = [];
  reward.artifact = [];
  reward.item = [];
  reward.limits = {};
  return plan.summary;
}

/** Removes exactly one copy and consumes exactly one allowance. */
export function removeOneCardFromBattleDeck(battleValue: unknown, cardId: string): CardRemovalResult {
  const battle = requireRecord(battleValue, '删卡失败：battle 数据不存在');
  if (!cardId) throw new Error('删卡失败：卡牌 ID 无效');
  const core = requireRecord(battle.core, '删卡失败：battle.core 数据不存在');
  const removalCount = Number(core.card_removal_count);
  if (!Number.isInteger(removalCount) || removalCount <= 0) throw new Error('删卡次数不足');

  const cards = getMutableMvuList(battle, 'cards');
  const cardIndex = cards.findIndex(entry => isRecord(entry) && entry.id === cardId);
  if (cardIndex < 0) throw new Error('删卡失败：未找到所选卡牌');

  const card = cards[cardIndex] as Record<string, any>;
  const quantity = rewardQuantity(card, 'cards');
  const remainingQuantity = quantity - 1;
  if (remainingQuantity > 0) card.quantity = remainingQuantity;
  else cards.splice(cardIndex, 1);
  core.card_removal_count = removalCount - 1;

  return {
    cardName: rewardName(card),
    remainingQuantity,
    remainingRemovals: removalCount - 1,
  };
}
