/**
 * 卡牌出牌模式管理 - 支持点击和拖动两种模式
 */

import { BattleUI } from './battleUI';

export class CardPlayMode {
  private static instance: CardPlayMode;
  private playMode: 'click' | 'drag' = 'click';
  private selectedCard: JQuery | null = null;
  private draggedCard: JQuery | null = null;
  private cardGhost: JQuery | null = null;
  private dragPointerId: number | null = null;
  private dragOrigin: { x: number; y: number } | null = null;
  private pointerDragActive = false;
  private justEndedDrag: boolean = false; // 标记刚结束拖动，防止立即hover
  private initialized = false;
  private readonly STORAGE_KEY = 'fishRPG_cardPlayMode_v2';

  private constructor() {
    // 不在构造函数中初始化，等待 DOM 准备好
  }

  public static getInstance(): CardPlayMode {
    if (!CardPlayMode.instance) {
      CardPlayMode.instance = new CardPlayMode();
    }
    return CardPlayMode.instance;
  }

  /**
   * 公开的初始化方法，应该在 DOM 准备好后调用
   */
  public init(): void {
    if (this.initialized) {
      return;
    }

    // 从 localStorage 读取用户设置，如果没有则根据设备类型自动选择
    const savedMode = this.loadModeFromStorage();
    if (savedMode) {
      this.playMode = savedMode;
    } else {
      // 根据设备类型自动选择模式
      if (this.isMobileDevice()) {
        this.playMode = 'click';
      } else {
        this.playMode = 'drag';
      }
      // 保存到本地存储
      this.saveModeToStorage(this.playMode);
    }

    // 等待 DOM 元素准备好
    setTimeout(() => {
      this.updateModeUI(this.playMode);

      // 绑定模式切换按钮
      $('#modeToggle').on('click', () => this.toggleMode());

      $(document)
        .off('.mwgPointerCardPlay')
        .on('pointermove.mwgPointerCardPlay', e => this.handlePointerMove(e as JQuery.Event))
        .on('pointerup.mwgPointerCardPlay pointercancel.mwgPointerCardPlay', e =>
          this.handlePointerEnd(e as JQuery.Event),
        );

      this.initialized = true;
      // 显示初始提示
      this.showModeHint(`当前模式: ${this.playMode === 'click' ? '点击出牌' : '拖动出牌'}`);
    }, 100);
  }

  /**
   * 检测是否为移动设备
   */
  private isMobileDevice(): boolean {
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (window.matchMedia?.('(pointer: coarse)').matches === true && window.innerWidth < 900)
    );
  }

  /**
   * 从 localStorage 读取模式设置
   */
  private loadModeFromStorage(): 'click' | 'drag' | null {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved === 'click' || saved === 'drag') {
        return saved;
      }
    } catch (error) {
      console.warn('无法读取本地存储:', error);
    }
    return null;
  }

  /**
   * 保存模式设置到 localStorage
   */
  private saveModeToStorage(mode: 'click' | 'drag'): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, mode);
    } catch (error) {
      console.warn('无法保存到本地存储:', error);
    }
  }

  /**
   * 切换模式
   */
  private toggleMode(): void {
    this.playMode = this.playMode === 'click' ? 'drag' : 'click';
    this.updateModeUI(this.playMode);

    // 保存到本地存储
    this.saveModeToStorage(this.playMode);

    $('.enhanced-card').attr('draggable', 'false');

    // 清除选中状态
    if (this.selectedCard) {
      this.selectedCard.removeClass('selected');
      this.selectedCard = null;
    }

    this.showModeHint(`切换为${this.playMode === 'click' ? '点击出牌' : '拖动出牌'}模式`);
  }

  /**
   * 更新模式UI
   */
  private updateModeUI(mode: 'click' | 'drag'): void {
    const modeIcon = $('#modeIcon');
    const modeText = $('#modeText');
    const modeToggle = $('#modeToggle');

    if (mode === 'click') {
      modeIcon.text('👆');
      modeText.text('点击出牌');
      modeToggle.removeClass('active');
    } else {
      modeIcon.text('👋');
      modeText.text('拖动出牌');
      modeToggle.addClass('active');
    }
    document.documentElement.classList.toggle('card-play-drag-mode', mode === 'drag');
  }

  /**
   * 显示模式提示
   */
  private showModeHint(text: string): void {
    const hint = $('#modeHint');
    hint.text(text);
    hint.addClass('show');
    setTimeout(() => {
      hint.removeClass('show');
    }, 2000);
  }

  /**
   * 创建跟随鼠标的卡牌副本
   */
  private createCardGhost(card: JQuery, x: number, y: number): JQuery {
    const ghost = card.clone();
    ghost.addClass('card-ghost');
    ghost.css({
      width: card.outerWidth() + 'px',
      height: card.outerHeight() + 'px',
      left: x - 50 + 'px',
      top: y - 70 + 'px',
    });
    $('body').append(ghost);
    return ghost;
  }

  /**
   * 清理跟随的卡牌副本
   */
  private cleanupGhost(): void {
    if (this.cardGhost) {
      this.cardGhost.remove();
      this.cardGhost = null;
    }
  }

  /**
   * 显示卡牌详情 - 直接调用BattleUI的showCardTooltip方法
   */
  private showCardDetail(card: JQuery): void {
    const cardData = card.data('cardData');
    if (cardData) {
      BattleUI.showCardTooltip(card, cardData);
    }
  }

  /**
   * 隐藏卡牌详情 - 触发卡牌的mouseleave事件
   */
  private hideCardDetail(): void {
    // 隐藏所有tooltip
    $('.card-tooltip').fadeOut(200, function () {
      $(this).remove();
    });
  }

  private handlePointerStart(e: JQuery.Event, card: JQuery): void {
    if (this.playMode !== 'drag' || !card.hasClass('clickable')) return;
    const pointer = (e as any).originalEvent as PointerEvent | undefined;
    if (!pointer || (pointer.pointerType === 'mouse' && pointer.button !== 0)) return;

    this.draggedCard = card;
    this.dragPointerId = pointer.pointerId;
    this.dragOrigin = { x: pointer.clientX, y: pointer.clientY };
    this.pointerDragActive = false;
    (card.get(0) as HTMLElement | undefined)?.setPointerCapture?.(pointer.pointerId);
  }

  private handlePointerMove(e: JQuery.Event): void {
    const pointer = (e as any).originalEvent as PointerEvent | undefined;
    if (!pointer || !this.draggedCard || pointer.pointerId !== this.dragPointerId || !this.dragOrigin) return;

    if (!this.pointerDragActive) {
      const distance = Math.hypot(pointer.clientX - this.dragOrigin.x, pointer.clientY - this.dragOrigin.y);
      if (distance < 6) return;
      this.pointerDragActive = true;
      this.draggedCard.addClass('dragging');
      this.cardGhost = this.createCardGhost(this.draggedCard, pointer.clientX, pointer.clientY);
      $('#playArea').addClass('show');
      this.showCardDetail(this.draggedCard);
    }

    e.preventDefault();
    this.cardGhost?.css({ left: pointer.clientX - 50 + 'px', top: pointer.clientY - 70 + 'px' });
    $('#playArea').toggleClass('active', this.isPointInPlayArea(pointer.clientX, pointer.clientY));
  }

  private handlePointerEnd(e: JQuery.Event): void {
    const pointer = (e as any).originalEvent as PointerEvent | undefined;
    if (!pointer || !this.draggedCard || pointer.pointerId !== this.dragPointerId) return;

    const card = this.draggedCard;
    const shouldPlay = this.pointerDragActive && this.isPointInPlayArea(pointer.clientX, pointer.clientY);
    if (this.pointerDragActive) {
      e.preventDefault();
      card.data('suppressPlayClick', true);
    }
    this.finishPointerDrag(card);
    if (shouldPlay) card.trigger('mwg:play-card');
  }

  private isPointInPlayArea(x: number, y: number): boolean {
    const area = document.getElementById('playArea');
    if (!area) return false;
    const rect = area.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  private finishPointerDrag(card: JQuery): void {
    this.justEndedDrag = this.pointerDragActive;
    card.data('justEndedDrag', this.pointerDragActive);
    card.removeClass('dragging card-hover is-active').trigger('mouseleave');
    this.hideCardDetail();
    this.cleanupGhost();
    $('#playArea').removeClass('show active');
    this.draggedCard = null;
    this.dragPointerId = null;
    this.dragOrigin = null;
    this.pointerDragActive = false;

    setTimeout(() => {
      this.justEndedDrag = false;
      card.removeData('justEndedDrag');
      card.removeData('suppressPlayClick');
    }, 500);
  }

  /**
   * 点击模式：点击卡牌直接出牌
   */
  private handleCardClick(card: JQuery): void {
    if (this.playMode !== 'click') return;

    // 点击模式不需要额外显示详情，因为原始的mouseenter已经显示了
    // 直接触发原始的点击处理即可
  }

  /**
   * 为卡牌绑定事件
   */
  public bindCardEvents(card: JQuery): void {
    card.off('.mwgCardPlay');
    card.on('click.mwgCardPlay', () => this.handleCardClick(card));

    card.attr('draggable', 'false');
    card.on('pointerdown.mwgCardPlay', e => this.handlePointerStart(e as JQuery.Event, card));
  }

  /**
   * 获取当前模式
   */
  public getCurrentMode(): 'click' | 'drag' {
    return this.playMode;
  }
}
