/** Holder-local declarative defenses; no status id is special-cased at runtime. */
export interface StatusDefenseRule { negate_debuff?: true; damage_cap?: number; prevent_hp_loss?: true; retaliate_attack?: number | 'stacks'; }
export function normalizeStatusDefenseRule(value: unknown): StatusDefenseRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['negate_debuff', 'damage_cap', 'prevent_hp_loss', 'retaliate_attack'].includes(key))) return null;
  if (raw.negate_debuff !== undefined && raw.negate_debuff !== true) return null;
  if (raw.prevent_hp_loss !== undefined && raw.prevent_hp_loss !== true) return null;
  if (raw.damage_cap !== undefined && (typeof raw.damage_cap !== 'number' || !Number.isFinite(raw.damage_cap) || raw.damage_cap < 0)) return null;
  if (raw.retaliate_attack !== undefined && (raw.retaliate_attack !== 'stacks' && (typeof raw.retaliate_attack !== 'number' || !Number.isFinite(raw.retaliate_attack) || raw.retaliate_attack < 0))) return null;
  if (raw.negate_debuff !== true && raw.prevent_hp_loss !== true && raw.damage_cap === undefined && raw.retaliate_attack === undefined) return null;
  return { ...(raw.negate_debuff === true ? { negate_debuff: true } : {}), ...(raw.damage_cap === undefined ? {} : { damage_cap: raw.damage_cap as number }), ...(raw.prevent_hp_loss === true ? { prevent_hp_loss: true } : {}), ...(raw.retaliate_attack === undefined ? {} : { retaliate_attack: raw.retaliate_attack as number | 'stacks' }) };
}
export function statusDefenseRuleDescription(rule: StatusDefenseRule): string[] {
  return [
    ...(rule.negate_debuff ? ['每层抵消一次将要赋予或叠加的负面状态，抵消时不执行其赋予或叠加效果'] : []),
    ...(rule.damage_cap === undefined ? [] : [`每个伤害或生命流失包在格挡前最多造成${rule.damage_cap}点伤害`]),
    ...(rule.prevent_hp_loss ? ['每层抵消一次格挡后仍会失去生命的伤害或生命流失包；格挡完全挡住时不消耗'] : []),
    ...(rule.retaliate_attack === undefined ? [] : [`受到攻击伤害包时反击${rule.retaliate_attack === 'stacks' ? '自身层数' : rule.retaliate_attack}点伤害，目标为本次攻击者；完全格挡仍触发，反伤不会引发反伤`]),
  ];
}

/** One field table for generation and bounded value-slot repair. */
export const STATUS_DEFENSE_SCHEMA = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    negate_debuff: { const: true },
    damage_cap: { type: 'number', minimum: 0 },
    prevent_hp_loss: { const: true },
    retaliate_attack: { anyOf: [{ type: 'number', minimum: 0 }, { const: 'stacks' }] },
  },
};
