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

export const CANONICAL_ENEMY_ACTION_MODES = new Set([
  'random',
  'probability',
  'sequence',
  'sequence_then_probability',
]);

const ENEMY_ACTION_MODE_ALIASES: Readonly<Record<string, string>> = {
  weighted: 'probability',
  random_weighted: 'probability',
  sequence_loop: 'sequence',
  sequential: 'sequence',
  round_robin: 'sequence',
};

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Canonicalize common model-authored aliases and fill mechanically obvious
 * action configuration from the action list. This keeps generated enemies
 * executable without changing their authored actions or weights.
 */
export function normalizeEnemyActionSelectionInput(enemy: any): {
  actionMode: string;
  actionConfig: Record<string, any>;
} {
  const actions: EnemyActionLike[] = Array.isArray(enemy?.actions)
    ? enemy.actions.filter((action: unknown): action is EnemyActionLike =>
        isRecord(action) && typeof action.name === 'string' && action.name.trim().length > 0,
      )
    : [];
  const rawMode = String(enemy?.actionMode ?? enemy?.action_mode ?? 'random').trim() || 'random';
  const actionMode = ENEMY_ACTION_MODE_ALIASES[rawMode] || rawMode;
  const sourceConfig = isRecord(enemy?.actionConfig)
    ? enemy.actionConfig
    : isRecord(enemy?.action_config)
      ? enemy.action_config
      : {};
  if (!CANONICAL_ENEMY_ACTION_MODES.has(actionMode) || actionMode === 'random') {
    return { actionMode, actionConfig: actionMode === 'random' ? {} : sourceConfig };
  }

  const names = actions.map(action => action.name);
  const derivedProbability = Object.fromEntries(
    actions.map(action => [
      action.name,
      typeof action.weight === 'number' && Number.isFinite(action.weight) && action.weight > 0 ? action.weight : 1,
    ]),
  );
  const configuredProbability = isRecord(sourceConfig.probability)
    ? sourceConfig.probability
    : Object.keys(sourceConfig).some(key => typeof sourceConfig[key] === 'number')
      ? sourceConfig
      : null;
  const probability = configuredProbability || derivedProbability;
  const sequence = Array.isArray(sourceConfig.sequence) && sourceConfig.sequence.length > 0
    ? sourceConfig.sequence
    : names;

  if (actionMode === 'probability') return { actionMode, actionConfig: { probability } };
  if (actionMode === 'sequence') return { actionMode, actionConfig: { sequence } };
  return { actionMode, actionConfig: { sequence, probability } };
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
  const normalized = normalizeEnemyActionSelectionInput(enemy);
  const mode = normalized.actionMode;
  const config = normalized.actionConfig;
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
