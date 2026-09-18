import { roundBattleValue } from './battleMath';

/** modifySummonEffectPrograms rewrites current programs; it installs no expiry. */
export const SUMMON_EFFECT_REWRITE_LIFETIME = '改写现有行动与能力，攻击后或回合结束不会自动恢复；固定效果除外';

export interface SummonSlotLifecycleDescriptionInput {
  slot?: string;
  hasHp?: boolean;
  maxHp?: number;
  onExisting?: string;
  onDefeated?: string;
  customRepeat?: boolean;
}

/** Program rules only: shared by compact authoring and compiled effect tags. */
export function describeSummonSlotLifecycle(input: SummonSlotLifecycleDescriptionInput): string {
  if (!input.slot) return '';
  const hp = typeof input.maxHp === 'number' && Number.isFinite(input.maxHp)
    ? String(roundBattleValue(input.maxHp)) : '本次召唤的基础生命值';
  const living = input.hasHp !== false;
  const existing: Record<string, string> = {
    reinforce: living
      ? `再次召唤：当前生命和生命上限各增加${hp}`
      : '重复召唤不改变现有无生命单位',
    replace: '再次召唤时替换现有单位',
  };
  const defeated: Record<string, string> = {
    new_instance: '倒下后再次召唤新单位',
    revive_reset: `倒下后再次召唤：复活至${hp}/${hp}`,
    revive_reinforce: `倒下后再次召唤：原生命上限增加${hp}，满生命复活`,
  };
  return [
    '同一召唤者的唯一召唤物',
    input.customRepeat ? '再次召唤：触发下方追加效果' : existing[input.onExisting || 'reinforce'] || '现有单位处理规则未识别',
    living ? defeated[input.onDefeated || 'new_instance'] || '倒下后处理规则未识别'
      : '无生命单位不会倒下',
  ].join('；');
}
