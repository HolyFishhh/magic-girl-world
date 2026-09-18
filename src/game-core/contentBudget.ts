import type { BattleRouteContext } from './battleContract';
import type { RunNodeKind } from './runState';
import { normalizeRunAct, recommendRunNodePacing, type RunPacingContext } from './runPacing';
import { stableHash32 } from './deterministicRandom';

export interface BattleRewardBudget {
  cards: { candidates: number; pick: number; rarities: string[]; slotRarities?: string[] };
  artifacts: { candidates: number; pick: number; slotRarities?: string[] } | null;
  items: { candidates: number; pick: number } | null;
  experience: number;
  /** Program-owned tower victory currency. It is never authored by the content model. */
  gold?: number;
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
  rewardSeed?: number;
  /** The finalized roster size, rather than an authoring hint. */
  enemyCount?: number;
}

export const TOWER_REWARD_RULES = {
  normalCards: [['Common', 60], ['Rare', 35], ['Epic', 5]],
  eliteCards: [['Epic', 80], ['Legendary', 20]],
  normalPotionChance: 0.1,
  elitePotionChance: 0.25,
} as const;

function rewardEnemyCount(context: TowerBattleRewardContext): number {
  const count = Math.floor(Number(context.enemyCount));
  return Number.isFinite(count) ? Math.max(1, Math.min(5, count)) : 1;
}

/**
 * Currency is determined from the saved node seed and the finalized encounter
 * shape.  It is deliberately separate from generated reward JSON, so a retry,
 * restore, or model response cannot create a second payout.
 */
export function recommendTowerBattleGold(context: TowerBattleRewardContext): number {
  const enemyCount = rewardEnemyCount(context);
  const roll = stableHash32({
    namespace: 'mwg-tower-gold-v1',
    seed: context.rewardSeed ?? 0,
    node: context.nodeId,
    kind: context.kind,
    act: context.act,
    floor: context.floor,
    enemyCount,
  });
  const base = context.kind === 'boss' ? 100 : context.kind === 'elite' ? 50 : 20;
  const actBonus = Math.max(0, Math.floor(context.act) - 1) * 10;
  const floorBonus = Math.max(0, Math.floor(context.floor) - 1) * 2;
  const rosterBonus = (enemyCount - 1) * 5;
  return base + actBonus + floorBonus + rosterBonus + (roll % 7);
}

function plannedRewardBudget(context: TowerBattleRewardContext, experience: number): BattleRewardBudget {
  const roll = (slot: string) => stableHash32({namespace:'tower-rewards-v2', seed:context.rewardSeed, node:context.nodeId, slot}) / 0x1_0000_0000;
  const rarity = (slot: string) => {
    if (context.kind === 'boss') return 'Legendary';
    let remaining = roll(slot) * 100;
    for (const [name, weight] of context.kind === 'elite' ? TOWER_REWARD_RULES.eliteCards : TOWER_REWARD_RULES.normalCards) {
      remaining -= weight;
      if (remaining < 0) return name;
    }
    return 'Epic';
  };
  const slotRarities = [0,1,2].map(index => rarity(`card-${index}`));
  return {
    cards: {candidates:3, pick:1, rarities:[...new Set(slotRarities)], slotRarities},
    artifacts: context.kind === 'battle' ? null : {candidates:1,pick:1,slotRarities:[rarity('relic')]},
    items: roll('potion') < (context.kind === 'battle' ? TOWER_REWARD_RULES.normalPotionChance : context.kind === 'elite' ? TOWER_REWARD_RULES.elitePotionChance : 0)
      ? {candidates:1,pick:1} : null,
    experience,
    gold: recommendTowerBattleGold(context),
  };
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
  if (context.rewardSeed !== undefined) return plannedRewardBudget(context, budget.experience);
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
    gold: recommendTowerBattleGold(context),
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
  options: { allowProgramCurrency?: boolean } = {},
): Record<string, unknown> {
  if (!isRecord(rewardValue)) throw new Error('tower battle reward must be an object');
  // Parsing and activation both enforce this contract. Program-owned currency
  // may therefore already exist; it is always recomputed below, never trusted.
  const allowedFields = new Set(['card', 'cards', 'artifact', 'artifacts', 'item', 'items', 'limits',
    ...(options.allowProgramCurrency ? ['gold', 'gold_claimed'] : [])]);
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
    const slots = category === 'cards' ? budget.cards.slotRarities : category === 'artifacts' ? budget.artifacts?.slotRarities : undefined;
    slots?.forEach((rarity, index) => {
      const candidate = normalized[singular][index];
      if (!isRecord(candidate) || candidate.rarity !== rarity)
        throw new Error(`tower battle reward ${singular}[${index}].rarity must be ${rarity} (program plan)`);
    });
  }

  return {
    ...normalized,
    limits: {
      cards: expectations.cards.pick,
      artifacts: expectations.artifacts.pick,
      items: expectations.items.pick,
    },
    ...(budget.gold === undefined ? {} : { gold: budget.gold, gold_claimed: false }),
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
  if (budget.cards.slotRarities) parts.push(`卡牌依次稀有度=${budget.cards.slotRarities.join('/')}`);
  if (budget.artifacts?.slotRarities) parts.push(`遗物依次稀有度=${budget.artifacts.slotRarities.join('/')}`);
  if (budget.artifacts) parts.push(`artifacts=${budget.artifacts.candidates}/${budget.artifacts.pick}`);
  if (budget.items) parts.push(`items=${budget.items.candidates}/${budget.items.pick}`);
  if (options.includeExperience !== false) parts.push(`exp=${budget.experience}`);
  if (budget.gold !== undefined) parts.push(`gold=${budget.gold}`);
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
  const goldInstruction = budget.gold === undefined
    ? ''
    : '；金币由程序按本场节点与敌人数写入 reward.gold，禁止生成 gold 或 gold_claimed';
  return `${parts.join('；')}${goldInstruction}；每张 reward.card 固定 quantity=1；经验已由程序结算，禁止修改 battle.exp`;
}

export function recommendShopBudget(pacing: RunPacingContext): ShopBudget {
  return { cards: 5, artifacts: 2, items: 2 };
}

export function towerShopRemovalPrice(run: {shopRemovalCount?: number}): number {
  return 75 + 25 * Math.max(0, Math.floor(Number(run.shopRemovalCount) || 0));
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
  Epic: 170,
  Legendary: 220,
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
