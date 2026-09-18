import { stableHash32 } from '../game-core';
import { evaluationMedian } from '../game-core/encounterEvaluation';
import type { TowerBuildMeasurement } from '../game-core/towerEncounterBudget';
import type { RuntimeBalanceResult } from './towerRuntimeBalance';

export function isSimpleHpEncounter(battle: Record<string, any>): boolean {
  const roster = battle.enemies || (battle.enemy ? [battle.enemy] : []);
  const allowed = new Set(['id','name','emoji','description','hp','max_hp','lust','max_lust','block','actions','abilities','status_effects','resources','action_mode','action_config','defeat_reward']);
  return roster.length > 0 && roster.every((enemy: any) => {
    if (!enemy || typeof enemy !== 'object' || Object.keys(enemy).some(key => !allowed.has(key))) return false;
    if (!Number.isFinite(enemy.max_hp) || enemy.max_hp <= 0) return false;
    if (Number(enemy.block || 0) !== 0 || Number(enemy.lust || 0) !== 0) return false;
    for (const key of ['abilities', 'status_effects', 'resources', 'statuses', 'summons', 'summon', 'healing', 'heal', 'spawn_enemy', 'spawn_summon']) {
      const value = enemy[key];
      if (Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : value !== undefined && value !== null && value !== false && value !== 0) return false;
    }
    return Array.isArray(enemy.actions) && enemy.actions.every((action: any) => {
      if (!action || Object.keys(action).some(key => !['id','name','emoji','description','weight','effects'].includes(key))) return false;
      const effects = action?.effects;
      return effects && typeof effects === 'object' && !Array.isArray(effects)
        && Object.keys(effects).length === 1 && Number.isFinite(effects.damage);
    });
  });
}

/** Persist only compact evidence. Detailed trajectories belong to local diagnostics,
 * never to future story prompts. A full-health reference does not assess current HP. */
export function compactTowerBalanceAudit(result: RuntimeBalanceResult, measurement: TowerBuildMeasurement,
  requestedRatio: number, modelRepairUsed: boolean) {
  const evaluation = result.evaluation;
  const roster = result.generatedBattle.enemies || (result.generatedBattle.enemy ? [result.generatedBattle.enemy] : []);
  const totalHp = roster.reduce((sum: number, enemy: any) => sum + Math.max(0, Number(enemy.hp ?? enemy.max_hp) || 0), 0);
  const observedPressure = evaluationMedian(evaluation.trials.filter(trial => trial.outcome !== 'inconclusive')
    .map(trial => (trial.hpLost + trial.blocked) / Math.max(1, trial.turns)));
  const playerScore = measurement.damageByTurn[2] + measurement.defensePerTurn * 3;
  const measured = evaluation.status === 'measured' && measurement.status === 'measured' && measurement.decisionCoverage === 'bounded' && evaluation.decisionCoverage === 'bounded' && playerScore > 0;
  const literalOnly = isSimpleHpEncounter(result.generatedBattle);
  const scoreAssessment = !measured ? 'not-measured' : literalOnly ? 'literal-hp-direct-damage' : 'complex-mechanics-not-comparable';
  const scoreLimitations = !measured
    ? ['测量未充分覆盖，暂不输出精确相对分数。']
    : literalOnly ? [] : ['敌方包含治疗、欲望、控制或增援等机制，生命压力不能代表完整难度。'];
  return {
    spec: 'mwg.tower-enemy-balance/v2',
    auditId: `encounter-${stableHash32([JSON.stringify(result)])}`,
    requestedRatio, modelRepairUsed, assessment: evaluation.status, needsReview: result.needsReview,
    resourceAssessment: 'full-health-reference',
    referenceRouteFound: evaluation.trials.some(trial => trial.outcome === 'victory'),
    // Deliberately omit winnableAtCurrentResources: future encounters cannot know it.
    scoreAssessment, scoreLimitations,
    ...(measured && literalOnly ? { playerDeckScore: playerScore, finalEnemyScore: Math.round(totalHp + observedPressure * 3),
      scoreBasis: 'actual-roster-hp-plus-observed-three-turn-pressure' } : {}),
    hpScale: result.hpScale, damageScale: result.damageScale,
    changedPaths: result.changedPaths.slice(0, 64), warnings: result.feedback.slice(0, 16),
    evidence: { engine: evaluation.engine, sampleCount: evaluation.seeds.length,
      decisionCoverage: evaluation.decisionCoverage, policies: evaluation.policies },
  };
}
