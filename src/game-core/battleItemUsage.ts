/** Program-owned host rule; never inferred from AI prose or stored on an item. */
export const BATTLE_ITEM_USAGE_RULE = '仅限战斗中玩家可行动时使用；成功使用消耗1个。战斗外不可使用，领取只入背包，不立即执行效果。';
export const BATTLE_ITEM_FLAVOR_LABEL = '叙述（不作为使用条件或效果依据）';
export const BATTLE_ITEM_USAGE_LABEL = '仅战斗中可用';

export function formatBattleItemAuthoringContract(): string {
  return `战斗道具（player/battle.items 及所有 reward.items/item）统一遵守：${BATTLE_ITEM_USAGE_RULE} description 必须与此限制及真实 effects 一致，不能承诺战斗外使用、领取即生效或未实现的额外效果；若选项要立即治疗等，请使用该选项支持的 outcome 数值字段。此限制由程序统一提供，AI 不增加 usage、scope 或其他道具字段，仍只输出现有精简契约。`;
}
