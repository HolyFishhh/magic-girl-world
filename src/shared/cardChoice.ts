/**
 * Card faces contain references and detail controls.  A surrounding choice
 * surface must leave those interactions alone instead of treating them as a
 * choice click.
 */
export function isCardFaceDetailInteraction(target: EventTarget | null): boolean {
  const element = target as Element | null;
  const detail = element?.closest?.('a,[data-content-reference],.mwg-status-reference,.card-preview-trigger,details');
  if (!detail) return false;
  // Only detail controls INSIDE the choice own its click. The whole battle
  // lives in an open <details> fold; that ancestor must not swallow selection.
  const choice = element?.closest('.mwg-card-choice');
  return !choice || detail.closest('.mwg-card-choice') === choice;
}
