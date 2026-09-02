import type { BattleRouteContext } from './battleContract';
import type { RunNodeKind } from './runState';
import { normalizeRunAct, recommendRunNodePacing, type RunPacingContext } from './runPacing';
import { stableHash32 } from './deterministicRandom';

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

export interface TowerBattleRewardContext {
  nodeId: string;
  kind: Extract<RunNodeKind, 'battle' | 'elite' | 'boss'>;
  act: number;
  floor: number;
  floorsPerAct?: number;
}

const TOWER_REWARD_KEYS = {
  cards: ['card', 'cards'],
  artifacts: ['artifact', 'artifacts'],
  items: ['item', 'items'],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Build the fixed battle reward budget without asking callers to invent pacing fields. */
export function recommendTowerBattleRewardBudget(context: TowerBattleRewardContext): BattleRewardBudget {
  const danger = context.kind === 'boss' ? 3 : context.kind === 'elite' ? 2 : 1;
  const budget = recommendBattleRewardBudget({
    nodeId: context.nodeId,
    kind: context.kind,
    act: context.act,
    actCount: 3,
    floor: context.floor,
    floorsPerAct: context.floorsPerAct ?? 16,
    danger,
  });
  const chance = context.kind === 'boss' ? 0 : context.kind === 'elite' ? 0.5 : 0.4;
  const roll = stableHash32({
    namespace: 'mwg-tower-item-drop-v1',
    nodeId: context.nodeId,
    kind: context.kind,
    act: context.act,
    floor: context.floor,
  }) / 0x1_0000_0000;
  return {
    ...budget,
    items: roll < chance ? { candidates: 1, pick: 1 } : null,
  };
}

/**
 * Make battle reward quantity and pick limits program-owned.
 *
 * Extra candidates/categories are trimmed so already prepared nodes from an
 * older build remain playable. Missing required candidates are rejected and
 * sent through the bounded structure-repair request instead of silently
 * inventing authored content.
 */
export function enforceBattleRewardBudget(
  rewardValue: unknown,
  budget: BattleRewardBudget,
): Record<string, unknown> {
  if (!isRecord(rewardValue)) throw new Error('tower battle reward must be an object');
  const allowedFields = new Set(['card', 'cards', 'artifact', 'artifacts', 'item', 'items', 'limits']);
  const unknown = Object.keys(rewardValue).find(key => !allowedFields.has(key));
  if (unknown) throw new Error(`tower battle reward contains unsupported field: ${unknown}`);

  const expectations = {
    cards: { candidates: budget.cards.candidates, pick: budget.cards.pick },
    artifacts: {
      candidates: budget.artifacts?.candidates ?? 0,
      pick: budget.artifacts?.pick ?? 0,
    },
    items: {
      candidates: budget.items?.candidates ?? 0,
      pick: budget.items?.pick ?? 0,
    },
  } as const;
  const normalized: Record<'card' | 'artifact' | 'item', unknown[]> = {
    card: [],
    artifact: [],
    item: [],
  };

  for (const category of Object.keys(TOWER_REWARD_KEYS) as Array<keyof typeof TOWER_REWARD_KEYS>) {
    const [singular, plural] = TOWER_REWARD_KEYS[category];
    if (rewardValue[singular] !== undefined && rewardValue[plural] !== undefined) {
      throw new Error(`tower battle reward cannot contain both ${singular} and ${plural}`);
    }
    const source = rewardValue[singular] ?? rewardValue[plural] ?? [];
    if (!Array.isArray(source)) throw new Error(`tower battle reward ${singular} must be an array`);
    const expected = expectations[category].candidates;
    if (source.length < expected) {
      throw new Error(`tower battle reward ${singular} requires ${expected} candidates but received ${source.length}`);
    }
    normalized[singular] = structuredClone(source.slice(0, expected));
  }

  return {
    ...normalized,
    limits: {
      cards: expectations.cards.pick,
      artifacts: expectations.artifacts.pick,
      items: expectations.items.pick,
    },
  };
}

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

export function formatBattleRewardBudget(
  budget: BattleRewardBudget,
  options: { includeExperience?: boolean } = {},
): string {
  const parts = [`cards=${budget.cards.candidates}/${budget.cards.pick}`, `rarity=${budget.cards.rarities.join(',')}`];
  if (budget.artifacts) parts.push(`artifacts=${budget.artifacts.candidates}/${budget.artifacts.pick}`);
  if (budget.items) parts.push(`items=${budget.items.candidates}/${budget.items.pick}`);
  if (options.includeExperience !== false) parts.push(`exp=${budget.experience}`);
  return parts.join(' ');
}

/** Flat, non-formula checklist for the MVU model after a victory. */
export function formatBattleRewardChecklist(budget: BattleRewardBudget): string {
  const limits: Record<string, number> = { cards: budget.cards.pick };
  if (budget.artifacts) limits.artifacts = budget.artifacts.pick;
  if (budget.items) limits.items = budget.items.pick;
  const parts = [
    `reward.card=${budget.cards.candidates}项`,
    budget.artifacts
      ? `reward.artifact=${budget.artifacts.candidates}项`
      : 'reward.artifact=[]',
    budget.items ? `reward.item=${budget.items.candidates}项` : 'reward.item=[]',
    `reward.limits=${JSON.stringify(limits)}（整对象一次写入，不得添加其他键）`,
  ];
  return `${parts.join('；')}；每张 reward.card 固定 quantity=1；经验已由程序结算，禁止修改 battle.exp`;
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
