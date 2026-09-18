import {
  classifyGenerationTransportFailure,
  type GenerationTransportFailure,
} from './generationTransportError';

/** Numeric-only, opt-in observation of a preset narrative response wire.
 * It intentionally never retains response text, provider errors, IDs, headers,
 * or arbitrary event fields.  It reads a clone, so the generation consumer is
 * never delayed or replaced by this diagnostic. */
export interface NarrativeWireMetadata {
  events: number;
  bodyCharacters: number;
  reasoningCharacters: number;
  finishReasons: Array<'stop' | 'length' | 'tool_calls' | 'content_filter' | 'insufficient_system_resource' | 'other'>;
  usage: Partial<Record<'prompt_tokens' | 'completion_tokens' | 'total_tokens' | 'reasoning_tokens', number>>;
  complete: boolean;
  truncated: boolean;
  readFailed: boolean;
  failure?: GenerationTransportFailure;
}

const TOTAL_LIMIT = 4 * 1024 * 1024;
const EVENT_LIMIT = 64 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;
const FINISHES = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'insufficient_system_resource']);
const encoder = new TextEncoder();

function add(current: number, amount: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, current + Math.max(0, amount));
}
function safeLength(value: unknown): number { return typeof value === 'string' ? value.length : 0; }
function safeStatus(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 400 && (value as number) <= 599 ? value as number : undefined;
}

export function observeNarrativeWire(response: Response): {
  snapshot(): NarrativeWireMetadata;
  settled: Promise<void>;
  close(): void;
} {
  const metadata: NarrativeWireMetadata = {
    events: 0, bodyCharacters: 0, reasoningCharacters: 0, finishReasons: [], usage: {},
    complete: false, truncated: false, readFailed: false,
  };
  const finishes = new Set<NarrativeWireMetadata['finishReasons'][number]>();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const snapshot = (): NarrativeWireMetadata => ({
    ...metadata,
    finishReasons: [...finishes],
    usage: { ...metadata.usage },
    ...(metadata.failure ? { failure: { ...metadata.failure } } : {}),
  });
  const finish = () => {
    if (timer !== undefined) clearTimeout(timer);
    metadata.finishReasons = [...finishes];
  };
  const fail = () => { metadata.readFailed = true; };
  const record = (value: string) => {
    if (value === '[DONE]') { metadata.complete = true; return; }
    if (!value) return;
    let root: any;
    // A malformed provider event is ignored: observation remains best-effort
    // and `readFailed` is reserved for an unreadable cloned stream.
    try { root = JSON.parse(value); } catch { return; }
    metadata.events = add(metadata.events, 1);
    const upstreamError = root?.error;
    if (upstreamError && typeof upstreamError === 'object') {
      const status = safeStatus(upstreamError.status) ?? safeStatus(root?.status);
      metadata.failure = classifyGenerationTransportFailure(status, { error: upstreamError }, 'proxy_response');
    }
    for (const choice of Array.isArray(root?.choices) ? root.choices : []) {
      const delta = choice && typeof choice.delta === 'object' ? choice.delta : undefined;
      const message = choice && typeof choice.message === 'object' ? choice.message : undefined;
      metadata.bodyCharacters = add(metadata.bodyCharacters, safeLength(delta?.content) || safeLength(message?.content));
      metadata.reasoningCharacters = add(metadata.reasoningCharacters,
        safeLength(delta?.reasoning_content) || safeLength(delta?.reasoning) || safeLength(message?.reasoning_content) || safeLength(message?.reasoning));
      if (choice?.finish_reason != null) {
        finishes.add(FINISHES.has(choice.finish_reason) ? choice.finish_reason : 'other');
      }
    }
    const usage = root?.usage;
    for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
      if (Number.isSafeInteger(usage?.[field]) && usage[field] >= 0) metadata.usage[field] = usage[field];
    }
    const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens;
    if (Number.isSafeInteger(reasoning) && reasoning >= 0) metadata.usage.reasoning_tokens = reasoning;
  };

  const settled = (async () => {
    let clone: Response;
    try { clone = response.clone(); } catch { fail(); finish(); return; }
    if (!clone.ok) metadata.failure = classifyGenerationTransportFailure(clone.status, undefined, 'response');
    if (!clone.body) { fail(); finish(); return; }
    let pending = '', data: string[] = [], total = 0;
    const decoder = new TextDecoder();
    const flushEvent = () => { if (data.length) record(data.join('\n').trim()); data = []; };
    const consumeLine = (line: string) => {
      if (line === '') { flushEvent(); return; }
      if (line === 'data') data.push('');
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    };
    try {
      reader = clone.body.getReader();
      timer = setTimeout(() => { metadata.truncated = true; void reader?.cancel().catch(() => undefined); }, TIMEOUT_MS);
      // Node tests must not stay alive solely for an optional observer.
      (timer as any)?.unref?.();
      while (!closed) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > TOTAL_LIMIT) { metadata.truncated = true; break; }
        pending += decoder.decode(next.value, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const raw = pending.slice(0, newline); pending = pending.slice(newline + 1);
          if (encoder.encode(raw).byteLength > EVENT_LIMIT) { metadata.truncated = true; break; }
          consumeLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
          if (encoder.encode(data.join('\n')).byteLength > EVENT_LIMIT) { metadata.truncated = true; break; }
        }
        if (encoder.encode(pending).byteLength > EVENT_LIMIT) metadata.truncated = true;
        if (metadata.truncated) break;
      }
      if (!metadata.truncated && !closed) {
        pending += decoder.decode();
        if (pending) consumeLine(pending.endsWith('\r') ? pending.slice(0, -1) : pending);
        flushEvent();
        metadata.complete = true;
      }
    } catch { if (!closed) fail(); }
    finally {
      if (metadata.truncated || closed) void reader?.cancel().catch(() => undefined);
      finish();
    }
  })();

  return {
    snapshot,
    settled,
    close: () => {
      if (closed) return;
      closed = true;
      metadata.truncated = true;
      if (timer !== undefined) clearTimeout(timer);
      void reader?.cancel().catch(() => undefined);
    },
  };
}
