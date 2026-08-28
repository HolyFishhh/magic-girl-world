import {
  createBattleRequest,
  validateRunState,
  type BattleRequest,
  type RunNodeChoice,
} from '../../game-core';
import { createContentPackFromMvuBattle } from '../../runtime/contentPackAdapter';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Convert canonical MUV data once at the host boundary. */
export function createBattleRequestFromMvu(variables: unknown, battleData: unknown): BattleRequest {
  if (!isRecord(battleData)) throw new Error('battle data must be an object');
  const core = isRecord(battleData.core) ? battleData.core : {};
  const content = createContentPackFromMvuBattle(battleData);

  const stat = isRecord(variables) && isRecord(variables.stat_data) ? variables.stat_data : null;
  const runResult = validateRunState(stat?.run);
  const run = runResult.ok ? runResult.value : null;
  const currentNode: RunNodeChoice | null = run?.phase === 'in_node' ? run.currentNode : null;
  const route = currentNode
    ? {
        act: currentNode.act,
        floor: currentNode.floor,
        kind: currentNode.kind,
        danger: currentNode.danger,
        nodeId: currentNode.id,
        actCount: run?.actCount,
        floorsPerAct: run?.floorsPerAct,
        nodeCounts: run?.nodeCounts,
      }
    : null;

  return createBattleRequest({
    content,
    player: {
      emoji: core.emoji,
      hp: core.hp,
      maxHp: core.max_hp,
      lust: core.lust,
      maxLust: core.max_lust,
      level: battleData.level,
    },
    route,
    runSeed: run?.seed ?? 0,
  });
}

/** Recreate the narrow shape consumed by the Tavern battle adapter. */
export function battleRequestToRuntimeData(request: BattleRequest): Record<string, any> {
  const pack = request.content;
  return {
    core: {
      emoji: request.player.emoji,
      hp: request.player.hp,
      max_hp: request.player.maxHp,
      lust: request.player.lust,
      max_lust: request.player.maxLust,
    },
    level: request.player.level,
    cards: pack.cards,
    statuses: pack.statuses,
    artifacts: pack.relics,
    items: pack.items,
    player_abilities: pack.abilities,
    player_status_effects: pack.activeStatuses,
    player_lust_effect: pack.desireEffects.player,
    enemy: pack.enemy,
  };
}
