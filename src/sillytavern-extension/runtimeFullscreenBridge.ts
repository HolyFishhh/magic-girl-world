import { isMagicGirlWorldCharacter } from './characterScope';
import type { SillyTavernContext, SillyTavernEventSource } from './types';

const REQUEST_SPEC = 'mwg.runtime-fullscreen-request/v1';
const STATE_SPEC = 'mwg.runtime-fullscreen-state/v1';
const HOST_CLASS = 'mwg-runtime-fullscreen-host';

type RuntimeFullscreenRequest = Readonly<{
  spec: typeof REQUEST_SPEC;
  runtime: 'magic-girl-world';
  requestId: string;
  frameId: string;
  view: string;
  active: boolean;
}>;

type FullscreenSnapshot = Readonly<{
  frameStyle: string | null;
  bodyOverflow: string;
  htmlOverflow: string;
  hostStyles: ReadonlyArray<Readonly<{
    element: HTMLElement;
    style: string | null;
  }>>;
}>;

const FRAME_PROPERTIES: Readonly<Record<string, string>> = {
  position: 'fixed',
  inset: '0',
  top: '0',
  right: '0',
  bottom: '0',
  left: '0',
  width: '100vw',
  height: '100vh',
  'min-width': '100vw',
  'min-height': '100vh',
  'max-width': 'none',
  'max-height': 'none',
  margin: '0',
  padding: '0',
  border: '0',
  'border-radius': '0',
  display: 'block',
  transform: 'none',
  'z-index': '2147483000',
};

function isRequest(value: unknown): value is RuntimeFullscreenRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.spec === REQUEST_SPEC
    && candidate.runtime === 'magic-girl-world'
    && typeof candidate.requestId === 'string'
    && candidate.requestId.length > 0
    && typeof candidate.frameId === 'string'
    && (!candidate.frameId || candidate.frameId.startsWith('TH-message--'))
    && typeof candidate.view === 'string'
    && typeof candidate.active === 'boolean';
}

function isMagicGirlRuntimeFrame(frame: HTMLIFrameElement): boolean {
  const source = frame.getAttribute('srcdoc');
  if (!source) return true;
  return source.includes('mwg.tavern-runtime/v1')
    || source.includes("waitGlobalInitialized('MagicGirlWorld')")
    || source.includes('__MWG_RUNTIME_FRAME_HEIGHT_CONTROLLER__');
}

function frameMessageId(frame: HTMLIFrameElement): number | null {
  const match = /^TH-message--(\d+)--/.exec(frame.id);
  return match ? Number(match[1]) : null;
}

function latestMessageId(context: SillyTavernContext | null): number | null {
  return Array.isArray(context?.chat) && context.chat.length > 0 ? context.chat.length - 1 : null;
}

/**
 * Parent-window counterpart for runtimeFullscreen.ts. It deliberately accepts
 * requests only from the latest message iframe of the scoped character card.
 */
export function activateRuntimeFullscreenBridge(
  hostWindow: Window = window,
  hostDocument: Document = document,
  getContext: () => SillyTavernContext | null,
  eventSource?: SillyTavernEventSource | null,
): () => void {
  let activeFrame: HTMLIFrameElement | null = null;
  let snapshot: FullscreenSnapshot | null = null;

  const enforceFrameStyles = (frame: HTMLIFrameElement): void => {
    for (const [property, value] of Object.entries(FRAME_PROPERTIES)) {
      if (
        frame.style.getPropertyValue(property) !== value
        || frame.style.getPropertyPriority(property) !== 'important'
      ) frame.style.setProperty(property, value, 'important');
    }
  };

  const sendState = (
    frame: HTMLIFrameElement,
    requestId: string,
    accepted: boolean,
    active: boolean,
  ) => {
    frame.contentWindow?.postMessage({
      spec: STATE_SPEC,
      runtime: 'magic-girl-world',
      requestId,
      accepted,
      active,
    }, '*');
  };

  const restore = (notify = true): void => {
    const frame = activeFrame;
    const previous = snapshot;
    activeFrame = null;
    snapshot = null;
    if (frame && previous) {
      if (previous.frameStyle === null) frame.removeAttribute('style');
      else frame.setAttribute('style', previous.frameStyle);
      for (const entry of [...previous.hostStyles].reverse()) {
        if (entry.style === null) entry.element.removeAttribute('style');
        else entry.element.setAttribute('style', entry.style);
      }
      hostDocument.body.style.overflow = previous.bodyOverflow;
      hostDocument.documentElement.style.overflow = previous.htmlOverflow;
      frame.removeAttribute('data-mwg-runtime-fullscreen');
      if (notify && frame.isConnected) sendState(frame, '', true, false);
    }
    hostDocument.body?.classList.remove(HOST_CLASS);
    hostDocument.documentElement.classList.remove(HOST_CLASS);
  };

  const resolveFrame = (
    request: RuntimeFullscreenRequest,
    source: MessageEventSource | null,
  ): HTMLIFrameElement | null => {
    const context = getContext();
    if (!isMagicGirlWorldCharacter(context)) return null;
    const expectedMessageId = latestMessageId(context);
    if (expectedMessageId === null) return null;
    const frames = Array.from(
      hostDocument.querySelectorAll<HTMLIFrameElement>('iframe[id^="TH-message--"]'),
    );
    const byId = request.frameId ? hostDocument.getElementById(request.frameId) : null;
    const frame = byId instanceof HTMLIFrameElement
      ? byId
      : frames.find(candidate => candidate.contentWindow === source) || null;
    if (!frame || !isMagicGirlRuntimeFrame(frame)) return null;
    if (source && frame.contentWindow !== source) return null;
    if (frameMessageId(frame) !== expectedMessageId) return null;
    return frame;
  };

  const enter = (frame: HTMLIFrameElement): void => {
    if (activeFrame === frame && snapshot) return;
    restore(false);
    const ancestorChain: HTMLElement[] = [];
    let ancestor = frame.parentElement;
    while (ancestor && ancestor !== hostDocument.body) {
      ancestorChain.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    const rootBranch = ancestorChain.at(-1) || frame;
    const chrome = [
      ...Array.from(hostDocument.body.children),
      ...Array.from(hostDocument.querySelectorAll<HTMLElement>(
        '#top-settings-holder, #form_sheld, #send_form, #chat_pagination, #mwg-mvu-monitor',
      )),
    ].filter((element): element is HTMLElement => (
      element instanceof HTMLElement
      && element !== rootBranch
      && !element.contains(frame)
    ));
    const hostElements = [...new Set<HTMLElement>([...ancestorChain, ...chrome])];
    snapshot = {
      frameStyle: frame.getAttribute('style'),
      bodyOverflow: hostDocument.body.style.overflow,
      htmlOverflow: hostDocument.documentElement.style.overflow,
      hostStyles: hostElements.map(element => ({ element, style: element.getAttribute('style') })),
    };
    activeFrame = frame;
    for (const element of ancestorChain) {
      element.style.setProperty('overflow', 'visible', 'important');
      element.style.setProperty('overflow-x', 'visible', 'important');
      element.style.setProperty('overflow-y', 'visible', 'important');
      element.style.setProperty('contain', 'none', 'important');
      element.style.setProperty('clip-path', 'none', 'important');
      element.style.setProperty('z-index', '2147482000', 'important');
    }
    for (const element of chrome) {
      element.style.setProperty('visibility', 'hidden', 'important');
      element.style.setProperty('opacity', '0', 'important');
      element.style.setProperty('pointer-events', 'none', 'important');
    }
    enforceFrameStyles(frame);
    frame.setAttribute('data-mwg-runtime-fullscreen', 'true');
    hostDocument.body.style.overflow = 'hidden';
    hostDocument.documentElement.style.overflow = 'hidden';
    hostDocument.body.classList.add(HOST_CLASS);
    hostDocument.documentElement.classList.add(HOST_CLASS);
  };

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (!isRequest(event.data)) return;
    const frame = resolveFrame(event.data, event.source);
    if (!frame) return;
    if (event.data.active) enter(frame);
    else if (activeFrame === frame) restore(false);
    sendState(frame, event.data.requestId, true, event.data.active);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && activeFrame) restore(true);
  };
  const onScopeChanged = (): void => restore(true);

  hostWindow.addEventListener('message', onMessage);
  hostDocument.addEventListener('keydown', onKeyDown);
  eventSource?.on('chat_id_changed', onScopeChanged);
  eventSource?.on('chatLoaded', onScopeChanged);

  const MutationObserverCtor = (hostWindow as Window & typeof globalThis).MutationObserver;
  const observer = typeof MutationObserverCtor === 'function' && hostDocument.body
    ? new MutationObserverCtor(() => {
        if (activeFrame && !activeFrame.isConnected) restore(false);
        else if (activeFrame) enforceFrameStyles(activeFrame);
      })
    : null;
  observer?.observe(hostDocument.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style'],
  });

  return () => {
    restore(true);
    observer?.disconnect();
    hostWindow.removeEventListener('message', onMessage);
    hostDocument.removeEventListener('keydown', onKeyDown);
    eventSource?.removeListener?.('chat_id_changed', onScopeChanged);
    eventSource?.removeListener?.('chatLoaded', onScopeChanged);
  };
}
