import { DESIGN_ASSISTANT_PROMPT_MARKER } from './types';

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && typeof (part as Record<string, any>).text === 'string') {
        return (part as Record<string, any>).text;
      }
      return '';
    })
    .join('\n');
}

function messageList(payload: Record<string, any>): any[] | null {
  if (Array.isArray(payload.prompt)) return payload.prompt;
  if (Array.isArray(payload.messages)) return payload.messages;
  if (Array.isArray(payload.chat)) return payload.chat;
  return null;
}

export function hasDesignContext(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, any>;
  const messages = messageList(record);
  if (messages) {
    return messages.some(message =>
      message && typeof message === 'object' && contentText(message.content).includes(DESIGN_ASSISTANT_PROMPT_MARKER),
    );
  }
  return typeof record.prompt === 'string' && record.prompt.includes(DESIGN_ASSISTANT_PROMPT_MARKER);
}

/**
 * Mutate Tavern Helper's final request payload immediately before it is sent.
 * A late system message is inserted before the final user turn so provider tails
 * remain last and the MVU task itself keeps its original order.
 */
export function injectDesignContext(payload: unknown, prompt: string): boolean {
  if (!payload || typeof payload !== 'object' || !prompt.includes(DESIGN_ASSISTANT_PROMPT_MARKER)) return false;
  const record = payload as Record<string, any>;
  if (hasDesignContext(record)) return false;
  const messages = messageList(record);
  if (messages) {
    const historyBoundary = messages.findLastIndex(message =>
      message && typeof message === 'object' && contentText(message.content).includes('</past_observe>'),
    );
    if (historyBoundary >= 0) {
      messages.splice(historyBoundary + 1, 0, { role: 'system', content: prompt });
      return true;
    }
    let insertion = messages.length;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        insertion = index;
        break;
      }
    }
    messages.splice(insertion, 0, { role: 'system', content: prompt });
    return true;
  }
  if (typeof record.prompt === 'string') {
    record.prompt = `${record.prompt}\n\n${prompt}`;
    return true;
  }
  return false;
}
