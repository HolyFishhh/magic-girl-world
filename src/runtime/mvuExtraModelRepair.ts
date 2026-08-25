import { assertCurrentMessageLatest, getCurrentMessageVariableOptions } from './messageVariables';
import { requireTavernHelperHost } from './tavernHost';

const RETRY_BUTTON_NAME = '重试额外模型解析';
const REQUEST_BEGIN = '[MWG_REPAIR_REQUEST_BEGIN]';
const REQUEST_END = '[MWG_REPAIR_REQUEST_END]';

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

/** Re-run MVU's extra-model parser against the current assistant floor without creating a chat message. */
export async function retryCurrentMessageWithExtraModel(repairPrompt: string): Promise<void> {
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
    'getButtonEvent',
    'eventEmit',
  ]);
  const messageId = getCurrentMessageVariableOptions().message_id;
  if (!Number.isInteger(messageId)) throw new Error('无法确定需要修复的助手楼层');

  const original = readMessageText(runtime, messageId as number);
  if (!original.trim()) throw new Error('当前助手楼层没有可供 MVU 修复的内容');
  const variableOptions = { type: 'message', message_id: messageId } as const;
  const originalVariables = JSON.parse(JSON.stringify(runtime.getVariables(variableOptions)));
  const requestBlock = `${REQUEST_BEGIN}\n${prompt}\n${REQUEST_END}`;
  await runtime.setChatMessages(
    [{ message_id: messageId, message: `${removeInjectedRequest(original).trimEnd()}\n\n${requestBlock}` }],
    { refresh: 'none' },
  );

  let succeeded = false;
  try {
    const retryEvent = runtime.getButtonEvent(RETRY_BUTTON_NAME);
    if (!retryEvent) throw new Error('当前 MVU 版本没有提供额外模型重试事件');
    await runtime.eventEmit(retryEvent);
    const updated = readMessageText(runtime, messageId as number);
    if (!updated.includes('<UpdateVariable>')) throw new Error('MVU 额外模型没有返回有效变量更新');
    succeeded = true;
  } catch (error) {
    await runtime.replaceVariables(originalVariables, variableOptions);
    await runtime.setChatMessages([{ message_id: messageId, message: original }], { refresh: 'affected' });
    throw error;
  } finally {
    if (succeeded) {
      const current = readMessageText(runtime, messageId as number);
      await runtime.setChatMessages(
        [{ message_id: messageId, message: removeInjectedRequest(current) }],
        { refresh: 'affected' },
      );
    }
  }
}
