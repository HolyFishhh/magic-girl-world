/** Keep a modal in the visible part of a possibly tall Tavern message iframe. */
export function pinSelectionToVisibleViewport(dialog: HTMLElement): () => void {
  const view = dialog.ownerDocument.defaultView;
  if (!view) return () => {};
  const windows: Window[] = [view];
  try {
    let current: Window = view;
    while (current.parent !== current && current.frameElement) {
      current = current.parent;
      void current.document.documentElement;
      windows.push(current);
    }
  } catch {
    /* Opaque embedding: constrain to the local viewport. */
  }
  const bounds = (current: Window): { left: number; top: number; right: number; bottom: number } => {
    const vv = current.visualViewport;
    const left = vv?.offsetLeft || 0,
      top = vv?.offsetTop || 0;
    let box = {
      left,
      top,
      right: left + (vv?.width || current.innerWidth),
      bottom: top + (vv?.height || current.innerHeight),
    };
    try {
      const frame = current.frameElement as HTMLElement | null;
      if (frame && current.parent !== current) {
        const parent = bounds(current.parent),
          rect = frame.getBoundingClientRect();
        const sx = rect.width / (frame.offsetWidth || rect.width) || 1;
        const sy = rect.height / (frame.offsetHeight || rect.height) || 1;
        const x = rect.left + frame.clientLeft * sx,
          y = rect.top + frame.clientTop * sy;
        // Parent chat panes may clip before the actual browser viewport edge.
        for (let ancestor = frame.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = current.parent.getComputedStyle(ancestor),
            r = ancestor.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            parent.left = Math.max(parent.left, r.left);
            parent.right = Math.min(parent.right, r.right);
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            parent.top = Math.max(parent.top, r.top);
            parent.bottom = Math.min(parent.bottom, r.bottom);
          }
        }
        box = {
          left: Math.max(box.left, (parent.left - x) / sx),
          top: Math.max(box.top, (parent.top - y) / sy),
          right: Math.min(box.right, (parent.right - x) / sx),
          bottom: Math.min(box.bottom, (parent.bottom - y) / sy),
        };
      }
    } catch {
      /* Same local-viewport fallback. */
    }
    return box;
  };
  const place = () => {
    const box = bounds(view),
      width = Math.max(1, box.right - box.left),
      height = Math.max(1, box.bottom - box.top);
    const pad = Math.min(12, width / 8, height / 8);
    dialog.style.position = 'fixed';
    dialog.style.margin = '0';
    dialog.style.inset = 'auto';
    dialog.style.width = `${Math.min(660, width - pad * 2)}px`;
    dialog.style.maxWidth = `${width - pad * 2}px`;
    dialog.style.maxHeight = `${height - pad * 2}px`;
    const rect = dialog.getBoundingClientRect();
    dialog.style.left = `${box.left + Math.max(pad, (width - rect.width) / 2)}px`;
    dialog.style.top = `${box.top + Math.max(pad, (height - rect.height) / 2)}px`;
  };
  for (const win of windows) {
    win.addEventListener('resize', place);
    win.addEventListener('scroll', place, true);
    win.visualViewport?.addEventListener('resize', place);
    win.visualViewport?.addEventListener('scroll', place);
  }
  const observer = new ResizeObserver(place);
  observer.observe(dialog);
  place();
  return () => {
    observer.disconnect();
    for (const win of windows) {
      win.removeEventListener('resize', place);
      win.removeEventListener('scroll', place, true);
      win.visualViewport?.removeEventListener('resize', place);
      win.visualViewport?.removeEventListener('scroll', place);
    }
  };
}
