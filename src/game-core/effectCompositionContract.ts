import { COMPACT_EFFECT_BUNDLE_OPERATIONS } from './compactEffectContract';

/** Public object/array semantics, shared by worldbook and every request mode. */
export function effectCompositionContract(): string {
  return [
    'effects 组合：单项写浅层对象，多项写按顺序执行的数组；有先后依赖、不同条件或不同目标时拆项，不依赖 JSON 键顺序。',
    '条件组写 {guard:布尔公式,effects:[子效果]}：进入组时判断一次，成立后依序执行；子项自己的 when 仍在执行该项时判断。用于先判断、再支付与结算收益等依赖链；组不写 to/targets/when/on，目标各归子项。不自动回滚，不改变载体限制；最多嵌套8层，每组1至256项。',
    `合并仅限 ${COMPACT_EFFECT_BUNDLE_OPERATIONS.join('/')}。合并对象的 when 在组前判断一次，控制整组；显式 to/targets 传给其中每个支持该字段的操作，省略时各操作仍用自身默认目标。合并不建立独立条件或目标。`,
    '修饰字段归属：damage_type/bypass_block/lifesteal 仅修饰同项 damage；stacks 仅修饰同项 apply_status。hits 只用正整数，只用于独立 damage 项，不能用于合并对象。bypass_block 仅 true，表示完全无视格挡，不支持指定点数。lifesteal 是按实际生命损失恢复生命的数值倍率或 CEL 数值公式，不是布尔开关；0.5 表示50%，1 表示100%，禁止 true/false。例如 {damage:10,lifesteal:0.5}；伤害完全被格挡时不产生吸血。其余操作各自独占数组项。',
  ].join('\n');
}
