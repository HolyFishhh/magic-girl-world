import { roundBattleValue } from './battleMath';
import type { CardValueOperator, EffectNode, EffectOrbSelector } from './effectDsl';

export interface ActiveStance {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  enterEffects?: EffectNode[];
  exitEffects?: EffectNode[];
  passiveEffects?: EffectNode[];
  enteredTurn: number;
  source?: { kind: string; id: string; name?: string };
}

export interface OrbInstance {
  instanceId: string;
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  value: number;
  passiveEffects?: EffectNode[];
  evokeEffects?: EffectNode[];
  source?: { kind: string; id: string; name?: string };
}

export interface OrbContainer {
  slots: number;
  orbs: OrbInstance[];
}

export interface StanceTransition {
  previous: ActiveStance | null;
  next: ActiveStance | null;
  changed: boolean;
}

export function transitionStance(
  current: ActiveStance | null | undefined,
  next: Omit<ActiveStance, 'enteredTurn'> | null,
  currentTurn: number,
): StanceTransition {
  const previous = current ? structuredClone(current) : null;
  const resolved = next ? { ...structuredClone(next), enteredTurn: Math.max(0, Math.trunc(currentTurn)) } : null;
  const changed = (previous?.id || null) !== (resolved?.id || null);
  return { previous, next: changed ? resolved : previous, changed };
}

export function normalizeOrbContainer(value?: Partial<OrbContainer> | null): OrbContainer {
  const slots = Number.isFinite(value?.slots) ? Math.max(0, Math.min(20, Math.trunc(value?.slots || 0))) : 0;
  const orbs = Array.isArray(value?.orbs)
    ? value.orbs.slice(0, slots).map(orb => ({ ...structuredClone(orb), value: roundBattleValue(Math.max(0, orb.value || 0)) }))
    : [];
  return { slots, orbs };
}

export function resizeOrbContainer(
  container: OrbContainer | undefined,
  slots: number,
): { container: OrbContainer; overflow: OrbInstance[] } {
  const current = normalizeOrbContainer(container);
  const nextSlots = Math.max(0, Math.min(20, Math.trunc(slots)));
  return {
    container: { slots: nextSlots, orbs: current.orbs.slice(0, nextSlots) },
    overflow: current.orbs.slice(nextSlots),
  };
}

/** Channel to the right; a full container evicts the oldest (left-most) Orb. */
export function channelOrb(
  container: OrbContainer | undefined,
  orb: OrbInstance,
): { container: OrbContainer; evicted: OrbInstance | null; accepted: boolean } {
  const current = normalizeOrbContainer(container);
  if (current.slots <= 0) return { container: current, evicted: null, accepted: false };
  const orbs = [...current.orbs];
  const evicted = orbs.length >= current.slots ? orbs.shift() || null : null;
  orbs.push({ ...structuredClone(orb), value: roundBattleValue(Math.max(0, orb.value)) });
  return { container: { slots: current.slots, orbs }, evicted, accepted: true };
}

export function selectOrbs(container: OrbContainer | undefined, selector: EffectOrbSelector): OrbInstance[] {
  const current = normalizeOrbContainer(container);
  const matching = selector.id ? current.orbs.filter(orb => orb.id === selector.id) : current.orbs;
  if (selector.pick === 'all') return matching;
  const count = Math.max(1, Math.trunc(selector.count || 1));
  return selector.pick === 'last' ? matching.slice(-count).reverse() : matching.slice(0, count);
}

export function removeSelectedOrbs(
  container: OrbContainer | undefined,
  selector: EffectOrbSelector,
): { container: OrbContainer; selected: OrbInstance[] } {
  const current = normalizeOrbContainer(container);
  const selected = selectOrbs(current, selector);
  const selectedIds = new Set(selected.map(orb => orb.instanceId));
  return {
    container: { ...current, orbs: current.orbs.filter(orb => !selectedIds.has(orb.instanceId)) },
    selected,
  };
}

function applyOperator(current: number, operator: CardValueOperator, operand: number): number {
  if (operator === 'add') return current + operand;
  if (operator === 'subtract') return current - operand;
  if (operator === 'multiply') return current * operand;
  if (operand === 0) throw new Error('Orb value cannot be divided by zero');
  return current / operand;
}

export function modifyOrbValues(
  container: OrbContainer | undefined,
  selector: EffectOrbSelector,
  operator: CardValueOperator,
  value: number,
): { container: OrbContainer; changed: Array<{ before: OrbInstance; after: OrbInstance }> } {
  const current = normalizeOrbContainer(container);
  const selectedIds = new Set(selectOrbs(current, selector).map(orb => orb.instanceId));
  const changed: Array<{ before: OrbInstance; after: OrbInstance }> = [];
  const orbs = current.orbs.map(orb => {
    if (!selectedIds.has(orb.instanceId)) return orb;
    const before = structuredClone(orb);
    const after = {
      ...orb,
      value: roundBattleValue(Math.max(0, applyOperator(orb.value, operator, value))),
    };
    changed.push({ before, after: structuredClone(after) });
    return after;
  });
  return { container: { ...current, orbs }, changed };
}

export interface TurnControlState {
  extraPlayerTurns: number;
  extraEnemyTurns: number;
  forceEndPlayer: boolean;
  forceEndEnemy: boolean;
}

export function normalizeTurnControl(value?: Partial<TurnControlState> | null): TurnControlState {
  return {
    extraPlayerTurns: Math.max(0, Math.trunc(value?.extraPlayerTurns || 0)),
    extraEnemyTurns: Math.max(0, Math.trunc(value?.extraEnemyTurns || 0)),
    forceEndPlayer: value?.forceEndPlayer === true,
    forceEndEnemy: value?.forceEndEnemy === true,
  };
}

export function addExtraTurns(
  value: TurnControlState | undefined,
  actor: 'player' | 'enemy',
  amount: number,
): TurnControlState {
  const next = normalizeTurnControl(value);
  const key = actor === 'player' ? 'extraPlayerTurns' : 'extraEnemyTurns';
  next[key] = Math.min(99, next[key] + Math.max(0, Math.trunc(amount)));
  return next;
}

export function consumeExtraTurn(
  value: TurnControlState | undefined,
  actor: 'player' | 'enemy',
): { state: TurnControlState; consumed: boolean } {
  const next = normalizeTurnControl(value);
  const key = actor === 'player' ? 'extraPlayerTurns' : 'extraEnemyTurns';
  if (next[key] <= 0) return { state: next, consumed: false };
  next[key] -= 1;
  return { state: next, consumed: true };
}

export function setForceEndTurn(
  value: TurnControlState | undefined,
  actor: 'player' | 'enemy',
  requested: boolean,
): TurnControlState {
  const next = normalizeTurnControl(value);
  if (actor === 'player') next.forceEndPlayer = requested;
  else next.forceEndEnemy = requested;
  return next;
}
