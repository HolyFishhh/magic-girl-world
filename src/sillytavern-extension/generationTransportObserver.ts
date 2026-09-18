import { classifyGenerationTransportFailure, GenerationTransportError, normalizeGenerationTransportError, readProxyGenerationFailure } from './generationTransportError';
import { observeNarrativeWire, type NarrativeWireMetadata } from './narrativeWireObservation';

export interface GenerationFetchHost { fetch: typeof fetch; location?: { href: string } }
export interface GenerationTransportProgress {
  phase: 'request_dispatched' | 'response_received';
  at: number;
  httpStatus?: number;
  contentType?: 'event_stream' | 'json' | 'other' | 'missing';
}
export interface GenerationRequestOwner {
  generationId: string; role: 'system' | 'user'; content: string;
  /** Metadata only; never recovers unfiltered text or changes preset parameters. */
  onNarrativeWire?(metadata: NarrativeWireMetadata): void;
  /** Low-sensitivity exact-request observation. It never aborts or retries the Helper call. */
  onTransportFailure?(failure: import('./generationTransportError').GenerationTransportFailure): void;
  /** Exact transport milestones only; no URL, payload, body, or response text. */
  onTransportProgress?(event: GenerationTransportProgress): void;
  /** Only learned custom schema transport opts into this final wire guard. */
  schemaCompatibilityRoute?: { model: string; url: string };
  /** Private, per-invocation data delivery. Never enabled for preset narration. */
  auxiliaryJson?: {
    route: { model: string; url: string };
    read(body: unknown): string | undefined;
    isCurrent(): boolean;
    onRecovered(): void;
  };
}
interface Observation {
  owner: GenerationRequestOwner; active: boolean; requests: number; error?: GenerationTransportError;
  auxiliary?: string; wire?: ReturnType<typeof observeNarrativeWire>;
}
const MAX_ERROR_BYTES = 8192;
const MAX_STRUCTURED_BYTES = 2_097_152;
const ERROR_READ_MS = 250;

/** Read only a bounded response clone. Cancelling a tee branch can wait
 * for the other reader, so never await cancellation or consume the original. */
async function errorBody(response: Response, maxBytes = MAX_ERROR_BYTES): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return undefined;
    const read = async () => {
      const decoder = new TextDecoder();
      let bytes = 0, text = '';
      while (true) {
        const part = await reader!.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxBytes) return undefined;
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      try { return JSON.parse(text); } catch { return undefined; }
    };
    return await Promise.race([read(), new Promise<undefined>(resolve => { timer = setTimeout(resolve, ERROR_READ_MS); })]);
  } catch { return undefined; }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader?.cancel().catch(() => undefined);
  }
}

/** One shared observer for concurrent/nested Helper calls in this realm. It
 * changes no URL, headers, payload, response object, body or abort signal.
 * An opted-in owned request may be rejected before fetch if its route changed. */
class GenerationFetchObserver {
  private readonly observations = new Set<Observation>();
  private wrapper?: typeof fetch;
  private previous?: typeof fetch;
  private epoch = 0;
  constructor(private readonly host: GenerationFetchHost) {}

  public fail(observation: Observation, error: GenerationTransportError): void {
    if (!observation.active || observation.error) return;
    observation.error = error;
    try { observation.owner.onTransportFailure?.({ ...error.failure }); } catch { /* Diagnostics never alter generation. */ }
  }

  private progress(observation: Observation, event: GenerationTransportProgress): void {
    if (!observation.active) return;
    try { observation.owner.onTransportProgress?.(event); } catch { /* Diagnostics never alter generation. */ }
  }

  private match(input: RequestInfo | URL, init?: RequestInit): { observation: Observation; payload: Record<string, any> } | undefined {
    try {
      // The installed Helper uses a POST with a string body. Do not inspect
      // arbitrary Request bodies or credentials; unsupported shapes pass through.
      if (init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string' || init.body.length > 10_000_000) return;
      const base = this.host.location?.href;
      if (!base || (typeof input !== 'string' && !(input instanceof URL))) return;
      const url = new URL(String(input), base);
      if (url.origin !== new URL(base).origin || url.pathname !== '/api/backends/chat-completions/generate' || url.search) return;
      const payload = JSON.parse(init.body);
      if (!Array.isArray(payload?.messages)) return;
      const matches = [...this.observations].filter(observation => observation.active && observation.owner.content.trim()
        && payload.messages.some((message: any) => message?.role === observation.owner.role && typeof message?.content === 'string'
          // Helper/preset compaction may join adjacent messages. Require the
          // complete owned block on line boundaries, not a quoted substring.
          && `\n${message.content.replace(/\r\n/g, '\n')}\n`.includes(`\n${observation.owner.content.replace(/\r\n/g, '\n')}\n`)));
      // Identical simultaneous narrative inputs have no unique wire identity:
      // fail closed rather than attach another request's error to this job.
      return matches.length === 1 ? { observation: matches[0], payload } : undefined;
    } catch { return undefined; }
  }

  observe(owner: GenerationRequestOwner): { observation: Observation; close(): void } {
    const observation: Observation = { owner, active: true, requests: 0 };
    if (this.observations.size === 0 && typeof this.host.fetch === 'function') {
      const previous = this.host.fetch;
      const epoch = ++this.epoch;
      const observer = this;
      const wrapper: typeof fetch = function (this: unknown, input, init) {
        const match = epoch === observer.epoch ? observer.match(input, init) : undefined;
        const matched = match?.observation;
        if (matched) { matched.requests += 1; matched.auxiliary = undefined; matched.wire?.close(); matched.wire = undefined; }
        const route = matched?.owner.schemaCompatibilityRoute ?? matched?.owner.auxiliaryJson?.route;
        if (matched && route && (match!.payload.chat_completion_source !== 'custom'
          || match!.payload.model !== route.model || match!.payload.custom_url !== route.url)) {
          const error = new GenerationTransportError({ kind: 'route_changed', retryable: false, evidence: 'request_guard' });
          observer.fail(matched, error);
          return Promise.reject(error);
        }
        if (matched) observer.progress(matched, { phase: 'request_dispatched', at: Date.now() });
        const pending = previous.call(this, input, init);
        if (!matched) return pending;
        return pending.then(async response => {
          const header = response.headers.get('content-type')?.toLowerCase() || '';
          observer.progress(matched, {
            phase: 'response_received', at: Date.now(), httpStatus: response.status,
            contentType: header.includes('text/event-stream') ? 'event_stream'
              : header.includes('application/json') ? 'json' : header ? 'other' : 'missing',
          });
          if (matched.active && matched.requests === 1
            && response.ok && response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
            try {
              const wire = observeNarrativeWire(response);
              matched.wire = wire;
              // Preserve terminal SSE evidence even if Helper later swallows
              // the failure. Observation is diagnostic only: a pending Helper
              // remains pending until the user cancels it or it settles.
              void wire.settled.then(() => {
                if (!matched.active || matched.requests !== 1 || matched.wire !== wire) return;
                const metadata = wire.snapshot();
                if (metadata.failure) observer.fail(matched, new GenerationTransportError(metadata.failure));
              }).catch(() => undefined);
            } catch { /* Optional diagnostics. */ }
          }
          if (!response.ok && matched.active) {
            const body = await errorBody(response);
            if (matched.active) observer.fail(matched, new GenerationTransportError(classifyGenerationTransportFailure(response.status, body)));
          } else if (matched.active && response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
            // A successful HTTP envelope can contain a proxy's upstream error.
            // The optional JSON data-only decoder has a separate
            // whole-response byte bound (not just the auxiliary field);
            // ordinary/error observations keep their original cap.
            const auxiliary = matched.owner.auxiliaryJson;
            const canReadAuxiliary = auxiliary && match!.payload.stream === false && matched.requests === 1;
            const body = await errorBody(response, canReadAuxiliary ? MAX_STRUCTURED_BYTES : MAX_ERROR_BYTES);
            const failure = readProxyGenerationFailure(body);
            if (matched.active && failure) observer.fail(matched, new GenerationTransportError(failure));
            if (matched.active && !failure && canReadAuxiliary && matched.requests === 1) {
              try { if (auxiliary.isCurrent()) matched.auxiliary = auxiliary.read(body); }
              catch { /* Unavailable delivery evidence never corrupts Helper's response. */ }
            }
          }
          return response;
        });
      };
      try {
        this.host.fetch = wrapper;
        this.previous = previous;
        this.wrapper = wrapper;
      } catch {
        // A locked-down host can still generate normally. Fall back to the
        // exception's limited evidence rather than failing because of diagnostics.
        ++this.epoch;
      }
    }
    this.observations.add(observation);
    return { observation, close: () => {
      observation.active = false;
      observation.wire?.close();
      observation.auxiliary = undefined;
      this.observations.delete(observation);
      if (this.observations.size === 0) {
        ++this.epoch; // any externally retained wrapper becomes pass-through
        try { if (this.host.fetch === this.wrapper && this.previous) this.host.fetch = this.previous; }
        catch { /* The wrapper is already inactive if another extension locked it. */ }
        this.wrapper = undefined; this.previous = undefined;
      }
    } };
  }
}

const observers = new WeakMap<GenerationFetchHost, GenerationFetchObserver>();
/** Request-local scopes can be closed immediately on Helper cancellation even
 * if its underlying promise settles late. No diagnostic is published globally. */
export function createGenerationTransportBoundary(host: GenerationFetchHost = globalThis) {
  let observer = observers.get(host);
  if (!observer) { observer = new GenerationFetchObserver(host); observers.set(host, observer); }
  const active = new Map<string, Set<() => void>>();
  return {
    async run<T>(owner: GenerationRequestOwner, invoke: () => Promise<T>): Promise<T> {
      const scope = observer!.observe(owner);
      const cleanups = active.get(owner.generationId) || new Set<() => void>();
      cleanups.add(scope.close); active.set(owner.generationId, cleanups);
      const finishWire = async () => {
        const observation = scope.observation;
        if (!observation.active || observation.requests !== 1 || !observation.wire) return;
        // Give the clone a bounded opportunity to drain after Helper finishes.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([observation.wire.settled, new Promise<void>(resolve => { timer = setTimeout(resolve, 100); })]);
          if (!observation.active) return;
          const metadata = observation.wire.snapshot();
          try { owner.onNarrativeWire?.(metadata); } catch { /* Diagnostics are optional. */ }
          if (metadata.failure) observer!.fail(observation, new GenerationTransportError(metadata.failure));
        } finally { if (timer !== undefined) clearTimeout(timer); }
      };
      try {
        // Keep the Helper promise authoritative. A confirmed HTTP/SSE failure
        // is recorded immediately but does not add an automatic abort, retry,
        // timeout, or competing completion path.
        const result = await Promise.resolve().then(invoke);
        await finishWire();
        if (scope.observation.active && scope.observation.error) throw scope.observation.error;
        // SSE proxies can deliver their complete error wrapper as ordinary
        // assistant text. Inspect Helper's final only after one exact owned
        // request; do not infer errors from prose fragments or
        // attach unobserved/ambiguous/late output to this invocation.
        if (scope.observation.active && scope.observation.requests === 1 && typeof result === 'string') {
          const failure = readProxyGenerationFailure({ choices: [{ message: { role: 'assistant', content: result } }] });
          if (failure) throw new GenerationTransportError(failure);
        }
        if (scope.observation.active && scope.observation.requests === 1 && scope.observation.auxiliary
          && typeof result === 'string' && !result.trim()) {
          let current = false;
          try { current = owner.auxiliaryJson?.isCurrent() === true; } catch { /* Fail closed. */ }
          if (current) {
            try { owner.auxiliaryJson?.onRecovered(); } catch { /* Metadata must not alter delivery. */ }
            return scope.observation.auxiliary as T;
          }
        }
        return result;
      } catch (error) {
        if (!scope.observation.active) throw error;
        // Cancellation has higher precedence than a late failed response.
        let cancelled = false;
        try {
          const candidate = error as { name?: string; code?: string } | null;
          cancelled = candidate?.name === 'AbortError' || candidate?.code === 'cancelled' || candidate?.code === 'timeout';
        } catch { /* Preserve hostile/opaque exceptions without calling getters again here. */ }
        if (cancelled) throw error;
        await finishWire();
        throw scope.observation.error || normalizeGenerationTransportError(error);
      } finally {
        scope.close(); cleanups.delete(scope.close);
        if (active.get(owner.generationId) === cleanups && !cleanups.size) active.delete(owner.generationId);
      }
    },
    cancel(generationId: string): void {
      for (const close of active.get(generationId) || []) close();
      active.delete(generationId);
    },
  };
}
