/**
 * 战斗UI管理模块
 */

import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';
import { GameStateManager } from '../core/gameStateManager';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import { roundBattleDisplayValue, type Card } from '../../game-core';
import { CardPlayMode } from './cardPlayMode';
import { EnemyIntentPresenter } from './enemyIntentPresenter';
import { PileStatsDisplay } from './pileViewer';
import { EffectProgramDisplay } from './effectProgramDisplay';

export class BattleUI {
  private static effectDisplay = EffectProgramDisplay.getInstance();
  private static activeCardTooltip: JQuery | null = null;
  private static activeCardTooltipAnchor: JQuery | null = null;
  private static handResizeBound = false;
  private static handResizeFrame: number | null = null;

  private static displayBattleValue(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? roundBattleDisplayValue(value) : fallback;
  }
  /**
   * 翻译卡牌类型
   */
  static translateCardType(type: string): string {
    const typeTranslations: { [key: string]: string } = {
      Attack: '攻击',
      Skill: '技能',
      Power: '能力',
      Event: '事件',
      Curse: '诅咒',
    };
    return typeTranslations[type] || type;
  }

  /**
   * 翻译稀有度
   */
  static translateRarity(rarity: string): string {
    const rarityTranslations: { [key: string]: string } = {
      Common: '普通',
      Uncommon: '罕见',
      Rare: '稀有',
      Epic: '史诗',
      Legendary: '传说',
      Corrupt: '腐化',
    };
    return rarityTranslations[rarity] || rarity;
  }

  /**
   * 刷新战斗UI
   */
  static async refreshBattleUI(gameState: any): Promise<void> {
    try {
      // 刷新战斗UI - 移除日志减少输出

      if (!gameState) {
        console.error('无法获取游戏状态');
        return;
      }

      const enemy = gameState.enemy;
      const player = gameState.player;

      // 更新敌人信息
      if (enemy) {
        this.updateEnemyDisplay(enemy);
        EnemyIntentPresenter.getInstance().render(enemy);
        this.bindEnemyIntentDetails(enemy);
      }

      // 更新玩家信息
      if (player) {
        this.updatePlayerDisplay(player);
      }

      // 更新其他UI元素
      this.updateOtherElements(gameState);

      // 更新手牌显示
      if (gameState.player && gameState.player.hand) {
        this.updateHandCardsDisplay(gameState.player.hand);
      }

      // 更新牌堆统计
      if (gameState.player) {
        const drawCount = gameState.player.drawPile?.length || 0;
        const discardCount = gameState.player.discardPile?.length || 0;
        const exhaustCount = gameState.player.exhaustPile?.length || 0;
        const deckCount = gameState.player.deck?.length || 0;
        PileStatsDisplay.updatePileStats(drawCount, discardCount, exhaustCount, deckCount);
      }
      this.updateDeckCounts(gameState);

      // 更新能力显示
      this.updateAbilitiesDisplay(gameState.player.abilities || [], gameState.enemy?.abilities || []);
    } catch (error) {
      console.error('❌ 刷新战斗UI失败:', error);
    }
  }

  /**
   * 更新敌人显示
   */
  private static updateEnemyDisplay(enemy: any): void {
    $('#enemy-name').text(enemy.name || '未知敌人');
    $('.enemy-emoji').text(enemy.emoji || '👹');
    $('#stage-enemy-emoji').text(enemy.emoji || '👹');

    // 更新敌人血条
    const enemyHpPercent = enemy.maxHp > 0 ? (enemy.currentHp / enemy.maxHp) * 100 : 0;
    $('.enemy-card .hp-fill').css('width', `${enemyHpPercent}%`);
    $('#enemy-hp').text(`${this.displayBattleValue(enemy.currentHp)}/${this.displayBattleValue(enemy.maxHp, 1)}`);

    // 更新敌人欲望条
    const enemyLustPercent = enemy.maxLust > 0 ? (enemy.currentLust / enemy.maxLust) * 100 : 0;

    // 使用新的统一选择器
    $('.enemy-card .lust-fill').css('width', `${enemyLustPercent}%`);
    $('#enemy-lust').text(`${this.displayBattleValue(enemy.currentLust)}/${this.displayBattleValue(enemy.maxLust, 1)}`);

    // 更新敌人格挡 - 条件显示
    const enemyBlockValue = this.displayBattleValue(enemy.block);
    $('#enemy-block').text(enemyBlockValue);

    // 格挡为0时隐藏，大于0时显示
    const enemyBlockContainer = $('#enemy-block-container');
    if (enemyBlockValue > 0) {
      enemyBlockContainer.show();
    } else {
      enemyBlockContainer.hide();
    }

    // 更新敌人状态效果
    this.updateStatusEffects('enemy', enemy.statusEffects || []);

    // 更新敌人欲望效果显示
    this.updateLustEffectDisplay('enemy', enemy.lustEffect);
  }

  /**
   * 更新玩家显示
   */
  private static updatePlayerDisplay(player: any): void {
    const playerHp = this.displayBattleValue(player.currentHp);
    const playerMaxHp = this.displayBattleValue(player.maxHp, 100);
    const playerLust = this.displayBattleValue(player.currentLust);
    const playerMaxLust = this.displayBattleValue(player.maxLust, 100);
    const playerEnergy = this.displayBattleValue(player.energy);
    const playerBlock = this.displayBattleValue(player.block);
    const playerEmoji = typeof player.emoji === 'string' && player.emoji.trim() ? player.emoji.trim() : '✨';
    $('.player-emblem, #stage-player-emoji').text(playerEmoji);

    // 更新玩家血条
    const playerHpPercent = playerMaxHp > 0 ? (playerHp / playerMaxHp) * 100 : 0;
    $('.player-card .hp-fill').css('width', `${playerHpPercent}%`);
    $('#player-hp').text(`${playerHp}/${playerMaxHp}`);

    // 更新玩家欲望条
    const playerLustPercent = playerMaxLust > 0 ? (playerLust / playerMaxLust) * 100 : 0;

    // 使用新的统一选择器
    $('.player-card .lust-fill').css('width', `${playerLustPercent}%`);
    $('#player-lust').text(`${playerLust}/${playerMaxLust}`);

    // 更新能量显示
    $('#player-energy').text(`${playerEnergy}/${this.displayBattleValue(player.maxEnergy, 3)}`);

    // 更新格挡显示 - 条件显示
    $('#player-block').text(playerBlock);

    // 格挡为0时隐藏，大于0时显示
    const blockContainer = $('#block-stat-container');
    if (playerBlock > 0) {
      blockContainer.show();
    } else {
      blockContainer.hide();
    }

    // 更新遗物显示
    this.updateRelicsDisplay(player.relics || []);

    // 更新玩家状态效果
    this.updateStatusEffects('player', player.statusEffects || []);

    // 更新玩家欲望效果显示（从GameStateManager获取）
    const gameStateManager = GameStateManager.getInstance();
    const playerLustEffect = (gameStateManager as any).gameState?.battle?.player_lust_effect;
    this.updateLustEffectDisplay('player', playerLustEffect);
  }

  /**
   * 更新其他UI元素
   */
  private static updateOtherElements(gameState: any): void {
    // 显示战斗场景
    $('#battle-scene').show();
    $('#setup-scene').hide();

    // 更新回合数
    $('#turn-number').text(gameState.currentTurn || 1);

    // 更新游戏阶段显示
    const phaseText = this.getPhaseText(gameState.phase);
    $('#phase-indicator').text(phaseText);

    const battleEnded = gameState.isGameOver === true || gameState.phase === 'game_over';
    const playerCanAct = gameState.phase === 'player_turn' && !battleEnded;
    $('.end-turn-button, #use-item-btn')
      .prop('disabled', !playerCanAct)
      .attr('aria-disabled', String(!playerCanAct));
    $('#hand-cards').toggleClass('battle-ended', battleEnded);
  }

  /**
   * 获取阶段显示文本
   */
  private static getPhaseText(phase: string): string {
    switch (phase) {
      case 'setup':
        return '准备阶段';
      case 'player_turn':
        return '玩家回合';
      case 'enemy_turn':
        return '敌人回合';
      case 'game_over':
        return '游戏结束';
      default:
        return '未知阶段';
    }
  }

  /**
   * 更新手牌显示
   */
  static updateHandCardsDisplay(handCards: any[]): void {
    try {
      const handContainer = $('.player-hand');
      handContainer.empty();

      if (!handCards || !Array.isArray(handCards)) {
        return;
      }

      const validCards = handCards;

      // 开始创建手牌元素 - 移除日志减少输出

      validCards.forEach((card: any, index: number) => {
        if (card && card.name) {
          const cardElement = this.createEnhancedCardElement(card, index);
          handContainer.append(cardElement);
        }
      });

      this.layoutHandCards();
      this.bindHandResize();
    } catch (error) {
      console.error('❌ 更新手牌显示失败:', error);
    }
  }

  private static bindHandResize(): void {
    if (this.handResizeBound) return;
    this.handResizeBound = true;
    window.addEventListener('resize', () => {
      if (this.handResizeFrame !== null) cancelAnimationFrame(this.handResizeFrame);
      this.handResizeFrame = requestAnimationFrame(() => {
        this.handResizeFrame = null;
        this.layoutHandCards();
      });
    });
  }

  private static layoutHandCards(): void {
    try {
      const handContainer = $('.player-hand');
      const cards = handContainer.children('.enhanced-card, .card-drag-slot');
      const count = cards.length;
      const handContainerWidth = handContainer.width() || 0;
      const handContainerHeight = handContainer.height() || 180;
      const maxCardWidth = document.documentElement.classList.contains('mwg-fullscreen-active') ? 150 : 116;
      const cardWidth = Math.max(70, Math.min(maxCardWidth, Math.floor((handContainerHeight - 8) * 0.75)));
      const normalOffset = cardWidth + 8;
      const fitOffset = count <= 1 ? 0 : (handContainerWidth - cardWidth - 8) / (count - 1);
      const offset = count <= 1 ? 0 : Math.max(14, Math.min(normalOffset, fitOffset));
      const totalContentWidth = count === 0 ? 0 : cardWidth + (count - 1) * offset;
      const start = Math.max(4, (handContainerWidth - totalContentWidth) / 2);

      handContainer.attr('data-count', String(count));
      handContainer.css('--hand-card-width', `${cardWidth}px`);
      cards.each((index, element) => {
        $(element).css({ left: `${start + index * offset}px` });
      });
    } catch (error) {
      console.warn('手牌重叠布局计算失败:', error);
    }
  }

  /**
   * 创建增强的卡牌元素
   */
  private static createEnhancedCardElement(card: any, index: number): JQuery {
    // 创建卡牌元素 - 移除日志减少输出

    // 确保卡牌有必要的属性
    const cardData: Card = {
      id: card.id || card.originalId || `card_${index}`,
      name: card.name || '未知卡牌',
      cost: card.cost || 0,
      type: card.type || 'Skill',
      rarity: card.rarity || 'Common',
      emoji: card.emoji || '🃏',
      effectProgram: card.effectProgram,
      description: card.description || '',
      discardEffectProgram: card.discardEffectProgram,
      retain: card.retain || false,
      exhaust: card.exhaust || false,
      ethereal: card.ethereal || false,
      innate: card.innate || false,
    };

    // 不在卡面显示效果解析，仅在悬停工具提示中显示

    // 检查能量是否足够
    const gameState = GameStateManager.getInstance().getGameState();
    const playerEnergy = gameState.player?.energy || 0;

    // 检查玩家是否被眩晕
    const executor = UnifiedEffectExecutor.getInstance();
    const isStunned = executor.isStunned('player');

    // 处理动态能量消耗
    let actualCost: number;
    let displayCost: string;

    if (cardData.type === 'Curse') {
      actualCost = 0;
      displayCost = '—';
    } else if (cardData.cost === 'energy') {
      actualCost = Math.max(0, playerEnergy); // 允许0能量
      displayCost = 'X';
    } else {
      actualCost = (cardData.cost as number) ?? 0;
      displayCost = actualCost.toString();
    }

    const canAfford = cardData.type === 'Curse' ? false : playerEnergy >= actualCost;
    const isPlayerTurn = gameState.phase === 'player_turn';
    const isCurse = cardData.type === 'Curse';
    // 如果被眩晕，所有卡牌都不可点击
    const isClickable = isPlayerTurn && canAfford && !isCurse && !isStunned;

    // 创建完整的卡牌元素
    const cardElement = $(`
      <div class="card enhanced-card rarity-${escapeHtmlAttribute(cardData.rarity)} card-type-${escapeHtmlAttribute(cardData.type)} ${
        isClickable ? 'clickable' : 'unaffordable'
      }"
           data-card-id="${escapeHtmlAttribute(cardData.id)}">
        <div class="card-header">
          <div class="card-cost ${canAfford ? '' : 'insufficient-energy'}">${escapeHtml(displayCost)}</div>
          <div class="card-rarity-badge"><span class="card-rarity-gem"></span>${escapeHtml(this.translateRarity(cardData.rarity))}</div>
        </div>
        <div class="card-artwork">
          <div class="card-emoji">${escapeHtml(cardData.emoji)}</div>
          <div class="card-keywords">
            ${cardData.innate ? '<div class="card-keyword innate">固有</div>' : ''}
            ${cardData.retain ? '<div class="card-keyword retain">保留</div>' : ''}
            ${cardData.exhaust ? '<div class="card-keyword exhaust">消耗</div>' : ''}
            ${cardData.ethereal ? '<div class="card-keyword ethereal">空灵</div>' : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="card-title-row">
            <div class="card-name">${escapeHtml(cardData.name)}</div>
            <div class="card-type-indicator">${escapeHtml(this.translateCardType(cardData.type))}</div>
          </div>
          ${cardData.description ? `<div class="card-description">${escapeHtml(cardData.description)}</div>` : ''}
        </div>
        <div class="card-glow"></div>
      </div>
    `);

    // 添加悬停效果
    cardElement
      .on('mouseenter', () => {
        // 检查是否刚结束拖动，如果是则不响应hover
        const playMode = CardPlayMode.getInstance();
        if ((playMode as any).justEndedDrag || cardElement.data('justEndedDrag')) {
          return;
        }
        // 再次确认没有dragging类
        if (cardElement.hasClass('dragging')) {
          return;
        }
        cardElement.addClass('card-hover');
        this.showCardTooltip(cardElement, cardData);
      })
      .on('mouseleave', () => {
        cardElement.removeClass('card-hover');
        this.hideCardTooltip();
      });

    // 保存原始点击处理器
    const originalClickHandler = () => {
      // 点击时也隐藏工具提示，防止工具提示卡住
      this.hideCardTooltip();
    };
    cardElement.data('originalClick', originalClickHandler);
    cardElement.on('click', originalClickHandler);

    // 存储cardData到元素，供CardPlayMode使用
    cardElement.data('cardData', cardData);

    // 绑定出牌模式事件（拖动、触摸等）
    const playMode = CardPlayMode.getInstance();
    playMode.bindCardEvents(cardElement);

    return cardElement;
  }

  /**
   * 显示卡牌工具提示
   */
  public static showCardTooltip(cardElement: JQuery, card: Card): void {
    // Hover and drag can request details in the same frame. Keep exactly one
    // tooltip instead of waiting for an older fade-out to finish.
    this.activeCardTooltip?.stop(true, true).remove();
    $('.card-tooltip').stop(true, true).remove();
    // 解析效果标签 - 工具提示内完整换行显示
    const effectTags = BattleUI.effectDisplay.programToTags(card.effectProgram);
    const wrappedEffectHTML = BattleUI.effectDisplay.createWrappedEffectTagsHTML(effectTags);

    const discardEffectTags = BattleUI.effectDisplay.programToTags(card.discardEffectProgram);
    const wrappedDiscardHTML = discardEffectTags.length
      ? BattleUI.effectDisplay.createWrappedEffectTagsHTML(discardEffectTags)
      : '';

    const tooltip = $(`
      <div class="card-tooltip" id="mwg-active-card-tooltip">
        <div class="tooltip-header">${escapeHtml(card.name)}</div>
        <div class="tooltip-meta">
          <span class="tooltip-cost">💎${escapeHtml(card.cost)}</span>
          <span class="tooltip-type">${escapeHtml(this.translateCardType(card.type))}</span>
          <span class="tooltip-rarity">${escapeHtml(this.translateRarity(card.rarity))}</span>
        </div>
        ${wrappedEffectHTML ? `<div class="tooltip-effects">${wrappedEffectHTML}</div>` : ''}
        ${wrappedDiscardHTML ? `<div class="tooltip-effects"><div class="tooltip-subtitle">此牌被战斗效果弃掉后：</div>${wrappedDiscardHTML}</div>` : ''}
        ${card.description ? `<div class="tooltip-description">${escapeHtml(card.description)}</div>` : ''}
        ${
          card.innate || card.retain || card.exhaust || card.ethereal
            ? `
          <div class="tooltip-keywords">
            ${card.innate ? '<span class="keyword">固有</span>' : ''}
            ${card.retain ? '<span class="keyword">保留</span>' : ''}
            ${card.exhaust ? '<span class="keyword">消耗</span>' : ''}
            ${card.ethereal ? '<span class="keyword">空灵</span>' : ''}
          </div>
        `
            : ''
        }
      </div>
    `);

    $('body').append(tooltip);
    this.activeCardTooltip = tooltip;
    this.activeCardTooltipAnchor = cardElement;
    this.repositionCardTooltip(cardElement);

    tooltip.fadeIn(200);
    requestAnimationFrame(() => {
      $('.card-tooltip').not(tooltip).stop(true, true).remove();
    });
  }

  /** Keep the details visually attached to the actual card or drag ghost. */
  public static repositionCardTooltip(cardElement?: JQuery): void {
    const tooltip = this.activeCardTooltip;
    const anchor = cardElement || this.activeCardTooltipAnchor;
    const element = anchor?.get(0) as HTMLElement | undefined;
    if (!tooltip?.length || !element?.isConnected) return;
    this.activeCardTooltipAnchor = anchor || null;
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(360, Math.max(260, viewportWidth - 16));
    tooltip.css({ position: 'fixed', width, visibility: 'hidden', display: 'block', zIndex: 5000 });
    const height = Math.min(tooltip.outerHeight() || 220, viewportHeight - 16);
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - 8));
    const top =
      rect.top >= height + 10
        ? rect.top - height - 8
        : Math.max(8, Math.min(rect.bottom + 8, viewportHeight - height - 8));
    const isAbove = top < rect.top;
    const arrowLeft = Math.max(14, Math.min(rect.left + rect.width / 2 - left, width - 14));
    tooltip
      .toggleClass('is-above', isAbove)
      .toggleClass('is-below', !isAbove)
      .addClass('is-card-attached')
      .css({
        left,
        top,
        maxHeight: viewportHeight - 16,
        visibility: 'visible',
        '--tooltip-arrow-left': `${arrowLeft}px`,
      });
  }

  /**
   * 隐藏卡牌工具提示
   */
  private static hideCardTooltip(): void {
    this.activeCardTooltip = null;
    this.activeCardTooltipAnchor = null;
    $('.card-tooltip').stop(true, true).remove();
  }

  /**
   * 更新牌堆计数
   */
  static updateDeckCounts(gameState: any): void {
    if (!gameState?.player) {
      console.warn('⚠️ updateDeckCounts: 没有找到玩家数据');
      return;
    }

    const player = gameState.player;

    $('#deck-pile-count').text(player.deck?.length || 0);

    // 更新抽牌堆计数
    const drawPileCount = player.drawPile?.length || 0;
    $('#draw-pile-count').text(drawPileCount);

    // 更新弃牌堆计数
    const discardPileCount = player.discardPile?.length || 0;
    $('#discard-pile-count').text(discardPileCount);

    // 更新消耗堆计数
    const exhaustPileCount = player.exhaustPile?.length || 0;
    $('#exhaust-pile-count').text(exhaustPileCount);
  }

  /**
   * 更新遗物显示
   */
  private static updateRelicsDisplay(relics: any[]): void {
    // 使用HTML中已存在的遗物区域
    const relicsContainer = $('.relic-grid');
    if (relicsContainer.length === 0) {
      console.warn('遗物容器不存在');
      return;
    }

    if (!relics || relics.length === 0) {
      relicsContainer.empty();
      return;
    }

    const relicsHTML = relics
      .map((relic, index) => {
        return `
        <div class="relic-container"
             data-relic-id="${escapeHtmlAttribute(relic.id)}"
             data-relic-name="${escapeHtmlAttribute(relic.name || '未知遗物')}"
             data-relic-description="${escapeHtmlAttribute(relic.description || '无描述')}"
             data-relic-index="${index}">
          <button type="button" class="relic-toggle support-icon-button"
                  aria-label="查看遗物：${escapeHtmlAttribute(relic.name || '未知遗物')}"
                  title="${escapeHtmlAttribute(relic.name || '未知遗物')}">
            <span aria-hidden="true">${escapeHtml(relic.emoji || '📿')}</span>
          </button>
        </div>
      `;
      })
      .join('');

    relicsContainer.html(relicsHTML);

    // 绑定点击事件
    relicsContainer.find('.relic-toggle').on('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const container = $(this).closest('.relic-container');
      const relic = relics[Number(container.data('relic-index'))];
      BattleUI.showSupportDetails($(this), relic, '遗物');
    });
  }

  /**
   * 更新状态效果显示
   */
  private static updateStatusEffects(target: 'player' | 'enemy', statusEffects: any[]): void {
    const selector = target === 'player' ? '#player-status-effects' : '#enemy-status-effects';
    const container = $(selector);

    if (container.length === 0) {
      console.warn(`状态效果容器不存在: ${selector}`);
      return;
    }

    const statusHTML = statusEffects
      .map(status => {
        // 获取状态定义
        const statusDef = DynamicStatusManager.getInstance().getStatusDefinition(status.id);
        const emoji = statusDef?.emoji || '⚡';
        const name = statusDef?.name || status.name || status.id;
        const stacks = status.stacks || 1;
        const duration = status.duration;

        const title = `${name}${stacks > 0 ? ` · ${stacks}层` : ''}${duration && duration > 0 ? ` · ${duration}回合` : ''}`;

        return `
          <button type="button" class="status-effect-item support-icon-button clickable"
               data-status-id="${escapeHtmlAttribute(status.id)}"
               data-target="${target}"
               aria-label="查看状态：${escapeHtmlAttribute(title)}"
               title="${escapeHtmlAttribute(title)}">
            <span class="status-effect-emoji" aria-hidden="true">${escapeHtml(emoji)}</span>
            ${stacks > 1 ? `<span class="status-stack-badge">${escapeHtml(stacks)}</span>` : ''}
            ${duration && duration > 0 ? `<span class="status-duration-badge">${escapeHtml(duration)}</span>` : ''}
          </button>
        `;
      })
      .join('');

    container.html(statusHTML);

    // 绑定点击事件
    container
      .find('.status-effect-item')
      .off('click')
      .on('click', function () {
        const statusId = $(this).data('status-id');
        const target = $(this).data('target');
        const status = statusEffects.find(s => s.id === statusId);
        if (status) {
          BattleUI.showStatusDetail(statusId, target);
        }
      });
  }

  /**
   * 计算状态效果的实际数值显示
   */
  private static calculateStatusEffectValue(_status: any, statusDef: any): string | null {
    for (const program of statusDef?.triggers?.hold || []) {
      for (const node of program.steps || []) {
        if (node.op !== 'modify' || typeof node.value !== 'number') continue;
        const prefixes = { add: '+', subtract: '-', multiply: '×', divide: '÷', set: '=' } as const;
        return ` ${prefixes[node.operator as keyof typeof prefixes]}${node.value}`;
      }
    }
    return null;
  }

  /**
   * 更新能力显示
   */
  private static updateAbilitiesDisplay(playerAbilities: any[], enemyAbilities: any[]): void {
    // 更新玩家能力
    const playerAbilitiesContainer = document.getElementById('player-abilities');
    if (playerAbilitiesContainer) {
      if (playerAbilities.length > 0) {
        playerAbilitiesContainer.innerHTML = playerAbilities.map(ability => this.createAbilityHTML(ability)).join('');
        this.bindAbilityDetails($('#player-abilities'), playerAbilities, '我方能力');
      } else {
        playerAbilitiesContainer.innerHTML = '';
      }
    }

    // 更新敌人能力
    const enemyAbilitiesContainer = document.getElementById('enemy-abilities');
    if (enemyAbilitiesContainer) {
      if (enemyAbilities.length > 0) {
        enemyAbilitiesContainer.innerHTML = enemyAbilities.map(ability => this.createAbilityHTML(ability)).join('');
        this.bindAbilityDetails($('#enemy-abilities'), enemyAbilities, '敌人能力');
      } else {
        enemyAbilitiesContainer.innerHTML = '';
      }
    }
  }

  private static bindEnemyIntentDetails(enemy: any): void {
    const action = enemy?.nextAction || (Array.isArray(enemy?.actions) ? enemy.actions[0] : null);
    const intent = $('.enemy-intent');
    intent.toggleClass('clickable', !!action).attr('tabindex', action ? '0' : '-1');
    intent.off('.mwgIntentDetail');
    if (!action) return;
    const open = (event: JQuery.TriggeredEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      BattleUI.showSupportDetails(intent, action, '敌方行动');
    };
    intent.on('click.mwgIntentDetail', open);
    intent.on('keydown.mwgIntentDetail', event => {
      if (event.key === 'Enter' || event.key === ' ') open(event);
    });
  }

  /**
   * 创建能力HTML
   */
  private static createAbilityHTML(ability: any): string {
    const effectTags = BattleUI.effectDisplay.triggeredProgramToTags(ability.trigger, ability.effectProgram);
    const effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(effectTags);
    const description = typeof ability.description === 'string' ? ability.description.trim() : '';
    const name = typeof ability.name === 'string' ? ability.name.trim() : ability.id;
    const source = typeof ability.source === 'string' && ability.source.trim() ? ability.source.trim() : '来源未注明';

    return `
      <button type="button" class="ability-item"
           data-ability-id="${escapeHtmlAttribute(ability.id)}"
           data-ability-name="${escapeHtmlAttribute(name || ability.id)}"
           data-ability-description="${escapeHtmlAttribute(description)}"
           data-ability-source="${escapeHtmlAttribute(source)}"
           aria-label="查看能力：${escapeHtmlAttribute(name || ability.id)}"
           title="${escapeHtmlAttribute(name || ability.id)}">
        <span class="ability-emoji" aria-hidden="true">${escapeHtml(ability.emoji || '⚡')}</span>
        <span class="ability-name visually-hidden">${escapeHtml(name || '未命名能力')}</span>
        <span class="ability-effect-preview" aria-hidden="true">${effectTagsHTML || '<span class="ability-error">无效能力</span>'}</span>
      </button>
    `;
  }

  private static bindAbilityDetails(container: JQuery, abilities: any[], ownerLabel: string): void {
    container
      .find('.ability-item')
      .each((index, element) => {
        $(element).data('ability', abilities[index]);
      })
      .off('click.mwgAbility')
      .on('click.mwgAbility', function (event) {
        event.preventDefault();
        event.stopPropagation();
        BattleUI.showSupportDetails($(this), $(this).data('ability'), ownerLabel);
      });
  }

  private static showSupportDetails(anchor: JQuery, value: any, ownerLabel: string): void {
    $('.support-details-popover').remove();
    if (!value) return;
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.id || ownerLabel;
    const description = typeof value.description === 'string' ? value.description.trim() : '';
    const source = typeof value.source === 'string' ? value.source.trim() : '';
    const trigger = typeof value.trigger === 'string' ? value.trigger.trim() : '';
    const displayContext = ownerLabel.startsWith('敌')
      ? { selfLabel: '敌方', opponentLabel: '我方' }
      : { selfLabel: '自身', opponentLabel: '敌方' };
    const effectTags = trigger
      ? this.effectDisplay.triggeredProgramToTags(trigger, value.effectProgram, displayContext)
      : this.effectDisplay.programToTags(value.effectProgram, displayContext);
    const popover = $(`
      <div class="support-details-popover" role="dialog" aria-label="${escapeHtmlAttribute(name)}">
        <div class="support-details-heading">
          <span>${escapeHtml(value.emoji || (ownerLabel.includes('欲望') ? '💗' : ownerLabel === '遗物' ? '🔮' : '⚡'))}</span>
          <strong>${escapeHtml(name)}</strong>
          <small>${escapeHtml(ownerLabel)}</small>
        </div>
        ${description ? `<div class="support-details-description">${escapeHtml(description)}</div>` : ''}
        ${source ? `<div class="support-details-source">来源：${escapeHtml(source)}</div>` : ''}
        <div class="support-details-effects">${this.effectDisplay.createWrappedEffectTagsHTML(effectTags)}</div>
      </div>
    `);
    $('body').append(popover);
    const offset = anchor.offset();
    const width = Math.min(430, ($(window).width() || 446) - 16);
    popover.css({ width });
    const height = popover.outerHeight() || 160;
    const viewportWidth = $(window).width() || width;
    const viewportHeight = $(window).height() || height;
    const anchorWidth = anchor.outerWidth() || 0;
    const anchorHeight = anchor.outerHeight() || 0;
    const left = offset
      ? Math.max(8, Math.min(offset.left + anchorWidth / 2 - width / 2, viewportWidth - width - 8))
      : Math.max(8, (viewportWidth - width) / 2);
    const preferredTop = offset ? offset.top + anchorHeight + 6 : (viewportHeight - height) / 2;
    const top = Math.max(8, Math.min(preferredTop, viewportHeight - height - 8));
    popover.css({ left, top });
    $(document)
      .off('click.mwgSupportPopover')
      .on('click.mwgSupportPopover', () => {
        $('.support-details-popover').remove();
        $(document).off('click.mwgSupportPopover');
      });
  }

  /**
   * 显示状态效果详情弹窗
   */
  public static showStatusDetail(statusId: string, target: string): void {
    // 获取状态定义和当前状态
    const statusDef = DynamicStatusManager.getInstance().getStatusDefinition(statusId);
    const gameState = GameStateManager.getInstance().getGameState();
    const entity = target === 'player' ? gameState.player : gameState.enemy;
    const currentStatus = entity?.statusEffects?.find((s: any) => s.id === statusId);

    if (!statusDef || !currentStatus) {
      console.warn(`未找到状态定义或当前状态: ${statusId}`);
      return;
    }

    // 生成效果解析
    let effectsHTML = '';
    if (statusDef.triggers) {
      Object.entries(statusDef.triggers).forEach(([trigger, effects]) => {
        if (!effects) return;
        const displayContext =
          target === 'enemy'
            ? { selfLabel: '敌方', opponentLabel: '我方' }
            : { selfLabel: '自身', opponentLabel: '敌方' };
        const programs = Array.isArray(effects) ? effects : [effects];
        const triggerTags = programs.flatMap(program =>
          BattleUI.effectDisplay.triggeredProgramToTags(trigger, program, displayContext),
        );
        if (triggerTags.length > 0) {
          const triggerNames: Record<string, string> = {
            apply: '获得时',
            stack: '叠加时',
            tick: '回合变化时',
            remove: '消失时',
            hold: '持续生效',
          };
          effectsHTML += `<section class="status-trigger-group">
            <div class="status-trigger-label">${escapeHtml(triggerNames[trigger] || trigger)}</div>
            ${BattleUI.effectDisplay.createWrappedEffectTagsHTML(triggerTags)}
          </section>`;
        }
      });
    }

    // 移除已存在的弹窗
    $('.status-detail-modal').remove();

    // 创建弹窗
    const modal = $(`
      <div class="status-detail-modal">
        <div class="status-detail-overlay"></div>
        <div class="status-detail-content">
          <div class="status-detail-header">
            <div class="status-detail-icon">${escapeHtml(statusDef.emoji || '⚡')}</div>
            <div class="status-detail-name">${escapeHtml(statusDef.name)}</div>
            <button class="close-status-detail">&times;</button>
          </div>
          <div class="status-detail-body">
            <div class="status-description">${escapeHtml(statusDef.description || '无额外叙事说明')}</div>
              <div class="status-stats">
              <div>层数: ${escapeHtml(currentStatus.stacks || 1)}</div>
              <div>类型: ${statusDef.type === 'buff' ? '增益' : statusDef.type === 'debuff' ? '减益' : '中性'}</div>
              ${statusDef.maxStacks ? `<div>层数上限: ${escapeHtml(statusDef.maxStacks)}</div>` : ''}
              ${statusDef.stacks_change ? `<div>回合变化: ${escapeHtml(statusDef.stacks_change)}</div>` : ''}
            </div>
            <div class="status-detail-effects"><h4>完整效果</h4>${effectsHTML || '<div class="status-no-effect">没有额外数值效果，仅保留层数或特殊状态规则。</div>'}</div>
          </div>
        </div>
      </div>
    `);

    $('body').append(modal);

    // 动画显示
    modal.css({ opacity: 0 }).animate({ opacity: 1 }, 200);

    // 绑定关闭事件
    modal.find('.close-status-detail, .status-detail-overlay').on('click', () => {
      modal.animate({ opacity: 0 }, 200, function () {
        $(this).remove();
      });
    });
  }

  /**
   * 更新欲望效果显示
   */
  private static updateLustEffectDisplay(target: 'player' | 'enemy', lustEffect: any): void {
    const containerId = target === 'enemy' ? '#enemy-lust-effect' : '#player-lust-effect';
    const container = $(containerId);

    if (lustEffect && lustEffect.name) {
      const displayContext =
        target === 'enemy'
          ? { selfLabel: '敌方', opponentLabel: '我方' }
          : { selfLabel: '自身', opponentLabel: '敌方' };
      const effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(
        BattleUI.effectDisplay.programToTags(lustEffect.effectProgram, displayContext),
      );

      const description = typeof lustEffect.description === 'string' ? lustEffect.description.trim() : '';
      const effectHTML = `
        <div class="lust-effect-container">
          <span class="lust-effect-label">欲望效果：</span>
          <button type="button" class="lust-effect-toggle" aria-label="查看欲望效果：${escapeHtmlAttribute(lustEffect.name)}" title="点击查看完整效果">${escapeHtml(lustEffect.name)}</button>
          <div class="lust-effect-details">
            <div class="lust-effect-name">${escapeHtml(lustEffect.name)}</div>
            <div class="lust-effect-description">${escapeHtml(description)}</div>
            ${effectTagsHTML ? `<div class="lust-effect-tags">${effectTagsHTML}</div>` : ''}
          </div>
        </div>
      `;
      container.html(effectHTML);

      // 欲望效果与遗物、能力共用可越过紧凑栏裁切的详情层。
      container
        .find('.lust-effect-toggle')
        .off('click.mwgLustDetail')
        .on('click.mwgLustDetail', function (event) {
          event.preventDefault();
          event.stopPropagation();
          BattleUI.showSupportDetails($(this), lustEffect, target === 'enemy' ? '敌人欲望效果' : '我方欲望效果');
        });
    } else {
      container.empty();
    }
  }
}
