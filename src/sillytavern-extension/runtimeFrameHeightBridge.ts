import { subscribeTavernHelperRequestEvent } from './tavernHelperEventSubscription';

const FRAME_HEIGHT_SPEC = 'mwg.runtime-frame-height/v1';
const FRAME_HEIGHT_EVENT = 'mwg_runtime_frame_height';
const MIN_FRAME_HEIGHT = 150;
const MAX_FRAME_HEIGHT = 6000;
const DESKTOP_FALLBACK_HEIGHT = 1000;
const MOBILE_FALLBACK_HEIGHT = 1280;

type RuntimeFrameHeightMessage = Readonly<{
  spec: typeof FRAME_HEIGHT_SPEC;
  runtime: 'magic-girl-world';
  frameId: string;
  view?: string;
  height: number;
}>;

type RuntimeFrameHeightEventSource = Readonly<{
  on(event: string, listener: (...args: any[]) => unknown): void;
  removeListener?(event: string, listener: (...args: any[]) => unknown): void;
}>;

function isRuntimeFrameHeightMessage(value: unknown): value is RuntimeFrameHeightMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.spec === FRAME_HEIGHT_SPEC
    && candidate.runtime === 'magic-girl-world'
    && typeof candidate.frameId === 'string'
    && (!candidate.frameId || candidate.frameId.startsWith('TH-message--'))
    && typeof candidate.height === 'number'
    && Number.isFinite(candidate.height);
}

function isMagicGirlRuntimeFrame(frame: HTMLIFrameElement): boolean {
  const source = frame.getAttribute('srcdoc');
  // Source-document mode lets us prove the message came from this character
  // runtime. Blob mode cannot expose its source, but remains source-window and
  // frame-id scoped by the message handler below.
  return !source
    || source.includes('mwg.tavern-runtime/v1')
    || source.includes("waitGlobalInitialized('MagicGirlWorld')")
    || source.includes('__MWG_RUNTIME_FRAME_HEIGHT_CONTROLLER__');
}

/**
 * Cross-origin bridge for Tavern Helper message iframes. Restored srcdoc
 * frames can lose `window.frameElement`, so the character view reports its
 * measured height and the parent extension applies it to that exact iframe.
 */
export function activateRuntimeFrameHeightBridge(
  hostWindow: Window = window,
  hostDocument: Document = document,
  eventSource?: RuntimeFrameHeightEventSource | null,
  getTavernHelper: () => unknown = () => (globalThis as Record<string, any>).TavernHelper,
): () => void {
  const applyHeight = (payload: unknown, source: MessageEventSource | null = null): void => {
    if (!isRuntimeFrameHeightMessage(payload)) return;
    const idFrame = payload.frameId ? hostDocument.getElementById(payload.frameId) : null;
    const runtimeFrames = Array.from(
      hostDocument.querySelectorAll<HTMLIFrameElement>('iframe[id^="TH-message--"]'),
    ).filter(isMagicGirlRuntimeFrame);
    const frame = idFrame instanceof HTMLIFrameElement
      ? idFrame
      : runtimeFrames.find(candidate => candidate.contentWindow === source)
        || runtimeFrames.at(-1);
    if (!frame) return;
    if (source && frame.contentWindow !== source) return;
    if (!isMagicGirlRuntimeFrame(frame)) return;
    if (frame.hasAttribute('data-mwg-runtime-fullscreen')) return;
    const height = Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.ceil(payload.height)));
    const nextHeight = `${height}px`;
    if (frame.style.height !== nextHeight) frame.style.height = nextHeight;
  };
  const onMessage = (event: MessageEvent<unknown>): void => applyHeight(event.data, event.source);
  const onHelperEvent = (payload: unknown): void => applyHeight(payload);
  hostWindow.addEventListener('message', onMessage);
  eventSource?.on(FRAME_HEIGHT_EVENT, onHelperEvent);
  let unsubscribeTavernHelper: (() => void) | null = null;
  let helperBindAttempts = 0;
  let helperBindTimer = 0;
  const bindTavernHelper = (): void => {
    if (unsubscribeTavernHelper || helperBindAttempts >= 240) return;
    helperBindAttempts += 1;
    unsubscribeTavernHelper = subscribeTavernHelperRequestEvent(
      getTavernHelper(),
      FRAME_HEIGHT_EVENT,
      onHelperEvent,
      'MWG-runtime-frame-height-bridge',
    );
    if (unsubscribeTavernHelper && helperBindTimer) {
      hostWindow.clearInterval(helperBindTimer);
      helperBindTimer = 0;
    }
  };
  bindTavernHelper();
  if (!unsubscribeTavernHelper) helperBindTimer = hostWindow.setInterval(bindTavernHelper, 250);
  const MutationObserverCtor = (hostWindow as Window & typeof globalThis).MutationObserver;
  const fallbackTimers = new Map<HTMLIFrameElement, number>();
  const scheduleFallbackHeights = (): void => {
    if (typeof MutationObserverCtor !== 'function') return;
    Array.from(hostDocument.querySelectorAll<HTMLIFrameElement>('iframe[id^="TH-message--"]'))
      .filter(isMagicGirlRuntimeFrame)
      .forEach(frame => {
        if (frame.hasAttribute('data-mwg-runtime-fullscreen')) return;
        if (frame.getBoundingClientRect().height > MIN_FRAME_HEIGHT + 10 || fallbackTimers.has(frame)) return;
        const timer = hostWindow.setTimeout(() => {
          fallbackTimers.delete(frame);
          if (frame.hasAttribute('data-mwg-runtime-fullscreen')) return;
          if (!frame.isConnected || frame.getBoundingClientRect().height > MIN_FRAME_HEIGHT + 10) return;
          const height = hostWindow.innerWidth <= 760 ? MOBILE_FALLBACK_HEIGHT : DESKTOP_FALLBACK_HEIGHT;
          frame.style.height = `${height}px`;
        }, 2000);
        fallbackTimers.set(frame, timer);
      });
  };
  const fallbackObserver = typeof MutationObserverCtor === 'function'
    ? new MutationObserverCtor(scheduleFallbackHeights)
    : null;
  if (fallbackObserver && hostDocument.body) {
    fallbackObserver.observe(hostDocument.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    scheduleFallbackHeights();
  }
  return () => {
    hostWindow.removeEventListener('message', onMessage);
    eventSource?.removeListener?.(FRAME_HEIGHT_EVENT, onHelperEvent);
    unsubscribeTavernHelper?.();
    if (helperBindTimer) hostWindow.clearInterval(helperBindTimer);
    fallbackObserver?.disconnect();
    fallbackTimers.forEach(timer => hostWindow.clearTimeout(timer));
    fallbackTimers.clear();
  };
}
