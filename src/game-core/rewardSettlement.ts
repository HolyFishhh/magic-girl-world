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
  knownResourceIds?: Iterable<string>;
  limits: RewardSelectionLimits;
}

export interface RewardPoolState {
  candidates: Record<RewardCategory, readonly unknown[]>;
  disabledCategories?: readonly RewardCategory[];
  revision?: number;
  rerolls?: number;
}

export type RewardPoolMutation =
  | { kind: 'replace'; category: RewardCategory; index: number; candidate: unknown }
  | {
      kind: 'reroll';
      categories: readonly RewardCategory[];
      candidates: Partial<Record<RewardCategory, readonly unknown[]>>;
    }
  | { kind: 'disable_category'; category: RewardCategory }
  | {
      kind: 'modify';
      category: RewardCategory;
      removeIndices?: readonly number[];
      add?: readonly unknown[];
    };

export interface RewardPoolMutationPlan {
  candidates: Record<RewardCategory, unknown[]>;
  disabledCategories: RewardCategory[];
  revision: number;
  rerolls: number;
  changedCategories: RewardCategory[];
}

const REWARD_CATEGORIES: readonly RewardCategory[] = ['cards', 'artifacts', 'items'];

function requireRewardCategory(value: unknown): RewardCategory {
  if (!REWARD_CATEGORIES.includes(value as RewardCategory)) throw new Error(`unknown reward category: ${String(value)}`);
  return value as RewardCategory;
}

function nonNegativeInteger(value: unknown, fallback: number, label: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || Number(resolved) < 0 || Number(resolved) > 999999) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(resolved);
}

function uniqueCategories(values: readonly RewardCategory[]): RewardCategory[] {
  if (!Array.isArray(values)) throw new Error('reward categories must be an array');
  const categories = values.map(requireRewardCategory);
  if (new Set(categories).size !== categories.length) throw new Error('reward categories must not contain duplicates');
  return categories;
}

function cloneCandidatePools(value: Record<RewardCategory, readonly unknown[]>): Record<RewardCategory, unknown[]> {
  const result = {} as Record<RewardCategory, unknown[]>;
  for (const category of REWARD_CATEGORIES) {
    if (!Array.isArray(value?.[category])) throw new Error(`reward pool ${category} must be an array`);
    result[category] = value[category].map(clone);
  }
  return result;
}

function normalizedRemovalIndices(value: readonly number[] | undefined, length: number): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('reward removal indices must be an array');
  const indices = value.map(index => {
    if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error(`reward removal index is invalid: ${index}`);
    return index;
  });
  if (new Set(indices).size !== indices.length) throw new Error('reward removal indices must not contain duplicates');
  return indices.sort((left, right) => right - left);
}

/**
 * Plan one reward-pool edit without mutating candidates. Generated replacement content is supplied
 * by the caller; the plan owns only pool structure, disabled categories, reroll count, and revision.
 */
export function planRewardPoolMutation(
  state: RewardPoolState,
  mutation: RewardPoolMutation,
): RewardPoolMutationPlan {
  if (!mutation || typeof mutation !== 'object') throw new Error('reward pool mutation must be an object');
  const candidates = cloneCandidatePools(state.candidates);
  const disabledCategories = uniqueCategories(state.disabledCategories || []);
  const disabled = new Set(disabledCategories);
  const revision = nonNegativeInteger(state.revision, 0, 'reward pool revision');
  let rerolls = nonNegativeInteger(state.rerolls, 0, 'reward reroll count');
  const changed = new Set<RewardCategory>();

  if (mutation.kind === 'replace') {
    const category = requireRewardCategory(mutation.category);
    if (disabled.has(category)) throw new Error(`reward category is disabled: ${category}`);
    if (!Number.isInteger(mutation.index) || mutation.index < 0 || mutation.index >= candidates[category].length) {
      throw new Error(`reward replacement index is invalid: ${mutation.index}`);
    }
    candidates[category][mutation.index] = clone(mutation.candidate);
    changed.add(category);
  } else if (mutation.kind === 'reroll') {
    const categories = uniqueCategories(mutation.categories);
    if (categories.length === 0) throw new Error('reward reroll requires at least one category');
    for (const category of categories) {
      if (disabled.has(category)) throw new Error(`reward category is disabled: ${category}`);
      const replacement = mutation.candidates?.[category];
      if (!Array.isArray(replacement)) throw new Error(`reward reroll candidates are missing: ${category}`);
      candidates[category] = replacement.map(clone);
      changed.add(category);
    }
    const unexpected = Object.keys(mutation.candidates || {}).find(
      key => !categories.includes(requireRewardCategory(key)),
    );
    if (unexpected) throw new Error(`reward reroll supplied an unrequested category: ${unexpected}`);
    rerolls += 1;
  } else if (mutation.kind === 'disable_category') {
    const category = requireRewardCategory(mutation.category);
    if (disabled.has(category)) throw new Error(`reward category is already disabled: ${category}`);
    disabled.add(category);
    candidates[category] = [];
    changed.add(category);
  } else if (mutation.kind === 'modify') {
    const category = requireRewardCategory(mutation.category);
    if (disabled.has(category)) throw new Error(`reward category is disabled: ${category}`);
    const removeIndices = normalizedRemovalIndices(mutation.removeIndices, candidates[category].length);
    for (const index of removeIndices) candidates[category].splice(index, 1);
    if (mutation.add !== undefined && !Array.isArray(mutation.add)) throw new Error('reward pool additions must be an array');
    candidates[category].push(...(mutation.add || []).map(clone));
    if (removeIndices.length === 0 && (mutation.add?.length || 0) === 0) {
      throw new Error('reward pool modification must change at least one candidate');
    }
    changed.add(category);
  } else {
    throw new Error(`unsupported reward pool mutation: ${String((mutation as { kind?: unknown }).kind)}`);
  }

  return {
    candidates,
    disabledCategories: REWARD_CATEGORIES.filter(category => disabled.has(category)),
    revision: revision + 1,
    rerolls,
    changedCategories: REWARD_CATEGORIES.filter(category => changed.has(category)),
  };
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
        knownResourceIds: input.knownResourceIds,
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
