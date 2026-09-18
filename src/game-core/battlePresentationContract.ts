/** Presentation guidance is shared by authoring and repair prompts, not new fields. */
export function battlePresentationContractClauses(): string[] {
  return [
    '战斗台词：主动为有辨识度的卡牌、敌人行动和召唤行动填写可选 dialogue，建议一句简短中文，贴合说话者性格与当前动作；普通重复动作可省略，不要求每次都有。dialogue 会在实际执行时显示在对应角色头顶5秒，点击可关闭。不要只把台词放进 description，也不为说话额外制造伤害或空过；数值规则仍完全由 effects 决定。description 用于卡牌底部的简短风味描述，不能代替可执行规则。',
    '敌方排列：AI只输出 enemies 数组，不输出序号、位置、stageSlot或排序字段。程序按数组顺序安排初始单位：首项显示在最右侧，后续依次向左，最多5名在场，其余为后备；因此靠玩家的左侧是前排侧、最右是后排侧，需要前后排设计时先写后排、后写前排。行动仍按程序队列，不因屏幕左右或当前选中目标改序。排位本身不提供嘲讽、保护或禁止点选，保护效果必须用真实机制实现；死亡留空位、增援补位由程序处理。',
  ];
}
