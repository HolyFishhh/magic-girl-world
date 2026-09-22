import { canPermanentlyRemoveCard, canTransformCard } from './cardLifecycle';
import {
  applyPersistentDeckMutation,
  migratePersistentRunDeck,
  type PersistentCardCarrier,
  type PersistentRunCard,
} from './cardProgression';

export type NonCombatDeckAction = {
  id: string;
  kind: 'remove' | 'transform' | 'duplicate';
  count: number;
  pick: 'choose' | 'random';
  filter?: { ids?: string[]; types?: string[] };
  replacement?: Record<string, unknown>;
};
export type NonCombatDeckPlan<T extends PersistentCardCarrier> = {
  action: NonCombatDeckAction;
  candidates: PersistentRunCard<T>[];
  selectedIds: string[];
  pending: boolean;
};
const own = (v: object, k: string) => Object.hasOwn(v, k);
export function parseNonCombatDeckActions(value: unknown): NonCombatDeckAction[] {
  if (!Array.isArray(value)) throw Error('deck actions must be array');
  const used = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid deck action');
    const a = raw as Record<string, unknown>;
    if (Object.keys(a).some(k => !['id', 'kind', 'count', 'pick', 'filter', 'replacement'].includes(k)))
      throw Error('unknown deck action field');
    if (
      typeof a.id !== 'string' ||
      !a.id ||
      used.has(a.id) ||
      !['remove', 'transform', 'duplicate'].includes(String(a.kind)) ||
      !['choose', 'random'].includes(String(a.pick)) ||
      !Number.isInteger(a.count) ||
      Number(a.count) < 1
    )
      throw Error('invalid deck action');
    used.add(a.id);
    if (a.filter !== undefined) {
      if (
        !a.filter ||
        typeof a.filter !== 'object' ||
        Array.isArray(a.filter) ||
        Object.keys(a.filter as object).some(k => !['ids', 'types'].includes(k))
      )
        throw Error('invalid filter');
      for (const k of ['ids', 'types'])
        if (
          (a.filter as any)[k] !== undefined &&
          (!Array.isArray((a.filter as any)[k]) || (a.filter as any)[k].some((x: any) => typeof x !== 'string' || !x))
        )
          throw Error('invalid filter values');
    }
    if (a.kind === 'transform') {
      if (!a.replacement || typeof a.replacement !== 'object' || Array.isArray(a.replacement))
        throw Error('transform requires replacement');
    } else if (own(a, 'replacement')) throw Error('replacement only allowed for transform');
    return structuredClone(a) as NonCombatDeckAction;
  });
}
const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
function candidates<T extends PersistentCardCarrier>(cards: readonly T[], action: NonCombatDeckAction) {
  const deck = migratePersistentRunDeck(cards),
    ids = new Set(action.filter?.ids || []),
    types = new Set(action.filter?.types || []);
  return deck.filter(
    c => (action.kind !== 'remove' || canPermanentlyRemoveCard(c))
      && (action.kind !== 'transform' || canTransformCard(c))
      && (!ids.size || ids.has(c.id) || ids.has(c.templateId)) && (!types.size || types.has(String((c as any).type))),
  );
}
export function planNonCombatDeckAction<T extends PersistentCardCarrier>(
  cards: readonly T[],
  raw: NonCombatDeckAction,
  seed: string,
  chosen?: readonly string[],
): NonCombatDeckPlan<T> {
  const action = parseNonCombatDeckActions([raw])[0],
    pool = candidates(cards, action);
  if (pool.length < action.count) throw Error('not enough eligible instances');
  if (action.pick === 'choose' && !chosen) return { action, candidates: pool, selectedIds: [], pending: true };
  const selected =
    action.pick === 'random'
      ? [...pool]
          .sort(
            (a, b) =>
              hash(`${seed}\0${action.id}\0${a.runInstanceId}`) - hash(`${seed}\0${action.id}\0${b.runInstanceId}`) ||
              a.runInstanceId.localeCompare(b.runInstanceId),
          )
          .slice(0, action.count)
          .map(x => x.runInstanceId)
      : [...chosen!];
  if (
    selected.length !== action.count ||
    new Set(selected).size !== selected.length ||
    selected.some(id => !pool.some(c => c.runInstanceId === id))
  )
    throw Error('invalid selected instances');
  return { action, candidates: pool, selectedIds: selected, pending: false };
}
export function executeNonCombatDeckPlan<T extends PersistentCardCarrier>(
  cards: readonly T[],
  plan: NonCombatDeckPlan<T>,
  validator: (card: Record<string, unknown>) => Record<string, unknown> | void,
): PersistentRunCard<T>[] {
  if (plan.pending) throw Error('pending selection');
  const action = parseNonCombatDeckActions([plan.action])[0];
  const pool = candidates(cards, action),
    selected = [...plan.selectedIds];
  if (
    selected.length !== action.count ||
    new Set(selected).size !== selected.length ||
    selected.some(id => !pool.some(card => card.runInstanceId === id))
  )
    throw Error('stale plan');
  if (action.kind === 'transform') {
    const prepared = validator(action.replacement!);
    if (prepared) action.replacement = prepared;
  }
  let next = migratePersistentRunDeck(cards);
  for (const runInstanceId of selected)
    next = applyPersistentDeckMutation(
      next,
      action.kind === 'transform'
        ? { kind: 'transform', runInstanceId, replacement: action.replacement as any }
        : ({ kind: action.kind, runInstanceId } as any),
    ).cards;
  return next;
}
