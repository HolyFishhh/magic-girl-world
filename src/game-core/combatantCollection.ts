import type { BattleRandomState } from './deterministicRandom';
import { drawBattleRandom } from './deterministicRandom';

export const COMBATANT_COLLECTION_SCHEMA_VERSION = 1 as const;

export interface IdentifiedCombatant {
  id: string;
  currentHp: number;
  maxHp: number;
}

export interface CombatantCollection<T extends IdentifiedCombatant> {
  schemaVersion: typeof COMBATANT_COLLECTION_SCHEMA_VERSION;
  order: string[];
  byId: Record<string, T>;
  activeId: string | null;
}

export type EnemyTargetSelector =
  | { mode: 'active' }
  | { mode: 'by_id'; id: string }
  | { mode: 'all' }
  | { mode: 'random'; allowRepeat?: boolean; retarget?: 'locked' | 'each_hit' }
  | { mode: 'random_n'; count: number; allowRepeat?: boolean; retarget?: 'locked' | 'each_hit' }
  | { mode: 'lowest_hp' }
  | { mode: 'highest_hp' };

export interface ResolvedCombatantTargets<T extends IdentifiedCombatant> {
  targets: T[];
  random: BattleRandomState;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateCombatant(combatant: IdentifiedCombatant): void {
  if (!combatant.id.trim()) throw new Error('combatant id must not be empty');
  if (!Number.isFinite(combatant.currentHp) || !Number.isFinite(combatant.maxHp) || combatant.maxHp < 0)
    throw new Error(`combatant ${combatant.id} has invalid hp`);
}

export function createCombatantCollection<T extends IdentifiedCombatant>(
  combatants: readonly T[] = [],
  activeId?: string | null,
): CombatantCollection<T> {
  const order: string[] = [];
  const byId: Record<string, T> = {};
  for (const input of combatants) {
    validateCombatant(input);
    if (Object.prototype.hasOwnProperty.call(byId, input.id)) throw new Error(`duplicate combatant id: ${input.id}`);
    order.push(input.id);
    byId[input.id] = clone(input);
  }
  const requested = activeId ?? null;
  const active = requested && byId[requested]?.currentHp > 0
    ? requested
    : order.find(id => byId[id].currentHp > 0) || null;
  return { schemaVersion: COMBATANT_COLLECTION_SCHEMA_VERSION, order, byId, activeId: active };
}

export function listCombatants<T extends IdentifiedCombatant>(
  collection: CombatantCollection<T>,
  options: { livingOnly?: boolean } = {},
): T[] {
  return collection.order
    .map(id => collection.byId[id])
    .filter((entry): entry is T => Boolean(entry) && (!options.livingOnly || entry.currentHp > 0))
    .map(clone);
}

export function getActiveCombatant<T extends IdentifiedCombatant>(collection: CombatantCollection<T>): T | null {
  const current: T | undefined = collection.activeId ? collection.byId[collection.activeId] : undefined;
  if (current && current.currentHp > 0) return clone(current);
  const fallback = collection.order.map(id => collection.byId[id]).find(entry => entry?.currentHp > 0);
  return fallback ? clone(fallback) : null;
}

export function setActiveCombatant<T extends IdentifiedCombatant>(
  collection: CombatantCollection<T>,
  id: string,
): CombatantCollection<T> {
  const target = collection.byId[id];
  if (!target || target.currentHp <= 0) throw new Error(`active combatant must be living: ${id}`);
  return { ...clone(collection), activeId: id };
}

export function updateCombatant<T extends IdentifiedCombatant>(
  collection: CombatantCollection<T>,
  id: string,
  update: Partial<T> | ((current: T) => T),
): CombatantCollection<T> {
  const current = collection.byId[id];
  if (!current) throw new Error(`unknown combatant: ${id}`);
  const updated = typeof update === 'function' ? update(clone(current)) : { ...current, ...clone(update) };
  if (updated.id !== id) throw new Error('combatant id is immutable');
  validateCombatant(updated);
  const next = { ...clone(collection), byId: { ...clone(collection.byId), [id]: clone(updated) } };
  if (next.activeId === id && updated.currentHp <= 0) {
    next.activeId = next.order.find(candidate => next.byId[candidate]?.currentHp > 0) || null;
  }
  return next;
}

export function removeCombatant<T extends IdentifiedCombatant>(
  collection: CombatantCollection<T>,
  id: string,
): CombatantCollection<T> {
  if (!collection.byId[id]) return clone(collection);
  const byId = clone(collection.byId);
  delete byId[id];
  const order = collection.order.filter(candidate => candidate !== id);
  const activeId = collection.activeId === id
    ? order.find(candidate => byId[candidate]?.currentHp > 0) || null
    : collection.activeId;
  return { schemaVersion: COMBATANT_COLLECTION_SCHEMA_VERSION, order, byId, activeId };
}

export function removeDefeatedCombatants<T extends IdentifiedCombatant>(
  collection: CombatantCollection<T>,
): { collection: CombatantCollection<T>; removed: T[] } {
  const removed = listCombatants(collection).filter(entry => entry.currentHp <= 0);
  let next = clone(collection);
  for (const entry of removed) next = removeCombatant(next, entry.id);
  return { collection: next, removed };
}

function pickRandom<T>(values: readonly T[], random: BattleRandomState): { value: T; random: BattleRandomState } {
  if (values.length === 0) throw new Error('cannot pick from empty target list');
  const draw = drawBattleRandom(random);
  return { value: values[Math.min(values.length - 1, Math.floor(draw.value * values.length))], random: draw.state };
}

/** Resolve and lock targets before an effect transaction. Multi-hit effects reuse this list unless explicitly re-resolved. */
export function resolveEnemyTargets<T extends IdentifiedCombatant>(
  collection: CombatantCollection<T>,
  selector: EnemyTargetSelector,
  random: BattleRandomState,
): ResolvedCombatantTargets<T> {
  const living = listCombatants(collection, { livingOnly: true });
  if (living.length === 0) return { targets: [], random };
  if (selector.mode === 'active') {
    const target = getActiveCombatant(collection);
    return { targets: target ? [target] : [], random };
  }
  if (selector.mode === 'by_id') {
    const target = collection.byId[selector.id];
    return { targets: target?.currentHp > 0 ? [clone(target)] : [], random };
  }
  if (selector.mode === 'all') return { targets: living, random };
  if (selector.mode === 'lowest_hp' || selector.mode === 'highest_hp') {
    const direction = selector.mode === 'lowest_hp' ? 1 : -1;
    const sorted = living.sort((left, right) =>
      direction * (left.currentHp - right.currentHp) || collection.order.indexOf(left.id) - collection.order.indexOf(right.id),
    );
    return { targets: [sorted[0]], random };
  }
  const count = selector.mode === 'random' ? 1 : Math.max(0, Math.trunc(selector.count));
  const allowRepeat = selector.allowRepeat === true;
  const pool = [...living];
  const targets: T[] = [];
  let cursor = random;
  for (let index = 0; index < count && pool.length > 0; index += 1) {
    const picked = pickRandom(pool, cursor);
    cursor = picked.random;
    targets.push(clone(picked.value));
    if (!allowRepeat) pool.splice(pool.findIndex(entry => entry.id === picked.value.id), 1);
  }
  return { targets, random: cursor };
}

export function validateCombatantCollection(value: unknown): value is CombatantCollection<IdentifiedCombatant> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as CombatantCollection<IdentifiedCombatant>;
  if (candidate.schemaVersion !== COMBATANT_COLLECTION_SCHEMA_VERSION || !Array.isArray(candidate.order)) return false;
  if (!candidate.byId || typeof candidate.byId !== 'object' || Array.isArray(candidate.byId)) return false;
  if (new Set(candidate.order).size !== candidate.order.length) return false;
  if (candidate.activeId !== null && !candidate.order.includes(candidate.activeId)) return false;
  try {
    for (const id of candidate.order) {
      const entry = candidate.byId[id];
      if (!entry || entry.id !== id) return false;
      validateCombatant(entry);
    }
    return Object.keys(candidate.byId).every(id => candidate.order.includes(id));
  } catch {
    return false;
  }
}
