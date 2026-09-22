import { evaluationMedian, type EncounterTrial } from './encounterEvaluation';
import { BUILD_REFERENCE_CASES } from './buildCalibration';
import type { TowerBuildMeasurement } from './towerEncounterBudget';
const round = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const policyName: Record<string, string> = { tempo: '抢攻', survival: '保命', engine: '展开' };
/** A versioned design index, NOT predicted win probability. Every number comes
 * from a complete production-engine trial. Pick one policy per scenario using
 * all its seeds; never splice offense from one policy and defense from another.
 */
export function assessMeasuredBuild(measurement: TowerBuildMeasurement | null | undefined) {
  if (!measurement) return null;
  const cases = BUILD_REFERENCE_CASES.map((reference, index) => {
    const result = measurement.evidence[index];
    const candidates = ['tempo', 'survival', 'engine'].flatMap(policy => {
      const rows = result?.trials.filter(row => row.policy === policy) || [];
      if (!rows.length || !(measurement.maxHp > 0) || new Set(rows.map(row => row.seed)).size !== rows.length || !rows.every(row => result?.seeds.includes(row.seed)) || rows.length !== result?.seeds.length || rows.some(row => !['victory', 'defeat', 'horizon'].includes(row.outcome)
        || ![row.damageDealt, row.enemyHpRemaining, row.hpRemaining, row.cardsPlayed, row.turns, row.deadTurns, row.lustDealt ?? 0].every(Number.isFinite))) return [];
      const score = (row: EncounterTrial) => {
        if (row.outcome === 'victory') return 100;
        // Desire only contributes through its executed payoff. Repeated lust,
        // healing loops and overkill are not additional enemy-clearing progress.
        const progress = clamp(1 - row.enemyHpRemaining / reference.hp);
        const health = row.outcome === 'defeat' ? 0 : clamp(row.hpRemaining / measurement.maxHp);
        const value = 100 * (0.65 * progress + 0.35 * health);
        return row.outcome === 'defeat' ? Math.min(25, value) : value;
      };
      const scores = rows.map(score);
      return [{ policy, rows, score: round(evaluationMedian(scores)), floor: round(Math.min(...scores)) }];
    }).sort((a, b) => b.score - a.score || b.floor - a.floor || a.policy.localeCompare(b.policy));
    const best = candidates[0];
    const caseMedian = (get: (row: EncounterTrial) => number) => best ? round(evaluationMedian(best.rows.map(get))) : null;
    const medianOutput = caseMedian(row => row.damageDealt);
    const medianHpRemaining = caseMedian(row => row.outcome === 'defeat' ? 0 : row.hpRemaining);
    return { id: reference.id, label: reference.label, best, candidates, turns: reference.turns,
      detail: best ? `${policyName[best.policy]}打法 · 试打${best.rows.length}次，获胜${best.rows.filter(row => row.outcome === 'victory').length}次 · 表现达成度${best.score}%（最低${best.floor}%） · 中位输出${medianOutput} · 中位剩余生命${medianHpRemaining}。达成度、输出、剩余生命分别按各自样本取中位数，不把分量中位数相加。` : '本场景未完成，保留为未知，不计作零分' };
  });
  const complete = cases.filter(value => value.best);
  const rows = complete.flatMap(value => value.best!.rows);
  const total = complete.length === cases.length ? round(evaluationMedian(complete.map(value => value.best!.score))) : null;
  const median = (get: (row: EncounterTrial) => number) => rows.length ? round(evaluationMedian(rows.map(get))) : null;
  const weak = [...complete].sort((a, b) => a.best!.score - b.best!.score)[0];
  const strong = [...complete].sort((a, b) => b.best!.score - a.best!.score)[0];
  const dimensions: Record<string, string> = {
    burst: `首回合伤害 ${median(row => row.horizons.find(h => h.turn === 1)?.damage ?? 0) ?? '—'}`,
    sustainedOutput: `每回合伤害 ${median(row => row.damageDealt / Math.max(1, row.turns)) ?? '—'}`,
    survival: `剩余生命 ${median(row => row.outcome === 'defeat' ? 0 : clamp(row.hpRemaining / measurement.maxHp) * 100) ?? '—'}%`,
    economy: `每回合出牌 ${median(row => row.cardsPlayed / Math.max(1, row.turns)) ?? '—'}`,
    consistency: `有效行动回合 ${median(row => 100 * (1 - row.deadTurns / Math.max(1, row.turns))) ?? '—'}%`,
    scaling: `实测场景 ${complete.length}/${cases.length}`,
    control: `累计欲望输出 ${median(row => row.lustDealt || 0) ?? '—'}`,
    combo: `测试获胜 ${rows.filter(row => row.outcome === 'victory').length}/${rows.length}`,
    flexibility: `薄弱场景表现达成度 ${weak?.best?.score ?? '—'}%`,
  };
  const statusIds = [...new Set(rows.flatMap(row => row.statusUptime?.map(status => status.id) || []))];
  const activation = statusIds.map(id => {
    const observed = rows.flatMap(row => row.statusUptime?.filter(status => status.id === id) || []);
    return `${observed[0].name}：${observed.length}/${rows.length}个样本在行动结束时持有，平均覆盖${round(observed.reduce((sum, status) => sum + status.turns, 0) / rows.length)}回合`;
  });
  const sortedScores = complete.map(value => value.best!.score).sort((a, b) => a - b);
  const middle = Math.floor(sortedScores.length / 2);
  const scoreExplanation = total === null ? '' : sortedScores.length % 2
    ? `本次总表现${total}%：把${sortedScores.length}类对手的结果从低到高排列，取正中间的${sortedScores[middle]}%。`
    : `本次总表现${total}%：把${sortedScores.length}类对手的结果从低到高排列，取中间两项${sortedScores[middle - 1]}%和${sortedScores[middle]}%的平均值。`;
  const recommendations = [
    ...(scoreExplanation ? [scoreExplanation] : []),
    ...(strong ? [`擅长应对：${strong.label}（表现达成度${strong.best!.score}%）。`] : []),
    ...(weak ? [`优先改善：${weak.label}（表现达成度${weak.best!.score}%）。${weak.best!.rows.some(row => row.outcome === 'defeat') ? '尝试增加防护，或更早打出关键卡，减少展开时受到的伤害。' : weak.best!.rows.every(row => row.outcome === 'victory') ? '本次测试均已获胜，可以继续尝试不同敌人与抽牌顺序。' : '未能在限定回合内稳定击败敌人，可以增加有效输出、过牌或加快关键配合。'}`] : []),
    '这是固定对手试打的表现达成度（百分比）；越高表示这些测试中的清敌进度与保命表现越接近本测试目标。它不是胜率，也不是敌人难度使用的强度预算。',
    '清敌进度按敌方实际剩余生命计算；欲望通过满溢后的伤害、控制或恢复产生收益，不直接折成清敌进度。',
    '自动试打不一定能发挥复杂连招的全部实力，分数供构筑参考，不代表你的操作上限。',
  ];
  const scenarioBreakdown = [...complete]
    .sort((a, b) => b.best!.score - a.best!.score || a.label.localeCompare(b.label))
    .map(value => {
      const selected = value.best!;
      const output = round(evaluationMedian(selected.rows.map(row => row.damageDealt)));
      const hp = round(evaluationMedian(selected.rows.map(row => row.outcome === 'defeat' ? 0 : row.hpRemaining)));
      return `${value.label}：${selected.score}%（中位输出${output}，中位剩余生命${hp}）`;
    });
  const methodology = [
    ...(activation.length ? ['状态展开实测：' + activation.join('；') + '。按行动结束时采样，不包含回合内短暂持有。'] : []),
    ...(scenarioBreakdown.length ? [`本次场景对账（按达成度从高到低）：${scenarioBreakdown.join('；')}。总分${total ?? '—'}%是这些场景达成度的中位数，不是把各场景或输出、生命等分量相加。`] : []),
    '百分比来自实际试打：胜利记为100%；未结束样本按65%清敌进度与35%剩余生命计算；战败样本最高25%。每类对手先选实际样本整体表现最好的打法，再取各类对手达成度的中位数。案例中的中位输出和中位剩余生命只用于核对记录，不单独解释分数高低；原因只引用试打记录中的输出、失血、剩余生命、有效行动与胜负，不推断未测得的归因。',
  ];
  return { spec: 'mwg.measured-build-assessment/v2', score: total, cases, dimensions, recommendations, methodology, completed: complete.length };
}
