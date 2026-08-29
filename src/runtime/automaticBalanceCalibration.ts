import {
  calibrateEncounterNumbers,
  calibrateEnemyPower,
  createContentMechanicsFingerprint,
  profileDeckPower,
  scoreDeckPower,
  scoreEnemyPower,
  summarizeBuildBudget,
  validateContentPackContract,
  type ContentDesignAssessment,
  type EncounterCalibrationResult,
} from '../game-core';
import { createContentPackFromMvuBattle } from './contentPackAdapter';
import { updateCurrentMessageVariablesWith } from './messageVariables';
import { isExternalDesignAssistantActive } from './contentDesignSettings';

const attemptedInMemory = new Set<string>();

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function attemptKey(assessment: ContentDesignAssessment): string {
  return [
    assessment.deckPowerProfile?.fingerprint || assessment.deckPower.fingerprint,
    assessment.enemyPower?.fingerprint || 'none',
    assessment.difficulty.difficultyPercent,
  ].join(':');
}

function wasAttempted(key: string): boolean {
  if (attemptedInMemory.has(key)) return true;
  try {
    return globalThis.sessionStorage?.getItem(`mwg:auto-balance:${key}`) === '1';
  } catch {
    return false;
  }
}

function markAttempted(key: string): void {
  attemptedInMemory.add(key);
  try {
    globalThis.sessionStorage?.setItem(`mwg:auto-balance:${key}`, '1');
  } catch {
    // Memory guard still prevents an in-page retry loop.
  }
}

export function formatAutomaticBalanceCalibrationPrompt(assessment: ContentDesignAssessment): string {
  const calibration = assessment.calibration;
  if (!calibration || !assessment.enemyPower) throw new Error('当前没有可校准的敌人评分');
  const target = assessment.difficulty;
  return [
    '[程序敌人平衡校准]',
    `玩家基础分=${assessment.deckPower.totalScore}；目标强度=${calibration.targetPercent}%（${target.targetEnemyScore}分）；当前敌人=${calibration.actualPercent}%。`,
    `目标总生命=${target.enemyHp.min}~${target.enemyHp.max}；常规行动生命伤害=${target.expectedActionDamage.min}~${target.expectedActionDamage.max}；峰值=${target.peakActionDamage.min}~${target.peakActionDamage.max}；预期战长=${target.targetTurns.min}~${target.targetTurns.max}回合。`,
    ...calibration.guidance,
    '只对当前 battle.enemy 或 battle.enemies 做最小增量校准；如修改后的敌人引用了尚未注册的状态，才允许增量补充 battle.statuses。',
    '保留剧情已发生的当前生命、欲望和活动状态，保留敌人身份、招牌行动、叙事描述与谱系连续性。',
    '生命、欲望、控制、成长、格挡与复杂机制共享预算；不要同时取全部区间上限。',
    '不得修改玩家卡组、核心属性、成长、奖励、剧情状态或 battle.design_context。只输出一个 <UpdateVariable>。',
  ].join('\n');
}

export function reconcileAutomaticBalanceCalibration(
  originalVariables: Record<string, any>,
  repairedVariables: Record<string, any>,
): Record<string, any> {
  const originalBattle = originalVariables?.stat_data?.battle;
  const repairedBattle = repairedVariables?.stat_data?.battle;
  if (!originalBattle || !repairedBattle) throw new Error('自动校准缺少 battle 变量');
  if (equal(originalBattle.enemy, repairedBattle.enemy) && equal(originalBattle.enemies, repairedBattle.enemies)) {
    throw new Error('额外模型没有修改当前敌人');
  }
  const result = clone(originalVariables);
  result.stat_data.battle.enemy = clone(repairedBattle.enemy);
  result.stat_data.battle.enemies = clone(repairedBattle.enemies);
  result.stat_data.battle.statuses = clone(repairedBattle.statuses ?? originalBattle.statuses);
  return result;
}

export function validateAutomaticBalanceCalibration(
  repairedVariables: Record<string, any>,
  assessment: ContentDesignAssessment,
): void {
  const battle = repairedVariables?.stat_data?.battle;
  const core = battle?.core || {};
  const pack = createContentPackFromMvuBattle(battle);
  const contract = validateContentPackContract(pack, { requireEnemy: true, requireExecutable: true });
  if (!contract.ok) throw new Error(`自动校准产生了不可执行内容：${contract.issues[0]?.path || 'unknown'}`);
  const maxHp = Math.max(1, Number(core.max_hp) || assessment.deckPower.maxHp);
  const fullHealthBudget = summarizeBuildBudget(pack, { hp: maxHp, maxHp });
  const deck = scoreDeckPower({ pack, maxHp, fullHealthBudget });
  const enemy = scoreEnemyPower(pack);
  if (!enemy) throw new Error('自动校准后没有可用敌人');
  const calibration = calibrateEnemyPower(deck, enemy, assessment.difficulty.difficultyPercent);
  const originalDeviation = Math.abs(assessment.calibration?.deviationPercent ?? Number.POSITIVE_INFINITY);
  if (Math.abs(calibration.deviationPercent) >= originalDeviation) {
    throw new Error('自动校准没有让敌人更接近目标强度，已撤销本次修复');
  }
}

function enemyFingerprint(battle: Record<string, any>): string {
  return createContentMechanicsFingerprint({ enemy: battle.enemy, enemies: battle.enemies || [] });
}

function applyCalibratedEnemies(
  variables: Record<string, any>,
  calibration: EncounterCalibrationResult,
): void {
  const battle = variables?.stat_data?.battle;
  if (!battle || typeof battle !== 'object' || Array.isArray(battle)) throw new Error('程序校准缺少 battle 变量');
  const enemies = calibration.calibratedPack.enemies || [];
  if (Array.isArray(battle.enemies) && battle.enemies.length > 0) {
    battle.enemies = clone(enemies);
    battle.enemy = null;
  } else {
    battle.enemy = clone(enemies[0] || calibration.calibratedPack.enemy);
    battle.enemies = [];
  }
  const balance = battle.design_context?.balance;
  if (balance && typeof balance === 'object' && !Array.isArray(balance)) {
    balance.programCalibration = {
      spec: calibration.spec,
      requestedRatio: calibration.requestedRatio,
      effectiveRatio: calibration.effectiveRatio,
      appliedScale: calibration.appliedScale,
      winnableAtCurrentResources: calibration.winnableAtCurrentResources,
      confidence: calibration.confidence,
      changedPaths: calibration.changedPaths,
      warnings: calibration.warnings,
      enemyFingerprint: enemyFingerprint(battle),
    };
  }
}

/** Program-only post-generation calibration; it never asks the model to rewrite the enemy. */
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

/** At most one deterministic numeric calibration for a generated enemy. */
export async function maybeRequestAutomaticBalanceCalibration(
  variables: Record<string, any>,
  assessment: ContentDesignAssessment,
): Promise<boolean> {
  if (isExternalDesignAssistantActive()) return false;
  if (!assessment.context.settings.autoCalibration || !assessment.enemyPower) {
    return false;
  }
  const key = attemptKey(assessment);
  if (wasAttempted(key)) return false;
  const originalFingerprint = enemyFingerprint(variables.stat_data?.battle || {});
  const previousCalibration = variables.stat_data?.battle?.design_context?.balance?.programCalibration;
  if (
    previousCalibration?.enemyFingerprint === originalFingerprint
    && previousCalibration.requestedRatio === assessment.context.settings.difficultyPercent
  ) {
    markAttempted(key);
    return false;
  }
  const calibration = calibrateMvuEncounterNumbers(variables, assessment);
  if (
    !calibration
    || calibration.changedPaths.length === 0
    || Math.abs(calibration.appliedScale - 1) < 0.02
  ) {
    markAttempted(key);
    return false;
  }
  const contract = validateContentPackContract(calibration.calibratedPack, { requireEnemy: true, requireExecutable: true });
  if (!contract.ok) {
    throw new Error(`程序校准产生了不可执行内容：${contract.issues[0]?.path || 'unknown'}`);
  }
  let applied = false;
  await Promise.resolve(updateCurrentMessageVariablesWith(currentVariables => {
    const currentBattle = currentVariables?.stat_data?.battle;
    if (!currentBattle || enemyFingerprint(currentBattle) !== originalFingerprint) return currentVariables;
    applyCalibratedEnemies(currentVariables, calibration);
    applied = true;
    return currentVariables;
  }));
  if (!applied) return false;
  markAttempted(key);
  return true;
}
