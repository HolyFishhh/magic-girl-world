import { createContentPack, normalizeCompactNamedEffectInput, type ContentPack } from '../game-core';
import { flattenMvuArray, normalizeMvuStatusDefinitions } from './mvuArrays';
import { normalizeMvuBattleContent } from './mvuBattleContentNormalizer';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMvuList(value: unknown): unknown[] {
  return flattenMvuArray(value);
}

function normalizeMvuEnemy(value: unknown): unknown {
  const source = value;
  if (!isRecord(source)) return source;
  const lustEffect = normalizeCompactNamedEffectInput(source.lust_effect, '欲望爆发');
  return {
    ...source,
    actions: normalizeMvuList(source.actions),
    abilities: normalizeMvuList(source.abilities),
    status_effects: normalizeMvuList(source.status_effects),
    ...(Object.hasOwn(source, 'lust_effect') ? { lust_effect: lustEffect || source.lust_effect } : {}),
  };
}

/** Map the canonical MUV battle root into the portable content boundary once. */
export function createContentPackFromMvuBattle(battleData: unknown): ContentPack {
  if (!isRecord(battleData)) throw new Error('battle data must be an object');
  const normalizedBattle = normalizeMvuBattleContent(battleData);
  const core = isRecord(normalizedBattle.core) ? normalizedBattle.core : {};
  return createContentPack({
    cards: normalizeMvuList(normalizedBattle.cards),
    statuses: normalizeMvuStatusDefinitions(normalizedBattle.statuses),
    relics: normalizeMvuList(normalizedBattle.artifacts),
    items: normalizeMvuList(normalizedBattle.items),
    abilities: normalizeMvuList(normalizedBattle.player_abilities),
    activeStatuses: normalizeMvuList(normalizedBattle.player_status_effects),
    playerResources: normalizeMvuList(core.resources),
    playerSummonGrowth: core.summon_growth,
    playerCardPatches: core.card_patches,
    playerStance: core.stance,
    playerOrbSlots: core.orb_slots,
    playerOrbs: normalizeMvuList(core.orbs),
    enemy: normalizeMvuEnemy(normalizedBattle.enemy),
    enemies: normalizeMvuList(normalizedBattle.enemies).map(normalizeMvuEnemy),
    playerDesireEffect: normalizeCompactNamedEffectInput(normalizedBattle.player_lust_effect, '欲望满溢'),
  });
}
