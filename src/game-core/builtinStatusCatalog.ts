/** Versioned, executable conveniences. Story-specific definitions always remain authored content. */
export interface BuiltinStatusDefinition extends Record<string, unknown> {
  id: string;
  name: string;
  emoji: string;
  type: 'buff' | 'debuff';
  stacks_change: number | 'keep' | 'reset';
  triggers: Record<string, unknown>;
}
const status = (id: string, name: string, emoji: string, type: 'buff' | 'debuff',
  triggers: Record<string, unknown>, decay: number | 'keep' | 'reset' = 'keep'): BuiltinStatusDefinition =>
  ({ id: `sts_${id}`, name, emoji, type, stacks_change: decay, triggers });

export const BUILTIN_STATUS_DEFINITIONS: readonly BuiltinStatusDefinition[] = [
  status('strength', '力量', '💪', 'buff', { hold: { modify: 'damage', add: 'stacks', damage_type: 'attack' } }),
  status('dexterity', '敏捷', '🦶', 'buff', { hold: { modify: 'block', add: 'stacks' } }),
  status('weak', '虚弱', '🌀', 'debuff', { hold: { modify: 'damage', multiply: 0.75, damage_type: 'attack' } }, -1),
  status('vulnerable', '易伤', '💔', 'debuff', { hold: { modify: 'damage_taken', multiply: 1.5, damage_type: 'attack' } }, -1),
  status('frail', '脆弱', '🥀', 'debuff', { hold: { modify: 'block', multiply: 0.75 } }, -1),
  status('poison', '中毒', '☠️', 'debuff', { tick: { damage: 'stacks', damage_type: 'damage_over_time', bypass_block: true, to: 'self' } }, -1),
  status('regeneration', '再生', '🌿', 'buff', { turn_end: { heal: 'stacks', to: 'self' } }, -1),
  status('metallicize', '金属化', '🛡️', 'buff', { turn_end: { block: 'stacks', to: 'self' } }),
  status('ritual', '仪式', '🕯️', 'buff', { turn_end: { apply_status: 'sts_strength', stacks: 'stacks', to: 'self' } }),
  { ...status('thorns', '荆棘', '🌵', 'buff', {}), defense: { retaliate_attack: 'stacks' } },
  status('barricade', '壁垒', '🏰', 'buff', { hold: { card_rule: 'retain_block' } }),
  status('vigor', '活力', '🔥', 'buff', { hold: { modify: 'damage', add: 'stacks', damage_type: 'attack' }, attack_played: { remove_status: 'sts_vigor', to: 'self' } }),
  { ...status('artifact', '人工制品', '🗿', 'buff', {}), defense: { negate_debuff: true } },
  { ...status('intangible', '无实体', '👻', 'buff', {}, -1), defense: { damage_cap: 1 } },
  { ...status('buffer', '缓冲', '🫧', 'buff', {}), defense: { prevent_hp_loss: true } },
];

const catalog = new Map(BUILTIN_STATUS_DEFINITIONS.map(definition => [definition.id, definition]));
/** Materialize only referenced conveniences, including dependencies, without changing authored definitions. */
export function expandBuiltinStatusDefinitions(values: readonly unknown[], content: unknown, knownStatusIds: Iterable<string> = []): any[] {
  const result = structuredClone([...values]);
  const present = new Set([...knownStatusIds, ...result.map(value => value && typeof value === 'object' ? (value as Record<string, unknown>).id : undefined)]);
  const needed = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\bsts_[a-z_]+\b/g)) if (catalog.has(match[0])) needed.add(match[0]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        // Flavor is never an executable reference.
        if (!['name', 'description', 'narrative', 'say', 'narrate'].includes(key)) visit(entry);
      }
    }
  };
  visit(content);
  visit(values);
  for (const id of needed) {
    if (present.has(id)) continue;
    const definition = structuredClone(catalog.get(id)!);
    result.push(definition);
    present.add(id);
    visit(definition);
  }
  return result;
}

/** Shared reference boundary for worldbooks, generation and finite repair. */
export function builtinStatusReferenceContract(): string {
  return '预设状态白名单：' + BUILTIN_STATUS_DEFINITIONS.map(value => value.id).join('/') + '。仅这些精确 ID 可直接引用，程序按实际引用自动展开完整定义及依赖并随存档保存；已登记同 ID 定义优先。各处“先登记/补齐定义”要求仅针对非预设 ID。其他状态必须先完整定义后引用，中文名称或任意 sts_ 前缀不构成内置机制。核心剧情状态仍应独立创作，不能用通用预设替换其身份与规则。';
}

export function builtinStatusAuthoringContract(): string {
  return builtinStatusReferenceContract() + '\n' + '内置通用状态可直接用 apply_status 引用以下 sts_ ID，程序只展开实际引用的完整定义并随存档保存，无需重复登记；已显式登记的同ID定义优先，不会替换剧情自定义状态。主要用于小兵和非关键内容。玩家核心流派、剧情角色和招牌能力应优先创作独立中文名称、ID与效果，例如黑暗仪式应保留其剧情身份，不得偷换成力量；也不要给所有怪物套同一组状态。自定义状态仍须登记完整定义。内置规则使用本项目时机：中毒在持有者行动前结算，负一衰减在持有者回合末；虚弱/易伤/脆弱层数延长期限、不叠乘倍率；力量、活力、虚弱、易伤只修饰攻击伤害，敏捷/脆弱修饰格挡获取；荆棘仅响应攻击伤害事件、反伤不触发自身连锁；活力在玩家下一张攻击牌结算后清除，敌人没有出牌事件，勿对敌人使用它模拟下一次行动。完整可执行目录：' + JSON.stringify(BUILTIN_STATUS_DEFINITIONS);
}
