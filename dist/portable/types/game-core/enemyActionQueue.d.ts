import type { BattleRandomState } from './deterministicRandom';
import { type EnemyActionLike } from './enemyActionSelector';
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
/** Select one action for every living enemy and freeze a deterministic execution queue. */
export declare function prepareEnemyActionQueue<T extends EnemyActionQueueSource>(enemies: readonly T[], random: BattleRandomState): EnemyActionQueuePlan<T>;
export interface RunEnemyActionQueuePorts {
    isAlive(enemyId: string): boolean;
    isTerminal(): boolean;
    execute(entry: EnemyActionQueueEntry): void | Promise<void>;
    afterEach?(entry: EnemyActionQueueEntry): void | Promise<void>;
}
export declare function runEnemyActionQueue(entries: readonly EnemyActionQueueEntry[], ports: RunEnemyActionQueuePorts): Promise<{
    completed: boolean;
    executed: EnemyActionQueueEntry[];
    skipped: EnemyActionQueueEntry[];
}>;
