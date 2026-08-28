import { allocateRuntimeId } from './runtimeIds';

export type CardOrigin = 'deck' | 'generated' | 'copied' | 'transformed';

export interface CardIdentity {
  /** Immutable content/template identity shared by cards created from the same definition. */
  templateId: string;
  /** Stable identity of one owned card for the whole run. */
  runInstanceId: string;
  /** Identity of this concrete combat copy. Kept equal to legacy `id`. */
  combatInstanceId: string;
  /** How this instance entered the current lineage. */
  origin: CardOrigin;
  /** Parent run instance for copies/transforms; omitted for deck/generated roots. */
  parentRunInstanceId?: string;
  /** Parent combat instance when a temporary combat copy was produced. */
  parentCombatInstanceId?: string;
}

export interface CardIdentityCarrier {
  id?: string;
  originalId?: string;
  templateId?: string;
  runInstanceId?: string;
  combatInstanceId?: string;
  origin?: CardOrigin;
  parentRunInstanceId?: string;
  parentCombatInstanceId?: string;
}

export interface EnsureCardIdentityOptions {
  origin?: CardOrigin;
  existingCombatIds?: ReadonlySet<string>;
  existingRunIds?: ReadonlySet<string>;
  templateId?: string;
  runInstanceId?: string;
  combatInstanceId?: string;
  parent?: CardIdentityCarrier;
  /** A combat-only copy shares its parent's run identity and is never written back to the run deck. */
  temporaryCombatCopy?: boolean;
}

function normalizedTemplateId(value: unknown): string {
  const normalized = String(value ?? '').trim().replace(/\s+/g, '_');
  return normalized || 'card';
}

function allocateRunInstanceId(templateId: string, existingIds: ReadonlySet<string>): string {
  return allocateRuntimeId(`${templateId}__run`, existingIds);
}

/**
 * Upgrade legacy card data to the four-layer identity model without time/random globals.
 * Existing explicit identities always win, making save migration idempotent.
 */
export function ensureCardIdentity<TCard extends CardIdentityCarrier>(
  card: TCard,
  options: EnsureCardIdentityOptions = {},
): TCard & CardIdentity & { id: string; originalId: string } {
  const parent = options.parent;
  const templateId = normalizedTemplateId(
    options.templateId ?? card.templateId ?? card.originalId ?? parent?.templateId ?? card.id,
  );
  const existingRunIds = options.existingRunIds ?? new Set<string>();
  const existingCombatIds = options.existingCombatIds ?? new Set<string>();
  const temporaryCombatCopy = options.temporaryCombatCopy === true;
  const runInstanceId =
    options.runInstanceId ??
    card.runInstanceId ??
    (temporaryCombatCopy ? parent?.runInstanceId : undefined) ??
    allocateRunInstanceId(templateId, existingRunIds);
  const requestedCombatId = options.combatInstanceId ?? card.combatInstanceId ?? card.id;
  // An identity already stored on the card is authoritative during migration/restoration.
  // Collision avoidance is only needed when no concrete combat identity exists yet.
  const combatInstanceId = requestedCombatId || allocateRuntimeId(templateId, existingCombatIds);
  const origin = options.origin ?? card.origin ?? (parent ? 'copied' : 'deck');

  return {
    ...card,
    id: combatInstanceId,
    originalId: templateId,
    templateId,
    runInstanceId,
    combatInstanceId,
    origin,
    ...(card.parentRunInstanceId || parent?.runInstanceId
      ? { parentRunInstanceId: card.parentRunInstanceId ?? parent?.runInstanceId }
      : {}),
    ...(card.parentCombatInstanceId || parent?.combatInstanceId || parent?.id
      ? { parentCombatInstanceId: card.parentCombatInstanceId ?? parent?.combatInstanceId ?? parent?.id }
      : {}),
  };
}

export type CardIdentityMatch = 'instance' | 'run_instance' | 'template' | 'lineage';

/** Explicit identity comparison; callers must choose whether they mean this copy, owned card, or template. */
export function cardsShareIdentity(
  left: CardIdentityCarrier,
  right: CardIdentityCarrier,
  match: CardIdentityMatch,
): boolean {
  if (match === 'instance') return Boolean(left.combatInstanceId || left.id) && (left.combatInstanceId || left.id) === (right.combatInstanceId || right.id);
  if (match === 'run_instance') return Boolean(left.runInstanceId) && left.runInstanceId === right.runInstanceId;
  const leftTemplate = left.templateId || left.originalId;
  const rightTemplate = right.templateId || right.originalId;
  if (match === 'template') return Boolean(leftTemplate) && leftTemplate === rightTemplate;
  const leftLineage = new Set([left.runInstanceId, left.parentRunInstanceId].filter(Boolean));
  return [right.runInstanceId, right.parentRunInstanceId].some(value => Boolean(value) && leftLineage.has(value));
}

export interface CardCopyIdentityOptions {
  temporaryCombatCopy?: boolean;
  existingCombatIds?: ReadonlySet<string>;
  existingRunIds?: ReadonlySet<string>;
}

/** Create only the identity fields for a copy; payload inheritance is handled by the patch system. */
export function createCardCopyIdentity(
  source: CardIdentityCarrier,
  options: CardCopyIdentityOptions = {},
): CardIdentity & { id: string; originalId: string } {
  return ensureCardIdentity(
    {},
    {
      parent: source,
      templateId: source.templateId || source.originalId || source.id,
      origin: 'copied',
      temporaryCombatCopy: options.temporaryCombatCopy ?? true,
      existingCombatIds: options.existingCombatIds,
      existingRunIds: options.existingRunIds,
    },
  );
}

/** Strip combat-only identity before writing one owned card back to persistent run state. */
export function persistentCardIdentity(identity: CardIdentityCarrier): Pick<CardIdentity, 'templateId' | 'runInstanceId' | 'origin'> & {
  parentRunInstanceId?: string;
} {
  const normalized = ensureCardIdentity(identity);
  return {
    templateId: normalized.templateId,
    runInstanceId: normalized.runInstanceId,
    origin: normalized.origin,
    ...(normalized.parentRunInstanceId ? { parentRunInstanceId: normalized.parentRunInstanceId } : {}),
  };
}
