import type { BattleRequest } from './battleContract';
import type { BuildBudget, ContentDefinition } from './contentPack';
import {
  analyzeContentDefinition,
  analyzeContentScenarioRange,
  hasContentMetric,
  type ContentAnalysis,
} from './contentAnalysis';

export interface EnemyBudget {
  hpMin: number;
  hpMax: number;
  hitMin: number;
  hitMax: number;
}

export interface EnemyBudgetAssessment {
  budget: EnemyBudget;
  warnings: string[];
}

function positiveRound(value: number, minimum: number): number {
  return Math.max(minimum, Math.round(Number.isFinite(value) ? value : 0));
}

/** Give the generator concrete ranges; it should not have to perform balance arithmetic. */
export function recommendEnemyBudget(build: BuildBudget, danger: 0 | 1 | 2 | 3, act = 1): EnemyBudget {
  const tier = Math.max(1, danger);
  const attack = Math.max(4, build.attack);
  const hpMultipliers: Record<number, [number, number]> = {
    1: [1.5, 3],
    2: [3, 5],
    3: [6, 9],
  };
  const [hpLow, hpHigh] = hpMultipliers[tier];
  const actFloor = 15 + Math.max(1, act) * 5;
  const hpMin = positiveRound(attack * hpLow, actFloor);
  const hpMax = Math.max(hpMin + 5, positiveRound(attack * hpHigh, actFloor + 5));
  const hitMin = positiveRound(
    Math.max(build.defense * (0.25 + tier * 0.1), build.maxHp * (0.04 + tier * 0.01)),
    3 + tier,
  );
  const hitMax = Math.max(
    hitMin + 3,
    positiveRound(build.defense * (0.55 + tier * 0.15) + build.maxHp * (0.04 + tier * 0.01), 6 + tier),
  );
  return { hpMin, hpMax, hitMin, hitMax };
}

export function formatEnemyBudget(budget: EnemyBudget): string {
  return `hp=${budget.hpMin}..${budget.hpMax} hit=${budget.hitMin}..${budget.hitMax}`;
}

function analyzeEnemyEffect(action: ContentDefinition): ContentAnalysis {
  return analyzeContentDefinition(action);
}

function numericActionDamage(analysis: ContentAnalysis): number | null {
  return analysis.damageKnown ? analysis.damage : null;
}

function estimatedPeakDamage(action: ContentDefinition): number {
  return analyzeContentScenarioRange(action).damageMax;
}

/** Diagnose obvious numeric outliers without rejecting formula-driven custom encounters. */
export function assessEnemyBudget(request: BattleRequest, build: BuildBudget): EnemyBudgetAssessment {
  const danger = request.route?.danger ?? 1;
  const budget = recommendEnemyBudget(build, danger, request.route?.act ?? 1);
  const warnings: string[] = [];
  const enemies = request.content.enemies?.length
    ? request.content.enemies
    : request.content.enemy
      ? [request.content.enemy]
      : [];
  if (enemies.length === 0) return { budget, warnings: ['敌人内容为空'] };

  const totalMaxHp = enemies.reduce((sum, enemy) => {
    const value = Number(enemy.max_hp);
    return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);
  if (totalMaxHp > budget.hpMax * 1.5) {
    warnings.push(`敌方总生命 ${totalMaxHp} 明显高于建议上限 ${budget.hpMax}，可能形成拖长战斗`);
  } else if (totalMaxHp < budget.hpMin * 0.5) {
    warnings.push(`敌方总生命 ${totalMaxHp} 明显低于建议下限 ${budget.hpMin}，可能缺少战斗压力`);
  }

  for (const enemy of enemies) {
    const enemyLabel = String(enemy.name || enemy.id || '敌人');
    const actions = Array.isArray(enemy.actions)
      ? enemy.actions.filter(
        (action): action is ContentDefinition => !!action && typeof action === 'object' && !Array.isArray(action),
      )
      : [];
    const analyses = actions.map(analyzeEnemyEffect);
    const damages = analyses.map(numericActionDamage);
    const estimatedPeaks = actions.map(estimatedPeakDamage);
    const knownDamages = damages.filter((value): value is number => value !== null);
    const desireEffect = enemy.lust_effect;
    const desireAnalysis = desireEffect && typeof desireEffect === 'object' && !Array.isArray(desireEffect)
      ? analyzeEnemyEffect(desireEffect as ContentDefinition)
      : null;
    const pressureFromActions = analyses.some(analysis => hasContentMetric(analysis, 'attack'));
    const pressureFromDesire = desireAnalysis ? hasContentMetric(desireAnalysis, 'attack') : false;
    if (knownDamages.length === actions.length && actions.length > 0 && knownDamages.every(value => value <= 0) && !pressureFromActions && !pressureFromDesire) {
      warnings.push(`${enemyLabel}的所有行动均未发现生命伤害，若无欲望或状态压力可能形成无风险战斗`);
    }
    const peakDamage = Math.max(knownDamages.length > 0 ? Math.max(...knownDamages) : 0, ...estimatedPeaks);
    if (peakDamage > budget.hitMax * 2) {
      warnings.push(`${enemyLabel}的单次估计伤害 ${Math.round(peakDamage)} 明显高于建议行动上限 ${budget.hitMax}，可能造成无解爆发`);
    }
  }
  return { budget, warnings };
}
