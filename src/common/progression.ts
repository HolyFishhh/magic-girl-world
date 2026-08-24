import {
  needsProgressionSettlement,
  planProgressionSettlement,
  progressionFromTotalExperience,
  requiredExperienceForLevel,
  totalExperienceAt,
  type ProgressionSettlement,
  type ProgressionSnapshot,
} from '../game-core';

export type { ProgressionSettlement, ProgressionSnapshot } from '../game-core';
export { needsProgressionSettlement, progressionFromTotalExperience, requiredExperienceForLevel, totalExperienceAt } from '../game-core';

/** Apply the host-neutral progression plan to one canonical MUV battle object. */
export function settleBattleProgression(battle: Record<string, any>): ProgressionSettlement {
  const plan = planProgressionSettlement(battle);
  if (plan.changed) {
    if (!battle.core || typeof battle.core !== 'object' || Array.isArray(battle.core)) battle.core = {};
    battle.level = plan.after.level;
    battle.exp = plan.after.exp;
    if (plan.promotions > 0) battle.core.card_removal_count = plan.nextCardRemovalCount;
  }
  return {
    before: plan.before,
    after: plan.after,
    promotions: plan.promotions,
    cardRemovalsGranted: plan.cardRemovalsGranted,
  };
}
