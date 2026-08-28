export interface BattleFullscreenFallbackSnapshot {
  frameStyle: string | null;
  bodyOverflow: string;
  htmlOverflow: string;
}

const FRAME_PROPERTIES: Readonly<Record<string, string>> = {
  position: 'fixed',
  inset: '0',
  width: '100vw',
  height: '100vh',
  'max-width': 'none',
  'max-height': 'none',
  margin: '0',
  border: '0',
  'border-radius': '0',
  'z-index': '2147483000',
};

/** Apply the reversible fixed-viewport fallback used when native fullscreen is denied. */
export function enterBattleFullscreenFallback(
  frame: HTMLElement,
  parentDocument: Document,
): BattleFullscreenFallbackSnapshot {
  const snapshot = {
    frameStyle: frame.getAttribute('style'),
    bodyOverflow: parentDocument.body.style.overflow,
    htmlOverflow: parentDocument.documentElement.style.overflow,
  };
  for (const [property, value] of Object.entries(FRAME_PROPERTIES)) {
    frame.style.setProperty(property, value, 'important');
  }
  parentDocument.body.style.overflow = 'hidden';
  parentDocument.documentElement.style.overflow = 'hidden';
  return snapshot;
}

/** Restore the exact inline frame style and host overflow values captured on entry. */
export function exitBattleFullscreenFallback(
  frame: HTMLElement,
  parentDocument: Document,
  snapshot: BattleFullscreenFallbackSnapshot,
): void {
  if (snapshot.frameStyle === null) frame.removeAttribute('style');
  else frame.setAttribute('style', snapshot.frameStyle);
  parentDocument.body.style.overflow = snapshot.bodyOverflow;
  parentDocument.documentElement.style.overflow = snapshot.htmlOverflow;
}
