/** Resize only this message frame without letting chat scroll anchoring select it.
 * No timers or global scroll handler: explicit navigation and later user scroll remain free.
 */
import { isNavigationFocusSettling } from './navigationFocus';

export function setRuntimeFrameHeight(frame: HTMLElement, height: string): void {
  if (frame.style.height === height) return;
  frame.style.overflowAnchor = 'none';
  const positions: Array<{ element: HTMLElement; top: number; left: number }> = [];
  const seen = new Set<HTMLElement>();
  const remember = (element: HTMLElement | null | undefined): void => {
    if (!element || seen.has(element)) return;
    seen.add(element);
    // Some Tavern themes scroll the chat through the document scroller rather
    // than an iframe ancestor, so preserve that owner as well.
    if (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) {
      element.style.overflowAnchor = 'none';
      positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
    }
  };
  for (let element = frame.parentElement; element; element = element.parentElement) {
    remember(element);
  }
  remember(frame.ownerDocument?.scrollingElement as HTMLElement | null);
  const restore = () => {
    if (isNavigationFocusSettling()) return;
    for (const { element, top, left } of positions) {
      if (element.scrollTop !== top) element.scrollTop = top;
      if (element.scrollLeft !== left) element.scrollLeft = left;
    }
  };
  frame.style.height = height;
  // ResizeObserver and delayed font/layout passes may anchor after the style
  // write. Restore now and over two frames, without adding global scrolling.
  restore();
  const view = frame.ownerDocument?.defaultView;
  if (!view?.requestAnimationFrame) return;
  let cancelledByUser = false;
  const userNavigation = (event: Event) => {
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(key)) return;
    }
    cancelledByUser = true;
  };
  const document = frame.ownerDocument;
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  events.forEach(type => document?.addEventListener(type, userNavigation, { capture: true, passive: true }));
  const release = () => events.forEach(type => document?.removeEventListener(type, userNavigation, { capture: true }));
  view.requestAnimationFrame(() => {
    if (!cancelledByUser) restore();
    view.requestAnimationFrame(() => {
      if (!cancelledByUser) restore();
      release();
    });
  });
}
