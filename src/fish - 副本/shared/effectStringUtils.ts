/**
 * 统一的效果字符串工具
 * - 提取触发段落：trigger(...)
 * - 旧 if(condition)(effect) 转换为 if[condition][effect]
 */

export function extractTriggeredSegments(text: string, trigger: string): string[] {
  const segments: string[] = [];
  if (!text || !trigger) return segments;
  const pattern = new RegExp(`${trigger}\\(`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    let pos = match.index + trigger.length + 1; // 指向 '(' 之后
    let depth = 1;
    let content = '';
    while (pos < text.length && depth > 0) {
      const ch = text[pos];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth > 0) content += ch;
      pos++;
    }
    if (depth === 0) segments.push(content.trim());
  }
  return segments;
}

export function convertLegacyIfSyntax(effectContent: string): string {
  if (!effectContent) return effectContent;
  const ifPattern = /if\(([^)]+)\)\(([^)]+(?:\([^)]*\)[^)]*)*)\)/g;
  return effectContent.replace(ifPattern, (_m, condition, eff) => `if[${condition}][${eff}]`);
}

