import { assertCurrentMessageLatest, getCurrentMessageVariableOptions } from './messageVariables';
import { requireTavernHelperHost } from './tavernHost';

const RETRY_BUTTON_NAME = '重试额外模型解析';
const REQUEST_BEGIN = '[MWG_REPAIR_REQUEST_BEGIN]';
const REQUEST_END = '[MWG_REPAIR_REQUEST_END]';

export interface ExtraModelRepairOptions {
  /** Reject the repaired snapshot before it replaces the current message/chat variables. */
  validateVariables?: (variables: Record<string, any>) => void;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && valuesEqual(left[key], right[key]));
}

/** Apply only the changes made by MVU's retry result to the pre-retry floor snapshot. */
function applyStructuralDelta(original: unknown, baseline: unknown, updated: unknown): unknown {
  if (valuesEqual(baseline, updated)) return cloneValue(original);
  if (!isPlainRecord(baseline) || !isPlainRecord(updated)) return cloneValue(updated);

  const result: Record<string, any> = isPlainRecord(original) ? cloneValue(original) : {};
  const keys = new Set([...Object.keys(baseline), ...Object.keys(updated)]);
  keys.forEach(key => {
    const baselineHasKey = Object.prototype.hasOwnProperty.call(baseline, key);
    const updatedHasKey = Object.prototype.hasOwnProperty.call(updated, key);
    if (!updatedHasKey) {
      if (baselineHasKey) delete result[key];
      return;
    }
    if (!baselineHasKey) {
      result[key] = cloneValue(updated[key]);
      return;
    }
    result[key] = applyStructuralDelta(result[key], baseline[key], updated[key]);
  });
  return result;
}

function readPreviousMvuVariables(runtime: Record<string, any>, messageId: number): Record<string, any> {
  for (let candidate = messageId - 1; candidate >= 0; candidate -= 1) {
    try {
      const value = runtime.getVariables({ type: 'message', message_id: candidate });
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'stat_data')) {
        return cloneValue(value);
      }
    } catch {
      // Some old floors legitimately do not carry message variables; MVU also scans backwards.
    }
  }
  return {};
}

function getStringHash(value: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function flattenScripts(trees: any[]): any[] {
  return trees.flatMap(tree => (tree?.type === 'folder' && Array.isArray(tree.scripts) ? tree.scripts : [tree]));
}

function resolveExtraModelRetryEvent(runtime: Record<string, any>): string {
  const buttonMap = runtime.getAllEnabledScriptButtons?.();
  if (buttonMap && typeof buttonMap === 'object') {
    const matches = Object.values(buttonMap)
      .flatMap(value => (Array.isArray(value) ? value : []))
      .filter(button => button?.button_name === RETRY_BUTTON_NAME && typeof button?.button_id === 'string')
      .map(button => button.button_id);
    const uniqueMatches = Array.from(new Set(matches));
    if (uniqueMatches.length === 1) return uniqueMatches[0];
    if (uniqueMatches.length > 1) throw new Error('发现多个 MVU 额外模型重试事件，无法安全选择');
  }

  const scriptIds = ['global', 'preset', 'character']
    .flatMap(type => flattenScripts(runtime.getScriptTrees({ type })))
    .filter(script => script?.enabled !== false)
    .filter(script => script?.button?.enabled !== false)
    .filter(script => script?.button?.buttons?.some((button: any) => button?.name === RETRY_BUTTON_NAME))
    .map(script => script.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const uniqueScriptIds = Array.from(new Set(scriptIds));
  if (uniqueScriptIds.length === 1) return `${uniqueScriptIds[0]}_${getStringHash(RETRY_BUTTON_NAME)}`;
  if (uniqueScriptIds.length > 1) throw new Error('发现多个 MVU 额外模型脚本，无法安全选择');
  throw new Error('当前酒馆助手或 MVU 版本没有提供额外模型重试事件');
}

function readMessageText(runtime: Record<string, any>, messageId: number): string {
  const messages = runtime.getChatMessages(messageId);
  const message = Array.isArray(messages) ? messages.at(-1) : undefined;
  return typeof message?.message === 'string' ? message.message : '';
}

function removeInjectedRequest(message: string): string {
  const start = message.lastIndexOf(REQUEST_BEGIN);
  if (start < 0) return message;
  const end = message.indexOf(REQUEST_END, start);
  if (end < 0) return message.slice(0, start).trimEnd();
  return `${message.slice(0, start).trimEnd()}${message.slice(end + REQUEST_END.length)}`.trim();
}

/** Keep repair-only lorebook keys active while hiding unrelated generation/settlement anchors. */
function suppressNonRepairAnchors(message: string): string {
  return message
    .replace(
      /\s*[<〈＜]\s*(?:CHARACTER_INIT_PENDING|CONTENT_PENDING|BATTLE_PENDING|BATTLE_START)\s*[>〉＞]\s*/gi,
      '\n',
    )
    .replace(/\s*\[(?:开始战斗|MVU_BATTLE_SETTLEMENT|路线节点|事件选择|营火升级|商店生成)\]\s*/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function extractNewUpdateBlock(original: string, updated: string): string {
  const originalBlocks = original.match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi) || [];
  const remainingOriginal = [...originalBlocks];
  const candidates = (updated.match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi) || []).filter(block => {
    const originalIndex = remainingOriginal.indexOf(block);
    if (originalIndex < 0) return true;
    remainingOriginal.splice(originalIndex, 1);
    return false;
  });
  const latest = candidates.at(-1);
  if (!latest) throw new Error('MVU 额外模型没有返回新的变量更新块');
  return latest;
}

/** Replace every failed/stale update block while preserving the original prose and runtime markers. */
function replaceUpdateBlocks(original: string, replacement: string): string {
  let inserted = false;
  const cleaned = removeInjectedRequest(original).replace(
    /<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi,
    () => {
      if (inserted) return '';
      inserted = true;
      return replacement;
    },
  );
  if (inserted) return cleaned.replace(/\n{3,}/g, '\n\n').trim();

  const firstRuntimeMarker = cleaned.search(
    /[<〈＜]\s*(?:CHARACTER_INIT_PENDING|CONTENT_PENDING|BATTLE_PENDING|BATTLE_START|StatusPlaceHolderImpl\s*\/)\s*[>〉＞]/i,
  );
  if (firstRuntimeMarker < 0) return `${cleaned.trimEnd()}\n\n${replacement}`.trim();
  return `${cleaned.slice(0, firstRuntimeMarker).trimEnd()}\n\n${replacement}\n\n${cleaned.slice(firstRuntimeMarker).trimStart()}`.trim();
}

/** Re-run MVU's extra-model parser against the current assistant floor without creating a chat message. */
export async function retryCurrentMessageWithExtraModel(
  repairPrompt: string,
  options: ExtraModelRepairOptions = {},
): Promise<void> {
  assertCurrentMessageLatest();
  const prompt = repairPrompt.trim();
  if (!prompt) throw new Error('修复请求不能为空');

  const runtime = requireTavernHelperHost([
    'getCurrentMessageId',
    'getLastMessageId',
    'getChatMessages',
    'setChatMessages',
    'getVariables',
    'replaceVariables',
    'getAllEnabledScriptButtons',
    'getScriptTrees',
    'eventEmit',
  ]);
  const messageId = getCurrentMessageVariableOptions().message_id;
  if (!Number.isInteger(messageId)) throw new Error('无法确定需要修复的助手楼层');

  const original = readMessageText(runtime, messageId as number);
  if (!original.trim()) throw new Error('当前助手楼层没有可供 MVU 修复的内容');
  const variableOptions = { type: 'message', message_id: messageId } as const;
  const originalVariables = cloneValue(runtime.getVariables(variableOptions));
  const baselineVariables = readPreviousMvuVariables(runtime, messageId as number);
  const requestBlock = `${REQUEST_BEGIN}\n${prompt}\n${REQUEST_END}`;
  const repairInput = suppressNonRepairAnchors(removeInjectedRequest(original));
  await runtime.setChatMessages(
    [{ message_id: messageId, message: `${repairInput}\n\n${requestBlock}` }],
    { refresh: 'none' },
  );

  let succeeded = false;
  let repairedUpdateBlock = '';
  try {
    const retryEvent = resolveExtraModelRetryEvent(runtime);
    await runtime.eventEmit(retryEvent);
    const updated = readMessageText(runtime, messageId as number);
    repairedUpdateBlock = extractNewUpdateBlock(original, updated);
    const updatedVariables = runtime.getVariables(variableOptions);
    const variablesChanged = !valuesEqual(updatedVariables, baselineVariables);
    if (!variablesChanged) throw new Error('MVU 额外模型没有写回修复后的变量');
    const mergedVariables = applyStructuralDelta(originalVariables, baselineVariables, updatedVariables);
    if (!isPlainRecord(mergedVariables)) throw new Error('MVU 额外模型返回的变量根不是对象');
    options.validateVariables?.(mergedVariables);
    await runtime.replaceVariables(mergedVariables, variableOptions);
    await runtime.replaceVariables(mergedVariables, { type: 'chat' });
    succeeded = true;
  } catch (error) {
    await runtime.replaceVariables(originalVariables, variableOptions);
    await runtime.replaceVariables(originalVariables, { type: 'chat' });
    await runtime.setChatMessages([{ message_id: messageId, message: original }], { refresh: 'affected' });
    throw error;
  } finally {
    if (succeeded) {
      const cleaned = replaceUpdateBlocks(original, repairedUpdateBlock);
      await runtime.setChatMessages(
        [{ message_id: messageId, message: cleaned }],
        { refresh: 'affected' },
      );
    }
  }
}
