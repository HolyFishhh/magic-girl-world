import type { TowerInitialRepairSlotKind } from '../game-core/towerRequest';

/** Content is shared verbatim; select by program-owned repair kinds, never by
 * model, provider or guessed story keywords. General ownership/commit rules
 * remain in the caller and apply even to support-only roots. */
const guidance = {
  cardType: 'card_type 只返回 Attack 或 Skill 字符串，由你按原实际玩法选择。Event 仅允许唯一 narrate；当现有主效果已是合法数值、卡牌或召唤物强化时，改为相应功能类型。永久强化通常用 Skill，永久期限不等于 Event 或 Power。程序只改 type；effects、筛选条件、期限、未来副本、费用、稀有度、身份、说明及其他内容全部锁定，不删强化、不插入 narrate 来凑通过。',
  effects: 'effect_item/effect_sequence 只能从 schema 给出的有限一次性操作中选择；每个效果数组项只写一个主操作。passive_effect_sequence 只允许 modify/card_rule。eal_damage、gain_resource、amount.equals、to_modify 和任何 schema 外字段都不可输出。',
  mixed: 'effect_item_sequence 只把被点名的一个非法混合效果项替换为效果数组，其他相邻项完全锁定。每个原主操作恰好保留一次，原数值、资源/状态引用和 when 不变，不新增、删除或重复操作。由你依据已有机制选择合法的逐项目标与执行顺序，不能让程序猜测共享 to 应归谁；注意条件在每一项实际执行时重新求值。',
  order: 'effect_order_strategy只返回operationNames的排列数组，由你选择执行顺序；全部原操作各出现一次。程序将原操作及其参数逐值复制到独立数组项，不接受重写效果、目标、数值或说明。这只适用于无共享外层参数且各操作单独已合法的对象。',
  lust: 'lust_condition只修正原溢出效果的when布尔公式；依据原条件、说明和既定剧情保留限制，不得返回null、删除条件或改其他字段。完整效果仍须通过最终校验。',
  missingLust: 'missing_lust_effect 只补全所属玩家的欲望满溢效果，返回包含 name 与非空 effects 的完整效果对象，依据原欲望主题和既定剧情设计。它由同一玩家的初始内容及馈赠共享，不给各奖励另造效果。原卡牌、馈赠、剧情和其他玩家字段锁定；不得删除欲望操作、返回 null 或空对象来绕过校验。',
  first: 'first_card_event_condition只修已由完整字面说明证明错误的首次牌型计数，返回schema给出的条件；不得改事件、收益、目标、说明、寿命或其他字段。',
  literal: 'literal_effect_sequence 只修已明确证明与原完整字面说明冲突的 effects；由 AI 返回完整非空效果数组，逐项实现原说明的数值、对象、次数、顺序和时机。仅允许 schema 中的 damage/block/heal/draw/energy 字面操作和单层 schedule；立即效果在前，最多一个 schedule 且必须放在末尾，多个未来动作按原顺序写入该 schedule.effects。延迟用 {schedule:1,phase:"turn_start"或"turn_end",effects:字面效果}，每项一个主操作。原说明、身份及其他字段锁定，不能加 when、删说明或改风味来绕过复核。',
  trigger: 'trigger_mode_strategy 只允许两种由 AI 明确选择的有限语义：{mode:"event",on:合法非 passive 事件,effects:[一次性效果]} 或 {mode:"passive",effects:[持续规则]}；程序只编译 on/effects，模型不能改触发器的其他路径。持续 modify 固定写成 {modify:"damage|damage_taken|lust|lust_taken|heal|block|summon_capacity",add|subtract|multiply|divide|set:数值}，modify 的值绝不能是对象；card_rule 的值必须是 replay/free/retain_hand/retain_block/limit_draw/limit_block_gain/limit_energy_gain/deny_card_play/allow_card_play/limit_card_play/card_destination 之一。trigger_on 槽只改 on 枚举，其他触发内容保持锁定。condition 槽只返回保留原限制的合法 when 字符串，不接受 null；无法等价表达时保持失败，不删除条件换取通过。姿态 events 已由引擎保证只在该姿态生效期间监听，不能调用不存在的 self.has_stance。',
  status: '状态修复只开放报错的单一字段；status_hold_effect_item/status_hold_sequence 只允许持续 modify/card_rule，status_trigger_effect_item/status_trigger_effect_sequence 只允许 damage/heal/block/energy/lust/draw/apply_status/remove_status/resource 等一次性效果。item 槽只替换数组中被点名的一项，绝不能返回或改写同一 trigger 的其他项；即使原错误事件键里写了 modify/card_rule 也不能照抄。状态 ID、name、emoji、type、stacks_change 和其他触发器除非各自有独立槽，否则保持锁定。summon_lifecycle_default 只返回 {mode:"use_runtime_default"}，程序只删除原值严格为 "default" 的 on_destroyed，召唤其余字段全部锁定。',
  discard: 'discard_strategy 是明确的语义选择，不直接写 effects：若原意是弃掉全部手牌，返回 {mode:"discard_all"}；若原意是选择固定张数，返回 {mode:"discard_selected",count:正整数}。程序会保留原筛选与其他合法效果并编译为互不混写的效果数组。',
  copy: 'card_copy_strategy 只返回 {mode:"copy_at_original_cost"}：仅适用于 copy，绝不用于 double；程序保留原 copy 的数量、牌区和选择器，删除无法唯一关联到新副本的伪零费字段，并把副本放入手牌；配套 description 槽必须明确副本保留原费用。',
  resource: 'resource_payment_strategy 由 AI 按原 description 二选一。原意明确消耗资源时返回 {mode:"pay_resource",resource_id:程序锁定ID,amount:正整数或"all"}，程序保留原费用组件并只补同名资源费用；若公式使用 x_resource.ID，amount 必须为 "all"。原意只是读取资源池而不消费时返回 {mode:"read_current_resource"}，程序保持 cost，只把已点名公式中的 spent_resource.ID/x_resource.ID 改读 self.resource.ID.current。必须同步填写同根 description 槽，使“消耗”或“读取”与选择后的机制一致；不得让程序代替 AI 决定路线。',
  nextAttack: 'status_next_attack_modifier_strategy 只返回 {mode:"hold_until_next_attack"}。程序把原 attack_played 项中已写的 damage modifier 原值搬到 triggers.hold，并把被点名单项替换为移除当前状态；AI 不得重写 modifier 数值、状态 ID、其他 triggers 或 description。',
  quantity: 'card_quantity_strategy 必须由 AI 按原始构筑选择：{mode:"set_owned_quantity",quantity:1到100整数} 表示确实持有，或仅在 schema 提供时选择 {mode:"remove_unowned_card"} 删除 quantity:0 等未持有占位；程序锁定卡牌 ID 与索引，不能改卡牌其他字段。unknown_effect_item_strategy 是精确索引内的局部再创作，只返回一个 schema 允许的一次性浅层效果；必须同步填写 description 槽，其他 effects 项全部锁定。',
  classification: 'skill_trigger_classification_strategy 只返回 {mode:"promote_to_power"}，程序只把已证明“即时效果与后续事件 trigger 均各自合法”的 Skill type 改成 Power，不改 effects/trigger/description。condition_alias_strategy 只能从 allowed_modes 中选 mode，不返回新公式；程序按选择保留 when、采用 when_condition 或把两个已验证条件 AND，并只写锁定的两个条件字段。add_card_destination 只返回 hand/deck/discard 枚举，程序只改被点名 add_card 的 to；配套 description 槽必须与目标牌区一致。',
} as const;

// Exhaustive: adding a new slot kind requires an explicit guidance decision.
// Empty lists use the caller's generic value/action and description contract.
const kindGuidance = {
  effect_item: ['effects'],
  effect_sequence: ['effects'],
  passive_effect_sequence: ['effects'],
  effect_item_sequence: ['mixed'],
  effect_order_strategy: ['order'],
  literal_effect_sequence: ['literal'],
  trigger_on: ['trigger'],
  condition: ['trigger'],
  lust_condition: ['lust'],
  missing_lust_effect: ['missingLust'],
  first_card_event_condition: ['first'],
  description: [],
  card_type: ['cardType'],
  status_type: ['status'],
  status_stacks_change: ['status'],
  status_tick_timing: ['status'],
  status_max_stacks: ['status'],
  status_stun: ['status'],
  status_character_emoji: ['status'],
  status_protection: ['status'],
  status_defense: ['status'],
  status_trigger_effect_item: ['status'],
  status_trigger_effect_sequence: ['status'],
  status_hold_effect_item: ['status'],
  status_hold_sequence: ['status'],
  trigger_mode_strategy: ['trigger'],
  summon_lifecycle_default: ['status'],
  resource_payment_strategy: ['resource'],
  status_next_attack_modifier_strategy: ['nextAttack'],
  card_quantity_strategy: ['quantity'],
  unknown_effect_item_strategy: ['quantity'],
  skill_trigger_classification_strategy: ['classification'],
  condition_alias_strategy: ['classification'],
  add_card_destination: ['classification'],
  discard_strategy: ['discard'],
  card_copy_strategy: ['copy'],
  remove_field: [],
} as const satisfies Record<TowerInitialRepairSlotKind, readonly (keyof typeof guidance)[]>;

export const INITIAL_SLOT_REPAIR_GUIDANCE_KINDS = Object.freeze(Object.keys(kindGuidance) as TowerInitialRepairSlotKind[]);

export function selectInitialSlotRepairGuidance(
  targets: readonly { readonly slots: readonly { readonly kind: TowerInitialRepairSlotKind }[] }[],
): string[] {
  const selected = new Set<keyof typeof guidance>();
  for (const root of targets) for (const slot of root.slots) {
    if (!Object.hasOwn(kindGuidance, slot.kind)) throw new Error(`Unknown program repair slot kind: ${slot.kind}`);
    for (const id of kindGuidance[slot.kind]) selected.add(id);
  }
  return (Object.keys(guidance) as (keyof typeof guidance)[])
    .filter(id => selected.has(id)).map(id => guidance[id]);
}
