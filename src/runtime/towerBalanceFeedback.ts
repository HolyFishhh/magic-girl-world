type Battle = Record<string, unknown>;

const ENEMY_CONTAINERS = ['enemy', 'enemies'] as const;
const EXECUTABLE_ENEMY_FIELDS = new Set([
  'actions', 'abilities', 'status_effects', 'statusEffects', 'resources',
  'action_config', 'actionConfig', 'action_mode', 'actionMode',
  'lust_effect', 'lustEffect', 'modifiers', 'intent', 'nextAction',
  'stance', 'orbs', 'summons', 'escape_when', 'escapeCondition',
]);
const ADJUSTABLE_ENEMY_NUMBER_FIELDS = new Set([
  'hp', 'max_hp', 'lust', 'max_lust', 'block', 'energy', 'max_energy',
  'currentHp', 'maxHp', 'currentLust', 'maxLust', 'maxEnergy',
  'action_priority', 'actionPriority', 'speed',
]);

function isRecord(value: unknown): value is Battle {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Battle, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class TowerBalanceFeedbackPreservationError extends Error {
  public readonly name = 'TowerBalanceFeedbackPreservationError';

  public constructor(public readonly path: string, detail: string) {
    super(`AI 平衡反馈不得修改 ${path}：${detail}`);
  }
}

function fail(path: string, detail: string): never {
  throw new TowerBalanceFeedbackPreservationError(path, detail);
}

function assertStructuralEqual(original: unknown, candidate: unknown, path: string): void {
  if (Object.is(original, candidate)) return;
  if (Array.isArray(original) || Array.isArray(candidate)) {
    if (!Array.isArray(original) || !Array.isArray(candidate) || original.length !== candidate.length) {
      fail(path, '结构或数量发生变化');
    }
    for (let index = 0; index < original.length; index += 1) {
      assertStructuralEqual(original[index], candidate[index], `${path}[${index}]`);
    }
    return;
  }
  if (isRecord(original) || isRecord(candidate)) {
    if (!isRecord(original) || !isRecord(candidate)) fail(path, '结构发生变化');
    const originalKeys = Object.keys(original).sort();
    const candidateKeys = Object.keys(candidate).sort();
    if (originalKeys.length !== candidateKeys.length || originalKeys.some((key, index) => key !== candidateKeys[index])) {
      fail(path, '字段集合发生变化');
    }
    for (const key of originalKeys) assertStructuralEqual(original[key], candidate[key], `${path}.${key}`);
    return;
  }
  fail(path, '值发生变化');
}

function assertEnemyPreserved(original: unknown, candidate: unknown, path: string): void {
  if (!isRecord(original) || !isRecord(candidate)) fail(path, '敌人必须保持对象结构');
  const originalKeys = Object.keys(original).filter(key => !EXECUTABLE_ENEMY_FIELDS.has(key)).sort();
  const candidateKeys = Object.keys(candidate).filter(key => !EXECUTABLE_ENEMY_FIELDS.has(key)).sort();
  if (originalKeys.length !== candidateKeys.length || originalKeys.some((key, index) => key !== candidateKeys[index])) {
    fail(path, '敌人非机制字段集合发生变化');
  }
  // Check stable identity first so an order swap reports the stable id rather
  // than whichever story field happens to sort first.
  for (const key of ['id', 'name', 'emoji', 'description']) {
    if (hasOwn(original, key)) assertStructuralEqual(original[key], candidate[key], `${path}.${key}`);
  }
  for (const key of originalKeys) {
    const fieldPath = `${path}.${key}`;
    if (key === 'defeat_reward' || key === 'defeatReward') {
      assertStructuralEqual(original[key], candidate[key], fieldPath);
      continue;
    }
    if (ADJUSTABLE_ENEMY_NUMBER_FIELDS.has(key)
      && typeof original[key] === 'number' && typeof candidate[key] === 'number') continue;
    assertStructuralEqual(original[key], candidate[key], fieldPath);
  }
}

function assertEnemyContainerPreserved(
  original: Battle,
  candidate: Battle,
  key: typeof ENEMY_CONTAINERS[number],
): void {
  const path = `battle.${key}`;
  if (hasOwn(original, key) !== hasOwn(candidate, key)) fail(path, '敌人容器不能新增、删除或改名');
  if (!hasOwn(original, key)) return;
  const before = original[key];
  const after = candidate[key];
  if (key === 'enemies') {
    if (!Array.isArray(before) || !Array.isArray(after)) fail(path, '敌人列表必须保留数组结构');
    if (before.length !== after.length) fail(path, '敌人数量发生变化');
    for (let index = 0; index < before.length; index += 1) {
      assertEnemyPreserved(before[index], after[index], `${path}[${index}]`);
    }
    return;
  }
  if (before === null || after === null) {
    if (before !== after) fail(path, '敌人是否存在发生变化');
    return;
  }
  assertEnemyPreserved(before, after, path);
}

/**
 * Reject a balance-feedback candidate that rewrites encounter identity, loot,
 * player/shared battle data, or the enemy roster. This is pure and never
 * mutates either input.
 */
export function assertTowerBalanceFeedbackPreservation(
  originalBattle: unknown,
  candidateBattle: unknown,
): void {
  if (!isRecord(originalBattle)) fail('battle', '原 battle 必须是对象');
  if (!isRecord(candidateBattle)) fail('battle', '反馈 battle 必须是对象');

  const originalKeys = Object.keys(originalBattle).sort();
  const candidateKeys = Object.keys(candidateBattle).sort();
  if (originalKeys.length !== candidateKeys.length || originalKeys.some((key, index) => key !== candidateKeys[index])) {
    fail('battle', '顶层字段集合发生变化');
  }
  for (const key of originalKeys) {
    if ((ENEMY_CONTAINERS as readonly string[]).includes(key)) continue;
    assertStructuralEqual(originalBattle[key], candidateBattle[key], `battle.${key}`);
  }
  for (const key of ENEMY_CONTAINERS) assertEnemyContainerPreserved(originalBattle, candidateBattle, key);
}
