/**
 * 牌堆查看器 - 显示抽牌堆、弃牌堆等内容
 */

import { Card } from '../types';
import { UnifiedEffectDisplay } from './unifiedEffectDisplay';

export class PileViewer {
  private static instance: PileViewer;
  private static effectDisplay = UnifiedEffectDisplay.getInstance();

  private constructor() {}

  public static getInstance(): PileViewer {
    if (!PileViewer.instance) {
      PileViewer.instance = new PileViewer();
    }
    return PileViewer.instance;
  }

  /**
   * 显示牌堆内容
   */
  showPile(pileType: 'draw' | 'discard' | 'exhaust', cards: Card[], title?: string): void {
    // 移除已存在的查看器
    this.closePileViewer();

    const pileTitle = title || this.getPileTitle(pileType);
    const viewer = this.createPileViewer(pileTitle, cards);

    $('body').append(viewer);

    // 添加动画效果
    viewer.css({ opacity: 0 }).animate({ opacity: 1 }, 300);
  }

  /**
   * 关闭牌堆查看器
   */
  closePileViewer(): void {
    const existingViewer = $('.pile-viewer');
    if (existingViewer.length > 0) {
      existingViewer.animate({ opacity: 0 }, 200, function () {
        $(this).remove();
      });
    }
  }

  /**
   * 创建牌堆查看器HTML
   */
  private createPileViewer(title: string, cards: Card[]): JQuery {
    const cardsHTML = cards.map(card => this.createCardHTML(card)).join('');

    const viewer = $(`
      <div class="pile-viewer">
        <div class="pile-viewer-overlay"></div>
        <div class="pile-viewer-content">
          <div class="pile-viewer-header">
            <h3>${title} (${cards.length}张)</h3>
            <button class="close-btn" type="button">✕</button>
          </div>
          <div class="pile-viewer-body">
            ${cardsHTML || '<div class="empty-pile">牌堆为空</div>'}
          </div>
        </div>
      </div>
    `);

    // 绑定关闭事件
    viewer.find('.close-btn, .pile-viewer-overlay').on('click', () => {
      this.closePileViewer();
    });

    // 阻止内容区域点击事件冒泡
    viewer.find('.pile-viewer-content').on('click', e => {
      e.stopPropagation();
    });

    return viewer;
  }

  /**
   * 创建卡牌HTML
   */
  private createCardHTML(card: Card): string {
    const effectTags = PileViewer.effectDisplay.parseEffectToTags(card.effect, { isPlayerCard: true });
    const compactTagsHTML = PileViewer.effectDisplay.createCompactEffectTagsHTML(effectTags);

    // 规范化：旧数据中可能将 Corrupt 作为 type，这里归并为 rarity
    const normalizedType: any = (card as any).type === 'Corrupt' ? 'Skill' : card.type;
    const normalizedRarity: any = (card as any).type === 'Corrupt' ? 'Corrupt' : card.rarity;

    return `
      <div class="card enhanced-card rarity-${normalizedRarity} card-type-${normalizedType}" data-card-id="${card.id}">
        <div class="card-header">
          <div class="card-cost">${card.cost}</div>
          <div class="card-rarity-gem"></div>
        </div>
        <div class="card-artwork">
          <div class="card-emoji">${card.emoji}</div>
          ${card.retain ? '<div class="card-keyword retain">保留</div>' : ''}
          ${card.exhaust ? '<div class="card-keyword exhaust">消耗</div>' : ''}
          ${card.ethereal ? '<div class="card-keyword ethereal">空灵</div>' : ''}
        </div>
        <div class="card-body">
          <div class="card-name">${card.name}</div>
          <div class="card-description">${card.description}</div>
          ${compactTagsHTML}
        </div>
      </div>
    `;
  }

  /**
   * 获取牌堆标题
   */
  private getPileTitle(pileType: 'draw' | 'discard' | 'exhaust'): string {
    switch (pileType) {
      case 'draw':
        return '抽牌堆';
      case 'discard':
        return '弃牌堆';
      case 'exhaust':
        return '消耗堆';
      default:
        return '牌堆';
    }
  }

  /**
   * 设置牌堆点击事件
   */
  setupPileClickEvents(): void {
    // 抽牌堆点击事件
    $(document).on('click', '.deck-stat[data-pile="draw"], .draw-pile-indicator', e => {
      e.preventDefault();
      this.handlePileClick('draw');
    });

    // 弃牌堆点击事件
    $(document).on('click', '.deck-stat[data-pile="discard"], .discard-pile-indicator', e => {
      e.preventDefault();
      this.handlePileClick('discard');
    });

    // 消耗堆点击事件
    $(document).on('click', '.deck-stat[data-pile="exhaust"], .exhaust-pile-indicator', e => {
      e.preventDefault();
      this.handlePileClick('exhaust');
    });

    console.log('✅ 牌堆点击事件已设置');
  }

  /**
   * 处理牌堆点击
   */
  private handlePileClick(pileType: 'draw' | 'discard' | 'exhaust'): void {
    // 这里需要从GameStateManager获取牌堆数据
    // 为了避免循环依赖，我们通过事件系统来获取数据
    const event = new CustomEvent('requestPileData', {
      detail: { pileType },
    });

    document.dispatchEvent(event);
  }

  /**
   * 显示指定的牌堆（由外部调用）
   */
  showPileByType(pileType: 'draw' | 'discard' | 'exhaust', gameStateManager: any): void {
    const player = gameStateManager.getPlayer();
    if (!player) {
      console.warn('无法获取玩家数据');
      return;
    }

    let cards: Card[] = [];
    let title = '';

    switch (pileType) {
      case 'draw':
        cards = player.drawPile || [];
        title = '抽牌堆';
        break;
      case 'discard':
        cards = player.discardPile || [];
        title = '弃牌堆';
        break;
      case 'exhaust':
        cards = player.exhaustPile || [];
        title = '消耗堆';
        break;
    }

    this.showPile(pileType, cards, title);
    console.log(`📚 显示${title}: ${cards.length}张卡牌`);
  }
}

/**
 * 牌堆统计显示器 - 更新牌堆数量显示
 */
export class PileStatsDisplay {
  /**
   * 更新牌堆统计显示
   */
  static updatePileStats(drawCount: number, discardCount: number, exhaustCount: number = 0): void {
    // 更新抽牌堆数量
    $('.deck-stat[data-pile="draw"] .deck-count, .draw-pile-count').text(drawCount);

    // 更新弃牌堆数量
    $('.deck-stat[data-pile="discard"] .deck-count, .discard-pile-count').text(discardCount);

    // 更新消耗堆数量（如果存在）
    $('.deck-stat[data-pile="exhaust"] .deck-count, .exhaust-pile-count').text(exhaustCount);

    // 添加可点击样式
    $('.deck-stat[data-pile="draw"]').toggleClass('clickable', drawCount > 0);
    $('.deck-stat[data-pile="discard"]').toggleClass('clickable', discardCount > 0);
    $('.deck-stat[data-pile="exhaust"]').toggleClass('clickable', exhaustCount > 0);

    console.log(`📊 更新牌堆统计: 抽牌堆${drawCount}, 弃牌堆${discardCount}, 消耗堆${exhaustCount}`);
  }

  /**
   * 创建牌堆统计HTML
   */
  static createPileStatsHTML(): string {
    return `
      <div class="deck-info">
        <div class="deck-stat clickable" data-pile="draw" title="点击查看抽牌堆">
          <div class="deck-icon">🃏</div>
          <div class="deck-label">抽牌堆</div>
          <div class="deck-count">0</div>
        </div>
        <div class="deck-stat clickable" data-pile="discard" title="点击查看弃牌堆">
          <div class="deck-icon">🗂️</div>
          <div class="deck-label">弃牌堆</div>
          <div class="deck-count">0</div>
        </div>
        <div class="deck-stat clickable" data-pile="exhaust" title="点击查看消耗堆">
          <div class="deck-icon">💨</div>
          <div class="deck-label">消耗堆</div>
          <div class="deck-count">0</div>
        </div>
      </div>
    `;
  }
}
