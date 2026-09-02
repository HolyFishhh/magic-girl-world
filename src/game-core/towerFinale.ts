import type { RunNodeCounts, RunState } from './runState';

export const TOWER_FINALE_SCHEMA_VERSION = 1 as const;
export const TOWER_SHARE_SCHEMA = 'mwg.tower-run-share/v1' as const;

export interface TowerFinale {
  schemaVersion: typeof TOWER_FINALE_SCHEMA_VERSION;
  fishEmoji: '🐟';
  fishLine: string;
  playerLine: string;
  damage: number;
  defeatedEnemyScore: number;
  averageDifficultyPercent: number;
}

export interface TowerRunShareSnapshot {
  spec: typeof TOWER_SHARE_SCHEMA;
  runSchemaVersion: number;
  seed: number;
  acts: number;
  floorsPerAct: number;
  visitedNodeIds: string[];
  nodeCounts: RunNodeCounts;
  score: {
    defeatedEnemyScore: number;
    averageDifficultyPercent: number;
    encounters: Array<{
      nodeId: string;
      act: number;
      floor: number;
      playerDeckScore: number;
      enemyScore: number;
      relativeDifficulty: number;
    }>;
  };
}

const FISH_LINES = [
  '啊？你怎么已经走到这里了？照设定该打我一下，但代码还没写完，你打完就先回去吧。',
  '嚯嚯嚯，我就是最后的大魔王。这样够有气势了吧？快打，我还得继续改代码。',
  '三幕都打完了？很好。现在请对着这条无辜的鱼结算你的总分，动作快一点。',
  '我本来只想安静地写代码，怎么又有人从塔顶闯进来了……来吧，流程还是要走的。',
  '欢迎来到尚未施工完成的终点。奖励是一次合法攻击作者的机会，请珍惜。',
] as const;

const PLAYER_LINES = [
  '一路上的账，最后就记在你头上。',
  '既然是流程，那我就不客气了。',
  '你最好祈祷这个总分不算太高。',
  '下次把终点做完之前，记得先把门锁好。',
  '我爬了三幕，可不是为了听你催我回去。',
] as const;

function stableIndex(seed: number, salt: number, length: number): number {
  let value = (seed ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) % length;
}

function requireCompletedRun(run: RunState): void {
  if (run.routeMode !== 'map' || run.phase !== 'won' || run.act !== run.actCount) {
    throw new Error('tower finale requires a completed map run');
  }
}

/** Deterministic final scene; reopening a completed save never changes its lines. */
export function createTowerFinale(run: RunState): TowerFinale {
  requireCompletedRun(run);
  const defeatedEnemyScore = run.score.defeatedEnemyScore;
  return {
    schemaVersion: TOWER_FINALE_SCHEMA_VERSION,
    fishEmoji: '🐟',
    fishLine: FISH_LINES[stableIndex(run.seed, 0x0f157a11, FISH_LINES.length)],
    playerLine: PLAYER_LINES[stableIndex(run.seed, 0x504c4159, PLAYER_LINES.length)],
    damage: defeatedEnemyScore,
    defeatedEnemyScore,
    averageDifficultyPercent: run.score.averageDifficultyPercent,
  };
}

/**
 * Stable, JSON-only handoff for a future export/share feature. Generated prose,
 * private chat context and player profile are intentionally excluded.
 */
export function createTowerRunShareSnapshot(run: RunState): TowerRunShareSnapshot {
  requireCompletedRun(run);
  return {
    spec: TOWER_SHARE_SCHEMA,
    runSchemaVersion: run.schemaVersion,
    seed: run.seed,
    acts: run.actCount,
    floorsPerAct: run.floorsPerAct,
    visitedNodeIds: [...run.visitedNodeIds],
    nodeCounts: { ...run.nodeCounts },
    score: {
      defeatedEnemyScore: run.score.defeatedEnemyScore,
      averageDifficultyPercent: run.score.averageDifficultyPercent,
      encounters: run.score.encounters.map(encounter => ({
        nodeId: encounter.nodeId,
        act: encounter.act,
        floor: encounter.floor,
        playerDeckScore: encounter.playerDeckScore,
        enemyScore: encounter.enemyScore,
        relativeDifficulty: encounter.relativeDifficulty,
      })),
    },
  };
}
