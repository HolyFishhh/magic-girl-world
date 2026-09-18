export interface EnemyActionLike {
  id?: string;
  name: string;
  effectProgram?: unknown;
  description?: string;
  weight?: number;
  [key: string]: any;
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
 * New generated actions carry a stable machine-readable `id`, while older
 * character cards stored their visible Chinese `name` in action_config.  Both
 * are unambiguous references to the same action, so normalize the generated
 * id spelling back to the runtime's canonical name before validation and
 * selection.  Duplicate ids are deliberately not resolved: a config that
 * points at an ambiguous id must still fail the executable-content gate.
 */
function enemyActionReferenceMap(actions: readonly EnemyActionLike[]): ReadonlyMap<string, string> {
  const references = new Map<string, string>();
  const idCounts = new Map<string, number>();
  for (const action of actions) {
    const id = typeof action.id === 'string' ? action.id.trim() : '';
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  for (const action of actions) {
    references.set(action.name, action.name);
    const id = typeof action.id === 'string' ? action.id.trim() : '';
    if (id && idCounts.get(id) === 1) references.set(id, action.name);
  }
  return references;
}

function normalizeActionProbability(
  value: Record<string, any> | null,
  references: ReadonlyMap<string, string>,
  actionNames: readonly string[],
): Record<string, any> | null {
  if (!value) return null;
  const result: Record<string, any> = {};
  for (const [reference, weight] of Object.entries(value)) {
    result[references.get(reference) || reference] = weight;
  }
  const unknown = Object.keys(result).filter(reference => !actionNames.includes(reference));
  const missing = actionNames.filter(name => !Object.prototype.hasOwnProperty.call(result, name));
  // When the configured key set and the action list differ by exactly one
  // entry, there is only one possible bijection. This covers a truncated id,
  // a near-typo, or an accidentally copied owner id without fuzzy matching.
  // Any case with two possible destinations remains untouched and fails the
  // normal executable-content validation.
  if (unknown.length === 1 && missing.length === 1) {
    result[missing[0]] = result[unknown[0]];
    delete result[unknown[0]];
  }
  return result;
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
  const references = enemyActionReferenceMap(actions);
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
  const probability = normalizeActionProbability(configuredProbability, references, names) || derivedProbability;
  const sequence = Array.isArray(sourceConfig.sequence) && sourceConfig.sequence.length > 0
    ? sourceConfig.sequence.map((reference: unknown) => typeof reference === 'string'
      ? references.get(reference) || reference
      : reference)
    : names;

  if (actionMode === 'probability') return { actionMode, actionConfig: { probability } };
  if (actionMode === 'sequence') return { actionMode, actionConfig: { sequence } };
  return { actionMode, actionConfig: { sequence, probability } };
}

