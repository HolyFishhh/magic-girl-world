import { createContentPack, type ContentDefinition, type ContentPack } from './contentPack';
import { type DeckPowerProfile } from './deckPowerProfile';
import { simulateEncounterShadow, type EncounterShadowSimulation } from './encounterShadowSimulation';

export const ENEMY_BUDGET_ENVELOPE_SPEC = 'mwg.enemy-budget/v2' as const;
export const ENCOUNTER_CALIBRATION_SPEC = 'mwg.encounter-calibration/v1' as const;

export interface BalanceRange {
  min: number;
  max: number;
}

export interface EnemyTurnPressureBudget {
  turn: number;
  hpDamage: BalanceRange;
  lust: BalanceRange;
  block: BalanceRange;
}

export interface EnemyBudgetEnvelope {
  spec: typeof ENEMY_BUDGET_ENVELOPE_SPEC;
  requestedRatio: number;
  effectiveRatio: number;
  targetScore: number;
  targetTurns: [number, number];
  durability: { hp: BalanceRange; sustain: BalanceRange };
  pressureByTurn: EnemyTurnPressureBudget[];
  burstCap: number;
  scalingCap: number;
  controlBudget: number;
  requiredCounterplayWindows: number;
  inheritedMechanics: string[];
  confidence: number;
  guidance: string[];
}

export interface EncounterCalibrationResult {
  spec: typeof ENCOUNTER_CALIBRATION_SPEC;
  requestedRatio: number;
  effectiveRatio: number;
  frontierScale: number;
  appliedScale: number;
  calibratedPack: ContentPack;
  simulation: EncounterShadowSimulation | null;
  currentResourceSimulation: EncounterShadowSimulation | null;
  changedPaths: string[];
  iterations: number;
  winnableAtCurrentResources: boolean;
  confidence: number;
  warnings: string[];
}

export interface EncounterCalibrationLoopOptions {
  /** Extra passes after the first binary-search calibration. */
  maxCorrectionPasses?: number;
}

const HORIZONS = [1, 2, 3, 5, 8] as const;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function ratio(value: unknown): number {
  return round(clamp(Number(value) || 80, 10, 110), 0);
}

function range(center: number, spread: number, minimum = 0): BalanceRange {
  return {
    min: round(Math.max(minimum, center * (1 - spread)), 1),
    max: round(Math.max(minimum, center * (1 + spread)), 1),
  };
}

function targetTurnsFor(value: number): [number, number] {
  if (value <= 20) return [2, 4];
  if (value <= 60) return [3, 5];
  if (value <= 90) return [4, 7];
  return value <= 100 ? [5, 8] : [6, 9];
}

function closestHorizon(turn: number): typeof HORIZONS[number] {
  return [...HORIZONS].sort((left, right) => Math.abs(left - turn) - Math.abs(right - turn))[0];
}

function resourceDifficultyCap(profile: DeckPowerProfile, currentHp: number, currentLust: number, maxLust: number): number {
  const hpRatio = clamp(currentHp / Math.max(1, profile.maxHp), 0, 1);
  const lustHeadroom = clamp((maxLust - currentLust) / Math.max(1, maxLust), 0, 1);
  const reserve = hpRatio * 0.72 + lustHeadroom * 0.28;
  if (reserve >= 0.72) return 110;
  if (reserve >= 0.5) return 100;
  if (reserve >= 0.3) return 80;
  if (reserve >= 0.15) return 50;
  return 10;
}

export function createEnemyBudgetEnvelope(input: {
  profile: DeckPowerProfile;
  requestedRatio: number;
  currentHp: number;
  currentLust?: number;
  maxLust?: number;
  inheritedMechanics?: string[];
}): EnemyBudgetEnvelope {
  const requestedRatio = ratio(input.requestedRatio);
  const currentHp = clamp(Number(input.currentHp) || 0, 0, input.profile.maxHp);
  const maxLust = Math.max(1, Number(input.maxLust) || 100);
  const currentLust = clamp(Number(input.currentLust) || 0, 0, maxLust);
  const cap = resourceDifficultyCap(input.profile, currentHp, currentLust, maxLust);
  const effectiveRatio = Math.min(requestedRatio, cap);
  const targetTurns = targetTurnsFor(effectiveRatio);
  const centerTurn = Math.round((targetTurns[0] + targetTurns[1]) / 2);
  const horizonTurn = closestHorizon(centerTurn);
  const horizon = input.profile.horizons[horizonTurn];
  const difficultyScale = effectiveRatio / 100;
  const hpCenter = Math.max(
    5,
    (horizon.hpDamage.p50 + horizon.lustPressure.p50 * 0.55) * (0.72 + difficultyScale * 0.28),
  );
  // Anchor pressure to the build's best demonstrated defensive throughput instead
  // of whichever horizon happens to be closest to the target fight length.  The
  // latter can make a 100% envelope weaker than an 80% envelope when a deck has a
  // particularly strong early or late defensive turn.
  const defensePerTurn = Math.max(...HORIZONS.map(turn => {
    const point = input.profile.horizons[turn];
    return (point.mitigation.p50 + point.healing.p50) / Math.max(1, turn);
  }));
  const desiredLossPerTurn = input.profile.maxHp * Math.max(0, effectiveRatio - 95) / 1000 / Math.max(1, centerTurn);
  const actionDamage = Math.max(0, defensePerTurn * (0.62 + difficultyScale * 0.38) + desiredLossPerTurn);
  const burstCap = round(Math.max(1, Math.min(
    currentHp * (effectiveRatio > 100 ? 0.42 : effectiveRatio >= 80 ? 0.34 : 0.25),
    input.profile.maxHp * 0.38,
  )), 1);
  const pressureByTurn = HORIZONS.filter(turn => turn <= Math.max(8, targetTurns[1])).map(turn => {
    const point = input.profile.horizons[turn];
    const blockCenter = Math.max(0, point.hpDamage.p50 / Math.max(1, turn) * 0.18 * difficultyScale);
    return {
      turn,
      hpDamage: range(Math.min(burstCap, actionDamage * (1 + (turn - 1) * 0.035 * difficultyScale)), 0.22),
      lust: range(maxLust * 0.045 * difficultyScale * (1 + (turn - 1) * 0.025), 0.28),
      block: range(blockCenter, 0.3),
    };
  });
  const controlBudget = round(clamp(
    (input.profile.dimensions.flexibility + input.profile.dimensions.control) / 2 * difficultyScale,
    0,
    100,
  ), 1);
  const inheritedMechanics = [...new Set((input.inheritedMechanics || []).filter(Boolean))].slice(0, 6);
  const guidance = [
    `玩家程序评分 ${input.profile.totalScore}，目标敌人评分约 ${round(input.profile.totalScore * effectiveRatio / 100, 1)}。`,
    `建议有效耐久 ${range(hpCenter, effectiveRatio >= 100 ? 0.1 : 0.17, 1).min}~${range(hpCenter, effectiveRatio >= 100 ? 0.1 : 0.17, 1).max}，预期战长 ${targetTurns[0]}~${targetTurns[1]} 回合。`,
    `普通单次生命压力不超过 ${burstCap}；高压应来自可读节奏与机制组合，不来自不可规避首轮处决。`,
    '生命、欲望、控制、格挡、成长共享预算；强化一项时同步收缩其他项。',
    input.profile.confidence < 0.65
      ? '当前构筑含未完整模拟机制，数值区间应向安全侧收缩并保留更多反制窗口。'
      : '当前模拟覆盖足够，可在区间内突出敌人的剧情主题与独特机制。',
    ...(effectiveRatio < requestedRatio
      ? [`当前生命/欲望资源不足，请求 ${requestedRatio}% 已安全封顶为 ${effectiveRatio}%；卡组长期评分不变。`]
      : []),
  ];
  return {
    spec: ENEMY_BUDGET_ENVELOPE_SPEC,
    requestedRatio,
    effectiveRatio,
    targetScore: round(input.profile.totalScore * effectiveRatio / 100, 1),
    targetTurns,
    durability: {
      hp: range(hpCenter, effectiveRatio >= 100 ? 0.1 : 0.17, 1),
      sustain: range(Math.max(0, hpCenter / Math.max(1, centerTurn) * 0.08 * difficultyScale), 0.3),
    },
    pressureByTurn,
    burstCap,
    scalingCap: round(1 + Math.max(0, effectiveRatio - 50) / 250, 2),
    controlBudget,
    requiredCounterplayWindows: effectiveRatio <= 50 ? 3 : effectiveRatio <= 80 ? 2 : 1,
    inheritedMechanics,
    confidence: input.profile.confidence,
    guidance,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const DIRECT_SCALABLE_KEYS = new Set(['damage', 'heal', 'block', 'energy', 'lust', 'stacks']);
const MODERN_AMOUNT_OPERATIONS = new Set([
  'damage', 'heal', 'gain_block', 'gain_energy', 'gain_lust', 'gain_resource',
  'damage_summons', 'heal_summons', 'gain_summon_resource',
]);

function integerScaledAmount(value: number, factor: number, minimum = 0): number {
  const scaled = Math.round(value * factor);
  if (value > 0) return Math.max(Math.max(1, minimum), scaled);
  if (value < 0) return Math.min(-1, scaled);
  return 0;
}

function scaleEffectValue(value: unknown, factor: number, path: string, changed: string[]): unknown {
  if (Array.isArray(value)) return value.map((entry, index) => scaleEffectValue(entry, factor, `${path}[${index}]`, changed));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = { ...value };
  for (const [key, entry] of Object.entries(value)) {
    const scalable = DIRECT_SCALABLE_KEYS.has(key)
      || (key === 'amount' && typeof value.op === 'string' && MODERN_AMOUNT_OPERATIONS.has(value.op));
    if (scalable && typeof entry === 'number' && Number.isFinite(entry) && entry !== 0) {
      const next = integerScaledAmount(entry, factor, key === 'stacks' ? 1 : 0);
      result[key] = next;
      if (next !== entry) changed.push(`${path}.${key}`);
      continue;
    }
    // Hit counts, trigger limits, action weights and timing are identity-bearing cadence;
    // they are never silently scaled by the numeric calibrator.
    result[key] = scaleEffectValue(entry, factor, `${path}.${key}`, changed);
  }
  return result;
}

function scaleEnemy(enemy: ContentDefinition, factor: number, path: string, changed: string[]): ContentDefinition {
  const result = structuredClone(enemy) as Record<string, any>;
  const maxHp = Math.max(1, Number(result.max_hp) || Number(result.hp) || 1);
  const hp = clamp(Number(result.hp ?? maxHp), 0, maxHp);
  const hpRatio = hp / maxHp;
  const nextMaxHp = Math.max(1, Math.round(maxHp * factor));
  // Current HP carries story-authored pre-battle damage.  Keeping runtime precision
  // avoids turning an exact ratio such as 45/60 into 68/90 during scaling,
  // while staying inside the public battle-number precision contract.
  const nextHp = hp <= 0 ? 0 : Math.max(0.01, round(nextMaxHp * hpRatio, 2));
  if (nextMaxHp !== maxHp) changed.push(`${path}.max_hp`);
  if (nextHp !== hp) changed.push(`${path}.hp`);
  result.max_hp = nextMaxHp;
  result.hp = nextHp;
  for (const field of ['actions', 'abilities', 'status_effects', 'lust_effect', 'stance', 'orbs']) {
    if (result[field] !== undefined) result[field] = scaleEffectValue(result[field], factor, `${path}.${field}`, changed);
  }
  return result;
}

export function scaleEncounterNumbers(pack: ContentPack, factor: number): { pack: ContentPack; changedPaths: string[] } {
  const normalized = clamp(factor, 0.1, 4);
  const sourceEnemies = pack.enemies?.length ? pack.enemies : pack.enemy ? [pack.enemy] : [];
  const changedPaths: string[] = [];
  const enemies = sourceEnemies.map((enemy, index) => scaleEnemy(enemy, normalized, `battle.enemies[${index}]`, changedPaths));
  return {
    pack: createContentPack({
      cards: pack.cards,
      statuses: pack.statuses,
      relics: pack.relics,
      items: pack.items,
      abilities: pack.abilities,
      activeStatuses: pack.activeStatuses,
      playerResources: pack.playerResources,
      enemies,
      playerDesireEffect: pack.desireEffects.player,
    }),
    changedPaths: [...new Set(changedPaths)],
  };
}

function engineResult(simulation: EncounterShadowSimulation | null) {
  return simulation?.strategies.find(strategy => strategy.strategy === 'engine') || null;
}

function cleanFrontier(simulation: EncounterShadowSimulation | null): boolean {
  const engine = engineResult(simulation);
  return Boolean(engine && engine.winRateLow >= 0.42 && engine.winRate >= 0.58 && engine.medianHpRatio >= 0.985);
}

function winnable(simulation: EncounterShadowSimulation | null): boolean {
  const engine = engineResult(simulation);
  return Boolean(engine && engine.winRateLow >= 0.3 && engine.winRate >= 0.55 && engine.medianHpRatio > 0.02);
}

function simulate(
  pack: ContentPack,
  player: { hp: number; maxHp: number; lust: number; maxLust: number },
  seeds: number,
): EncounterShadowSimulation | null {
  return simulateEncounterShadow({ pack, player, seeds, strategies: ['engine'] });
}

/**
 * Calibrate only authored enemy numbers. Mechanic identity, action order, hit counts,
 * target selectors, names and descriptions remain untouched.
 */
export function calibrateEncounterNumbers(input: {
  pack: ContentPack;
  profile: DeckPowerProfile;
  requestedRatio: number;
  currentHp: number;
  currentLust?: number;
  maxLust?: number;
  seeds?: number;
  /**
   * Keep low-confidence calibration near the authored numbers. Story-mode
   * advisory balancing leaves this enabled; tower mode disables it because
   * the requested difficulty ratio is authoritative for the run.
   */
  lowConfidenceScaleClamp?: boolean;
}): EncounterCalibrationResult {
  const requestedRatio = ratio(input.requestedRatio);
  const maxLust = Math.max(1, Number(input.maxLust) || 100);
  const currentLust = clamp(Number(input.currentLust) || 0, 0, maxLust);
  const currentHp = clamp(Number(input.currentHp) || 0, 0, input.profile.maxHp);
  const seeds = Math.max(8, Math.min(64, Math.floor(input.seeds ?? 12)));
  const envelope = createEnemyBudgetEnvelope({
    profile: input.profile,
    requestedRatio,
    currentHp,
    currentLust,
    maxLust,
  });
  let low = 0.12;
  let high = 3.2;
  let iterations = 0;
  for (; iterations < 7; iterations += 1) {
    const middle = (low + high) / 2;
    const candidate = scaleEncounterNumbers(input.pack, middle).pack;
    const result = simulate(candidate, { hp: input.profile.maxHp, maxHp: input.profile.maxHp, lust: 0, maxLust }, seeds);
    if (cleanFrontier(result)) low = middle;
    else high = middle;
  }
  const frontierScale = round(low, 3);
  let effectiveRatio = envelope.effectiveRatio;
  let appliedScale = frontierScale * effectiveRatio / 100;
  const warnings: string[] = [];
  const clampLowConfidenceScale = input.lowConfidenceScaleClamp !== false;
  if (input.profile.confidence < 0.55 && clampLowConfidenceScale) {
    appliedScale = clamp(appliedScale, 0.72, 1.28);
    warnings.push('模拟覆盖率较低，自动校准已限制在原始数值的 72%~128%，其余只提供软提示。');
  }
  let calibrated = scaleEncounterNumbers(input.pack, appliedScale);
  let fullSimulation = simulate(
    calibrated.pack,
    { hp: input.profile.maxHp, maxHp: input.profile.maxHp, lust: 0, maxLust },
    seeds,
  );
  let currentSimulation = simulate(
    calibrated.pack,
    { hp: currentHp, maxHp: input.profile.maxHp, lust: currentLust, maxLust },
    seeds,
  );
  while (!winnable(currentSimulation) && effectiveRatio > 10) {
    effectiveRatio = Math.max(10, effectiveRatio - 5);
    appliedScale = frontierScale * effectiveRatio / 100;
    if (input.profile.confidence < 0.55 && clampLowConfidenceScale) {
      appliedScale = clamp(appliedScale, 0.72, 1.28);
    }
    calibrated = scaleEncounterNumbers(input.pack, appliedScale);
    fullSimulation = simulate(
      calibrated.pack,
      { hp: input.profile.maxHp, maxHp: input.profile.maxHp, lust: 0, maxLust },
      seeds,
    );
    currentSimulation = simulate(
      calibrated.pack,
      { hp: currentHp, maxHp: input.profile.maxHp, lust: currentLust, maxLust },
      seeds,
    );
  }
  if (effectiveRatio < requestedRatio) {
    warnings.push(`请求 ${requestedRatio}% 已按当前资源封顶为 ${effectiveRatio}%，避免生成统计上不可通关的遭遇。`);
  }
  if (!winnable(currentSimulation)) warnings.push('最低强度仍未达到可通关置信线；保留原机制并要求人工或剧情提供额外反制资源。');
  return {
    spec: ENCOUNTER_CALIBRATION_SPEC,
    requestedRatio,
    effectiveRatio,
    frontierScale,
    appliedScale: round(appliedScale, 3),
    calibratedPack: calibrated.pack,
    simulation: fullSimulation,
    currentResourceSimulation: currentSimulation,
    changedPaths: calibrated.changedPaths,
    iterations,
    winnableAtCurrentResources: winnable(currentSimulation),
    confidence: input.profile.confidence,
    warnings,
  };
}

/**
 * Re-run the shared numeric calibrator a bounded number of times when a
 * low-confidence clamp leaves the current-resource simulation unwinnable.
 * Every pass only scales authored numeric fields; names, descriptions,
 * selectors, hit counts and action cadence remain untouched.
 */
export function calibrateEncounterUntilWinnable(
  input: Parameters<typeof calibrateEncounterNumbers>[0],
  options: EncounterCalibrationLoopOptions = {},
): EncounterCalibrationResult {
  const maxCorrectionPasses = Math.max(0, Math.min(4, Math.floor(options.maxCorrectionPasses ?? 4)));
  let result = calibrateEncounterNumbers(input);
  let appliedScale = result.appliedScale;
  const changedPaths = new Set(result.changedPaths);
  const warnings = new Set(result.warnings);
  let totalIterations = result.iterations;

  for (let pass = 0; !result.winnableAtCurrentResources && pass < maxCorrectionPasses; pass += 1) {
    const next = calibrateEncounterNumbers({
      ...input,
      pack: result.calibratedPack,
      requestedRatio: Math.min(input.requestedRatio, result.effectiveRatio),
    });
    totalIterations += next.iterations;
    if (next.changedPaths.length === 0 || Math.abs(next.appliedScale - 1) < 0.01) break;
    appliedScale *= next.appliedScale;
    next.changedPaths.forEach(path => changedPaths.add(path));
    next.warnings.forEach(warning => warnings.add(warning));
    result = {
      ...next,
      requestedRatio: Number(input.requestedRatio),
      appliedScale: round(appliedScale, 3),
      changedPaths: [...changedPaths],
      iterations: totalIterations,
      warnings: [...warnings],
    };
  }
  return result;
}
