import { BUILD_REFERENCE_CASES, BUILD_CALIBRATION_SPEC, calibrateBuildCase } from '../game-core/buildCalibration';
import { evaluateIsolatedEncounter, type EncounterEvaluationInput } from './isolatedEncounterEvaluator';
import { evaluationMedian, type EncounterEvaluation } from '../game-core/encounterEvaluation';
import { TOWER_BUILD_MEASUREMENT_SPEC, TOWER_BALANCE_DESIGN, type TowerBuildMeasurement } from '../game-core/towerEncounterBudget';
import { prepareTowerBattleForActivation } from './towerContentActivation';
import type { EnemyBudgetEnvelope } from '../game-core/encounterBalance';
import { towerEncounterPlayerReference } from './towerEncounterPlayer';
import { isSimpleHpEncounter } from './towerBalanceAudit';

export async function measureTowerBuild(battle: Record<string, any>, seeds = 2): Promise<TowerBuildMeasurement> {
  const maxHp = Math.max(1, Number(battle.core?.max_hp) || 80);
  const evidence: EncounterEvaluation[] = [];
  for (const reference of BUILD_REFERENCE_CASES) {
    const count = reference.count;
    const probe = towerEncounterPlayerReference(battle);
    probe.core = { ...probe.core, hp: maxHp, lust: 0 };
    delete probe.enemy;
    const statusIds = new Set((probe.statuses || []).map((status: any) => status.id));
    let weaknessId = 'benchmark_weakness';
    while (statusIds.has(weaknessId)) weaknessId += '_';
    if ('weakness' in reference) probe.statuses = [...(probe.statuses || []), {
      id: weaknessId, name: '基准虚弱', emoji: '▽', type: 'debuff', stacks_change: -1,
      triggers: { hold: { modify: 'damage', multiply: 0.5 } },
    }];
    probe.enemies = Array.from({ length: count }, (_, index) => ({ id: `reference_${index}`, name: '评估用参考敌人', emoji: '◇',
      ...('lust' in reference ? { lust_effect: { name: '基准欲望满溢', effects: { damage: 20, to: 'opponent' } } } : {}),
      hp: Math.floor(reference.hp / count) + (index < reference.hp % count ? 1 : 0), max_hp: Math.floor(reference.hp / count) + (index < reference.hp % count ? 1 : 0), lust: 0, max_lust: 100,
      actions: [{ id: 'pressure', name: '公开压力', effects: [{ damage: Math.floor(reference.damage / count) + (index < reference.damage % count ? 1 : 0) }, ...('lust' in reference ? [{ lust: reference.lust }] : []), ...('weakness' in reference ? [{ apply_status: weaknessId, stacks: 2, to: 'opponent' }] : [])] },
        ...(reference.burst ? [{ id: 'rest', name: '蓄力间隔', effects: { wait: true } }] : [])],
      ...(reference.burst ? { action_mode: 'sequence', action_config: { sequence: ['pressure', 'rest', 'rest'] } } : {}),
    }));
    // This is a build probe, not an exhaustive solver. It must never turn a
    // truncated search into a numerical authority for changing authored foes.
    evidence.push(await evaluateIsolatedEncounter({ battle: probe, seeds, maxTurns: reference.turns, maxPlaysPerTurn: 24, maxSearchDecisions: 2, maxCandidateBranches: 8,
      policies: ['tempo', 'survival', 'engine'], search: 'rollout' }));
  }
  const valid = evidence.slice(0, 2).flatMap(e => e.trials).filter(trial => trial.outcome !== 'inconclusive');
  const damageByTurn = Array.from({ length: 5 }, (_, index) => Math.max(0,
    ...['tempo', 'engine'].map(policy => evaluationMedian(valid.filter(trial => trial.policy === policy)
      .map(trial => trial.horizons.find(horizon => horizon.turn === index + 1)?.damage ?? trial.damageDealt))),
  ));
  return { spec: TOWER_BUILD_MEASUREMENT_SPEC, damageByTurn, maxHp,
    // Fixed reference pressure minus actual net HP loss includes healing, control, kills and summon interception once.
    defensePerTurn: evaluationMedian(valid.filter(trial => trial.policy === 'survival' && trial.outcome !== 'terminated').map(trial => Math.max(0, Math.min(12, 12 - trial.netHpLost / Math.max(1, trial.turns))))),
    status: evidence.every(e => e.status === 'measured') ? 'measured' : 'inconclusive',
    decisionCoverage: evidence.every(e => e.decisionCoverage === 'bounded') ? 'bounded' : 'limited', evidence,
    calibration: { spec: BUILD_CALIBRATION_SPEC, cases: evidence.map((result, index) => calibrateBuildCase(BUILD_REFERENCE_CASES[index], result, maxHp)) } };
}
export interface RuntimeBalanceInput {
  persistentBattle: Record<string, any>;
  generatedBattle: Record<string, any>;
  budget: EnemyBudgetEnvelope;
  seed: number;
  seeds?: number;
}
export interface RuntimeBalanceResult {
  generatedBattle: Record<string, any>;
  original: EncounterEvaluation;
  evaluation: EncounterEvaluation;
  changedPaths: string[];
  hpScale: number;
  damageScale: number;
  feedback: string[];
  needsReview: boolean;
  requiresRegeneration: boolean;
}
function rows(evaluation: EncounterEvaluation) { return evaluation.trials.filter(trial => trial.outcome !== 'inconclusive'); }
function encounterHp(battle: Record<string, any>): number {
  return (battle.enemies || (battle.enemy ? [battle.enemy] : [])).reduce((sum: number, enemy: any) => sum + Math.max(0, Number(enemy.hp ?? enemy.max_hp) || 0), 0);
}
function loss(evaluation: EncounterEvaluation, budget: EnemyBudgetEnvelope, maxHp: number, battle: Record<string, any>): number {
  if (evaluation.status !== 'measured') return Infinity;
  const summaries = evaluation.policies;
  const best = [...summaries].sort((a, b) => b.winRate - a.winRate || a.medianConditionLoss - b.medianConditionLoss || a.medianTurns - b.medianTurns)[0];
  if (!best) return Infinity;
  const tooLong = Math.max(0, best.medianTurns - budget.targetTurns[1]) * (best.medianConditionLoss === 0 ? 0.25 : 1);
  const deficit = isSimpleHpEncounter(battle) ? Math.max(0, budget.durability.hp.min - encounterHp(battle)) / Math.max(1, budget.durability.hp.min) : 0;
  // A fast kill of an on-budget encounter is build payoff, never a quality fault.
  return deficit * 6 + tooLong * 2 + best.medianConditionLoss * 10 + Math.max(0, 0.65 - best.winRate) * 12;
}
/** Enemy-only literal numeric whitelist. No energy, stack, hit count, duration,
 * choices, cooldown, reward, child-card or summon edits. Formula expressions stay authored.
 */
function scaleEnemyNumbers(source: Record<string, any>, hpScale: number, damageScale: number) {
  const battle = structuredClone(source), changedPaths: string[] = [];
  const scale = (object: Record<string, any>, key: string, factor: number, path: string) => {
    if (typeof object[key] !== 'number' || object[key] <= 0 || factor === 1) return;
    const next = Math.max(1, Math.round(object[key] * factor));
    if (object[key] !== next) { object[key] = next; changedPaths.push(`${path}.${key}`); }
  };
  const effects = (value: any, path: string) => {
    if (Array.isArray(value)) { value.forEach((entry, index) => effects(entry, `${path}[${index}]`)); return; }
    if (!value || typeof value !== 'object') return;
    // Literal damage only; no traversal into created content, summon templates or drop rewards.
    if (!value.to || value.to === 'opponent') scale(value, 'damage', damageScale, path);
    if (value.effects) effects(value.effects, `${path}.effects`);
    if (value.then) effects(value.then, `${path}.then`);
    if (value.else) effects(value.else, `${path}.else`);
  };
  const enemies = Array.isArray(battle.enemies) ? battle.enemies : battle.enemy ? [battle.enemy] : [];
  enemies.forEach((enemy: any, index: number) => {
    const path = Array.isArray(battle.enemies) ? `battle.enemies[${index}]` : 'battle.enemy';
    scale(enemy, 'hp', hpScale, path); scale(enemy, 'max_hp', hpScale, path);
    for (const [i, action] of (enemy.actions || []).entries()) effects(action.effects, `${path}.actions[${i}].effects`);
  });
  return { battle, changedPaths };
}
export async function balanceTowerWithRuntime(input: RuntimeBalanceInput): Promise<RuntimeBalanceResult> {
  const measure = (generated: Record<string, any>, seeds = input.seeds ?? 2) => evaluateIsolatedEncounter({
    battle: prepareTowerBattleForActivation(towerEncounterPlayerReference(input.persistentBattle), generated), seed: input.seed, seeds, maxTurns: 12,
    maxSearchDecisions: 4, maxCandidateBranches: 4,
  });
  const original = await measure(input.generatedBattle);
  let evaluation = original, generatedBattle = structuredClone(input.generatedBattle);
  let changedPaths: string[] = [], hpScale = 1, damageScale = 1;
  const feedback: string[] = [];
  const maxHp = Math.max(1, Number(input.persistentBattle.core?.max_hp) || 80);
  const preservesAuthoredInjury = (input.generatedBattle.enemies || (input.generatedBattle.enemy ? [input.generatedBattle.enemy] : []))
    .some((enemy: any) => Number(enemy.hp ?? enemy.max_hp) < Number(enemy.max_hp));
  for (let pass = 0; pass < TOWER_BALANCE_DESIGN.maxCalibrationPasses && !preservesAuthoredInjury && evaluation.status === 'measured'
    && input.budget.numericAuthority === 'runtime-reference' && evaluation.decisionCoverage === 'bounded'; pass++) {
    const capable = [...evaluation.policies].sort((a, b) => b.winRate - a.winRate || a.medianConditionLoss - b.medianConditionLoss || a.medianTurns - b.medianTurns)[0];
    if (!capable) break;
    const allFast = evaluation.policies.every(policy => policy.winRate >= 0.8 && policy.medianTurns < input.budget.targetTurns[0]);
    const allStruggle = evaluation.policies.every(policy => policy.winRate < 0.5);
    // Failed bounded policies are not proof of an impossible human encounter.
    // Small paired samples may establish a route, but cannot authorize weakening.
    const mayWeaken = isSimpleHpEncounter(generatedBattle)
      && evaluation.policies.every(policy => policy.completed >= 6 && policy.winRateInterval[1] < 0.5);
    let nextHp = hpScale, nextDamage = damageScale;
    const currentHp = encounterHp(generatedBattle);
    if (allFast && isSimpleHpEncounter(generatedBattle) && currentHp < input.budget.durability.hp.min * 0.65)
      nextHp = Math.min(3, input.budget.durability.hp.min / Math.max(1, encounterHp(input.generatedBattle)));
    else if (mayWeaken && currentHp > input.budget.durability.hp.max)
      nextHp *= input.budget.durability.hp.max / currentHp;
    const worstPressure = (generatedBattle.enemies || (generatedBattle.enemy ? [generatedBattle.enemy] : []))
      .reduce((sum: number, enemy: any) => sum + Math.max(0, ...(enemy.actions || []).map((action: any) => Number(action.effects?.damage) || 0)), 0);
    if (allStruggle && mayWeaken && worstPressure > input.budget.burstCap) nextDamage *= input.budget.burstCap / worstPressure;
    if (nextHp === hpScale && nextDamage === damageScale) break;
    // Keep build payoff: bounded changes per authored encounter, no unbounded pursuit of a target win rate.
    nextHp = Math.min(3, Math.max(0.5, nextHp)); nextDamage = Math.min(1.7, Math.max(0.5, nextDamage));
    const candidate = scaleEnemyNumbers(input.generatedBattle, nextHp, nextDamage);
    if (!candidate.changedPaths.length) break;
    const measured = await measure(candidate.battle);
    if (loss(measured, input.budget, maxHp, candidate.battle) >= loss(evaluation, input.budget, maxHp, generatedBattle)) break;
    evaluation = measured; generatedBattle = candidate.battle; changedPaths = candidate.changedPaths;
    hpScale = nextHp; damageScale = nextDamage;
  }
  const values = rows(evaluation), victories = values.filter(row => row.outcome === 'victory');
  const totalHp = encounterHp(generatedBattle);
  const requiresRegeneration = input.budget.numericAuthority === 'runtime-reference'
    && evaluation.status === 'measured' && evaluation.decisionCoverage === 'bounded' && !victories.length
    && totalHp > input.budget.durability.hp.max * 4;
  if (requiresRegeneration) feedback.push('敌方总生命仍超过程序总耐久预算上限4倍，有限校准后仍无获胜样本；违反本节点数值预算，需重新生成。此结论不是对人类必败的判断。');
  if (evaluation.status !== 'measured') feedback.push('机制执行或预算未覆盖，结果不确定；不能按零收益削弱或判定玩家必败。');
  if (evaluation.decisionCoverage === 'limited') feedback.push('包含未充分搜索的选择/道具/长连招，本次只报告已执行路径，禁止据此自动削弱敌人。');
  if (evaluation.seeds.length < 6) feedback.push('当前为少量配对种子的预筛，置信区间较宽；无胜利样本不能触发自动削弱。');
  if (isSimpleHpEncounter(generatedBattle) && totalHp < input.budget.durability.hp.min * 0.65
    && evaluation.policies.every(policy => policy.medianTurns < input.budget.targetTurns[0] && policy.winRate >= 0.8))
    feedback.push('所有策略都过快结束：总耐久或支援作用不足；补充可回应机制，不要靠锁血拖回合。');
  if (!victories.length) feedback.push('本轮代理没有找到获胜路线；需检查压力、关键机制与策略盲区，不能声称人类必败。');
  else if (victories.every(trial => trial.conditionLoss > 0.15))
    feedback.push('尚未找到保留大部分状态的获胜路线：综合整场生命净损失与持久欲望净增长；检查防御/抢杀/控制窗口及拖延强化的累计后果，不把强制掉状态换速度当目标。');
  if (evaluation.policies.every(policy => policy.medianTurns > input.budget.targetTurns[1]))
    feedback.push('战斗可能拖沓：检查治疗/护盾循环和玩家兑现窗口，不要只继续增加HP。');
  const tempo = evaluation.policies.find(policy => policy.policy === 'tempo');
  const survival = evaluation.policies.find(policy => policy.policy === 'survival');
  if (tempo && survival) feedback.push(`相同种子策略对照：抢攻 ${tempo.medianTurns} 回合/损失 ${tempo.medianHpLost} HP；防守 ${survival.medianTurns} 回合/损失 ${survival.medianHpLost} HP。`);
  feedback.push(...evaluation.limitations);
  return { generatedBattle, original, evaluation, changedPaths, hpScale, damageScale, feedback, requiresRegeneration,
    needsReview: evaluation.status !== 'measured' || !victories.length
      || victories.every(trial => trial.conditionLoss > 0.15) || loss(evaluation, input.budget, maxHp, generatedBattle) > 4 };
}
