type RuntimeFrameHeightController = Readonly<{
  request: () => void;
  destroy: () => void;
}>;

const CONTROLLER_KEY = '__MWG_RUNTIME_FRAME_HEIGHT_CONTROLLER__';
const MIN_FRAME_HEIGHT = 150;

function runtimeHost(): typeof globalThis & Record<string, any> {
  return globalThis as typeof globalThis & Record<string, any>;
}

function resolveFrameElement(): HTMLElement | null {
  try {
    const frame = window.frameElement as HTMLElement | null;
    return frame?.style ? frame : null;
  } catch {
    return null;
  }
}

function isFullscreen(frame: HTMLElement): boolean {
  try {
    return Boolean(
      document.fullscreenElement ||
        frame.ownerDocument?.fullscreenElement === frame ||
        document.documentElement.classList.contains('mwg-fullscreen-active'),
    );
  } catch {
    return document.documentElement.classList.contains('mwg-fullscreen-active');
  }
}

function measureDocumentHeight(): number {
  const body = document.body;
  const root = document.documentElement;
  // `documentElement.scrollHeight` is never smaller than the iframe viewport.
  // After an in-place common -> fish switch that viewport can still be several
  // thousand pixels tall, so feeding it back into the parent creates a height
  // ratchet that can grow but never shrink. Body metrics and root.offsetHeight
  // describe the mounted view without inheriting that stale viewport height.
  return Math.max(
    MIN_FRAME_HEIGHT,
    Math.ceil(body?.scrollHeight || 0),
    Math.ceil(body?.offsetHeight || 0),
    Math.ceil(root?.offsetHeight || 0),
  );
}

function createRuntimeFrameHeightController(frame: HTMLElement): RuntimeFrameHeightController {
  let destroyed = false;
  let scheduled = false;
  let animationFrame = 0;
  const timers = new Set<number>();

  const sync = () => {
    scheduled = false;
    animationFrame = 0;
    if (destroyed || isFullscreen(frame)) return;
    const nextHeight = `${measureDocumentHeight()}px`;
    if (frame.style.height !== nextHeight) frame.style.height = nextHeight;
  };

  const request = () => {
    if (destroyed || scheduled) return;
    scheduled = true;
    if (typeof window.requestAnimationFrame === 'function') {
      animationFrame = window.requestAnimationFrame(sync);
    } else {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        sync();
      }, 0);
      timers.add(timer);
    }
  };

  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => request())
      : null;
  resizeObserver?.observe(document.documentElement);
  if (document.body) resizeObserver?.observe(document.body);

  const mutationObserver =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => request())
      : null;
  if (document.body) {
    mutationObserver?.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  const frameObserver =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => request())
      : null;
  frameObserver?.observe(frame, { attributes: true, attributeFilter: ['style', 'class'] });

  const onResize = () => request();
  const onFullscreenChange = () => request();
  window.addEventListener('resize', onResize);
  window.addEventListener('load', onResize);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  frame.ownerDocument?.addEventListener('fullscreenchange', onFullscreenChange);

  // Fonts, images, and the dynamically mounted view can settle on different
  // tasks. These delayed passes cover browsers without ResizeObserver as well.
  for (const delay of [0, 120, 480, 1200]) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      request();
    }, delay);
    timers.add(timer);
  }

  const controller: RuntimeFrameHeightController = {
    request,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      frameObserver?.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('load', onResize);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      frame.ownerDocument?.removeEventListener('fullscreenchange', onFullscreenChange);
      if (animationFrame && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(animationFrame);
      }
      timers.forEach(timer => window.clearTimeout(timer));
      timers.clear();
      const host = runtimeHost();
      if (host[CONTROLLER_KEY] === controller) delete host[CONTROLLER_KEY];
    },
  };
  return controller;
}

/**
 * Keep Tavern Helper's message iframe as tall as the active runtime view.
 * Tavern Helper measures the tiny bootstrap shell before our shared bundle is
 * mounted, so a restored chat otherwise remains stuck at its 150px fallback.
 */
export function ensureRuntimeFrameHeightSync(): RuntimeFrameHeightController | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const host = runtimeHost();
  const existing = host[CONTROLLER_KEY] as RuntimeFrameHeightController | undefined;
  if (existing) {
    existing.request();
    return existing;
  }

  const frame = resolveFrameElement();
  if (!frame) return null;
  const controller = createRuntimeFrameHeightController(frame);
  host[CONTROLLER_KEY] = controller;
  window.addEventListener('pagehide', controller.destroy, { once: true });
  controller.request();
  return controller;
}
