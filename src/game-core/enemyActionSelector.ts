export interface EnemyActionLike {
  name: string;
  effectProgram?: unknown;
  description?: string;
  weight?: number;
  [key: string]: any;
}

export interface EnemyActionSelectionState {
  sequenceIndex: number;
  sequenceDoneOnce: boolean;
}

export interface EnemyActionSelectionResult {
  action: EnemyActionLike | null;
  state: EnemyActionSelectionState;
  mode: string;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pickRandom<T>(values: T[], random: () => number): T | null {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(random() * values.length)));
  return values[index];
}

function pickByProbability(
  actions: EnemyActionLike[],
  weights: unknown,
  random: () => number,
): EnemyActionLike | null {
  if (!isRecord(weights)) return null;
  const byName = new Map(actions.map(action => [action.name, action]));
  const entries = Object.entries(weights).filter(
    ([name, weight]) => byName.has(name) && typeof weight === 'number' && Number.isFinite(weight) && weight > 0,
  );
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  let cursor = random() * total;
  for (const [name, weight] of entries) {
    cursor -= Number(weight);
    if (cursor <= 0) return byName.get(name) || null;
  }
  return byName.get(entries[entries.length - 1][0]) || null;
}

/** Select one action without mutating the enemy object or reading a global random source. */
export function selectEnemyAction(enemy: any, random: () => number): EnemyActionSelectionResult {
  const actions: EnemyActionLike[] = Array.isArray(enemy?.actions)
    ? (enemy.actions as unknown[]).filter(
        (action: unknown): action is EnemyActionLike => isRecord(action) && typeof action.name === 'string',
      )
    : [];
  const mode = String(enemy?.actionMode || 'random');
  const config = enemy?.actionConfig || {};
  const modeConfig = isRecord(config) && isRecord(config[mode]) ? config[mode] : config;
  const state: EnemyActionSelectionState = {
    sequenceIndex: Number.isInteger(enemy?._sequenceIndex) ? Math.max(0, enemy._sequenceIndex) : 0,
    sequenceDoneOnce: enemy?._sequenceDoneOnce === true,
  };

  if (actions.length === 0) return { action: null, state, mode };

  const byName = new Map<string, EnemyActionLike>(actions.map(action => [action.name, action]));
  const sequence = isRecord(modeConfig) && Array.isArray(modeConfig.sequence) ? modeConfig.sequence : [];
  const probability = isRecord(modeConfig) && isRecord(modeConfig.probability) ? modeConfig.probability : modeConfig;
  let action: EnemyActionLike | null = null;

  if (mode === 'probability') {
    action = pickByProbability(actions, probability, random);
  } else if (mode === 'sequence') {
    if (sequence.length > 0) {
      const sequenceIndex = state.sequenceIndex % sequence.length;
      action = byName.get(String(sequence[sequenceIndex])) || null;
      state.sequenceIndex = (sequenceIndex + 1) % sequence.length;
    }
  } else if (mode === 'sequence_then_probability') {
    if (!state.sequenceDoneOnce && state.sequenceIndex < sequence.length) {
      action = byName.get(String(sequence[state.sequenceIndex])) || null;
      state.sequenceIndex += 1;
      state.sequenceDoneOnce = state.sequenceIndex >= sequence.length;
    }
    if (!action && state.sequenceDoneOnce) {
      action = pickByProbability(actions, probability, random);
    }
  }

  return { action: action || pickRandom(actions, random), state, mode };
}
