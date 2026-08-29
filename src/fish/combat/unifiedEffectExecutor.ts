import {
  addModifierOperation,
  allocateRuntimeId,
  applyModifierOperation,
  createBattleRandomState,
  createCombatantCollection,
  BattleEffectRuntime,
  resolvePassiveModifierOperations,
  resolvePassiveCardPlayRules,
  resolveActiveCardPlayRules,
  resolveEnemyTargets,
  resolveStatusHoldModifierOperations,
  resolveStatusHoldCardPlayRules,
  roundBattleDisplayValue,
  roundBattleValue,
  roundModifierBreakdown,
  resolveSummonAction,
  MODIFIER_ATTRIBUTE_BY_STAT,
  MODIFIER_SYMBOL_BY_OPERATOR,
  type BattleEffectCommand,
  type BattleEffectRuntimeEvent,
  type BattleEndResult,
  type BattleEntityType,
  type BattleModifierAttribute,
  type CardPlayRuleEvent,
  type Card,
  type BattleTriggerDispatch,
  type CoreEffectState,
  type EffectCommand,
  type EffectProgram,
  type EnemyTargetSelector,
  type CombatantTargetResolution,
  type Enemy,
  type ModifierOperation,
  type Player,
  type ActiveStance,
  type OrbInstance,
  type EventSourceKind,
  type SummonUnit,
} from '../../game-core';
import { TavernBattleEndHost } from '../core/battleEndHost';
import { TavernBattleTriggerHost } from '../core/battleTriggerHost';
import { TavernEffectCommandHost } from '../core/effectCommandHost';
import { GameStateManager } from '../core/gameStateManager';
import { TavernRelicTriggerHost } from '../core/relicTriggerHost';
import { TavernBattleEffectPresenter } from '../ui/battleEffectPresenter';
import { TavernEffectChoicePresenter } from '../ui/effectChoicePresenter';
import { TavernSummonChoicePresenter } from '../ui/summonChoicePresenter';
import { CardSystem } from './cardSystem';
import { DynamicStatusManager } from './dynamicStatusManager';
import { getAttributeDefinition } from './effectDefinitions';
import { convertMvuEnemy } from '../core/mvuBattleAdapter';

export interface ModernEffectExecutionContext {
  targetType?: 'player' | 'enemy';
  triggerType?: string;
  cardContext?: any;
  battleContext?: any;
  isRelicEffect?: boolean;
  relicContext?: any;
  statusContext?: any;
  spentEnergy?: number;
  /** Every resource actually paid by the current card resolution. */
  spentResources?: Readonly<Record<string, number>>;
  /** X values resolved independently for every `all` cost component. */
  xValues?: Readonly<Record<string, number>>;
  /** Compatibility projection for the legacy energy-only X formula. */
  xValue?: number;
  orbValue?: number;
  abilityContext?: any;
  /** Independent actor for summon action programs. */
  summonContext?: SummonUnit;
  /** Present only while a status held by this exact summon is resolving. */
  summonStatusContext?: { summonId: string };
  /** Fixed summon actions/abilities deliberately ignore summon-output amplification. */
  summonEffectFixed?: boolean;
  /** Explicit nested summon program whose ordinary self is the owning combatant. */
  summonSelfTargetsOwner?: boolean;
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
      interceptDamage: async request => {
        const intercepted = this.gameStateManager.interceptDamageWithSummons(request.target, request.amount);
        return {
          remainingDamage: intercepted.remainingDamage,
          interceptedDamage: intercepted.interceptedDamage,
          hits: intercepted.hits.map(hit => ({
            summonId: hit.summonId,
            blocked: hit.blocked,
            hpLost: hit.hpLost,
            defeated: hit.defeated,
          })),
        };
      },
      present: event => this.presentBattleEffectRuntimeEvent(event),
    });
    this.effectCommandHost = new TavernEffectCommandHost({
      readState: sourceIsPlayer => this.createCoreEffectState(
        sourceIsPlayer,
        this.executionContext.summonSelfTargetsOwner ? undefined : this.executionContext.summonContext,
      ),
      isTerminal: () => this.gameStateManager.isGameOver(),
      executeCardCommand: async command => {
        await this.cardSystem.executeCardEffectCommand(command, {
          currentCardId: this.executionContext.cardContext?.id,
          currentTurn: this.gameStateManager.getGameState().currentTurn,
          source: this.currentEffectSource(),
        });
      },
      presentCommand: command => this.presentModernCommand(command),
      executeBattleCommand: (command, sourceIsPlayer, resolvedEnemyId) =>
        this.executeModernBattleCommand(command, sourceIsPlayer, resolvedEnemyId),
      executeSpecialCommand: (command, sourceIsPlayer) => this.executeSpecialCombatCommand(command, sourceIsPlayer),
      executeSummonCommand: (command, sourceIsPlayer) => this.executeSummonCommand(command, sourceIsPlayer),
      executeEnemyCommand: (command, sourceIsPlayer) => this.executeEnemyCommand(command, sourceIsPlayer),
      executeSummonerProgram: (command, sourceIsPlayer) => this.executeSummonerProgram(command, sourceIsPlayer),
      forEachEnemyTarget: (selector, execute) => this.forEachEnemyTarget(selector, execute),
      applyStatus: (target, status, stacks) => {
        const holder = this.activeSummonHolder(target);
        if (this.hasSummonSelfBinding(target)) return holder
          ? this.triggerHost.applyStatusToSummons([holder.instanceId], status, stacks)
          : Promise.resolve();
        return this.triggerHost.applyStatus(target, status, stacks);
      },
      removeStatuses: (target, selection) => {
        const holder = this.activeSummonHolder(target);
        if (this.hasSummonSelfBinding(target)) return holder
          ? this.triggerHost.removeStatusesFromSummons([holder.instanceId], selection)
          : Promise.resolve();
        return this.triggerHost.removeStatuses(target, selection);
      },
      registerAbility: (target, definition) => {
        const card = this.executionContext.cardContext;
        const relic = this.executionContext.relicContext;
        const status = this.executionContext.statusContext;
        const ability = this.executionContext.abilityContext;
        const summon = this.executionContext.summonContext;
        const intent = this.executionContext.battleContext?.intent;
        const sourceValue = card || relic || status || ability || summon || intent;
        const sourceName = sourceValue?.name || sourceValue?.id;
        const sourceKind = card ? '卡牌' : relic ? '遗物' : status ? '状态' : ability ? '能力' : summon ? '召唤单位' : intent ? '敌方行动' : '战斗效果';
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
      chooseEffectOption: choice => TavernEffectChoicePresenter.getInstance().choose(choice),
    });
    this.triggerHost = new TavernBattleTriggerHost({
      executeProgram: (program, sourceIsPlayer, context) => this.executeEffectProgram(program, sourceIsPlayer, context),
      runRelic: (trigger, context) => this.relicTriggerHost.triggerRelics(trigger, { ...context }),
      addLog: (message, type = 'info', source) => this.presentation.addLog(message, type, source),
      logStatusEffect: (targetName, statusName, stacks, duration, isApply, emoji) =>
        this.presentation.logStatusEffect(targetName, statusName, stacks, duration, isApply, emoji),
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
      this.executionContext.abilityContext || this.executionContext.summonContext ||
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
            : this.executionContext.summonContext
              ? 'summon'
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
    if (state.player.stance?.passiveEffects?.length) addPassive([{
      id: state.player.stance.id, name: state.player.stance.name, trigger: 'passive',
      effectProgram: { spec: 'mwg.effect/v1', steps: state.player.stance.passiveEffects },
    }], 'player');
    if (state.enemy?.stance?.passiveEffects?.length) addPassive([{
      id: state.enemy.stance.id, name: state.enemy.stance.name, trigger: 'passive',
      effectProgram: { spec: 'mwg.effect/v1', steps: state.enemy.stance.passiveEffects },
    }], 'enemy');

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

  public async processSummonStatusEffectsAtTurnEnd(owner: 'player' | 'enemy'): Promise<void> {
    await this.triggerHost.processSummonStatusEffectsAtTurnEnd(owner);
  }

  /**
   * Snapshot every threshold-execute status for one side, then resolve the
   * snapshot in stable entity/status order. Each individual execute still uses
   * the normal terminal-aware death path, so killing the final combatant stops
   * the remaining queue immediately.
   */
  public async processThresholdExecutes(owner: 'player' | 'enemy'): Promise<void> {
    const state = this.gameStateManager.getGameState();
    const holders: Array<{ id: string; statuses: typeof state.player.statusEffects }> = owner === 'player'
      ? [{ id: 'player', statuses: structuredClone(state.player.statusEffects) }]
      : this.gameStateManager.getEnemies({ livingOnly: true }).map(enemy => ({
          id: enemy.id,
          statuses: structuredClone(enemy.statusEffects),
        }));
    const snapshot = holders.flatMap(holder => holder.statuses.flatMap(status => {
      const programs = this.dynamicStatusManager.getStatusTriggerEffects(status.id, 'threshold_execute');
      return programs.map(program => ({ holderId: holder.id, status: structuredClone(status), program: structuredClone(program) }));
    }));
    const previousActive = state.activeEnemyId;
    try {
      for (const entry of snapshot) {
        if (this.gameStateManager.isGameOver()) break;
        if (owner === 'enemy') {
          const current = this.gameStateManager.getEnemyById(entry.holderId);
          if (!current || current.currentHp <= 0 || !this.gameStateManager.setActiveEnemy(entry.holderId)) continue;
        }
        await this.executeEffectProgram(entry.program, owner === 'player', {
          triggerType: 'threshold_execute',
          statusContext: entry.status,
          ...(owner === 'enemy' ? { battleContext: { enemyId: entry.holderId } } : {}),
        });
      }
    } finally {
      if (previousActive) this.gameStateManager.setActiveEnemy(previousActive);
    }
  }

  public async processAbilitiesByTrigger(
    target: 'player' | 'enemy',
    trigger: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.triggerHost.processAbilitiesByTrigger(target, trigger, context);
  }

  public async processOrbPassives(target: 'player' | 'enemy'): Promise<void> {
    const ownerIsPlayer = target === 'player';
    const snapshot = [...(this.getEntity(target)?.orbs?.orbs || [])];
    for (const orb of snapshot) {
      if (this.gameStateManager.isGameOver()) break;
      const current = this.getEntity(target)?.orbs?.orbs.find(entry => entry.instanceId === orb.instanceId);
      if (!current || !current.passiveEffects?.length) continue;
      await this.executeEffectProgram(
        { spec: 'mwg.effect/v1', steps: structuredClone(current.passiveEffects) },
        ownerIsPlayer,
        {
          triggerType: 'orb_passive',
          orbValue: current.value,
          abilityContext: { id: current.instanceId, name: current.name, emoji: current.emoji, description: current.description },
        },
      );
    }
  }

  /** Execute a stable owner-local summon queue and skip units that die before their entry resolves. */
  public async processSummonActions(owner: 'player' | 'enemy'): Promise<void> {
    const ids = new Set(this.gameStateManager.getSummons(owner).map(unit => unit.instanceId));
    await this.activateSelectedSummons(ids);
  }

  public async processInitialStance(target: 'player' | 'enemy'): Promise<void> {
    const stance = this.getEntity(target)?.stance;
    if (!stance) return;
    this.gameStateManager.recordBattleEvent({
      kind: 'stance_changed',
      turn: this.gameStateManager.getGameState().currentTurn,
      phase: 'resolve',
      actorId: this.combatantJournalId(target),
      nextStanceId: stance.id,
      nextStanceName: stance.name,
      cause: {
        source: {
          kind: 'system',
          id: stance.source?.id || 'initial_stance',
          name: stance.source?.name || stance.name,
        },
      },
    });
    if (!stance.enterEffects?.length) return;
    await this.executeEffectProgram(
      { spec: 'mwg.effect/v1', steps: structuredClone(stance.enterEffects) },
      target === 'player',
      { triggerType: 'stance_enter', abilityContext: stance },
    );
  }

  private currentEffectSource(): { kind: EventSourceKind; id: string; name?: string } {
    const value =
      this.executionContext.cardContext || this.executionContext.relicContext ||
      this.executionContext.statusContext || this.executionContext.abilityContext || this.executionContext.summonContext ||
      this.executionContext.battleContext?.intent;
    const kind: EventSourceKind = this.executionContext.cardContext ? 'card'
      : this.executionContext.relicContext ? 'relic'
          : this.executionContext.statusContext ? 'status'
            : this.executionContext.abilityContext ? 'ability'
              : this.executionContext.summonContext ? 'summon'
                : this.executionContext.battleContext?.intent ? 'enemy_action' : 'system';
    return {
      kind,
      id: String(value?.templateId || value?.originalId || value?.id || value?.name || 'effect'),
      ...(value?.name ? { name: value.name } : {}),
    };
  }

  private combatantJournalId(owner: 'player' | 'enemy'): string {
    return owner === 'player' ? 'player' : this.gameStateManager.getGameState().activeEnemyId || 'enemy';
  }

  private recordSpecialEvent(
    owner: 'player' | 'enemy',
    draft: any,
  ): void {
    this.gameStateManager.recordBattleEvent({
      ...draft,
      turn: this.gameStateManager.getGameState().currentTurn,
      phase: 'resolve',
      actorId: draft.actorId || this.combatantJournalId(owner),
      cause: { source: this.currentEffectSource() },
    } as import('../../game-core').BattleEventDraft);
  }

  private async executeOrbEffects(orb: OrbInstance, owner: 'player' | 'enemy', phase: 'evoke' | 'passive'): Promise<void> {
    const effects = phase === 'evoke' ? orb.evokeEffects : orb.passiveEffects;
    if (!effects?.length) return;
    await this.executeEffectProgram(
      { spec: 'mwg.effect/v1', steps: structuredClone(effects) },
      owner === 'player',
      {
        triggerType: phase === 'evoke' ? 'orb_evoke' : 'orb_passive',
        orbValue: orb.value,
        abilityContext: { id: orb.instanceId, name: orb.name, emoji: orb.emoji, description: orb.description },
      },
    );
  }

  private async executeSpecialCombatCommand(
    command: Extract<EffectCommand, {
      type: 'set_stance' | 'channel_orb' | 'evoke_orbs' | 'set_orb_slots' | 'modify_orbs' | 'grant_extra_turn' | 'force_end_turn';
    }>,
    sourceIsPlayer: boolean,
  ): Promise<void> {
    const owner = command.target === 'self'
      ? (sourceIsPlayer ? 'player' : 'enemy')
      : (sourceIsPlayer ? 'enemy' : 'player');
    if (command.type === 'set_stance') {
      const current = this.getEntity(owner)?.stance || null;
      const next = command.stance
        ? ({ ...structuredClone(command.stance), source: this.currentEffectSource() } as Omit<ActiveStance, 'enteredTurn'>)
        : null;
      const same = current?.id && next?.id && current.id === next.id;
      if (same || (!current && !next)) return;
      if (current) {
        this.gameStateManager.setCombatantStance(owner, null);
        if (current.exitEffects?.length) {
          await this.executeEffectProgram(
            { spec: 'mwg.effect/v1', steps: structuredClone(current.exitEffects) }, owner === 'player',
            { triggerType: 'stance_exit', abilityContext: current },
          );
        }
      }
      if (next && !this.gameStateManager.isGameOver()) {
        this.gameStateManager.setCombatantStance(owner, next);
        if (next.enterEffects?.length) {
          await this.executeEffectProgram(
            { spec: 'mwg.effect/v1', steps: structuredClone(next.enterEffects) }, owner === 'player',
            { triggerType: 'stance_enter', abilityContext: next },
          );
        }
      }
      this.recordSpecialEvent(owner, {
        kind: 'stance_changed',
        ...(current?.id ? { previousStanceId: current.id } : {}),
        ...(next?.id ? { nextStanceId: next.id, nextStanceName: next.name } : {}),
      });
      this.presentation.addLog(`${owner === 'player' ? '我方' : '敌方'}姿态：${next?.name || '无'}`, 'info');
      return;
    }
    if (command.type === 'channel_orb') {
      const orb = command.orb;
      const result = this.gameStateManager.channelCombatantOrb(owner, {
        ...structuredClone(orb),
        value: Number(orb.value),
        source: this.currentEffectSource(),
      });
      if (!result.accepted) {
        this.presentation.addLog(`${owner === 'player' ? '我方' : '敌方'}没有可用 Orb 槽位`, 'system');
        return;
      }
      if (result.evicted) {
        this.recordSpecialEvent(owner, {
          kind: 'orb_evoked', orbInstanceId: result.evicted.instanceId, orbId: result.evicted.id,
          orbName: result.evicted.name, value: result.evicted.value,
        });
        await this.executeOrbEffects(result.evicted, owner, 'evoke');
      }
      const added = result.container.orbs.at(-1);
      if (added) this.recordSpecialEvent(owner, {
        kind: 'orb_channeled', orbInstanceId: added.instanceId, orbId: added.id, orbName: added.name, value: added.value,
      });
      this.presentation.addLog(`${owner === 'player' ? '我方' : '敌方'}充能 Orb：${orb.name}`, 'info');
      return;
    }
    if (command.type === 'evoke_orbs') {
      const result = this.gameStateManager.removeCombatantOrbs(owner, command.selector);
      for (const orb of result.selected) {
        this.recordSpecialEvent(owner, {
          kind: 'orb_evoked', orbInstanceId: orb.instanceId, orbId: orb.id, orbName: orb.name, value: orb.value,
        });
        await this.executeOrbEffects(orb, owner, 'evoke');
        if (this.gameStateManager.isGameOver()) break;
      }
      return;
    }
    if (command.type === 'set_orb_slots') {
      const result = this.gameStateManager.setCombatantOrbSlots(owner, command.amount);
      for (const orb of result.overflow) {
        this.recordSpecialEvent(owner, {
          kind: 'orb_evoked', orbInstanceId: orb.instanceId, orbId: orb.id, orbName: orb.name, value: orb.value,
        });
        await this.executeOrbEffects(orb, owner, 'evoke');
        if (this.gameStateManager.isGameOver()) break;
      }
      return;
    }
    if (command.type === 'modify_orbs') {
      const result = this.gameStateManager.modifyCombatantOrbValues(owner, command.selector, command.operator, command.value);
      for (const change of result.changed) this.recordSpecialEvent(owner, {
        kind: 'orb_value_changed', orbInstanceId: change.after.instanceId, orbId: change.after.id,
        previousValue: change.before.value, nextValue: change.after.value,
      });
      return;
    }
    if (command.type === 'grant_extra_turn') {
      this.gameStateManager.queueExtraTurns(owner, command.amount);
      this.recordSpecialEvent(owner, { kind: 'turn_control_changed', action: 'extra_turn', amount: command.amount });
      return;
    }
    this.gameStateManager.requestForceEndTurn(owner);
    this.recordSpecialEvent(owner, { kind: 'turn_control_changed', action: 'force_end', amount: 1 });
  }

  private summonJournalOwner(owner: 'player' | 'enemy'): string {
    return owner === 'player' ? 'player' : this.combatantJournalId('enemy');
  }

  private summonSource(unit: SummonUnit): { kind: 'summon'; id: string; name: string; ownerId: string } {
    return {
      kind: 'summon',
      id: unit.instanceId,
      name: unit.name,
      ownerId: this.summonJournalOwner(unit.owner),
    };
  }

  private recordSummonDefeat(unit: SummonUnit, reason: 'damage' | 'replace' | 'dismiss'): void {
    this.gameStateManager.recordBattleEvent({
      turn: this.gameStateManager.getGameState().currentTurn,
      phase: 'after',
      kind: 'summon_defeated',
      actorId: this.combatantJournalId(this.executionContext.sourceIsPlayer ? 'player' : 'enemy'),
      summonId: unit.instanceId,
      ownerId: this.summonJournalOwner(unit.owner),
      reason,
      cause: { source: this.currentEffectSource() },
    });
  }

  private async activateSelectedSummons(selectedIds: ReadonlySet<string>): Promise<void> {
    const queue = [
      ...this.gameStateManager.getSummonActionQueue('player'),
      ...this.gameStateManager.getSummonActionQueue('enemy'),
    ]
      .filter(entry => selectedIds.has(entry.summonId))
      .sort((left, right) =>
        right.priority - left.priority || right.speed - left.speed ||
        left.createdSequence - right.createdSequence || left.actionIndex - right.actionIndex,
      );
    for (const entry of queue) {
      if (this.gameStateManager.isGameOver()) break;
      const unit = this.gameStateManager.getSummonById(entry.summonId);
      if (!unit || (unit.hasHp !== false && unit.currentHp <= 0) || unit.capabilities?.acts === false) continue;
      const action = resolveSummonAction(unit, () => this.gameStateManager.nextRandom());
      if (!action) continue;
      this.gameStateManager.recordBattleEvent({
        turn: this.gameStateManager.getGameState().currentTurn,
        phase: 'resolve',
        kind: 'summon_acted',
        actorId: unit.instanceId,
        summonId: unit.instanceId,
        actionIndex: entry.actionIndex,
        cause: { source: this.summonSource(unit) },
      });
      this.presentation.addLog(`${unit.name}发动${action.name}`, 'action', {
        type: 'ability', name: action.name, details: action.description || unit.description,
      });
      this.presentation.showSummonAction(unit, action);
      await this.executeEffectProgram(action.effectProgram, unit.owner === 'player', {
        triggerType: 'summon_action',
        summonContext: unit,
        summonEffectFixed: action.fixed === true,
        abilityContext: action,
      });
    }
  }

  private async executeSummonCommand(
    command: Extract<EffectCommand, {
      type:
        | 'spawn_summon' | 'damage_summons' | 'heal_summons' | 'modify_summons' | 'modify_summon_effects'
        | 'gain_summon_resource' | 'set_summon_resource' | 'apply_summon_status'
        | 'remove_summon_status' | 'activate_summons' | 'dismiss_summons' | 'copy_summons';
    }>,
    sourceIsPlayer: boolean,
  ): Promise<void> {
    const sourceOwner = sourceIsPlayer ? 'player' : 'enemy';
    if (command.type === 'spawn_summon') {
      const owner = command.target === 'self'
        ? sourceOwner
        : sourceOwner === 'player' ? 'enemy' : 'player';
      const capacity = this.resolveSummonCapacity(owner, command.capacity);
      const result = this.gameStateManager.spawnSummons(
        owner, command.summon, command.count, capacity, command.overflow,
      );
      for (const replaced of result.replaced) {
        await this.triggerHost.processSummonUnitAbilities(replaced, 'defeated', {
          summonId: replaced.instanceId,
          reason: 'overflow',
        });
        this.recordSummonDefeat(replaced, 'replace');
        this.presentation.addLog(`${replaced.name}被新召唤物挤出战场并视为被击杀`, 'damage', {
          type: 'ability', name: replaced.name, details: replaced.description,
        });
      }
      for (const unit of result.spawned) {
        this.gameStateManager.recordBattleEvent({
          turn: this.gameStateManager.getGameState().currentTurn,
          phase: 'resolve',
          kind: 'summon_spawned',
          actorId: this.combatantJournalId(sourceOwner),
          summonId: unit.instanceId,
          summonTemplateId: unit.templateId,
          ownerId: this.summonJournalOwner(unit.owner),
          cause: { source: this.currentEffectSource() },
        });
        this.presentation.addLog(`${owner === 'player' ? '我方' : '敌方'}召唤${unit.name}`, 'action', {
          type: 'ability', name: unit.name, details: unit.description,
        });
        await this.triggerHost.processSummonUnitAbilities(unit, 'battle_start', {
          summonId: unit.instanceId,
        });
      }
      return;
    }

    const selected = await this.selectSummons(command.selector, sourceOwner, sourceIsPlayer);
    const ids = selected.map(unit => unit.instanceId);
    if (command.type === 'damage_summons') {
      const result = this.gameStateManager.damageSummons(ids, command.amount);
      for (const hit of result.hits) {
        const unit = selected.find(entry => entry.instanceId === hit.summonId);
        if (!unit) continue;
        this.presentation.addLog(
          `${unit.name}受到${hit.hpLost}点伤害${hit.blocked > 0 ? `（格挡${hit.blocked}）` : ''}${hit.defeated ? '并倒下' : ''}`,
          hit.defeated ? 'damage' : 'info',
          { type: 'ability', name: unit.name, details: unit.description },
        );
        if (hit.hpLost > 0) await this.triggerHost.processSummonUnitAbilities(unit, 'take_damage', {
          summonId: unit.instanceId,
          amount: hit.hpLost,
        });
        if (hit.defeated) await this.triggerHost.processSummonUnitAbilities(unit, 'defeated', {
          summonId: unit.instanceId,
        });
        if (hit.defeated) this.recordSummonDefeat(unit, 'damage');
      }
      return;
    }
    if (command.type === 'heal_summons') {
      const result = this.gameStateManager.healSummons(ids, command.amount);
      for (const change of result.changed) {
        const unit = selected.find(entry => entry.instanceId === change.summonId);
        const gained = roundBattleValue(change.nextHp - change.previousHp);
        if (unit && gained > 0) this.presentation.addLog(`${unit.name}恢复${gained}点生命`, 'heal', {
          type: 'ability', name: unit.name, details: unit.description,
        });
        if (unit && gained > 0) await this.triggerHost.processSummonUnitAbilities(unit, 'take_heal', {
          summonId: unit.instanceId,
          amount: gained,
        });
      }
      return;
    }
    if (command.type === 'modify_summons') {
      const operators = { add: '+', subtract: '-', multiply: '*', divide: '/', set: '=' } as const;
      this.gameStateManager.modifySummons(ids, command.stat, operators[command.operator], command.value);
      return;
    }
    if (command.type === 'modify_summon_effects') {
      this.gameStateManager.modifySummonEffects(ids, command.stat, command.operator, command.value);
      return;
    }
    if (command.type === 'gain_summon_resource' || command.type === 'set_summon_resource') {
      this.gameStateManager.updateSummonResources(
        ids, command.resource,
        command.type === 'gain_summon_resource' ? command.amount : command.value,
        command.type === 'gain_summon_resource' ? 'gain' : 'set',
      );
      return;
    }
    if (command.type === 'apply_summon_status') {
      const definition = this.dynamicStatusManager.getStatusDefinition(command.status);
      if (!definition) throw new Error(`召唤状态未注册: ${command.status}`);
      await this.triggerHost.applyStatusToSummons(ids, definition.id, command.stacks);
      return;
    }
    if (command.type === 'remove_summon_status') {
      await this.triggerHost.removeStatusesFromSummons(ids, command.status);
      return;
    }
    if (command.type === 'dismiss_summons') {
      const dismissed = this.gameStateManager.dismissSummons(ids, command.retainCorpse);
      for (const unit of dismissed) {
        await this.triggerHost.processSummonUnitAbilities(unit, 'defeated', {
          summonId: unit.instanceId,
          reason: 'dismiss',
        });
        this.recordSummonDefeat(unit, 'dismiss');
      }
      return;
    }
    if (command.type === 'copy_summons') {
      const groups = new Map<'player' | 'enemy', string[]>();
      for (const unit of selected) {
        const owner = command.targetOwner === 'same'
          ? unit.owner
          : command.targetOwner === 'self'
            ? sourceOwner
            : sourceOwner === 'player' ? 'enemy' : 'player';
        groups.set(owner, [...(groups.get(owner) || []), unit.instanceId]);
      }
      for (const [owner, targetIds] of groups) {
        const result = this.gameStateManager.copySummons(
          targetIds, owner, this.resolveSummonCapacity(owner, command.capacity), command.overflow,
        );
        for (const replaced of result.replaced) {
          await this.triggerHost.processSummonUnitAbilities(replaced, 'defeated', {
            summonId: replaced.instanceId,
            reason: 'copy_overflow',
          });
          this.recordSummonDefeat(replaced, 'replace');
        }
        for (const unit of result.copied) {
          this.gameStateManager.recordBattleEvent({
            turn: this.gameStateManager.getGameState().currentTurn,
            phase: 'resolve',
            kind: 'summon_spawned',
            actorId: this.combatantJournalId(sourceOwner),
            summonId: unit.instanceId,
            summonTemplateId: unit.templateId,
            ownerId: this.summonJournalOwner(unit.owner),
            cause: { source: this.currentEffectSource() },
          });
          this.presentation.addLog(`${unit.name}的复制体进入战场`, 'action', {
            type: 'ability', name: unit.name, details: unit.description,
          });
          await this.triggerHost.processSummonUnitAbilities(unit, 'battle_start', {
            summonId: unit.instanceId,
            reason: 'copy',
          });
        }
      }
      return;
    }
    await this.activateSelectedSummons(new Set(ids));
  }

  private async executeSummonerProgram(
    command: Extract<EffectCommand, { type: 'summoner_effects' }>,
    sourceIsPlayer: boolean,
  ): Promise<void> {
    if (!this.executionContext.summonContext)
      throw new Error('summoner_effects can only resolve from an active summon action, ability, or status');
    await this.executeEffectProgram(
      { spec: 'mwg.effect/v1', steps: structuredClone(command.effects) },
      sourceIsPlayer,
      { ...this.executionContext, summonSelfTargetsOwner: true },
    );
  }

  private resolveSummonCapacity(owner: 'player' | 'enemy', baseCapacity: number): number {
    let capacity = baseCapacity;
    for (const source of this.getDeclarativeModifierOperations(owner, 'summon_capacity_modifier')) {
      capacity = applyModifierOperation(capacity, source.operation);
    }
    const entity = owner === 'player' ? this.gameStateManager.getPlayer() : this.gameStateManager.getEnemy();
    const directCapacity = entity?.modifiers?.summon_capacity_modifier;
    if (typeof directCapacity === 'number' && directCapacity !== 0) capacity += directCapacity;
    return Math.max(1, Math.floor(Number.isFinite(capacity) ? capacity : baseCapacity));
  }

  private async selectSummons(
    selector: import('../../game-core').SummonSelector,
    sourceOwner: 'player' | 'enemy',
    sourceIsPlayer: boolean,
  ): Promise<SummonUnit[]> {
    if (selector.pick !== 'choose') return this.gameStateManager.selectSummons(selector, sourceOwner);
    const candidates = this.gameStateManager.selectSummons(
      { ...selector, pick: 'all', count: undefined }, sourceOwner,
    );
    if (candidates.length === 0) return [];
    const required = Math.min(candidates.length, Math.max(1, Math.floor(Number(selector.count) || 1)));
    // Enemy-authored decisions must not ask the player to operate the enemy AI.
    if (!sourceIsPlayer) return candidates.slice(0, required);
    const selectedIds = await TavernSummonChoicePresenter.getInstance().choose(candidates, required);
    if (selectedIds === null) throw new Error('召唤物选择已取消');
    const selected = new Set(selectedIds);
    return candidates.filter(unit => selected.has(unit.instanceId));
  }

  /**
   * Adds fully independent opponents to the current encounter. This is used by
   * reinforcements and defeated-passive splitting; it deliberately reuses the
   * initial MVU enemy adapter so spawned actions and passives obey one contract.
   */
  private async executeEnemyCommand(
    command: Extract<EffectCommand, { type: 'spawn_enemy' }>,
    _sourceIsPlayer: boolean,
  ): Promise<void> {
    if (command.count <= 0) return;
    const state = this.gameStateManager.getGameState();
    const living = this.gameStateManager.getEnemies({ livingOnly: true });
    const allKnown = [
      ...this.gameStateManager.getEnemies(),
      ...(state.defeatedEnemies || []),
    ];
    const liveSlots = Math.max(0, Math.min(12, command.capacity) - living.length);
    const lifetimeSlots = Math.max(0, 64 - allKnown.length);
    const amount = Math.min(Math.floor(command.count), liveSlots, lifetimeSlots);
    if (amount <= 0) {
      this.presentation.addLog('敌方增援未能进入战场：敌人容量已满', 'system');
      return;
    }

    const existingIds = new Set(allKnown.map(enemy => enemy.id));
    const spawned: Enemy[] = [];
    for (let index = 0; index < amount; index += 1) {
      const authored = structuredClone(command.enemy) as unknown as Record<string, unknown>;
      const runtimeId = allocateRuntimeId(String(authored.id || 'enemy'), existingIds);
      existingIds.add(runtimeId);
      authored.id = runtimeId;
      const enemy = convertMvuEnemy(authored, () => this.gameStateManager.nextRandom(), { fallbackId: runtimeId });
      if (!enemy) throw new Error(`spawn_enemy definition could not be compiled: ${String(command.enemy.id)}`);
      spawned.push(enemy);
    }
    if (spawned.length === 0) return;

    const currentEnemies = this.gameStateManager.getEnemies();
    const previousActiveId = state.activeEnemyId;
    const activeId = previousActiveId && currentEnemies.some(enemy => enemy.id === previousActiveId && enemy.currentHp > 0)
      ? previousActiveId
      : currentEnemies.find(enemy => enemy.currentHp > 0)?.id || spawned[0].id;
    this.gameStateManager.setEnemies([...currentEnemies, ...spawned], activeId);
    for (const enemy of spawned) {
      this.presentation.addLog(`敌方增援「${enemy.name}」进入战场`, 'action', {
        type: 'ability', name: enemy.name, details: enemy.dialogue,
      });
    }
    if (amount < Math.floor(command.count)) {
      this.presentation.addLog(`敌方增援受到容量限制：生成 ${amount}/${Math.floor(command.count)}`, 'system');
    }
  }

  /** Resolve ordinary `self` from summon actions, abilities, and held statuses to one exact unit. */
  private hasSummonSelfBinding(expectedOwner: 'player' | 'enemy'): boolean {
    if (this.executionContext.summonSelfTargetsOwner) return false;
    const contextSummon = this.executionContext.summonContext;
    const boundId = this.executionContext.summonStatusContext?.summonId || contextSummon?.instanceId;
    return Boolean(boundId && contextSummon && contextSummon.instanceId === boundId && contextSummon.owner === expectedOwner);
  }

  private activeSummonHolder(expectedOwner: 'player' | 'enemy'): SummonUnit | null {
    const contextSummon = this.executionContext.summonContext;
    const summonId = this.executionContext.summonStatusContext?.summonId || contextSummon?.instanceId;
    if (!summonId || !contextSummon || contextSummon.instanceId !== summonId || contextSummon.owner !== expectedOwner)
      return null;
    const current = this.gameStateManager.getSummonById(summonId);
    if (!current || (current.hasHp !== false && current.currentHp <= 0) || current.owner !== expectedOwner) return null;
    return current;
  }

  private applySummonStatusModifiers(
    amount: number,
    holder: SummonUnit,
    attributes: readonly BattleModifierAttribute[],
  ): number {
    const sources = this.summonModifierSources(holder);
    let result = amount;
    for (const attribute of attributes) {
      for (const source of sources[attribute] || []) result = applyModifierOperation(result, source.operation);
    }
    return Math.max(0, roundBattleValue(result));
  }

  private writeSummonStatusHolder(
    summonId: string,
    update: (holder: SummonUnit) => SummonUnit,
    event: string,
  ): void {
    const state = this.gameStateManager.readSummons();
    if (!state.living.some(unit => unit.instanceId === summonId)) return;
    this.gameStateManager.writeSummons({
      ...state,
      living: state.living.map(unit => unit.instanceId === summonId ? update(unit) : unit),
    }, event);
  }

  /**
   * Status trigger programs use the normal battle vocabulary. While a summon
   * owns the status, ordinary `self` mutations are rebound to that one holder.
   * This intentionally never resolves an owner-wide summon selector.
   */
  private async executeSummonStatusBattleCommand(command: BattleEffectCommand, holder: SummonUnit): Promise<void> {
    const id = holder.instanceId;
    if (command.type === 'damage') {
      const amount = this.applySummonStatusModifiers(
        command.amount,
        holder,
        ['damage_modifier', 'damage_taken_modifier'],
      );
      const result = this.gameStateManager.damageSummons([id], amount, command.bypassBlock === true);
      const hit = result.hits[0];
      if (hit?.defeated) this.recordSummonDefeat(holder, 'damage');
      return;
    }
    if (command.type === 'heal') {
      const amount = this.applySummonStatusModifiers(command.amount, holder, ['heal_modifier']);
      this.gameStateManager.healSummons([id], amount);
      return;
    }
    if (command.type === 'gain_block') {
      const amount = this.applySummonStatusModifiers(command.amount, holder, ['block_modifier']);
      this.gameStateManager.modifySummons([id], 'block', '+', amount);
      return;
    }
    if (command.type === 'gain_resource' || command.type === 'set_resource') {
      if (!holder.resources?.[command.resource])
        throw new Error(`summon ${id} does not define resource ${command.resource}`);
      this.gameStateManager.updateSummonResources(
        [id],
        command.resource,
        command.type === 'gain_resource' ? command.amount : command.value,
        command.type === 'gain_resource' ? 'gain' : 'set',
      );
      return;
    }
    if (command.type === 'gain_energy' || command.type === 'gain_lust') {
      const resource = command.type === 'gain_energy' ? 'energy' : 'lust';
      if (!holder.resources?.[resource]) throw new Error(`summon ${id} does not define resource ${resource}`);
      this.gameStateManager.updateSummonResources([id], resource, command.amount, 'gain');
      return;
    }
    if (command.type === 'set_stat') {
      if (command.stat === 'block') {
        this.gameStateManager.modifySummons([id], 'block', '=', command.value);
        return;
      }
      if (command.stat === 'energy' || command.stat === 'lust') {
        if (!holder.resources?.[command.stat])
          throw new Error(`summon ${id} does not define resource ${command.stat}`);
        this.gameStateManager.updateSummonResources([id], command.stat, command.value, 'set');
        return;
      }
      const nextHp = Math.max(0, Math.min(holder.maxHp, roundBattleValue(command.value)));
      if (nextHp < holder.currentHp) {
        const result = this.gameStateManager.damageSummons([id], holder.currentHp - nextHp, true);
        if (result.hits[0]?.defeated) this.recordSummonDefeat(holder, 'damage');
      } else if (nextHp > holder.currentHp) {
        this.gameStateManager.healSummons([id], nextHp - holder.currentHp);
      }
      return;
    }
    if (command.type === 'modify') {
      const attribute = MODIFIER_ATTRIBUTE_BY_STAT[command.stat];
      const operator = MODIFIER_SYMBOL_BY_OPERATOR[command.operator];
      const previous = holder.modifiers?.[attribute] || 0;
      const next = applyModifierOperation(previous, { operator, value: command.value });
      if (!Number.isFinite(next)) throw new Error('summon status modifier produced a non-finite value');
      this.writeSummonStatusHolder(id, unit => ({
        ...unit,
        modifiers: { ...(unit.modifiers || {}), [attribute]: roundBattleValue(next) },
      }), 'summon_modifier_updated');
      return;
    }
    if (command.type !== 'execute' && command.type !== 'kill')
      throw new Error(`unsupported summon status self command: ${command.type}`);
    const immune = command.excludeTags?.some((tag: string) => holder.tags?.includes(tag)) === true;
    const qualifies = command.type === 'kill' || (
      command.thresholdMode === 'hp'
        ? holder.currentHp <= command.threshold
        : holder.currentHp / holder.maxHp * 100 <= command.threshold
    );
    if (immune || !qualifies) return;
    const result = this.gameStateManager.damageSummons([id], holder.currentHp, true);
    if (result.hits[0]?.defeated) this.recordSummonDefeat(holder, 'damage');
  }

  private async executeModernBattleCommand(
    command: BattleEffectCommand,
    sourceIsPlayer: boolean,
    selectedEnemyId?: string,
  ): Promise<void> {
    const inferredDamageKind = this.executionContext.cardContext?.type === 'Attack'
      ? 'attack'
      : this.executionContext.triggerType === 'tick'
        ? 'damage_over_time'
        : this.executionContext.triggerType === 'summon_action' || (
            !sourceIsPlayer && this.executionContext.battleContext?.intent
          )
          ? 'attack'
          : 'effect';
    const damageKind = command.type === 'damage' && command.damageKind
      ? command.damageKind
      : inferredDamageKind;
    const source = sourceIsPlayer ? 'player' : 'enemy';
    const target = command.target === 'self' ? source : source === 'player' ? 'enemy' : 'player';
    if (command.target === 'self' && this.hasSummonSelfBinding(target)) {
      const summonHolder = this.activeSummonHolder(target);
      if (summonHolder) await this.executeSummonStatusBattleCommand(command, summonHolder);
      return;
    }
    const state = this.gameStateManager.getGameState();
    const resolvedEnemyId = target === 'enemy'
      ? selectedEnemyId || state.activeEnemyId || this.gameStateManager.getEnemy()?.id || null
      : null;
    const sourceEnemyId = source === 'enemy'
      ? this.executionContext.battleContext?.enemyId || state.activeEnemyId || this.gameStateManager.getEnemy()?.id || null
      : null;
    const eventSource = this.currentEffectSource();
    const actorId = source === 'player' ? 'player' : sourceEnemyId || 'enemy';
    const targetId = target === 'player' ? 'player' : resolvedEnemyId || 'enemy';
    const previousResolvedEnemyId = this.currentResolvedEnemyId;
    if (resolvedEnemyId) this.currentResolvedEnemyId = resolvedEnemyId;
    let effectiveCommand = command;
    if (command.type === 'gain_block' || command.type === 'gain_energy') {
      const rules = resolveActiveCardPlayRules(
        this.getCardPlayRules(target),
        this.gameStateManager.getGameState().cardRuleUsesThisTurn || 0,
      );
      const limit = command.type === 'gain_block' ? rules.blockGainLimit : rules.energyGainLimit;
      if (limit !== undefined) effectiveCommand = { ...command, amount: Math.min(command.amount, limit) };
    }
    let result;
    try {
      const summonModifiers = this.executionContext.summonContext && this.executionContext.summonEffectFixed !== true
        ? this.summonModifierSources(this.executionContext.summonContext)
        : undefined;
      result = await this.battleEffectRuntime.execute(effectiveCommand, {
        source,
        damageKind,
        triggerEventContext: {
          eventRecorded: false,
          turn: state.currentTurn,
          phase: 'resolve',
          sourceKind: eventSource.kind,
          sourceId: eventSource.id,
          actorId,
          targetId,
          eventJournal: state.eventJournal,
        },
        ...(summonModifiers ? { sourceModifierSources: summonModifiers } : {}),
        ...(sourceEnemyId ? { sourceEnemyId } : {}),
        ...(resolvedEnemyId ? { targetEnemyId: resolvedEnemyId } : {}),
      });
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

  private async forEachEnemyTarget(
    selector: EnemyTargetSelector,
    execute: (enemyId: string) => Promise<void>,
  ): Promise<void> {
    const previous = this.gameStateManager.getGameState().activeEnemyId;
    const executeTarget = async (enemyId: string): Promise<void> => {
      const enemy = this.gameStateManager.getEnemyById(enemyId);
      if (!enemy || enemy.currentHp <= 0 || !this.gameStateManager.setActiveEnemy(enemyId)) return;
      await execute(enemyId);
    };
    try {
      if (selector.mode === 'random_n' && selector.retarget === 'each_hit') {
        const selected = new Set<string>();
        let executed = 0;
        const availableAtStart = this.gameStateManager.getEnemies({ livingOnly: true }).length;
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
          executed += 1;
        }
        if (executed < selector.count) {
          this.reportEnemyTargetResolution({
            requestedCount: selector.count,
            availableCount: availableAtStart,
            resolvedCount: executed,
            complete: false,
            code: executed === 0 ? 'NO_LIVING_TARGETS' : 'INSUFFICIENT_TARGETS',
          });
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
      this.reportEnemyTargetResolution(resolved.resolution);
      for (const target of resolved.targets) await executeTarget(target.id);
    } finally {
      if (previous) this.gameStateManager.setActiveEnemy(previous);
    }
  }

  private reportEnemyTargetResolution(resolution: CombatantTargetResolution): void {
    if (resolution.complete) return;
    const detail = resolution.code === 'TARGET_NOT_FOUND' && resolution.targetId
      ? `指定目标 ${resolution.targetId} 不存在或已经退场`
      : resolution.code === 'NO_LIVING_TARGETS'
        ? '没有仍可作用的敌人目标'
        : `目标数量不足：需要 ${resolution.requestedCount}，实际 ${resolution.resolvedCount}`;
    this.presentation.addLog(detail, 'system');
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
    if (event.type === 'damage_resolved' || event.type === 'heal_resolved' || event.type === 'defeat_resolved') {
      const state = this.gameStateManager.getGameState();
      const actorId = this.executionContext.summonContext?.instanceId || (event.source === 'player'
        ? 'player'
        : this.executionContext.battleContext?.enemyId || state.activeEnemyId || state.enemy?.id || 'enemy');
      const targetId = event.target === 'player'
        ? 'player'
        : this.currentResolvedEnemyId || state.activeEnemyId || state.enemy?.id || 'enemy';
      const cause = { source: { ...this.currentEffectSource(), ownerId: actorId } } as const;
      if (event.type === 'defeat_resolved') {
        if (!event.succeeded) {
          this.presentation.addLog(
            event.excludedBy
              ? `目标具有“${event.excludedBy}”标签，免疫本次${event.method === 'kill' ? '击杀' : '处决'}`
              : `目标未达到${event.method === 'kill' ? '击杀' : '处决'}条件`,
            'info',
          );
          return;
        }
        this.gameStateManager.recordBattleEvent({
          turn: state.currentTurn,
          phase: 'resolve',
          kind: 'entity_defeated',
          cause,
          actorId,
          targetId,
          defeatKind: event.method,
          fatal: event.fatal,
        });
        this.presentation.addLog(
          `${event.target === 'player' ? '玩家' : '敌方'}被${event.method === 'kill' ? '直接击杀' : '处决'}`,
          'damage',
        );
      } else if (event.type === 'damage_resolved') {
        const target = event.target === 'player'
          ? state.player
          : this.currentResolvedEnemyId
            ? this.gameStateManager.getEnemyById(this.currentResolvedEnemyId)
            : state.enemy;
        const damageEvent = this.gameStateManager.recordBattleEvent({
          turn: state.currentTurn,
          phase: 'resolve',
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
        if (damageEvent.ok && target && target.currentHp <= 0) {
          this.gameStateManager.recordBattleEvent({
            turn: state.currentTurn,
            phase: 'after',
            kind: 'entity_defeated',
            cause: { ...cause, parentEventId: damageEvent.event.id, rootEventId: damageEvent.event.cause.rootEventId },
            actorId,
            targetId,
            fatalSourceEventId: damageEvent.event.id,
            defeatKind: 'damage',
            fatal: true,
          });
        }
      } else {
        this.gameStateManager.recordBattleEvent({
          turn: state.currentTurn,
          phase: 'resolve',
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
    if (event.type === 'summon_intercepted') {
      const state = this.gameStateManager.getGameState();
      const actorId = this.executionContext.summonContext?.instanceId || (event.source === 'player'
        ? 'player'
        : this.executionContext.battleContext?.enemyId || state.activeEnemyId || state.enemy?.id || 'enemy');
      const targetId = event.target === 'player'
        ? 'player'
        : this.currentResolvedEnemyId || state.activeEnemyId || state.enemy?.id || 'enemy';
      for (const hit of event.hits) {
        const unit = this.gameStateManager.getSummonById(hit.summonId);
        this.gameStateManager.recordBattleEvent({
          turn: state.currentTurn,
          phase: 'resolve',
          kind: 'summon_intercepted',
          actorId,
          targetId,
          summonId: hit.summonId,
          blocked: hit.blocked,
          hpLost: hit.hpLost,
          defeated: hit.defeated,
          cause: { source: this.currentEffectSource() },
        });
        this.presentation.addLog(
          `${unit?.name || '召唤单位'}拦截了${hit.blocked + hit.hpLost}点攻击${hit.defeated ? '并倒下' : ''}`,
          hit.defeated ? 'damage' : 'info',
          { type: 'ability', name: unit?.name || '召唤单位', details: unit?.description },
        );
        if (hit.defeated) this.gameStateManager.recordBattleEvent({
          turn: state.currentTurn,
          phase: 'after',
          kind: 'summon_defeated',
          actorId,
          summonId: hit.summonId,
          ownerId: event.target,
          reason: 'damage',
          cause: { source: this.currentEffectSource() },
        });
      }
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
    if (event.type === 'resource_changed') {
      const entity = this.getEntity(event.target);
      const definition = entity?.resources?.[event.resource];
      const state = this.gameStateManager.getGameState();
      const actorId = this.executionContext.summonContext?.instanceId || (this.executionContext.sourceIsPlayer
        ? 'player'
        : this.executionContext.battleContext?.enemyId || state.activeEnemyId || state.enemy?.id || 'enemy');
      const targetId = event.target === 'player'
        ? 'player'
        : this.currentResolvedEnemyId || state.activeEnemyId || state.enemy?.id || 'enemy';
      this.gameStateManager.recordBattleEvent({
        turn: state.currentTurn,
        phase: 'resolve',
        kind: 'resource_changed',
        actorId,
        targetId,
        resource: event.resource,
        previousValue: event.previousValue,
        nextValue: event.nextValue,
        change: event.change,
        cause: { source: this.currentEffectSource() },
      });
      this.presentation.addLog(
        `${event.target === 'player' ? '我方' : '敌方'}${definition?.name || event.resource}：${event.previousValue} → ${event.nextValue}`,
        'info',
      );
      this.presentation.showResourceChange(
        event.target,
        definition?.emoji || '◆',
        roundBattleValue(event.nextValue - event.previousValue),
      );
      if (event.target === 'player') {
        this.presentation.refreshPlayerEnergy(
          this.gameStateManager.getPlayer(),
          cardId => this.cardSystem.previewCardPlay(cardId),
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
      } else if (event.attribute === 'block' && change !== 0) {
        this.presentation.showBlockChange(event.target, change);
      } else if (event.attribute === 'energy' && change !== 0) {
        this.presentation.showEnergyChange(event.target, change);
        if (event.target === 'player') this.presentation.refreshPlayerEnergy(
          this.gameStateManager.getPlayer(),
          cardId => this.cardSystem.previewCardPlay(cardId),
        );
      } else if (event.attribute === 'energy' && event.target === 'player') {
        this.presentation.refreshPlayerEnergy(
          this.gameStateManager.getPlayer(),
          cardId => this.cardSystem.previewCardPlay(cardId),
        );
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
    if (state.player.stance?.passiveEffects?.length) addPassive([{
      id: state.player.stance.id, name: state.player.stance.name, trigger: 'passive',
      effectProgram: { spec: 'mwg.effect/v1', steps: state.player.stance.passiveEffects },
    }], 'player', '姿态');
    if (state.enemy?.stance?.passiveEffects?.length) addPassive([{
      id: state.enemy.stance.id, name: state.enemy.stance.name, trigger: 'passive',
      effectProgram: { spec: 'mwg.effect/v1', steps: state.enemy.stance.passiveEffects },
    }], 'enemy', '姿态');

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

  private summonModifierSources(
    summon: SummonUnit,
  ): Partial<Record<BattleModifierAttribute, Array<{ operation: ModifierOperation; name: string; stacks?: number }>>> {
    const attributes: BattleModifierAttribute[] = [
      'damage_modifier', 'damage_taken_modifier', 'lust_damage_modifier',
      'lust_damage_taken_modifier', 'heal_modifier', 'block_modifier',
    ];
    const result: Partial<Record<BattleModifierAttribute, Array<{ operation: ModifierOperation; name: string; stacks?: number }>>> = {};
    for (const attribute of attributes) {
      const sources: Array<{ operation: ModifierOperation; name: string; stacks?: number }> = [];
      const direct = summon.modifiers?.[attribute];
      if (typeof direct === 'number' && direct !== 0) {
        sources.push({ operation: { operator: '+', value: direct }, name: summon.name });
      }
      const coreState = this.createCoreEffectState(summon.owner === 'player');
      for (const status of summon.statusEffects || []) {
        const definition = this.dynamicStatusManager.getStatusDefinition(status.id);
        if (!definition) continue;
        for (const operation of resolveStatusHoldModifierOperations(
          definition.triggers.hold,
          summon.owner,
          summon.owner,
          attribute,
          coreState,
          status.stacks,
        )) sources.push({ operation, name: status.name, stacks: status.stacks });
      }
      result[attribute] = sources;
    }
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

  private createCoreEffectState(sourceIsPlayer: boolean, summonHolder?: SummonUnit): CoreEffectState {
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
      resources: Object.fromEntries(Object.entries(entity?.resources || {}).map(([id, resource]) => [id, resource.current])),
      maxResources: Object.fromEntries(Object.entries(entity?.resources || {}).map(([id, resource]) => [id, resource.max])),
    });
    const player = toCore(state.player, true);
    const boundEnemyId = typeof this.executionContext.battleContext?.enemyId === 'string'
      ? this.executionContext.battleContext.enemyId
      : null;
    const boundEnemy = boundEnemyId ? this.gameStateManager.getEnemyById(boundEnemyId) : null;
    const enemy = toCore(boundEnemy || state.enemy, false);
    const currentSummon = summonHolder
      ? this.gameStateManager.getSummonById(summonHolder.instanceId)
      : null;
    const summon = currentSummon ? {
      hp: currentSummon.currentHp,
      maxHp: currentSummon.maxHp,
      lust: currentSummon.resources?.lust?.current || 0,
      maxLust: currentSummon.resources?.lust?.max || 0,
      energy: currentSummon.resources?.energy?.current || 0,
      maxEnergy: currentSummon.resources?.energy?.max || 0,
      block: currentSummon.block || 0,
      statusStacks: Object.fromEntries((currentSummon.statusEffects || []).map(status => [status.id, status.stacks])),
      resources: Object.fromEntries(Object.entries(currentSummon.resources || {}).map(([id, resource]) => [id, resource.current])),
      maxResources: Object.fromEntries(Object.entries(currentSummon.resources || {}).map(([id, resource]) => [id, resource.max])),
      tags: [...(currentSummon.tags || [])],
    } : null;
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
      self: summon || (sourceIsPlayer ? player : enemy),
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
        lastCardType: state.eventJournal?.lastCardPlayed?.cardType,
        eventJournal: state.eventJournal,
      },
      enemyIntentValue: state.enemy?.intent?.value || 0,
      enemyIntentType: state.enemy?.intent?.type,
    };
  }

  private async processPendingDeaths(): Promise<void> {
    if (this.gameStateManager.isGameOver()) {
      this.pendingDeaths.clear();
      return;
    }
    if (this.pendingDeaths.has('player')) {
      await this.triggerHost.processAbilitiesByTrigger('player', 'defeated', {
        actorId: 'player', targetId: 'player', eventJournal: this.gameStateManager.getGameState().eventJournal,
      });
      if (this.gameStateManager.getPlayer().currentHp <= 0) {
        this.pendingDeaths.clear();
        await this.completeBattleEnd('defeat');
        return;
      }
      this.pendingDeaths.delete('player');
    }
    for (const enemyId of [...this.pendingDeaths]) {
      if (enemyId === 'player') continue;
      const enemy = this.gameStateManager.getEnemyById(enemyId);
      if (!enemy || enemy.currentHp > 0) {
        this.pendingDeaths.delete(enemyId);
        continue;
      }
      await this.triggerHost.processAbilitiesByTrigger('enemy', 'defeated', {
        enemyId,
        actorId: enemyId,
        targetId: enemyId,
        eventJournal: this.gameStateManager.getGameState().eventJournal,
      });
      const current = this.gameStateManager.getEnemyById(enemyId);
      if (current && current.currentHp <= 0) this.gameStateManager.updateEnemyById(enemyId, { currentHp: 0 });
      else this.pendingDeaths.delete(enemyId);
    }
    // Nested take-damage/gain-block/status programs get their own pending-death
    // set. They must never sweep a lethal entity that is still owned by the
    // outer damage program, otherwise its `defeated` abilities are skipped.
    const finalizedEnemyIds = [...this.pendingDeaths].filter(enemyId => enemyId !== 'player');
    const removedEnemies = this.gameStateManager.removeDefeatedEnemies(finalizedEnemyIds);
    const result = this.gameStateManager.getEnemies({ livingOnly: true }).length === 0 && removedEnemies.length > 0
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
    if (this.executionContext.summonContext) {
      const summon = this.executionContext.summonContext;
      return {
        entityName: summon.owner === 'player' ? '我方召唤单位' : '敌方召唤单位',
        sourceName: summon.name,
        logSource: { type: 'ability', name: summon.name, details: summon.description },
      };
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
