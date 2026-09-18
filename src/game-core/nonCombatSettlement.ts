import { parseNonCombatDeckActions, type NonCombatDeckAction } from './nonCombatDeckActions';
import { planTowerEventResourceSettlement } from './towerEventOutcome';
import { planTowerOpeningOutcome } from './towerOpeningOutcome';

export interface NonCombatSettlementCosts {
  hp: number;
  maxHp: number;
  gold: number;
  resources: Record<string, number>;
}

export interface NonCombatGrantPlan {
  cards: Record<string, unknown>[];
  items: Record<string, unknown>[];
  limits: { cards: number; items: number };
}

export interface NonCombatSettlementPlan {
  hpDelta: number;
  maxHpDelta: number;
  lustDelta: number;
  maxLustDelta: number;
  goldDelta: number;
  cardRemovalDelta: number;
  resourceDeltas: Record<string, number>;
  grantedCards: Record<string, unknown>[];
  costs: NonCombatSettlementCosts;
  deckActions: NonCombatDeckAction[];
  grant: NonCombatGrantPlan | null;
}

export interface NonCombatCostState {
  hp: number;
  max_hp: number;
  lust: number;
  max_lust: number;
  gold: number;
  resources: unknown;
}

export interface NonCombatCostPlan extends Omit<NonCombatCostState, 'resources'> {
  resources: Record<string, unknown>[];
}

const RESOURCE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${label} 必须是 0..${maximum} 的整数`);
  }
  return Number(value);
}

/** Combat multipliers can leave fractional health/lust; costs remain integers. */
function currentAmount(value: unknown, label: string, maximum: number, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum || (positive && value === 0)) {
    throw new Error(`${label} 必须是${positive ? '大于 0 的' : '非负'}有限数值，且不超过 ${maximum}`);
  }
  return value;
}

function parsePositiveResourceCosts(value: unknown): Record<string, number> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('非战斗结算 cost.resources 必须是资源 ID 到正整数的对象');
  const entries = Object.entries(value);
  if (entries.length > 16) throw new Error('非战斗结算 cost.resources 最多包含 16 项');
  const result: Record<string, number> = {};
  for (const [id, amount] of entries) {
    if (!RESOURCE_ID.test(id) || id === 'energy') throw new Error(`非战斗结算资源 ID 无效：${id}`);
    result[id] = nonnegativeInteger(amount, `非战斗结算资源成本 ${id}`, 999);
  }
  return result;
}

function parseCosts(value: unknown): NonCombatSettlementCosts {
  if (value === undefined) return { hp: 0, maxHp: 0, gold: 0, resources: {} };
  if (!isRecord(value)) throw new Error('非战斗结算 cost 必须是对象');
  const unknown = Object.keys(value).find(key => !['hp', 'max_hp', 'gold', 'resources'].includes(key));
  if (unknown) throw new Error(`非战斗结算 cost 不支持字段：${unknown}`);
  return {
    hp: value.hp === undefined ? 0 : nonnegativeInteger(value.hp, '非战斗结算生命成本', 999),
    maxHp: value.max_hp === undefined ? 0 : nonnegativeInteger(value.max_hp, '非战斗结算生命上限成本', 999),
    gold: value.gold === undefined ? 0 : nonnegativeInteger(value.gold, '非战斗结算金币成本', 9999),
    resources: parsePositiveResourceCosts(value.resources),
  };
}

function grantEntries(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(entry => !isRecord(entry))) {
    throw new Error(`非战斗结算 grant.${label} 必须是完整对象数组`);
  }
  return structuredClone(value) as Record<string, unknown>[];
}

function parseGrant(value: unknown): NonCombatGrantPlan | null {
  if (value === undefined) return null;
  if (!isRecord(value)) throw new Error('非战斗结算 grant 必须是对象');
  const unknown = Object.keys(value).find(key => !['cards', 'items', 'limits'].includes(key));
  if (unknown) throw new Error(`非战斗结算 grant 不支持字段：${unknown}`);
  const cards = grantEntries(value.cards, 'cards');
  const items = grantEntries(value.items, 'items');
  const limits = value.limits ?? {};
  if (!isRecord(limits)) throw new Error('非战斗结算 grant.limits 必须是对象');
  const limitUnknown = Object.keys(limits).find(key => !['cards', 'items'].includes(key));
  if (limitUnknown) throw new Error(`非战斗结算 grant.limits 不支持字段：${limitUnknown}`);
  const cardLimit = limits.cards === undefined ? cards.length
    : nonnegativeInteger(limits.cards, '非战斗结算 grant.cards 限制', cards.length);
  const itemLimit = limits.items === undefined ? items.length
    : nonnegativeInteger(limits.items, '非战斗结算 grant.items 限制', items.length);
  return { cards, items, limits: { cards: cardLimit, items: itemLimit } };
}

/**
 * Strictly parse a pre-authored non-combat settlement. This is a pure plan:
 * card/item mechanics and deck mutation targets are validated by their owning
 * reward/deck transactions, never silently interpreted here.
 */
export function parseNonCombatSettlement(value: unknown): NonCombatSettlementPlan {
  if (!isRecord(value)) throw new Error('非战斗结算必须是对象');
  const unknown = Object.keys(value).find(key => ![
    'hp', 'max_hp', 'lust', 'max_lust', 'gold', 'card_removals', 'resources',
    'gain_cards', 'cost', 'deck_actions', 'grant',
  ].includes(key));
  if (unknown) throw new Error(`非战斗结算不支持字段：${unknown}`);
  if (value.gain_cards !== undefined && (!Array.isArray(value.gain_cards) || value.gain_cards.some(card => !isRecord(card)))) {
    throw new Error('非战斗结算 gain_cards 必须是完整卡牌数组');
  }
  const scalar = planTowerOpeningOutcome({
    ...(value.hp === undefined ? {} : { hp: value.hp }),
    ...(value.max_hp === undefined ? {} : { max_hp: value.max_hp }),
    ...(value.lust === undefined ? {} : { lust: value.lust }),
    ...(value.max_lust === undefined ? {} : { max_lust: value.max_lust }),
    ...(value.gold === undefined ? {} : { gold: value.gold }),
    ...(value.card_removals === undefined ? {} : { card_removals: value.card_removals }),
  });
  // Reuse the existing parser to retain its registered-resource grammar. The
  // settlement transaction resolves those deltas after strict costs succeed.
  const resourceIds = value.resources === undefined
    ? []
    : isRecord(value.resources)
      ? Object.keys(value.resources)
      : [];
  const resourceProbe = planTowerEventResourceSettlement(
    value.resources,
    resourceIds.map(id => ({ id, current: 999, max: 999 })),
  );
  return {
    hpDelta: scalar.hpDelta,
    maxHpDelta: scalar.maxHpDelta,
    lustDelta: scalar.lustDelta,
    maxLustDelta: scalar.maxLustDelta,
    goldDelta: scalar.goldDelta,
    cardRemovalDelta: scalar.cardRemovalDelta,
    resourceDeltas: Object.fromEntries(resourceProbe.changes.map(change => [change.id, change.delta])),
    grantedCards: structuredClone((value.gain_cards ?? []) as Record<string, unknown>[]),
    costs: parseCosts(value.cost),
    deckActions: value.deck_actions === undefined ? [] : parseNonCombatDeckActions(value.deck_actions),
    grant: parseGrant(value.grant),
  };
}

/**
 * Validate and plan costs against the pre-settlement state. No gain/delta is
 * consulted here, so a reward from the same choice can never pay its cost.
 */
export function planNonCombatCosts(cost: NonCombatSettlementCosts, state: NonCombatCostState): NonCombatCostPlan {
  const hp = currentAmount(state.hp, '当前生命', 1_000_000, true);
  const maxHp = currentAmount(state.max_hp, '当前生命上限', 1_000_000, true);
  const lust = currentAmount(state.lust, '当前欲望', 1_000_000);
  const maxLust = currentAmount(state.max_lust, '当前欲望上限', 1_000_000, true);
  const gold = nonnegativeInteger(state.gold, '当前金币', 1_000_000_000);
  if (hp > maxHp || lust > maxLust) throw new Error('当前非战斗状态上下限无效');
  const parsed: NonCombatSettlementCosts = {
    hp: nonnegativeInteger(cost.hp, '非战斗结算生命成本', 999),
    maxHp: nonnegativeInteger(cost.maxHp, '非战斗结算生命上限成本', 999),
    gold: nonnegativeInteger(cost.gold, '非战斗结算金币成本', 9999),
    resources: parsePositiveResourceCosts(cost.resources),
  };
  if (parsed.hp > 0 && hp - parsed.hp < 1) throw new Error('生命成本不可支付：生命必须至少保留 1');
  if (parsed.maxHp > 0 && maxHp - parsed.maxHp < 1) throw new Error('生命上限成本不可支付：上限必须至少保留 1');
  if (gold < parsed.gold) throw new Error('金币成本不可支付');
  const resourceSettlement = planTowerEventResourceSettlement(
    Object.fromEntries(Object.entries(parsed.resources).map(([id, amount]) => [id, -amount])),
    state.resources,
  );
  if (!resourceSettlement.affordable) {
    throw new Error(`资源成本不可支付：${resourceSettlement.shortage?.id || '未知资源'}`);
  }
  return {
    hp: Math.min(hp - parsed.hp, maxHp - parsed.maxHp),
    max_hp: maxHp - parsed.maxHp,
    lust,
    max_lust: maxLust,
    gold: gold - parsed.gold,
    resources: resourceSettlement.resources,
  };
}
