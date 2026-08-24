import { createContentPack, type ContentPack } from '../game-core';
import { flattenMvuArray } from './mvuArrays';

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
    lust_effect: source.lust_effect,
  };
}

/** Map the canonical MUV battle root into the portable content boundary once. */
export function createContentPackFromMvuBattle(battleData: unknown): ContentPack {
  if (!isRecord(battleData)) throw new Error('battle data must be an object');
  return createContentPack({
    cards: normalizeMvuList(battleData.cards),
    statuses: normalizeMvuList(battleData.statuses),
    relics: normalizeMvuList(battleData.artifacts),
    items: normalizeMvuList(battleData.items),
    abilities: normalizeMvuList(battleData.player_abilities),
    activeStatuses: normalizeMvuList(battleData.player_status_effects),
    enemy: normalizeMvuEnemy(battleData.enemy),
    playerDesireEffect: battleData.player_lust_effect,
  });
}
