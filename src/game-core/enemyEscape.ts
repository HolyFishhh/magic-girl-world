import type { Enemy } from './battleState';

/** Escape is a warning first; readyTurn prevents a departure before the next enemy turn. */
export function markPendingEnemyEscapes(
  enemies: readonly Enemy[],
  readyTurn: number,
  matches: (enemy: Enemy) => boolean,
): Enemy[] {
  return enemies.map(enemy => {
    if (enemy.currentHp <= 0 || enemy.escapePending || !enemy.escapeCondition) return structuredClone(enemy);
    return matches(enemy)
      ? { ...structuredClone(enemy), escapePending: true, escapeReadyTurn: Math.max(0, Math.trunc(readyTurn)), nextAction: null }
      : structuredClone(enemy);
  });
}

export function pendingEnemyEscapeIds(enemies: readonly Enemy[], currentTurn: number): string[] {
  return enemies
    .filter(enemy => enemy.currentHp > 0 && enemy.escapePending && (enemy.escapeReadyTurn ?? 0) <= currentTurn)
    .map(enemy => enemy.id);
}
