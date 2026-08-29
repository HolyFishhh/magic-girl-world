import { retryCurrentMessageWithExtraModel } from './mvuExtraModelRepair';

function cloneValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function formatNaturalLanguageCardRepairPrompt(requirement: string): string {
  const normalized = requirement.trim();
  if (!normalized) throw new Error('请输入希望怎样修复卡牌');
  return [
    '[玩家自然语言卡牌修复]',
    `用户要求=${JSON.stringify(normalized)}`,
    '读取当前完整变量中的 battle.cards。',
    '只按用户要求增量修改相关卡牌，不重新初始化或重建整套卡组。',
    '未被要求的卡牌与所有非卡牌变量保持不变。',
    '只输出一个 <UpdateVariable>，不续写剧情、不输出选项。',
  ].join('\n');
}

/** Project an extra-model retry back onto the card collection only. */
export function reconcileNaturalLanguageCardRepair(
  originalVariables: Record<string, any>,
  repairedVariables: Record<string, any>,
): Record<string, any> {
  const originalCards = originalVariables?.stat_data?.battle?.cards;
  const repairedCards = repairedVariables?.stat_data?.battle?.cards;
  if (repairedCards === undefined) throw new Error('第二轮模型没有返回 battle.cards');
  if (valuesEqual(originalCards, repairedCards)) throw new Error('第二轮模型没有按要求修改卡牌');

  const result = cloneValue(originalVariables);
  if (!result?.stat_data || typeof result.stat_data !== 'object') throw new Error('当前变量缺少 stat_data');
  if (!result.stat_data.battle || typeof result.stat_data.battle !== 'object') {
    throw new Error('当前变量缺少 battle');
  }
  result.stat_data.battle.cards = cloneValue(repairedCards);
  return result;
}

/** Use MVU's in-place second-stage retry; never create a story-model message. */
export async function requestNaturalLanguageCardRepair(requirement: string): Promise<void> {
  await retryCurrentMessageWithExtraModel(formatNaturalLanguageCardRepairPrompt(requirement), {
    reconcileVariables: reconcileNaturalLanguageCardRepair,
  });
}

export type NaturalLanguageCardRepairHandler = (requirement: string) => Promise<void>;

export type SharedCardRepairRuntime = Readonly<{
  registerCardRepairHandler?: (handler: NaturalLanguageCardRepairHandler) => () => void;
}>;

/** Register the active page as the repair executor used by the card's floating settings UI. */
export function registerNaturalLanguageCardRepairHandler(): () => void {
  const runtime = (globalThis as Record<string, any>).MagicGirlWorld as SharedCardRepairRuntime | undefined;
  if (typeof runtime?.registerCardRepairHandler !== 'function') {
    throw new Error('角色运行时尚未提供卡牌修复接口');
  }
  return runtime.registerCardRepairHandler(requestNaturalLanguageCardRepair);
}
