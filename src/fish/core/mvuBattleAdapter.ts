import { allocateRuntimeId, selectEnemyAction } from '../../game-core';
import type { Card, EffectProgram, Enemy, EnemyIntent, Relic } from '../../game-core';
import { normalizeRuntimeStatusDefinition } from '../../game-core';
import { flattenMvuArray } from '../../runtime/mvuArrays';
import {
  normalizeAbilityDefinition,
  normalizeActiveStatus,
  normalizeCardDefinition,
  normalizeEnemyAction,
  normalizeItemDefinition,
  normalizeNamedEffectDefinition,
  normalizeRelicDefinition,
} from './battleContentAdapter';
import { summarizeEffectProgram } from '../ui/effectProgramDisplay';

export function normalizeMvuArray<T extends Record<string, any> = Record<string, any>>(value: unknown): T[] {
  return flattenMvuArray<T>(value, { objectsOnly: true });
}

export interface MvuStatusDisplayContext {
  statusNames: Readonly<Record<string, string>>;
  statusDescriptions: Readonly<Record<string, string>>;
}

/** Resolve status labels before descriptions so cross-status references always use visible names. */
export function buildMvuStatusDisplayContext(mvuStatuses: unknown): MvuStatusDisplayContext {
  const statuses = normalizeMvuArray(mvuStatuses);
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
  const cards = new Map<string, Record<string, any>>();
  for (const source of sources) {
    for (const card of normalizeMvuArray(source)) {
      const key = card.id || card.name;
      if (key && !cards.has(key)) cards.set(key, card);
    }
  }
  return Array.from(cards.values());
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
  let cardIndex = 0;

  for (const card of normalizeMvuArray(mvuCards)) {
    const normalized = normalizeCardDefinition(card, { statusNames: options.statusNames });
    if (!normalized) continue;
    for (let index = 0; index < normalized.quantity; index++) {
      let runtimeId = options.idSuffix
        ? `${normalized.id}_${cardIndex}_${options.idSuffix}`
        : options.createId?.(normalized.id, cardIndex) || allocateRuntimeId(normalized.id, usedIds);
      if (usedIds.has(runtimeId)) runtimeId = allocateRuntimeId(normalized.id, usedIds);
      usedIds.add(runtimeId);
      cards.push({
        ...normalized,
        id: runtimeId,
        originalId: normalized.id,
      } as Card & { originalId: string });
      cardIndex += 1;
    }
  }

  return cards;
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
  options: { statusNames?: Readonly<Record<string, string>> } = {},
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
  } = {},
): Enemy | null {
  if (!mvuEnemy || typeof mvuEnemy !== 'object' || Array.isArray(mvuEnemy)) return null;
  const source = mvuEnemy as Record<string, any>;
  if (!source.name) return null;

  const actions = normalizeMvuArray(source.actions)
    .map(value => normalizeEnemyAction(value, options))
    .filter(value => value !== null);
  const actionMode = source.action_mode || 'random';
  const actionConfig = source.action_config || {};
  const selection = selectEnemyAction({ ...source, actions, actionMode, actionConfig }, random);
  const preview = selection.action as import('../../game-core').EnemyAction | null;
  const lustEffect = normalizeNamedEffectDefinition(source.lust_effect, options) || {
    name: '欲望爆发',
    description: '敌人欲望达到上限时，对玩家造成额外伤害',
    effectProgram: {
      spec: 'mwg.effect/v1',
      steps: [{ op: 'damage', target: 'opponent', amount: 5 }],
    } as EffectProgram,
  };

  return {
    id: source.name,
    name: source.name,
    emoji: source.emoji || '👹',
    maxHp: source.max_hp ?? 100,
    currentHp: source.hp ?? source.max_hp ?? 100,
    maxLust: source.max_lust ?? 100,
    currentLust: source.lust ?? 0,
    energy: 0,
    maxEnergy: 0,
    block: 0,
    statusEffects: convertMvuActiveStatuses(source.status_effects, options) as any,
    intent: preview
      ? createIntent(preview.effectProgram, preview.description || preview.name)
      : { type: 'special', description: '准备行动', emoji: '❓' },
    actions: actions as any,
    nextAction: preview ? ({ ...preview } as any) : null,
    abilities: convertMvuAbilities(source.abilities, options) as any,
    dialogue: source.description || '',
    lustEffect,
    actionMode,
    actionConfig,
    _sequenceIndex: selection.state.sequenceIndex,
    _sequenceDoneOnce: selection.state.sequenceDoneOnce,
  } as Enemy & { actionMode: string; actionConfig: Record<string, any> };
}
