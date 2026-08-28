import {
  addModifierOperation,
  createBattleRandomState,
  createCombatantCollection,
  BattleEffectRuntime,
  resolvePassiveModifierOperations,
  resolvePassiveCardPlayRules,
  resolveEnemyTargets,
  resolveStatusHoldModifierOperations,
  resolveStatusHoldCardPlayRules,
  roundBattleDisplayValue,
  roundBattleValue,
  roundModifierBreakdown,
  type BattleEffectCommand,
  type BattleEffectRuntimeEvent,
  type BattleEndResult,
  type BattleEntityType,
  type CardPlayRuleEvent,
  type Card,
  type BattleTriggerDispatch,
  type CoreEffectState,
  type EffectCommand,
  type EffectProgram,
  type EnemyTargetSelector,
  type Enemy,
  type ModifierOperation,
  type Player,
} from '../../game-core';
import { TavernBattleEndHost } from '../core/battleEndHost';
import { TavernBattleTriggerHost } from '../core/battleTriggerHost';
import { TavernEffectCommandHost } from '../core/effectCommandHost';
import { GameStateManager } from '../core/gameStateManager';
import { TavernRelicTriggerHost } from '../core/relicTriggerHost';
import { TavernBattleEffectPresenter } from '../ui/battleEffectPresenter';
import { CardSystem } from './cardSystem';
import { DynamicStatusManager } from './dynamicStatusManager';
import { getAttributeDefinition } from './effectDefinitions';

export interface ModernEffectExecutionContext {
  targetType?: 'player' | 'enemy';
  triggerType?: string;
  cardContext?: any;
  battleContext?: any;
  isRelicEffect?: boolean;
  relicContext?: any;
  statusContext?: any;
  spentEnergy?: number;
  abilityContext?: any;
  setCardDestination?: (destination: import('../../game-core').PlayedCardDestination) => void;
}

/** Tavern coordinator for the modern typed effect pipeline. */
export class UnifiedEffectExecutor {
  private static instance: UnifiedEffectExecutor;
  private readonly gameStateManager = GameStateManager.getInstance();
  private readonly presentation = TavernBattleEffectPresenter.getInstance();
  private readonly battleEndHost = TavernBattleEndHost.getInstance();
  private readonly dynamicStatusManager = DynamicStatusManager.getInstance();
  private readonly relicTriggerHost = TavernRelicTriggerHost.getInstance();
  private readonly battleEffectRuntime: BattleEffectRuntime;
  private readonly effectCommandHost: TavernEffectCommandHost;
  private readonly triggerHost: TavernBattleTriggerHost;
  private _cardSystem?: CardSystem;
  private executionContext: ModernEffectExecutionContext & { sourceIsPlayer: boolean } = { sourceIsPlayer: false };
  private pendingDeaths = new Set<string>();
  private readonly activeLustOverflows = new Set<'player' | 'enemy'>();
  private currentResolvedEnemyId: string | null = null;

  private constructor() {
    this.relicTriggerHost.configureExecutionPorts({
      executeProgram: (program, context) => this.executeEffectProgram(program, true, context),
    });
    this.battleEffectRuntime = new BattleEffectRuntime(this.gameStateManager, {
      readModifierSources: (target, modifier) => this.getDeclarativeModifierOperations(target, modifier),
      dispatchTriggers: dispatches => this.dispatchBattleTriggers(dispatches),
      handleLustOverflow: target => this.handleLustOverflow(target),
      present: event => this.presentBattleEffectRuntimeEvent(event),
    });
    this.effectCommandHost = new TavernEffectCommandHost({
      readState: sourceIsPlayer => this.createCoreEffectState(sourceIsPlayer),
      isTerminal: () => this.gameStateManager.isGameOver(),
      executeCardCommand: async command => {
        const sourceValue = this.executionContext.cardContext || this.executionContext.relicContext || this.executionContext.statusContext || this.executionContext.abilityContext;
        const sourceKind = this.executionContext.cardContext
          ? 'card'
          : this.executionContext.relicContext
            ? 'relic'
            : this.executionContext.statusContext
              ? 'status'
              : this.executionContext.abilityContext
                ? 'ability'
                : 'system';
        await this.cardSystem.executeCardEffectCommand(command, {
          currentCardId: this.executionContext.cardContext?.id,
          currentTurn: this.gameStateManager.getGameState().currentTurn,
          source: {
            kind: sourceKind,
            id: String(sourceValue?.templateId || sourceValue?.originalId || sourceValue?.id || sourceValue?.name || 'effect'),
            ...(sourceValue?.name ? { name: sourceValue.name } : {}),
          },
        });
      },
      presentCommand: command => this.presentModernCommand(command),
      executeBattleCommand: (command, sourceIsPlayer) => this.executeModernBattleCommand(command, sourceIsPlayer),
      forEachEnemyTarget: (selector, execute) => this.forEachEnemyTarget(selector, execute),
      applyStatus: (target, status, stacks) => this.triggerHost.applyStatus(target, status, stacks),
      removeStatuses: (target, selection) => this.triggerHost.removeStatuses(target, selection),
      registerAbility: (target, definition) => {
        const card = this.executionContext.cardContext;
        const relic = this.executionContext.relicContext;
        const status = this.executionContext.statusContext;
        const ability = this.executionContext.abilityContext;
        const intent = this.executionContext.battleContext?.intent;
        const sourceValue = card || relic || status || ability || intent;
        const sourceName = sourceValue?.name || sourceValue?.id;
        const sourceKind = card ? '卡牌' : relic ? '遗物' : status ? '状态' : ability ? '能力' : intent ? '敌方行动' : '战斗效果';
        return this.triggerHost.registerAbility(target, {
          ...definition,
          ...(sourceName ? { name: sourceName, source: `${sourceKind}「${sourceName}」` } : { source: sourceKind }),
          ...(sourceValue?.emoji ? { emoji: sourceValue.emoji } : {}),
          ...(sourceValue?.description ? { description: sourceValue.description } : {}),
        });
      },
      scheduleEffect: (command, sourceIsPlayer) => this.scheduleEffectCommand(command, sourceIsPlayer),
      setCardDestination: async destination => {
        if (!this.executionContext.setCardDestination)
          throw new Error('card destination override is only valid while resolving a card');
        this.executionContext.setCardDestination(destination);
      },
      narrate: text => this.triggerNarrative(text),
    });
    this.triggerHost = new TavernBattleTriggerHost({
      executeProgram: (program, sourceIsPlayer, context) => this.executeEffectProgram(program, sourceIsPlayer, context),
      runRelic: (trigger, context) => this.relicTriggerHost.triggerRelics(trigger, { ...context }),
      addLog: (message, type = 'info', source) => this.presentation.addLog(message, type, source),
      logStatusEffect: (targetName, statusName, stacks, duration, isApply) =>
        this.presentation.logStatusEffect(targetName, statusName, stacks, duration, isApply),
    });
  }

  public static getInstance(): UnifiedEffectExecutor {
    if (!UnifiedEffectExecutor.instance) UnifiedEffectExecutor.instance = new UnifiedEffectExecutor();
    return UnifiedEffectExecutor.instance;
  }

  private get cardSystem(): CardSystem {
    if (!this._cardSystem) this._cardSystem = CardSystem.getInstance();
    return this._cardSystem;
  }

  public async executeEffectProgram(
    program: EffectProgram,
    sourceIsPlayer: boolean,
    context: ModernEffectExecutionContext = {},
  ): Promise<void> {
    const previousContext = this.executionContext;
    const previousPendingDeaths = this.pendingDeaths;
    this.executionContext = { sourceIsPlayer, ...context };
    this.pendingDeaths = new Set();
    try {
      await this.effectCommandHost.executeProgram(program, sourceIsPlayer, context);
      await this.processPendingDeaths();
    } catch (error) {
      this.pendingDeaths.clear();
      throw error;
    } finally {
      this.executionContext = previousContext;
      this.pendingDeaths = previousPendingDeaths;
    }
  }

  public isStunned(target: 'player' | 'enemy'): boolean {
    return Boolean(
      this.getEntity(target)?.statusEffects.some(status =>
        this.dynamicStatusManager.getStatusDefinition(status.id)?.stun === true,
      ),
    );
  }

  /** Read-only portable state for cost, selection, history and UI formula evaluation. */
  public getCoreEffectState(sourceIsPlayer = true): CoreEffectState {
    return this.createCoreEffectState(sourceIsPlayer);
  }

  private async scheduleEffectCommand(
    command: Extract<EffectCommand, { type: 'schedule_effect' }>,
    sourceIsPlayer: boolean,
  ): Promise<void> {
    const state = this.gameStateManager.getGameState();
    const contextSource =
      this.executionContext.cardContext ||
      this.executionContext.relicContext ||
      this.executionContext.statusContext ||
      this.executionContext.abilityContext ||
      this.executionContext.battleContext?.intent;
    const sourceId = contextSource?.templateId || contextSource?.originalId || contextSource?.id || contextSource?.name || 'effect';
    const sourceKind = this.executionContext.cardContext
      ? 'card'
      : this.executionContext.relicContext
        ? 'relic'
        : this.executionContext.statusContext
          ? 'status'
          : this.executionContext.abilityContext
            ? 'ability'
            : this.executionContext.battleContext?.intent
              ? 'enemy_action'
              : 'effect';
    this.gameStateManager.scheduleEffect({
      source: { kind: sourceKind, id: String(sourceId), ...(contextSource?.name ? { name: contextSource.name } : {}) },
      owner: sourceIsPlayer ? 'player' : 'enemy',
      createdTurn: state.currentTurn,
      dueTurn: state.currentTurn + command.afterTurns,
      phase: command.phase,
      priority: command.priority,
      ...(command.repeatEvery !== undefined ? { repeatEvery: command.repeatEvery } : {}),
      ...(command.repeats !== undefined ? { remainingRepeats: command.repeats } : {}),
      payload: {
        type: 'effect_program',
        program: { spec: 'mwg.effect/v1', steps: structuredClone(command.effects) },
        sourceIsPlayer,
      },
    });
  }

  public getModifierBreakdown(target: BattleEntityType, modifier: string): { add: number; mul: number } {
    const result = { add: 0, mul: 1 };
    for (const source of this.getDeclarativeModifierOperations(target, modifier)) {
      addModifierOperation(result, source.operation);
    }
    const entity = this.getEntity(target);
    const direct = entity?.modifiers?.[modifier];
    if (typeof direct === 'number' && direct !== 0) result.add += direct;
    return roundModifierBreakdown(result);
  }

  public analyzeModifierFromStatusEffects(target: BattleEntityType, modifier: string): { add: number; mul: number } {
    return this.getModifierBreakdown(target, modifier);
  }

  /** Collect continuous card-play rules from passive abilities, relics, and status hold programs. */
  public getCardPlayRules(target: BattleEntityType): CardPlayRuleEvent[] {
    const state = this.gameStateManager.getGameState();
    const result: CardPlayRuleEvent[] = [];
    const addPassive = (sources: any[] | undefined, owner: BattleEntityType): void => {
      result.push(
        ...resolvePassiveCardPlayRules(
          sources,
          owner,
          target,
          this.createCoreEffectState(owner === 'player'),
        ).map(entry => entry.rule),
      );
    };
    addPassive(state.player.abilities, 'player');
    addPassive(state.enemy?.abilities, 'enemy');
    addPassive(state.player.relics, 'player');

    const addStatuses = (holder: Player | Enemy | null, holderType: BattleEntityType): void => {
      if (!holder) return;
      const coreState = this.createCoreEffectState(holderType === 'player');
      for (const status of holder.statusEffects) {
        const definition = this.dynamicStatusManager.getStatusDefinition(status.id);
        if (!definition) continue;
        result.push(
          ...resolveStatusHoldCardPlayRules(
            definition.triggers.hold,
            holderType,
            target,
            coreState,
            status.stacks,
          ),
        );
      }
    };
    addStatuses(state.player, 'player');
    addStatuses(state.enemy, 'enemy');
    return result;
  }

  public async processStatusEffectsAtTurnEnd(target: 'player' | 'enemy'): Promise<void> {
    await this.triggerHost.processStatusEffectsAtTurnEnd(target);
  }

  public async processAbilitiesByTrigger(target: 'player' | 'enemy', trigger: string): Promise<void> {
    await this.triggerHost.processAbilitiesByTrigger(target, trigger);
  }

  private async executeModernBattleCommand(command: BattleEffectCommand, sourceIsPlayer: boolean): Promise<void> {
    const damageKind = this.executionContext.cardContext?.type === 'Attack'
      ? 'attack'
      : this.executionContext.triggerType === 'tick'
        ? 'damage_over_time'
        : 'effect';
    const source = sourceIsPlayer ? 'player' : 'enemy';
    const target = command.target === 'self' ? source : source === 'player' ? 'enemy' : 'player';
    const resolvedEnemyId = target === 'enemy'
      ? this.gameStateManager.getGameState().activeEnemyId || this.gameStateManager.getEnemy()?.id || null
      : null;
    const previousResolvedEnemyId = this.currentResolvedEnemyId;
    if (resolvedEnemyId) this.currentResolvedEnemyId = resolvedEnemyId;
    let result;
    try {
      result = await this.battleEffectRuntime.execute(command, { source, damageKind });
    } finally {
      // Event presentation happens synchronously inside execute and can read the
      // exact target even when the active alias advances after a lethal hit.
      this.currentResolvedEnemyId = previousResolvedEnemyId;
    }
    if (!result.applied) {
      this.presentation.addLog(`目标实体不存在: ${result.target || 'unknown'}`, 'system');
      return;
    }
    if (result.target && result.pendingDeath !== undefined) {
      const targetId = result.target === 'enemy'
        ? resolvedEnemyId || 'enemy'
        : 'player';
      if (result.pendingDeath) this.pendingDeaths.add(targetId);
      else this.pendingDeaths.delete(targetId);
    }
  }

  private async forEachEnemyTarget(selector: EnemyTargetSelector, execute: () => Promise<void>): Promise<void> {
    const previous = this.gameStateManager.getGameState().activeEnemyId;
    const executeTarget = async (enemyId: string): Promise<void> => {
      const enemy = this.gameStateManager.getEnemyById(enemyId);
      if (!enemy || enemy.currentHp <= 0 || !this.gameStateManager.setActiveEnemy(enemyId)) return;
      await execute();
    };
    try {
      if (selector.mode === 'random_n' && selector.retarget === 'each_hit') {
        const selected = new Set<string>();
        for (let hit = 0; hit < selector.count; hit += 1) {
          const living = this.gameStateManager.getEnemies({ livingOnly: true })
            .filter(enemy => selector.allowRepeat || !selected.has(enemy.id));
          if (living.length === 0) break;
          const state = this.gameStateManager.getGameState();
          const resolved = resolveEnemyTargets(
            createCombatantCollection(living, state.activeEnemyId),
            { mode: 'random' },
            state.random || createBattleRandomState(0),
          );
          this.gameStateManager.setRandomState(resolved.random);
          const target = resolved.targets[0];
          if (!target) break;
          selected.add(target.id);
          await executeTarget(target.id);
        }
        return;
      }
      const state = this.gameStateManager.getGameState();
      const resolved = resolveEnemyTargets(
        createCombatantCollection(this.gameStateManager.getEnemies(), state.activeEnemyId),
        selector,
        state.random || createBattleRandomState(0),
      );
      this.gameStateManager.setRandomState(resolved.random);
      for (const target of resolved.targets) await executeTarget(target.id);
    } finally {
      if (previous) this.gameStateManager.setActiveEnemy(previous);
    }
  }

  private presentModernCommand(command: EffectCommand): void {
    if (this.executionContext.cardContext || this.executionContext.statusContext) return;
    const source = this.getEffectSourceInfo();
    this.presentation.addLog(
      source ? `${source.entityName}-${source.sourceName}执行效果` : `执行效果: ${command.type}`,
      'action',
      source?.logSource,
    );
  }

  private presentBattleEffectRuntimeEvent(event: BattleEffectRuntimeEvent): void {
    if (event.type === 'damage_resolved' || event.type === 'heal_resolved') {
      const contextSource =
        this.executionContext.cardContext ||
        this.executionContext.relicContext ||
        this.executionContext.statusContext ||
        this.executionContext.abilityContext ||
        this.executionContext.battleContext?.intent;
      const sourceKind = this.executionContext.cardContext
        ? 'card'
        : this.executionContext.relicContext
          ? 'relic'
          : this.executionContext.statusContext
            ? 'status'
            : this.executionContext.abilityContext
              ? 'ability'
              : this.executionContext.battleContext?.intent
                ? 'enemy_action'
                : 'system';
      const sourceId = contextSource?.templateId || contextSource?.originalId || contextSource?.id || contextSource?.name || 'effect';
      const state = this.gameStateManager.getGameState();
      const actorId = event.source === 'player'
        ? 'player'
        : this.executionContext.battleContext?.enemyId || state.activeEnemyId || state.enemy?.id || 'enemy';
      const targetId = event.target === 'player'
        ? 'player'
        : this.currentResolvedEnemyId || state.activeEnemyId || state.enemy?.id || 'enemy';
      const cause = { source: { kind: sourceKind, id: String(sourceId), name: contextSource?.name, ownerId: actorId } } as const;
      if (event.type === 'damage_resolved') {
        const target = event.target === 'player'
          ? state.player
          : this.currentResolvedEnemyId
            ? this.gameStateManager.getEnemyById(this.currentResolvedEnemyId)
            : state.enemy;
        this.gameStateManager.recordBattleEvent({
          turn: state.currentTurn,
          phase: 'after',
          kind: 'damage_resolved',
          cause,
          actorId,
          targetId,
          damageKind: event.damageKind,
          requested: event.requested,
          modified: event.modified,
          blocked: event.blocked,
          hpLost: event.hpLost,
          fatal: Boolean(target && target.currentHp <= 0),
        });
      } else {
        this.gameStateManager.recordBattleEvent({
          turn: state.currentTurn,
          phase: 'after',
          kind: 'heal_resolved',
          cause,
          actorId,
          targetId,
          requested: event.requested,
          hpGained: event.hpGained,
        });
      }
      return;
    }
    if (event.type === 'block_absorbed') {
      this.presentation.showBlockAbsorption(event.target, event.amount);
      return;
    }
    if (event.type === 'modifier_applied') {
      if (Math.abs(event.nextValue - event.previousValue) >= 1) {
        this.presentation.addLog(
          `${event.source.name}: ${event.previousValue} -> ${event.nextValue}`,
          'info',
        );
      }
      return;
    }
    if (event.type === 'direct_modifier_changed') {
      if (Math.abs(event.nextValue - event.previousValue) >= 1) {
        this.presentation.addLog(
          `${event.target === 'player' ? '我方' : '敌方'}的${this.getAttributeDisplayName(event.modifier)}: ${event.previousValue} ${event.operation.operator} ${event.operation.value} = ${event.nextValue}`,
          'info',
        );
      }
      return;
    }
    if (event.type === 'attribute_changed') {
      const entity = event.target === 'enemy' && this.currentResolvedEnemyId
        ? this.gameStateManager.getEnemyById(this.currentResolvedEnemyId)
        : this.getEntity(event.target);
      if (!entity) return;
      const change = roundBattleValue(event.nextValue - event.previousValue);
      if (event.attribute === 'hp' && change !== 0) {
        this.presentation.showHealthChange(event.target, change, event.nextValue, entity.maxHp);
      } else if (event.attribute === 'lust') {
        this.presentation.showLustChange(event.target, change, event.nextValue, entity.maxLust);
      } else if (event.attribute === 'energy' && event.target === 'player') {
        this.presentation.refreshPlayerEnergy(this.gameStateManager.getPlayer());
      }
      return;
    }
    this.logAttributeChange(
      event.target,
      event.attribute,
      roundBattleValue(event.nextValue - event.previousValue),
      event.nextValue,
    );
  }

  private getDeclarativeModifierOperations(
    target: BattleEntityType,
    modifier: string,
  ): Array<{ operation: ModifierOperation; name: string; stacks?: number }> {
    const state = this.gameStateManager.getGameState();
    const result: Array<{ operation: ModifierOperation; name: string; stacks?: number }> = [];
    const addPassive = (sources: any[] | undefined, owner: BattleEntityType, label: string): void => {
      for (const resolved of resolvePassiveModifierOperations(
        sources,
        owner,
        target,
        modifier,
        this.createCoreEffectState(owner === 'player'),
      )) {
        result.push({ operation: resolved.operation, name: `${label}${resolved.source.name || resolved.source.id}` });
      }
    };
    addPassive(state.player.abilities, 'player', '能力');
    addPassive(state.enemy?.abilities, 'enemy', '能力');
    addPassive(state.player.relics, 'player', '遗物');

    const addStatuses = (holder: Player | Enemy | null, holderType: BattleEntityType): void => {
      if (!holder) return;
      const coreState = this.createCoreEffectState(holderType === 'player');
      for (const status of holder.statusEffects) {
        const definition = this.dynamicStatusManager.getStatusDefinition(status.id);
        if (!definition) continue;
        for (const operation of resolveStatusHoldModifierOperations(
          definition.triggers.hold,
          holderType,
          target,
          modifier,
          coreState,
          status.stacks,
        )) {
          result.push({ operation, name: status.name, stacks: status.stacks });
        }
      }
    };
    addStatuses(state.player, 'player');
    addStatuses(state.enemy, 'enemy');
    return result;
  }

  private async dispatchBattleTriggers(dispatches: readonly BattleTriggerDispatch[]): Promise<void> {
    await this.triggerHost.dispatch(dispatches);
  }

  private async handleLustOverflow(target: 'player' | 'enemy'): Promise<void> {
    if (target === 'player') {
      const effect = this.gameStateManager.getEnemy()?.lustEffect;
      if (!effect) return;
      if (this.activeLustOverflows.has(target)) return;
      this.activeLustOverflows.add(target);
      try {
        this.presentation.logLustOverflow('玩家', effect.name);
        this.presentation.showLustOverflow('player', effect);
        await this.executeEffectProgram(effect.effectProgram, false);
      } finally {
        // 欲望效果本身仍可能包含欲望变化。保持本次溢出锁直到整段效果
        // 结束，避免它在归零前递归触发自身并卡死酒馆页面。
        this.gameStateManager.updatePlayer({ currentLust: 0 });
        this.activeLustOverflows.delete(target);
      }
      return;
    }
    const effect = this.gameStateManager.getGameState().battle?.player_lust_effect;
    if (!effect?.effectProgram) return;
    if (this.activeLustOverflows.has(target)) return;
    this.activeLustOverflows.add(target);
    try {
      this.presentation.logLustOverflow('敌人', effect.name || '榨精支配');
      this.presentation.showLustOverflow('enemy', effect);
      await this.executeEffectProgram(effect.effectProgram, true);
    } finally {
      this.gameStateManager.updateEnemy({ currentLust: 0 });
      this.activeLustOverflows.delete(target);
    }
  }

  private createCoreEffectState(sourceIsPlayer: boolean): CoreEffectState {
    const state = this.gameStateManager.getGameState();
    const toCore = (entity: Player | Enemy | null, includeCards: boolean): CoreEffectState['self'] => ({
      hp: entity?.currentHp ?? 0,
      maxHp: entity?.maxHp ?? 1,
      lust: entity?.currentLust ?? 0,
      maxLust: entity?.maxLust ?? 100,
      energy: entity?.energy ?? 0,
      maxEnergy: entity?.maxEnergy ?? 0,
      block: entity?.block ?? 0,
      ...(includeCards
        ? {
            handSize: state.player.hand.length,
            drawPileSize: state.player.drawPile.length,
            discardPileSize: state.player.discardPile.length,
            exhaustPileSize: state.player.exhaustPile.length,
          }
        : {}),
      statusStacks: Object.fromEntries((entity?.statusEffects || []).map(status => [status.id, status.stacks])),
    });
    const player = toCore(state.player, true);
    const enemy = toCore(state.enemy, false);
    const cardView = (card: Card) => ({
      id: card.id,
      type: card.type,
      rarity: card.rarity,
      cost: card.cost,
      tags: card.tags,
      originalId: card.originalId,
      templateId: card.templateId,
      runInstanceId: card.runInstanceId,
      combatInstanceId: card.combatInstanceId,
      origin: card.origin,
      upgraded: card.upgraded,
      upgradeLevel: card.upgradeLevel,
    });
    const lastDamage = state.eventJournal?.lastDamage;
    const lastHeal = [...(state.eventJournal?.events || [])].reverse().find(event => event.kind === 'heal_resolved');
    const lastResource = [...(state.eventJournal?.events || [])].reverse().find(event => event.kind === 'resource_spent');
    return {
      self: sourceIsPlayer ? player : enemy,
      opponent: sourceIsPlayer ? enemy : player,
      currentTurn: state.currentTurn,
      cardsPlayedThisTurn: state.cardsPlayedThisTurn,
      attacksPlayedThisTurn: state.attacksPlayedThisTurn,
      skillsPlayedThisTurn: state.skillsPlayedThisTurn,
      cardZones: {
        hand: state.player.hand.map(cardView),
        draw: state.player.drawPile.map(cardView),
        discard: state.player.discardPile.map(cardView),
        exhaust: state.player.exhaustPile.map(cardView),
      },
      history: {
        lastDamage: lastDamage?.modified || 0,
        lastHpLoss: state.eventJournal?.lastActualHpLoss?.hpLost || 0,
        lastHeal: lastHeal && 'hpGained' in lastHeal ? lastHeal.hpGained : 0,
        lastResourceSpent: lastResource && 'spent' in lastResource ? lastResource.spent : 0,
      },
      enemyIntentValue: state.enemy?.intent?.value || 0,
    };
  }

  private async processPendingDeaths(): Promise<void> {
    if (this.gameStateManager.isGameOver()) {
      this.pendingDeaths.clear();
      return;
    }
    if (this.pendingDeaths.has('player')) {
      this.pendingDeaths.clear();
      await this.completeBattleEnd('defeat');
      return;
    }
    for (const enemyId of this.pendingDeaths) {
      const enemy = this.gameStateManager.getEnemyById(enemyId);
      if (enemy && enemy.currentHp <= 0) this.gameStateManager.updateEnemyById(enemyId, { currentHp: 0 });
    }
    this.gameStateManager.removeDefeatedEnemies();
    const result = this.gameStateManager.getEnemies({ livingOnly: true }).length === 0 && this.pendingDeaths.size > 0
      ? 'victory'
      : null;
    this.pendingDeaths.clear();
    if (result) await this.completeBattleEnd(result);
  }

  private async completeBattleEnd(result: BattleEndResult, narrativeText = ''): Promise<void> {
    this.gameStateManager.setBattleOutcome(result, narrativeText);
    await this.battleEndHost.presentBattleEnd(result, narrativeText || undefined);
  }

  private async triggerNarrative(text: string): Promise<void> {
    await this.completeBattleEnd('terminated', text);
  }

  private getEntity(target: 'player' | 'enemy'): Player | Enemy | null {
    return target === 'player' ? this.gameStateManager.getPlayer() : this.gameStateManager.getEnemy();
  }

  private getEffectSourceInfo(): { entityName: string; sourceName: string; logSource?: any } | null {
    const entityName = this.executionContext.sourceIsPlayer ? '玩家' : '敌人';
    if (this.executionContext.statusContext) {
      const definition = this.dynamicStatusManager.getStatusDefinition(this.executionContext.statusContext.id);
      const name = definition?.name || this.executionContext.statusContext.id;
      return { entityName, sourceName: name, logSource: { type: 'status', name, details: definition?.description } };
    }
    if (this.executionContext.cardContext) {
      const card = this.executionContext.cardContext;
      return { entityName, sourceName: card.name || '卡牌', logSource: { type: 'card', name: card.name || '卡牌' } };
    }
    if (this.executionContext.abilityContext) {
      const ability = this.executionContext.abilityContext;
      return { entityName, sourceName: ability.name || '能力', logSource: { type: 'ability', name: ability.name || '能力' } };
    }
    if (this.executionContext.relicContext) {
      const relic = this.executionContext.relicContext;
      return { entityName, sourceName: relic.name || '遗物', logSource: { type: 'relic', name: relic.name || '遗物' } };
    }
    if (!this.executionContext.sourceIsPlayer && this.executionContext.battleContext?.intent) {
      const name = this.executionContext.battleContext.intent.name || '意图';
      return { entityName, sourceName: name, logSource: { type: 'ability', name } };
    }
    return null;
  }

  private logAttributeChange(target: string, attribute: string, change: number, nextValue: number): void {
    if (change === 0) return;
    const source = this.getEffectSourceInfo();
    const prefix = source && source.logSource?.type !== 'status' ? `${source.sourceName}-` : '';
    const direction = change > 0 ? '增加' : '减少';
    this.presentation.addLog(
      `${prefix}${target === 'player' ? '玩家' : '敌人'}的${this.getAttributeDisplayName(attribute)}${direction}${roundBattleDisplayValue(Math.abs(change))}点，当前${roundBattleDisplayValue(nextValue)}`,
      'info',
      source?.logSource,
    );
  }

  private getAttributeDisplayName(attribute: string): string {
    return getAttributeDefinition(attribute)?.displayName || attribute;
  }
}
