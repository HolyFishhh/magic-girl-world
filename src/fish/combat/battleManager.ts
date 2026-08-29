import {
  advanceBattleSessionTurn,
  createEffectSchedulerState,
  createBattleRandomState,
  prepareEnemyActionQueue,
  rollDefaultEnemyAttackDamage,
  runScheduledPhaseAtomically,
  scheduledCardZoneCommand,
  runEnemyActionQueue,
  resolveEnemyTurnAction,
  resolveActiveCardPlayRules,
  refreshCombatResourceStates,
  type BattleTurnFlowStep,
  type EnemyActionQueueEntry,
  type EffectProgram,
  type ScheduledEffect,
} from '../../game-core';
import { GameStateManager } from '../core/gameStateManager';
import { prepareNextEnemyAction } from '../core/enemyActionHost';
import { BattleSessionHost } from '../core/battleSessionHost';
import { TavernRelicTriggerHost } from '../core/relicTriggerHost';
import type { Enemy } from '../../game-core';
import { EnemyIntentPresenter } from '../ui/enemyIntentPresenter';
import { CardSystem } from './cardSystem';
import { UnifiedEffectExecutor } from './unifiedEffectExecutor';

export class BattleManager {
  private static instance: BattleManager;
  private gameStateManager: GameStateManager;
  private cardSystem: CardSystem;
  private enemyIntentPresenter: EnemyIntentPresenter;
  private relicTriggerHost: TavernRelicTriggerHost;
  private sessionHost: BattleSessionHost;

  private constructor() {
    this.gameStateManager = GameStateManager.getInstance();
    this.cardSystem = CardSystem.getInstance();
    this.enemyIntentPresenter = EnemyIntentPresenter.getInstance();
    this.relicTriggerHost = TavernRelicTriggerHost.getInstance();
    this.sessionHost = BattleSessionHost.getInstance();
  }

  public static getInstance(): BattleManager {
    if (!BattleManager.instance) {
      BattleManager.instance = new BattleManager();
    }
    return BattleManager.instance;
  }

  // 战斗初始化
  public async initializeBattle(enemy: Enemy | readonly Enemy[]): Promise<void> {
    // 设置敌人
    const enemies = (Array.isArray(enemy) ? [...enemy] : [enemy as Enemy]).map(entry => ({
      ...entry,
      energy: entry.maxEnergy,
      resources: refreshCombatResourceStates(entry.resources),
    }));
    if (enemies.length === 0) throw new Error('battle requires at least one enemy');
    this.gameStateManager.setEnemies(enemies, enemies[0].id);

    // 重置玩家状态
    const player = this.gameStateManager.getPlayer();
    this.gameStateManager.updatePlayer({
      energy: player.maxEnergy,
      resources: refreshCombatResourceStates(player.resources),
    });
    // 初始化回合号
    this.gameStateManager.setCurrentTurn(0 as any);

    // 抽起始手牌
    this.cardSystem.drawStartingHand();

    // 设置敌人首次行动（第一回合敌人不执行，只生成意图）
    this.setEnemyNextActions();

    // 战斗开始时的效果现在由主初始化流程统一管理
    // 这里不再重复触发

    // 开始玩家回合
    this.gameStateManager.setPhase('player_turn');
  }

  // 玩家回合结束；顺序由可移植核心统一拥有，当前类只消费宿主步骤。
  public async endPlayerTurn(): Promise<void> {
    try {
      await advanceBattleSessionTurn({
        gate: this.sessionHost.gate,
        beginTransaction: action => this.sessionHost.beginTransaction(action),
        commitTransaction: token => this.sessionHost.commitTransaction(token),
        rollbackTransaction: token => this.sessionHost.rollbackTransaction(token),
        canEndTurn: () => this.canPlayerAct(),
        isTerminal: () => this.gameStateManager.isGameOver(),
        beginEnemyTurn: () => this.gameStateManager.beginEnemyTurn(),
        consumeExtraTurn: actor => this.gameStateManager.consumeExtraTurn(actor),
        executeTurnStep: step => this.executeTurnFlowStep(step),
      });
    } catch (error) {
      console.error('结束回合流程失败，已回滚到玩家回合:', error);
      this.enemyIntentPresenter.addLog('结束回合流程失败，战斗状态已回滚。', 'system');
    }
  }

  private async executeTurnFlowStep(step: BattleTurnFlowStep): Promise<void> {
    switch (step) {
      case 'player_cards_end':
        await this.cardSystem.onTurnEnd();
        return;
      case 'player_relics_end':
        await this.relicTriggerHost.triggerRelics('turn_end');
        return;
      case 'player_abilities_end':
        await UnifiedEffectExecutor.getInstance().processAbilitiesByTrigger('player', 'turn_end');
        return;
      case 'player_summons_action':
        await UnifiedEffectExecutor.getInstance().processSummonActions('player');
        return;
      case 'player_orbs_end':
        await UnifiedEffectExecutor.getInstance().processOrbPassives('player');
        return;
      case 'player_statuses_end':
        await UnifiedEffectExecutor.getInstance().processStatusEffectsAtTurnEnd('player');
        await UnifiedEffectExecutor.getInstance().processSummonStatusEffectsAtTurnEnd('player');
        return;
      case 'player_threshold_execute':
        await UnifiedEffectExecutor.getInstance().processThresholdExecutes('player');
        return;
      case 'scheduled_turn_end':
        await this.executeScheduledPhase('turn_end');
        return;
      case 'advance_turn':
        this.gameStateManager.incrementTurn();
        return;
      case 'enemy_block_reset': {
        const previousActive = this.gameStateManager.getGameState().activeEnemyId;
        for (const enemy of this.gameStateManager.getEnemies({ livingOnly: true })) {
          this.gameStateManager.setActiveEnemy(enemy.id);
          const rules = resolveActiveCardPlayRules(
            UnifiedEffectExecutor.getInstance().getCardPlayRules('enemy'),
            this.gameStateManager.getGameState().cardRuleUsesThisTurn || 0,
          );
          if (!rules.retainBlock)
            this.gameStateManager.updateEnemyById(enemy.id, { block: 0 }, { skipAttributeTriggers: true });
        }
        if (previousActive) this.gameStateManager.setActiveEnemy(previousActive);
        return;
      }
      case 'enemy_resources_reset':
        for (const enemy of this.gameStateManager.getEnemies({ livingOnly: true })) {
          this.gameStateManager.updateEnemyById(enemy.id, {
            energy: enemy.maxEnergy,
            resources: refreshCombatResourceStates(enemy.resources),
          });
        }
        return;
      case 'enemy_summons_reset':
        this.gameStateManager.resetSummonsForTurn('enemy');
        return;
      case 'enemy_abilities_start':
        await this.forEachLivingEnemy(() => UnifiedEffectExecutor.getInstance().processAbilitiesByTrigger('enemy', 'turn_start'));
        return;
      case 'enemy_action':
        await this.executeEnemyTurnAction();
        return;
      case 'enemy_summons_action':
        await UnifiedEffectExecutor.getInstance().processSummonActions('enemy');
        return;
      case 'enemy_next_intent':
        this.setEnemyNextActions();
        return;
      case 'enemy_abilities_end':
        await this.forEachLivingEnemy(() => UnifiedEffectExecutor.getInstance().processAbilitiesByTrigger('enemy', 'turn_end'));
        return;
      case 'enemy_orbs_end':
        await this.forEachLivingEnemy(() => UnifiedEffectExecutor.getInstance().processOrbPassives('enemy'));
        return;
      case 'enemy_statuses_end':
        await this.forEachLivingEnemy(() => UnifiedEffectExecutor.getInstance().processStatusEffectsAtTurnEnd('enemy'));
        await UnifiedEffectExecutor.getInstance().processSummonStatusEffectsAtTurnEnd('enemy');
        return;
      case 'enemy_threshold_execute':
        await UnifiedEffectExecutor.getInstance().processThresholdExecutes('enemy');
        return;
      case 'temporary_modifiers_clear':
        this.gameStateManager.clearTemporaryModifiers();
        return;
      case 'player_begin':
        this.gameStateManager.beginPlayerTurn();
        return;
      case 'player_summons_reset':
        this.gameStateManager.resetSummonsForTurn('player');
        return;
      case 'scheduled_turn_start':
        await this.executeScheduledPhase('turn_start');
        return;
      case 'player_block_reset':
        if (!resolveActiveCardPlayRules(
          UnifiedEffectExecutor.getInstance().getCardPlayRules('player'),
          this.gameStateManager.getGameState().cardRuleUsesThisTurn || 0,
        ).retainBlock) {
          this.gameStateManager.updatePlayer({ block: 0 }, { skipAttributeTriggers: true });
        }
        return;
      case 'player_energy_reset': {
        const player = this.gameStateManager.getPlayer();
        this.gameStateManager.updatePlayer({
          energy: player.maxEnergy,
          resources: refreshCombatResourceStates(player.resources),
        });
        return;
      }
      case 'scheduled_before_draw':
        await this.executeScheduledPhase('before_draw');
        return;
      case 'player_draw':
        await this.cardSystem.onTurnStart();
        return;
      case 'scheduled_after_draw':
        await this.executeScheduledPhase('after_draw');
        return;
      case 'player_abilities_start':
        await UnifiedEffectExecutor.getInstance().processAbilitiesByTrigger('player', 'turn_start');
        return;
      case 'player_relics_start':
        await this.relicTriggerHost.triggerRelics('turn_start');
        return;
      default: {
        const exhaustive: never = step;
        throw new Error(`未知回合步骤: ${String(exhaustive)}`);
      }
    }
  }

  private async executeScheduledPhase(
    phase: 'turn_start' | 'before_draw' | 'after_draw' | 'turn_end',
  ): Promise<void> {
    const stateBefore = structuredClone(this.gameStateManager.getGameState());
    const before = this.gameStateManager.readEffectScheduler();
    const turn = this.gameStateManager.getGameState().currentTurn;
    const originalIds = new Set(before.queue.map(item => item.id));
    try {
      const result = await runScheduledPhaseAtomically(
        before,
        turn,
        phase,
        null,
        async (value, scheduled) => {
          await this.executeScheduledPayload(scheduled);
          return value;
        },
        { isTerminal: () => this.gameStateManager.isGameOver() },
      );
      const afterPayloads = this.gameStateManager.readEffectScheduler();
      const newlyScheduled = afterPayloads.queue.filter(item => !originalIds.has(item.id));
      const merged = createEffectSchedulerState([...result.state.queue, ...newlyScheduled]);
      merged.nextSequence = Math.max(merged.nextSequence, result.state.nextSequence, afterPayloads.nextSequence);
      this.gameStateManager.writeEffectScheduler(merged);
    } catch (error) {
      this.gameStateManager.replaceState(stateBefore, 'scheduled_phase_rollback');
      throw error;
    }
  }

  private async executeScheduledPayload(scheduled: ScheduledEffect): Promise<void> {
    const context = {
      triggerType: 'scheduled',
      abilityContext: { id: scheduled.source.id, name: scheduled.source.name || '预约效果' },
    };
    if (scheduled.payload.type === 'effect_program') {
      await UnifiedEffectExecutor.getInstance().executeEffectProgram(
        scheduled.payload.program,
        scheduled.payload.sourceIsPlayer,
        context,
      );
      return;
    }
    if (scheduled.payload.type === 'remove_status') {
      const owner = scheduled.payload.owner;
      if (owner === 'enemy' && !this.gameStateManager.getEnemy()) return;
      await UnifiedEffectExecutor.getInstance().executeEffectProgram(
        {
          spec: 'mwg.effect/v1',
          steps: [{ op: 'remove_status', target: 'self', status: scheduled.payload.statusId }],
        },
        owner === 'player',
        context,
      );
      return;
    }
    if (scheduled.payload.type === 'defeat_entity') {
      const entityId = scheduled.payload.entityId;
      if (entityId === 'player') {
        if (this.gameStateManager.getPlayer().currentHp <= 0) return;
        await UnifiedEffectExecutor.getInstance().executeEffectProgram(
          { spec: 'mwg.effect/v1', steps: [{ op: 'kill', target: 'self' }] },
          true,
          context,
        );
        return;
      }
      const enemy = this.gameStateManager.getEnemyById(entityId);
      if (!enemy || enemy.currentHp <= 0) return;
      await UnifiedEffectExecutor.getInstance().executeEffectProgram(
        {
          spec: 'mwg.effect/v1',
          steps: [{ op: 'kill', target: 'opponent', targetSelector: { mode: 'by_id', id: entityId } }],
        },
        true,
        context,
      );
      return;
    }
    const command = scheduledCardZoneCommand(scheduled.payload);
    if (!command) throw new Error(`unsupported scheduled payload: ${scheduled.payload.type}`);
    const sourceKinds = new Set([
      'card', 'relic', 'status', 'ability', 'system', 'enemy_action', 'summon', 'enchantment', 'affliction',
    ]);
    await this.cardSystem.executeCardEffectCommand(command, {
      currentTurn: this.gameStateManager.getGameState().currentTurn,
      source: {
        kind: sourceKinds.has(scheduled.source.kind)
          ? scheduled.source.kind as import('../../game-core').CardPatchSourceKind
          : 'system',
        id: scheduled.source.id,
        ...(scheduled.source.name ? { name: scheduled.source.name } : {}),
      },
    });
  }

  private async executeEnemyTurnAction(): Promise<void> {
    const previousActiveEnemyId = this.gameStateManager.getGameState().activeEnemyId;
    const entries = this.prepareCurrentEnemyQueue();
    try {
      await runEnemyActionQueue(entries, {
        isAlive: enemyId => (this.gameStateManager.getEnemyById(enemyId)?.currentHp || 0) > 0,
        isTerminal: () => this.gameStateManager.isGameOver() || this.gameStateManager.isForceEndTurnRequested('enemy'),
        execute: entry => this.executeEnemyQueueEntry(entry),
        afterEach: () => { this.gameStateManager.removeDefeatedEnemies(); },
      });
    } finally {
      this.gameStateManager.consumeForceEndTurn('enemy');
      // Acting enemies temporarily become the legacy active alias so their
      // relative self/opponent effects resolve against the correct entity.
      // Preserve the player's selected target across that internal queue.
      if (previousActiveEnemyId) this.gameStateManager.setActiveEnemy(previousActiveEnemyId);
    }
  }

  private async executeEnemyQueueEntry(entry: EnemyActionQueueEntry): Promise<void> {
    if (!this.gameStateManager.setActiveEnemy(entry.enemyId)) return;
    const enemy = this.gameStateManager.getEnemy();
    if (!enemy) return;
    const decision = resolveEnemyTurnAction({
      hasEnemy: true,
      stunned: UnifiedEffectExecutor.getInstance().isStunned('enemy'),
      currentTurn: this.gameStateManager.getGameState().currentTurn,
      hasPreparedAction: true,
      actionCount: enemy.actions?.length || 0,
    });
    if (decision === 'stunned') {
      this.enemyIntentPresenter.showStunned(enemy.name);
      return;
    }
    await this.executeEnemyAction(entry);
  }

  // 敌人行动执行
  private async executeEnemyAction(entry: EnemyActionQueueEntry): Promise<void> {
    const enemy = this.gameStateManager.getEnemyById(entry.enemyId);
    if (!enemy) return;
    const action = entry.action as import('../../game-core').EnemyAction;

    // 显示敌人行动动画
    this.enemyIntentPresenter.showAction(action, enemy);

    await this.executeEnemyEffect(action.effectProgram, action.name, entry.enemyId);

    // 移除延迟以提高出牌速度
    // await this.delay(1500);

    // 行动执行后，下一行动与意图展示统一在 enemyTurn 末尾进行，避免重复/覆盖
  }

  // 执行默认敌人行动
  private async executeDefaultEnemyAction(): Promise<void> {
    const enemy = this.gameStateManager.getEnemy();
    if (!enemy) return;

    // 默认攻击行为
    const damage = rollDefaultEnemyAttackDamage(() => this.gameStateManager.nextRandom());
    this.enemyIntentPresenter.logAction('默认攻击', `造成${damage}点伤害`, enemy);
    await this.executeEnemyEffect(
      { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: damage }] },
      '默认攻击',
    );
  }

  /** Tavern execution bridge; the outer battle-session transaction owns rollback. */
  private async executeEnemyEffect(effectProgram: EffectProgram, actionName: string, enemyId?: string): Promise<void> {
    await UnifiedEffectExecutor.getInstance().executeEffectProgram(effectProgram, false, {
      targetType: 'player',
      battleContext: { intent: { name: actionName }, enemyId },
    });
  }

  // Persist through the state host, then refresh the Tavern presentation.
  private prepareCurrentEnemyQueue(): EnemyActionQueueEntry[] {
    const state = this.gameStateManager.getGameState();
    const plan = prepareEnemyActionQueue(
      this.gameStateManager.getEnemies({ livingOnly: true }),
      state.random || createBattleRandomState(0),
    );
    this.gameStateManager.setRandomState(plan.random);
    this.gameStateManager.setEnemies(plan.enemies as Enemy[], state.activeEnemyId);
    return plan.entries;
  }

  private setEnemyNextActions(): void {
    for (const enemy of this.gameStateManager.getEnemies({ livingOnly: true }))
      this.gameStateManager.updateEnemyById(enemy.id, { nextAction: null });
    this.prepareCurrentEnemyQueue();
    const active = this.gameStateManager.getEnemy();
    if (active) this.enemyIntentPresenter.render(active);
  }

  private async forEachLivingEnemy(callback: (enemy: Enemy) => void | Promise<void>): Promise<void> {
    const previous = this.gameStateManager.getGameState().activeEnemyId;
    for (const enemy of this.gameStateManager.getEnemies({ livingOnly: true })) {
      if (this.gameStateManager.isGameOver()) break;
      if (!this.gameStateManager.setActiveEnemy(enemy.id)) continue;
      await callback(enemy);
    }
    if (previous) this.gameStateManager.setActiveEnemy(previous);
  }

  // 战斗重置
  public resetBattle(): void {
    this.gameStateManager.resetGame();
  }

  // 检查玩家是否可以行动
  public canPlayerAct(): boolean {
    const state = this.gameStateManager.getGameState();
    return state.phase === 'player_turn' && !state.isGameOver;
  }

  // 获取可打出的卡牌
  public getPlayableCards() {
    return this.cardSystem.getPlayableCards();
  }

  // 玩家使用卡牌
  public async playCard(cardId: string, targetType?: 'player' | 'enemy'): Promise<boolean> {
    if (!this.canPlayerAct()) {
      return false;
    }

    const success = await this.cardSystem.playCard(cardId, targetType);

    if (success && this.gameStateManager.consumeForceEndTurn('player') && this.canPlayerAct()) {
      await this.endPlayerTurn();
    }

    // 死亡检查已由 UnifiedEffectExecutor 统一处理，这里不需要再检查

    return success;
  }

  // 强制结束回合（用于UI调用）
  public forceEndTurn(): void {
    if (this.canPlayerAct()) {
      this.endPlayerTurn();
    }
  }

  // 获取战斗状态信息
  public getBattleInfo() {
    const state = this.gameStateManager.getGameState();
    const playableCards = this.getPlayableCards();

    return {
      currentPhase: state.phase,
      currentTurn: state.currentTurn,
      isGameOver: state.isGameOver,
      result: state.battleResult,
      player: state.player,
      enemy: state.enemy,
      enemies: state.enemies,
      playableCardsCount: playableCards.length,
      canPlayerAct: this.canPlayerAct(),
    };
  }
}
