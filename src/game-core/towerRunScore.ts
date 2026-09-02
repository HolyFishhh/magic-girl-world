export const TOWER_SCORE_SCHEMA_VERSION = 1 as const;

export type TowerEncounterOutcome = 'victory' | 'defeat' | 'escaped';

export interface TowerEncounterScoreRecord {
  nodeId: string;
  act: number;
  floor: number;
  playerDeckScore: number;
  enemyScore: number;
  relativeDifficulty: number;
  outcome: TowerEncounterOutcome;
}

export interface TowerRunScore {
  schemaVersion: typeof TOWER_SCORE_SCHEMA_VERSION;
  encounters: TowerEncounterScoreRecord[];
  defeatedEnemyScore: number;
  averageDifficultyRatio: number;
  averageDifficultyPercent: number;
}

export interface RecordTowerEncounterInput {
  nodeId: string;
  act: number;
  floor: number;
  playerDeckScore: number;
  enemyScore: number;
  outcome: TowerEncounterOutcome;
}

const SCORE_PRECISION = 100;

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`);
  return Math.round(value * SCORE_PRECISION) / SCORE_PRECISION;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function roundScore(value: number): number {
  return Math.round(value * SCORE_PRECISION) / SCORE_PRECISION;
}

function summarize(encounters: readonly TowerEncounterScoreRecord[]): Omit<TowerRunScore, 'schemaVersion' | 'encounters'> {
  const victories = encounters.filter(encounter => encounter.outcome === 'victory');
  const defeatedEnemyScore = roundScore(victories.reduce((total, encounter) => total + encounter.enemyScore, 0));
  const averageDifficultyRatio = victories.length > 0
    ? roundScore(victories.reduce((total, encounter) => total + encounter.relativeDifficulty, 0) / victories.length)
    : 0;
  return {
    defeatedEnemyScore,
    averageDifficultyRatio,
    averageDifficultyPercent: roundScore(averageDifficultyRatio * 100),
  };
}

export function createTowerRunScore(): TowerRunScore {
  return {
    schemaVersion: TOWER_SCORE_SCHEMA_VERSION,
    encounters: [],
    defeatedEnemyScore: 0,
    averageDifficultyRatio: 0,
    averageDifficultyPercent: 0,
  };
}

/**
 * Store the immutable pre-battle player/enemy score snapshot used by the final
 * two-axis result. Current HP deliberately does not belong to this contract.
 */
export function recordTowerEncounter(
  current: TowerRunScore,
  input: RecordTowerEncounterInput,
): TowerRunScore {
  if (current.schemaVersion !== TOWER_SCORE_SCHEMA_VERSION) throw new Error('unsupported tower score schema');
  const nodeId = input.nodeId.trim();
  if (!nodeId || nodeId.length > 128) throw new Error('tower encounter nodeId is invalid');
  if (current.encounters.some(encounter => encounter.nodeId === nodeId)) {
    throw new Error(`tower encounter already recorded: ${nodeId}`);
  }
  const playerDeckScore = finiteNonNegative(input.playerDeckScore, 'playerDeckScore');
  if (playerDeckScore <= 0) throw new Error('playerDeckScore must be greater than zero');
  const enemyScore = finiteNonNegative(input.enemyScore, 'enemyScore');
  const encounter: TowerEncounterScoreRecord = {
    nodeId,
    act: positiveInteger(input.act, 'act'),
    floor: positiveInteger(input.floor, 'floor'),
    playerDeckScore,
    enemyScore,
    relativeDifficulty: roundScore(enemyScore / playerDeckScore),
    outcome: input.outcome,
  };
  const encounters = [...current.encounters, encounter];
  return {
    schemaVersion: TOWER_SCORE_SCHEMA_VERSION,
    encounters,
    ...summarize(encounters),
  };
}

export function validateTowerRunScore(value: unknown): value is TowerRunScore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const score = value as Partial<TowerRunScore>;
  if (score.schemaVersion !== TOWER_SCORE_SCHEMA_VERSION || !Array.isArray(score.encounters)) return false;
  const nodeIds = new Set<string>();
  for (const encounter of score.encounters) {
    if (!encounter || typeof encounter !== 'object') return false;
    if (typeof encounter.nodeId !== 'string' || !encounter.nodeId || nodeIds.has(encounter.nodeId)) return false;
    nodeIds.add(encounter.nodeId);
    if (!Number.isInteger(encounter.act) || encounter.act < 1) return false;
    if (!Number.isInteger(encounter.floor) || encounter.floor < 1) return false;
    if (!Number.isFinite(encounter.playerDeckScore) || encounter.playerDeckScore <= 0) return false;
    if (!Number.isFinite(encounter.enemyScore) || encounter.enemyScore < 0) return false;
    if (!Number.isFinite(encounter.relativeDifficulty) || encounter.relativeDifficulty < 0) return false;
    if (!['victory', 'defeat', 'escaped'].includes(encounter.outcome)) return false;
  }
  const expected = summarize(score.encounters);
  return score.defeatedEnemyScore === expected.defeatedEnemyScore
    && score.averageDifficultyRatio === expected.averageDifficultyRatio
    && score.averageDifficultyPercent === expected.averageDifficultyPercent;
}
