export type CardClickAction = 'select' | 'play';
export type CardDropAction = 'none' | 'restore' | 'play';

export interface CardDragSlot {
  parent: HTMLElement;
  placeholder: HTMLElement;
  originalStyle: string | null;
}

/** A second click on the same real card plays it; every other click selects it. */
export function resolveCardClickAction(
  selectedElement: Element | null | undefined,
  clickedElement: Element | null | undefined,
): CardClickAction {
  return selectedElement && clickedElement && selectedElement === clickedElement ? 'play' : 'select';
}

/** Pointer cancellation and every drop outside the cast zone restore the real card. */
export function resolveCardDropAction(input: {
  dragActive: boolean;
  pointerCancelled: boolean;
  insidePlayArea: boolean;
}): CardDropAction {
  if (!input.dragActive) return 'none';
  return !input.pointerCancelled && input.insidePlayArea ? 'play' : 'restore';
}

/**
 * A hidden window can suppress the terminal pointer event. Only a card that
 * was actually moved out of its hand slot needs restoration on interruption.
 */
export function shouldRestoreInterruptedDrag(dragActive: boolean, hasReservedSlot: boolean): boolean {
  return dragActive && hasReservedSlot;
}

/**
 * Put the one real card immediately before its invisible slot marker. The DOM
 * slot, rather than a remembered rectangle, is the source of truth.
 */
export function restoreDraggedElementToSlot(element: HTMLElement, slot: CardDragSlot): void {
  if (slot.originalStyle === null) element.removeAttribute('style');
  else element.setAttribute('style', slot.originalStyle);

  const placeholderParent = slot.placeholder.parentNode;
  if (placeholderParent) {
    placeholderParent.insertBefore(element, slot.placeholder);
    slot.placeholder.remove();
    return;
  }
  slot.parent.appendChild(element);
}
