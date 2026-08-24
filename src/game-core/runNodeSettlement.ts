import { recommendShopPrice, type ShopCandidateCategory } from './contentBudget';
import { validateRewardSelections, type RewardSelectionLimits, type RewardSelections } from './rewardSelection';
import { completeRunNode, requireActiveRunNode, spendRunGold, type RunState } from './runState';

export interface RestHealPlan {
  healed: number;
  hp: number;
  run: RunState;
}

export interface RestHealInput {
  run: RunState;
  hp: number;
  maxHp: number;
  ratio?: number;
}

export interface ShopPurchasePlanInput {
  run: RunState;
  candidates: Record<ShopCandidateCategory, readonly unknown[]>;
  selections: unknown;
  limits: RewardSelectionLimits;
}

export interface ShopPurchasePlan {
  selections: RewardSelections;
  spentGold: number;
  remainingGold: number;
  run: RunState;
}

/** Compute a campfire heal without mutating battle or run state. */
export function planRestHeal(input: RestHealInput): RestHealPlan {
  requireActiveRunNode(input.run, 'rest');
  if (!Number.isFinite(input.hp) || !Number.isFinite(input.maxHp) || input.maxHp <= 0) {
    throw new Error('HP values are invalid');
  }
  const ratio = input.ratio === undefined ? 0.3 : input.ratio;
  if (!Number.isFinite(ratio) || ratio < 0) throw new Error('heal ratio is invalid');
  const heal = Math.max(1, Math.ceil(input.maxHp * ratio));
  const hp = Math.min(input.maxHp, Math.max(0, input.hp) + heal);
  return {
    healed: hp - input.hp,
    hp,
    run: completeRunNode(input.run, { outcome: 'cleared' }),
  };
}

function selectedPrice(
  candidates: readonly unknown[],
  indices: readonly number[],
  category: ShopCandidateCategory,
  act: number,
): number {
  return indices.reduce((total, index) => total + recommendShopPrice(category, candidates[index], act), 0);
}

/** Validate a shop selection and compute its atomic gold/route result. */
export function planShopPurchase(input: ShopPurchasePlanInput): ShopPurchasePlan {
  requireActiveRunNode(input.run, 'shop');
  const selections = validateRewardSelections(
    input.selections,
    {
      cards: input.candidates.cards.length,
      artifacts: input.candidates.artifacts.length,
      items: input.candidates.items.length,
    },
    input.limits,
  );
  const spentGold =
    selectedPrice(input.candidates.cards, selections.cards, 'cards', input.run.act) +
    selectedPrice(input.candidates.artifacts, selections.artifacts, 'artifacts', input.run.act) +
    selectedPrice(input.candidates.items, selections.items, 'items', input.run.act);
  const remainingRun = completeRunNode(spendRunGold(input.run, spentGold), { outcome: 'cleared' });
  return { selections, spentGold, remainingGold: remainingRun.gold, run: remainingRun };
}
