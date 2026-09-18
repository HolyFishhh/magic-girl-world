/** Let the reader locate a surface after an explicit action scrolls it into view. */
export function highlightFocusedSurface(target: HTMLElement | null | undefined): void {
  if (!target || typeof target.animate !== 'function') return;
  const reduced = target.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  target.animate([
    { outline: '2px solid transparent', outlineOffset: '3px' },
    { outline: '2px solid #f6da85', outlineOffset: '3px', offset: 0.2 },
    { outline: '2px solid #f6da85', outlineOffset: '3px', offset: reduced ? 0.9 : 0.65 },
    { outline: '2px solid transparent', outlineOffset: '3px' },
  ], { duration: 1500, iterations: 1 });
}
