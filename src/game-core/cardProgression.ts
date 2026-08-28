import {
  appendCardPatch,
  inheritedCardPatches,
  materializeCardPatches,
  PERSISTENT_COPY_PATCH_POLICY,
  validateCardPatch,
  type CardPatch,
  type CardPatchScope,
  type CardPatchSource,
  type PatchableCard,
} from './cardPatch';

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
  upgraded?: boolean;
  upgradeLevel?: number;
  upgradeHistory?: CardUpgradeRecord[];
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
      target: { match: 'run_instance' as const, runInstanceId: card.runInstanceId || card.id },
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
  for (const combat of combatCards) {
    const runId = combat.runInstanceId;
    const index = runId ? runIndex.get(runId) : undefined;
    if (index === undefined || updated.has(runId!)) {
      ignored.push(combat.combatInstanceId || combat.id);
      continue;
    }
    const original = next[index];
    const persistentPatches = inheritedCardPatches(combat, PERSISTENT_COPY_PATCH_POLICY);
    const persistentHistory = (combat.upgradeHistory || []).filter(
      record => record.scope === 'run' || record.scope === 'permanent',
    );
    const materialized = materializeCardPatches({
      ...structuredClone(original),
      patches: persistentPatches,
      upgraded: persistentHistory.length > 0 || original.upgraded === true,
      upgradeLevel: Math.max(
        Math.max(0, Math.trunc(original.upgradeLevel || 0)),
        ...persistentHistory.map(record => record.toLevel),
      ),
      upgradeHistory: persistentHistory,
    });
    next[index] = materialized as TCard;
    updated.add(runId!);
  }
  return { cards: next, updatedRunInstanceIds: [...updated], ignoredCombatInstanceIds: ignored };
}
