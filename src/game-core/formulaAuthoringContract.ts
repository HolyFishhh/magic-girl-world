/** Public expression reference. No model-specific dialect or runtime defaults. */
export function formulaAuthoringContractClauses(): string[] {
  return [
    '条件位置：具体操作同级 when，只接受比较或 &&/||/! 布尔条件；不接受 true、数字、自然语言、三元式或 {when,effects} 包装。数值二选一写在操作值中，如 {damage:"self.hp < self.max_hp ? 8 : 5"}；数值效果的三元式可嵌入算式及数值函数，只执行选中的结果一次。',
    '运算：+ - * / %、括号、比较、&& || !、数值三元式。% 为取余，除数不可为0；cards_played_this_turn % 3 == 0 表示本回合每第3张牌。数值函数仅 floor/ceil/abs（各1个数值参数）和 min/max（1..32个数值参数），不用 Math.*、对象方法或其他 JavaScript；公式最多64语法节点、16层，条件展开最多64分支。',
    '弃牌计数：discard_count 表示同一效果序列最近一次 discard 实际移出的卡牌数量；取消或无匹配为0，嵌套触发不覆盖外层结果，新卡/新触发从0开始。例如 [{discard:"all",from:"hand",pick:"all",name_contains:"小刀"},{damage:"discard_count"},{draw:"discard_count"}]。name 是精确同名匹配，name_contains 是名称包含匹配（打击可匹配完美打击）；过滤可结合 id/tag。',
    '全局数值：spent_energy、x_value、turn_number、cards_played_this_turn、attacks_played_this_turn、skills_played_this_turn；spent_resource.资源ID、x_resource.资源ID。出牌事件触发器另可读取 event_paid_energy、event_paid_total、event_paid_resource.资源ID。支付变量的适用位置见“资源与支付”。',
    '实体数值：以下每个路径都须加 self. 或 opponent. 前缀：hp、max_hp、lust、max_lust、energy、max_energy、block；hand_size、draw_pile_size、discard_pile_size、exhaust_pile_size；summon_count、ally_count；buff_count、debuff_count、neutral_count、status_count；status.状态ID.stacks；resource.资源ID.current/max。self 与 opponent 是并列根，不存在 self.opponent 或 opponent.self。HP阈值直接比较 hp/max_hp，不存在 hp_percent 变量。能力本身没有层数；可累积条件使用状态层数。',
    '实体条件：self./opponent. 下的 has_buff、has_debuff、has_neutral、has_status、has_summon、has_ally、alive 是无参数布尔字段，仅用于条件，可直接取值或加 !，不作函数调用。has_buff/has_debuff/has_neutral/has_status 分别检查对应有效状态数量是否大于0；指定状态用 self.status.状态ID.stacks > 0 或 opponent.status.状态ID.stacks > 0。',
    '数量范围：has_summon/summon_count 指所属阵营存活召唤；has_ally/ally_count 指所属阵营其他存活非召唤战斗实体；alive 指该实体 hp>0。“每个召唤物提供N”须按 summon_count 计量；has_summon 只表达有无，不得代替数量缩放，即使当前只有一个召唤物。敌人来源的 opponent 牌区数量就是玩家牌区；无牌区实体的牌区数值为0。',
    '局部上下文：状态触发器额外可用裸 stacks，姿态槽内的姿态额外可用 orb_value；离开该上下文不可读取。伤害事件条件额外可用 event.damage_type，仅与 attack/effect/hp_loss/retaliation/damage_over_time/execute 作 == 或 !=，不用于数值公式。',
    '变量边界：除上方全局数值与适用的局部变量外不使用裸变量；不存在裸 summon_count、ally_count、hp/lust/energy，也不存在 enemy_summon_count、slot_count。效果使用公开操作，不输出通用 if/then、内部 op/steps AST 或自然语言效果。',
  ];
}
