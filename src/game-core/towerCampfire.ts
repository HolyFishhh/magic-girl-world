import { stableHash32 } from './deterministicRandom';
import type { TowerNodeContentEnvelope } from './towerContentState';

export const CAMPFIRE_RULES = { healRatio: 0.3, maxHpGain: 5, goldMinimum: 15, goldMaximum: 35 } as const;
export type CampfireAction = 'rest' | 'train' | 'scavenge' | 'recall';

/** Fixed rooms have no model request, including their scene text. */
export function fixedCampfireEnvelope(previous: TowerNodeContentEnvelope): TowerNodeContentEnvelope {
  if (previous.kind !== 'rest' || previous.phase === 'consumed' || previous.phase === 'abandoned') return previous;
  if ((previous.content as Record<string, unknown> | undefined)?.program_rest_version === 1 && previous.phase === 'ready') return previous;
  return {
    schemaVersion: 1, nodeId: previous.nodeId, kind: 'rest', phase: 'ready',
    requestId: `campfire:${previous.nodeId}`, basedOnRevision: previous.basedOnRevision, attempts: previous.attempts,
    content: {
      program_rest_version: 1, title: '营火',
      narrative: '篝火照亮了这处安静的歇脚地。你可以休息、锻炼、搜刮，或回忆曾经错过的招式。离开前只能完成一件事。',
      payload: { rest: { ...CAMPFIRE_RULES } },
    },
  };
}

/** Stable per room: reopening or reloading cannot reroll a payout. */
export function campfireGold(seed: number, nodeId: string): number {
  return CAMPFIRE_RULES.goldMinimum + stableHash32({ namespace: 'campfire-gold-v1', seed, nodeId })
    % (CAMPFIRE_RULES.goldMaximum - CAMPFIRE_RULES.goldMinimum + 1);
}
