import {
  appendCardPatch,
  clearCardPatches,
  inheritedCardPatches,
  materializeCardPatches,
  PERSISTENT_COPY_PATCH_POLICY,
  TRANSFORM_PATCH_POLICY,
  validateCardPatch,
  type CardPatch,
  type CardPatchScope,
  type CardPatchSource,
  type PatchableCard,
} from './cardPatch';
import {
  advanceCardAttachments,
  inheritedCardAttachments,
  removeCardAttachment,
  validateCardAttachmentDraft,
  type CardAttachment,
} from './cardAttachment';
import { allocateRuntimeId } from './runtimeIds';

export type CardUpgradeChange =
  | Pick<Extract<CardPatch, { kind: 'numeric' }>, 'kind' | 'stat' | 'operator' | 'value'>
  | Pick<Extract<CardPatch, { kind: 'cost' }>, 'kind' | 'operator' | 'value'>
  | Pick<Extract<CardPatch, { kind: 'keyword' }>, 'kind' | 'keyword' | 'enabled'>
  | Pick<Extract<CardPatch, { kind: 'replay' }>, 'kind' | 'extra'>
  | Pick<Extract<CardPatch, { kind: 'x_value' }>, 'kind' | 'operator' | 'value'>
  | Pick<Extract<CardPatch, { kind: 'dynamic_cost' }>, 'kind' | 'timing' | 'operator' | 'value' | 'minimum' | 'maximum'>;

export interface CardUpgradeRequest {
  source: CardPatchSource;
  scope: Extract<CardPatchScope, 'combat' | 'run' | 'permanent'>;
  createdTurn: number;
  changes: readonly CardUpgradeChange[];
  levels?: number;
  /** Omit to allow repeatable upgrades; set to one for ordinary single upgrades. */
  maxLevel?: number;
  priority?: number;
  packageId?: string;
}

export interface CardUpgradeRecord {
  id: string;
  source: CardPatchSource;
  scope: CardUpgradeRequest['scope'];
  fromLevel: number;
  toLevel: number;
  patchIds: string[];
}

export interface ProgressionCard extends PatchableCard {
  quantity?: number;
  parentCombatInstanceId?: string;
  upgraded?: boolean;
  upgradeLevel?: number;
  upgradeHistory?: CardUpgradeRecord[];
}

export interface PersistentCardCarrier extends Record<string, any> {
  id?: string;
  originalId?: string;
  templateId?: string;
  runInstanceId?: string;
  runInstanceIds?: string[];
  combatInstanceId?: string;
  parentRunInstanceId?: string;
  parentCombatInstanceId?: string;
  origin?: string;
  quantity?: number;
}

export type PersistentRunCard<TCard extends PersistentCardCarrier = PersistentCardCarrier> = TCard & {
  id: string;
  runInstanceId: string;
  templateId: string;
  quantity: 1;
};

export type PersistentDeckMutation<TCard extends PersistentCardCarrier = PersistentCardCarrier> =
  | { kind: 'remove'; runInstanceId: string }
  | { kind: 'duplicate'; runInstanceId: string }
  | {
      kind: 'transform';
      runInstanceId: string;
      replacement: Omit<TCard, 'runInstanceId' | 'combatInstanceId' | 'quantity'>;
    };

export interface PersistentDeckMutationResult<TCard extends PersistentCardCarrier> {
  cards: Array<PersistentRunCard<TCard>>;
  sourceRunInstanceId: string;
  createdRunInstanceId?: string;
  removedRunInstanceId?: string;
}

function cardTemplateId(card: PersistentCardCarrier): string {
  const value = String(card.templateId || card.originalId || card.id || '').trim();
  if (!value) throw new Error('persistent card requires id/templateId');
  return value;
}

function cardQuantity(card: PersistentCardCarrier): number {
  const value = card.quantity === undefined ? 1 : Number(card.quantity);
  if (!Number.isInteger(value) || value < 1 || value > 999) {
    throw new Error('persistent card quantity must be an integer from 1 to 999');
  }
  return value;
}

function explicitRunIds(card: PersistentCardCarrier): string[] {
  const legacy = card.runInstanceIds;
  if (legacy !== undefined && (!Array.isArray(legacy) || legacy.some(value => typeof value !== 'string' || !value.trim()))) {
    throw new Error('persistent card runInstanceIds must contain non-empty strings');
  }
  const legacyIds = ((legacy as string[] | undefined) || []).map(value => value.trim());
  if (new Set(legacyIds).size !== legacyIds.length) throw new Error('persistent card runInstanceIds must not contain duplicates');
  const singular = typeof card.runInstanceId === 'string' && card.runInstanceId.trim() ? card.runInstanceId.trim() : null;
  return [...(singular ? [singular] : []), ...legacyIds.filter(value => value !== singular)];
}

function persistentCopy<TCard extends PersistentCardCarrier>(
  card: TCard,
  templateId: string,
  runInstanceId: string,
): PersistentRunCard<TCard> {
  const next = structuredClone(card) as PersistentRunCard<TCard>;
  delete next.combatInstanceId;
  delete next.parentCombatInstanceId;
  delete next.runInstanceIds;
  next.templateId = templateId;
  next.runInstanceId = runInstanceId;
  next.quantity = 1;
  next.origin = card.origin || 'deck';
  replacePersistentProgressionMetadata(next, card, runInstanceId, PERSISTENT_COPY_PATCH_POLICY);
  return next;
}

function replacePersistentProgressionMetadata(
  target: Record<string, any>,
  source: unknown,
  runInstanceId: string,
  policy: { scopes: readonly CardPatchScope[]; includeEnchantment: boolean; includeAffliction: boolean },
): void {
  const stored = progressionMetadata(source);
  const meta = isRecord(target.$meta) ? structuredClone(target.$meta) : {};
  delete meta[PERSISTENT_CARD_PROGRESSION_META_KEY];

  if (!stored) {
    if (Object.keys(meta).length > 0) target.$meta = meta;
    else delete target.$meta;
    return;
  }

  const patches = stored.patches
    .filter(patch => policy.scopes.includes(patch.scope))
    .filter(patch => policy.includeEnchantment || patch.source.kind !== 'enchantment')
    .filter(patch => policy.includeAffliction || patch.source.kind !== 'affliction')
    .filter(patch => patch.target?.match !== 'instance')
    .map(patch => {
      const next = structuredClone(patch);
      if (next.target?.match === 'run_instance') {
        next.target = { match: 'run_instance', runInstanceId };
      }
      return next;
    });
  const patchIds = new Set(patches.map(patch => patch.id));
  const attachments = stored.attachments
    .filter(attachment => policy.scopes.includes(attachment.scope))
    .filter(attachment => policy.includeEnchantment || attachment.kind !== 'enchantment')
    .filter(attachment => policy.includeAffliction || attachment.kind !== 'affliction')
    .map(attachment => ({
      ...structuredClone(attachment),
      patchIds: attachment.patchIds.filter(id => patchIds.has(id)),
    }));
  const upgradeHistory = stored.upgradeHistory
    .filter(record => policy.scopes.includes(record.scope))
    .map(record => ({
      ...structuredClone(record),
      patchIds: record.patchIds.filter(id => patchIds.has(id)),
    }))
    .filter(record => record.patchIds.length > 0);
  const upgradeLevel = Math.max(0, ...upgradeHistory.map(record => record.toLevel));

  if (patches.length > 0 || attachments.length > 0 || upgradeHistory.length > 0 || upgradeLevel > 0) {
    meta[PERSISTENT_CARD_PROGRESSION_META_KEY] = {
      version: 1,
      patches,
      attachments,
      upgradeHistory,
      upgraded: upgradeLevel > 0,
      upgradeLevel,
    } satisfies PersistentCardProgressionMetadata;
  }
  if (Object.keys(meta).length > 0) target.$meta = meta;
  else delete target.$meta;
  if (upgradeLevel > 0) target.upgrade_level = upgradeLevel;
  else delete target.upgrade_level;
}

/**
 * Upgrade legacy `id + quantity` run decks into one record per owned card. Explicit identities
 * are preserved and duplicate explicit identities reject the whole migration. Generated IDs are
 * deterministic, so restoring and migrating the same save produces the same instance layout.
 */
export function migratePersistentRunDeck<TCard extends PersistentCardCarrier>(
  cardsValue: readonly TCard[],
): Array<PersistentRunCard<TCard>> {
  if (!Array.isArray(cardsValue)) throw new Error('persistent run deck must be an array');
  const used = new Set<string>();
  const cards: Array<PersistentRunCard<TCard>> = [];

  for (const card of cardsValue) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('persistent run card must be an object');
    const templateId = cardTemplateId(card);
    const quantity = cardQuantity(card);
    const explicit = explicitRunIds(card);
    if (explicit.length > quantity) throw new Error(`persistent card ${templateId} has more identities than copies`);
    for (const runInstanceId of explicit) {
      if (used.has(runInstanceId)) throw new Error(`duplicate run card identity: ${runInstanceId}`);
      used.add(runInstanceId);
    }
    for (let index = 0; index < quantity; index += 1) {
      const runInstanceId = explicit[index] || allocateRuntimeId(`${templateId}__run`, used);
      used.add(runInstanceId);
      cards.push(persistentCopy(card, templateId, runInstanceId));
    }
  }
  return cards;
}

function requirePersistentCardIndex(cards: readonly PersistentRunCard[], runInstanceId: string): number {
  if (typeof runInstanceId !== 'string' || !runInstanceId.trim()) {
    throw new Error('runInstanceId must be a non-empty string');
  }
  const matches = cards
    .map((card, index) => ({ card, index }))
    .filter(entry => entry.card.runInstanceId === runInstanceId);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? 'selected run card was not found' : 'selected run card identity is ambiguous');
  }
  return matches[0].index;
}

/** Apply one persistent remove/copy/transform without mutating the source deck. */
export function applyPersistentDeckMutation<TCard extends PersistentCardCarrier>(
  cardsValue: readonly TCard[],
  mutation: PersistentDeckMutation<TCard>,
): PersistentDeckMutationResult<TCard> {
  const cards = migratePersistentRunDeck(cardsValue);
  const index = requirePersistentCardIndex(cards, mutation.runInstanceId);
  const source = cards[index];

  if (mutation.kind === 'remove') {
    cards.splice(index, 1);
    return {
      cards,
      sourceRunInstanceId: source.runInstanceId,
      removedRunInstanceId: source.runInstanceId,
    };
  }

  if (mutation.kind === 'duplicate') {
    const existing = new Set(cards.map(card => card.runInstanceId));
    const createdRunInstanceId = allocateRuntimeId(`${source.templateId}__run`, existing);
    const duplicate = persistentCopy(
      {
        ...structuredClone(source),
        origin: 'copied',
        parentRunInstanceId: source.runInstanceId,
        patches: inheritedCardPatches(source as unknown as ProgressionCard, PERSISTENT_COPY_PATCH_POLICY),
        attachments: inheritedCardAttachments(source as unknown as ProgressionCard, PERSISTENT_COPY_PATCH_POLICY),
        upgradeHistory: (source.upgradeHistory || []).filter(
          (record: CardUpgradeRecord) => record.scope === 'run' || record.scope === 'permanent',
        ),
      } as TCard,
      source.templateId,
      createdRunInstanceId,
    );
    cards.splice(index + 1, 0, duplicate);
    return { cards, sourceRunInstanceId: source.runInstanceId, createdRunInstanceId };
  }

  if (!mutation.replacement || typeof mutation.replacement !== 'object' || Array.isArray(mutation.replacement)) {
    throw new Error('persistent card transform requires a replacement card');
  }
  const replacement = structuredClone(mutation.replacement) as TCard;
  if (cardQuantity(replacement) !== 1) throw new Error('persistent card transform replacement quantity must be 1');
  const templateId = cardTemplateId(replacement);
  const transformed = persistentCopy(
    {
      ...replacement,
      origin: 'transformed',
      parentRunInstanceId: source.runInstanceId,
      patches: inheritedCardPatches(source as unknown as ProgressionCard, TRANSFORM_PATCH_POLICY),
      attachments: inheritedCardAttachments(source as unknown as ProgressionCard, TRANSFORM_PATCH_POLICY),
    } as TCard,
    templateId,
    source.runInstanceId,
  );
  replacePersistentProgressionMetadata(
    transformed,
    source,
    source.runInstanceId,
    TRANSFORM_PATCH_POLICY,
  );
  cards[index] = transformed;
  return { cards, sourceRunInstanceId: source.runInstanceId };
}

function positiveInteger(value: unknown, fallback: number, label: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || (resolved as number) < 1 || (resolved as number) > 99) {
    throw new Error(`${label} must be an integer from 1 to 99`);
  }
  return resolved as number;
}

function cleanupForScope(scope: CardUpgradeRequest['scope']): CardPatch['removeOn'] {
  if (scope === 'combat') return 'combat_end';
  if (scope === 'run') return 'run_end';
  return 'manual';
}

function upgradeId(card: ProgressionCard, request: CardUpgradeRequest, nextLevel: number): string {
  const identity = card.runInstanceId || card.combatInstanceId || card.id;
  const packageId = request.packageId?.trim() || `${request.source.kind}:${request.source.id}`;
  return `${packageId}:${identity}:upgrade:${nextLevel}`;
}

/**
 * Apply one logical upgrade as an atomic patch bundle. The source card is never mutated.
 * A bundle increments the level once even when it changes several independent channels.
 */
export function applyCardUpgradeBundle<TCard extends ProgressionCard>(
  card: TCard,
  request: CardUpgradeRequest,
): TCard {
  if (!request.source?.id?.trim()) throw new Error('card upgrade requires a stable source');
  if (!Number.isInteger(request.createdTurn) || request.createdTurn < 0) {
    throw new Error('card upgrade createdTurn must be a non-negative integer');
  }
  if (!Array.isArray(request.changes) || request.changes.length === 0) {
    throw new Error('card upgrade requires at least one change');
  }
  if (request.changes.length > 32) throw new Error('card upgrade change limit exceeded');

  const levels = positiveInteger(request.levels, 1, 'card upgrade levels');
  const currentLevel = Math.max(0, Math.trunc(card.upgradeLevel || 0));
  const nextLevel = currentLevel + levels;
  if (request.maxLevel !== undefined) {
    const maximum = positiveInteger(request.maxLevel, 1, 'card upgrade maxLevel');
    if (nextLevel > maximum) throw new Error('card has reached its upgrade limit');
  }

  const id = upgradeId(card, request, nextLevel);
  if ((card.upgradeHistory || []).some(record => record.id === id)) {
    throw new Error(`duplicate card upgrade package: ${id}`);
  }
  const patchIds: string[] = [];
  const patches = request.changes.map((change, index): CardPatch => {
    const common = {
      id: `${id}:${index + 1}`,
      source: structuredClone(request.source),
      scope: request.scope,
      createdTurn: request.createdTurn,
      priority: Number.isInteger(request.priority) ? (request.priority as number) : 0,
      removeOn: cleanupForScope(request.scope),
      target: card.runInstanceId
        ? { match: 'run_instance' as const, runInstanceId: card.runInstanceId }
        : { match: 'instance' as const, combatInstanceId: card.combatInstanceId || card.id },
    };
    const patch = { ...common, ...structuredClone(change) } as CardPatch;
    validateCardPatch(patch);
    patchIds.push(patch.id);
    return patch;
  });

  let next = structuredClone(card) as TCard;
  for (const patch of patches) next = appendCardPatch(next, patch);
  return {
    ...next,
    upgraded: true,
    upgradeLevel: nextLevel,
    upgradeHistory: [
      ...(next.upgradeHistory || []),
      {
        id,
        source: structuredClone(request.source),
        scope: request.scope,
        fromLevel: currentLevel,
        toLevel: nextLevel,
        patchIds,
      },
    ],
  };
}

export interface PersistentCardWriteBackResult<TCard> {
  cards: TCard[];
  updatedRunInstanceIds: string[];
  ignoredCombatInstanceIds: string[];
}

export const PERSISTENT_CARD_PROGRESSION_META_KEY = 'mwg_card_progression' as const;

export interface PersistentCardProgressionMetadata {
  version: 1;
  patches: CardPatch[];
  attachments: CardAttachment[];
  upgradeHistory: CardUpgradeRecord[];
  upgraded: boolean;
  upgradeLevel: number;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function progressionMetadata(value: unknown): PersistentCardProgressionMetadata | null {
  if (!isRecord(value)) return null;
  const metadataRoot = isRecord(value.$meta) ? value.$meta : null;
  const stored = metadataRoot?.[PERSISTENT_CARD_PROGRESSION_META_KEY];
  if (!isRecord(stored)) return null;
  if (stored.version !== 1) throw new Error('persistent card progression metadata version is invalid');
  if (!Array.isArray(stored.patches) || !Array.isArray(stored.attachments) || !Array.isArray(stored.upgradeHistory)) {
    throw new Error('persistent card progression metadata is malformed');
  }

  const patches = structuredClone(stored.patches) as CardPatch[];
  for (const patch of patches) {
    validateCardPatch(patch);
    if (patch.scope !== 'run' && patch.scope !== 'permanent') {
      throw new Error('persistent card progression contains a non-persistent patch');
    }
  }
  const patchIds = new Set(patches.map(patch => patch.id));
  if (patchIds.size !== patches.length) throw new Error('persistent card progression contains duplicate patch ids');

  const attachments = structuredClone(stored.attachments) as CardAttachment[];
  for (const attachment of attachments) {
    if (attachment.scope !== 'run' && attachment.scope !== 'permanent') {
      throw new Error('persistent card progression contains a non-persistent attachment');
    }
    validateCardAttachmentDraft({
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      description: attachment.description,
      emoji: attachment.emoji,
      source: attachment.source,
      scope: attachment.scope,
      appliedTurn: attachment.appliedTurn,
      priority: attachment.priority,
      removeOn: attachment.removeOn,
      remaining: attachment.remaining,
      discardReasons: attachment.discardReasons,
      changes: attachment.changes,
    });
    if (!Array.isArray(attachment.patchIds) || attachment.patchIds.some(id => !patchIds.has(id))) {
      throw new Error('persistent card attachment patch references are invalid');
    }
  }

  const upgradeHistory = structuredClone(stored.upgradeHistory) as CardUpgradeRecord[];
  if (upgradeHistory.some(record => !record || (record.scope !== 'run' && record.scope !== 'permanent'))) {
    throw new Error('persistent card progression contains invalid upgrade history');
  }
  const upgradeLevel = Number(stored.upgradeLevel ?? 0);
  if (!Number.isInteger(upgradeLevel) || upgradeLevel < 0 || upgradeLevel > 999) {
    throw new Error('persistent card progression upgrade level is invalid');
  }
  return {
    version: 1,
    patches,
    attachments,
    upgradeHistory,
    upgraded: stored.upgraded === true || upgradeLevel > 0,
    upgradeLevel,
  };
}

/** Restore only validated run/permanent progression from one canonical MVU card definition. */
export function restorePersistentCardProgression<TCard extends ProgressionCard>(
  card: TCard,
  definition: unknown,
): TCard {
  const stored = progressionMetadata(definition);
  const legacyLevel = isRecord(definition) ? Number(definition.upgrade_level ?? 0) : 0;
  if (!stored) {
    if (!Number.isInteger(legacyLevel) || legacyLevel < 0 || legacyLevel > 999) {
      throw new Error('persistent card upgrade_level is invalid');
    }
    return legacyLevel > 0
      ? ({ ...card, upgraded: true, upgradeLevel: legacyLevel } as TCard)
      : card;
  }
  return materializeCardPatches({
    ...structuredClone(card),
    patches: stored.patches,
    attachments: stored.attachments,
    upgradeHistory: stored.upgradeHistory,
    upgraded: stored.upgraded,
    upgradeLevel: Math.max(stored.upgradeLevel, Number.isInteger(legacyLevel) ? legacyLevel : 0),
  } as TCard);
}

/**
 * Store runtime progression beside the original compact MVU definition. Compact `effects` remain
 * the immutable base; validated patches are materialized again when the next combat is loaded.
 */
export function serializePersistentCardProgression<TCard extends ProgressionCard & PersistentCardCarrier>(
  definition: Record<string, any>,
  card: TCard,
): Record<string, any> {
  if (!card.runInstanceId) throw new Error('persistent card serialization requires runInstanceId');
  const next = structuredClone(definition);
  next.quantity = 1;
  next.templateId = card.templateId || card.originalId || definition.templateId || definition.id;
  next.runInstanceId = card.runInstanceId;
  next.origin = card.origin || definition.origin || 'deck';
  if (card.parentRunInstanceId) next.parentRunInstanceId = card.parentRunInstanceId;
  else delete next.parentRunInstanceId;
  delete next.runInstanceIds;

  const patches = inheritedCardPatches(card, PERSISTENT_COPY_PATCH_POLICY);
  const attachments = inheritedCardAttachments(card, PERSISTENT_COPY_PATCH_POLICY);
  const upgradeHistory = (card.upgradeHistory || [])
    .filter(record => record.scope === 'run' || record.scope === 'permanent')
    .map(record => structuredClone(record));
  const upgradeLevel = Math.max(
    0,
    Math.trunc(card.upgradeLevel || 0),
    ...upgradeHistory.map(record => record.toLevel),
  );
  if (upgradeLevel > 0) next.upgrade_level = upgradeLevel;
  else delete next.upgrade_level;

  const meta = isRecord(next.$meta) ? structuredClone(next.$meta) : {};
  if (patches.length > 0 || attachments.length > 0 || upgradeHistory.length > 0 || upgradeLevel > 0) {
    meta[PERSISTENT_CARD_PROGRESSION_META_KEY] = {
      version: 1,
      patches,
      attachments,
      upgradeHistory,
      upgraded: card.upgraded === true || upgradeLevel > 0,
      upgradeLevel,
    } satisfies PersistentCardProgressionMetadata;
  } else {
    delete meta[PERSISTENT_CARD_PROGRESSION_META_KEY];
  }
  if (Object.keys(meta).length > 0) next.$meta = meta;
  else delete next.$meta;
  return next;
}

/** Remove one real lifecycle scope as a single card-progression operation. */
export function cleanupCardProgression<TCard extends ProgressionCard>(
  card: TCard,
  event: 'combat_end' | 'run_end',
): TCard {
  const afterAttachments = advanceCardAttachments(card, event);
  const removedScope = event === 'combat_end' ? 'combat' : 'run';
  let boundedAttachments = afterAttachments;
  for (const attachment of [...(boundedAttachments.attachments || [])]) {
    if (attachment.scope === removedScope) boundedAttachments = removeCardAttachment(boundedAttachments, attachment.id);
  }
  const afterEventPatches = clearCardPatches(boundedAttachments, event);
  const afterPatches = materializeCardPatches({
    ...afterEventPatches,
    patches: (afterEventPatches.patches || []).filter(patch => patch.scope !== removedScope),
  } as TCard);
  const history = afterPatches.upgradeHistory || [];
  const removed = history.filter(record => record.scope === removedScope);
  if (removed.length === 0) return afterPatches;
  const remaining = history.filter(record => record.scope !== removedScope);
  const baseline = Math.min(...removed.map(record => Math.max(0, Math.trunc(record.fromLevel || 0))));
  const upgradeLevel = Math.max(baseline, 0, ...remaining.map(record => Math.max(0, Math.trunc(record.toLevel || 0))));
  return {
    ...afterPatches,
    upgradeHistory: remaining,
    upgradeLevel,
    upgraded: upgradeLevel > 0,
  };
}

/**
 * Persist run/permanent changes from concrete combat instances without leaking combat-only
 * identities or patches. Temporary copies that share a run identity are deliberately ignored.
 */
export function writeBackPersistentCardProgression<TCard extends ProgressionCard>(
  runCards: readonly TCard[],
  combatCards: readonly TCard[],
): PersistentCardWriteBackResult<TCard> {
  const next = structuredClone(runCards) as TCard[];
  const runIndex = new Map<string, number>();
  next.forEach((card, index) => {
    if (!card.runInstanceId) throw new Error('persistent card write-back requires runInstanceId');
    if (runIndex.has(card.runInstanceId)) throw new Error(`duplicate run card identity: ${card.runInstanceId}`);
    runIndex.set(card.runInstanceId, index);
  });

  const updated = new Set<string>();
  const ignored: string[] = [];
  const rootsByRunId = new Map<string, TCard[]>();
  for (const combat of combatCards) {
    const runId = combat.runInstanceId;
    // A combat-only copy shares its owner's run identity. It must never win write-back merely
    // because its zone happened to be enumerated first.
    if (!runId || combat.parentCombatInstanceId) {
      ignored.push(combat.combatInstanceId || combat.id);
      continue;
    }
    if (!runIndex.has(runId)) {
      ignored.push(combat.combatInstanceId || combat.id);
      continue;
    }
    const roots = rootsByRunId.get(runId) || [];
    roots.push(combat);
    rootsByRunId.set(runId, roots);
  }

  for (const [runId, roots] of rootsByRunId) {
    if (roots.length !== 1) throw new Error(`combat run card identity is ambiguous: ${runId}`);
    const combat = roots[0];
    const index = runIndex.get(runId)!;
    const original = next[index];
    const persistentPatches = inheritedCardPatches(combat, PERSISTENT_COPY_PATCH_POLICY).map(patch =>
      patch.target?.match === 'instance'
        ? {
            ...patch,
            target: { match: 'run_instance' as const, runInstanceId: runId },
          }
        : patch,
    );
    const persistentAttachments = inheritedCardAttachments(combat, PERSISTENT_COPY_PATCH_POLICY);
    const persistentHistory = (combat.upgradeHistory || []).filter(
      record => record.scope === 'run' || record.scope === 'permanent',
    );
    const materialized = materializeCardPatches({
      ...structuredClone(original),
      patches: persistentPatches,
      attachments: persistentAttachments,
      upgraded: persistentHistory.length > 0 || original.upgraded === true,
      upgradeLevel: Math.max(
        Math.max(0, Math.trunc(original.upgradeLevel || 0)),
        ...persistentHistory.map(record => record.toLevel),
      ),
      upgradeHistory: persistentHistory,
    });
    next[index] = materialized as TCard;
    updated.add(runId);
  }
  return { cards: next, updatedRunInstanceIds: [...updated], ignoredCombatInstanceIds: ignored };
}
