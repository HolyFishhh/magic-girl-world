import { evaluationMedian, type EncounterEvaluation } from './encounterEvaluation';
/** Versioned, fixed opponents: player HP upgrades must not secretly strengthen the benchmark. */
export const BUILD_CALIBRATION_SPEC = 'mwg.build-calibration/v1' as const;
export const BUILD_REFERENCE_CASES = [
  { id: 'single', label: '单体持续压力', count: 1, turns: 5, damage: 12, hp: 400, burst: false },
  { id: 'group', label: '三敌持续压力', count: 3, turns: 5, damage: 12, hp: 400, burst: false },
  { id: 'swarm', label: '五敌多段压力', count: 5, turns: 5, damage: 12, hp: 400, burst: false },
  { id: 'burst', label: '单体周期爆发', count: 1, turns: 6, damage: 36, hp: 400, burst: true },
  { id: 'endurance', label: '十回合续航', count: 1, turns: 10, damage: 12, hp: 800, burst: false },
  { id: 'duel', label: '标准遭遇', count: 1, turns: 6, damage: 10, hp: 90, burst: false },
  { id: 'desire', label: '欲望压力', count: 1, turns: 6, damage: 6, hp: 120, burst: false, lust: 18 },
  { id: 'weakness', label: '虚弱干扰', count: 1, turns: 6, damage: 10, hp: 120, burst: false, weakness: true },
] as const;
export interface BuildCalibrationCase {
  id: string; label: string; turns: number; enemyHp: number; pressure: string;
  policies: { policy: string; samples: number; survival: number | null; survivalFloor: number | null; offense: number | null }[];
}
/** Actual final player health incorporates interception, mitigation, control, healing and kill prevention.
 * Summon pool size is not added to HP: non-intercepting or unused HP earns no imaginary protection.
 * These are scenario outcomes, not a universal power rating or win probability. */
export function calibrateBuildCase(reference: typeof BUILD_REFERENCE_CASES[number], result: EncounterEvaluation, maxHp: number): BuildCalibrationCase {
  const clamp = (n: number) => Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
  return { id: reference.id, label: reference.label, turns: reference.turns, enemyHp: reference.hp,
    pressure: reference.burst ? '第1/4回合各36伤害，其余回合等待' : `每回合合计${reference.damage}伤害${'lust' in reference ? `、${reference.lust}欲望` : ''}${'weakness' in reference ? '，附加一回合伤害减半' : ''}`,
    policies: ['tempo', 'survival', 'engine'].map(policy => {
      const rows = result.trials.filter(row => row.policy === policy);
      const valid = rows.length > 0 && rows.every(row => ['victory', 'defeat', 'horizon'].includes(row.outcome)
        && Number.isFinite(row.hpRemaining) && Number.isFinite(row.damageDealt)) && Number.isFinite(maxHp) && maxHp > 0;
      const health = rows.map(row => row.outcome === 'defeat' ? 0 : clamp(row.hpRemaining / maxHp * 100));
      return { policy, samples: rows.length, survival: valid ? evaluationMedian(health) : null,
        survivalFloor: valid ? Math.min(...health) : null,
        offense: valid ? evaluationMedian(rows.map(row => row.outcome === 'victory' ? 100 : clamp(row.damageDealt / reference.hp * 100))) : null };
    }) };
}
