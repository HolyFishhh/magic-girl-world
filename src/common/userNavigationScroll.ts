/**
 * Scroll policy for destinations reached by an explicit player action.
 *
 * Rendering and background battle/state updates must not call this helper: it
 * deliberately has no global listeners or side effects beyond one requested
 * destination. `nearest` preserves the reader's position whenever possible;
 * an oversized destination starts at its heading rather than centering its
 * (possibly very long) body in the viewport.
 */
export interface UserNavigationScrollTarget {
  readonly ownerDocument?: Document;
  getBoundingClientRect(): Pick<DOMRect, 'top' | 'bottom' | 'height'>;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
}

export function scrollUserNavigationTargetIntoView(
  target: UserNavigationScrollTarget,
  viewportHeight: number,
  alignment: 'start' | 'nearest' = 'nearest',
): boolean {
  const rect = target.getBoundingClientRect();
  // Auto-height message iframes can be much taller than the host's visible chat.
  // Local viewport containment alone must not suppress explicit navigation.
  let visibleInHost = true;
  try {
    let view = target.ownerDocument?.defaultView;
    let top = rect.top;
    let bottom = rect.bottom;
    while (view && view.parent !== view) {
      const frame = view.frameElement as HTMLElement | null;
      if (!frame) break;
      const frameRect = frame.getBoundingClientRect();
      top += frameRect.top + frame.clientTop;
      bottom += frameRect.top + frame.clientTop;
      view = frame.ownerDocument.defaultView;
      if (!view) break;
      if (top < 0 || bottom > view.innerHeight) visibleInHost = false;
      // SillyTavern's chat is itself a scroll container in the parent document.
      for (let ancestor = frame.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(view.getComputedStyle(ancestor).overflowY)) continue;
        const clip = ancestor.getBoundingClientRect();
        if (top < clip.top + ancestor.clientTop || bottom > clip.top + ancestor.clientTop + ancestor.clientHeight) {
          visibleInHost = false;
        }
      }
    }
  } catch {
    // Cross-origin host geometry cannot be inspected; native scrollIntoView can
    // still request ancestor scrolling without accessing the parent document.
    visibleInHost = false;
  }
  if (visibleInHost && Number.isFinite(viewportHeight) && viewportHeight > 0 && rect.top >= 0 && rect.bottom <= viewportHeight) {
    return false;
  }

  const isOversized = Number.isFinite(viewportHeight) && viewportHeight > 0 && rect.height > viewportHeight;
  target.scrollIntoView({
    behavior: 'smooth',
    block: isOversized ? 'start' : alignment,
    inline: 'nearest',
  });
  return true;
}

export function documentViewportHeight(document: Document): number {
  return document.defaultView?.innerHeight || document.documentElement.clientHeight || 0;
}