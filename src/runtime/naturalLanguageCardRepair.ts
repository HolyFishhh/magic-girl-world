import { retryCurrentMessageWithExtraModel } from './mvuExtraModelRepair';
import { reconcileNaturalLanguageVariableRepair } from './naturalLanguageVariableRepair';

export { reconcileNaturalLanguageVariableRepair } from './naturalLanguageVariableRepair';

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

/** Explicit player edits may address any semantic variable, not runtime metadata. */
export function formatNaturalLanguageVariableRepairPrompt(requirement: string): string {
  const normalized = requirement.trim();
  if (!normalized) throw new Error('请输入希望修改的变量和要求');
  return [
    '[玩家自然语言变量修改]',
    `用户要求=${JSON.stringify(normalized)}`,
    '读取本轮剧情及当前完整 stat_data；允许按玩家明确要求修改卡牌、buff/状态定义与层数、能力、资源、角色、剧情模式或爬塔变量。',
    '仅增量修改与要求直接相关的字段及必需的引用定义；未被要求的变量保持不变。不得重初始化、重建整套卡组或擅自推进剧情/战斗。',
    '遵循当前公开变量与效果协议，中文说明来自真实可执行字段；不得改写运行时元数据或聊天设置。',
    '默认只输出一个最小 <UpdateVariable> 操作补丁：使用 _.set/_.assign/_.add/_.remove 修改明确字段；仅在玩家明确要求整体替换时才输出完整对象。',
    '不续写剧情、不输出选项。',
  ].join('\n');
}

export async function requestNaturalLanguageVariableRepair(requirement: string): Promise<void> {
  await retryCurrentMessageWithExtraModel(formatNaturalLanguageVariableRepairPrompt(requirement), {
    reconcileVariables: reconcileNaturalLanguageVariableRepair,
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
  return runtime.registerCardRepairHandler(requestNaturalLanguageVariableRepair);
}
