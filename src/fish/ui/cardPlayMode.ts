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
  private justEndedDrag: boolean = false; // 标记刚结束拖动，防止立即hover
  private initialized = false;
  private readonly STORAGE_KEY = 'fishRPG_cardPlayMode';

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

    console.log('🎮 初始化卡牌出牌模式');

    // 从 localStorage 读取用户设置，如果没有则根据设备类型自动选择
    const savedMode = this.loadModeFromStorage();
    if (savedMode) {
      this.playMode = savedMode;
      console.log('  ├─ 从本地存储读取模式:', savedMode);
    } else {
      // 根据设备类型自动选择模式
      if (this.isMobileDevice()) {
        this.playMode = 'click';
        console.log('  ├─ 检测到移动设备，使用点击模式');
      } else {
        this.playMode = 'drag';
        console.log('  ├─ 检测到PC设备，使用拖动模式');
      }
      // 保存到本地存储
      this.saveModeToStorage(this.playMode);
    }

    // 等待 DOM 元素准备好
    setTimeout(() => {
      this.updateModeUI(this.playMode);

      // 绑定模式切换按钮
      $('#modeToggle').on('click', () => this.toggleMode());

      // 监听鼠标移动（用于卡牌跟随）
      $(document).on('mousemove', e => this.handleMouseMove(e));
      $(document).on('mouseup', () => this.cleanupGhost());

      // 绑定出牌区域事件
      const playArea = $('#playArea');
      playArea.on('dragover', e => this.handleDragOver(e));
      playArea.on('dragleave', () => this.handleDragLeave());
      playArea.on('drop', e => this.handleDrop(e));

      this.initialized = true;
      console.log('✅ 卡牌出牌模式初始化完成');

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
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0
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

    // 更新所有卡牌的draggable属性
    $('.enhanced-card').attr('draggable', this.playMode === 'drag' ? 'true' : 'false');

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
   * 鼠标移动处理（卡牌跟随）
   */
  private handleMouseMove(e: JQuery.MouseMoveEvent): void {
    if (this.cardGhost) {
      this.cardGhost.css({
        left: e.clientX - 50 + 'px',
        top: e.clientY - 70 + 'px',
      });
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

  /**
   * 拖动模式：拖动开始
   */
  private handleDragStart(e: JQuery.DragStartEvent, card: JQuery): void {
    if (this.playMode !== 'drag') {
      e.preventDefault();
      return;
    }

    this.draggedCard = card;
    card.addClass('dragging');

    // 隐藏默认的拖动图像
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.originalEvent.dataTransfer!.setDragImage(img, 0, 0);
    e.originalEvent.dataTransfer!.effectAllowed = 'move';

    // 获取初始鼠标位置
    const x = e.originalEvent.clientX;
    const y = e.originalEvent.clientY;

    // 创建跟随鼠标的卡牌副本
    this.cardGhost = this.createCardGhost(card, x, y);

    // 显示出牌区域
    $('#playArea').addClass('show');

    // 显示卡牌详情
    this.showCardDetail(card);
  }

  /**
   * 拖动模式：拖动过程中
   */
  private handleDrag(e: JQuery.DragEvent): void {
    if (this.cardGhost && e.originalEvent.clientX !== 0 && e.originalEvent.clientY !== 0) {
      this.cardGhost.css({
        left: e.originalEvent.clientX - 50 + 'px',
        top: e.originalEvent.clientY - 70 + 'px',
      });
    }
  }

  /**
   * 拖动模式：拖动结束
   */
  private handleDragEnd(card: JQuery): void {
    // 设置拖动刚结束的标记
    this.justEndedDrag = true;
    card.data('justEndedDrag', true);

    // 先移除所有状态类
    card.removeClass('dragging');
    card.removeClass('card-hover');
    card.removeClass('is-active');

    // 强制触发mouseleave来清除hover状态
    card.trigger('mouseleave');

    // 强制移除所有可能导致浮起的样式，使用removeAttr来完全清除
    card.attr(
      'style',
      card
        .attr('style')
        ?.replace(/transform[^;]*(;|$)/g, '')
        .replace(/z-index[^;]*(;|$)/g, '') || '',
    );

    // 如果style属性为空，完全移除它
    if (!card.attr('style') || card.attr('style')?.trim() === '') {
      card.removeAttr('style');
    }

    // 500ms后清除标记，允许hover（延长时间以确保不会立即触发）
    setTimeout(() => {
      this.justEndedDrag = false;
      card.removeData('justEndedDrag');
    }, 500);

    this.hideCardDetail();
    this.cleanupGhost();

    // 隐藏出牌区域
    const playArea = $('#playArea');
    playArea.removeClass('show');
    playArea.removeClass('active');
  }

  /**
   * 拖动模式：拖动经过目标区域
   */
  private handleDragOver(e: JQuery.DragOverEvent): void {
    if (this.playMode !== 'drag') return;

    e.preventDefault();
    e.originalEvent.dataTransfer!.dropEffect = 'move';
    $('#playArea').addClass('active');
  }

  /**
   * 拖动模式：离开目标区域
   */
  private handleDragLeave(): void {
    $('#playArea').removeClass('active');
  }

  /**
   * 拖动模式：放下卡牌
   */
  private handleDrop(e: JQuery.DropEvent): void {
    e.preventDefault();

    if (this.playMode !== 'drag' || !this.draggedCard) return;

    $('#playArea').removeClass('active');

    // 触发卡牌的点击事件来执行出牌逻辑
    this.draggedCard.trigger('click');

    this.draggedCard = null;
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
   * 触摸事件处理（移动端拖动）
   */
  private handleTouchStart(e: JQuery.TouchStartEvent, card: JQuery): void {
    if (this.playMode !== 'drag') return;

    card.addClass('dragging');

    // 创建跟随的卡牌副本
    this.cardGhost = this.createCardGhost(card);

    // 显示出牌区域
    $('#playArea').addClass('show');

    this.showCardDetail(card);

    // 保存当前card供touchmove使用
    (e.currentTarget as any).__touchCard = card;

    e.preventDefault();
  }

  /**
   * 触摸移动事件
   */
  private handleTouchMove(e: JQuery.TouchMoveEvent): void {
    if (this.playMode !== 'drag') return;

    const touch = e.originalEvent.touches[0];

    // 更新卡牌副本位置
    if (this.cardGhost) {
      this.cardGhost.css({
        left: touch.clientX - 50 + 'px',
        top: touch.clientY - 70 + 'px',
      });
    }

    const element = document.elementFromPoint(touch.clientX, touch.clientY);

    // 移除高亮
    const playArea = $('#playArea');
    playArea.removeClass('active');

    // 高亮当前触摸的区域
    if (element) {
      const zone = $(element).closest('#playArea');
      if (zone.length > 0) {
        zone.addClass('active');
      }
    }

    e.preventDefault();
  }

  /**
   * 触摸结束事件
   */
  private handleTouchEnd(e: JQuery.TouchEndEvent, card: JQuery): void {
    if (this.playMode !== 'drag') return;

    const touch = e.originalEvent.changedTouches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);

    // 检查是否放在出牌区域
    if (element) {
      const zone = $(element).closest('#playArea');
      if (zone.length > 0) {
        // 触发卡牌的点击事件来执行出牌逻辑
        card.trigger('click');
      }
    }

    card.removeClass('dragging');
    this.hideCardDetail();
    this.cleanupGhost();

    // 隐藏出牌区域
    const playArea = $('#playArea');
    playArea.removeClass('show');
    playArea.removeClass('active');

    e.preventDefault();
  }

  /**
   * 为卡牌绑定事件
   */
  public bindCardEvents(card: JQuery): void {
    // 点击事件处理（点击模式）
    const originalClick = card.data('originalClick');
    card.off('click').on('click', e => {
      this.handleCardClick(card);
      // 调用原始的点击处理
      if (originalClick) {
        originalClick.call(card[0], e);
      }
    });

    // 拖动事件（PC端）
    card.attr('draggable', this.playMode === 'drag' ? 'true' : 'false');
    card.on('dragstart', e => this.handleDragStart(e as JQuery.DragStartEvent, card));
    card.on('drag', e => this.handleDrag(e as JQuery.DragEvent));
    card.on('dragend', () => this.handleDragEnd(card));

    // 触摸事件（移动端）
    card.on('touchstart', e => this.handleTouchStart(e as JQuery.TouchStartEvent, card));
    card.on('touchmove', e => this.handleTouchMove(e as JQuery.TouchMoveEvent));
    card.on('touchend', e => this.handleTouchEnd(e as JQuery.TouchEndEvent, card));
  }

  /**
   * 获取当前模式
   */
  public getCurrentMode(): 'click' | 'drag' {
    return this.playMode;
  }
}
