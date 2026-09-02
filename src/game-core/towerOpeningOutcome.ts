export interface TowerOpeningRewardBundle {
  cards: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  items: Record<string, unknown>[];
}

export interface TowerOpeningOutcomePlan {
  hpDelta: number;
  maxHpDelta: number;
  goldDelta: number;
  cardRemovalDelta: number;
  reward: TowerOpeningRewardBundle;
}

const MAX_REWARD_ENTRIES = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integerDelta(value: unknown, label: string, minimum: number, maximum: number): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`开局馈赠 ${label} 无效`);
  }
  return Number(value);
}

function rewardEntries(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REWARD_ENTRIES || value.some(entry => !isRecord(entry))) {
    throw new Error(`开局馈赠 ${label} 无效`);
  }
  return structuredClone(value) as Record<string, unknown>[];
}

/**
 * Normalize the small, program-settled outcome language used by the opening
 * benefactor. Card/relic/item definitions remain dynamic and are validated by
 * the existing reward library before anything is committed to MVU.
 */
export function planTowerOpeningOutcome(value: unknown): TowerOpeningOutcomePlan {
  if (!isRecord(value)) throw new Error('开局馈赠结果必须是对象');
  const unknown = Object.keys(value).find(key => ![
    'hp',
    'max_hp',
    'gold',
    'card_removals',
    'reward',
  ].includes(key));
  if (unknown) throw new Error(`开局馈赠不支持字段：${unknown}`);

  const reward = value.reward === undefined ? {} : value.reward;
  if (!isRecord(reward)) throw new Error('开局馈赠 reward 必须是对象');
  const unknownReward = Object.keys(reward).find(key => !['cards', 'artifacts', 'items'].includes(key));
  if (unknownReward) throw new Error(`开局馈赠 reward 不支持字段：${unknownReward}`);

  return {
    hpDelta: integerDelta(value.hp, '生命变化', -999, 999),
    maxHpDelta: integerDelta(value.max_hp, '生命上限变化', -99, 999),
    goldDelta: integerDelta(value.gold, '金币变化', -9999, 9999),
    cardRemovalDelta: integerDelta(value.card_removals, '删卡次数变化', -20, 20),
    reward: {
      cards: rewardEntries(reward.cards, '卡牌'),
      artifacts: rewardEntries(reward.artifacts, '遗物'),
      items: rewardEntries(reward.items, '道具'),
    },
  };
}
