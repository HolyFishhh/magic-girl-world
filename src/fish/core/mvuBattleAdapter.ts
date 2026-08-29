import {
  allocateRuntimeId,
  compileCompactEffectList,
  ensureCardIdentity,
  normalizeOrbContainer,
  normalizeCombatResourceStates,
  normalizeChinesePlayerDescription,
  migratePersistentRunDeck,
  serializePersistentCardProgression,
  writeBackPersistentCardProgression,
  roundBattleValue,
  selectEnemyAction,
  summarizeEffectProgram,
} from '../../game-core';
import type {
  ActiveStance,
  Card,
  EffectNode,
  EffectProgram,
  Enemy,
  EnemyIntent,
  OrbContainer,
  OrbInstance,
  Relic,
} from '../../game-core';
import { normalizeRuntimeStatusDefinition } from '../../game-core';
import { flattenMvuArray, normalizeMvuStatusDefinitions } from '../../runtime/mvuArrays';
import {
  normalizeAbilityDefinition,
  normalizeActiveStatus,
  normalizeCardDefinition,
  normalizeEnemyAction,
  normalizeItemDefinition,
  normalizeNamedEffectDefinition,
  normalizeRelicDefinition,
} from './battleContentAdapter';

export function normalizeMvuArray<T extends Record<string, any> = Record<string, any>>(value: unknown): T[] {
  return flattenMvuArray<T>(value, { objectsOnly: true });
}

export interface MvuStatusDisplayContext {
  statusNames: Readonly<Record<string, string>>;
  statusDescriptions: Readonly<Record<string, string>>;
}

/** Resolve status labels before descriptions so cross-status references always use visible names. */
export function buildMvuStatusDisplayContext(mvuStatuses: unknown): MvuStatusDisplayContext {
  const statuses = normalizeMvuStatusDefinitions(mvuStatuses);
  const statusNames = Object.fromEntries(
    statuses
      .filter(status => typeof status.id === 'string' && typeof status.name === 'string' && status.name.trim())
      .map(status => [status.id, status.name.trim()]),
  );
  const statusDescriptions: Record<string, string> = {};
  for (const status of statuses) {
    const normalized = normalizeRuntimeStatusDefinition(status, { statusNames });
    if (normalized) statusDescriptions[normalized.id] = normalized.description;
  }
  return { statusNames, statusDescriptions };
}

export function mergeMvuCards(...sources: unknown[]): Record<string, any>[] {
  const cards: Record<string, any>[] = [];
  const legacyTemplates = new Set<string>();
  for (const source of sources) {
    for (const card of normalizeMvuArray(source)) {
      // Program-migrated decks deliberately contain one record per owned card. Never collapse
      // those records back to one template merely because their authored `id` is shared.
      if (typeof card.runInstanceId === 'string' && card.runInstanceId.trim()) {
        cards.push(card);
        continue;
      }
      const key = String(card.id || card.name || '').trim();
      if (key && !legacyTemplates.has(key)) {
        legacyTemplates.add(key);
        cards.push(card);
      }
    }
  }
  return cards;
}

export function convertMvuCards(
  mvuCards: unknown,
  options: {
    idSuffix?: string;
    createId?: (sourceId: string, index: number) => string;
    existingIds?: Iterable<string>;
    statusNames?: Readonly<Record<string, string>>;
  } = {},
): Card[] {
  const cards: Card[] = [];
  const usedIds = new Set(options.existingIds || []);
  const usedRunIds = new Set<string>();
  let cardIndex = 0;

  const validDefinitions = normalizeMvuArray(mvuCards).filter(card =>
    normalizeCardDefinition(card, { statusNames: options.statusNames }) !== null,
  );
  // Expand ownership before runtime conversion. Generated IDs are deterministic and explicit IDs
  // survive save/restore, so each owned copy keeps one stable run identity across combats.
  for (const card of migratePersistentRunDeck(validDefinitions)) {
    const normalized = normalizeCardDefinition(card, { statusNames: options.statusNames });
    if (!normalized) continue;
    for (let index = 0; index < normalized.quantity; index++) {
      let runtimeId = options.idSuffix
        ? `${normalized.id}_${cardIndex}_${options.idSuffix}`
        : options.createId?.(normalized.id, cardIndex) || allocateRuntimeId(normalized.id, usedIds);
      if (usedIds.has(runtimeId)) runtimeId = allocateRuntimeId(normalized.id, usedIds);
      usedIds.add(runtimeId);
      const identified = ensureCardIdentity({
        ...normalized,
        id: runtimeId,
        originalId: normalized.id,
      }, {
        templateId: normalized.id,
        origin: normalized.origin || 'deck',
        existingCombatIds: new Set([...usedIds].filter(id => id !== runtimeId)),
        existingRunIds: usedRunIds,
        runInstanceId: normalized.runInstanceId,
        combatInstanceId: runtimeId,
      });
      usedRunIds.add(identified.runInstanceId);
      cards.push(identified as Card);
      cardIndex += 1;
    }
  }

  return cards;
}

export interface MvuCardProgressionWriteBackResult {
  cards: Record<string, any>[];
  updatedRunInstanceIds: string[];
  ignoredCombatInstanceIds: string[];
}

/** Write runtime run/permanent progression back without replacing compact authored card rules. */
export function writeBackMvuCardProgression(
  mvuCards: unknown,
  runCards: readonly Card[],
  combatCards: readonly Card[],
): MvuCardProgressionWriteBackResult {
  const definitions = migratePersistentRunDeck(normalizeMvuArray(mvuCards));
  const definitionIds = new Set(definitions.map(card => card.runInstanceId));
  const runtimeIds = new Set(runCards.map(card => card.runInstanceId).filter((id): id is string => Boolean(id)));
  if (definitionIds.size !== definitions.length || runtimeIds.size !== runCards.length) {
    throw new Error('persistent MVU card identities are ambiguous');
  }
  if (definitionIds.size !== runtimeIds.size || [...definitionIds].some(id => !runtimeIds.has(id))) {
    throw new Error('persistent MVU deck no longer matches the battle run deck');
  }

  const writeBack = writeBackPersistentCardProgression(runCards, combatCards);
  const byRunId = new Map(writeBack.cards.map(card => [card.runInstanceId!, card]));
  const cards = definitions.map(definition => {
    const runtime = byRunId.get(definition.runInstanceId);
    if (!runtime) throw new Error(`persistent combat card was not found: ${definition.runInstanceId}`);
    return serializePersistentCardProgression(definition, runtime);
  });
  return {
    cards,
    updatedRunInstanceIds: writeBack.updatedRunInstanceIds,
    ignoredCombatInstanceIds: writeBack.ignoredCombatInstanceIds,
  };
}

export function convertMvuRelics(
  mvuArtifacts: unknown,
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): Relic[] {
  return normalizeMvuArray(mvuArtifacts)
    .map(value => normalizeRelicDefinition(value, options))
    .filter((value): value is Relic => value !== null);
}

export function convertMvuItems(mvuItems: unknown, options: { statusNames?: Readonly<Record<string, string>> } = {}) {
  return normalizeMvuArray(mvuItems)
    .map(value => normalizeItemDefinition(value, options))
    .filter(value => value !== null);
}

export function convertMvuAbilities(
  mvuAbilities: unknown,
  options: {
    statusNames?: Readonly<Record<string, string>>;
    enemyCollectionTarget?: 'self' | 'opponent';
  } = {},
) {
  return normalizeMvuArray(mvuAbilities)
    .map(value => normalizeAbilityDefinition(value, options))
    .filter(value => value !== null);
}

export function convertMvuActiveStatuses(
  mvuStatuses: unknown,
  options: {
    statusNames?: Readonly<Record<string, string>>;
    statusDescriptions?: Readonly<Record<string, string>>;
  } = {},
) {
  return normalizeMvuArray(mvuStatuses)
    .map(value => normalizeActiveStatus(value, options))
    .filter(value => value !== null);
}

function compileOptionalContainerEffects(
  value: unknown,
  options: { enemyCollectionTarget?: 'self' | 'opponent' } = {},
): EffectNode[] | null {
  if (value === undefined || value === null) return [];
  const compiled = compileCompactEffectList(value, options);
  return compiled.ok ? structuredClone(compiled.value.steps) : null;
}

/** Convert an optional MVU-authored stance without accepting executable strings or host code. */
export function convertMvuStance(
  value: unknown,
  enteredTurn = 1,
  options: { enemyCollectionTarget?: 'self' | 'opponent' } = {},
): ActiveStance | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source.id)) return null;
  if (typeof source.name !== 'string' || !source.name.trim()) return null;
  const enterEffects = compileOptionalContainerEffects(source.enter, options);
  const exitEffects = compileOptionalContainerEffects(source.exit, options);
  const passiveEffects = compileOptionalContainerEffects(source.passive, options);
  if (!enterEffects || !exitEffects || !passiveEffects) return null;
  return {
    id: source.id,
    name: source.name.trim(),
    ...(typeof source.emoji === 'string' ? { emoji: source.emoji } : {}),
    ...(typeof source.description === 'string' ? { description: source.description } : {}),
    ...(enterEffects.length ? { enterEffects } : {}),
    ...(exitEffects.length ? { exitEffects } : {}),
    ...(passiveEffects.length ? { passiveEffects } : {}),
    enteredTurn: Math.max(0, Math.trunc(enteredTurn)),
    source: { kind: 'system', id: 'mvu_initial_stance', name: '初始姿态' },
  };
}

function convertMvuOrb(
  value: unknown,
  existingIds: Set<string>,
  options: { enemyCollectionTarget?: 'self' | 'opponent' } = {},
): OrbInstance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source.id)) return null;
  if (typeof source.name !== 'string' || !source.name.trim()) return null;
  if (typeof source.value !== 'number' || !Number.isFinite(source.value) || source.value < 0) return null;
  const passiveEffects = compileOptionalContainerEffects(source.passive, options);
  const evokeEffects = compileOptionalContainerEffects(source.evoke, options);
  if (!passiveEffects || !evokeEffects) return null;
  const instanceId = allocateRuntimeId(source.id, existingIds);
  existingIds.add(instanceId);
  return {
    instanceId,
    id: source.id,
    name: source.name.trim(),
    ...(typeof source.emoji === 'string' ? { emoji: source.emoji } : {}),
    ...(typeof source.description === 'string' ? { description: source.description } : {}),
    value: roundBattleValue(source.value),
    ...(passiveEffects.length ? { passiveEffects } : {}),
    ...(evokeEffects.length ? { evokeEffects } : {}),
    source: { kind: 'system', id: 'mvu_initial_orb', name: '初始 Orb' },
  };
}

/** Initial MVU Orb state is concrete; formulas remain inside passive/evoke effect programs. */
export function convertMvuOrbContainer(
  slotsValue: unknown,
  orbsValue: unknown,
  options: { enemyCollectionTarget?: 'self' | 'opponent' } = {},
): OrbContainer {
  const authored = normalizeMvuArray(orbsValue);
  const slots = Number.isInteger(slotsValue)
    ? Math.max(0, Math.min(20, Number(slotsValue)))
    : Math.min(20, authored.length);
  const existingIds = new Set<string>();
  const orbs = authored
    .map(value => convertMvuOrb(value, existingIds, options))
    .filter((value): value is OrbInstance => value !== null);
  return normalizeOrbContainer({ slots, orbs });
}

function createIntent(program: EffectProgram, description: string): EnemyIntent {
  const summary = summarizeEffectProgram(program);
  const type: EnemyIntent['type'] =
    summary.type === 'attack' || summary.type === 'lust_attack'
      ? 'attack'
      : summary.type === 'defend'
        ? 'defend'
        : summary.type === 'buff'
          ? 'buff'
          : summary.type === 'debuff'
            ? 'debuff'
            : 'special';
  const emoji =
    summary.type === 'attack'
      ? '⚔️'
      : summary.type === 'lust_attack'
        ? '💋'
        : summary.type === 'defend'
          ? '🛡️'
          : summary.type === 'buff'
            ? '✨'
            : summary.type === 'debuff'
              ? '🎯'
              : '❓';
  return { type, description, emoji };
}

export function convertMvuEnemy(
  mvuEnemy: unknown,
  random: () => number = () => 0,
  options: {
    statusNames?: Readonly<Record<string, string>>;
    statusDescriptions?: Readonly<Record<string, string>>;
    fallbackId?: string;
  } = {},
): Enemy | null {
  if (!mvuEnemy || typeof mvuEnemy !== 'object' || Array.isArray(mvuEnemy)) return null;
  const source = mvuEnemy as Record<string, any>;
  if (!source.name) return null;

  const enemyCompilationOptions = { ...options, enemyCollectionTarget: 'self' as const };
  const actions = normalizeMvuArray(source.actions)
    .map(value => normalizeEnemyAction(value, enemyCompilationOptions))
    .filter(value => value !== null);
  const actionMode = source.action_mode || 'random';
  const actionConfig = source.action_config || {};
  const selection = selectEnemyAction({ ...source, actions, actionMode, actionConfig }, random);
  const preview = selection.action as import('../../game-core').EnemyAction | null;
  const lustEffect = normalizeNamedEffectDefinition(source.lust_effect, {
    ...enemyCompilationOptions,
    fallbackName: '欲望爆发',
  }) || {
    name: '欲望爆发',
    description: '敌人欲望达到上限时，对玩家造成额外伤害',
    effectProgram: {
      spec: 'mwg.effect/v1',
      steps: [{ op: 'damage', target: 'opponent', amount: 5 }],
    } as EffectProgram,
  };
  const maxHp = Math.max(1, roundBattleValue(source.max_hp ?? 100));
  const maxLust = Math.max(1, roundBattleValue(source.max_lust ?? 100));
  const maxEnergy = Math.max(0, Math.floor(Number(source.max_energy ?? 0) || 0));

  return {
    id:
      typeof source.id === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(source.id.trim())
        ? source.id.trim()
        : options.fallbackId || 'enemy_1',
    name: source.name,
    emoji: source.emoji || '👹',
    maxHp,
    currentHp: Math.min(maxHp, Math.max(0, roundBattleValue(source.hp ?? maxHp))),
    maxLust,
    currentLust: Math.min(maxLust, Math.max(0, roundBattleValue(source.lust ?? 0))),
    energy: Math.min(maxEnergy, Math.max(0, Math.floor(Number(source.energy ?? 0) || 0))),
    maxEnergy,
    resources: normalizeCombatResourceStates(source.resources),
    block: Math.max(0, roundBattleValue(Number(source.block ?? 0) || 0)),
    statusEffects: convertMvuActiveStatuses(source.status_effects, options) as any,
    intent: preview
      ? createIntent(preview.effectProgram, preview.description || preview.name)
      : { type: 'special', description: '准备行动', emoji: '❓' },
    actions: actions as any,
    nextAction: preview ? ({ ...preview } as any) : null,
    abilities: convertMvuAbilities(source.abilities, enemyCompilationOptions) as any,
    dialogue: normalizeChinesePlayerDescription(source.description),
    lustEffect,
    actionMode,
    actionConfig,
    _sequenceIndex: selection.state.sequenceIndex,
    _sequenceDoneOnce: selection.state.sequenceDoneOnce,
    speed: Number.isFinite(source.speed) ? Number(source.speed) : 0,
    actionPriority: Number.isFinite(source.action_priority) ? Number(source.action_priority) : 0,
    tags: Array.isArray(source.tags)
      ? [...new Set(source.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tag)))]
      : undefined,
    stance: convertMvuStance(source.stance, 1, enemyCompilationOptions),
    orbs: convertMvuOrbContainer(source.orb_slots, source.orbs, enemyCompilationOptions),
  } as Enemy & { actionMode: string; actionConfig: Record<string, any> };
}

export function convertMvuEnemies(
  value: unknown,
  random: () => number = () => 0,
  options: {
    statusNames?: Readonly<Record<string, string>>;
    statusDescriptions?: Readonly<Record<string, string>>;
  } = {},
): Enemy[] {
  return normalizeMvuArray(value)
    .map((entry, index) => convertMvuEnemy(entry, random, { ...options, fallbackId: `enemy_${index + 1}` }))
    .filter((entry): entry is Enemy => entry !== null);
}
