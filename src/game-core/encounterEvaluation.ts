/** Public evidence from the production battle engine, not a second effect interpreter. */
export const ENCOUNTER_EVALUATION_SPEC = 'mwg.encounter-evaluation/v2' as const;
export type EncounterPolicy = 'tempo' | 'survival' | 'engine';
export interface EncounterTrial {
  seed: number;
  policy: EncounterPolicy;
  outcome: 'victory' | 'defeat' | 'terminated' | 'horizon' | 'inconclusive';
  turns: number;
  hpRemaining: number;
  lustRemaining: number;
  netLustGained: number;
  conditionLoss: number;
  netHpLost: number;
  hpLost: number;
  damageDealt: number;
  /** Actual remaining enemy HP, including reinforcements; not cumulative damage. */
  enemyHpRemaining: number;
  lustDealt?: number;
  /** Observed at the end of each player action phase, before turn-end expiry. */
  statusUptime?: { id: string; name: string; turns: number }[];
  blocked: number;
  /** Actual intercepted damage suffered by allied summons, not equivalent player damage prevented. */
  summonHpLost?: number;
  summonBlocked?: number;
  summonHpRemaining?: number;
  cardsPlayed: number;
  deadTurns: number;
  decisions: number;
  defensiveChoices: number;
  killOrder: string[];
  horizons: { turn: number; damage: number; hpLost: number; blocked: number; hpRemaining?: number; summonHpLost?: number; summonBlocked?: number; summonHpRemaining?: number }[];
  limitations: string[];
  decisionCoverage: 'bounded' | 'limited';
}
export interface EncounterPolicySummary {
  policy: EncounterPolicy;
  completed: number;
  wins: number;
  winRate: number;
  winRateInterval: [number, number];
  medianTurns: number;
  medianHpLost: number;
  medianNetHpLost: number;
  medianNetLustGained: number;
  medianConditionLoss: number;
  firstTurnWins: number;
  deadTurnRate: number;
}
export interface EncounterEvaluation {
  spec: typeof ENCOUNTER_EVALUATION_SPEC;
  engine: 'production-battle-runtime';
  status: 'measured' | 'inconclusive';
  decisionCoverage: 'bounded' | 'limited';
  seeds: number[];
  policies: EncounterPolicySummary[];
  trials: EncounterTrial[];
  limitations: string[];
}
export function evaluationMedian(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function summarizeEncounterEvaluation(trials: EncounterTrial[], seeds: number[]): EncounterEvaluation {
  const policies = [...new Set(trials.map(trial => trial.policy))].map(policy => {
    const rows = trials.filter(trial => trial.policy === policy && trial.outcome !== 'inconclusive');
    const wins = rows.filter(trial => trial.outcome === 'victory').length;
    const n = rows.length, p = n ? wins / n : 0, z = 1.96;
    const center = n ? (p + z * z / (2 * n)) / (1 + z * z / n) : 0.5;
    const half = n ? z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n) : 0.5;
    return { policy, completed: n, wins, winRate: p,
      winRateInterval: [Math.max(0, center - half), Math.min(1, center + half)] as [number, number],
      medianTurns: evaluationMedian(rows.map(row => row.turns)),
      medianHpLost: evaluationMedian(rows.map(row => row.hpLost)),
      medianNetHpLost: evaluationMedian(rows.map(row => row.netHpLost)),
      medianNetLustGained: evaluationMedian(rows.map(row => row.netLustGained)),
      medianConditionLoss: evaluationMedian(rows.map(row => row.conditionLoss)),
      firstTurnWins: rows.filter(row => row.outcome === 'victory' && row.turns <= 1).length,
      deadTurnRate: rows.reduce((sum, row) => sum + row.deadTurns, 0) / Math.max(1, rows.reduce((sum, row) => sum + row.turns, 0)),
    };
  });
  return { spec: ENCOUNTER_EVALUATION_SPEC, engine: 'production-battle-runtime',
    status: trials.some(trial => trial.outcome === 'inconclusive' || trial.outcome === 'terminated') ? 'inconclusive' : 'measured',
    decisionCoverage: trials.some(trial => trial.decisionCoverage === 'limited') ? 'limited' : 'bounded',
    seeds, policies, trials, limitations: [...new Set(trials.flatMap(trial => trial.limitations))],
  };
}
