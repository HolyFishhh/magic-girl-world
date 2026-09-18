import {
  calibrateEncounterUntilWinnable,
  createDeckPowerProfileFingerprint,
  createEnemyBudgetEnvelope,
  profileDeckPower,
  scoreEnemyPower,
  simulateEncounterShadow,
  validateContentPackContract,
  type DeckPowerProfile,
  type EncounterCalibrationResult,
} from '../game-core';
import type { TowerProgramBalanceAudit } from '../game-core/towerRequest';
import { createContentPackFromMvuBattle } from '../runtime/contentPackAdapter';
import { prepareTowerBattleForActivation } from '../runtime/towerContentActivation';
import type { DesignAssistantSettings } from './types';

export const TOWER_ENEMY_BALANCE_SPEC = 'mwg.tower-enemy-balance/v1' as const;

export interface TowerEnemyBalanceAudit extends TowerProgramBalanceAudit {
  spec: typeof TOWER_ENEMY_BALANCE_SPEC;
  requestedRatio: number;
  effectiveRatio: number;
  playerDeckScore: number;
  targetEnemyScore: number;
  originalEnemyScore: number;
  finalEnemyScore: number;
  originalRatio: number;
  finalRatio: number;
  appliedScale: number;
  winnableAtCurrentResources: boolean;
  modelRepairUsed: boolean;
  changedPaths: string[];
  warnings: string[];
}

export interface TowerEnemyBalanceResult {
  generatedBattle: Record<string, any>;
  audit: TowerEnemyBalanceAudit;
  calibration: EncounterCalibrationResult;
  requiresModelRepair: boolean;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function currentDeckProfile(
  pack: ReturnType<typeof createContentPackFromMvuBattle>,
  battle: Record<string, any>,
  settings: DesignAssistantSettings,
  cached?: DeckPowerProfile | null,
): DeckPowerProfile {
  const core = isRecord(battle.core) ? battle.core : {};
  const maxHp = Math.max(1, finite(core.max_hp, 1));
  const maxLust = Math.max(1, finite(core.max_lust, 100));
  const fingerprint = createDeckPowerProfileFingerprint({
    pack,
    maxHp,
    maxLust,
    seeds: settings.simulationSeeds,
  });
  if (cached?.fingerprint === fingerprint) return cached;
  return profileDeckPower({ pack, maxHp, maxLust, seeds: settings.simulationSeeds });
}

/**
 * Tower-only post-generation audit. Enemy ranges are injected before generation;
 * this pass only measures the authored result. The counterfactual calibration is
 * retained as diagnostic evidence, but is never written back and never rejects a
 * structurally valid enemy for being stronger, weaker, stranger, or low-confidence.
 */
export function balanceTowerGeneratedBattle(input: {
  variables: Record<string, any>;
  generatedBattle: unknown;
  settings: DesignAssistantSettings;
  cachedProfile?: DeckPowerProfile | null;
  modelRepairUsed?: boolean;
}): TowerEnemyBalanceResult {
  const persistentBattle = input.variables?.stat_data?.battle;
  if (!isRecord(persistentBattle)) throw new Error('爬塔平衡校验缺少玩家 battle 数据');
  if (!isRecord(input.generatedBattle)) throw new Error('爬塔平衡校验缺少生成的敌人数据');

  const mergedBattle = prepareTowerBattleForActivation(persistentBattle, input.generatedBattle);
  const authoredPack = createContentPackFromMvuBattle(mergedBattle);
  if (authoredPack.cards.length === 0) throw new Error('爬塔平衡校验缺少可模拟的玩家牌组');
  const authoredContract = validateContentPackContract(authoredPack, {
    requireEnemy: true,
    requireExecutable: true,
  });
  if (!authoredContract.ok) {
    throw new Error(`爬塔敌人含不可执行结构：${authoredContract.issues[0]?.path || 'unknown'}`);
  }
  const profile = currentDeckProfile(authoredPack, mergedBattle, input.settings, input.cachedProfile);
  const core = isRecord(mergedBattle.core) ? mergedBattle.core : {};
  const currentHp = Math.max(0, finite(core.hp, profile.maxHp));
  const maxLust = Math.max(1, finite(core.max_lust, 100));
  const currentLust = Math.max(0, finite(core.lust, 0));
  const envelope = createEnemyBudgetEnvelope({
    profile,
    requestedRatio: input.settings.difficultyPercent,
    currentHp,
    currentLust,
    maxLust,
  });
  const originalPower = scoreEnemyPower(authoredPack, { maxHp: profile.maxHp, maxLust });
  if (!originalPower) throw new Error('爬塔平衡校验未找到可评分敌人');

  const calibration = calibrateEncounterUntilWinnable({
    pack: authoredPack,
    profile,
    requestedRatio: input.settings.difficultyPercent,
    currentHp,
    currentLust,
    maxLust,
    seeds: input.settings.simulationSeeds,
    lowConfidenceScaleClamp: false,
  }, { maxCorrectionPasses: 4 });
  const currentSimulation = simulateEncounterShadow({
    pack: authoredPack,
    player: {
      hp: currentHp,
      maxHp: profile.maxHp,
      lust: currentLust,
      maxLust,
    },
    seeds: input.settings.simulationSeeds,
    strategies: ['engine'],
  });
  const engine = currentSimulation?.strategies.find(strategy => strategy.strategy === 'engine');
  const authoredWinnable = Boolean(
    engine && engine.winRateLow >= 0.3 && engine.winRate >= 0.55 && engine.medianHpRatio > 0.02,
  );

  const deckScore = Math.max(0.1, profile.totalScore);
  // `frontierScale` is the multiplier that makes the authored encounter the
  // player's 100% clean-play frontier.  Enemy scores used by the tower must
  // therefore be expressed on that same simulated scale.  The older raw
  // heuristic score could disagree with the simulator badly (for example an
  // encounter calibrated above 100% was reported as 47%), which also made the
  // end-of-run relative-difficulty score misleading.
  const frontierScale = Math.max(0.001, calibration.frontierScale);
  const originalRatio = 100 / frontierScale;
  const recommendation = Math.abs(calibration.appliedScale - 1) >= 0.02
    ? `程序估算建议倍率 ×${round(calibration.appliedScale, 2)}；仅供后续 AI 参考，未改写本节点。`
    : '程序估算认为当前数值接近目标区间；未改写本节点。';
  return {
    generatedBattle: structuredClone(input.generatedBattle),
    calibration,
    requiresModelRepair: false,
    audit: {
      spec: TOWER_ENEMY_BALANCE_SPEC,
      requestedRatio: calibration.requestedRatio,
      effectiveRatio: calibration.effectiveRatio,
      playerDeckScore: round(profile.totalScore),
      targetEnemyScore: round(envelope.targetScore),
      originalEnemyScore: round(deckScore * originalRatio / 100),
      finalEnemyScore: round(deckScore * originalRatio / 100),
      originalRatio: round(originalRatio),
      finalRatio: round(originalRatio),
      appliedScale: 1,
      winnableAtCurrentResources: authoredWinnable,
      modelRepairUsed: false,
      changedPaths: [],
      warnings: [recommendation, ...calibration.warnings].slice(0, 12),
    },
  };
}
