import { GameStateManager } from '../core/gameStateManager';
import { BattleLog } from '../modules/battleLog';
import { RelicEffectManager } from '../modules/relicEffectManager';
import { Card, Player } from '../types';
import { AnimationManager } from '../ui/animationManager';
import { EffectEngine } from './effectEngine';
import { UnifiedEffectExecutor } from './unifiedEffectExecutor';

export class CardSystem {
  private static instance: CardSystem;
  private gameStateManager: GameStateManager;
  private effectEngine: EffectEngine;
  private relicEffectManager: RelicEffectManager;
  private animationManager: AnimationManager | null = null;

  private constructor() {
    this.gameStateManager = GameStateManager.getInstance();
    this.effectEngine = EffectEngine.getInstance();
    this.relicEffectManager = RelicEffectManager.getInstance();
    // 延迟初始化 AnimationManager 以避免循环依赖
  }

  private getAnimationManager(): AnimationManager {
    if (!this.animationManager) {
      this.animationManager = AnimationManager.getInstance();
    }
    return this.animationManager;
  }

  public static getInstance(): CardSystem {
    if (!CardSystem.instance) {
      CardSystem.instance = new CardSystem();
    }
    return CardSystem.instance;
  }

  // 牌库管理
  public initializeDeck(cards: Card[]): void {
    const player = this.gameStateManager.getPlayer();

    // 为每张卡生成唯一ID
    const deckWithIds = cards.map((card, index) => ({
      ...card,
      id: card.id || `card_${Date.now()}_${index}`,
    }));

    this.gameStateManager.updatePlayer({
      deck: [...deckWithIds],
      drawPile: [...deckWithIds],
      hand: [],
      discardPile: [],
      exhaustPile: [],
    });

    this.shuffleDrawPile();
  }

  public shuffleDrawPile(): void {
    const player = this.gameStateManager.getPlayer();
    const shuffled = this.fisherYatesShuffle([...player.drawPile]);

    this.gameStateManager.updatePlayer({
      drawPile: shuffled,
    });

    // 抽牌堆已洗牌 - 移除日志减少输出
  }

  // 抽牌逻辑
  public drawCards(count: number): Card[] {
    return this.gameStateManager.drawCardsFromPile(count);
  }

  public drawStartingHand(): void {
    const player = this.gameStateManager.getPlayer();
    this.drawCards(player.drawPerTurn);
    // 抽取起始手牌 - 移除日志减少输出
  }

  // 卡牌使用
  public async playCard(cardId: string, targetType?: 'player' | 'enemy'): Promise<boolean> {
    const player = this.gameStateManager.getPlayer();
    const enemy = this.gameStateManager.getEnemy();

    if (!enemy) {
      console.error('❌ 没有敌人，无法使用卡牌');

      // 🔍 详细的卡牌使用调试信息
      console.error('🔍 ===== 卡牌使用失败调试信息 =====');
      console.error('📋 hasPlayer:', !!player);
      console.error('📋 gameState:', this.gameStateManager.getGameState());

      const variables = getVariables({ type: 'message' });
      console.error('📋 完整的MVU变量:', variables);
      console.error('📋 variables?.stat_data:', variables?.stat_data);
      console.error('📋 variables?.stat_data?.battle:', variables?.stat_data?.battle);
      console.error('📋 variables?.stat_data?.battle?.enemy:', variables?.stat_data?.battle?.enemy);
      console.error('📋 variables?.battle:', variables?.battle);
      console.error('📋 variables?.battle?.enemy:', variables?.battle?.enemy);
      console.error('🔍 ===== 卡牌使用失败调试信息结束 =====');

      return false;
    }

    // 检查是否为玩家回合
    if (this.gameStateManager.getCurrentPhase() !== 'player_turn') {
      console.log('不是玩家回合，无法使用卡牌');
      return false;
    }

    // 查找卡牌
    const card = player.hand.find(c => c.id === cardId);
    if (!card) {
      console.error('卡牌未找到:', cardId);
      return false;
    }

    // 检查能量是否足够
    const requiredEnergy = this.calculateCardEnergyCost(card, player);
    if (player.energy < requiredEnergy) {
      console.log('能量不足，无法使用卡牌');
      this.getAnimationManager().showCardBlockedNotification(card.name, '能量不足');
      // 确保清理任何悬停状态和工具提示
      this.clearCardInteractionStates();
      return false;
    }

    // 检查特殊限制（比如被支配状态下无法使用攻击牌）
    const blockReason = this.getCardBlockReason(card, player);
    if (blockReason) {
      console.log(`由于状态效果限制，无法使用此卡牌: ${blockReason}`);
      this.getAnimationManager().showCardBlockedNotification(card.name, blockReason);
      this.clearCardInteractionStates();
      return false;
    }

    // 检查弃牌需求
    if ((card as any).discard_requirement) {
      const discardCount = (card as any).discard_requirement;
      if (player.hand.length - 1 < discardCount) {
        // -1 因为当前卡牌会被移除
        console.log(`手牌不足，无法满足弃牌需求: 需要${discardCount}张，当前${player.hand.length - 1}张`);
        this.getAnimationManager().showCardBlockedNotification(card.name, `需要弃掉${discardCount}张牌`);
        this.clearCardInteractionStates();
        return false;
      }

      try {
        // 让卡牌悬停，等待玩家选择弃牌
        this.showCardHoverState(cardId);

        // 执行弃牌选择
        await this.discardCardsForRequirement(discardCount, cardId);

        // 清除悬停状态
        this.clearCardHoverState(cardId);
      } catch (error) {
        // 弃牌选择被取消，清除悬停状态
        this.clearCardHoverState(cardId);
        this.clearCardInteractionStates();
        console.log('弃牌选择被取消，卡牌使用中止');
        return false;
      }
    }

    try {
      // 从手牌中移除
      const updatedHand = player.hand.filter(c => c.id !== cardId);

      // 保存使用前的能量值，供卡牌效果使用
      const energyBeforeCardPlay = player.energy;

      // 消耗能量并先从手牌移除
      const actualEnergyCost = this.calculateActualEnergyCost(card, player);
      this.gameStateManager.updatePlayer({
        energy: player.energy - actualEnergyCost,
        hand: updatedHand,
      });

      // 提前处置已打出的卡牌，使抽牌效果在牌堆为空时可以洗入弃牌堆
      // 注意：这不视为“弃牌”，不会触发弃牌相关能力
      let preDisposed = false;
      if (card.exhaust) {
        this.gameStateManager.moveCardToExhaust(card);
        preDisposed = true;
      } else {
        this.gameStateManager.moveCardToDiscard(card);
        preDisposed = true;
      }

      // 执行卡牌效果（传递使用前的能量值）
      await this.executeCardEffect(card, targetType, energyBeforeCardPlay);

      // 已提前处置则跳过二次处置
      if (!preDisposed) {
        this.handleCardDisposal(card);
      }

      // 触发卡牌使用后的效果
      await this.triggerPostCardPlayEffects(card);

      // 使用卡牌成功 - 移除日志减少输出
      return true;
    } catch (error) {
      console.error('使用卡牌时发生错误:', error);

      // 回滚状态 - 恢复手牌和能量
      this.gameStateManager.updatePlayer({
        energy: player.energy,
        hand: player.hand,
      });

      // 显示错误弹窗
      let errorMessage = '卡牌执行失败';
      if (error instanceof Error) {
        if (error.message.includes('未知效果') || error.message.includes('Unknown effect')) {
          errorMessage = 'AI生成了未知效果，无法执行';
        } else if (error.message.includes('效果解析失败')) {
          errorMessage = '卡牌效果格式错误';
        } else if (error.message.includes('格式无效')) {
          errorMessage = 'AI生成的卡牌格式错误';
        } else if (error.message.length > 50) {
          errorMessage = '卡牌效果执行失败';
        } else {
          errorMessage = error.message;
        }
      }

      this.getAnimationManager().showCardBlockedNotification(card.name, errorMessage);
      return false;
    }
  }

  private canPlayCard(card: Card, player: Player): boolean {
    return this.getCardBlockReason(card, player) === null;
  }

  /**
   * 获取卡牌无法使用的原因
   */
  private getCardBlockReason(card: Card, player: Player): string | null {
    // 诅咒牌不可被打出
    if (card.type === 'Curse') {
      return '诅咒牌无法被打出';
    }

    // 检查眩晕状态（无法行动）
    const executor = UnifiedEffectExecutor.getInstance();
    if (executor.isStunned('player')) {
      return '无法行动';
    }

    // 检查支配状态
    const dominatedEffect = player.statusEffects.find(e => e.id === 'dominated');
    if (dominatedEffect && card.type === 'Attack') {
      return '被支配状态下无法使用攻击牌';
    }

    // 检查其他状态效果限制
    const silencedEffect = player.statusEffects.find(e => e.id === 'silenced');
    if (silencedEffect && card.type === 'Skill') {
      return '被沉默状态下无法使用技能牌';
    }

    // 可以添加更多限制条件
    return null;
  }

  private async executeCardEffect(
    card: Card,
    targetType?: 'player' | 'enemy',
    energyBeforeCardPlay?: number,
  ): Promise<void> {
    try {
      // 诅咒牌不可被打出（双重保护）
      if (card.type === 'Curse') {
        throw new Error('诅咒牌无法被打出');
      }
      // 特殊处理事件卡
      if (card.type === 'Event') {
        await this.handleEventCard(card);
        return;
      }

      // 检查效果格式
      if (!card.effect || typeof card.effect !== 'string') {
        throw new Error('效果解析失败: 卡牌效果格式无效');
      }

      // 使用统一效果执行器执行效果
      const effectExecutor = UnifiedEffectExecutor.getInstance();

      try {
        // 设置执行上下文，包含使用前的能量值
        const context = {
          energyBeforeCardPlay: energyBeforeCardPlay,
          cardContext: card,
        };
        await effectExecutor.executeEffectString(card.effect, true, context);
      } finally {
        // 执行器现在会自动管理上下文，不需要手动清理
      }
    } catch (error) {
      // 重新抛出错误，让上层处理
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error('卡牌效果执行失败');
      }
    }
  }

  private async handleEventCard(card: Card): Promise<void> {
    // 事件卡需要特殊的AI叙事处理
    if (card.effect.includes('narrate:')) {
      const narrateMatch = card.effect.match(/narrate:["']([^"']+)["']/);
      if (narrateMatch) {
        const narrativePrompt = narrateMatch[1];
        await this.generateEventNarrative(narrativePrompt, card);
      }
    }
  }

  private async generateEventNarrative(prompt: string, card: Card): Promise<void> {
    try {
      const fullPrompt = `
作为一个成人向卡牌游戏的叙事AI，请基于以下信息生成一段简短但生动的叙事描述：

**场景背景**: ${prompt}
**卡牌名称**: ${card.name}
**卡牌描述**: ${card.description}

要求：
1. 使用第一人称("我")的视角
2. 描述要简洁但生动，控制在100字以内
3. 符合成人向游戏的氛围，但不要过于露骨
4. 体现玩家的主动选择和行动

请直接输出叙事内容，不要有额外说明：
      `;

      // 开始生成事件叙事 - 移除日志减少输出
      const narrative = await generate({
        user_input: fullPrompt,
        should_stream: false,
      });

      // 叙事生成成功 - 移除日志减少输出
      // 显示叙事内容
      this.showNarrativeToast(narrative);
    } catch (error) {
      console.error('❌ 生成事件叙事失败:', error);
      this.showNarrativeToast('叙事生成失败，请重试');
    }
  }

  private showNarrativeToast(narrative: string): void {
    // 创建自定义的叙事显示
    const narrativeDiv = $(`
      <div class="narrative-toast">
        <div class="narrative-content">${narrative}</div>
      </div>
    `);

    $('.card-game-container').append(narrativeDiv);

    // 动画显示
    narrativeDiv
      .fadeIn(500)
      .delay(4000)
      .fadeOut(500, () => {
        narrativeDiv.remove();
      });
  }

  private handleCardDisposal(card: Card): void {
    if (card.exhaust) {
      // 消耗卡牌
      this.gameStateManager.moveCardToExhaust(card);
    } else if (card.retain) {
      // 保留卡牌，重新加入手牌
      this.gameStateManager.addCardToHand(card);
    } else {
      // 普通卡牌进入弃牌堆
      this.gameStateManager.moveCardToDiscard(card);
    }
  }

  // 弃牌逻辑
  public async discardCard(cardId: string): Promise<void> {
    const card = this.gameStateManager.removeCardFromHand(cardId);
    if (card) {
      // 先移入弃牌堆，再触发弃牌效果（不在弃牌堆不触发）
      this.gameStateManager.moveCardToDiscard(card);

      // 触发弃牌效果（顺序要求：进入弃牌堆后再触发）
      await this.triggerDiscardEffect(card);

      // 触发遗物的弃牌检测
      try {
        await this.relicEffectManager.triggerOnCardDiscarded(card);
      } catch (e) {
        console.warn('触发遗物弃牌检测失败:', e);
      }

      // 记录日志
      const cardName = (card as any).name || '未知卡牌';
      const costText = (card as any).cost === 'energy' ? 'X' : String((card as any).cost ?? 0);
      const desc = (card as any).description || '';
      BattleLog.logDiscardCardDetail(cardName, costText, desc);
    }
  }

  /**
   * 触发弃牌效果
   */
  private async triggerPostCardPlayEffects(card: Card): Promise<void> {
    // 触发 card_played 能力（仅玩家有卡牌概念）
    await this.effectEngine.processAbilitiesByTrigger('player', 'card_played');

    // 触发遗物的 card_played 效果
    await this.relicEffectManager.triggerOnCardPlayed();
  }

  public async discardHand(): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const cardsToDiscard: Card[] = [];

    // 处理空灵卡牌（回合结束时消失）
    const etherealCards = player.hand.filter(card => card.ethereal);
    etherealCards.forEach(card => {
      this.gameStateManager.moveCardToExhaust(card);
    });

    // 处理保留卡牌 - 回合结束的弃牌不触发弃牌效果；诅咒牌不被弃置
    const nonRetainedCards = player.hand.filter(card => !card.retain && !card.ethereal && card.type !== 'Curse');
    for (const card of nonRetainedCards) {
      cardsToDiscard.push(card);
      // 回合结束弃牌不触发弃牌效果（仅通过效果弃牌才触发）
      this.gameStateManager.moveCardToDiscard(card);
      console.log(`🗂️ 回合结束弃置卡牌: ${card.name} (不触发弃牌效果)`);
    }

    // 更新手牌（保留 retain 的卡和诅咒卡）
    const keptCards = player.hand.filter(card => (card.retain || card.type === 'Curse') && !card.ethereal);
    this.gameStateManager.updatePlayer({ hand: keptCards });

    // 弃牌完成 - 移除日志减少输出
  }

  // 添加卡牌
  public addCardToHand(card: Card): void {
    this.gameStateManager.addCardToHand(card);
  }

  public addCardToDiscard(card: Card): void {
    this.gameStateManager.moveCardToDiscard(card);
  }

  public addCardToDeck(card: Card): void {
    const player = this.gameStateManager.getPlayer();
    const updatedDeck = [...player.deck, card];
    this.gameStateManager.updatePlayer({ deck: updatedDeck });
  }

  // 卡牌效果检查
  public getPlayableCards(): Card[] {
    const player = this.gameStateManager.getPlayer();
    return player.hand.filter(card => this.canAffordCard(card, player) && this.canPlayCard(card, player));
  }

  private canAffordCard(card: Card, player: Player): boolean {
    const requiredEnergy = this.calculateCardEnergyCost(card, player);
    return player.energy >= requiredEnergy;
  }

  // 卡牌查询
  public getCardInHand(cardId: string): Card | undefined {
    const player = this.gameStateManager.getPlayer();
    return player.hand.find(c => c.id === cardId);
  }

  public getHandSize(): number {
    const player = this.gameStateManager.getPlayer();
    return player.hand.length;
  }

  public getDeckSize(): number {
    const player = this.gameStateManager.getPlayer();
    return player.drawPile.length;
  }

  public getDiscardSize(): number {
    const player = this.gameStateManager.getPlayer();
    return player.discardPile.length;
  }

  /**
   * 触发弃牌效果
   */
  private async triggerDiscardEffect(card: Card): Promise<void> {
    // 1. 触发卡牌自身的discard_effect（如果有）
    if ((card as any).discard_effect) {
      try {
        // 触发卡牌弃牌效果 - 移除日志减少输出
        await this.effectEngine.executeEffect((card as any).discard_effect, true);
      } catch (error) {
        console.error('卡牌弃牌效果执行失败:', error);
      }
    }

    // 2. 触发on_discard能力效果（通过能力系统处理）
    await this.effectEngine.processAbilitiesByTrigger('player', 'on_discard');

    // 3. 兼容旧的on_discard:语法（逐步废弃）
    if (card.effect && card.effect.includes('on_discard:')) {
      try {
        // 触发旧格式弃牌效果 - 移除日志减少输出
        await this.effectEngine.executeEffect(card.effect, true);
      } catch (error) {
        console.error('旧格式弃牌效果执行失败:', error);
      }
    }
  }

  /**
   * 为满足卡牌需求而弃牌 - 玩家主动选择
   */
  private async discardCardsForRequirement(discardCount: number, excludeCardId: string): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const availableCards = player.hand.filter(card => card.id !== excludeCardId);

    if (availableCards.length < discardCount) {
      throw new Error('手牌不足，无法满足弃牌需求');
    }

    // 让玩家选择要弃掉的卡牌
    const selectedCards = await this.showDiscardSelectionUI(availableCards, discardCount);

    if (selectedCards.length !== discardCount) {
      throw new Error('弃牌选择被取消');
    }

    // 执行弃牌
    for (const card of selectedCards) {
      // 先移入弃牌堆
      this.gameStateManager.moveCardToDiscard(card);

      // 触发弃牌效果
      await this.triggerDiscardEffect(card);
      // 触发遗物的弃牌检测
      try {
        await this.relicEffectManager.triggerOnCardDiscarded(card);
      } catch (e) {
        console.warn('触发遗物弃牌检测失败:', e);
      }

      // 记录日志
      const cardName = (card as any).name || '未知卡牌';
      const costText = (card as any).cost === 'energy' ? 'X' : String((card as any).cost ?? 0);
      const desc = (card as any).description || '';
      BattleLog.logDiscardCardDetail(cardName, costText, desc);
    }

    // 更新手牌
    const updatedHand = player.hand.filter(
      card => card.id === excludeCardId || !selectedCards.some((discarded: Card) => discarded.id === card.id),
    );
    this.gameStateManager.updatePlayer({ hand: updatedHand });

    // 玩家选择弃牌完成 - 移除日志减少输出
  }

  /**
   * 显示弃牌选择UI
   */
  private async showDiscardSelectionUI(availableCards: Card[], discardCount: number): Promise<Card[]> {
    return new Promise((resolve, reject) => {
      const selectedCards: Card[] = [];

      // 创建弃牌选择模态框
      const modal = $(`
        <div class="discard-selection-modal">
          <div class="modal-backdrop"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3>选择要弃掉的卡牌</h3>
              <p>请选择 ${discardCount} 张卡牌弃掉</p>
              <div class="selection-counter">已选择: <span class="selected-count">0</span> / ${discardCount}</div>
            </div>
            <div class="modal-body">
              <div class="discard-cards-container">
                ${availableCards
                  .map(
                    card => `
                  <div class="discard-card" data-card-id="${card.id}">
                    <div class="card-emoji">${card.emoji}</div>
                    <div class="card-name">${card.name}</div>
                    <div class="card-cost">${card.cost}</div>
                  </div>
                `,
                  )
                  .join('')}
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary cancel-discard">取消</button>
              <button class="btn btn-primary confirm-discard" disabled>确认弃牌</button>
            </div>
          </div>
        </div>
      `);

      // 添加到页面
      $('body').append(modal);
      modal.fadeIn(200);

      // 卡牌选择事件
      modal.on('click', '.discard-card', function () {
        const cardId = $(this).data('card-id');
        const card = availableCards.find(c => c.id === cardId);

        if (!card) return;

        if ($(this).hasClass('selected')) {
          // 取消选择
          $(this).removeClass('selected');
          const index = selectedCards.findIndex(c => c.id === cardId);
          if (index > -1) {
            selectedCards.splice(index, 1);
          }
        } else if (selectedCards.length < discardCount) {
          // 选择卡牌
          $(this).addClass('selected');
          selectedCards.push(card);
        }

        // 更新计数器和按钮状态
        modal.find('.selected-count').text(selectedCards.length);
        modal.find('.confirm-discard').prop('disabled', selectedCards.length !== discardCount);
      });

      // 确认按钮
      modal.on('click', '.confirm-discard', () => {
        modal.fadeOut(200, () => modal.remove());
        resolve(selectedCards);
      });

      // 取消按钮
      modal.on('click', '.cancel-discard, .modal-backdrop', () => {
        modal.fadeOut(200, () => modal.remove());
        reject(new Error('弃牌选择被取消'));
      });
    });
  }

  // 回合开始时的卡牌处理
  public onTurnStart(): void {
    // 抽牌
    const player = this.gameStateManager.getPlayer();
    this.drawCards(player.drawPerTurn);

    // 不在这里触发遗物效果，由 battleManager 统一管理
  }

  // 回合结束时的卡牌处理
  public async onTurnEnd(): Promise<void> {
    // 弃掉所有非保留卡牌
    await this.discardHand();

    // 触发回合结束的遗物效果
    await this.relicEffectManager.triggerOnTurnEnd();

    // 回合结束：对仍在手牌中的诅咒牌触发其效果（不移除，留在手牌）
    try {
      const player = this.gameStateManager.getPlayer();
      const cursesInHand = (player.hand || []).filter(
        (c: any) => c.type === 'Curse' && typeof c.effect === 'string' && c.effect.trim().length > 0,
      );
      if (cursesInHand.length > 0) {
        const executor = UnifiedEffectExecutor.getInstance();
        for (const curse of cursesInHand) {
          await executor.executeEffectString(curse.effect, true, { triggerType: 'turn_end', cardContext: curse });
          BattleLog.addLog(`诅咒触发：${curse.name}`, 'action', {
            type: 'card',
            name: curse.name,
            details: curse.description || '',
          });
        }
      }
    } catch (e) {
      console.warn('诅咒牌回合结束触发失败:', e);
    }
  }

  /**
   * 清理卡牌交互状态
   */
  private clearCardInteractionStates(): void {
    // 移除所有卡牌的悬停状态
    $('.card').removeClass('card-hover');
    // 隐藏所有工具提示
    $('.card-tooltip').fadeOut(200, function () {
      $(this).remove();
    });
    // 移除任何选中状态
    $('.card').removeClass('selected');
  }

  /**
   * 显示卡牌悬停状态
   */
  private showCardHoverState(cardId: string): void {
    const cardElement = $(`.card[data-card-id="${cardId}"], .enhanced-card[data-card-id="${cardId}"]`);
    cardElement.addClass('card-pending-discard');

    // 添加视觉提示
    if (!cardElement.find('.pending-indicator').length) {
      cardElement.append('<div class="pending-indicator">等待弃牌选择...</div>');
    }
  }

  /**
   * 清除卡牌悬停状态
   */
  private clearCardHoverState(cardId: string): void {
    const cardElement = $(`.card[data-card-id="${cardId}"], .enhanced-card[data-card-id="${cardId}"]`);
    cardElement.removeClass('card-pending-discard');
    cardElement.find('.pending-indicator').remove();
  }

  /**
   * 被动弃牌处理
   */
  public async discardCardsPassively(
    discardType: 'random' | 'leftmost' | 'rightmost' | 'all',
    count: number = 1,
  ): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const hand = [...player.hand]; // 创建副本避免修改原数组

    if (hand.length === 0) {
      // 手牌为空，无法执行被动弃牌 - 移除日志减少输出
      return;
    }

    let cardsToDiscard: Card[] = [];

    switch (discardType) {
      case 'random':
        // 随机弃牌
        const shuffled = this.fisherYatesShuffle([...hand]);
        cardsToDiscard = shuffled.slice(0, Math.min(count, hand.length));
        break;

      case 'leftmost':
        // 弃掉最左侧的牌
        cardsToDiscard = hand.slice(0, Math.min(count, hand.length));
        break;

      case 'rightmost':
        // 弃掉最右侧的牌
        cardsToDiscard = hand.slice(-Math.min(count, hand.length));
        break;

      case 'all':
        // 弃掉所有牌
        cardsToDiscard = [...hand];
        break;

      default:
        console.error('未知的弃牌类型:', discardType);
        return;
    }

    if (cardsToDiscard.length === 0) {
      // 没有卡牌需要弃掉 - 移除日志减少输出
      return;
    }

    // 执行弃牌
    for (const card of cardsToDiscard) {
      // 先移入弃牌堆
      this.gameStateManager.moveCardToDiscard(card);

      // 触发弃牌效果
      await this.triggerDiscardEffect(card);

      // 被动弃掉卡牌 - 移除日志减少输出
    }

    // 更新手牌
    const updatedHand = hand.filter(card => !cardsToDiscard.some(discarded => discarded.id === card.id));
    this.gameStateManager.updatePlayer({ hand: updatedHand });

    // 显示弃牌通知
    const discardTypeText = {
      random: '随机',
      leftmost: '最左侧',
      rightmost: '最右侧',
      all: '所有',
    }[discardType];

    this.showDiscardNotification(`${discardTypeText}弃牌`, `弃掉了 ${cardsToDiscard.length} 张卡牌`);

    // 被动弃牌完成 - 移除日志减少输出
  }

  /**
   * 显示弃牌通知
   */
  private showDiscardNotification(title: string, message: string): void {
    const notification = $(`
      <div class="discard-notification" style="
        position: fixed;
        top: 30%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 107, 107, 0.95);
        color: white;
        padding: 20px 30px;
        border-radius: 12px;
        border: 2px solid #ff6b6b;
        font-size: 16px;
        font-weight: bold;
        z-index: 10000;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
        text-align: center;
        min-width: 250px;
        opacity: 0;
      ">
        <div style="margin-bottom: 8px; font-size: 18px;">🗑️ ${title}</div>
        <div style="color: #ffe6e6; font-size: 14px;">${message}</div>
      </div>
    `);

    $('body').append(notification);

    // 淡入动画
    notification.animate({ opacity: 1 }, 200);

    // 2秒后自动消失
    setTimeout(() => {
      notification.animate({ opacity: 0 }, 300, function () {
        $(this).remove();
      });
    }, 2000);
  }

  /**
   * 统一的牌选择系统
   * @param selectionType 选择类型
   * @param count 选择数量
   * @param filter 过滤条件（可选）
   * @returns 选中的卡牌数组
   */
  public async selectCards(
    selectionType: 'choose' | 'leftmost' | 'rightmost' | 'all' | 'random',
    count: number = 1,
    filter?: (card: Card) => boolean,
  ): Promise<Card[]> {
    const player = this.gameStateManager.getPlayer();
    let availableCards = [...player.hand];

    // 应用过滤条件
    if (filter) {
      availableCards = availableCards.filter(filter);
    }

    if (availableCards.length === 0) {
      // 没有符合条件的卡牌可选择 - 移除日志减少输出
      return [];
    }

    let selectedCards: Card[] = [];

    switch (selectionType) {
      case 'choose':
        // 玩家主动选择
        selectedCards = await this.showCardSelectionUI(availableCards, count, '选择卡牌');
        break;

      case 'leftmost':
        // 最左侧的牌
        selectedCards = availableCards.slice(0, Math.min(count, availableCards.length));
        break;

      case 'rightmost':
        // 最右侧的牌
        selectedCards = availableCards.slice(-Math.min(count, availableCards.length));
        break;

      case 'all':
        // 所有牌
        selectedCards = [...availableCards];
        break;

      case 'random':
        // 随机选择
        const shuffled = this.fisherYatesShuffle([...availableCards]);
        selectedCards = shuffled.slice(0, Math.min(count, availableCards.length));
        break;

      default:
        console.error('未知的选择类型:', selectionType);
        return [];
    }

    return selectedCards;
  }

  /**
   * 显示卡牌选择UI（通用版本）
   */
  private async showCardSelectionUI(
    availableCards: Card[],
    count: number,
    title: string = '选择卡牌',
    allowCancel: boolean = true,
  ): Promise<Card[]> {
    return new Promise((resolve, reject) => {
      const selectedCards: Card[] = [];

      // 创建选择模态框
      const modal = $(`
        <div class="card-selection-modal">
          <div class="modal-backdrop"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3>${title}</h3>
              <p>请选择 ${count} 张卡牌</p>
              <div class="selection-counter">已选择: <span class="selected-count">0</span> / ${count}</div>
            </div>
            <div class="modal-body">
              <div class="selection-cards-container">
                ${availableCards
                  .map(
                    card => `
                  <div class="selection-card" data-card-id="${card.id}">
                    <div class="card-emoji">${card.emoji}</div>
                    <div class="card-name">${card.name}</div>
                    <div class="card-cost">${card.cost}</div>
                    <div class="card-description">${card.description || ''}</div>
                  </div>
                `,
                  )
                  .join('')}
              </div>
            </div>
            <div class="modal-footer">
              ${allowCancel ? '<button class="btn btn-secondary cancel-selection">取消</button>' : ''}
              <button class="btn btn-primary confirm-selection" disabled>确认选择</button>
            </div>
          </div>
        </div>
      `);

      // 添加到页面
      $('body').append(modal);
      modal.fadeIn(200);

      // 卡牌选择事件
      modal.on('click', '.selection-card', function () {
        const cardId = $(this).data('card-id');
        const card = availableCards.find(c => c.id === cardId);

        if (!card) return;

        if ($(this).hasClass('selected')) {
          // 取消选择
          $(this).removeClass('selected');
          const index = selectedCards.findIndex(c => c.id === cardId);
          if (index > -1) {
            selectedCards.splice(index, 1);
          }
        } else if (selectedCards.length < count) {
          // 选择卡牌
          $(this).addClass('selected');
          selectedCards.push(card);
        }

        // 更新计数器和按钮状态
        modal.find('.selected-count').text(selectedCards.length);
        modal.find('.confirm-selection').prop('disabled', selectedCards.length !== count);
      });

      // 确认按钮
      modal.on('click', '.confirm-selection', () => {
        modal.fadeOut(200, () => modal.remove());
        resolve(selectedCards);
      });

      // 取消按钮
      modal.on('click', '.cancel-selection, .modal-backdrop', () => {
        if (allowCancel) {
          modal.fadeOut(200, () => modal.remove());
          reject(new Error('卡牌选择被取消'));
        }
      });
    });
  }

  // 卡牌效果描述生成
  public generateCardDescription(effect: string): string {
    const effects = effect.split(',');
    const descriptions: string[] = [];

    effects.forEach(eff => {
      const trimmed = eff.trim();

      if (trimmed.startsWith('damage:')) {
        const value = trimmed.split(':')[1];
        descriptions.push(`造成${value}点伤害`);
      } else if (trimmed.startsWith('block:')) {
        const value = trimmed.split(':')[1];
        descriptions.push(`获得${value}点格挡`);
      } else if (trimmed.startsWith('heal:')) {
        const value = trimmed.split(':')[1];
        descriptions.push(`恢复${value}点生命值`);
      } else if (trimmed.startsWith('draw:')) {
        const value = trimmed.split(':')[1];
        descriptions.push(`抽${value}张牌`);
      } else if (trimmed.startsWith('apply_status:')) {
        const parts = trimmed.split(':');
        const statusId = parts[2];
        const value = parts[3];
        descriptions.push(`施加${value}层${this.getStatusName(statusId)}`);
      }
    });

    return descriptions.join('，');
  }

  private getStatusName(statusId: string): string {
    const statusNames: { [key: string]: string } = {
      strength: '力量',
      dexterity: '敏捷',
      poison: '中毒',
      weak: '虚弱',
      vulnerable: '易伤',
      arousal: '兴奋',
      submission: '屈服',
      dominated: '支配',
      resilience: '韧性',
    };

    return statusNames[statusId] || statusId;
  }

  // 卡牌升级系统
  public upgradeCard(card: Card): Card {
    const upgradedCard = { ...card };

    // 基础升级规则：降低费用或增强效果
    if (typeof card.cost === 'number' && card.cost > 0) {
      upgradedCard.cost = Math.max(0, card.cost - 1);
    }

    // 增强效果（这里可以实现更复杂的升级逻辑）
    upgradedCard.effect = this.enhanceEffect(card.effect);
    upgradedCard.name = card.name + '+';

    return upgradedCard;
  }

  private enhanceEffect(effect: string): string {
    // 简单的效果增强：数值+1
    return effect.replace(/(\d+)/g, match => {
      const num = parseInt(match);
      return (num + 1).toString();
    });
  }

  /**
   * Fisher-Yates 洗牌算法（标准洗牌算法，保证均匀随机）
   * 使用增强的随机性确保每次洗牌结果都不同
   */
  private fisherYatesShuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    // 添加时间戳作为额外的随机因子
    const randomSeed = Date.now() * Math.random();

    for (let i = shuffled.length - 1; i > 0; i--) {
      // 使用更好的随机数生成，结合时间戳和位置信息增加随机性
      const randomFactor = (Math.random() + randomSeed / (i + 1)) % 1;
      const j = Math.floor(randomFactor * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  /**
   * 计算卡牌所需的能量消耗（用于检查是否能使用）
   */
  private calculateCardEnergyCost(card: Card, player: Player): number {
    if (card.cost === 'energy') {
      // 动态消耗：允许0能量打出，实际消耗为当前能量
      return 0;
    }
    return card.cost as number;
  }

  /**
   * 计算卡牌实际的能量消耗（用于实际扣除）
   */
  private calculateActualEnergyCost(card: Card, player: Player): number {
    if (card.cost === 'energy') {
      // 动态消耗：消耗所有当前能量（可为0）
      return Math.max(0, player.energy);
    }
    return card.cost as number;
  }
}
