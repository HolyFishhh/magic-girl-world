import {
  advanceCardDrawLifecycle,
  CardEffectRuntime,
  clearCardPatches,
  clearDynamicCardCostAfterPlay,
  playBattleSessionCard,
  prepareCardPlay,
  resolveCardEnergyPayment,
  resolvePlayerTriggerDispatch,
  resolvePlayedCardDestination,
  resolvePlayedCardTriggers,
  resolveStartingHand,
  snapshotDynamicCardCostOnDraw,
  resolveTurnEndHandDisposition,
  runBattleTriggerDispatches,
  runTriggerTransaction,
  selectTurnEndCurseTriggers,
  shuffleCards,
  type CardEffectCommand,
  type CardEffectRuntimeContext,
  type CardEffectRuntimeEvent,
  type AbilityTrigger,
  type CardPileZone,
} from '../../game-core';
import { BattleSessionHost } from '../core/battleSessionHost';
import { TavernCardSelectionHost } from '../core/cardSelectionHost';
import { GameStateManager } from '../core/gameStateManager';
import { TavernRelicTriggerHost } from '../core/relicTriggerHost';
import type { Card, Player } from '../../game-core';
import { TavernCardInteractionPresenter } from '../ui/cardInteractionPresenter';
import { UnifiedEffectExecutor } from './unifiedEffectExecutor';

export class CardSystem {
  private static instance: CardSystem;
  private gameStateManager: GameStateManager;
  private relicTriggerHost: TavernRelicTriggerHost;
  private sessionHost: BattleSessionHost;
  private cardSelectionHost: TavernCardSelectionHost;
  private presentation: TavernCardInteractionPresenter;
  private cardEffectRuntime: CardEffectRuntime;
  private activeDrawLifecycleTriggers = new Set<'on_draw' | 'on_shuffle'>();
  private activeAutoPlayIds = new Set<string>();

  private constructor() {
    this.gameStateManager = GameStateManager.getInstance();
    this.relicTriggerHost = TavernRelicTriggerHost.getInstance();
    this.sessionHost = BattleSessionHost.getInstance();
    this.cardSelectionHost = TavernCardSelectionHost.getInstance();
    this.presentation = TavernCardInteractionPresenter.getInstance();
    this.cardEffectRuntime = new CardEffectRuntime(this.gameStateManager, {
      drawCards: async count => {
        await this.drawCards(count);
      },
      chooseCards: async (candidates, request) => {
        const selected = await this.cardSelectionHost.select(candidates, {
          mode: 'choose',
          minimum: request.minimum,
          maximum: request.maximum,
          allowCancel: request.allowCancel,
          title: this.cardEffectChoiceTitle(request.purpose),
        });
        if (selected.status === 'invalid') throw new Error(`卡牌选择无效: ${selected.code}`);
        return selected.status === 'selected' ? selected.selectedIds : null;
      },
      onCardDiscarded: card => this.notifyCardDiscarded(card),
      onCardExhausted: card => this.triggerCardExhausted(card),
      autoPlayCard: (card, source, free) => this.autoPlayCard(card, source, free),
      present: event => this.presentCardEffectEvent(event),
    });
  }

  public static getInstance(): CardSystem {
    if (!CardSystem.instance) {
      CardSystem.instance = new CardSystem();
    }
    return CardSystem.instance;
  }

  // 抽牌逻辑
  public async drawCards(count: number): Promise<Card[]> {
    const drawn: Card[] = [];
    const target = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    while (drawn.length < target) {
      const step = advanceCardDrawLifecycle(
        {
          hand: this.gameStateManager.getPlayer().hand,
          drawPile: this.gameStateManager.getPlayer().drawPile,
          discardPile: this.gameStateManager.getPlayer().discardPile,
          exhaustPile: this.gameStateManager.getPlayer().exhaustPile,
        },
        cards => shuffleCards(cards, () => this.gameStateManager.nextRandom()),
        10,
      );
      if (step.event.type === 'stopped') break;
      this.gameStateManager.replaceCardZones(step.zones, step.event.type);
      if (step.event.type === 'shuffle') {
        await this.triggerCardDrawLifecycle('on_shuffle', { recycledCards: step.event.recycledCards });
        if (this.gameStateManager.isGameOver()) break;
        continue;
      }
      const costState = UnifiedEffectExecutor.getInstance().getCoreEffectState(true);
      const updated = this.gameStateManager.updateOwnedCards(
        [step.event.card.id],
        card => snapshotDynamicCardCostOnDraw(card, [], { state: costState, effect: { spentEnergy: 0, xValue: 0 } }),
        ['hand'],
      )[0] || step.event.card;
      drawn.push(updated);
      await this.triggerCardDrawLifecycle('on_draw', { card: updated });
      if (this.gameStateManager.isGameOver()) break;
    }
    return drawn;
  }

  public drawStartingHand(): void {
    const player = this.gameStateManager.getPlayer();
    if (player.hand.length > 0) return;
    const opening = resolveStartingHand(
      player.drawPile,
      player.drawPerTurn,
      cards => shuffleCards(cards, () => this.gameStateManager.nextRandom()),
      10,
    );
    this.gameStateManager.updatePlayer({ hand: opening.hand, drawPile: opening.drawPile });
    const state = UnifiedEffectExecutor.getInstance().getCoreEffectState(true);
    this.gameStateManager.updateOwnedCards(
      opening.hand.map(card => card.id),
      card => snapshotDynamicCardCostOnDraw(card, [], { state, effect: { spentEnergy: 0, xValue: 0 } }),
      ['hand'],
    );
    // 抽取起始手牌 - 移除日志减少输出
  }

  // 卡牌使用
  public async playCard(cardId: string, targetType?: 'player' | 'enemy'): Promise<boolean> {
    const cardBeforePlay = this.getCardInHand(cardId);
    let destinationOverride: import('../../game-core').PlayedCardDestination | undefined;
    try {
      const result = await playBattleSessionCard(cardId, {
        gate: this.sessionHost.gate,
        beginTransaction: action => this.sessionHost.beginTransaction(action),
        commitTransaction: token => this.sessionHost.commitTransaction(token),
        rollbackTransaction: token => this.sessionHost.rollbackTransaction(token),
        readCardPlayState: () => {
          const player = this.gameStateManager.getPlayer();
          return this.cardPlayState(player, this.gameStateManager.getEnemy() !== null);
        },
        isTerminal: () => this.gameStateManager.isGameOver(),
        presentCardPlay: async () => {
          await this.presentation.animateCardPlay(cardId, cardBeforePlay);
        },
        applyCardPlayCommit: committed => {
          this.gameStateManager.updatePlayer({ energy: committed.energy, hand: committed.hand });
          this.gameStateManager.setCardPlayCounters(committed);
        },
        beginCardTransit: card => this.gameStateManager.beginCardTransit(card),
        endCardTransit: card => this.gameStateManager.endCardTransit(card),
        executeCardEffect: (card, payment) => this.executeCardEffect(
          card,
          targetType,
          payment,
          destination => { destinationOverride = destination; },
        ),
        recordCardPlayEvent: (card, _payment, event) => {
          const state = this.gameStateManager.getGameState();
          this.gameStateManager.recordBattleEvent({
            turn: state.currentTurn,
            phase: event.phase,
            kind: 'card_played',
            cause: {
              source: { kind: 'card', id: card.templateId || card.originalId || card.id, name: card.name },
              reason: event.automatic ? 'auto_play' : 'player_choice',
            },
            actorId: 'player',
            cardInstanceId: card.combatInstanceId || card.id,
            templateId: card.templateId || card.originalId || card.id,
            cardType: card.type,
            automatic: event.automatic,
            replayIndex: event.replayIndex,
          });
        },
        recordCardResourceSpent: (card, payment) => {
          if (payment.spentEnergy <= 0) return;
          const state = this.gameStateManager.getGameState();
          this.gameStateManager.recordBattleEvent({
            turn: state.currentTurn,
            phase: 'after',
            kind: 'resource_spent',
            cause: { source: { kind: 'card', id: card.templateId || card.originalId || card.id, name: card.name } },
            actorId: 'player',
            resource: 'energy',
            requested: payment.requiredEnergy,
            spent: payment.spentEnergy,
          });
        },
        movePlayedCard: async (card, destination) => {
          if (destination === 'exhaust') await this.exhaustCard(card);
          else this.gameStateManager.placeResolvedCard(card, destination);
        },
        resolvePlayedCardDestination: (_card, defaultDestination) => destinationOverride || defaultDestination,
        recordPlayedCardMoved: (card, destination) => {
          const state = this.gameStateManager.getGameState();
          this.gameStateManager.recordBattleEvent({
            turn: state.currentTurn,
            phase: 'after',
            kind: 'card_moved',
            cause: { source: { kind: 'card', id: card.templateId || card.originalId || card.id, name: card.name }, reason: destination === 'exhaust' ? 'exhaust' : 'player_choice' },
            actorId: 'player',
            cardInstanceId: card.combatInstanceId || card.id,
            templateId: card.templateId || card.originalId || card.id,
            cardType: card.type,
            from: 'hand',
            to: ({
              discard: 'discardPile',
              exhaust: 'exhaustPile',
              draw_top: 'drawPile',
              draw_bottom: 'drawPile',
              hand: 'hand',
              remove: 'removed',
            } as const)[destination],
            moveReason: destination === 'exhaust' ? 'exhaust' : 'player_choice',
          });
        },
        triggerPostCardPlay: card => this.triggerPostCardPlayEffects(card),
      });

      if (result.status === 'completed') return true;
      if (result.status === 'rejected') {
        const reason = this.cardPlayFailureReason(result.failure.code);
        if (cardBeforePlay && reason) {
          this.presentation.showCardBlockedNotification(cardBeforePlay.name, reason);
        }
      }
      this.presentation.clearCardInteractionStates();
      return false;
    } catch (error) {
      console.error('使用卡牌时发生错误:', error);
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
      this.presentation.showCardBlockedNotification(cardBeforePlay?.name || '卡牌', errorMessage);
      return false;
    }
  }

  private cardPlayFailureReason(code: string): string | null {
    if (code === 'INSUFFICIENT_ENERGY') return '能量不足';
    if (code === 'CURSE_UNPLAYABLE') return '诅咒牌无法被打出';
    if (code === 'STUNNED') return '无法行动';
    if (code === 'DOMINATED_ATTACK') return '被支配状态下无法使用攻击牌';
    if (code === 'SILENCED_SKILL') return '被沉默状态下无法使用技能牌';
    return null;
  }

  private cardPlayState(player: Player, hasOpponent: boolean) {
    return {
      phase: this.gameStateManager.getCurrentPhase(),
      hasOpponent,
      hand: player.hand,
      energy: player.energy,
      cardsPlayedThisTurn: this.gameStateManager.getGameState().cardsPlayedThisTurn,
      cardRuleUsesThisTurn: this.gameStateManager.getGameState().cardRuleUsesThisTurn,
      attacksPlayedThisTurn: this.gameStateManager.getGameState().attacksPlayedThisTurn,
      skillsPlayedThisTurn: this.gameStateManager.getGameState().skillsPlayedThisTurn,
      stunned: UnifiedEffectExecutor.getInstance().isStunned('player'),
      statusIds: player.statusEffects.map(status => status.id),
      cardPlayRules: UnifiedEffectExecutor.getInstance().getCardPlayRules('player'),
      dynamicCostRules: [],
      dynamicCostState: UnifiedEffectExecutor.getInstance().getCoreEffectState(true),
      dynamicCostContext: { spentEnergy: 0, xValue: 0 },
    };
  }

  private async executeCardEffect(
    card: Card,
    targetType?: 'player' | 'enemy',
    energyPayment?: ReturnType<typeof resolveCardEnergyPayment>,
    setCardDestination?: (destination: import('../../game-core').PlayedCardDestination) => void,
  ): Promise<void> {
    try {
      // 诅咒牌不可被打出（双重保护）
      if (card.type === 'Curse') {
        throw new Error('诅咒牌无法被打出');
      }
      // 特殊处理事件卡
      if (card.type === 'Event') {
        await this.handleEventCard(card, energyPayment);
        return;
      }

      // 检查效果格式
      if (!card.effectProgram) {
        throw new Error('效果解析失败: 卡牌效果格式无效');
      }

      // 使用统一效果执行器执行效果
      const effectExecutor = UnifiedEffectExecutor.getInstance();

      try {
        // 设置执行上下文，包含使用前的能量值
        const context = {
          spentEnergy: energyPayment?.spentEnergy ?? 0,
          xValue: energyPayment?.xValue ?? energyPayment?.spentEnergy ?? 0,
          cardContext: card,
          setCardDestination,
        };
        await effectExecutor.executeEffectProgram(card.effectProgram, true, context);
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

  private async handleEventCard(
    card: Card,
    energyPayment?: ReturnType<typeof resolveCardEnergyPayment>,
  ): Promise<void> {
    if (!card.effectProgram) {
      throw new Error('事件卡效果格式无效');
    }
    const context = {
      cardContext: card,
      isEventCard: true,
      spentEnergy: energyPayment?.spentEnergy ?? 0,
      xValue: energyPayment?.xValue ?? energyPayment?.spentEnergy ?? 0,
    };
    const executor = UnifiedEffectExecutor.getInstance();
    await executor.executeEffectProgram(card.effectProgram, true, context);
  }

  /** Resolve a selected card from any zone through the same effect, Replay, move, trigger and journal path. */
  private async autoPlayCard(card: Card, source: CardPileZone, free: boolean): Promise<boolean> {
    if (this.gameStateManager.isGameOver() || this.activeAutoPlayIds.has(card.id)) return false;
    const player = this.gameStateManager.getPlayer();
    const payment = free
      ? {
          requiredEnergy: 0,
          spentEnergy: 0,
          xValue: card.cost === 'energy' ? Math.max(0, Math.floor(card.xValueBonus || 0)) : 0,
        }
      : resolveCardEnergyPayment(card, player.energy);
    if (player.energy < payment.requiredEnergy) return false;
    const detached = this.gameStateManager.removeOwnedCardFromZone(card.id, source);
    if (!detached) return false;

    this.activeAutoPlayIds.add(card.id);
    this.gameStateManager.beginCardTransit(detached);
    try {
      await this.presentation.animateTriggeredCard(detached);
      const state = this.gameStateManager.getGameState();
      this.gameStateManager.updatePlayer({ energy: player.energy - payment.spentEnergy });
      this.gameStateManager.setCardPlayCounters({
        cardsPlayedThisTurn: state.cardsPlayedThisTurn + 1,
        attacksPlayedThisTurn: state.attacksPlayedThisTurn + (detached.type === 'Attack' ? 1 : 0),
        skillsPlayedThisTurn: state.skillsPlayedThisTurn + (detached.type === 'Skill' ? 1 : 0),
        cardRuleUsesThisTurn: state.cardRuleUsesThisTurn ?? state.cardsPlayedThisTurn,
      });
      if (payment.spentEnergy > 0) {
        this.gameStateManager.recordBattleEvent({
          turn: state.currentTurn,
          phase: 'after',
          kind: 'resource_spent',
          cause: { source: { kind: 'card', id: detached.templateId || detached.originalId || detached.id, name: detached.name }, reason: 'auto_play' },
          actorId: 'player',
          resource: 'energy',
          requested: payment.requiredEnergy,
          spent: payment.spentEnergy,
        });
      }

      const repeatCount = 1 + Math.min(20, Math.max(0, Math.trunc(detached.replayCount ?? (detached.doubleEffect ? 1 : 0))));
      let destinationOverride: import('../../game-core').PlayedCardDestination | undefined;
      for (let replayIndex = 0; replayIndex < repeatCount; replayIndex += 1) {
        if (this.gameStateManager.isGameOver()) break;
        for (const phase of ['before', 'after'] as const) {
          if (phase === 'after') await this.executeCardEffect(
            detached,
            undefined,
            payment,
            destination => { destinationOverride = destination; },
          );
          const current = this.gameStateManager.getGameState();
          this.gameStateManager.recordBattleEvent({
            turn: current.currentTurn,
            phase,
            kind: 'card_played',
            cause: { source: { kind: 'card', id: detached.templateId || detached.originalId || detached.id, name: detached.name }, reason: 'auto_play' },
            actorId: 'player',
            cardInstanceId: detached.combatInstanceId || detached.id,
            templateId: detached.templateId || detached.originalId || detached.id,
            cardType: detached.type,
            automatic: true,
            replayIndex,
          });
        }
      }

      const played = clearDynamicCardCostAfterPlay(clearCardPatches(detached, 'played'));
      const destination = destinationOverride || resolvePlayedCardDestination(played);
      if (destination === 'exhaust') await this.exhaustCard(played);
      else this.gameStateManager.placeResolvedCard(played, destination);
      const after = this.gameStateManager.getGameState();
      this.gameStateManager.recordBattleEvent({
        turn: after.currentTurn,
        phase: 'after',
        kind: 'card_moved',
        cause: { source: { kind: 'card', id: played.templateId || played.originalId || played.id, name: played.name }, reason: 'auto_play' },
        actorId: 'player',
        cardInstanceId: played.combatInstanceId || played.id,
        templateId: played.templateId || played.originalId || played.id,
        cardType: played.type,
        from: source,
        to: ({
          discard: 'discardPile',
          exhaust: 'exhaustPile',
          draw_top: 'drawPile',
          draw_bottom: 'drawPile',
          hand: 'hand',
          remove: 'removed',
        } as const)[destination],
        moveReason: 'auto_play',
      });
      if (!this.gameStateManager.isGameOver()) await this.triggerPostCardPlayEffects(played);
      return true;
    } finally {
      this.gameStateManager.endCardTransit(detached);
      this.activeAutoPlayIds.delete(card.id);
    }
  }

  // 弃牌逻辑
  public async discardCard(cardId: string): Promise<boolean> {
    const card = this.gameStateManager.removeCardFromHand(cardId);
    if (card) {
      // 先移入弃牌堆，再触发弃牌效果（不在弃牌堆不触发）
      this.gameStateManager.moveCardToDiscard(card);
      await this.notifyCardDiscarded(card);
      return true;
    }
    return false;
  }

  private async notifyCardDiscarded(card: Card): Promise<void> {
    await this.triggerDiscardEffect(card);
    try {
      await this.relicTriggerHost.triggerRelics('on_discard', { card });
    } catch (error) {
      console.warn('触发遗物弃牌检测失败:', error);
    }

    const cardName = card.name || '未知卡牌';
    const costText = card.cost === 'energy' ? 'X' : String(card.cost ?? 0);
    this.presentation.logDiscardCardDetail(cardName, costText, card.description || '');
  }

  /**
   * 触发弃牌效果
   */
  private async triggerPostCardPlayEffects(card: Card): Promise<void> {
    // Generic card-play effects resolve first; type-specific effects reuse the same guarded trigger path.
    for (const trigger of resolvePlayedCardTriggers(card.type)) {
      await this.dispatchPlayerTrigger(trigger, { card });
      if (this.gameStateManager.isGameOver()) break;
    }
  }

  public async discardHand(): Promise<void> {
    const player = this.gameStateManager.getPlayer();
    const disposition = resolveTurnEndHandDisposition(player.hand);

    // 先移除本回合手牌，再触发消耗通知，防止触发器读取或覆盖旧手牌快照。
    this.gameStateManager.updatePlayer({ hand: disposition.keep });
    for (const card of disposition.exhaust) await this.exhaustCard(card);

    // 回合结束的系统弃牌不触发卡牌弃牌程序、能力或遗物弃牌触发器。
    for (const card of disposition.discard) {
      // 回合结束弃牌不触发弃牌效果（仅通过效果弃牌才触发）
      this.gameStateManager.moveCardToDiscard(card);
    }

    // 弃牌完成 - 移除日志减少输出
  }

  /** A detached played/ethereal card enters the exhaust pile, then emits one shared notification. */
  public async exhaustCard(card: Card): Promise<void> {
    this.gameStateManager.moveCardToExhaust(card);
    await this.triggerCardExhausted(card);
  }

  public async executeCardEffectCommand(
    command: CardEffectCommand,
    context: CardEffectRuntimeContext = {},
  ): Promise<readonly Card[]> {
    return this.cardEffectRuntime.execute(command, context);
  }

  private cardEffectChoiceTitle(purpose: string): string {
    const titles: Record<string, string> = {
      modify_value: '选择要调整数值的卡牌',
      discard: '选择要弃置的卡牌',
      exhaust: '选择要消耗的卡牌',
      recover: '选择要取回的卡牌',
      seek: '选择要检索的卡牌',
      scry: '选择要置入弃牌堆的牌',
      reduce_cost: '选择要减费的卡牌',
      copy: '选择要复制的卡牌',
      double_effect: '选择要强化的卡牌',
      auto_play: '选择要自动打出的卡牌',
      move: '选择要移动的卡牌',
      remove: '选择要移除的卡牌',
      transform: '选择要变形的卡牌',
    };
    return titles[purpose] || '选择要操作的卡牌';
  }

  private presentCardEffectEvent(event: CardEffectRuntimeEvent): void {
    if (event.type === 'card_added') {
      this.presentation.addLog(
        event.zone === 'hand' ? `获得卡牌：${event.card.name}` : `获得卡牌: ${event.card.name} (加入抽牌堆)`,
        'info',
        event.zone === 'hand'
          ? { type: 'card', name: event.card.name, details: event.card.description || '' }
          : undefined,
      );
      return;
    }
    if (event.type === 'card_cost_reduced') {
      this.presentation.addLog(
        `减少费用：${event.card.name} ${event.previousCost} → ${event.nextCost}`,
        'info',
        { type: 'card', name: event.card.name },
      );
      return;
    }
    if (event.type === 'card_value_modified') {
      const statNames = { damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const;
      const operatorNames = { add: '+', subtract: '-', multiply: '×', divide: '÷' } as const;
      this.presentation.addLog(
        `调整卡牌：${event.card.name} ${statNames[event.stat]} ${operatorNames[event.operator]} ${event.value}`,
        'info',
        { type: 'card', name: event.card.name },
      );
      return;
    }
    if (event.type === 'card_recovered') {
      this.presentation.addLog(`${event.source === 'draw' ? '检索' : '取回'}卡牌：${event.card.name}`, 'action', {
        type: 'card',
        name: event.card.name,
      });
      return;
    }
    if (event.type === 'card_moved') {
      const zones = { hand: '手牌', drawPile: '抽牌堆', discardPile: '弃牌堆', exhaustPile: '消耗堆' } as const;
      this.presentation.addLog(`移动卡牌：${event.card.name} → ${zones[event.destination]}`, 'action', {
        type: 'card', name: event.card.name,
      });
      return;
    }
    if (event.type === 'card_removed') {
      this.presentation.addLog(`移除卡牌：${event.card.name}`, 'action', { type: 'card', name: event.card.name });
      return;
    }
    if (event.type === 'card_transformed') {
      this.presentation.addLog(`卡牌变形：${event.previous.name} → ${event.card.name}`, 'action', {
        type: 'card', name: event.card.name,
      });
      return;
    }
    this.presentation.addLog(`预见弃置：${event.card.name}`, 'action', {
      type: 'card',
      name: event.card.name,
    });
  }

  private async triggerCardExhausted(card: Card): Promise<void> {
    await this.dispatchPlayerTrigger('on_exhaust', { card });
  }

  // 卡牌效果检查
  public getPlayableCards(): Card[] {
    const player = this.gameStateManager.getPlayer();
    const state = this.cardPlayState(player, this.gameStateManager.getEnemy() !== null);
    return player.hand.filter(card => prepareCardPlay(card.id, state).ok);
  }

  // 卡牌查询
  public getCardInHand(cardId: string): Card | undefined {
    const player = this.gameStateManager.getPlayer();
    return player.hand.find(c => c.id === cardId);
  }

  /**
   * 触发弃牌效果
   */
  private async triggerDiscardEffect(card: Card): Promise<void> {
    const result = await runTriggerTransaction(
      'card_discard',
      this.sessionHost.triggerTransactionPorts(),
      async () => {
        // 1. 触发卡牌自身的弃牌程序（如果有）
        if (card.discardEffectProgram) {
          await UnifiedEffectExecutor.getInstance().executeEffectProgram(card.discardEffectProgram, true, {
            triggerType: 'on_discard',
            cardContext: card,
          });
        }

        // 2. 触发on_discard能力效果（通过能力系统处理）
        await UnifiedEffectExecutor.getInstance().processAbilitiesByTrigger('player', 'on_discard');

      },
      'recover-and-continue',
    );

    if (result.status === 'rolled_back') {
      console.error(`卡牌 ${card.name} 的弃牌触发失败，已回滚附带效果:`, result.cause);
      this.presentation.addLog(`${card.name}的弃牌触发失败，附带效果已回滚。`, 'system');
    }
  }

  /**
   * 显示弃牌选择UI
   */

  // 回合开始时的卡牌处理
  public async onTurnStart(): Promise<void> {
    // 抽牌
    const player = this.gameStateManager.getPlayer();
    await this.drawCards(player.drawPerTurn);

    // 不在这里触发遗物效果，由 battleManager 统一管理
  }

  private async triggerCardDrawLifecycle(
    trigger: 'on_draw' | 'on_shuffle',
    context: Record<string, unknown>,
  ): Promise<void> {
    if (this.activeDrawLifecycleTriggers.has(trigger)) {
      console.warn(`跳过递归卡牌生命周期触发: ${trigger}`);
      return;
    }
    this.activeDrawLifecycleTriggers.add(trigger);
    try {
      await this.dispatchPlayerTrigger(trigger, context);
    } finally {
      this.activeDrawLifecycleTriggers.delete(trigger);
    }
  }

  private async dispatchPlayerTrigger(
    trigger: AbilityTrigger,
    context: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await runBattleTriggerDispatches(resolvePlayerTriggerDispatch(trigger, context), {
      runAbility: (target, resolvedTrigger) =>
        UnifiedEffectExecutor.getInstance().processAbilitiesByTrigger(target, resolvedTrigger),
      runRelic: (resolvedTrigger, resolvedContext) =>
        this.relicTriggerHost.triggerRelics(resolvedTrigger, { ...resolvedContext }),
    });
  }

  // 回合结束时的卡牌处理
  public async onTurnEnd(): Promise<void> {
    // 冻结回合结束开始时的诅咒列表。即使空灵牌稍后进入消耗堆，也必须先触发一次。
    const player = this.gameStateManager.getPlayer();
    const cursesInHand = selectTurnEndCurseTriggers(player.hand || []);
    for (const curse of cursesInHand) {
      await this.executeCurseTurnEndTransaction(curse);
      if (this.gameStateManager.isGameOver()) return;
    }

    // 诅咒可能改变手牌，因此基于当前手牌重新计算空灵、保留和系统弃牌。
    await this.discardHand();
    if (this.gameStateManager.isGameOver()) return;
    this.gameStateManager.clearOwnedCardPatches('turn_end');
  }

  private async executeCurseTurnEndTransaction(curse: Card): Promise<void> {
    const result = await runTriggerTransaction(
      'curse_turn_end',
      this.sessionHost.triggerTransactionPorts(),
      async () => {
        await this.presentation.animateTriggeredCard(curse);
        const executor = UnifiedEffectExecutor.getInstance();
        const context = { triggerType: 'turn_end', cardContext: curse };
        await executor.executeEffectProgram(curse.effectProgram, true, context);
        this.presentation.addLog(`诅咒触发：${curse.name}`, 'action', {
          type: 'card',
          name: curse.name,
          details: curse.description || '',
        });
      },
      'recover-and-continue',
    );

    if (result.status === 'rolled_back') {
      console.error(`诅咒 ${curse.name} 触发失败，已回滚:`, result.cause);
      this.presentation.addLog(`${curse.name}触发失败，战斗状态已回滚。`, 'system');
    }
  }

}
