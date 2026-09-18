/** Ordinary entity-target defaults. Status contexts and enemy selectors can override them. */
export const COMPACT_OPPONENT_DEFAULT_OPERATIONS = [
  'damage', 'lust', 'execute', 'kill', 'apply_status', 'remove_status',
] as const;
const opponentDefaults: ReadonlySet<string> = new Set(COMPACT_OPPONENT_DEFAULT_OPERATIONS);

export function compactEffectDefaultTarget(operation: string): 'self' | 'opponent' {
  return opponentDefaults.has(operation) ? 'opponent' : 'self';
}

export function formatCompactEffectTargetContract(): string {
  return [
    `普通卡牌、遗物、能力与召唤行动的实体目标默认值：未写 to/targets 时，${COMPACT_OPPONENT_DEFAULT_OPERATIONS.join('/')} 默认 opponent，其余支持实体 to 的操作默认 self。self 是当前效果执行者，不固定指玩家；敌人行动的 self 是敌人，召唤行动的 self 是召唤物。牌区操作的 to:hand/deck/discard、召唤 selector.owner 等使用各自契约，不套用这条实体目标规则。`,
    '`targets` 省略 team 或写 team:"enemies" 保持旧的正式敌人集合；team:"self"/"opponent" 按实际来源阵营选取存活实体池，角色本体和每个召唤实例都独立参与随机。它只用于能落到实体的基础操作（damage/heal/block、数值池、status 等）；来源身份不会因此变成目标。',
    '| 状态的实际接收者 | 操作入口 |',
    '| --- | --- |',
    '| 当前执行者本体 | apply_status/remove_status，显式 to:self |',
    '| 当前执行者的对方本体 | apply_status/remove_status，显式 to:opponent |',
    '| 由外部效果选中的召唤物 | apply_summon_status/remove_summon_status 的 selector；owner 是阵营，不是角色本体 |',
    '| 召唤行动/能力的具体主人 | summoner_effects 内的效果；不把普通 to:self 当作主人 |',
    '状态施加/移除按实际意图明确写同级 to；buff/debuff、名称和 description 不会纠正目标。Power 也不会因此默认对自己施加状态。',
    '状态定义内部的 triggers 则以精确持有者为 self，省略 to 时作用于持有者；有 targets 时按敌人实体集合契约解析。来源、持有者、目标与说明须一致，注册状态 ID 不等于施加状态。',
  ].join('\n');
}
