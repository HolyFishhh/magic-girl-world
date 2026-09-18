/** Entry-point selection, not a replacement for each carrier's detailed rules. */
export function effectTimingRouteContract(): string {
  return [
    '| 结算意图 | 结构入口 | 生效范围 |',
    '| --- | --- | --- |',
    '| 当前结算 | 当前内容的 effects | 本次执行；when 只判断条件，不等待事件 |',
    '| 响应事件 | 内容根 trigger、状态 triggers 事件键或姿态 events；弃牌牌面用 discard_effects | 载体实际生效期间；事件筛选不改变载体寿命 |',
    '| 持续改变规则 | 根 trigger.on:passive、状态 triggers.hold 或姿态 passive | 仅 modify/card_rule；不是反复执行即时收益 |',
    '| 预约未来阶段 | 独立 schedule 项，内部 effects | 到期阶段执行；有限重复用 repeat_every 与 repeats |',
    '先按时机选择入口，再按来源、目标和寿命选载体。状态层数不代表等待回合；schedule:0 也须等对应阶段，不表示立刻执行。各载体允许的事件和操作见下文。',
  ].join('\n');
}
