import { createCardCopyIdentity } from './cardIdentity';
import { inheritedCardAttachments } from './cardAttachment';
import {
  inheritedCardPatches,
  materializeCardPatches,
  PERSISTENT_COPY_PATCH_POLICY,
  TEMPORARY_COPY_PATCH_POLICY,
  TRANSFORM_PATCH_POLICY,
  type CardPatchInheritancePolicy,
  type PatchableCard,
} from './cardPatch';
import { planCardSelection, resolveCardSelection, type CardSelectionPlan } from './cardSelection';
import { orderedCardsForSelector, selectorZones, type SelectableCard } from './cardSelectorRuntime';
import type { CardSelector } from './effectDsl';
import type { CardPileZone, CardZoneState } from './cardZoneReducer';

export type CardPilePosition = 'top' | 'bottom';

export type AdvancedCardZoneRequest =
  | {
      type: 'move';
      selector: CardSelector;
      amount: number;
      destination: CardPileZone;
      position: CardPilePosition;
    }
  | { type: 'remove'; selector: CardSelector; amount: number }
  | {
      type: 'copy';
      selector: CardSelector;
      amount: number;
      destination: CardPileZone;
      position: CardPilePosition;
      persistent: boolean;
    };

export type AdvancedCardZoneFailureCode =
  | 'DUPLICATE_CARD_ID'
  | 'RANDOM_SOURCE_REQUIRED'
  | 'INSUFFICIENT_CANDIDATES'
  | 'INVALID_SELECTION'
  | 'STALE_PLAN'
  | 'DUPLICATE_GENERATED_ID';

export interface AdvancedCardZonePlan {
  ok: true;
  request: AdvancedCardZoneRequest;
  candidateIds: string[];
  selection: CardSelectionPlan & { ok: true };
  snapshot: Record<CardPileZone, string[]>;
}

export type PlanAdvancedCardZoneResult = AdvancedCardZonePlan | { ok: false; code: AdvancedCardZoneFailureCode };

export interface AdvancedCardZoneCommit<TCard extends SelectableCard> {
  ok: true;
  zones: CardZoneState<TCard>;
  selected: TCard[];
  created: TCard[];
  removed: TCard[];
}

function cloneZones<TCard extends SelectableCard>(zones: CardZoneState<TCard>): CardZoneState<TCard> {
  return structuredClone(zones);
}

function snapshot<TCard extends SelectableCard>(zones: CardZoneState<TCard>): Record<CardPileZone, string[]> {
  return {
    hand: zones.hand.map(card => card.id),
    drawPile: zones.drawPile.map(card => card.id),
    discardPile: zones.discardPile.map(card => card.id),
    exhaustPile: zones.exhaustPile.map(card => card.id),
  };
}

function duplicateIds(value: Record<CardPileZone, string[]>): boolean {
  const ids = Object.values(value).flat();
  return new Set(ids).size !== ids.length;
}

function sameSnapshot(left: Record<CardPileZone, string[]>, right: Record<CardPileZone, string[]>): boolean {
  return (Object.keys(left) as CardPileZone[]).every(
    zone => left[zone].length === right[zone].length && left[zone].every((id, index) => id === right[zone][index]),
  );
}

function normalizedAmount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function selectionMode(pick: CardSelector['pick']) {
  if (pick === 'left' || pick === 'bottom') return 'leftmost' as const;
  if (pick === 'right' || pick === 'top') return 'rightmost' as const;
  return pick;
}

export function planAdvancedCardZoneTransaction<TCard extends SelectableCard>(
  zones: CardZoneState<TCard>,
  request: AdvancedCardZoneRequest,
  random?: () => number,
): PlanAdvancedCardZoneResult {
  const zoneSnapshot = snapshot(zones);
  if (duplicateIds(zoneSnapshot)) return { ok: false, code: 'DUPLICATE_CARD_ID' };
  const candidates = orderedCardsForSelector(zones, request.selector);
  const requested = request.selector.pick === 'all'
    ? candidates.length
    : normalizedAmount(request.selector.count ?? request.amount);
  const selection = planCardSelection(
    {
      candidateIds: candidates.map(card => card.id),
      mode: selectionMode(request.selector.pick),
      minimum: requested,
      maximum: requested,
      allowCancel: request.selector.pick === 'choose',
    },
    random,
  );
  if (!selection.ok) {
    if (selection.code === 'RANDOM_SOURCE_REQUIRED') return { ok: false, code: 'RANDOM_SOURCE_REQUIRED' };
    if (selection.code === 'INSUFFICIENT_CANDIDATES') return { ok: false, code: 'INSUFFICIENT_CANDIDATES' };
    return { ok: false, code: 'INVALID_SELECTION' };
  }
  return { ok: true, request, candidateIds: candidates.map(card => card.id), selection, snapshot: zoneSnapshot };
}

function insertAt<TCard>(pile: TCard[], cards: readonly TCard[], position: CardPilePosition): void {
  if (position === 'bottom') pile.unshift(...cards.map(card => structuredClone(card)));
  else {
    // The first selected card is the next top card (array end is drawn first).
    pile.push(...cards.slice().reverse().map(card => structuredClone(card)));
  }
}

function removeSelected<TCard extends SelectableCard>(
  zones: CardZoneState<TCard>,
  ids: readonly string[],
): { zones: CardZoneState<TCard>; cards: TCard[] } {
  const next = cloneZones(zones);
  const byId = new Map<string, TCard>();
  for (const zone of ['hand', 'drawPile', 'discardPile', 'exhaustPile'] as const) {
    next[zone] = next[zone].filter(card => {
      if (!ids.includes(card.id)) return true;
      byId.set(card.id, card);
      return false;
    });
  }
  return { zones: next, cards: ids.map(id => byId.get(id)).filter((card): card is TCard => Boolean(card)) };
}

export function commitAdvancedCardZoneTransaction<TCard extends SelectableCard & Partial<PatchableCard>>(
  zones: CardZoneState<TCard>,
  plan: AdvancedCardZonePlan,
  response?: readonly string[] | null,
): AdvancedCardZoneCommit<TCard> | { ok: false; code: AdvancedCardZoneFailureCode } {
  if (!sameSnapshot(snapshot(zones), plan.snapshot)) return { ok: false, code: 'STALE_PLAN' };
  const resolved = resolveCardSelection(plan.selection, response);
  if (resolved.status !== 'selected') return { ok: false, code: 'INVALID_SELECTION' };
  const selectedIds = resolved.selectedIds;
  const removed = removeSelected(zones, selectedIds);
  if (removed.cards.length !== selectedIds.length) return { ok: false, code: 'STALE_PLAN' };
  if (plan.request.type === 'remove') {
    return { ok: true, zones: removed.zones, selected: removed.cards, created: [], removed: removed.cards };
  }

  if (plan.request.type === 'move') {
    insertAt(removed.zones[plan.request.destination], removed.cards, plan.request.position);
    return { ok: true, zones: removed.zones, selected: removed.cards, created: [], removed: [] };
  }

  // Copy leaves originals in place and inserts identity-safe clones.
  const next = cloneZones(zones);
  const existingCombatIds = new Set(Object.values(plan.snapshot).flat());
  const existingRunIds = new Set(
    [zones.hand, zones.drawPile, zones.discardPile, zones.exhaustPile]
      .flat()
      .map((card: TCard) => card.runInstanceId)
      .filter((id: string | undefined): id is string => Boolean(id)),
  );
  const created: TCard[] = [];
  for (const source of removed.cards) {
    const identity = createCardCopyIdentity(source, {
      temporaryCombatCopy: !plan.request.persistent,
      existingCombatIds,
      existingRunIds,
    });
    existingCombatIds.add(identity.combatInstanceId);
    existingRunIds.add(identity.runInstanceId);
    const patchable = source as TCard & PatchableCard;
    const policy = plan.request.persistent ? PERSISTENT_COPY_PATCH_POLICY : TEMPORARY_COPY_PATCH_POLICY;
    const copy = materializeCardPatches({
      ...structuredClone(source),
      ...identity,
      patches: inheritedCardPatches(patchable, policy),
      attachments: inheritedCardAttachments(patchable, policy),
    } as TCard & PatchableCard) as TCard;
    created.push(copy);
  }
  if (new Set(created.map(card => card.id)).size !== created.length) return { ok: false, code: 'DUPLICATE_GENERATED_ID' };
  insertAt(next[plan.request.destination], created, plan.request.position);
  return { ok: true, zones: next, selected: removed.cards, created, removed: [] };
}

/** Replace the definition while retaining one owned/run identity and only explicitly inherited patches. */
export function transformCardInstance<TCard extends PatchableCard>(
  source: TCard,
  replacement: Omit<TCard, 'id' | 'runInstanceId' | 'combatInstanceId' | 'patches' | 'patchBase' | 'attachments'>,
  policy: CardPatchInheritancePolicy = TRANSFORM_PATCH_POLICY,
): TCard {
  const transformed = {
    ...structuredClone(replacement),
    id: source.id,
    combatInstanceId: source.combatInstanceId || source.id,
    runInstanceId: source.runInstanceId,
    parentRunInstanceId: source.runInstanceId,
    parentCombatInstanceId: source.combatInstanceId || source.id,
    origin: 'transformed' as const,
    patches: inheritedCardPatches(source, policy),
    attachments: inheritedCardAttachments(source, policy),
  } as unknown as TCard;
  return materializeCardPatches(transformed);
}

/** Place already validated generated cards atomically; duplicate IDs reject the whole batch. */
export function placeGeneratedCards<TCard extends SelectableCard>(
  zones: CardZoneState<TCard>,
  cards: readonly TCard[],
  destination: CardPileZone,
  position: CardPilePosition,
): AdvancedCardZoneCommit<TCard> | { ok: false; code: 'DUPLICATE_GENERATED_ID' } {
  const existing = new Set(Object.values(snapshot(zones)).flat());
  const generatedIds = cards.map(card => card.id);
  if (new Set(generatedIds).size !== generatedIds.length || generatedIds.some(id => existing.has(id))) {
    return { ok: false, code: 'DUPLICATE_GENERATED_ID' };
  }
  const next = cloneZones(zones);
  insertAt(next[destination], cards, position);
  return { ok: true, zones: next, selected: [], created: cards.map(card => structuredClone(card)), removed: [] };
}
