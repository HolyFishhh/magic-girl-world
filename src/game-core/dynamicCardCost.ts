import type { CardCostOperator, CardPatchScope, PatchableCard } from './cardPatch';
import type { CardCost } from './combatResource';
import { cardMatchesSelectorFilter } from './cardSelectorRuntime';
import {
  evaluateNumericExpression,
  type CardSelectorFilter,
  type CoreEffectState,
  type EffectExecutionContext,
  type NumericExpression,
} from './effectDsl';

export type DynamicCostTiming = 'on_draw' | 'while_in_hand' | 'on_play';

export interface DynamicCardCostRule {
  id: string;
  source: { kind: string; id: string; name?: string };
  timing: DynamicCostTiming;
  scope: CardPatchScope;
  operator: CardCostOperator;
  value: NumericExpression;
  filter?: CardSelectorFilter;
  priority?: number;
  minimum?: number;
  maximum?: number;
}

export interface DynamicCardCostContext {
  state: CoreEffectState;
  effect: EffectExecutionContext;
  timing: DynamicCostTiming;
}

export interface DynamicCostLifecycleCard extends PatchableCard {
  /** Evaluated once when this concrete instance is drawn; cleared after it leaves play. */
  drawCostOverride?: CardCost;
  dynamicCostDrawTurn?: number;
}

function applyCost(value: number, operator: CardCostOperator, operand: number): number {
  if (operator === 'add') return value + operand;
  if (operator === 'subtract') return value - operand;
  if (operator === 'multiply') return value * operand;
  if (operator === 'divide') {
    if (operand === 0) throw new Error('dynamic card cost cannot divide by zero');
    return value / operand;
  }
  if (operator === 'set') return operand;
  if (operator === 'min') return Math.min(value, operand);
  return Math.max(value, operand);
}

export function cardDynamicCostRules(card: Pick<DynamicCostLifecycleCard, 'patches'>): DynamicCardCostRule[] {
  return (card.patches || [])
    .filter((patch): patch is Extract<NonNullable<DynamicCostLifecycleCard['patches']>[number], { kind: 'dynamic_cost' }> => patch.kind === 'dynamic_cost')
    .map(patch => ({
      id: patch.id,
      source: structuredClone(patch.source),
      timing: patch.timing,
      scope: patch.scope,
      operator: patch.operator,
      value: structuredClone(patch.value),
      priority: patch.priority,
      ...(patch.minimum !== undefined ? { minimum: patch.minimum } : {}),
      ...(patch.maximum !== undefined ? { maximum: patch.maximum } : {}),
    }));
}

function activeRules(
  card: DynamicCostLifecycleCard,
  rules: readonly DynamicCardCostRule[],
  timings: ReadonlySet<DynamicCostTiming>,
): DynamicCardCostRule[] {
  return [...cardDynamicCostRules(card), ...rules]
    .filter(rule => timings.has(rule.timing))
    .filter(rule => cardMatchesSelectorFilter(card, rule.filter))
    .sort((left, right) => (left.priority || 0) - (right.priority || 0) || left.id.localeCompare(right.id));
}

function resolveFromBase(
  card: DynamicCostLifecycleCard,
  base: CardCost | undefined,
  rules: readonly DynamicCardCostRule[],
  context: DynamicCardCostContext,
  timings: ReadonlySet<DynamicCostTiming>,
): CardCost | undefined {
  if (base === 'energy' || base === undefined || typeof base === 'object') return base;
  let cost = base;
  for (const rule of activeRules(card, rules, timings)) {
    const operand = evaluateNumericExpression(rule.value, context.state, context.effect, `dynamic_cost.${rule.id}`);
    if (!Number.isFinite(operand)) throw new Error(`dynamic card cost rule ${rule.id} produced non-finite value`);
    cost = applyCost(cost, rule.operator, operand);
    if (rule.minimum !== undefined) cost = Math.max(rule.minimum, cost);
    if (rule.maximum !== undefined) cost = Math.min(rule.maximum, cost);
  }
  return Math.max(0, Math.floor(cost));
}

/** Resolve cost from the current base every time; while-in-hand rules never accumulate. */
export function resolveDynamicCardCost(
  card: DynamicCostLifecycleCard,
  rules: readonly DynamicCardCostRule[],
  context: DynamicCardCostContext,
): CardCost | undefined {
  const base = context.timing === 'on_draw' ? card.cost : card.drawCostOverride ?? card.cost;
  return resolveFromBase(card, base, rules, context, new Set([context.timing]));
}

/** Freeze only draw-time randomness/conditions; later hand/play rules remain live. */
export function snapshotDynamicCardCostOnDraw<TCard extends DynamicCostLifecycleCard>(
  card: TCard,
  rules: readonly DynamicCardCostRule[],
  context: Omit<DynamicCardCostContext, 'timing'>,
): TCard {
  const drawCostOverride = resolveDynamicCardCost(card, rules, { ...context, timing: 'on_draw' });
  return {
    ...card,
    ...(drawCostOverride !== undefined ? { drawCostOverride } : {}),
    dynamicCostDrawTurn: context.state.currentTurn,
  };
}

/** Re-evaluate every live hand and play rule from the frozen draw cost without accumulating. */
export function resolveDynamicCardCostAtPlay(
  card: DynamicCostLifecycleCard,
  rules: readonly DynamicCardCostRule[],
  context: Omit<DynamicCardCostContext, 'timing'>,
): CardCost | undefined {
  return resolveFromBase(
    card,
    card.drawCostOverride ?? card.cost,
    rules,
    { ...context, timing: 'on_play' },
    new Set(['while_in_hand', 'on_play']),
  );
}

export function clearDynamicCardCostAfterPlay<TCard extends DynamicCostLifecycleCard>(card: TCard): TCard {
  const { drawCostOverride: _drawCostOverride, dynamicCostDrawTurn: _dynamicCostDrawTurn, ...rest } = card;
  return rest as TCard;
}
