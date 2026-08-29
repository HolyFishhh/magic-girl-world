import { analyzeContentDefinition } from './contentAnalysis';
import { type ContentDefinition, type ContentPack } from './contentPack';
import { createContentMechanicsFingerprint } from './contentFingerprint';
import {
  extractContentMechanicFeatures,
  mergeContentMechanicFeatures,
} from './contentMechanicFeatures';

export const ENEMY_POWER_SCORE_SPEC = 'mwg.enemy-power/v1' as const;

export interface EnemyPowerDimensions {
  durability: number;
  pressure: number;
  control: number;
  scaling: number;
  complexity: number;
  volatility: number;
}

export interface EnemyActionPressure {
  id: string;
  name: string;
  probability: number;
  damage: number;
  lust: number;
  block: number;
  heal: number;
  mechanics: string[];
}

export interface EnemyPowerScore {
  spec: typeof ENEMY_POWER_SCORE_SPEC;
  fingerprint: string;
  /** Full-health authored strength, comparable with DeckPowerScore.totalScore. */
  totalScore: number;
  /** Same enemy at the HP/lust state supplied by the story. */
  currentEncounterScore: number;
  dimensions: EnemyPowerDimensions;
  enemyCount: number;
  maxHp: number;
  currentHp: number;
  expectedDamagePerTurn: number;
  expectedLustPerTurn: number;
  expectedBlockPerTurn: number;
  peakDamage: number;
  actions: EnemyActionPressure[];
  confidence: 'low' | 'medium' | 'high';
  coverage: number;
  reasons: string[];
}

const scoreCache = new Map<string, EnemyPowerScore>();

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function record(value: unknown): value is Readonly<Record<string, any>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function enemies(pack: ContentPack): ContentDefinition[] {
  const values = pack.enemies?.length ? pack.enemies : pack.enemy ? [pack.enemy] : [];
  return values.filter(value => record(value));
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function actionWeight(enemy: ContentDefinition, action: ContentDefinition): number {
  const explicit = finite(action.weight, 0);
  if (explicit > 0) return explicit;
  const name = String(action.name || action.id || '');
  const probability = enemy.action_config?.probability;
  if (record(probability)) {
    const configured = finite(probability[name], 0);
    if (configured > 0) return configured;
  }
  return 1;
}

function analyzeActions(enemy: ContentDefinition): EnemyActionPressure[] {
  const actions = Array.isArray(enemy.actions) ? enemy.actions.filter(record) : [];
  const weights = actions.map(action => actionWeight(enemy, action));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || Math.max(1, actions.length);
  return actions.map((action, index) => {
    const analysis = analyzeContentDefinition(action, {
      selfHp: finite(enemy.max_hp, finite(enemy.hp, 50)),
      selfMaxHp: finite(enemy.max_hp, finite(enemy.hp, 50)),
      opponentHp: 100,
      opponentMaxHp: 100,
      selfEnergy: finite(enemy.max_energy, 3),
      selfMaxEnergy: finite(enemy.max_energy, 3),
      currentTurn: 3,
    });
    const features = extractContentMechanicFeatures(action);
    return {
      id: String(action.id || `action_${index + 1}`),
      name: String(action.name || action.id || `行动${index + 1}`),
      probability: round(weights[index] / totalWeight, 3),
      damage: round(Math.max(0, analysis.damage)),
      lust: round(Math.max(0, analysis.lust)),
      block: round(Math.max(0, analysis.metrics.defense)),
      heal: round(Math.max(0, analysis.metrics.sustain)),
      mechanics: features.axes,
    };
  });
}

/** Score authored enemy strength without mutating or repairing the generated definition. */
export function scoreEnemyPower(pack: ContentPack): EnemyPowerScore | null {
  const enemyList = enemies(pack);
  if (enemyList.length === 0) return null;
  const fingerprint = createContentMechanicsFingerprint({ enemy: pack.enemy, enemies: pack.enemies || [] });
  const stateKey = enemyList.map(enemy => `${finite(enemy.hp)}:${finite(enemy.lust)}`).join('|');
  const cacheKey = `${fingerprint}:${stateKey}`;
  const cached = scoreCache.get(cacheKey);
  if (cached) return cached;

  const actionSets = enemyList.map(enemy => analyzeActions(enemy));
  const actions = actionSets.flat();
  let expectedDamage = 0;
  let expectedLust = 0;
  let expectedBlock = 0;
  let expectedHeal = 0;
  let peakDamage = 0;
  for (const set of actionSets) {
    expectedDamage += set.reduce((sum, action) => sum + action.damage * action.probability, 0);
    expectedLust += set.reduce((sum, action) => sum + action.lust * action.probability, 0);
    expectedBlock += set.reduce((sum, action) => sum + action.block * action.probability, 0);
    expectedHeal += set.reduce((sum, action) => sum + action.heal * action.probability, 0);
    peakDamage += Math.max(0, ...set.map(action => action.damage));
  }

  const maxHp = enemyList.reduce((sum, enemy) => sum + Math.max(1, finite(enemy.max_hp, finite(enemy.hp, 1))), 0);
  const currentHp = enemyList.reduce((sum, enemy) => sum + clamp(finite(enemy.hp, finite(enemy.max_hp, 1)), 0, finite(enemy.max_hp, 1)), 0);
  const definitions = enemyList.flatMap(enemy => [
    ...(Array.isArray(enemy.actions) ? enemy.actions : []),
    ...(Array.isArray(enemy.abilities) ? enemy.abilities : []),
    ...(Array.isArray(enemy.status_effects) ? enemy.status_effects : []),
    ...(record(enemy.lust_effect) ? [enemy.lust_effect] : []),
  ]);
  const features = mergeContentMechanicFeatures(definitions.map(extractContentMechanicFeatures));
  const operationSet = new Set(features.operations);
  const controlCount = [
    'apply_status', 'remove_status', 'card_rule', 'discard', 'exhaust', 'end_turn', 'affliction', 'curse',
  ].filter(value => operationSet.has(value)).length;
  const scalingCount = [
    'trigger', 'modify', 'schedule', 'spawn_enemy', 'spawn_summon', 'resource', 'set_resource', 'condition',
  ].filter(value => operationSet.has(value)).length;
  const uncertainCount = [
    'condition', 'history_formula', 'container_formula', 'schedule', 'spawn_enemy', 'spawn_summon', 'extra_turn',
  ].filter(value => operationSet.has(value)).length;
  const actionProbabilities = actions.map(action => action.probability);
  const probabilitySpread = actionProbabilities.length
    ? Math.max(...actionProbabilities) - Math.min(...actionProbabilities)
    : 0;

  const durabilityRaw = maxHp * 0.65 + expectedBlock * 2.1 + expectedHeal * 2.6 + enemyList.length * 4;
  const pressureRaw = expectedDamage * 2.8 + expectedLust * 1.35 + peakDamage * 0.7;
  const controlRaw = controlCount * 6 + features.statuses.length * 2.5;
  const scalingRaw = scalingCount * 5 + features.triggers.length * 3;
  const totalScore = round(Math.max(1, durabilityRaw + pressureRaw + controlRaw + scalingRaw));
  const currentRatio = clamp(currentHp / Math.max(1, maxHp), 0, 1);
  const currentEncounterScore = round(totalScore - durabilityRaw * (1 - currentRatio));
  const coverage = clamp(1 - uncertainCount * 0.1 - Math.max(0, features.complexity - 65) / 220, 0.25, 1);
  const dimensions: EnemyPowerDimensions = {
    durability: round(clamp(durabilityRaw / Math.max(1, totalScore) * 150)),
    pressure: round(clamp(pressureRaw / Math.max(1, totalScore) * 150)),
    control: round(clamp(10 + controlCount * 18 + features.statuses.length * 5)),
    scaling: round(clamp(8 + scalingCount * 16 + features.triggers.length * 5)),
    complexity: round(clamp(features.complexity)),
    volatility: round(clamp(10 + probabilitySpread * 55 + uncertainCount * 10)),
  };
  const result: EnemyPowerScore = {
    spec: ENEMY_POWER_SCORE_SPEC,
    fingerprint,
    totalScore,
    currentEncounterScore,
    dimensions,
    enemyCount: enemyList.length,
    maxHp: round(maxHp),
    currentHp: round(currentHp),
    expectedDamagePerTurn: round(expectedDamage),
    expectedLustPerTurn: round(expectedLust),
    expectedBlockPerTurn: round(expectedBlock),
    peakDamage: round(peakDamage),
    actions,
    confidence: coverage >= 0.82 ? 'high' : coverage >= 0.58 ? 'medium' : 'low',
    coverage: round(coverage, 3),
    reasons: [
      `满状态强度 ${totalScore}，剧情当前状态强度 ${currentEncounterScore}`,
      `耐久 ${round(maxHp)}，每回合预计生命伤害 ${round(expectedDamage)}、欲望压力 ${round(expectedLust)}`,
      `峰值生命伤害 ${round(peakDamage)}，估算覆盖率 ${Math.round(coverage * 100)}%`,
    ],
  };
  scoreCache.set(cacheKey, result);
  while (scoreCache.size > 64) scoreCache.delete(scoreCache.keys().next().value as string);
  return result;
}

export function clearEnemyPowerScoreCache(): void {
  scoreCache.clear();
}

