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

/** Authoring-only scope: never used as an execution or repair quality gate. */
export function builtinStatusUsageContract(): string {
  return '生成范围：这15项预设状态默认仅用于低质量敌人（无剧情身份、机制简单的普通杂兵）或偏中立卡牌（不承载角色专属设定的通用卡牌）。玩家卡组（含开局与后续专属卡牌）在未明确要求时应避免套用通用预设buff，优先根据剧情设定、角色身份、能力来源与当前构筑创作具体机制；但玩家明确要求通用状态或通用力量buff时，优先满足玩家要求，允许直接引用对应预设ID（通用力量为sts_strength），不必为了避开预设而换名仿造。剧情相关敌人和复杂敌人仍须依据剧情设定生成名称、独立ID、触发条件及可执行效果；无明确要求时，不能给玩家卡组或重要敌人只改名字、堆叠通用buff来代替剧情设计。低质量不是允许敷衍或缺少完整规则；仅因数值或稀有度较低、处于普通战斗节点，不代表可以使用预设。以上是创作指引，不是程序质量硬门槛；结构修复不得据此拒绝、删除或改写已合法的卡牌、敌人和玩家存档。';
}

/** Shared reference boundary for worldbooks, generation and finite repair. */
export function builtinStatusReferenceContract(): string {
  return '预设状态白名单：' + BUILTIN_STATUS_DEFINITIONS.map(value => value.id).join('/') + '。仅这些精确 ID 可直接引用，程序按实际引用自动展开完整定义及依赖并随存档保存；已登记同 ID 定义优先。各处“先登记/补齐定义”要求仅针对非预设 ID。其他状态必须先完整定义后引用，中文名称或任意 sts_ 前缀不构成内置机制。' + '\n' + builtinStatusUsageContract();
}

export function builtinStatusAuthoringContract(): string {
  return builtinStatusReferenceContract() + '\n' + '内置通用状态可直接用 apply_status 引用以下 sts_ ID，程序只展开实际引用的完整定义并随存档保存，无需重复登记；已显式登记的同ID定义优先，不会替换剧情自定义状态。使用范围严格遵循上方生成要求；玩家明确要求通用力量buff时，牌面效果可直接写 {apply_status:"sts_strength",stacks:1,to:"self"}；无需再把通用力量换名注册新状态。例如剧情角色的黑暗仪式必须从其设定生成独立机制，不得偷换成力量或只给力量换名，也不能给所有怪物套同一组状态。自定义状态仍须登记完整定义。内置规则使用本项目时机：中毒在持有者行动前结算，负一衰减在持有者回合末；虚弱/易伤/脆弱层数延长期限、不叠乘倍率；力量、活力、虚弱、易伤只修饰攻击伤害，敏捷/脆弱修饰格挡获取；荆棘仅响应攻击伤害事件、反伤不触发自身连锁；活力在玩家下一张攻击牌结算后清除，敌人没有出牌事件，勿对敌人使用它模拟下一次行动。完整可执行目录：' + JSON.stringify(BUILTIN_STATUS_DEFINITIONS);
}
