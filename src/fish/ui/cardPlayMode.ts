/**
 * Unified card interaction: drag and two-click play are always available.
 */

import { BattleUI } from './battleUI';
import {
  resolveCardClickAction,
  resolveCardDropAction,
  restoreDraggedElementToSlot,
  type CardDragSlot,
  type CardDropAction,
} from './cardPlayInteraction';

export class CardPlayMode {
  private static instance: CardPlayMode;
  private selectedCard: JQuery | null = null;
  private draggedCard: JQuery | null = null;
  private dragTooltip: JQuery | null = null;
  private dragSlot: CardDragSlot | null = null;
  private dragPointerId: number | null = null;
  private dragOrigin: { x: number; y: number } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private pendingPointer: { x: number; y: number } | null = null;
  private dragFrame: number | null = null;
  private playAreaRect: DOMRect | null = null;
  private pointerDragActive = false;
  private justEndedDrag = false;
  private initialized = false;

  private constructor() {}

  public static getInstance(): CardPlayMode {
    if (!CardPlayMode.instance) CardPlayMode.instance = new CardPlayMode();
    return CardPlayMode.instance;
  }

  public init(): void {
    if (this.initialized) return;
    document.documentElement.classList.add('card-play-unified');
    $(document)
      .off('.mwgPointerCardPlay')
      .on('pointermove.mwgPointerCardPlay', event => this.handlePointerMove(event as JQuery.Event))
      .on('pointerup.mwgPointerCardPlay pointercancel.mwgPointerCardPlay', event =>
        this.handlePointerEnd(event as JQuery.Event),
      )
      .on('click.mwgPointerCardPlay', event => {
        if ($(event.target).closest('.enhanced-card').length === 0) this.clearSelection();
      });
    this.initialized = true;
  }

  private clearSelection(): void {
    if (!this.selectedCard) return;
    this.selectedCard.removeClass('selected').removeAttr('aria-pressed');
    this.selectedCard = null;
  }

  private selectCard(card: JQuery): void {
    this.clearSelection();
    this.selectedCard = card;
    card.addClass('selected').attr('aria-pressed', 'true');
    const cardData = card.data('cardData');
    if (cardData) BattleUI.showCardTooltip(card, cardData);
  }

  private requestPlay(card: JQuery): void {
    if (!card.hasClass('clickable') || card.data('playPending')) return;
    this.clearSelection();
    card
      .data('playPending', true)
      .removeClass('clickable selected')
      .addClass('card-playing')
      .attr('aria-disabled', 'true');
    card.trigger('mwg:play-card');
  }

  private handleCardClick(event: JQuery.Event, card: JQuery): void {
    event.preventDefault();
    event.stopPropagation();
    if (!card.hasClass('clickable') || card.data('suppressPlayClick') || card.data('justEndedDrag')) return;
    if (resolveCardClickAction(this.selectedCard?.get(0), card.get(0)) === 'play') {
      this.requestPlay(card);
      return;
    }
    this.selectCard(card);
  }

  private hideCardDetail(): void {
    $('.card-tooltip').stop(true, true).remove();
  }

  /**
   * Reserve the exact hand slot, then move the one real card to the viewport.
   * The slot—not a geometry calculation—is the source of truth on cancel.
   */
  private beginVisualDrag(card: JQuery): boolean {
    const element = card.get(0) as HTMLElement | undefined;
    const parent = element?.parentElement;
    if (!element || !parent) return false;

    const rect = element.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.className = 'card-drag-slot';
    placeholder.setAttribute('aria-hidden', 'true');
    const originalStyle = element.getAttribute('style');
    if (originalStyle === null) placeholder.removeAttribute('style');
    else placeholder.setAttribute('style', originalStyle);
    parent.insertBefore(placeholder, element);
    this.dragSlot = { parent, placeholder, originalStyle };

    if ($('.card-tooltip').length === 0) {
      const cardData = card.data('cardData');
      if (cardData) BattleUI.showCardTooltip(card, cardData);
    }
    this.dragTooltip = $('.card-tooltip').last();
    this.dragTooltip.css({ pointerEvents: 'none', transition: 'none', willChange: 'transform' });
    card.removeClass('card-hover selected').removeAttr('aria-pressed').addClass('dragging');
    document.body.appendChild(element);
    if (this.dragPointerId !== null) element.setPointerCapture?.(this.dragPointerId);
    card.css({
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      bottom: 'auto',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      maxHeight: 'none',
      margin: 0,
      opacity: 1,
      pointerEvents: 'none',
      transform: 'translate3d(0, 0, 0)',
      transition: 'none',
      zIndex: 3000,
    });
    this.playAreaRect = document.getElementById('playArea')?.getBoundingClientRect() || null;
    return true;
  }

  private scheduleDragVisual(x: number, y: number): void {
    this.pendingPointer = { x, y };
    if (this.dragFrame !== null) return;
    this.dragFrame = requestAnimationFrame(() => {
      this.dragFrame = null;
      this.applyDragVisual();
    });
  }

  private applyDragVisual(): void {
    if (!this.draggedCard || !this.dragOrigin || !this.pendingPointer) return;
    const { x, y } = this.pendingPointer;
    const previous = this.lastPointer || this.dragOrigin;
    const tilt = Math.max(-8, Math.min(8, (x - previous.x) * 0.5));
    this.lastPointer = { x, y };
    const dx = x - this.dragOrigin.x;
    const dy = y - this.dragOrigin.y;
    this.draggedCard.css('transform', `translate3d(${dx}px, ${dy}px, 0) rotate(${tilt}deg) scale(1.035)`);
    this.dragTooltip?.css('transform', `translate3d(${dx}px, ${dy}px, 0)`);
    const insidePlayArea = this.isPointInPlayArea(x, y);
    $('#playArea').toggleClass('active', insidePlayArea);
    this.draggedCard.toggleClass('is-cast-ready', insidePlayArea);
  }

  private restoreCardToSlot(card: JQuery, slot: CardDragSlot): void {
    const element = card.get(0) as HTMLElement | undefined;
    if (!element) return;
    card.removeClass('dragging is-cast-ready card-playing');

    restoreDraggedElementToSlot(element, slot);
  }

  private releaseDragSlot(slot: CardDragSlot | null): void {
    slot?.placeholder.remove();
  }

  private animatePlayedCard(card: JQuery): void {
    const element = card.get(0) as HTMLElement | undefined;
    const stage = document.getElementById('battle-stage')?.getBoundingClientRect();
    if (!element || !stage) {
      card.remove();
      return;
    }
    const current = element.getBoundingClientRect();
    const targetX = stage.left + stage.width / 2 - current.width / 2;
    const targetY = stage.top + stage.height * 0.46 - current.height / 2;
    card.css({ left: `${current.left}px`, top: `${current.top}px`, transform: 'none' });
    const animation = element.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1.035)', opacity: 1 },
        {
          transform: `translate3d(${targetX - current.left}px, ${targetY - current.top}px, 0) scale(.72)`,
          opacity: 0,
        },
      ],
      { duration: 145, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' },
    );
    let removed = false;
    const remove = (): void => {
      if (removed) return;
      removed = true;
      card.remove();
    };
    const fallback = window.setTimeout(remove, 220);
    void animation.finished
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(fallback);
        remove();
      });
  }

  private handlePointerStart(event: JQuery.Event, card: JQuery): void {
    if (!card.hasClass('clickable')) return;
    const pointer = (event as any).originalEvent as PointerEvent | undefined;
    if (!pointer || (pointer.pointerType === 'mouse' && pointer.button !== 0)) return;
    this.draggedCard = card;
    this.dragPointerId = pointer.pointerId;
    this.dragOrigin = { x: pointer.clientX, y: pointer.clientY };
    this.lastPointer = { x: pointer.clientX, y: pointer.clientY };
    this.pointerDragActive = false;
    (card.get(0) as HTMLElement | undefined)?.setPointerCapture?.(pointer.pointerId);
  }

  private handlePointerMove(event: JQuery.Event): void {
    const pointer = (event as any).originalEvent as PointerEvent | undefined;
    if (!pointer || !this.draggedCard || pointer.pointerId !== this.dragPointerId || !this.dragOrigin) return;
    event.preventDefault();
    event.stopPropagation();

    if (!this.pointerDragActive) {
      const distance = Math.hypot(pointer.clientX - this.dragOrigin.x, pointer.clientY - this.dragOrigin.y);
      if (distance < 6) return;
      this.pointerDragActive = true;
      this.clearSelection();
      if (!this.beginVisualDrag(this.draggedCard)) {
        this.pointerDragActive = false;
        return;
      }
      $('#playArea').addClass('show');
    }
    this.scheduleDragVisual(pointer.clientX, pointer.clientY);
  }

  private handlePointerEnd(event: JQuery.Event): void {
    const pointer = (event as any).originalEvent as PointerEvent | undefined;
    if (!pointer || !this.draggedCard || pointer.pointerId !== this.dragPointerId) return;
    const card = this.draggedCard;
    if (this.pointerDragActive) {
      this.pendingPointer = { x: pointer.clientX, y: pointer.clientY };
      if (this.dragFrame !== null) cancelAnimationFrame(this.dragFrame);
      this.dragFrame = null;
      this.applyDragVisual();
      event.preventDefault();
      event.stopPropagation();
      card.data('suppressPlayClick', true);
    }
    const action = resolveCardDropAction({
      dragActive: this.pointerDragActive,
      pointerCancelled: event.type === 'pointercancel',
      insidePlayArea: this.isPointInPlayArea(pointer.clientX, pointer.clientY),
    });
    this.finishPointerDrag(card, action);
  }

  private isPointInPlayArea(x: number, y: number): boolean {
    const rect = this.playAreaRect || document.getElementById('playArea')?.getBoundingClientRect();
    return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  private finishPointerDrag(card: JQuery, action: CardDropAction): void {
    if (this.dragPointerId !== null) {
      (card.get(0) as HTMLElement | undefined)?.releasePointerCapture?.(this.dragPointerId);
    }
    this.justEndedDrag = this.pointerDragActive;
    card.data('justEndedDrag', this.pointerDragActive);
    this.hideCardDetail();
    $('#playArea').removeClass('show active');

    if (this.pointerDragActive && this.dragSlot) {
      if (action === 'play') {
        this.releaseDragSlot(this.dragSlot);
        this.animatePlayedCard(card);
        this.requestPlay(card);
      } else {
        this.restoreCardToSlot(card, this.dragSlot);
      }
    } else {
      card.removeClass('dragging card-hover is-active').trigger('mouseleave');
    }

    this.draggedCard = null;
    this.dragTooltip = null;
    this.dragSlot = null;
    this.dragPointerId = null;
    this.dragOrigin = null;
    this.lastPointer = null;
    this.pendingPointer = null;
    this.playAreaRect = null;
    this.pointerDragActive = false;

    window.setTimeout(() => {
      this.justEndedDrag = false;
      card.removeData('justEndedDrag');
      card.removeData('suppressPlayClick');
    }, 220);
  }

  public bindCardEvents(card: JQuery): void {
    card.off('.mwgCardPlay');
    card.attr('draggable', 'false');
    card.on('click.mwgCardPlay', event => this.handleCardClick(event as JQuery.Event, card));
    card.on('pointerdown.mwgCardPlay', event => this.handlePointerStart(event as JQuery.Event, card));
  }
}
