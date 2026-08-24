export interface ProgressionSnapshot {
  level: number;
  exp: number;
}

export interface ProgressionSettlement {
  before: ProgressionSnapshot;
  after: ProgressionSnapshot;
  promotions: number;
  cardRemovalsGranted: number;
}

export interface ProgressionSettlementPlan extends ProgressionSettlement {
  changed: boolean;
  nextCardRemovalCount: number;
}

const MAX_PROMOTIONS_PER_SETTLEMENT = 10000;

function readNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function readLevel(value: unknown): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 1 ? numeric : 1;
}

/** Experience needed to advance from the supplied level. */
export function requiredExperienceForLevel(level: unknown): number {
  const normalizedLevel = readLevel(level);
  return 100 + (normalizedLevel - 1) * 50;
}

export function totalExperienceAt(level: unknown, exp: unknown): number {
  const normalizedLevel = readLevel(level);
  const normalizedExp = readNonNegativeInteger(exp, 0);
  const completedLevels = normalizedLevel - 1;
  const completedExperience = completedLevels * 100 + (completedLevels * (completedLevels - 1) * 50) / 2;
  return completedExperience + normalizedExp;
}

export function progressionFromTotalExperience(totalExperience: unknown): ProgressionSnapshot {
  let remaining = readNonNegativeInteger(totalExperience, 0);
  let level = 1;
  let promotions = 0;

  while (remaining >= requiredExperienceForLevel(level)) {
    remaining -= requiredExperienceForLevel(level);
    level += 1;
    promotions += 1;
    if (promotions > MAX_PROMOTIONS_PER_SETTLEMENT) {
      throw new Error('经验值异常：单次升级次数超过安全上限');
    }
  }

  return { level, exp: remaining };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function needsProgressionSettlement(battle: unknown): boolean {
  if (!isRecord(battle)) return false;
  const level = readLevel(battle.level);
  const exp = readNonNegativeInteger(battle.exp, 0);
  return battle.level !== level || battle.exp !== exp || exp >= requiredExperienceForLevel(level);
}

/**
 * Compute an immutable upgrade plan. The host decides how to persist the
 * resulting level, exp, and removal count.
 */
export function planProgressionSettlement(battle: unknown): ProgressionSettlementPlan {
  if (!isRecord(battle)) throw new Error('battle data is required for progression settlement');

  const before = {
    level: readLevel(battle.level),
    exp: readNonNegativeInteger(battle.exp, 0),
  };
  const needsNormalization = battle.level !== before.level || battle.exp !== before.exp;
  let level = before.level;
  let exp = before.exp;
  let promotions = 0;
  let cardRemovalsGranted = 0;

  while (exp >= requiredExperienceForLevel(level)) {
    exp -= requiredExperienceForLevel(level);
    level += 1;
    promotions += 1;
    if (level % 2 === 0) cardRemovalsGranted += 1;
    if (promotions > MAX_PROMOTIONS_PER_SETTLEMENT) {
      throw new Error('经验值异常：单次升级次数超过安全上限');
    }
  }

  const currentRemovalCount = isRecord(battle.core)
    ? readNonNegativeInteger(battle.core.card_removal_count, 0)
    : 0;
  return {
    before,
    after: { level, exp },
    promotions,
    cardRemovalsGranted,
    changed: promotions > 0 || needsNormalization,
    nextCardRemovalCount: currentRemovalCount + cardRemovalsGranted,
  };
}
