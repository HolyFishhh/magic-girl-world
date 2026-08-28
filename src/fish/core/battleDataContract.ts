export interface BattleDataContractResult {
  data: Record<string, any>;
  source: 'stat_data.battle';
}

export interface BattleDataContractIssue {
  code: 'INVALID_VARIABLES' | 'MISSING_BATTLE' | 'INVALID_TYPE' | 'MISSING_VALUE';
  path: string;
  message: string;
}

export type BattleDataContractInspection =
  | { ok: true; result: BattleDataContractResult }
  | { ok: false; issue: BattleDataContractIssue };

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasBattlePrecision(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

/**
 * Resolve and validate the canonical battle input accepted from MUV.
 */
export function readBattleDataContract(variables: unknown): BattleDataContractResult | null {
  const inspection = inspectBattleDataContract(variables);
  return inspection.ok ? inspection.result : null;
}

function failure(
  code: BattleDataContractIssue['code'],
  path: string,
  message: string,
): BattleDataContractInspection {
  return { ok: false, issue: { code, path, message } };
}

/** Inspect MUV battle input and retain a precise diagnostic for invalid shapes. */
export function inspectBattleDataContract(variables: unknown): BattleDataContractInspection {
  if (!isRecord(variables)) return failure('INVALID_VARIABLES', 'variables', '变量根必须是对象');

  const statData = variables.stat_data;
  const hasCanonicalBattle = isRecord(statData) && Object.prototype.hasOwnProperty.call(statData, 'battle');
  const statBattle = isRecord(statData) ? statData.battle : undefined;
  if (!hasCanonicalBattle) {
    return failure('MISSING_BATTLE', 'battle', '未找到战斗数据');
  }
  const source = 'stat_data.battle' as const;
  const data = statBattle;
  if (!isRecord(data)) return failure('INVALID_TYPE', 'battle', '必须是对象');

  const core = data.core;
  if (!isRecord(core)) return failure('INVALID_TYPE', 'battle.core', '必须是对象');
  if (typeof core.emoji !== 'string' || core.emoji.trim() === '') {
    return failure('MISSING_VALUE', 'battle.core.emoji', '必须设置玩家战斗形象');
  }
  for (const field of ['hp', 'max_hp', 'lust', 'max_lust'] as const) {
    if (!hasBattlePrecision(core[field])) {
      return failure('INVALID_TYPE', `battle.core.${field}`, '必须是最多两位小数的有限数值');
    }
  }

  const enemies = Array.isArray(data.enemies) && data.enemies.length > 0 ? data.enemies : [data.enemy];
  if (enemies.length === 0 || enemies.length > 12)
    return failure('INVALID_TYPE', 'battle.enemies', '必须包含 1 到 12 个敌人');
  const enemyIds = new Set<string>();
  for (let index = 0; index < enemies.length; index += 1) {
    const enemy = enemies[index];
    const path = Array.isArray(data.enemies) ? `battle.enemies[${index}]` : 'battle.enemy';
    if (!isRecord(enemy)) return failure('INVALID_TYPE', path, '必须是对象');
    if (typeof enemy.name !== 'string' || enemy.name.trim() === '') {
      return failure('MISSING_VALUE', `${path}.name`, '名称不能为空');
    }
    const id = typeof enemy.id === 'string' && enemy.id.trim() ? enemy.id.trim() : enemy.name.trim();
    if (enemyIds.has(id)) return failure('INVALID_TYPE', `${path}.id`, `敌人 ID 重复：${id}`);
    enemyIds.add(id);
    for (const field of ['hp', 'max_hp', 'lust', 'max_lust'] as const) {
      if (!hasBattlePrecision(enemy[field])) {
        return failure('INVALID_TYPE', `${path}.${field}`, '必须是最多两位小数的有限数值');
      }
    }
  }
  if (!Array.isArray(data.cards)) return failure('INVALID_TYPE', 'battle.cards', '必须是数组');

  return { ok: true, result: { data, source } };
}

export function isBattleDataContract(value: unknown): value is Record<string, any> {
  return readBattleDataContract({ stat_data: { battle: value } }) !== null;
}
