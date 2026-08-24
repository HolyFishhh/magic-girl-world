import { selectEnemyAction } from '../../game-core';
import type { Enemy, EnemyAction } from '../../game-core';

export interface EnemyActionStatePort {
  getEnemy(): Enemy | null;
  nextRandom(): number;
  updateEnemy(updates: Partial<Enemy>): void;
}

/** Select and persist the next enemy action without touching presentation APIs. */
export function prepareNextEnemyAction(state: EnemyActionStatePort): EnemyAction | null {
  const enemy = state.getEnemy();
  if (!enemy || !Array.isArray(enemy.actions) || enemy.actions.length === 0) return null;

  const selection = selectEnemyAction(enemy, () => state.nextRandom());
  const action = selection.action as EnemyAction | null;
  if (!action) return null;

  state.updateEnemy({
    nextAction: { ...action },
    _sequenceIndex: selection.state.sequenceIndex,
    _sequenceDoneOnce: selection.state.sequenceDoneOnce,
  });
  return action;
}
