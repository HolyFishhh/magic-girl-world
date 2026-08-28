import type { BattleRandomState } from './deterministicRandom';
import { drawBattleRandom } from './deterministicRandom';
import { selectEnemyAction, type EnemyActionLike } from './enemyActionSelector';

export interface EnemyActionQueueSource {
  id: string;
  currentHp: number;
  speed?: number;
  actionPriority?: number;
  actions?: EnemyActionLike[];
  nextAction?: EnemyActionLike | null;
  _sequenceIndex?: number;
  _sequenceDoneOnce?: boolean;
  actionMode?: string;
  actionConfig?: Record<string, unknown>;
}

export interface EnemyActionQueueEntry {
  id: string;
  enemyId: string;
  action: EnemyActionLike;
  speed: number;
  priority: number;
  stableOrder: number;
}

export interface EnemyActionQueuePlan<T extends EnemyActionQueueSource> {
  entries: EnemyActionQueueEntry[];
  enemies: T[];
  random: BattleRandomState;
}

function randomFunction(state: BattleRandomState): { random: () => number; read: () => BattleRandomState } {
  let cursor = state;
  return {
    random: () => {
      const draw = drawBattleRandom(cursor);
      cursor = draw.state;
      return draw.value;
    },
    read: () => cursor,
  };
}

/** Select one action for every living enemy and freeze a deterministic execution queue. */
export function prepareEnemyActionQueue<T extends EnemyActionQueueSource>(
  enemies: readonly T[],
  random: BattleRandomState,
): EnemyActionQueuePlan<T> {
  const rng = randomFunction(random);
  const updated: T[] = enemies.map(enemy => structuredClone(enemy));
  const entries: EnemyActionQueueEntry[] = [];
  for (let stableOrder = 0; stableOrder < updated.length; stableOrder += 1) {
    const enemy = updated[stableOrder];
    if (enemy.currentHp <= 0) continue;
    const selection = enemy.nextAction
      ? { action: structuredClone(enemy.nextAction), state: { sequenceIndex: enemy._sequenceIndex || 0, sequenceDoneOnce: enemy._sequenceDoneOnce === true } }
      : selectEnemyAction(enemy, rng.random);
    if (!selection.action) continue;
    enemy.nextAction = structuredClone(selection.action);
    enemy._sequenceIndex = selection.state.sequenceIndex;
    enemy._sequenceDoneOnce = selection.state.sequenceDoneOnce;
    entries.push({
      id: `enemy-action:${enemy.id}`,
      enemyId: enemy.id,
      action: structuredClone(selection.action),
      speed: Number.isFinite(enemy.speed) ? Number(enemy.speed) : 0,
      priority: Number.isFinite(enemy.actionPriority) ? Number(enemy.actionPriority) : 0,
      stableOrder,
    });
  }
  entries.sort((left, right) =>
    right.priority - left.priority || right.speed - left.speed || left.stableOrder - right.stableOrder || left.enemyId.localeCompare(right.enemyId),
  );
  return { entries, enemies: updated, random: rng.read() };
}

export interface RunEnemyActionQueuePorts {
  isAlive(enemyId: string): boolean;
  isTerminal(): boolean;
  execute(entry: EnemyActionQueueEntry): void | Promise<void>;
  afterEach?(entry: EnemyActionQueueEntry): void | Promise<void>;
}

export async function runEnemyActionQueue(
  entries: readonly EnemyActionQueueEntry[],
  ports: RunEnemyActionQueuePorts,
): Promise<{ completed: boolean; executed: EnemyActionQueueEntry[]; skipped: EnemyActionQueueEntry[] }> {
  const executed: EnemyActionQueueEntry[] = [];
  const skipped: EnemyActionQueueEntry[] = [];
  for (const entry of entries) {
    if (ports.isTerminal()) return { completed: false, executed, skipped };
    if (!ports.isAlive(entry.enemyId)) {
      skipped.push(structuredClone(entry));
      continue;
    }
    await ports.execute(structuredClone(entry));
    executed.push(structuredClone(entry));
    await ports.afterEach?.(structuredClone(entry));
  }
  return { completed: !ports.isTerminal(), executed, skipped };
}
