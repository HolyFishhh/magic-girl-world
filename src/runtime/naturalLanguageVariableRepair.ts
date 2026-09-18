import { createContentPackFromMvuBattle } from './contentPackAdapter';
import { validateContentPackContract } from '../game-core/contentContract';
import { normalizeGameMode, readGameModeLock, validateRunState } from '../game-core';

function cloneValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateChangedRunAndMode(originalData: Record<string, any> | undefined, data: Record<string, any>): void {
  if (!valuesEqual(originalData?.run, data.run)) {
    const previous = validateRunState(originalData?.run);
    const candidate = validateRunState(data.run);
    if (!candidate.ok && previous.ok) throw new Error(`修改引入无效爬塔状态：${candidate.message}`);
  }
  if (!valuesEqual(originalData?.game_mode, data.game_mode)
    && data.game_mode !== undefined && normalizeGameMode(data.game_mode) === null) {
    throw new Error('修改引入无效游戏模式');
  }
  if (!valuesEqual(originalData?.game_mode_lock, data.game_mode_lock)
    && data.game_mode_lock !== undefined && readGameModeLock(data) === null) {
    throw new Error('修改引入无效游戏模式锁');
  }
  const lock = readGameModeLock(data);
  if (lock && data.game_mode !== undefined && normalizeGameMode(data.game_mode) !== lock.mode) {
    throw new Error('游戏模式与模式锁不一致');
  }
}

/** Player-directed edits are limited to semantic state under stat_data. */
export function reconcileNaturalLanguageVariableRepair(
  original: Record<string, any>,
  repaired: Record<string, any>,
): Record<string, any> {
  const data = repaired?.stat_data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('模型没有返回有效的 stat_data 变量对象');
  }
  if (valuesEqual(original?.stat_data, data)) throw new Error('模型没有按要求修改变量');

  validateChangedRunAndMode(original?.stat_data, data);

  // Do not make an unrelated pre-existing battle defect block a requested
  // story/resource edit. New executable defects still reject the candidate.
  const issues = (battle: unknown) => {
    const result = validateContentPackContract(createContentPackFromMvuBattle(battle), { requireExecutable: true });
    return result.ok ? [] : result.issues;
  };
  if (!valuesEqual(original?.stat_data?.battle, data.battle)) {
    const oldBattle = original?.stat_data?.battle;
    const oldIssues = new Set(
      (oldBattle && typeof oldBattle === 'object' ? issues(oldBattle) : []).map(issue => JSON.stringify(issue)),
    );
    const introduced = issues(data.battle).filter(issue => !oldIssues.has(JSON.stringify(issue)));
    if (introduced.length) {
      throw new Error(`修改引入不可执行结构：${introduced.slice(0, 5).map(issue => `${issue.path}: ${issue.message}`).join('；')}`);
    }
  }
  return { ...cloneValue(original), stat_data: cloneValue(data) };
}
