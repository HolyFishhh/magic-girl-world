import { createContentPack, normalizeCompactNamedEffectInput, type ContentPack } from '../game-core';
import { flattenMvuArray, normalizeMvuStatusDefinitions } from './mvuArrays';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMvuList(value: unknown): unknown[] {
  return flattenMvuArray(value);
}

function normalizeMvuEnemy(value: unknown): unknown {
  const source = value;
  if (!isRecord(source)) return source;
  return {
    ...source,
    actions: normalizeMvuList(source.actions),
    abilities: normalizeMvuList(source.abilities),
    status_effects: normalizeMvuList(source.status_effects),
    lust_effect: normalizeCompactNamedEffectInput(source.lust_effect, '欲望爆发'),
  };
}

/** Map the canonical MUV battle root into the portable content boundary once. */
export function createContentPackFromMvuBattle(battleData: unknown): ContentPack {
  if (!isRecord(battleData)) throw new Error('battle data must be an object');
  const core = isRecord(battleData.core) ? battleData.core : {};
  return createContentPack({
    cards: normalizeMvuList(battleData.cards),
    statuses: normalizeMvuStatusDefinitions(battleData.statuses),
    relics: normalizeMvuList(battleData.artifacts),
    items: normalizeMvuList(battleData.items),
    abilities: normalizeMvuList(battleData.player_abilities),
    activeStatuses: normalizeMvuList(battleData.player_status_effects),
    playerResources: normalizeMvuList(core.resources),
    enemy: normalizeMvuEnemy(battleData.enemy),
    enemies: normalizeMvuList(battleData.enemies).map(normalizeMvuEnemy),
    playerDesireEffect: normalizeCompactNamedEffectInput(battleData.player_lust_effect, '欲望满溢'),
  });
}
