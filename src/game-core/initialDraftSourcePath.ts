import type { InitialDraftFragments, DraftPath, DraftRegistryKind, InitialDraft } from './initialDraft';

const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

/** Resolve a diagnostic/repair leaf back to the single authored definition.
 * Only compiler-owned expansion boundaries are traversed. IDs choose entries
 * within the exact registry kind, never by names/prose or a global ID search.
 * A changed/derived leaf has no writable source. This grants no repair rights;
 * the caller still needs a bounded validated slot and a fresh compilation.
 */
export function initialDraftSourcePath(draft: InitialDraft, preview: InitialDraftFragments,
  path: DraftPath,
): DraftPath | null {
  if (!path.length || path.length > 128 || path.some(key => typeof key === 'string' && forbidden.has(key))) return null;
  // This optional owner field has a dedicated omission-repair slot. Both
  // source and preview must lack it; registry-expanded player support arrays
  // do not make this fixed authored leaf ambiguous. No other missing path is
  // granted here, and the caller still validates the slot and final content.
  if (path.length === 2 && path[0] === 'player' && path[1] === 'player_lust_effect'
    && record(draft.player) && record(preview.player)
    && !Object.hasOwn(draft.player, 'player_lust_effect')
    && !Object.hasOwn(preview.player, 'player_lust_effect')) return [...path];
  let authored: any = draft;
  let compiled: any = preview;
  let source: DraftPath = [];
  for (let i = 0; i < path.length; i += 1) {
    // Reward card_ref expands the original card, except reward-owned quantity.
    if (record(authored) && Object.hasOwn(authored, 'card_ref') && path[i] !== 'quantity') {
      if (!source.length || source[0] !== 'opening' || source.at(-2) !== 'cards'
        || Object.keys(authored).some(key => key !== 'card_ref' && key !== 'quantity')) return null;
      if (!Array.isArray(draft.player?.cards)) return null;
      const matches = draft.player.cards.map((card: any, index: number) => ({ card, index }))
        .filter(({ card }: { card: any }) => record(card) && card.id === authored.card_ref);
      if (matches.length !== 1) return null;
      source = ['player', 'cards', matches[0].index];
      authored = matches[0].card;
    }
    const key = path[i];
    const kind: DraftRegistryKind | null = key === 'creates' ? 'templates'
      : key === 'statuses' ? 'statuses'
        : key === 'resources' && source.join('.') === 'player.core' ? 'resources' : null;
    if (kind && record(authored) && !Object.hasOwn(authored, key)
      && Array.isArray(compiled?.[key]) && typeof path[i + 1] === 'number') {
      const index = path[++i] as number;
      const entry = compiled[key][index];
      if (!Number.isInteger(index) || index < 0 || !record(entry) || typeof entry.id !== 'string') return null;
      const matches = draft.registry[kind].map((value, n) => ({ value, n })).filter(({ value }) => value.id === entry.id);
      if (matches.length !== 1) return null;
      source = ['registry', kind, matches[0].n];
      authored = matches[0].value;
      compiled = entry;
      continue;
    }
    if (authored == null || compiled == null || !Object.hasOwn(authored, key) || !Object.hasOwn(compiled, key)) return null;
    authored = authored[key];
    compiled = compiled[key];
    source.push(key);
  }
  return JSON.stringify(canonical(authored)) === JSON.stringify(canonical(compiled)) ? source : null;
}

/** Project an ALREADY slot-validated preview edit back to authored sources.
 * This is not a response parser: callers must prove the preview write set first.
 * Array shape changes are atomic here; the slot merger owns splice validation.
 */
export function applyInitialDraftPreviewEdits(draft: InitialDraft, before: InitialDraftFragments,
  after: InitialDraftFragments,
): InitialDraft {
  const result = structuredClone(draft);
  const writes = new Map<string, { path: DraftPath; value: unknown; remove: boolean }>();
  const visit = (left: any, right: any, path: DraftPath): void => {
    if (JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))) return;
    if (record(left) && record(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) visit(left[key], right[key], [...path, key]);
      return;
    }
    if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
      left.forEach((value, i) => visit(value, right[i], [...path, i]));
      return;
    }
    let source = initialDraftSourcePath(draft, before, path);
    // A new child is writable only if its existing authored parent is exact.
    if (!source && left === undefined && path.length > 1) {
      const parent = initialDraftSourcePath(draft, before, path.slice(0, -1));
      if (parent && !forbidden.has(String(path.at(-1)))) source = [...parent, path.at(-1)!];
    }
    if (!source) throw new Error(`编译修正无法回映原始字段：${JSON.stringify(path)}`);
    const key = JSON.stringify(source), old = writes.get(key);
    if (old && (old.remove !== (right === undefined)
      || JSON.stringify(canonical(old.value)) !== JSON.stringify(canonical(right))))
      throw new Error('同一原始定义的多个副本返回了相互矛盾的修正');
    writes.set(key, { path: source, value: right, remove: right === undefined });
  };
  visit(before, after, []);
  for (const a of writes.values()) for (const b of writes.values()) {
    if (a !== b && a.path.length < b.path.length && a.path.every((key, i) => key === b.path[i]))
      throw new Error('同一原始定义的修正路径重叠，无法证明一致性');
  }
  for (const write of writes.values()) {
    let parent: any = result;
    for (const key of write.path.slice(0, -1)) parent = parent[key];
    const key = write.path.at(-1)!;
    if (write.remove) delete parent[key];
    else parent[key] = structuredClone(write.value);
  }
  return result;
}
