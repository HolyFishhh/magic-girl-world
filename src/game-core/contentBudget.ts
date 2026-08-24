import type { BattleRouteContext } from './battleContract';
import { normalizeRunAct, recommendRunNodePacing, type RunPacingContext } from './runPacing';

export interface BattleRewardBudget {
  cards: { candidates: number; pick: number; rarities: string[] };
  artifacts: { candidates: number; pick: number } | null;
  items: { candidates: number; pick: number } | null;
  experience: number;
}

export interface ShopBudget {
  cards: number;
  artifacts: number;
  items: number;
}

export type ShopCandidateCategory = 'cards' | 'artifacts' | 'items';

/** Fixed candidate budgets reduce AI arithmetic and keep rewards comparable between runs. */
export function recommendBattleRewardBudget(route: BattleRouteContext | null): BattleRewardBudget {
  const act = normalizeRunAct(route?.act, 3);
  const kind = route?.kind ?? 'battle';
  const pacing = route ? recommendRunNodePacing(route) : null;
  const rarities = act <= 1 ? ['Common', 'Uncommon'] : act === 2 ? ['Uncommon', 'Rare'] : ['Rare', 'Epic'];
  if (kind === 'boss') {
    return {
      cards: { candidates: 3, pick: 1, rarities: ['Rare', ...(act >= 3 ? ['Epic'] : [])] },
      artifacts: { candidates: 3, pick: 1 },
      items: null,
      experience: 70 + act * 15,
    };
  }
  if (kind === 'elite') {
    return {
      cards: { candidates: 3, pick: 1, rarities },
      artifacts: { candidates: 1, pick: 1 },
      items: null,
      experience: 35 + act * 10 + (pacing?.rewardTier === 'enhanced' ? 5 : 0),
    };
  }
  return {
    cards: { candidates: 3, pick: 1, rarities },
    artifacts: null,
    items: { candidates: 1, pick: 1 },
    experience: 15 + act * 10 + (pacing?.rewardTier === 'enhanced' ? 5 : 0),
  };
}

export function formatBattleRewardBudget(budget: BattleRewardBudget): string {
  const parts = [`cards=${budget.cards.candidates}/${budget.cards.pick}`, `rarity=${budget.cards.rarities.join(',')}`];
  if (budget.artifacts) parts.push(`artifacts=${budget.artifacts.candidates}/${budget.artifacts.pick}`);
  if (budget.items) parts.push(`items=${budget.items.candidates}/${budget.items.pick}`);
  parts.push(`exp=${budget.experience}`);
  return parts.join(' ');
}

export function recommendShopBudget(pacing: RunPacingContext): ShopBudget {
  const tier = recommendRunNodePacing(pacing).shopTier;
  if (tier === 'basic') return { cards: 2, artifacts: 1, items: 1 };
  if (tier === 'premium') return { cards: 3, artifacts: 2, items: 1 };
  return { cards: 3, artifacts: 1, items: 1 };
}

export function formatShopBudget(budget: ShopBudget): string {
  return `cards=${budget.cards} artifacts=${budget.artifacts} items=${budget.items}`;
}

const CARD_PRICES: Record<string, number> = {
  Common: 45,
  Uncommon: 60,
  Rare: 80,
  Epic: 100,
  Legendary: 120,
  Corrupt: 50,
};
const ARTIFACT_PRICES: Record<string, number> = {
  Common: 95,
  Uncommon: 115,
  Rare: 140,
  Boss: 170,
  ENS: 150,
};

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positiveQuantity(value: unknown): number {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

/** Program-owned shop pricing keeps arithmetic and required price fields out of AI output. */
export function recommendShopPrice(category: ShopCandidateCategory, candidate: unknown, act: number): number {
  const value = recordOf(candidate);
  const tier = normalizeRunAct(act, 3);
  const rarity = typeof value.rarity === 'string' ? value.rarity : 'Common';
  if (category === 'cards') {
    return (CARD_PRICES[rarity] ?? CARD_PRICES.Common) * positiveQuantity(value.quantity) + (tier - 1) * 10;
  }
  if (category === 'artifacts') {
    return (ARTIFACT_PRICES[rarity] ?? ARTIFACT_PRICES.Common) + (tier - 1) * 20;
  }
  return (35 + (tier - 1) * 10) * positiveQuantity(value.count);
}
