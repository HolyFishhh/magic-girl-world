export type DamageProtectionMode = 'intercept' | 'share_damage';
export type DamageProtectionScope = 'specific' | 'all_allies';

/** Continuous protection granted by an ability or a status. Exact IDs never resolve through active-enemy aliases. */
export interface DamageProtectionRule {
  mode: DamageProtectionMode;
  scope: DamageProtectionScope;
  targetId?: string;
  priority?: number;
}

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function normalizeDamageProtectionRule(value: unknown): DamageProtectionRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['mode', 'scope', 'target_id', 'targetId', 'priority'].includes(key))) return null;
  const mode = raw.mode;
  const scope = raw.scope;
  const target = raw.target_id ?? raw.targetId;
  if ((mode !== 'intercept' && mode !== 'share_damage') || (scope !== 'specific' && scope !== 'all_allies')) return null;
  if (scope === 'specific' && (typeof target !== 'string' || !ID.test(target))) return null;
  if (scope === 'all_allies' && target !== undefined) return null;
  if (raw.priority !== undefined && (!Number.isInteger(raw.priority) || !Number.isFinite(raw.priority))) return null;
  return { mode, scope, ...(scope === 'specific' ? { targetId: target as string } : {}), ...(raw.priority === undefined ? {} : { priority: raw.priority as number }) };
}

export interface DamageProtectionDescriptionOptions {
  /** Resolve a stable runtime target ID to its scoped visible name when available. */
  resolveTargetName?: (targetId: string) => string | undefined;
}

export function damageProtectionRuleDescription(
  rule: DamageProtectionRule,
  options: DamageProtectionDescriptionOptions = {},
): string {
  const target = rule.scope === 'all_allies'
    ? '所有存活同队成员'
    : (() => {
        const id = rule.targetId || '';
        const name = options.resolveTargetName?.(id)?.trim();
        return name ? `实例「${name}（${id}）」` : `实例「${id}」`;
      })();
  if (rule.mode === 'intercept') {
    return `保护${target}：其受到的攻击伤害改由存活保护持有者承受（优先级${rule.priority ?? 0}，较高者先）；持有者倒下后的余伤继续交给下一名保护者，最后才落到原目标`;
  }
  return rule.scope === 'all_allies'
    ? '分摊全体：每次攻击伤害只在所有存活同队成员之间均分，不会重设任何单位当前生命值'
    : `与${target}分摊：每次攻击伤害只在该目标和仍存活的匹配保护持有者之间均分，不会重设任何单位当前生命值`;
}

/** Shared public-contract clauses. The protocol assembler owns placement in the full prompt. */
export const DAMAGE_PROTECTION_AUTHORING_CLAUSES = [
  'protection 仅对敌方同队成员生效，只能写在敌人能力或供敌人持有的状态定义上：{mode:"intercept"|"share_damage",scope:"specific"|"all_allies",target_id?,priority?}。specific 必须给敌方运行时实例 ID；all_allies 不得带 target_id。',
  'protection 仅处理攻击伤害。intercept 按 priority、再持有者稳定 ID 转交给存活保护者，倒下后的余伤继续转交，最后才落到原目标；share_damage 保留总伤害：specific 在原目标与匹配持有者间均分，all_allies 在该队所有存活成员间均分；不会把当前生命值设为平均。',
  '敌方指定保护始终按 target_id 精确绑定；目标离场或 ID 不存在时该规则不生效，绝不回退到 active enemy、位置或名称。',
] as const;

/** Inline schema shared by generation projections and finite repair slots. */
export const DAMAGE_PROTECTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['mode', 'scope'],
  properties: {
    mode: { enum: ['intercept', 'share_damage'] }, scope: { enum: ['specific', 'all_allies'] },
    target_id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }, priority: { type: 'integer' },
  },
  allOf: [
    { if: { properties: { scope: { const: 'specific' } }, required: ['scope'] }, then: { required: ['target_id'] } },
    { if: { properties: { scope: { const: 'all_allies' } }, required: ['scope'] }, then: { not: { required: ['target_id'] } } },
  ],
} as const;

export function isEmptyProtectionEffect(value: unknown): boolean {
  return value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}
