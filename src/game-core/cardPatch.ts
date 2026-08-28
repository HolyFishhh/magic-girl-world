import type { CardSelectorFilter, CardValueOperator, CardValueStat, EffectProgram, NumericExpression } from './effectDsl';
import { cardMatchesSelectorFilter, type SelectableCard } from './cardSelectorRuntime';
import { transformCardEffectProgram } from './cardValueTransform';

export type CardPatchScope = 'resolution' | 'turn' | 'until_played' | 'combat' | 'run' | 'permanent';
export type CardKeyword = 'retain' | 'exhaust' | 'ethereal' | 'innate';
export type CardCostOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set' | 'min' | 'max';
export type CardPatchSourceKind =
  | 'card'
  | 'relic'
  | 'status'
  | 'ability'
  | 'system'
  | 'enchantment'
  | 'affliction';

export interface CardPatchSource {
  kind: CardPatchSourceKind;
  id: string;
  name?: string;
}

export type CardPatchTarget =
  | { match: 'instance'; combatInstanceId: string }
  | { match: 'run_instance'; runInstanceId: string }
  | { match: 'template'; templateId: string; includeFutureCopies?: boolean }
  | { match: 'filter'; filter: CardSelectorFilter; includeFutureCopies?: boolean };

interface CardPatchBase {
  id: string;
  source: CardPatchSource;
  scope: CardPatchScope;
  createdTurn: number;
  priority: number;
  target?: CardPatchTarget;
  removeOn?: 'resolution_end' | 'turn_end' | 'played' | 'combat_end' | 'run_end' | 'manual';
}

export type CardPatch =
  | (CardPatchBase & {
      kind: 'numeric';
      stat: CardValueStat;
      operator: CardValueOperator;
      value: number;
    })
  | (CardPatchBase & {
      kind: 'cost';
      operator: CardCostOperator;
      value: number;
    })
  | (CardPatchBase & {
      kind: 'keyword';
      keyword: CardKeyword;
      enabled: boolean;
    })
  | (CardPatchBase & {
      kind: 'replay';
      extra: number;
    })
  | (CardPatchBase & {
      kind: 'x_value';
      operator: Extract<CardCostOperator, 'add' | 'subtract' | 'multiply' | 'divide' | 'set' | 'min' | 'max'>;
      value: number;
    })
  | (CardPatchBase & {
      kind: 'dynamic_cost';
      timing: 'on_draw' | 'while_in_hand' | 'on_play';
      operator: CardCostOperator;
      value: NumericExpression;
      minimum?: number;
      maximum?: number;
    });

export interface CardPatchBaseSnapshot {
  effectProgram: EffectProgram;
  cost?: number | 'energy';
  retain?: boolean;
  exhaust?: boolean;
  ethereal?: boolean;
  innate?: boolean;
  replayCount?: number;
  xValueBonus?: number;
}

export interface PatchableCard extends SelectableCard {
  effectProgram: EffectProgram;
  retain?: boolean;
  exhaust?: boolean;
  ethereal?: boolean;
  innate?: boolean;
  replayCount?: number;
  xValueBonus?: number;
  doubleEffect?: boolean;
  patchBase?: CardPatchBaseSnapshot;
  patches?: CardPatch[];
}

export interface CardPatchLedger {
  patches: CardPatch[];
  nextSequence: number;
}

export interface CardPatchDraft {
  source: CardPatchSource;
  scope: CardPatchScope;
  createdTurn: number;
  priority?: number;
  target?: CardPatchTarget;
  removeOn?: CardPatchBase['removeOn'];
}

const SCOPE_REMOVAL: Readonly<Record<CardPatchScope, CardPatchBase['removeOn']>> = {
  resolution: 'resolution_end',
  turn: 'turn_end',
  until_played: 'played',
  combat: 'combat_end',
  run: 'run_end',
  permanent: 'manual',
};

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

export function createCardPatchLedger(patches: readonly CardPatch[] = []): CardPatchLedger {
  const cloned = patches.map(patch => structuredClone(patch));
  return { patches: cloned, nextSequence: cloned.length + 1 };
}

export function createCardPatch<TPatch extends Omit<CardPatch, keyof CardPatchBase | 'kind'> & { kind: CardPatch['kind'] }>(
  ledger: CardPatchLedger,
  draft: CardPatchDraft & TPatch,
): { ledger: CardPatchLedger; patch: CardPatch } {
  const sequence = Math.max(1, Math.floor(ledger.nextSequence || 1));
  const id = `${draft.source.kind}:${draft.source.id}:${Math.max(0, Math.floor(draft.createdTurn))}:${sequence}`;
  const patch = {
    ...draft,
    id,
    priority: Number.isFinite(draft.priority) ? Math.trunc(draft.priority as number) : 0,
    removeOn: draft.removeOn ?? SCOPE_REMOVAL[draft.scope],
  } as unknown as CardPatch;
  validateCardPatch(patch);
  return {
    ledger: { patches: [...ledger.patches, structuredClone(patch)], nextSequence: sequence + 1 },
    patch,
  };
}

export function validateCardPatch(patch: CardPatch): void {
  if (!patch.id.trim() || !patch.source.id.trim()) throw new Error('card patch requires stable id and source');
  if (!Number.isInteger(patch.createdTurn) || patch.createdTurn < 0) throw new Error('card patch createdTurn must be non-negative integer');
  if (!Number.isInteger(patch.priority)) throw new Error('card patch priority must be integer');
  if (patch.kind === 'numeric') {
    finiteNumber(patch.value, 'numeric patch value');
    if (patch.operator === 'divide' && patch.value === 0) throw new Error('numeric patch cannot divide by zero');
  } else if (patch.kind === 'cost') {
    finiteNumber(patch.value, 'cost patch value');
    if (patch.operator === 'divide' && patch.value === 0) throw new Error('cost patch cannot divide by zero');
  } else if (patch.kind === 'replay') {
    if (!Number.isInteger(patch.extra) || patch.extra < 1 || patch.extra > 20) throw new Error('replay patch extra must be 1..20');
  } else if (patch.kind === 'x_value') {
    finiteNumber(patch.value, 'X value patch value');
    if (patch.operator === 'divide' && patch.value === 0) throw new Error('X value patch cannot divide by zero');
  } else if (patch.kind === 'dynamic_cost') {
    if (!['on_draw', 'while_in_hand', 'on_play'].includes(patch.timing)) throw new Error('invalid dynamic cost timing');
    if (typeof patch.value === 'number') {
      finiteNumber(patch.value, 'dynamic cost patch value');
      if (patch.operator === 'divide' && patch.value === 0) throw new Error('dynamic cost patch cannot divide by zero');
    } else if (!patch.value || typeof patch.value !== 'object') {
      throw new Error('dynamic cost patch requires a numeric expression');
    }
    if (patch.minimum !== undefined) finiteNumber(patch.minimum, 'dynamic cost minimum');
    if (patch.maximum !== undefined) finiteNumber(patch.maximum, 'dynamic cost maximum');
    if (patch.minimum !== undefined && patch.maximum !== undefined && patch.minimum > patch.maximum)
      throw new Error('dynamic cost minimum cannot exceed maximum');
  }
}

function snapshot(card: PatchableCard): CardPatchBaseSnapshot {
  if (card.patchBase) return structuredClone(card.patchBase);
  return {
    effectProgram: structuredClone(card.effectProgram),
    ...(card.cost !== undefined ? { cost: card.cost } : {}),
    ...(card.retain !== undefined ? { retain: card.retain } : {}),
    ...(card.exhaust !== undefined ? { exhaust: card.exhaust } : {}),
    ...(card.ethereal !== undefined ? { ethereal: card.ethereal } : {}),
    ...(card.innate !== undefined ? { innate: card.innate } : {}),
    replayCount: card.replayCount ?? (card.doubleEffect ? 1 : 0),
    xValueBonus: card.xValueBonus ?? 0,
  };
}

export function cardPatchApplies(card: PatchableCard, patch: CardPatch): boolean {
  const target = patch.target;
  if (!target) return true;
  if (target.match === 'instance') return (card.combatInstanceId || card.id) === target.combatInstanceId;
  if (target.match === 'run_instance') return card.runInstanceId === target.runInstanceId;
  if (target.match === 'template') return (card.templateId || card.originalId) === target.templateId;
  return cardMatchesSelectorFilter(card, target.filter);
}

function applyCost(
  current: number | 'energy' | undefined,
  patch: Extract<CardPatch, { kind: 'cost' | 'x_value' }>,
): number | 'energy' | undefined {
  if (current === 'energy') return current;
  const value = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  let next: number;
  if (patch.operator === 'add') next = value + patch.value;
  else if (patch.operator === 'subtract') next = value - patch.value;
  else if (patch.operator === 'multiply') next = value * patch.value;
  else if (patch.operator === 'divide') next = value / patch.value;
  else if (patch.operator === 'set') next = patch.value;
  else if (patch.operator === 'min') next = Math.min(value, patch.value);
  else next = Math.max(value, patch.value);
  if (!Number.isFinite(next)) throw new Error('cost patch produced non-finite value');
  return Math.max(0, Math.floor(next));
}

/** Rebuild all derived fields from the immutable base, so removal never accumulates rounding drift. */
export function materializeCardPatches<TCard extends PatchableCard>(card: TCard, external: readonly CardPatch[] = []): TCard {
  const base = snapshot(card);
  const patches = [...(card.patches || []), ...external]
    .filter(patch => cardPatchApplies(card, patch))
    .sort((left, right) => left.priority - right.priority || left.createdTurn - right.createdTurn || left.id.localeCompare(right.id));
  let effectProgram = structuredClone(base.effectProgram);
  let cost = base.cost;
  const keywords = {
    retain: base.retain === true,
    exhaust: base.exhaust === true,
    ethereal: base.ethereal === true,
    innate: base.innate === true,
  };
  let replayCount = Math.max(0, Math.floor(base.replayCount || 0));
  let xValueBonus = Number.isFinite(base.xValueBonus) ? Number(base.xValueBonus) : 0;

  for (const patch of patches) {
    if (patch.kind === 'numeric') {
      effectProgram = transformCardEffectProgram(effectProgram, patch);
    } else if (patch.kind === 'cost') {
      cost = applyCost(cost, patch);
    } else if (patch.kind === 'keyword') {
      keywords[patch.keyword] = patch.enabled;
    } else if (patch.kind === 'replay') {
      replayCount = Math.min(20, replayCount + patch.extra);
    } else if (patch.kind === 'x_value') {
      xValueBonus = applyCost(xValueBonus, patch) as number;
    }
  }

  return {
    ...card,
    patchBase: base,
    effectProgram,
    cost,
    ...keywords,
    replayCount,
    xValueBonus: Math.max(0, Math.floor(xValueBonus)),
    doubleEffect: replayCount > 0 ? true : undefined,
  };
}

export function appendCardPatch<TCard extends PatchableCard>(card: TCard, patch: CardPatch): TCard {
  validateCardPatch(patch);
  if ((card.patches || []).some(existing => existing.id === patch.id)) throw new Error(`duplicate card patch id: ${patch.id}`);
  return materializeCardPatches({ ...card, patchBase: snapshot(card), patches: [...(card.patches || []), structuredClone(patch)] });
}

export type CardPatchCleanupReason = NonNullable<CardPatchBase['removeOn']>;

export function clearCardPatches<TCard extends PatchableCard>(
  card: TCard,
  reason: CardPatchCleanupReason,
): TCard {
  const remaining = (card.patches || []).filter(patch => patch.removeOn !== reason);
  return materializeCardPatches({ ...card, patches: remaining });
}

export interface CardPatchInheritancePolicy {
  scopes: readonly CardPatchScope[];
  includeEnchantment: boolean;
  includeAffliction: boolean;
}

export const TEMPORARY_COPY_PATCH_POLICY: CardPatchInheritancePolicy = {
  scopes: ['turn', 'combat', 'run', 'permanent'],
  includeEnchantment: true,
  includeAffliction: true,
};

export const PERSISTENT_COPY_PATCH_POLICY: CardPatchInheritancePolicy = {
  scopes: ['run', 'permanent'],
  includeEnchantment: true,
  includeAffliction: true,
};

export const TRANSFORM_PATCH_POLICY: CardPatchInheritancePolicy = {
  scopes: ['run', 'permanent'],
  includeEnchantment: false,
  includeAffliction: false,
};

export function inheritedCardPatches(
  source: PatchableCard,
  policy: CardPatchInheritancePolicy,
): CardPatch[] {
  return (source.patches || [])
    .filter(patch => policy.scopes.includes(patch.scope))
    .filter(patch => policy.includeEnchantment || patch.source.kind !== 'enchantment')
    .filter(patch => policy.includeAffliction || patch.source.kind !== 'affliction')
    .map(patch => structuredClone(patch));
}

export function removeLedgerPatches(
  ledger: CardPatchLedger,
  reason: CardPatchCleanupReason,
): CardPatchLedger {
  return { ...ledger, patches: ledger.patches.filter(patch => patch.removeOn !== reason) };
}
