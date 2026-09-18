import type { Enemy } from './battleState';
/** Escape is a warning first; readyTurn prevents a departure before the next enemy turn. */
export declare function markPendingEnemyEscapes(enemies: readonly Enemy[], readyTurn: number, matches: (enemy: Enemy) => boolean): Enemy[];
export declare function pendingEnemyEscapeIds(enemies: readonly Enemy[], currentTurn: number): string[];
