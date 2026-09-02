const MVU_EXTRA_ANALYSIS_SIGNALS = [
  '<must>',
  '紧急变量更新任务',
  '必须立即停止角色扮演',
  '除了<UpdateVariable>块外不输出任何内容',
  '遵循<must>指令',
] as const;

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

function requestText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, any>;
  for (const key of ['prompt', 'messages', 'chat']) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .map(message => message && typeof message === 'object'
          ? contentText((message as Record<string, any>).content)
          : contentText(message))
        .join('\n');
    }
  }
  return contentText(record.prompt);
}

/**
 * MVU exposes an extra-analysis lifecycle flag, but Tavern Helper and MVU can
 * publish their globals on different browser ticks. The final request itself
 * contains a strict, stable task fingerprint, so use it as a scoped fallback
 * when the flag is temporarily unavailable or stale.
 *
 * Requiring two independent signals prevents ordinary story prompts and the
 * card's general UpdateVariable documentation from being misclassified.
 */
export function looksLikeMvuExtraAnalysisRequest(payload: unknown): boolean {
  const text = requestText(payload);
  if (!text) return false;
  let matches = 0;
  for (const signal of MVU_EXTRA_ANALYSIS_SIGNALS) {
    if (text.includes(signal)) matches += 1;
  }
  return matches >= 2;
}

export function summarizeMvuRequest(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return { shape: typeof payload, messages: 0 };
  const record = payload as Record<string, any>;
  const listKey = ['prompt', 'messages', 'chat'].find(key => Array.isArray(record[key]));
  return {
    shape: listKey || (typeof record.prompt === 'string' ? 'text-prompt' : 'unknown'),
    messages: listKey ? record[listKey!].length : 0,
    fingerprint: looksLikeMvuExtraAnalysisRequest(payload),
    reasoning: record.include_reasoning === true ? 'enabled' : record.include_reasoning === false ? 'disabled' : 'unset',
  };
}
