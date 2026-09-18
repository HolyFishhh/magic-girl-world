/**
 * Unified card interaction: drag and two-click play are always available.
 */

import { BattleUI } from './battleUI';
import {
  resolveCardClickAction,
  resolveCardDropAction,
  restoreDraggedElementToSlot,
  shouldRestoreInterruptedDrag,
  type CardDragSlot,
  type CardDropAction,
} from './cardPlayInteraction';

export class CardPlayMode {
  private static instance: CardPlayMode;
  private selectedCard: JQuery | null = null;
  private pressPreviewTimer: ReturnType<typeof setTimeout> | undefined;
  private pressPreviewCard: JQuery | null = null;
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
      // Browsers do not consistently dispatch pointercancel when a tab is
      // backgrounded. Restore only an uncommitted visual drag in that case.
      .on('visibilitychange.mwgPointerCardPlay', () => {
        if (document.hidden) this.cancelInterruptedPointer();
      })
      .on('click.mwgPointerCardPlay', event => {
        if ($(event.target).closest('.enhanced-card').length === 0) this.clearSelection();
      });
    $(window)
      .off('blur.mwgPointerCardPlay')
      .on('blur.mwgPointerCardPlay', () => this.cancelInterruptedPointer());
    this.initialized = true;
  }

  public clearSelection(): void {
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

  private requestPlay(card: JQuery, animate = true): void {
    if (!card.hasClass('clickable') || card.data('playPending')) return;
    this.hideCardDetail();
    this.clearSelection();
    card
      .data('playPending', true)
      .removeClass('clickable selected')
      .addClass('card-playing')
      .attr('aria-disabled', 'true');
    if (animate) {
      // Mark the visual flight before dispatching the async combat request so
      // the transaction presenter cannot start a second, delayed flight.
      card.data('visualPlayStarted', true);
      this.animatePlayedCard(card);
    }
    card.trigger('mwg:play-card');
  }

  private handleCardClick(event: JQuery.Event, card: JQuery): void {
    event.preventDefault();
    event.stopPropagation();
    if (card.data('suppressPlayClick') || card.data('justEndedDrag')) return;
    if (!card.hasClass('clickable')) { BattleUI.showCardTooltip(card, card.data('cardData')); return; }
    if ($('.card-tooltip').length && resolveCardClickAction(this.selectedCard?.get(0), card.get(0)) === 'play') {
      this.requestPlay(card);
      return;
    }
    this.selectCard(card);
  }

  private hideCardDetail(): void {
    BattleUI.dismissCardTooltip();
  }

  /**
   * Return a card to its real hand slot if the browser interrupted a drag
   * without delivering pointerup/pointercancel. This deliberately does not
   * touch playPending: that flag belongs to an already-dispatched game action.
   */
  private cancelInterruptedPointer(): void {
    clearTimeout(this.pressPreviewTimer);
    this.pressPreviewCard?.removeData('suppressPlayClick');
    this.pressPreviewCard = null;
    if (!this.draggedCard) return;

    const card = this.draggedCard;
    if (this.dragFrame !== null) cancelAnimationFrame(this.dragFrame);
    this.dragFrame = null;

    if (shouldRestoreInterruptedDrag(this.pointerDragActive, Boolean(this.dragSlot))) {
      this.finishPointerDrag(card, 'restore');
      return;
    }

    this.releasePointerCapture(card);
    card.removeClass('dragging is-cast-ready card-hover is-active');
    $('#playArea').removeClass('show active');
    this.draggedCard = null;
    this.dragPointerId = null;
    this.dragOrigin = null;
    this.lastPointer = null;
    this.pendingPointer = null;
    this.playAreaRect = null;
    this.pointerDragActive = false;
  }

  /** Releasing a capture already lost during an interruption can throw. */
  private releasePointerCapture(card: JQuery): void {
    if (this.dragPointerId === null) return;
    const element = card.get(0) as HTMLElement | undefined;
    if (!element?.releasePointerCapture) return;
    try {
      if (element.hasPointerCapture && !element.hasPointerCapture(this.dragPointerId)) return;
      element.releasePointerCapture(this.dragPointerId);
    } catch {
      // A browser may have already released this pointer while backgrounded.
    }
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
    // Double-click starts in the hand flow layout, whereas drag has already
    // been portalled by beginVisualDrag. Portal both paths into the viewport
    // before animating so overflow/hand transforms cannot clip or offset it.
    if (element.parentElement !== document.body) document.body.appendChild(element);
    const targetX = stage.left + stage.width / 2 - current.width / 2;
    const targetY = stage.top + stage.height * 0.46 - current.height / 2;
    card.addClass('card-cast-flight').removeClass('card-hover selected').css({
      position: 'fixed', left: `${current.left}px`, top: `${current.top}px`, bottom: 'auto',
      width: `${current.width}px`, height: `${current.height}px`, maxHeight: 'none', margin: 0,
      pointerEvents: 'none', zIndex: 3000, transform: 'translate3d(0,0,0)', transition: 'none',
    });
    const queueIndex = Math.max(0, document.querySelectorAll('.card-cast-flight').length - 1);
    const dx = targetX - current.left + Math.min(queueIndex, 5) * 16;
    const dy = targetY - current.top + Math.min(queueIndex, 5) * 8;
    card.attr('data-queue-state', 'waiting').attr('aria-label', '等待出牌');
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : 220;
    element.animate([
      { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 },
      { transform: `translate3d(${dx}px,${dy}px,0) scale(.8)`, opacity: 1 },
    ], { duration, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' });
    // The queued real card remains here until its own transaction completes.
    card.data('visualPlayReady', new Promise<void>(resolve => window.setTimeout(resolve, duration)));

  }

  private handlePointerStart(event: JQuery.Event, card: JQuery): void {
    this.pressPreviewCard = card;
    clearTimeout(this.pressPreviewTimer);
    this.pressPreviewTimer = setTimeout(() => {
      BattleUI.showCardTooltip(card, card.data('cardData'));
      card.data('suppressPlayClick', true);
    }, 350);
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
    // On phones a horizontal gesture scrolls readable hand cards; an upward
    // gesture still drags a card into play. Native pointercancel ends a swipe.
    if (!this.pointerDragActive && pointer.pointerType === 'touch' && window.matchMedia('(max-width: 760px)').matches) {
      const dx = pointer.clientX - this.dragOrigin.x, dy = pointer.clientY - this.dragOrigin.y;
      if (Math.abs(dx) >= 6 && Math.abs(dx) > Math.abs(dy)) {
        clearTimeout(this.pressPreviewTimer);
        this.cancelInterruptedPointer();
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();

    if (!this.pointerDragActive) {
      const distance = Math.hypot(pointer.clientX - this.dragOrigin.x, pointer.clientY - this.dragOrigin.y);
      if (distance < 6) return;
      clearTimeout(this.pressPreviewTimer);
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
    clearTimeout(this.pressPreviewTimer);
    const previewCard = this.pressPreviewCard;
    this.pressPreviewCard = null;
    setTimeout(() => previewCard?.removeData('suppressPlayClick'), 250);
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
    this.releasePointerCapture(card);
    this.justEndedDrag = this.pointerDragActive;
    card.data('justEndedDrag', this.pointerDragActive);
    if (this.pointerDragActive) this.hideCardDetail();
    $('#playArea').removeClass('show active');

    if (this.pointerDragActive && this.dragSlot) {
      if (action === 'play') {
        this.releaseDragSlot(this.dragSlot);
        card.data('visualPlayStarted', true);
        this.animatePlayedCard(card);
        this.requestPlay(card, false);
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
