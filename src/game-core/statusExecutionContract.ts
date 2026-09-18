/** Execution semantics only; definition placement is owned by each request mode. */
export function statusExecutionContractClauses(): string[] {
  return [
    '人物外观：状态可选 character_emoji（1..32字符），仅在持有正层数期间替换持有者人物emoji；AI生成的变身状态优先用character_emoji明确外观，而不是把状态自身emoji误当人物外观；多个外观状态以最后获得且仍持有的为准，再次叠层不改变优先级，移除/到期/战斗清理后恢复其他仍有效外观或原人物emoji。状态自己的emoji仍是状态图标，不能推断为人物外观。Power、遗物、独立能力可通过apply_status赋予这种外观状态，寿命仍由状态的可执行移除/衰减控制，不得只在描述中声称变身。',
    '状态载体：hold只承载持续modify/card_rule；apply/stack/tick/remove及事件键只承载一次性effects。监听事件直接用triggers的对应事件键，不能嵌入hold；不存在card_rule:"energy_gain"或modify:"energy"。',
    '获得与叠加：首次获得正层数只触发apply；已持有且层数实际增加只触发stack，两者互不代替。零增长或达到上限不触发stack。若要求首次获得和再次叠加都有收益，必须分别实现对应入口；不能只写stack却说明为每次获得。',
    '状态筛选：事件键不接受scope/ordinal/n/event等结构化筛选。首次、第N次或来源筛选优先使用Power、遗物、独立能力或召唤ability的根trigger；scope:"turn"仅重置计数，不改变内容寿命。全牌、攻击、技能计数分别为cards_played_this_turn、attacks_played_this_turn、skills_played_this_turn，不可混用；计数条件不代替事件监听。',
    '状态上下文：省略to作用于精确持有者，opponent为其对方；玩家、具体敌人、具体召唤不能互相冒充。公式可读取裸stacks及通用变量；伤害事件when可用event.damage_type与attack/effect/hp_loss/retaliation/damage_over_time/execute作==或!=比较，不用于数值公式，不读取未公开的amount/damage。',
    '状态监听：仅在实际持有期间响应。事件开始冻结已有状态，本事件中新获得的状态不追溯响应；其apply/stack造成的新事件可正常响应。移除后立即停止。同一持有者的同一状态不会递归重入自己正在结算的同名事件；不同状态和不同事件仍按顺序结算。',
    '状态 tick：triggers.tick只在持有者自身行动边界执行；根tick_timing可为before_action或after_action，省略默认before_action。每个敌人/召唤按自己的行动前后结算，玩家在自己的行动期前后结算；这不是turn_start/turn_end，不能重复触发那两个事件键。状态衰减：持有者回合末只执行根stacks_change、零层移除及triggers.remove，与tick_timing无关。数字为当前层数加该值后向下取整且不低于0；"x倍率"为乘后向下取整；"reset"归零；"keep"或省略不自动变化。减1层写根stacks_change:-1。remove_status立即移除整个状态，不接受部分扣层；stacks只修饰apply_status。',
    '状态期限：层数不是剩余回合或触发次数。行动期施加且设置回合末衰减的状态，从施加当回合末就开始衰减；须按施加→tick→衰减→移除→后续触发计算真实次数。当回合turn_end不是下一回合。有限未来收益要同时落实触发时点与结束机制，不能只按目标回合数填写stacks。',
    '眩晕：stun:true使持有者无法行动。除玩家要求或题材明确需要永久控制外，用stacks_change:-1、"reset"或可执行移除机制结束；永久眩晕本身不是结构错误。',
  ];
}
