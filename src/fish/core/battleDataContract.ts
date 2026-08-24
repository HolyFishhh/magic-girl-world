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
  for (const field of ['hp', 'max_hp', 'lust', 'max_lust'] as const) {
    if (!isFiniteNumber(core[field])) {
      return failure('INVALID_TYPE', `battle.core.${field}`, '必须是有限数');
    }
  }

  const enemy = data.enemy;
  if (!isRecord(enemy)) return failure('INVALID_TYPE', 'battle.enemy', '必须是对象');
  if (typeof enemy.name !== 'string' || enemy.name.trim() === '') {
    return failure('MISSING_VALUE', 'battle.enemy.name', '名称不能为空');
  }
  for (const field of ['hp', 'max_hp', 'lust', 'max_lust'] as const) {
    if (!isFiniteNumber(enemy[field])) {
      return failure('INVALID_TYPE', `battle.enemy.${field}`, '必须是有限数');
    }
  }
  if (!Array.isArray(data.cards)) return failure('INVALID_TYPE', 'battle.cards', '必须是数组');

  return { ok: true, result: { data, source } };
}

export function isBattleDataContract(value: unknown): value is Record<string, any> {
  return readBattleDataContract({ stat_data: { battle: value } }) !== null;
}
