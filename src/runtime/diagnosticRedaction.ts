const secretKey = /^(?:api[_-]?key|authorization|(?:access[_-]?|refresh[_-]?)?token|password|passwd|secret|client[_-]?secret|cookie|set-cookie)$/i;
const hidden = '[已隐藏]';

/** Only diagnostic/export copies pass here. Gameplay data is never rewritten. */
export function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, secretKey.test(key) ? hidden : redactDiagnosticValue(entry)]),
  );
  return value;
}

export function redactDiagnosticText(value: unknown): string {
  const text = String(value ?? '');
  if (/^\s*[\[{]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      const redacted = redactDiagnosticValue(parsed);
      // Preserve formatting when nothing needed redaction. Object/array/numeric
      // credentials need structured masking, not just a quoted-string regex.
      if (JSON.stringify(parsed) !== JSON.stringify(redacted)) return JSON.stringify(redacted);
    } catch { /* Embedded or incomplete JSON still gets textual redaction. */ }
  }
  return text
    // Match JSON string values including escaped quotes and decoded key names.
    .replace(/("(?:[^"\\]|\\.)*"\s*:\s*)("(?:[^"\\]|\\.)*")/g, (pair, prefix: string) => {
      try { return secretKey.test(JSON.parse(prefix.slice(0, prefix.lastIndexOf(':')).trim())) ? `${prefix}"${hidden}"` : pair; }
      catch { return pair; }
    })
    .replace(/((?:api[_-]?key|authorization|(?:access[_-]?|refresh[_-]?)?token|password|passwd|secret|client[_-]?secret|cookie|set-cookie)\s*[=:]\s*)(?:"(?:[^"\\]|\\.)*"|'[^']*'|(?:Bearer|Basic)\s+[^\s,;]+|[^\s,;]+)/gi, `$1${hidden}`)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"'<>]+/gi, hidden)
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[密钥已隐藏]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[地址已隐藏]');
}
