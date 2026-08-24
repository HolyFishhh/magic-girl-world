export type RewardCategory = 'cards' | 'artifacts' | 'items';

export interface RewardSelections {
  cards: number[];
  artifacts: number[];
  items: number[];
}

export type RewardSelectionLimits = Record<RewardCategory, number>;
export type RewardCandidateCounts = Record<RewardCategory, number>;

function validateCategorySelection(
  value: unknown,
  category: RewardCategory,
  candidateCount: number,
  limit: number,
): number[] {
  if (!Array.isArray(value)) throw new Error(`奖励选择失败：${category} 选择不是数组`);
  if (!Number.isInteger(candidateCount) || candidateCount < 0) {
    throw new Error(`奖励选择失败：${category} 候选数量无效`);
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`奖励选择失败：${category} 可选数量无效`);
  }
  const unique = new Set<number>();
  for (const index of value) {
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) {
      throw new Error(`奖励选择失败：${category} 索引无效`);
    }
    unique.add(index);
  }
  if (unique.size > limit) throw new Error(`奖励选择失败：${category} 超过可选数量`);
  return Array.from(unique);
}

/** Validate the small selection payload without reading or mutating host data. */
export function validateRewardSelections(
  value: unknown,
  candidateCounts: RewardCandidateCounts,
  limits: RewardSelectionLimits,
): RewardSelections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('奖励选择失败：选择必须是对象');
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set<RewardCategory>(['cards', 'artifacts', 'items']);
  const unknownKey = Object.keys(input).find(key => !allowed.has(key as RewardCategory));
  if (unknownKey) throw new Error(`奖励选择失败：字段不允许: ${unknownKey}`);
  return {
    cards: validateCategorySelection(input.cards, 'cards', candidateCounts.cards, limits.cards),
    artifacts: validateCategorySelection(input.artifacts, 'artifacts', candidateCounts.artifacts, limits.artifacts),
    items: validateCategorySelection(input.items, 'items', candidateCounts.items, limits.items),
  };
}
