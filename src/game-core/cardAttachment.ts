import type { CardMoveReason, BattleEventSource } from './battleEventJournal';
import {
  appendCardPatch,
  materializeCardPatches,
  type CardCostOperator,
  type CardKeyword,
  type CardPatch,
  type CardPatchInheritancePolicy,
  type CardPatchScope,
  type PatchableCard,
} from './cardPatch';
import type { CardValueOperator, CardValueStat, NumericExpression } from './effectDsl';
import type { PlayedCardDestination } from './cardRules';

export type CardAttachmentKind = 'enchantment' | 'affliction';
export type CardAttachmentRemovalEvent =
  | 'played'
  | 'discarded'
  | 'turn_end'
  | 'combat_end'
  | 'run_end'
  | 'manual';

export type CardAttachmentPatchChange =
  | { kind: 'numeric'; stat: CardValueStat; operator: CardValueOperator; value: number }
  | { kind: 'cost'; operator: CardCostOperator; value: number }
  | { kind: 'keyword'; keyword: CardKeyword; enabled: boolean }
  | { kind: 'replay'; extra: number }
  | { kind: 'x_value'; operator: CardCostOperator; value: number }
  | {
      kind: 'dynamic_cost';
      timing: 'on_draw' | 'while_in_hand' | 'on_play';
      operator: CardCostOperator;
      value: NumericExpression;
      minimum?: number;
      maximum?: number;
    };

/** Card-local rule replacement. It composes with combatant-level card rules. */
export type CardAttachmentRuleChange =
  | { kind: 'play_access'; mode: 'deny' | 'allow' }
  | {
      kind: 'discard_auto_play';
      reasons: CardMoveReason[];
      failureDestination: PlayedCardDestination;
      onlyPlayerTurn: boolean;
    };

export type CardAttachmentChange = CardAttachmentPatchChange | CardAttachmentRuleChange;

export interface CardAttachment {
  id: string;
  kind: CardAttachmentKind;
  name: string;
  description?: string;
  emoji?: string;
  source: BattleEventSource;
  scope: CardPatchScope;
  appliedTurn: number;
  priority: number;
  removeOn: CardAttachmentRemovalEvent;
  /** Number of matching removal events left. Omitted means the named lifecycle boundary. */
  remaining?: number;
  /** Only meaningful for `discarded`; omitted means every real hand-discard reason. */
  discardReasons?: CardMoveReason[];
  changes: CardAttachmentChange[];
  patchIds: string[];
}

export interface CardAttachmentDraft {
  id: string;
  kind: CardAttachmentKind;
  name: string;
  description?: string;
  emoji?: string;
  source: BattleEventSource;
  scope: CardPatchScope;
  appliedTurn: number;
  priority?: number;
  removeOn?: CardAttachmentRemovalEvent;
  remaining?: number;
  discardReasons?: CardMoveReason[];
  changes: CardAttachmentChange[];
}

export interface CardWithAttachments extends PatchableCard {
  attachments?: CardAttachment[];
}

const DEFAULT_REMOVAL: Readonly<Record<CardPatchScope, CardAttachmentRemovalEvent>> = {
  resolution: 'played',
  turn: 'turn_end',
  until_played: 'played',
  combat: 'combat_end',
  run: 'run_end',
  permanent: 'manual',
};

const VALID_DISCARD_REASONS = new Set<CardMoveReason>([
  'player_choice',
  'random_effect',
  'effect',
  'turn_cleanup',
  'scry',
  'recover',
  'exhaust',
  'generate',
  'copy',
  'transform',
  'auto_play',
  'other',
]);

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function validateChange(change: CardAttachmentChange, index: number): void {
  const label = `attachment change ${index}`;
  if (change.kind === 'numeric') {
    if (!Number.isFinite(change.value)) throw new Error(`${label} numeric value must be finite`);
    if (change.operator === 'divide' && change.value === 0) throw new Error(`${label} cannot divide by zero`);
  } else if (change.kind === 'cost' || change.kind === 'x_value') {
    if (!Number.isFinite(change.value)) throw new Error(`${label} cost value must be finite`);
    if (change.operator === 'divide' && change.value === 0) throw new Error(`${label} cannot divide by zero`);
  } else if (change.kind === 'replay') {
    if (!Number.isInteger(change.extra) || change.extra < 1 || change.extra > 20)
      throw new Error(`${label} replay extra must be 1..20`);
  } else if (change.kind === 'dynamic_cost') {
    if (!['on_draw', 'while_in_hand', 'on_play'].includes(change.timing))
      throw new Error(`${label} has invalid dynamic cost timing`);
    if (typeof change.value === 'number') {
      if (!Number.isFinite(change.value)) throw new Error(`${label} dynamic cost value must be finite`);
      if (change.operator === 'divide' && change.value === 0) throw new Error(`${label} cannot divide by zero`);
    } else if (!change.value || typeof change.value !== 'object') {
      throw new Error(`${label} dynamic cost requires a numeric expression`);
    }
    if (change.minimum !== undefined && !Number.isFinite(change.minimum))
      throw new Error(`${label} minimum must be finite`);
    if (change.maximum !== undefined && !Number.isFinite(change.maximum))
      throw new Error(`${label} maximum must be finite`);
    if (change.minimum !== undefined && change.maximum !== undefined && change.minimum > change.maximum)
      throw new Error(`${label} minimum cannot exceed maximum`);
  } else if (change.kind === 'discard_auto_play') {
    if (change.reasons.length < 1 || new Set(change.reasons).size !== change.reasons.length)
      throw new Error(`${label} requires unique discard reasons`);
    if (change.reasons.some(reason => !VALID_DISCARD_REASONS.has(reason)))
      throw new Error(`${label} contains an invalid discard reason`);
    if (!['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(change.failureDestination))
      throw new Error(`${label} has an invalid failure destination`);
  }
}

export function validateCardAttachmentDraft(draft: CardAttachmentDraft): void {
  nonEmpty(draft.id, 'attachment id');
  nonEmpty(draft.name, 'attachment name');
  nonEmpty(draft.source?.id, 'attachment source id');
  if (!Number.isInteger(draft.appliedTurn) || draft.appliedTurn < 0)
    throw new Error('attachment appliedTurn must be a non-negative integer');
  if (draft.priority !== undefined && !Number.isInteger(draft.priority))
    throw new Error('attachment priority must be an integer');
  if (!Array.isArray(draft.changes) || draft.changes.length < 1 || draft.changes.length > 32)
    throw new Error('attachment changes must contain 1..32 entries');
  draft.changes.forEach(validateChange);
  if (draft.remaining !== undefined && (!Number.isInteger(draft.remaining) || draft.remaining < 1 || draft.remaining > 999))
    throw new Error('attachment remaining must be an integer from 1 to 999');
  const removeOn = draft.removeOn ?? DEFAULT_REMOVAL[draft.scope];
  if (draft.discardReasons !== undefined) {
    if (removeOn !== 'discarded') throw new Error('discardReasons require removeOn discarded');
    if (draft.discardReasons.length < 1 || new Set(draft.discardReasons).size !== draft.discardReasons.length)
      throw new Error('attachment discardReasons must be unique and non-empty');
    if (draft.discardReasons.some(reason => !VALID_DISCARD_REASONS.has(reason)))
      throw new Error('attachment contains an invalid discard removal reason');
  }
}

function patchFromChange(
  attachment: Omit<CardAttachment, 'changes' | 'patchIds'>,
  change: CardAttachmentPatchChange,
  index: number,
): CardPatch {
  const base = {
    id: `${attachment.kind}:${attachment.id}:${attachment.appliedTurn}:${index + 1}`,
    source: { kind: attachment.kind, id: attachment.id, name: attachment.name } as const,
    scope: attachment.scope,
    createdTurn: attachment.appliedTurn,
    priority: attachment.priority + index,
    // The attachment owns its complete bundle lifetime. Individual patches never expire independently.
    removeOn: 'manual' as const,
  };
  return { ...base, ...structuredClone(change) } as CardPatch;
}

/** Add one named package atomically. A card may carry only one enchantment but multiple distinct afflictions. */
export function applyCardAttachment<TCard extends CardWithAttachments>(card: TCard, draft: CardAttachmentDraft): TCard {
  validateCardAttachmentDraft(draft);
  const current = card.attachments || [];
  if (current.some(entry => entry.id === draft.id)) throw new Error(`duplicate card attachment id: ${draft.id}`);
  if (draft.kind === 'enchantment' && current.some(entry => entry.kind === 'enchantment'))
    throw new Error('a card cannot carry more than one enchantment');

  const attachmentBase = {
    id: draft.id.trim(),
    kind: draft.kind,
    name: draft.name.trim(),
    ...(draft.description?.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.emoji?.trim() ? { emoji: draft.emoji.trim() } : {}),
    source: structuredClone(draft.source),
    scope: draft.scope,
    appliedTurn: draft.appliedTurn,
    priority: draft.priority ?? 0,
    removeOn: draft.removeOn ?? DEFAULT_REMOVAL[draft.scope],
    ...(draft.remaining !== undefined ? { remaining: draft.remaining } : {}),
    ...(draft.discardReasons ? { discardReasons: [...draft.discardReasons] } : {}),
  } satisfies Omit<CardAttachment, 'changes' | 'patchIds'>;
  const patchChanges = draft.changes.filter((change): change is CardAttachmentPatchChange =>
    change.kind !== 'play_access' && change.kind !== 'discard_auto_play');
  const patches = patchChanges.map((change, index) => patchFromChange(attachmentBase, change, index));
  const attachment: CardAttachment = {
    ...attachmentBase,
    changes: structuredClone(draft.changes),
    patchIds: patches.map(patch => patch.id),
  };

  let next = { ...card, attachments: [...current.map(entry => structuredClone(entry)), attachment] } as TCard;
  for (const patch of patches) next = appendCardPatch(next, patch);
  return next;
}

export function removeCardAttachment<TCard extends CardWithAttachments>(card: TCard, attachmentId: string): TCard {
  const attachment = (card.attachments || []).find(entry => entry.id === attachmentId);
  if (!attachment) return card;
  const patchIds = new Set(attachment.patchIds);
  return materializeCardPatches({
    ...card,
    attachments: (card.attachments || []).filter(entry => entry.id !== attachmentId),
    patches: (card.patches || []).filter(patch => !patchIds.has(patch.id)),
  } as TCard);
}

function removalMatches(
  attachment: CardAttachment,
  event: CardAttachmentRemovalEvent,
  reason?: CardMoveReason,
): boolean {
  if (attachment.removeOn !== event) return false;
  if (event !== 'discarded' || !attachment.discardReasons) return true;
  return reason !== undefined && attachment.discardReasons.includes(reason);
}

/** Advance named bundle lifetime after a completed event; all bundled patches are removed together. */
export function advanceCardAttachments<TCard extends CardWithAttachments>(
  card: TCard,
  event: CardAttachmentRemovalEvent,
  reason?: CardMoveReason,
): TCard {
  let next = card;
  for (const attachment of [...(card.attachments || [])]) {
    if (!removalMatches(attachment, event, reason)) continue;
    if ((attachment.remaining || 1) > 1) {
      const remaining = (attachment.remaining || 1) - 1;
      next = {
        ...next,
        attachments: (next.attachments || []).map(entry =>
          entry.id === attachment.id ? { ...entry, remaining } : entry),
      } as TCard;
    } else {
      next = removeCardAttachment(next, attachment.id);
    }
  }
  return next;
}

export function inheritedCardAttachments(
  card: CardWithAttachments,
  policy: CardPatchInheritancePolicy,
): CardAttachment[] {
  return (card.attachments || [])
    .filter(entry => policy.scopes.includes(entry.scope))
    .filter(entry => policy.includeEnchantment || entry.kind !== 'enchantment')
    .filter(entry => policy.includeAffliction || entry.kind !== 'affliction')
    .map(entry => structuredClone(entry));
}

export interface CardAttachmentPlayAccess {
  denied: boolean;
  explicitlyAllowed: boolean;
  sources: CardAttachment[];
}

export function resolveCardAttachmentPlayAccess(card: Pick<CardWithAttachments, 'attachments'>): CardAttachmentPlayAccess {
  const sources = (card.attachments || [])
    .filter(entry => entry.changes.some(change => change.kind === 'play_access'))
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  let denied = false;
  let explicitlyAllowed = false;
  for (const attachment of sources) {
    for (const change of attachment.changes) {
      if (change.kind !== 'play_access') continue;
      if (change.mode === 'deny') denied = true;
      else explicitlyAllowed = true;
    }
  }
  return { denied, explicitlyAllowed, sources: sources.map(entry => structuredClone(entry)) };
}

export interface DiscardAutoPlayResolution {
  attachment: CardAttachment;
  rule: Extract<CardAttachmentRuleChange, { kind: 'discard_auto_play' }>;
}

export interface CardDiscardLifecycleResolution {
  triggersDiscardLifecycle: boolean;
  autoPlay: DiscardAutoPlayResolution | null;
}

const TRUE_HAND_DISCARD_REASONS = new Set<CardMoveReason>([
  'player_choice',
  'random_effect',
  'effect',
]);

/** Resolve one deterministic auto-play request without treating cleanup, scry, or ordinary moves as a discard. */
export function resolveDiscardAutoPlay(
  card: Pick<CardWithAttachments, 'attachments'>,
  reason: CardMoveReason,
  phase: string,
): DiscardAutoPlayResolution | null {
  const ordered = [...(card.attachments || [])]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  for (const attachment of ordered) {
    for (const change of attachment.changes) {
      if (change.kind !== 'discard_auto_play') continue;
      if (change.onlyPlayerTurn && phase !== 'player_turn') continue;
      if (!change.reasons.includes(reason)) continue;
      return { attachment: structuredClone(attachment), rule: structuredClone(change) };
    }
  }
  return null;
}

/**
 * Classify one completed card move before firing discard programs, relics or Sly.
 * Cleanup, scry and non-hand moves remain journal events, but are not gameplay discards.
 */
export function resolveCardDiscardLifecycle(
  card: Pick<CardWithAttachments, 'attachments'>,
  reason: CardMoveReason,
  source: 'hand' | 'drawPile' | 'discardPile' | 'exhaustPile',
  phase: string,
): CardDiscardLifecycleResolution {
  const triggersDiscardLifecycle = source === 'hand' && TRUE_HAND_DISCARD_REASONS.has(reason);
  return {
    triggersDiscardLifecycle,
    autoPlay: triggersDiscardLifecycle ? resolveDiscardAutoPlay(card, reason, phase) : null,
  };
}

export function describeCardAttachmentRemaining(attachment: CardAttachment): string {
  const labels: Record<CardAttachmentRemovalEvent, string> = {
    played: '打出后移除',
    discarded: '符合弃牌原因后移除',
    turn_end: '回合结束移除',
    combat_end: '本场战斗',
    run_end: '本次流程',
    manual: '持续存在',
  };
  const count = attachment.remaining && attachment.remaining > 1 ? `，剩余${attachment.remaining}次` : '';
  return `${labels[attachment.removeOn]}${count}`;
}
