import {
  addModifierOperation,
  BattleEffectRuntime,
  resolvePassiveModifierOperations,
  resolvePendingBattleEnd,
  resolveStatusHoldModifierOperations,
  roundModifierBreakdown,
  type BattleEffectCommand,
  type BattleEffectRuntimeEvent,
  type BattleEndResult,
  type BattleEntityType,
  type BattleTriggerDispatch,
  type CoreEffectState,
  type EffectCommand,
  type EffectProgram,
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
  private pendingDeaths = new Set<'player' | 'enemy'>();

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
        await this.cardSystem.executeCardEffectCommand(command, {
          currentCardId: this.executionContext.cardContext?.id,
        });
      },
      presentCommand: command => this.presentModernCommand(command),
      executeBattleCommand: (command, sourceIsPlayer) => this.executeModernBattleCommand(command, sourceIsPlayer),
      applyStatus: (target, status, stacks) => this.triggerHost.applyStatus(target, status, stacks),
      removeStatuses: (target, selection) => this.triggerHost.removeStatuses(target, selection),
      registerAbility: (target, definition) => this.triggerHost.registerAbility(target, definition),
      narrate: text => this.triggerNarrative(text),
    });
    this.triggerHost = new TavernBattleTriggerHost({
      executeProgram: (program, sourceIsPlayer, context) => this.executeEffectProgram(program, sourceIsPlayer, context),
      runRelic: (trigger, context) => this.relicTriggerHost.triggerRelics(trigger, { ...context }),
      addLog: (message, type = 'info') => this.presentation.addLog(message, type),
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

  public getModifierBreakdown(entity: Player | Enemy, modifier: string): { add: number; mul: number } {
    const result = { add: 0, mul: 1 };
    for (const source of this.getDeclarativeModifierOperations(this.resolveEntityType(entity), modifier)) {
      addModifierOperation(result, source.operation);
    }
    const direct = entity.modifiers?.[modifier];
    if (typeof direct === 'number' && direct !== 0) result.add += direct;
    return roundModifierBreakdown(result);
  }

  public analyzeModifierFromStatusEffects(entity: Player | Enemy, modifier: string): { add: number; mul: number } {
    return this.getModifierBreakdown(entity, modifier);
  }

  public async processStatusEffectsAtTurnEnd(target: 'player' | 'enemy'): Promise<void> {
    await this.triggerHost.processStatusEffectsAtTurnEnd(target);
  }

  public async processAbilitiesByTrigger(target: 'player' | 'enemy', trigger: string): Promise<void> {
    await this.triggerHost.processAbilitiesByTrigger(target, trigger);
  }

  private async executeModernBattleCommand(command: BattleEffectCommand, sourceIsPlayer: boolean): Promise<void> {
    const result = await this.battleEffectRuntime.execute(command, { source: sourceIsPlayer ? 'player' : 'enemy' });
    if (!result.applied) {
      this.presentation.addLog(`目标实体不存在: ${result.target || 'unknown'}`, 'system');
      return;
    }
    if (result.target && result.pendingDeath !== undefined) {
      if (result.pendingDeath) this.pendingDeaths.add(result.target);
      else this.pendingDeaths.delete(result.target);
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
          `${event.target === 'player' ? '我方' : '对方'}的${this.getAttributeDisplayName(event.modifier)}: ${event.previousValue} ${event.operation.operator} ${event.operation.value} = ${event.nextValue}`,
          'info',
        );
      }
      return;
    }
    if (event.type === 'attribute_changed') {
      const entity = this.getEntity(event.target);
      if (!entity) return;
      const change = event.nextValue - event.previousValue;
      if (event.attribute === 'hp' && change !== 0) {
        this.presentation.showHealthChange(event.target, change, event.nextValue, entity.maxHp);
      } else if (event.attribute === 'lust') {
        this.presentation.showLustChange(event.target, change, event.nextValue, entity.maxLust);
      } else if (event.attribute === 'energy' && event.target === 'player') {
        this.presentation.refreshPlayerEnergy(this.gameStateManager.getPlayer());
      }
      return;
    }
    this.logAttributeChange(event.target, event.attribute, event.nextValue - event.previousValue, event.nextValue);
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
      this.presentation.logLustOverflow('玩家', effect.name);
      this.presentation.showLustOverflow('player', effect);
      await this.executeEffectProgram(effect.effectProgram, false);
      this.gameStateManager.updatePlayer({ currentLust: 0 });
      return;
    }
    const effect = this.gameStateManager.getGameState().battle?.player_lust_effect;
    if (!effect?.effectProgram) return;
    this.presentation.logLustOverflow('敌人', effect.name || '榨精支配');
    this.presentation.showLustOverflow('enemy', effect);
    await this.executeEffectProgram(effect.effectProgram, true);
    this.gameStateManager.updateEnemy({ currentLust: 0 });
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
    return {
      self: sourceIsPlayer ? player : enemy,
      opponent: sourceIsPlayer ? enemy : player,
      currentTurn: state.currentTurn,
      cardsPlayedThisTurn: state.cardsPlayedThisTurn,
      attacksPlayedThisTurn: state.attacksPlayedThisTurn,
      skillsPlayedThisTurn: state.skillsPlayedThisTurn,
    };
  }

  private async processPendingDeaths(): Promise<void> {
    if (this.gameStateManager.isGameOver()) {
      this.pendingDeaths.clear();
      return;
    }
    const result = resolvePendingBattleEnd(this.pendingDeaths);
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

  private resolveEntityType(entity: Player | Enemy): BattleEntityType {
    return entity === this.gameStateManager.getPlayer() ? 'player' : 'enemy';
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
      `${prefix}${target === 'player' ? '玩家' : '敌人'}的${this.getAttributeDisplayName(attribute)}${direction}${Math.abs(change)}点，当前${nextValue}`,
      'info',
      source?.logSource,
    );
  }

  private getAttributeDisplayName(attribute: string): string {
    return getAttributeDefinition(attribute)?.displayName || attribute;
  }
}
