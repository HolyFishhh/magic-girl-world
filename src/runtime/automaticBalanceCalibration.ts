import {
  calibrateEncounterNumbers,
  profileDeckPower,
  validateContentPackContract,
  type ContentDesignAssessment,
  type EncounterCalibrationResult,
} from '../game-core';
import { createContentPackFromMvuBattle } from './contentPackAdapter';

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Legacy public helper retained for old bundles. It now produces advice only:
 * no generated MVU command and no instruction to rewrite an existing enemy.
 */
export function formatAutomaticBalanceCalibrationPrompt(assessment: ContentDesignAssessment): string {
  const calibration = assessment.calibration;
  if (!calibration || !assessment.enemyPower) throw new Error('当前没有可分析的敌人评分');
  const target = assessment.difficulty;
  return [
    '[敌人强度分析建议]',
    `玩家卡组评分 ${assessment.deckPower.totalScore}；目标强度 ${calibration.targetPercent}%（目标敌人约 ${target.targetEnemyScore} 分）；当前敌人约 ${calibration.actualPercent}%。`,
    `后续同类敌人可参考：总生命 ${target.enemyHp.min}~${target.enemyHp.max}，常规行动伤害 ${target.expectedActionDamage.min}~${target.expectedActionDamage.max}，峰值 ${target.peakActionDamage.min}~${target.peakActionDamage.max}，预期战斗 ${target.targetTurns.min}~${target.targetTurns.max} 回合。`,
    ...calibration.guidance,
    '这只是下一次生成的参考，不修改当前敌人，不要求重写，也不因为强弱或创意评价拒绝已有内容。',
  ].join('\n');
}

/**
 * Legacy compatibility boundary. Older callers may still pass a model rewrite,
 * but post-generation balance must never apply it to authoritative variables.
 */
export function reconcileAutomaticBalanceCalibration(
  originalVariables: Record<string, any>,
  _repairedVariables: Record<string, any>,
): Record<string, any> {
  return clone(originalVariables);
}

/** Validate executable structure only; strength and closeness are advisory. */
export function validateAutomaticBalanceCalibration(
  variables: Record<string, any>,
  _assessment: ContentDesignAssessment,
): void {
  const battle = variables?.stat_data?.battle;
  if (!battle || typeof battle !== 'object' || Array.isArray(battle)) throw new Error('强度分析缺少 battle 变量');
  const pack = createContentPackFromMvuBattle(battle);
  const contract = validateContentPackContract(pack, { requireEnemy: true, requireExecutable: true });
  if (!contract.ok) throw new Error(`敌人包含不可执行结构：${contract.issues[0]?.path || 'unknown'}`);
}

/**
 * Pure counterfactual analysis. The returned calibratedPack is evidence for a
 * suggested range only and must never be persisted as the current encounter.
 */
export function calibrateMvuEncounterNumbers(
  variables: Record<string, any>,
  assessment: ContentDesignAssessment,
): EncounterCalibrationResult | null {
  const battle = variables?.stat_data?.battle;
  if (!battle || typeof battle !== 'object' || Array.isArray(battle)) return null;
  const pack = createContentPackFromMvuBattle(battle);
  if (!pack.enemy && !(pack.enemies || []).length) return null;
  const core = battle.core || {};
  const maxHp = Math.max(1, Number(core.max_hp) || assessment.deckPower.maxHp || 1);
  const maxLust = Math.max(1, Number(core.max_lust) || 100);
  const profile = assessment.deckPowerProfile || assessment.context.balance.deckProfile || profileDeckPower({
    pack,
    maxHp,
    maxLust,
    seeds: 8,
  });
  return calibrateEncounterNumbers({
    pack,
    profile,
    requestedRatio: assessment.context.settings.difficultyPercent,
    currentHp: Math.max(0, Number(core.hp) || 0),
    currentLust: Math.max(0, Number(core.lust) || 0),
    maxLust,
    seeds: 8,
  });
}

/**
 * Deprecated mutation entry point. Kept as a harmless no-op so old character
 * bundles cannot silently rewrite enemy values after this policy change.
 */
export async function maybeRequestAutomaticBalanceCalibration(
  _variables: Record<string, any>,
  _assessment: ContentDesignAssessment,
): Promise<boolean> {
  return false;
}
