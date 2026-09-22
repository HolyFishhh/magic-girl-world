import type { EnemyBudgetEnvelope } from './encounterBalance';
import type { EncounterEvaluation } from './encounterEvaluation';
export const TOWER_BUILD_MEASUREMENT_SPEC = 'mwg.tower-build-measurement/v1' as const;
export interface TowerBuildMeasurement {
  spec: typeof TOWER_BUILD_MEASUREMENT_SPEC;
  damageByTurn: number[];
  defensePerTurn: number;
  maxHp: number;
  status: 'measured' | 'inconclusive';
  decisionCoverage?: 'bounded' | 'limited';
  evidence: EncounterEvaluation[];
  calibration?: { spec: 'mwg.build-calibration/v1'; cases: import('./buildCalibration').BuildCalibrationCase[] };
}
export interface TowerEncounterBaseline {
  spec: 'mwg.tower-encounter-baseline/v1';
  act: number;
  capturedAct?: number;
  source?: 'opening-reference' | 'late-reference';
  damageByTurn: number[];
  defensePerTurn: number;
  maxHp: number;
}
export const TOWER_BALANCE_DESIGN = {
  // Provisional game-design targets, not claims from papers or other games.
  normalTurns: [3, 6] as [number, number], eliteTurns: [4, 8] as [number, number], bossTurns: [6, 10] as [number, number],
  growthResponseExponent: 0.6,
  actGrowth: [1, 1.35, 1.75],
  maxCalibrationPasses: 2,
};
export function validTowerEncounterBaseline(value: unknown): value is TowerEncounterBaseline {
  const v = value as TowerEncounterBaseline;
  return !!v && v.spec === 'mwg.tower-encounter-baseline/v1' && Number.isInteger(v.act) && v.act >= 1
    && (v.capturedAct === undefined || (Number.isInteger(v.capturedAct) && v.capturedAct >= 1 && v.capturedAct <= 3))
    && (v.source === undefined || v.source === 'opening-reference' || v.source === 'late-reference')
    && Array.isArray(v.damageByTurn) && v.damageByTurn.length === 5 && v.damageByTurn.every(n => Number.isFinite(n) && n >= 0)
    && Number.isFinite(v.defensePerTurn) && v.defensePerTurn >= 0 && Number.isFinite(v.maxHp) && v.maxHp > 0;
}
export function createTowerEncounterBaseline(measurement: TowerBuildMeasurement, act: number): TowerEncounterBaseline {
  if (!hasReliableTowerMeasurement(measurement)) throw new Error('未充分覆盖的测量不能建立成长基线');
  return { spec: 'mwg.tower-encounter-baseline/v1', act, capturedAct: act,
    source: act === 1 ? 'opening-reference' : 'late-reference', damageByTurn: [...measurement.damageByTurn],
    defensePerTurn: measurement.defensePerTurn, maxHp: measurement.maxHp };
}
export function hasReliableTowerMeasurement(measurement: TowerBuildMeasurement): boolean {
  return measurement.status === 'measured' && measurement.decisionCoverage === 'bounded';
}
const range = (value: number, spread = 0.18) => ({ min: Math.max(1, Math.round(value * (1 - spread))), max: Math.max(1, Math.round(value * (1 + spread))) });
/** Fixed act progression plus partial response to measured build growth preserves upgrades' benefit.
 * Current HP does not change the world budget. Calibration uses a clean full-health reference.
 */
export function towerBudgetFromMeasurement(input: {
  measurement: TowerBuildMeasurement; baseline?: TowerEncounterBaseline; kind: string; act: number; floor: number; difficulty: number;
}): EnemyBudgetEnvelope {
  const reliable = hasReliableTowerMeasurement(input.measurement);
  // A known baseline is held neutral when current probes miss mechanisms. With
  // no baseline, use an explicit maintained prior, never missing damage as zero.
  const prior: TowerEncounterBaseline = { spec: 'mwg.tower-encounter-baseline/v1', act: 1,
    damageByTurn: [18, 36, 54, 72, 90], defensePerTurn: 4, maxHp: input.measurement.maxHp };
  const baseline = input.baseline || (reliable ? createTowerEncounterBaseline(input.measurement, input.act) : prior);
  const m = reliable ? input.measurement : { ...input.measurement,
    damageByTurn: baseline.damageByTurn, defensePerTurn: baseline.defensePerTurn };
  const design = TOWER_BALANCE_DESIGN;
  const targetTurns = input.kind === 'boss' ? design.bossTurns : input.kind === 'elite' ? design.eliteTurns : design.normalTurns;
  const anchorAct = baseline.capturedAct ?? baseline.act;
  const actScale = (design.actGrowth[Math.min(2, input.act - 1)] || 1) / (design.actGrowth[Math.min(2, anchorAct - 1)] || 1);
  const floorScale = 1 + Math.max(0, Math.min(14, input.floor - 1)) * 0.018;
  const difficultyScale = Math.max(0.45, Math.min(1.65, input.difficulty / 80));
  const anchorIndex = input.kind === 'boss' ? 4 : input.kind === 'elite' ? 3 : 2;
  const baseDamage = Math.max(0, baseline.damageByTurn[anchorIndex]);
  const currentDamage = Math.max(0, m.damageByTurn[anchorIndex]);
  const grownDamage = (baseDamage + 12) * Math.pow((currentDamage + 12) / (baseDamage + 12), design.growthResponseExponent) - 12;
  const durationScale = input.kind === 'boss' ? 1.55 : input.kind === 'elite' ? 1.25 : 1.1;
  const durability = (12 + Math.max(0, grownDamage)) * actScale * floorScale * durationScale * Math.sqrt(difficultyScale);
  const defense = Math.max(0, (baseline.defensePerTurn + 2) * Math.pow((m.defensePerTurn + 2) / (baseline.defensePerTurn + 2), design.growthResponseExponent) - 2);
  const pressure = (defense * 0.8 + baseline.maxHp * 0.10) * Math.sqrt(actScale * floorScale) * difficultyScale;
  const pressureCap = m.maxHp * (input.kind === 'boss' ? 0.40 : input.kind === 'elite' ? 0.32 : 0.25);
  return {
    spec: 'mwg.enemy-budget/v2', requestedRatio: input.difficulty, effectiveRatio: input.difficulty,
    numericAuthority: reliable ? 'runtime-reference' : 'maintained-prior',
    targetScore: Math.round(durability + pressure * targetTurns[0]), targetTurns: [...targetTurns],
    durability: { hp: range(durability), sustain: { min: 0, max: Math.round(durability * 0.20) } },
    pressureByTurn: Array.from({ length: 5 }, (_, index) => ({ turn: index + 1,
      hpDamage: range(Math.min(pressureCap, pressure * (index % 3 === 2 ? 1.3 : index % 3 === 1 ? 0.6 : 1))),
      lust: { min: 0, max: 8 }, block: { min: 0, max: Math.round(durability * 0.08) },
    })),
    burstCap: pressureCap, scalingCap: 1.5, controlBudget: input.kind === 'battle' ? 1 : 2,
    requiredCounterplayWindows: input.kind === 'battle' ? 1 : 2, inheritedMechanics: [],
    confidence: reliable ? 0.7 : 0.2,
    guidance: [
      reliable ? '使用有覆盖标记的正式引擎参考测量；短样本不代表人类胜率。'
        : '测量覆盖不足：采用已有基线的中性预算或明确的维护初值；禁止将缺失能力视为变弱，不授权自动数值校准。',
      '爬塔难度80%是标准档；这里的 targetScore 是耐久与压力规划值，不是旧版卡组/敌人评分，也不是两者的百分比或胜率。',
      '此为整场总预算，先分配到敌人职责；HP、治疗、护盾共同消耗耐久预算，不可叠加满额。',
      '按实际行动规则核对整轮平均压力：每回合只执行一个随机动作时，应按权重加权；顺序行动应包含准备和休息回合。不要让每个攻击动作单独达到预算、却因其余动作空转使整轮输出远低于目标。',
      '用控制、成长、欲望或召唤替代直接伤害时，必须有可执行且在预期战长内能兑现的效果；只给状态起名字或在描述里说很强不计入替代收益。未投入的耐久与压力预算应由其他有效机制补足。',
      '每回合压力允许有准备、爆发和恢复节奏；不要把每项上限同时拉满。欲望、控制、增援需要替代部分伤害预算。',
      '参考构筑的常规战斗应有约3回合以上互动；强构筑可以更快结束，不能锁血强制拖回合。',
      '开局测量基线持久保存，幕间固定成长只部分跟随玩家收益；按程序节点软克制抽签决定是否主动针对当前流派；允许护盾、净化、固定减伤等有应对窗口的机制，不制造封死所有获胜手段的免疫。',
      '本文数值是本项目可维护初值，需持续用固定回放和实玩校准，不是胜率保证。',
    ],
  };
}
