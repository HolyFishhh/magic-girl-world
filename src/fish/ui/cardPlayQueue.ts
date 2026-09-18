/** UI requests wait here; the authoritative transaction still revalidates each card. */
export class CardPlayQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Set<string>();
  private disposed = false;
  get busy(): boolean { return this.pending.size > 0; }
  enqueue(id: string, execute: () => Promise<void>): Promise<void> {
    if (this.disposed || this.pending.has(id)) return Promise.resolve();
    this.pending.add(id);
    const next = this.tail.then(async () => {
      if (!this.disposed) await execute();
    });
    this.tail = next.catch(() => undefined).then(() => { this.pending.delete(id); });
    return next.finally(() => { this.pending.delete(id); });
  }
  dispose(): void { this.disposed = true; }
}

/** Fade only after the queued card has resolved, not after its arrival timer. */
export async function finishQueuedCardVisual(card: JQuery): Promise<void> {
  card.addClass('card-queue-resolved');
  await new Promise<void>(resolve => window.setTimeout(resolve, 120));
  card.get(0)?.getAnimations().forEach(animation => animation.cancel());
  card.remove();
}

export function captureQueuedCardVisual(cardId: string): { begin: () => Promise<void>; finish: () => Promise<void> } {
  const card = $('.card-cast-flight').filter((_, element) => element.dataset.cardId === cardId).first();
  return {
    async begin() {
      await card.data('visualPlayReady');
      card.attr('data-queue-state', 'playing').attr('aria-label', '正在出牌');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    },
    finish: () => finishQueuedCardVisual(card),
  };
}
export function clearQueuedCardVisuals(): void { $('.card-cast-flight').remove(); }
