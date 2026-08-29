import { type DeckPowerScore } from './deckPowerScore';
import { type EnemyPowerScore } from './enemyPowerScore';

export const DIFFICULTY_BUDGET_SPEC = 'mwg.difficulty-budget/v1' as const;

export const DIFFICULTY_PRESETS = [
  { percent: 10, id: 'story', name: '剧情体验', description: '明显低于构筑强度，允许宽松试牌和高容错。' },
  { percent: 50, id: 'relaxed', name: '轻松', description: '能体现敌人特色，但通常不会迫使玩家消耗生命资源。' },
  { percent: 80, id: 'standard', name: '标准', description: '需要围绕敌人意图做决策，仍保留稳定容错。' },
  { percent: 100, id: 'limit', name: '极限平衡', description: '充分发挥构筑时可无损或仅受最小伤害获胜。' },
  { percent: 110, id: 'pressure', name: '高压', description: '稳定造成少量生命或道具消耗，但必须保持可战胜。' },
] as const;

export type DifficultyPresetId = (typeof DIFFICULTY_PRESETS)[number]['id'];

export interface NumericRange {
  min: number;
  max: number;
}

export interface EncounterFeasibility {
  currentHp: number;
  currentLust: number;
  projectedHpLoss: NumericRange;
  projectedLustGain: NumericRange;
  winnableAtCurrentResources: boolean;
  maxRecommendedPercent: number;
  preparationAdvice: string[];
}

export interface DifficultyBudget {
  spec: typeof DIFFICULTY_BUDGET_SPEC;
  difficultyPercent: number;
  preset: DifficultyPresetId | 'custom';
  playerScore: number;
  targetEnemyScore: number;
  targetTurns: NumericRange;
  enemyHp: NumericRange;
  expectedActionDamage: NumericRange;
  peakActionDamage: NumericRange;
  expectedActionLust: NumericRange;
  expectedActionBlock: NumericRange;
  counterplayWindows: NumericRange;
  desiredHpLossRatio: NumericRange;
  feasibility: EncounterFeasibility;
  generationGuidance: string[];
}

export interface EnemyBalanceCalibration {
  actualPercent: number;
  targetPercent: number;
  deviationPercent: number;
  band: 'far_below' | 'below' | 'on_target' | 'above' | 'far_above';
  requiresCorrection: boolean;
  guidance: string[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function range(center: number, spread: number, minimum = 0): NumericRange {
  return {
    min: round(Math.max(minimum, center * (1 - spread))),
    max: round(Math.max(minimum, center * (1 + spread))),
  };
}

export function normalizeDifficultyPercent(value: unknown): number {
  const parsed = Number(value);
  return round(clamp(Number.isFinite(parsed) ? parsed : 80, 10, 110), 0);
}

function presetId(percent: number): DifficultyBudget['preset'] {
  return DIFFICULTY_PRESETS.find(entry => entry.percent === percent)?.id || 'custom';
}

function targetTurnCenter(percent: number): number {
  if (percent <= 20) return 3;
  if (percent <= 60) return 4;
  if (percent <= 90) return 5;
  if (percent <= 100) return 6;
  return 6.5;
}

function desiredLossRatio(percent: number): NumericRange {
  if (percent <= 80) return { min: 0, max: round((percent / 80) * 0.03, 3) };
  if (percent <= 100) {
    const progress = (percent - 80) / 20;
    return { min: 0, max: round(0.03 + progress * 0.03, 3) };
  }
  const progress = (percent - 100) / 10;
  return { min: round(progress * 0.08, 3), max: round(0.06 + progress * 0.12, 3) };
}

function maximumRecommendedPercent(
  deck: DeckPowerScore,
  currentHp: number,
  currentLust: number,
  maxLust: number,
): number {
  const hpRatio = clamp(currentHp / Math.max(1, deck.maxHp), 0, 1);
  const lustHeadroom = clamp((maxLust - currentLust) / Math.max(1, maxLust), 0, 1);
  const resourceRatio = Math.min(hpRatio, 0.65 + lustHeadroom * 0.35);
  if (resourceRatio >= 0.72) return 110;
  if (resourceRatio >= 0.45) return 100;
  if (resourceRatio >= 0.25) return 80;
  if (resourceRatio >= 0.12) return 50;
  return 10;
}

/** Convert a persistent deck score into concrete, directly consumable enemy-generation numbers. */
export function createDifficultyBudget(input: {
  deck: DeckPowerScore;
  difficultyPercent: number;
  currentHp: number;
  currentLust?: number;
  maxLust?: number;
}): DifficultyBudget {
  const percent = normalizeDifficultyPercent(input.difficultyPercent);
  const currentHp = clamp(Number(input.currentHp) || 0, 0, input.deck.maxHp);
  const maxLust = Math.max(1, Number(input.maxLust) || 100);
  const currentLust = clamp(Number(input.currentLust) || 0, 0, maxLust);
  const targetEnemyScore = round(input.deck.totalScore * percent / 100);
  const turnCenter = targetTurnCenter(percent);
  const targetTurns = {
    min: Math.max(2, Math.floor(turnCenter - 1)),
    max: Math.max(3, Math.ceil(turnCenter + 1)),
  };
  const curvePoint = input.deck.curves.find(point => point.turn >= turnCenter) || input.deck.curves.at(-1)!;
  const pressurePerTurn = curvePoint.cumulativePressure / Math.max(1, curvePoint.turn);
  const protectionPerTurn = curvePoint.cumulativeProtection / Math.max(1, curvePoint.turn);
  const healingPerTurn = curvePoint.cumulativeHealing / Math.max(1, curvePoint.turn);
  const difficultyScale = percent / 100;
  const hpCenter = Math.max(6, pressurePerTurn * turnCenter * (0.68 + difficultyScale * 0.34));
  const lossRatio = desiredLossRatio(percent);
  const desiredLossPerTurn = input.deck.maxHp * ((lossRatio.min + lossRatio.max) / 2) / turnCenter;
  const mitigation = protectionPerTurn + healingPerTurn * 0.65;
  const actionDamageCenter = Math.max(0, mitigation * difficultyScale + desiredLossPerTurn);
  const peakDamageCenter = actionDamageCenter * (percent >= 100 ? 1.45 : 1.3);
  const actionLustCenter = Math.max(0, maxLust * 0.045 * difficultyScale);
  const actionBlockCenter = Math.max(0, pressurePerTurn * 0.28 * difficultyScale);
  const enemyHp = range(hpCenter, percent >= 100 ? 0.1 : 0.16, 1);
  const expectedActionDamage = range(actionDamageCenter, 0.18, 0);
  const peakActionDamage = range(peakDamageCenter, 0.12, 0);
  const expectedActionLust = range(actionLustCenter, 0.25, 0);
  const expectedActionBlock = range(actionBlockCenter, 0.25, 0);
  const projectedLoss = {
    min: round(input.deck.maxHp * lossRatio.min),
    max: round(input.deck.maxHp * lossRatio.max),
  };
  const projectedLustGain = {
    min: round(expectedActionLust.min * Math.max(1, targetTurns.min - 1)),
    max: round(expectedActionLust.max * targetTurns.max),
  };
  const maxRecommendedPercent = maximumRecommendedPercent(input.deck, currentHp, currentLust, maxLust);
  const hpSafe = currentHp - projectedLoss.max >= 1;
  const lustSafe = currentLust + projectedLustGain.max < maxLust * 1.8;
  const winnableAtCurrentResources = hpSafe && lustSafe && percent <= maxRecommendedPercent;
  const preparationAdvice: string[] = [];
  if (!hpSafe) preparationAdvice.push('当前生命不足以承受目标消耗：降低强度、安排恢复，或让剧情提供可读的规避窗口。');
  if (!lustSafe) preparationAdvice.push('当前欲望余量偏低：降低欲望压力，或提供可执行的净化、转化与提前击杀路线。');
  if (percent > maxRecommendedPercent) preparationAdvice.push(`以当前资源建议不超过 ${maxRecommendedPercent}% 强度；卡组基础分本身不变。`);
  if (preparationAdvice.length === 0) preparationAdvice.push('当前资源可承受目标强度，无需改写玩家构筑。');
  const windows = percent <= 50 ? { min: 3, max: 5 } : percent <= 80 ? { min: 2, max: 4 } : { min: 1, max: 3 };
  const generationGuidance = [
    `目标敌人强度 ${targetEnemyScore}，即玩家基础分 ${input.deck.totalScore} 的 ${percent}%。`,
    `总生命建议 ${enemyHp.min}~${enemyHp.max}；若剧情已造成先手伤势，保持 max_hp 并下调 hp，不要强行满血。`,
    `常规行动生命伤害 ${expectedActionDamage.min}~${expectedActionDamage.max}，峰值 ${peakActionDamage.min}~${peakActionDamage.max}。`,
    `预期战长 ${targetTurns.min}~${targetTurns.max} 回合，至少安排 ${windows.min} 个可观察的反制或调整窗口。`,
    percent >= 100
      ? '高压来自节奏、组合与迫使资源交换；不得用不可规避的首轮爆发制造必败。'
      : '保留敌人主题与复杂机制，但不要用纯数值堆叠填满预算。',
    '生命伤害、欲望压力、控制、格挡与成长共享同一预算；增加一项时应下调其他项。',
  ];
  return {
    spec: DIFFICULTY_BUDGET_SPEC,
    difficultyPercent: percent,
    preset: presetId(percent),
    playerScore: input.deck.totalScore,
    targetEnemyScore,
    targetTurns,
    enemyHp,
    expectedActionDamage,
    peakActionDamage,
    expectedActionLust,
    expectedActionBlock,
    counterplayWindows: windows,
    desiredHpLossRatio: lossRatio,
    feasibility: {
      currentHp: round(currentHp),
      currentLust: round(currentLust),
      projectedHpLoss: projectedLoss,
      projectedLustGain,
      winnableAtCurrentResources,
      maxRecommendedPercent,
      preparationAdvice,
    },
    generationGuidance,
  };
}

/** Compare a generated enemy with the requested target after the second model has produced it. */
export function calibrateEnemyPower(
  deck: DeckPowerScore,
  enemy: EnemyPowerScore,
  targetPercent: number,
): EnemyBalanceCalibration {
  const target = normalizeDifficultyPercent(targetPercent);
  const actualPercent = round(enemy.currentEncounterScore / Math.max(1, deck.totalScore) * 100);
  const deviationPercent = round(actualPercent - target);
  const absoluteDeviation = Math.abs(deviationPercent);
  const band: EnemyBalanceCalibration['band'] = deviationPercent <= -22
    ? 'far_below'
    : deviationPercent < -8
      ? 'below'
      : deviationPercent >= 22
        ? 'far_above'
        : deviationPercent > 8
          ? 'above'
          : 'on_target';
  const guidance: string[] = [];
  if (band === 'far_below' || band === 'below') {
    guidance.push('优先增加敌人的有效耐久、行动节奏或一个与剧情一致的副机制，不要重建玩家卡组。');
  } else if (band === 'far_above' || band === 'above') {
    guidance.push('优先削减不可规避爆发、行动频率或有效耐久，并保留敌人主题与关键招式。');
  } else {
    guidance.push('强度落在目标容差内；仅检查反制窗口、目标指向和可执行性。');
  }
  if (enemy.confidence === 'low' || deck.confidence === 'low') {
    guidance.push('复杂机制覆盖率较低，程序只给软校准；需要依赖真实战斗抽样或用户主动修复。');
  }
  return {
    actualPercent,
    targetPercent: target,
    deviationPercent,
    band,
    requiresCorrection: absoluteDeviation > 12 && enemy.confidence !== 'low' && deck.confidence !== 'low',
    guidance,
  };
}

