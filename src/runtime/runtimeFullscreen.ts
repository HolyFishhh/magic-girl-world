export const RUNTIME_FULLSCREEN_REQUEST_SPEC = 'mwg.runtime-fullscreen-request/v1' as const;
export const RUNTIME_FULLSCREEN_STATE_SPEC = 'mwg.runtime-fullscreen-state/v1' as const;

export type RuntimeFullscreenView = 'common' | 'fish' | 'start' | 'update' | 'tower';

type RuntimeFullscreenStateMessage = Readonly<{
  spec: typeof RUNTIME_FULLSCREEN_STATE_SPEC;
  runtime: 'magic-girl-world';
  requestId: string;
  accepted: boolean;
  active: boolean;
}>;

let fullscreenRequestSequence = 0;

function runtimeFrameId(): string {
  try {
    return String((window.frameElement as HTMLElement | null)?.id || '');
  } catch {
    return '';
  }
}

function isFullscreenStateMessage(value: unknown): value is RuntimeFullscreenStateMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.spec === RUNTIME_FULLSCREEN_STATE_SPEC
    && candidate.runtime === 'magic-girl-world'
    && typeof candidate.requestId === 'string'
    && typeof candidate.accepted === 'boolean'
    && typeof candidate.active === 'boolean';
}

/**
 * Ask the card-scoped top-window extension to lift this message iframe out of
 * SillyTavern's narrow message column. A short acknowledgement timeout keeps
 * the existing native/in-frame fallback usable when the extension is absent.
 */
export function requestRuntimeParentFullscreen(
  active: boolean,
  view: RuntimeFullscreenView,
  timeoutMs = 700,
): Promise<boolean> {
  if (typeof window === 'undefined' || window.parent === window) return Promise.resolve(false);
  const requestId = `mwg-fullscreen-${Date.now()}-${++fullscreenRequestSequence}`;
  return new Promise(resolve => {
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(accepted);
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isFullscreenStateMessage(event.data)) return;
      if (event.data.requestId !== requestId) return;
      finish(event.data.accepted && event.data.active === active);
    };
    const timer = window.setTimeout(() => finish(false), Math.max(100, timeoutMs));
    window.addEventListener('message', onMessage);
    window.parent.postMessage({
      spec: RUNTIME_FULLSCREEN_REQUEST_SPEC,
      runtime: 'magic-girl-world',
      requestId,
      frameId: runtimeFrameId(),
      view,
      active,
    }, '*');
  });
}

/** Keep iframe UI state in sync when the host exits with Escape or on cleanup. */
export function subscribeRuntimeParentFullscreen(
  listener: (active: boolean) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onMessage = (event: MessageEvent<unknown>) => {
    if (!isFullscreenStateMessage(event.data)) return;
    if (!event.data.accepted) return;
    document.documentElement.classList.toggle('mwg-fullscreen-active', event.data.active);
    listener(event.data.active);
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
