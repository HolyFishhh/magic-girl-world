/**
 * 战斗UI管理模块
 */

import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';
import { GameStateManager } from '../core/gameStateManager';
import { Card } from '../types';
import { PileStatsDisplay } from './pileViewer';
import { UnifiedEffectDisplay } from './unifiedEffectDisplay';

export class BattleUI {
  private static effectDisplay = UnifiedEffectDisplay.getInstance();
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
      Corrupted: '腐化',
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
        PileStatsDisplay.updatePileStats(drawCount, discardCount, exhaustCount);
      }
      this.updateDeckCounts(gameState);

      // 更新能力显示
      this.updateAbilitiesDisplay(gameState.player.abilities || [], gameState.enemy?.abilities || []);

      console.log('✅ 战斗UI刷新完成');
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

    // 更新敌人血条
    const enemyHpPercent = enemy.maxHp > 0 ? (enemy.currentHp / enemy.maxHp) * 100 : 0;
    $('.enemy-card .hp-fill').css('width', `${enemyHpPercent}%`);
    $('#enemy-hp').text(`${enemy.currentHp}/${enemy.maxHp}`);

    // 更新敌人欲望条
    const enemyLustPercent = enemy.maxLust > 0 ? (enemy.currentLust / enemy.maxLust) * 100 : 0;

    // 使用新的统一选择器
    $('.enemy-card .lust-fill').css('width', `${enemyLustPercent}%`);
    $('#enemy-lust').text(`${enemy.currentLust}/${enemy.maxLust}`);

    // 更新敌人格挡 - 条件显示
    const enemyBlockValue = enemy.block || 0;
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
    const playerHp = player.currentHp || 0;
    const playerMaxHp = player.maxHp || 100;
    const playerLust = player.currentLust || 0;
    const playerMaxLust = player.maxLust || 100;
    const playerEnergy = player.energy || 0;
    const playerBlock = player.block || 0;

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
    $('#player-energy').text(`${playerEnergy}/${player.maxEnergy || 3}`);

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
    $('#game-phase').text(phaseText);
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
        console.log('没有手牌数据或手牌为空');
        return;
      }

      // 过滤掉元数据标记
      const validCards = this.filterMetadata(handCards);

      // 开始创建手牌元素 - 移除日志减少输出

      validCards.forEach((card: any, index: number) => {
        if (card && card.name) {
          const cardElement = this.createEnhancedCardElement(card, index);
          handContainer.append(cardElement);
        }
      });

      // 自适应单行：能放下一行则按正常间距铺开；放不下时才重叠压缩
      try {
        const count = validCards.length;
        const handContainerWidth = handContainer.width() || 0;
        const cardWidth = 110; // 与样式保持一致
        const normalGap = 10; // 正常间距
        const maxVisible = 10; // 手牌上限
        const minOverlapOffset = 16; // 最小重叠偏移

        const normalOffset = cardWidth + normalGap;
        const neededWidthNormal = cardWidth + (count - 1) * normalOffset;

        let offset: number;
        if (neededWidthNormal <= handContainerWidth) {
          // 一行能放下：不重叠
          offset = normalOffset;
        } else {
          // 一行放不下：开始重叠压缩，确保仍保持单行
          offset = Math.floor((handContainerWidth - cardWidth) / Math.max(1, count - 1));
          offset = Math.max(minOverlapOffset, Math.min(offset, normalOffset));
          if (count > maxVisible) {
            const limitOffset = Math.floor((handContainerWidth - cardWidth) / (maxVisible - 1));
            offset = Math.min(offset, limitOffset);
          }
        }

        handContainer.attr('data-count', String(count));
        handContainer.css('--card-offset', (offset + 'px') as any);

        const cards = handContainer.children('.enhanced-card');
        cards.each((i, el) => {
          const left = i * offset;
          $(el).css({ left: `${left}px` });
        });
      } catch (e) {
        console.warn('手牌重叠布局计算失败:', e);
      }

      console.log(`✅ 更新手牌显示完成，显示了 ${validCards.length} 张卡牌`);
    } catch (error) {
      console.error('❌ 更新手牌显示失败:', error);
    }
  }

  /**
   * 创建增强的卡牌元素
   */
  private static createEnhancedCardElement(card: any, index: number): JQuery {
    // 创建卡牌元素 - 移除日志减少输出

    // 确保卡牌有必要的属性
    // 规范化类型与稀有度：将 Corrupt 作为稀有度处理
    let normalizedType: any = card.type || 'Skill';
    let normalizedRarity: any = card.rarity || 'Common';
    if (normalizedType === 'Corrupt') {
      normalizedType = 'Skill';
      normalizedRarity = 'Corrupt';
    }

    const cardData: Card = {
      id: card.id || card.originalId || `card_${index}`,
      name: card.name || '未知卡牌',
      cost: card.cost || 0,
      type: normalizedType,
      rarity: normalizedRarity,
      emoji: card.emoji || '🃏',
      effect: card.effect || '',
      description: card.description || '',
      discard_effect: (card as any).discard_effect, // 透传AI动态卡牌的弃牌效果
      retain: card.retain || false,
      exhaust: card.exhaust || false,
      ethereal: card.ethereal || false,
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
    const isClickable = isPlayerTurn && (canAfford || isCurse) && !isStunned;

    // 创建完整的卡牌元素
    const cardElement = $(`
      <div class="card enhanced-card rarity-${cardData.rarity} card-type-${cardData.type} ${
        isClickable ? 'clickable' : 'unaffordable'
      }"
           data-card-id="${cardData.id}">
        <div class="card-header">
          <div class="card-cost ${canAfford ? '' : 'insufficient-energy'}">${displayCost}</div>
          <div class="card-rarity-gem"></div>
          <div class="card-type-indicator">${this.translateCardType(cardData.type)}</div>
        </div>
        <div class="card-artwork">
          <div class="card-emoji">${cardData.emoji}</div>
          ${cardData.retain ? '<div class="card-keyword retain">保留</div>' : ''}
          ${cardData.exhaust ? '<div class="card-keyword exhaust">消耗</div>' : ''}
          ${cardData.ethereal ? '<div class="card-keyword ethereal">空灵</div>' : ''}
        </div>
        <div class="card-body">
          <div class="card-name">${cardData.name}</div>
          <div class="card-description">${cardData.description}</div>
        </div>
        <div class="card-glow"></div>
      </div>
    `);

    // 添加悬停效果
    cardElement
      .on('mouseenter', () => {
        cardElement.addClass('card-hover');
        this.showCardTooltip(cardElement, cardData);
      })
      .on('mouseleave', () => {
        cardElement.removeClass('card-hover');
        this.hideCardTooltip();
      })
      .on('click', () => {
        // 点击时也隐藏工具提示，防止工具提示卡住
        this.hideCardTooltip();
      });

    return cardElement;
  }

  /**
   * 显示卡牌工具提示
   */
  private static showCardTooltip(cardElement: JQuery, card: Card): void {
    // 解析效果标签 - 工具提示内完整换行显示
    const effectTags = BattleUI.effectDisplay.parseEffectToTags(card.effect || '', { isPlayerCard: true });
    const wrappedEffectHTML = BattleUI.effectDisplay.createWrappedEffectTagsHTML(effectTags);

    // 解析弃牌效果标签
    const discardEffectRaw = (card as any).discard_effect;
    const discardEffectTags = discardEffectRaw
      ? BattleUI.effectDisplay.parseEffectToTags(discardEffectRaw, { isPlayerCard: true })
      : [];
    let wrappedDiscardHTML = discardEffectTags.length
      ? BattleUI.effectDisplay.createWrappedEffectTagsHTML(discardEffectTags)
      : '';
    // 解析失败降级为原始文本标签
    if (!wrappedDiscardHTML && discardEffectRaw) {
      const fallback = String(discardEffectRaw);
      const spans = fallback
        .split(',')
        .map(t => `<span class=\"effect-tag\">${t.trim()}</span>`) // 粗略降级
        .join('');
      wrappedDiscardHTML = `<div class=\"effect-tags-container wrapped\">${spans}</div>`;
    }

    const tooltip = $(`
      <div class="card-tooltip">
        <div class="tooltip-header">${card.name}</div>
        <div class="tooltip-meta">
          <span class="tooltip-cost">💎${card.cost}</span>
          <span class="tooltip-type">${this.translateCardType(card.type)}</span>
          <span class="tooltip-rarity">${this.translateRarity(card.rarity)}</span>
        </div>
        ${wrappedEffectHTML ? `<div class="tooltip-effects">${wrappedEffectHTML}</div>` : ''}
        ${wrappedDiscardHTML ? `<div class="tooltip-effects"><div class="tooltip-subtitle">被弃掉时：</div>${wrappedDiscardHTML}</div>` : ''}
        <div class="tooltip-description">${card.description}</div>
        ${
          card.retain || card.exhaust || card.ethereal
            ? `
          <div class="tooltip-keywords">
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

    // 定位工具提示（智能：左右优先，不足则上下）
    const offset = cardElement.offset();
    if (offset) {
      const $win = $(window);
      const vw = $win.width() || 0;
      const vh = $win.height() || 0;
      const cardW = cardElement.outerWidth() || 0;
      const cardH = cardElement.outerHeight() || 0;
      const tooltipWidth = 320;
      const tooltipHeight = 220; // 预估

      const spaceRight = vw - (offset.left + cardW);
      const spaceLeft = offset.left;
      const spaceAbove = offset.top;
      // const spaceBelow = vh - (offset.top + cardH);

      let left = 0;
      let top = 0;

      if (spaceRight >= tooltipWidth + 12) {
        left = offset.left + cardW + 8;
        top = Math.max(8, Math.min(offset.top, vh - tooltipHeight - 8));
      } else if (spaceLeft >= tooltipWidth + 12) {
        left = offset.left - tooltipWidth - 8;
        top = Math.max(8, Math.min(offset.top, vh - tooltipHeight - 8));
      } else if (spaceAbove >= tooltipHeight + 12) {
        left = Math.max(8, Math.min(offset.left + cardW / 2 - tooltipWidth / 2, vw - tooltipWidth - 8));
        top = offset.top - tooltipHeight - 8;
      } else {
        left = Math.max(8, Math.min(offset.left + cardW / 2 - tooltipWidth / 2, vw - tooltipWidth - 8));
        top = offset.top + cardH + 8;
      }

      tooltip.css({ position: 'absolute', left, top, width: tooltipWidth, zIndex: 1000 });
    }

    tooltip.fadeIn(200);
  }

  /**
   * 隐藏卡牌工具提示
   */
  private static hideCardTooltip(): void {
    $('.card-tooltip').fadeOut(200, function () {
      $(this).remove();
    });
  }

  /**
   * 过滤元数据
   */
  private static filterMetadata(arr: any[]): any[] {
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      item => item !== '$__META_EXTENSIBLE__$' && item !== '[]' && item !== undefined && item !== null && item !== '',
    );
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

    // 更新抽牌堆计数
    const drawPileCount = player.drawPile?.length || 0;
    $('#draw-pile-count').text(drawPileCount);

    // 更新弃牌堆计数
    const discardPileCount = player.discardPile?.length || 0;
    $('#discard-pile-count').text(discardPileCount);

    // 更新消耗堆计数
    const exhaustPileCount = player.exhaustPile?.length || 0;
    $('#exhaust-pile-count').text(exhaustPileCount);

    console.log(`牌堆计数更新 - 抽牌堆: ${drawPileCount}, 弃牌堆: ${discardPileCount}, 消耗堆: ${exhaustPileCount}`);
    console.log('牌堆状态:', {
      hand: player.hand?.length || 0,
      drawPile: player.drawPile?.length || 0,
      discardPile: player.discardPile?.length || 0,
      exhaustPile: player.exhaustPile?.length || 0,
    });
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
      relicsContainer.html('<div class="no-relics">暂无遗物</div>');
      return;
    }

    const relicsHTML = relics
      .map(relic => {
        return `
        <div class="relic-container"
             data-relic-id="${relic.id}"
             data-relic-name="${relic.name || '未知遗物'}"
             data-relic-description="${relic.description || '无描述'}"
             data-relic-effect="${relic.effect || '无效果'}">
          <button class="relic-toggle">${relic.emoji || '📿'} ${relic.name || '未知遗物'}</button>
        </div>
      `;
      })
      .join('');

    relicsContainer.html(relicsHTML);

    // 绑定点击事件
    relicsContainer.find('.relic-toggle').on('click', function () {
      const container = $(this).closest('.relic-container');
      const isExpanded = container.hasClass('expanded');

      // 先收缩所有其他遗物并移除详情
      $('.relic-container').removeClass('expanded');
      $('.relic-details').remove();

      // 如果当前遗物之前没有展开，则展开它并创建详情
      if (!isExpanded) {
        container.addClass('expanded');

        // 动态创建详情内容
        const relicName = container.data('relic-name');
        const relicDescription = container.data('relic-description');
        const relicEffect = container.data('relic-effect');

        const effectTags = BattleUI.effectDisplay.parseEffectToTags(relicEffect || '', {
          isPlayerCard: true,
          isStatusDisplay: true,
        });
        const effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(effectTags);

        const detailsHTML = `
          <div class="relic-details">
            <div class="relic-name">${relicName}</div>
            <div class="relic-description">${relicDescription}</div>
            <div class="relic-effects">${effectTagsHTML}</div>
          </div>
        `;

        container.append(detailsHTML);
      }
    });

    console.log(`🔮 更新遗物显示: ${relics.length} 个遗物`, relics);
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

    console.log(`🎭 更新${target}状态效果:`, statusEffects);

    const statusHTML = statusEffects
      .map(status => {
        console.log(`🔍 处理状态效果:`, status);

        // 获取状态定义
        const statusDef = DynamicStatusManager.getInstance().getStatusDefinition(status.id);
        const emoji = statusDef?.emoji || '⚡';
        const name = statusDef?.name || status.name || status.id;
        const stacks = status.stacks || 1;
        const duration = status.duration;

        // 构建显示文本，包含实际效果值
        let displayText = `${emoji} ${name}`;

        // 计算并显示实际效果值
        // 总是先显示层数（>0）
        if (stacks > 0) {
          displayText += ` ${stacks}`;
        }

        // 再尝试显示修饰值（如果有）
        const effectValue = BattleUI.calculateStatusEffectValue(status, statusDef);
        if (effectValue !== null) {
          displayText += effectValue;
        }

        if (duration && duration > 0) {
          displayText += ` (${duration})`;
        }

        return `
          <div class="status-effect-item clickable"
               data-status-id="${status.id}"
               data-target="${target}">
            ${displayText}
          </div>
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

    console.log(`🎭 更新${target}状态效果: ${statusEffects.length} 个`);
  }

  /**
   * 计算状态效果的实际数值显示
   */
  private static calculateStatusEffectValue(status: any, statusDef: any): string | null {
    const triggers = statusDef?.triggers;
    const tickEffects = triggers?.tick;
    if (!tickEffects) return null;

    // 根据新的变量结构，tick现在是字符串而不是数组
    const tickList: string[] = Array.isArray(tickEffects) ? tickEffects : [tickEffects];

    const stacks = status?.stacks || 1;

    // 查找修饰符效果
    for (const effect of tickList) {
      // 处理stacks占位符
      const processedEffect = effect.replace(/stacks/g, stacks.toString());

      // 匹配修饰符模式
      const modifierPatterns = [
        { regex: /ME\.damage_modifier\s*\+\s*([\d.]+)/, prefix: '+' },
        { regex: /ME\.damage_modifier\s*-\s*([\d.]+)/, prefix: '-' },
        { regex: /ME\.lust_damage_modifier\s*\+\s*([\d.]+)/, prefix: '+' },
        { regex: /ME\.lust_damage_modifier\s*-\s*([\d.]+)/, prefix: '-' },
        { regex: /ME\.block_modifier\s*\+\s*([\d.]+)/, prefix: '+' },
        { regex: /ME\.block_modifier\s*-\s*([\d.]+)/, prefix: '-' },
        { regex: /ME\.damage_taken_modifier\s*\+\s*([\d.]+)/, prefix: '+' },
        { regex: /ME\.damage_taken_modifier\s*-\s*([\d.]+)/, prefix: '-' },
        { regex: /ME\.lust_damage_taken_modifier\s*\+\s*([\d.]+)/, prefix: '+' },
        { regex: /ME\.lust_damage_taken_modifier\s*-\s*([\d.]+)/, prefix: '-' },
      ];

      for (const pattern of modifierPatterns) {
        const match = processedEffect.match(pattern.regex);
        if (match) {
          const value = parseFloat(match[1]);
          return ` ${pattern.prefix}${value}`;
        }
      }

      // 匹配乘法和除法
      const multiplyMatch = processedEffect.match(/ME\.\w+\s*\*\s*([\d.]+)/);
      if (multiplyMatch) {
        const multiplier = parseFloat(multiplyMatch[1]);
        return ` ×${multiplier}`;
      }

      const divideMatch = processedEffect.match(/ME\.\w+\s*\/\s*([\d.]+)/);
      if (divideMatch) {
        const divisor = parseFloat(divideMatch[1]);
        return ` ÷${divisor}`;
      }

      // 匹配设置值
      const setMatch = processedEffect.match(/ME\.\w+\s*=\s*([\d.]+)/);
      if (setMatch) {
        const setValue = parseFloat(setMatch[1]);
        return ` =${setValue}`;
      }
    }

    // 如果没有找到修饰符效果，不再返回层数（层数已在外层统一显示）
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
      } else {
        playerAbilitiesContainer.innerHTML = '';
      }
    }

    // 更新敌人能力
    const enemyAbilitiesContainer = document.getElementById('enemy-abilities');
    if (enemyAbilitiesContainer) {
      if (enemyAbilities.length > 0) {
        enemyAbilitiesContainer.innerHTML = enemyAbilities.map(ability => this.createAbilityHTML(ability)).join('');
      } else {
        enemyAbilitiesContainer.innerHTML = '';
      }
    }
  }

  /**
   * 创建能力HTML
   */
  private static createAbilityHTML(ability: any): string {
    // 能力只支持新格式：effect字段包含完整的触发条件（如 "turn_start: ME.lust - 2" 或 "passive: damage + 5"）
    const effectString = ability.effect || '无效能力';

    const effectTags = BattleUI.effectDisplay.parseEffectToTags(effectString, {
      isPlayerCard: false,
      isStatusDisplay: true,
    });
    const effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(effectTags);

    return `
      <div class="ability-item" data-ability-id="${ability.id}">
        ${effectTagsHTML || '<div class="ability-error">无效能力</div>'}
      </div>
    `;
  }

  /**
   * 显示状态效果详情弹窗
   */
  public static showStatusDetail(statusId: string, target: string): void {
    console.log(`显示状态详情: ${statusId} (${target})`);

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
      const allEffects: string[] = [];

      Object.entries(statusDef.triggers).forEach(([trigger, effects]) => {
        if (effects) {
          // 根据新的变量结构，effects现在是字符串而不是数组
          if (Array.isArray(effects)) {
            // 兼容旧格式（数组）
            effects.forEach(effect => {
              const processedEffect = effect.replace(/stacks/g, currentStatus.stacks.toString());
              allEffects.push(`${trigger}: ${processedEffect}`);
            });
          } else {
            // 新格式（字符串）
            const processedEffect = (effects as string).replace(/stacks/g, currentStatus.stacks.toString());
            allEffects.push(`${trigger}: ${processedEffect}`);
          }
        }
      });

      if (allEffects.length > 0) {
        const allTags: any[] = [];
        const effectsByTrigger: { [key: string]: string[] } = {};

        allEffects.forEach(effectStr => {
          const [trigger, ...effectParts] = effectStr.split(':');
          const effect = effectParts.join(':').trim();
          if (!effectsByTrigger[trigger]) {
            effectsByTrigger[trigger] = [];
          }
          effectsByTrigger[trigger].push(effect);
        });

        Object.entries(effectsByTrigger).forEach(([trigger, effects]) => {
          const combinedEffect = effects.join(', ');
          const tags = BattleUI.effectDisplay.parseTriggeredEffectToTags(trigger, combinedEffect, {
            isPlayerCard: false,
            isStatusDisplay: true,
          });
          allTags.push(...tags);
        });

        effectsHTML = BattleUI.effectDisplay.createEffectTagsHTML(allTags);
      }
    }

    // 移除已存在的弹窗
    $('.status-detail-modal').remove();

    // 创建弹窗
    const modal = $(`
      <div class="status-detail-modal">
        <div class="status-detail-overlay"></div>
        <div class="status-detail-content">
          <div class="status-detail-header">
            <div class="status-detail-icon">${statusDef.emoji || '⚡'}</div>
            <div class="status-detail-name">${statusDef.name}</div>
            <button class="close-status-detail">&times;</button>
          </div>
          <div class="status-detail-body">
            <div class="status-description">${statusDef.description}</div>
              <div class="status-stats">
              <div>层数: ${currentStatus.stacks || 1}</div>
              <div>类型: ${statusDef.type === 'buff' ? '增益' : statusDef.type === 'debuff' ? '减益' : '中性'}</div>
            </div>
            ${effectsHTML ? `<div class="status-effects"><h4>效果:</h4>${effectsHTML}</div>` : ''}
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
      // 使用统一的效果解析系统（失败时降级为仅显示描述）
      let effectTagsHTML = '';
      try {
        const effectTags = BattleUI.effectDisplay.parseEffectToTags(lustEffect.effect || '', { isPlayerCard: false });
        effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(effectTags);
      } catch (e) {
        console.warn('欲望效果解析失败，降级为展示描述:', lustEffect.effect, e);
      }

      const effectHTML = `
        <div class="lust-effect-container">
          <button class="lust-effect-toggle">欲望效果</button>
          <div class="lust-effect-details">
            <div class="lust-effect-name">${lustEffect.name}</div>
            <div class="lust-effect-description">${lustEffect.description || ''}</div>
            ${effectTagsHTML ? `<div class="lust-effect-tags">${effectTagsHTML}</div>` : ''}
          </div>
        </div>
      `;
      container.html(effectHTML);

      // 绑定点击事件
      container.find('.lust-effect-toggle').on('click', function () {
        const container = $(this).closest('.lust-effect-container');
        const isExpanded = container.hasClass('expanded');

        // 先收缩所有其他欲望效果
        $('.lust-effect-container').removeClass('expanded');

        // 如果当前效果之前没有展开，则展开它
        if (!isExpanded) {
          container.addClass('expanded');
        }
      });
    } else {
      container.html('<div class="no-lust-effect">无特殊效果</div>');
    }
  }
}
