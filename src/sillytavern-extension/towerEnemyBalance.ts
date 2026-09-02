import {
  calibrateEncounterUntilWinnable,
  createDeckPowerProfileFingerprint,
  createEnemyBudgetEnvelope,
  profileDeckPower,
  scoreEnemyPower,
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

function comparableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collectNumericChanges(
  before: unknown,
  after: unknown,
  changes: Map<string, string>,
  key = '',
): void {
  const beforeNumber = comparableNumber(before);
  const afterNumber = comparableNumber(after);
  if (beforeNumber !== null && afterNumber !== null) {
    if (Math.abs(beforeNumber - afterNumber) > 1e-9 && key !== 'weight' && key !== 'hits') {
      const oldText = String(beforeNumber);
      const newText = String(round(afterNumber, 2));
      if (!changes.has(oldText)) changes.set(oldText, newText);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.min(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      collectNumericChanges(before[index], after[index], changes, key);
    }
    return;
  }
  if (!isRecord(before) || !isRecord(after)) return;
  for (const childKey of Object.keys(before)) {
    if (childKey === 'description' || childKey === 'name' || childKey === 'id' || childKey === 'emoji') continue;
    if (!Object.hasOwn(after, childKey)) continue;
    collectNumericChanges(before[childKey], after[childKey], changes, childKey);
  }
}

function replaceNumericToken(text: string, oldText: string, newText: string): string {
  const escaped = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(^|[^\\d.])${escaped}(?=$|[^\\d.])`, 'g');
  return text.replace(matcher, (_match, prefix: string) => `${prefix}${newText}`);
}

function synchronizeDefinitionDescription(before: unknown, after: unknown): void {
  if (!isRecord(before) || !isRecord(after) || typeof before.description !== 'string') return;
  const changes = new Map<string, string>();
  collectNumericChanges(before, after, changes);
  if (changes.size === 0) return;
  let description = before.description;
  for (const [oldText, newText] of [...changes].sort((left, right) => right[0].length - left[0].length)) {
    description = replaceNumericToken(description, oldText, newText);
  }
  after.description = description;
}

function synchronizeDefinitionList(before: unknown, after: unknown): void {
  if (!Array.isArray(before) || !Array.isArray(after)) return;
  const used = new Set<number>();
  for (let index = 0; index < after.length; index += 1) {
    const next = after[index];
    const matchIndex = before.findIndex((candidate, candidateIndex) => {
      if (used.has(candidateIndex) || !isRecord(candidate) || !isRecord(next)) return false;
      const candidateId = String(candidate.id || '').trim();
      const nextId = String(next.id || '').trim();
      if (candidateId && nextId) return candidateId === nextId;
      return String(candidate.name || '').trim() === String(next.name || '').trim();
    });
    const resolvedIndex = matchIndex >= 0 ? matchIndex : index < before.length ? index : -1;
    if (resolvedIndex < 0) continue;
    used.add(resolvedIndex);
    synchronizeDefinitionDescription(before[resolvedIndex], next);
  }
}

function synchronizeEnemyDescriptions(
  beforePack: ReturnType<typeof createContentPackFromMvuBattle>,
  afterPack: ReturnType<typeof createContentPackFromMvuBattle>,
): void {
  const beforeEnemies = beforePack.enemies?.length
    ? beforePack.enemies
    : beforePack.enemy
      ? [beforePack.enemy]
      : [];
  const afterEnemies = afterPack.enemies?.length
    ? afterPack.enemies
    : afterPack.enemy
      ? [afterPack.enemy]
      : [];
  for (let index = 0; index < afterEnemies.length; index += 1) {
    const afterEnemy = afterEnemies[index];
    const beforeEnemy =
      beforeEnemies.find(enemy => String(enemy.id || '') === String(afterEnemy.id || '')) || beforeEnemies[index];
    if (!beforeEnemy) continue;
    synchronizeDefinitionList(beforeEnemy.actions, afterEnemy.actions);
    synchronizeDefinitionList(beforeEnemy.abilities, afterEnemy.abilities);
    synchronizeDefinitionList(beforeEnemy.status_effects, afterEnemy.status_effects);
    synchronizeDefinitionDescription(beforeEnemy.lust_effect, afterEnemy.lust_effect);
  }
}

function calibratedGeneratedBattle(
  original: Record<string, any>,
  authoredPack: ReturnType<typeof createContentPackFromMvuBattle>,
  calibration: EncounterCalibrationResult,
): Record<string, any> {
  const result = structuredClone(original);
  const calibratedPack = structuredClone(calibration.calibratedPack);
  synchronizeEnemyDescriptions(authoredPack, calibratedPack);
  const enemies = calibratedPack.enemies?.length
    ? calibratedPack.enemies
    : calibratedPack.enemy
      ? [calibratedPack.enemy]
      : [];
  if (Array.isArray(original.enemies)) {
    result.enemies = structuredClone(enemies);
    if (Object.hasOwn(original, 'enemy')) result.enemy = structuredClone(enemies[0]);
  } else {
    result.enemy = structuredClone(enemies[0]);
  }
  return result;
}

/**
 * Tower-only post-generation loop. The model first authors the complete enemy;
 * this function then scores that exact definition and uses the shared encounter
 * simulator/calibrator to make the smallest numeric correction it can.
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
  const originalPower = scoreEnemyPower(authoredPack);
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
  const contract = validateContentPackContract(calibration.calibratedPack, {
    requireEnemy: true,
    requireExecutable: true,
  });
  if (!contract.ok) throw new Error(`爬塔程序校准产生不可执行敌人：${contract.issues[0]?.path || 'unknown'}`);
  const finalPower = scoreEnemyPower(calibration.calibratedPack);
  if (!finalPower) throw new Error('爬塔程序校准后敌人无法评分');

  const deckScore = Math.max(0.1, profile.totalScore);
  // `frontierScale` is the multiplier that makes the authored encounter the
  // player's 100% clean-play frontier.  Enemy scores used by the tower must
  // therefore be expressed on that same simulated scale.  The older raw
  // heuristic score could disagree with the simulator badly (for example an
  // encounter calibrated above 100% was reported as 47%), which also made the
  // end-of-run relative-difficulty score misleading.
  const frontierScale = Math.max(0.001, calibration.frontierScale);
  const originalRatio = 100 / frontierScale;
  const finalRatio = originalRatio * calibration.appliedScale;
  return {
    generatedBattle: calibratedGeneratedBattle(input.generatedBattle, authoredPack, calibration),
    calibration,
    requiresModelRepair: !calibration.winnableAtCurrentResources,
    audit: {
      spec: TOWER_ENEMY_BALANCE_SPEC,
      requestedRatio: calibration.requestedRatio,
      effectiveRatio: calibration.effectiveRatio,
      playerDeckScore: round(profile.totalScore),
      targetEnemyScore: round(envelope.targetScore),
      originalEnemyScore: round(deckScore * originalRatio / 100),
      finalEnemyScore: round(deckScore * finalRatio / 100),
      originalRatio: round(originalRatio),
      finalRatio: round(finalRatio),
      appliedScale: calibration.appliedScale,
      winnableAtCurrentResources: calibration.winnableAtCurrentResources,
      modelRepairUsed: input.modelRepairUsed === true,
      changedPaths: calibration.changedPaths.slice(0, 120),
      warnings: calibration.warnings.slice(0, 12),
    },
  };
}
