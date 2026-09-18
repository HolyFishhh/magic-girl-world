/** Inspect already valid JSON before object decoding can hide duplicate keys.
 * Strings are data, including escaped property names. No gameplay inference.
 */
export function assertUnambiguousObjectJson(source: string): void {
  const stack: Array<Set<string> | null> = [];
  let containers = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      const start = i++;
      for (; i < source.length; i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === '"') break;
      }
      let next = i + 1;
      while (next < source.length && /\s/.test(source[next])) next++;
      if (source[next] === ':') {
        const keys = stack.at(-1);
        const key: string = JSON.parse(source.slice(start, i + 1));
        if (!keys || keys.has(key)) throw new Error('重复或无效的对象字段；需要保留原稿修复，不能静默覆盖');
        keys.add(key);
      }
    } else if (char === '{' || char === '[') {
      if (++containers > 100_000 || stack.length >= 64) throw new Error('对象超过安全大小或深度');
      stack.push(char === '{' ? new Set() : null);
    } else if (char === '}' || char === ']') stack.pop();
  }
}

/** Count explicit null values, ignoring keys, quoted text and comments. This
 * protects against jsonrepair inserting null for missing/undefined values.
 * It is not a full proof that arbitrary repaired text preserves semantics.
 */
function explicitNullCount(source: string): number {
  let count = 0;
  const quotes: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' };
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error('JSON 注释被截断，不能自动补全内容');
      i = end + 1;
      continue;
    }
    const closing = quotes[source[i]];
    if (closing) {
      let closed = false;
      for (i++; i < source.length; i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === closing) { closed = true; break; }
      }
      if (!closed) throw new Error('JSON 字符串被截断，需按原稿修复而非猜测结尾');
      continue;
    }
    if (/[A-Za-z_$]/.test(source[i])) {
      const start = i;
      while (i + 1 < source.length && /[A-Za-z0-9_$]/.test(source[i + 1])) i++;
      const word = source.slice(start, i + 1);
      let next = i + 1;
      while (next < source.length && /\s/.test(source[next])) next++;
      if ((word === 'null' || word === 'None') && source[next] !== ':') count++;
    }
  }
  return count;
}

export function assertNoInventedJsonValues(source: string, repaired: string): void {
  if (explicitNullCount(source) !== explicitNullCount(repaired)) {
    throw new Error('JSON 修复改变了空值：缺失值不能由程序补成 null，需保留原稿修复');
  }
}
