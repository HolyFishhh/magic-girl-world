import { validateContentPackContract, formatContentContractIssues } from '../game-core/contentContract';
import { createContentPackFromMvuBattle } from './contentPackAdapter';

type RecordValue = Record<string, any>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate on a detached battle; callers commit only with the victory transaction. */
export function applyDesireEffectGrowth(battle: RecordValue, growth: unknown): RecordValue {
  if (!record(growth) || !record(growth.effect) || !record(battle.player_lust_effect)) {
    throw new Error('欲望成长需要已有欲望效果与完整 effect');
  }
  if (Object.keys(growth).some(key => !['effect', 'statuses'].includes(key))) throw new Error('欲望成长包含未知字段');
  const effect = growth.effect;
  if (!String(effect.name || '').trim() || !(Array.isArray(effect.effects)
    ? effect.effects.length > 0 : record(effect.effects) && Object.keys(effect.effects).length > 0)) {
    throw new Error('欲望成长必须有名称与非空 effects');
  }
  const statuses = growth.statuses === undefined ? [] : growth.statuses;
  if (!Array.isArray(statuses) || statuses.some(value => !record(value) || !value.id)) throw new Error('欲望成长 statuses 必须为完整状态定义数组');
  const next = structuredClone(battle);
  const definitions: RecordValue[] = Array.isArray(next.statuses) ? next.statuses : record(next.statuses) ? Object.values(next.statuses) : [];
  for (const status of statuses) {
    const existing = definitions.find(value => value.id === status.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(status)) throw new Error(`欲望成长不能覆盖共享状态 ${status.id}`);
    if (!existing) definitions.push(structuredClone(status));
  }
  next.statuses = definitions;
  next.player_lust_effect = structuredClone(effect);
  const result = validateContentPackContract(createContentPackFromMvuBattle(next), { requireExecutable: true });
  if (!result.ok) throw new Error(`欲望成长不可执行：${formatContentContractIssues(result.issues, 8)}`);
  return next;
}
