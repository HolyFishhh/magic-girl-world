import { readRewardCandidateQuantity, validateRewardCandidateAgainstLibrary } from './rewardCandidateValidation';
import {
  validateRewardSelections,
  type RewardCategory,
  type RewardSelectionLimits,
  type RewardSelections,
} from './rewardSelection';

export interface RewardSelectionPlanEntry {
  category: RewardCategory;
  index: number;
  value: Record<string, unknown>;
  name: string;
  quantity: number;
}

export interface RewardSelectionPlan {
  selections: RewardSelections;
  entries: RewardSelectionPlanEntry[];
  statuses: Record<string, unknown>[];
  summary: { cards: string[]; artifacts: string[]; items: string[] };
}

export interface RewardSelectionPlanInput {
  selections: unknown;
  candidates: Record<RewardCategory, readonly unknown[]>;
  existing: Record<RewardCategory, readonly unknown[]>;
  statusDefinitions?: readonly unknown[];
  limits: RewardSelectionLimits;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function rewardName(value: Record<string, any>): string {
  return String(value.name || value.id || '未知');
}

/** Validate all selected candidates before a host applies any MUV mutation. */
export function planRewardSelections(input: RewardSelectionPlanInput): RewardSelectionPlan {
  const selections = validateRewardSelections(
    input.selections,
    {
      cards: input.candidates.cards.length,
      artifacts: input.candidates.artifacts.length,
      items: input.candidates.items.length,
    },
    input.limits,
  );
  const libraries: Record<RewardCategory, Record<string, any>[]> = {
    cards: input.existing.cards.filter(isRecord).map(clone),
    artifacts: input.existing.artifacts.filter(isRecord).map(clone),
    items: input.existing.items.filter(isRecord).map(clone),
  };
  const statusDefinitions = (input.statusDefinitions || []).filter(isRecord);
  const statuses = new Map<string, Record<string, unknown>>();
  const entries: RewardSelectionPlanEntry[] = [];
  const summary: RewardSelectionPlan['summary'] = { cards: [], artifacts: [], items: [] };

  (Object.keys(selections) as RewardCategory[]).forEach(category => {
    selections[category].forEach(index => {
      const raw = input.candidates[category][index];
      if (!isRecord(raw) || !(raw.id || raw.name)) {
        throw new Error(`奖励选择失败：${category} 候选项缺少 id/name`);
      }
      const validation = validateRewardCandidateAgainstLibrary(category, raw, {
        existing: libraries[category],
        statusDefinitions,
      });
      if (!validation.ok) throw new Error(`奖励 ${rewardName(raw)} 无效：${validation.message}`);
      const value = clone(raw);
      const quantity = readRewardCandidateQuantity(category, value);
      if (quantity === null) throw new Error(`奖励 ${rewardName(value)} 的数量无效`);
      if (category === 'cards') value.quantity = quantity;
      if (category === 'items') value.count = quantity;
      if (isRecord(value.status)) {
        const statusId = String(value.status.id);
        const existing = statuses.get(statusId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(value.status)) {
          throw new Error(`奖励状态 ${statusId} 在所选候选中定义不一致`);
        }
        if (!existing) statuses.set(statusId, clone(value.status));
      }
      libraries[category].push(clone(value));
      entries.push({ category, index, value, name: rewardName(value), quantity });
      summary[category].push(`${rewardName(value)}${quantity > 1 ? ` x${quantity}` : ''}`);
    });
  });

  return {
    selections,
    entries,
    statuses: Array.from(statuses.values()),
    summary,
  };
}
