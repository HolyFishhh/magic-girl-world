import {
  addModifierOperation,
  allocateRuntimeId,
  applyModifierOperation,
  evaluateNumericExpression,
  evaluateConditionExpression,
  markPendingEnemyEscapes,
  createBattleRandomState,
  prepareEnemyActionQueue,
  createCombatantCollection,
  battleTriggerContextFromEvent,
  BattleEffectRuntime,
  resolveAttributeTriggerDispatch,
  resolvePassiveModifierOperations,
  resolvePassiveCardPlayRules,
  resolveActiveCardPlayRules,
  resolveEnemyTargets,
  resolveStatusHoldModifierOperations,
  resolveStatusHoldCardPlayRules,
  roundBattleDisplayValue,
  roundBattleValue,
  roundModifierBreakdown,
  resolvePlannedSummonAction,
  MODIFIER_ATTRIBUTE_BY_STAT,
  MODIFIER_SYMBOL_BY_OPERATOR,
  type BattleEffectCommand,
  type BattleEffectRuntimeEvent,
  type BattleEffectRuntimeContext,
  type BattleEffectRuntimeResult,
  type BattleEndResult,
  type BattleEntityType,
  type BattleModifierAttribute,
  type CardPlayRuleEvent,
  type Card,
  type BattleTriggerDispatch,
  type BattleTriggerEventContext,
  type BattleEventSource,
  type DamageKind,
  type CoreEffectState,
  type EffectCommand,
  type EffectProgram,
  type EnemyTargetSelector,
  type CombatantTargetResolution,
  type Enemy,
  type ModifierOperation,
  type NumericExpression,
  type Player,
  type ActiveStance,
  type OrbInstance,
  type EventSourceKind,
  type SummonUnit,
  type ScheduledEffectExecutionContext,
  type StatusLifecycleEvent,
} from '../../game-core';
import { TavernBattleEndHost } from '../core/battleEndHost';
import { TavernBattleTriggerHost } from '../core/battleTriggerHost';
import { TavernEffectCommandHost, type ResolvedEffectTarget } from '../core/effectCommandHost';
import { GameStateManager } from '../core/gameStateManager';
import { TavernRelicTriggerHost } from '../core/relicTriggerHost';
import { TavernBattleEffectPresenter } from '../ui/battleEffectPresenter';
import { TavernEffectChoicePresenter } from '../ui/effectChoicePresenter';
import { TavernCardSelectionHost } from '../core/cardSelectionHost';
import { TavernSummonChoicePresenter } from '../ui/summonChoicePresenter';
import { CardSystem } from './cardSystem';
import { DynamicStatusManager } from './dynamicStatusManager';
import { getAttributeDefinition } from './effectDefinitions';
import { convertMvuEnemy } from '../core/mvuBattleAdapter';

export interface ModernEffectExecutionContext {
  /** Prevent a repeated-summon program from recursively repeating itself. */
  summonRepeatIds?: string[];
  targetType?: 'player' | 'enemy';
  /** Internal stable target binding for nested effects such as lust overflow. */
  boundEnemyTargetId?: string;
  triggerType?: string;
  cardContext?: any;
  battleContext?: any;
  isRelicEffect?: boolean;
  relicContext?: any;
  statusContext?: any;
  spentEnergy?: number;
  /** Every resource actually paid by the current card resolution. */
  spentResources?: Readonly<Record<string, number>>;
  paidEnergy?: number;
  paidTotal?: number;
  paidResources?: Readonly<Record<string, number>>;
  /** X values resolved independently for every `all` cost component. */
  xValues?: Readonly<Record<string, number>>;
  /** Compatibility projection for the legacy energy-only X formula. */
  xValue?: number;
  orbValue?: number;
  /** Damage kind of the battle event currently being dispatched to listeners. */
  damageKind?: DamageKind;
  /** Canonical event identity forwarded by trigger dispatch, never inferred from sourceId. */
  kind?: string;
  statusId?: string;
  abilityContext?: any;
  /** Independent actor for summon action programs. */
  summonContext?: SummonUnit;
  /** Present only while a status held by this exact summon is resolving. */
  summonStatusContext?: { summonId: string };
  /** Fixed summon actions/abilities deliberately ignore summon-output amplification. */
  summonEffectFixed?: boolean;
  /** Explicit nested summon program whose ordinary self is the owning combatant. */
  summonSelfTargetsOwner?: boolean;
  /** Original identity retained when an effect resumes from the scheduler. */
  scheduledSource?: { kind: EventSourceKind; id: string; name?: string };
  setCardDestination?: (destination: import('../../game-core').PlayedCardDestination) => void;
  /** Present only during a direct card resolution; replayed resolutions receive a no-op callback. */
  requestCurrentReplay?: (count: number) => void;
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
  private pendingDeathDetails = new Map<string, {
    actorId: string;
    source: BattleEventSource;
    method: 'damage' | 'execute' | 'kill';
    fatal: boolean;
    fatalSourceEventId?: string;
  }>();
  /** Entity-level locks prevent true self recursion without suppressing another enemy's overflow. */
  private readonly activeLustOverflows = new Set<string>();
  private currentResolvedEnemyId: string | null = null;
  /** Nested triggers and auto-play remain part of one outer effect resolution. */
  private effectProgramDepth = 0;
  private choiceSequence = 0;
  /** Nested guardian hits must not recursively redistribute the same damage transaction. */
  private resolvingDamageProtection = false;

  private constructor() {
    this.relicTriggerHost.configureExecutionPorts({
      executeProgram: (program, context) => this.executeEffectProgram(program, true, context),
    });
    this.battleEffectRuntime = new BattleEffectRuntime(this.gameStateManager, {
      readModifierSources: (target, modifier) => this.getDeclarativeModifierOperations(target, modifier),
      recordResolvedEvent: event => this.recordResolvedBattleEffectEvent(event),
      dispatchTriggers: dispatches => this.dispatchBattleTriggers(dispatches),
      handleLustOverflow: (target, context) => this.handleLustOverflow(target, context),
      capDamageByStatus: async request => {
        const entity = request.target === 'player'
          ? this.gameStateManager.getPlayer()
          : (request.targetEnemyId ? this.gameStateManager.getEnemyById(request.targetEnemyId) : this.gameStateManager.getEnemy());
        if (!entity) return request.amount;
        const caps = entity.statusEffects
          .map(status => this.dynamicStatusManager.getStatusDefinition(status.id)?.defense?.damage_cap)
          .filter((cap): cap is number => cap !== undefined);
        return caps.length ? Math.min(request.amount, ...caps) : request.amount;
      },
      preventHpLossByStatus: async request => {
        const entity = request.target === 'player'
          ? this.gameStateManager.getPlayer()
          : (request.targetEnemyId ? this.gameStateManager.getEnemyById(request.targetEnemyId) : this.gameStateManager.getEnemy());
        const defender = entity?.statusEffects.find(status => this.dynamicStatusManager.getStatusDefinition(status.id)?.defense?.prevent_hp_loss);
        if (!defender) return false;
        const bound = request.target === 'enemy' && !!request.targetEnemyId && this.gameStateManager.beginEnemyResolution(request.targetEnemyId);
        try {
          return await this.triggerHost.consumeStatusLayer(request.target, defender.id);
        } finally {
          if (bound && request.targetEnemyId) this.gameStateManager.endEnemyResolution(request.targetEnemyId);
        }
      },
      retaliateAttackByStatus: async request => {
        const holder = request.target === 'player' ? this.gameStateManager.getPlayer() : (request.targetEnemyId ? this.gameStateManager.getEnemyById(request.targetEnemyId) : this.gameStateManager.getEnemy());
        if (!holder) return;
        for (const status of holder.statusEffects) {
          const rule = this.dynamicStatusManager.getStatusDefinition(status.id)?.defense?.retaliate_attack;
          const amount = rule === 'stacks' ? status.stacks : rule;
          if (!amount || amount <= 0) continue;
          if (request.sourceSummonId) {
            await this.damageSummonsWithDefense(
              [request.sourceSummonId], amount,
              { owner: request.target, ...(request.targetEnemyId ? { enemyId: request.targetEnemyId } : {}) },
              'retaliation', false,
            );
          } else {
            await this.executeModernBattleCommand(
              { type: 'damage', target: 'opponent', amount, damageKind: 'retaliation' },
              request.target === 'player',
              request.source === 'enemy' ? request.sourceEnemyId : { kind: 'player', id: 'player' },
              { ...(request.targetEnemyId ? { sourceEnemyId: request.targetEnemyId } : {}) },
            );
          }
        }
      },
      protectDamage: async request => this.protectEnemyDamage(request),
      interceptDamage: request => this.interceptDamageWithSummonDefense(request),
      present: event => this.presentBattleEffectRuntimeEvent(event),
    });
    this.effectCommandHost = new TavernEffectCommandHost({
      readState: sourceIsPlayer => this.createCoreEffectState(
        sourceIsPlayer,
        this.executionContext.summonSelfTargetsOwner ? undefined : this.executionContext.summonContext,
      ),
      isTerminal: () => this.gameStateManager.isGameOver(),
      executeCardCommand: async (command, resultContext) => {
        await this.cardSystem.executeCardEffectCommand(command, {
          discardResult: resultContext?.discardResult,
          currentCardId: this.executionContext.cardContext?.id,
          currentTurn: this.gameStateManager.getGameState().currentTurn,
          source: this.currentEffectSource(),
          sharedCardChoice: resultContext?.sharedCardChoice,
        });
      },
      presentCommand: command => this.presentModernCommand(command),
      executeBattleCommand: async (command, sourceIsPlayer, resolvedEnemyId) => {
        await this.executeModernBattleCommand(command, sourceIsPlayer, resolvedEnemyId);
      },
      executePersistentGrowth: (command, sourceIsPlayer) => this.executePersistentGrowth(command, sourceIsPlayer),
      executeSpecialCommand: async (command, sourceIsPlayer, resolvedEnemyId) => {
        // A selector is more specific than the triggering enemy's resolution
        // scope. Bind stance/姿态槽 mutations to that exact recipient, then
        // restore the original source scope for remaining effects.
        const bound = resolvedEnemyId ? this.gameStateManager.beginEnemyResolution(resolvedEnemyId) : false;
        try {
          if (resolvedEnemyId && !bound) return;
          await this.executeSpecialCombatCommand(command, sourceIsPlayer);
        } finally {
          if (resolvedEnemyId && bound) this.gameStateManager.endEnemyResolution(resolvedEnemyId);
        }
      },
      executeSummonCommand: (command, sourceIsPlayer, sharedChoice) =>
        this.executeSummonCommand(command, sourceIsPlayer, sharedChoice),
      executeEnemyCommand: (command, sourceIsPlayer) => this.executeEnemyCommand(command, sourceIsPlayer),
      executeSummonerProgram: (command, sourceIsPlayer) => this.executeSummonerProgram(command, sourceIsPlayer),
      forEachTarget: (selector, sourceIsPlayer, execute) => this.forEachTarget(selector, sourceIsPlayer, execute),
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
      runChoiceBranch: async execute => {
        const token = `effect-choice-${++this.choiceSequence}`;
        const deaths = new Set(this.pendingDeaths), details = new Map(this.pendingDeathDetails);
        const previousDestination = this.executionContext.setCardDestination;
        let destination: Parameters<NonNullable<typeof previousDestination>>[0] | undefined;
        this.gameStateManager.createSnapshot(token);
        if (previousDestination) this.executionContext.setCardDestination = next => { destination = next; };
        try {
          const result = await TavernCardSelectionHost.getInstance().withChoiceBranch(execute);
          if (destination !== undefined) previousDestination?.(destination);
          return result;
        } catch (error) {
          this.gameStateManager.restoreSnapshot(token);
          this.pendingDeaths = deaths; this.pendingDeathDetails = details;
          throw error;
        } finally {
          this.executionContext.setCardDestination = previousDestination;
          this.gameStateManager.deleteSnapshot(token);
        }
      },
    });
    this.triggerHost = new TavernBattleTriggerHost({
      executeProgram: (program, sourceIsPlayer, context) => this.executeEffectProgram(program, sourceIsPlayer, context),
      runRelic: (trigger, context) => this.relicTriggerHost.triggerRelics(trigger, { ...context }),
      recordStatusEvent: event => this.recordCombatantStatusEvent(event),
      recordSummonStatusEvent: event => this.recordSummonStatusEvent(event),
      addLog: (message, type = 'info', source) => this.presentation.addLog(message, type, source),
      logStatusEffect: (targetName, statusName, stacks, duration, isApply, emoji, enemyId) =>
        this.presentation.logStatusEffect(targetName, statusName, stacks, duration, isApply, emoji, enemyId),
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
    // Summon actions, listeners, nested programs and scheduled effects all enter
    // here. The persisted holder identity outranks incidental caller/selection context.
    const summon = context.summonContext;
    if (summon && context.summonSelfTargetsOwner && !this.hasLivingSummoner(summon)) return;
    const summonerId = summon?.owner === 'enemy' ? this.knownSummonerId(summon) : null;
    const boundSummoner = summonerId ? this.gameStateManager.beginEnemyResolution(summonerId) : false;
    if (summon?.owner === 'enemy') {
      context = { ...context, battleContext: { ...context.battleContext, enemyId: summonerId ?? undefined } };
    }
    const isOutermostResolution = this.effectProgramDepth === 0;
    this.effectProgramDepth += 1;
    const previousContext = this.executionContext;
    const previousPendingDeaths = this.pendingDeaths;
    const previousPendingDeathDetails = this.pendingDeathDetails;
    this.executionContext = { sourceIsPlayer, ...context };
    this.pendingDeaths = new Set();
    this.pendingDeathDetails = new Map();
    let completed = false;
    try {
      await this.effectCommandHost.executeProgram(program, sourceIsPlayer, context);
      await this.processPendingDeaths();
      completed = true;
    } catch (error) {
      this.pendingDeaths.clear();
      this.pendingDeathDetails.clear();
      throw error;
    } finally {
      if (boundSummoner && summonerId) this.gameStateManager.endEnemyResolution(summonerId);
      this.executionContext = previousContext;
      this.pendingDeaths = previousPendingDeaths;
      this.pendingDeathDetails = previousPendingDeathDetails;
      this.effectProgramDepth = Math.max(0, this.effectProgramDepth - 1);
      if (isOutermostResolution) {
        // Named bundles own their patches, so remove bundles first and then any
        // direct resolution-scoped patches left on cards in every battle pile.
        this.gameStateManager.advanceOwnedCardAttachments('resolution_end');
        this.gameStateManager.clearOwnedCardPatches('resolution_end');
        if (completed) this.refreshEnemyEscapeWarnings();
      }
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
  public getCoreEffectState(sourceIsPlayer = true, enemy?: Enemy): CoreEffectState {
    return this.createCoreEffectState(sourceIsPlayer, undefined, enemy);
  }

  /** Read an active summon formula against its live holder state without writing or drawing RNG. */
  public previewSummonActionAmount(summon: SummonUnit, amount: NumericExpression): number {
    return roundBattleValue(evaluateNumericExpression(
      amount,
      this.createCoreEffectState(summon.owner === 'player', summon, summon.owner === 'enemy'
        ? this.gameStateManager.getEnemyById(summon.summonerId || '') || undefined
        : undefined),
      { spentEnergy: 0 },
    ));
  }

  /** Mark newly satisfied escape conditions after a complete outer resolution. */
  public refreshEnemyEscapeWarnings(): void {
    if (this.gameStateManager.isGameOver()) return;
    const state = this.gameStateManager.getGameState();
    const previousActive = state.activeEnemyId;
    const marked = markPendingEnemyEscapes(
      this.gameStateManager.getEnemies({ livingOnly: true }),
      state.currentTurn + 2,
      enemy => {
        if (!enemy.escapeCondition) return false;
        this.gameStateManager.setActiveEnemy(enemy.id);
        try {
          return evaluateConditionExpression(
            enemy.escapeCondition,
            this.getCoreEffectState(false, enemy),
            { spentEnergy: 0 },
          );
        } catch {
          return false;
        }
      },
    );
    if (previousActive) this.gameStateManager.setActiveEnemy(previousActive);
    for (const enemy of marked) {
      const before = state.enemies?.find(value => value.id === enemy.id);
      if (!before || before.escapePending || !enemy.escapePending) continue;
      // updateEnemyById emits the existing state event consumed by battle UI.
      // Avoid a collection rewrite when no escape condition newly becomes true.
      this.gameStateManager.updateEnemyById(enemy.id, {
        escapePending: true,
        escapeReadyTurn: enemy.escapeReadyTurn,
        nextAction: null,
      });
    }
  }

  /**
   * Resolve continuous enemy ally protection inside the existing BattleEffectRuntime
   * damage transaction. Exact IDs are carried by targetEnemyId, never read from
   * the mutable active-enemy alias.
   */
  private async protectEnemyDamage(request: {
    source: 'player' | 'enemy'; target: 'player' | 'enemy'; amount: number;
    damageKind: DamageKind; sourceEnemyId?: string; sourceSummonId?: string; targetEnemyId?: string;
    sourceModifierSources?: BattleEffectRuntimeContext['sourceModifierSources'];
    bypassBlock?: boolean;
  }): Promise<{ remainingDamage: number; redirectedHpLost?: number }> {
    if (this.resolvingDamageProtection || request.target !== 'enemy' || request.damageKind !== 'attack' || !request.targetEnemyId) return { remainingDamage: request.amount };
    const target = this.gameStateManager.getEnemyById(request.targetEnemyId);
    if (!target || target.currentHp <= 0) return { remainingDamage: request.amount };
    const rules = this.gameStateManager.getEnemies({ livingOnly: true }).flatMap(holder => {
      const fromAbilities = (holder.abilities || []).flatMap(ability => ability.protection ? [{ holder, rule: ability.protection }] : []);
      const fromStatuses = holder.statusEffects.flatMap(status => {
        const rule = this.dynamicStatusManager.getStatusDefinition(status.id)?.protection;
        return rule ? [{ holder, rule }] : [];
      });
      return [...fromAbilities, ...fromStatuses];
    }).filter(entry => entry.rule.scope === 'all_allies' || entry.rule.targetId === target.id);
    const interceptorByHolder = new Map<string, { holder: Enemy; priority: number }>();
    for (const entry of rules.filter(entry => entry.rule.mode === 'intercept' && entry.holder.id !== target.id)) {
      const current = interceptorByHolder.get(entry.holder.id);
      const priority = entry.rule.priority || 0;
      if (!current || priority > current.priority) interceptorByHolder.set(entry.holder.id, { holder: entry.holder, priority });
    }
    const interceptors = [...interceptorByHolder.values()]
      .sort((a, b) => b.priority - a.priority || a.holder.id.localeCompare(b.holder.id));
    if (interceptors.length) {
      // Transfer sequentially just like summon interception: recipient-specific
      // mitigation and block absorb first; only post-mitigation overkill moves on.
      let remainingDamage = request.amount;
      let redirectedHpLost = 0;
      this.resolvingDamageProtection = true;
      try {
        for (const { holder } of interceptors) {
          if (remainingDamage <= 0 || (this.gameStateManager.getEnemyById(holder.id)?.currentHp ?? 0) <= 0) continue;
          const transferred = await this.executeModernBattleCommand(
            { type: 'damage', target: 'opponent', amount: remainingDamage, damageKind: 'attack' },
            request.source === 'player',
            holder.id,
            { sourceEnemyId: request.sourceEnemyId, sourceSummonId: request.sourceSummonId, sourceModifierSources: request.sourceModifierSources, skipSourceDamageModifiers: true, ...(request.bypassBlock ? { bypassBlock: true } : {}) },
          );
          if (!transferred?.applied) continue;
          redirectedHpLost = roundBattleValue(redirectedHpLost + (transferred.hpLost || 0));
          remainingDamage = Math.max(0, roundBattleValue(
            (transferred.modified ?? remainingDamage) - (transferred.blocked || 0) - (transferred.hpLost || 0),
          ));
        }
      } finally {
        this.resolvingDamageProtection = false;
      }
      return { remainingDamage, redirectedHpLost };
    }
    const shareRules = rules.filter(entry => entry.rule.mode === 'share_damage');
    if (!shareRules.length) return { remainingDamage: request.amount };
    const allAlliesShare = shareRules.some(entry => entry.rule.scope === 'all_allies');
    const sharers = allAlliesShare
      ? this.gameStateManager.getEnemies({ livingOnly: true })
      : [...new Map(shareRules.map(entry => [entry.holder.id, entry.holder])).values()];
    const recipients = allAlliesShare ? sharers : [target, ...sharers.filter(holder => holder.id !== target.id)];
    const each = roundBattleValue(request.amount / recipients.length);
    const targetAmount = roundBattleValue(request.amount - each * (recipients.length - 1));
    let redirectedHpLost = 0;
    this.resolvingDamageProtection = true;
    try {
      for (const holder of recipients) {
        if (holder.id === target.id) continue;
        const transferred = await this.executeModernBattleCommand(
          { type: 'damage', target: 'opponent', amount: each, damageKind: 'attack' },
          request.source === 'player',
          holder.id,
          { sourceEnemyId: request.sourceEnemyId, sourceSummonId: request.sourceSummonId, sourceModifierSources: request.sourceModifierSources, skipSourceDamageModifiers: true, ...(request.bypassBlock ? { bypassBlock: true } : {}) },
        );
        redirectedHpLost = roundBattleValue(redirectedHpLost + (transferred?.hpLost || 0));
      }
    } finally {
      this.resolvingDamageProtection = false;
    }
    return { remainingDamage: targetAmount, redirectedHpLost };
  }
  /** Current-state intent preview; never dispatches triggers or writes battle state. */
  public previewPlayerCardDamage(amount: NumericExpression, target: 'self' | 'opponent', damageKind?: DamageKind, payment?: import('../../game-core').CardResourcePayment): { base: number; value: number } {
    const enemy = this.gameStateManager.getEnemy();
    const previewState = this.createCoreEffectState(true, undefined, enemy || undefined);
    // Effects read the paid state; the preview must not spend real resources.
    if (payment?.affordable) {
      previewState.self.energy = Math.max(0, previewState.self.energy - payment.spentEnergy);
      for (const [id, spent] of Object.entries(payment.spent)) {
        if (id !== 'energy' && previewState.self.resources) previewState.self.resources[id] = Math.max(0, (previewState.self.resources[id] || 0) - spent);
      }
    }
    const base = roundBattleValue(evaluateNumericExpression(amount, previewState, { spentEnergy: payment?.spentEnergy || 0, spentResources: payment?.spent, xValues: payment?.xValues, xValue: payment?.xValue }));
    let value = base;
    if (damageKind !== 'hp_loss') {
      const recipient = target === 'self' ? 'player' : 'enemy';
      for (const [side, attribute] of [['player', 'damage_modifier'], [recipient, 'damage_taken_modifier']] as const) {
        for (const source of this.getDeclarativeModifierOperations(side, attribute, enemy || undefined)) {
          if (!source.operation.damageKind || source.operation.damageKind === (damageKind || 'attack')) value = applyModifierOperation(value, source.operation);
        }
        const entity = side === 'enemy' ? enemy : this.gameStateManager.getPlayer();
        const direct = entity?.modifiers?.[attribute];
        if (typeof direct === 'number' && direct !== 0) value = applyModifierOperation(value, { operator: '+', value: direct });
        value = roundBattleValue(value);
      }
    }
    return { base, value: Math.max(0, value) };
  }

  public previewEnemyIntentDamage(enemy: Enemy, amount: NumericExpression, target: 'self' | 'opponent', damageKind?: DamageKind): number {
    let value = roundBattleValue(evaluateNumericExpression(amount, this.createCoreEffectState(false, undefined, enemy), { spentEnergy: 0 }));
    if (damageKind === 'hp_loss') return Math.max(0, value);
    const targetSide = target === 'self' ? 'enemy' : 'player';
    for (const [side, attribute] of [['enemy', 'damage_modifier'], [targetSide, 'damage_taken_modifier']] as const) {
      for (const source of this.getDeclarativeModifierOperations(side, attribute, enemy)) {
        if (source.operation.damageKind && source.operation.damageKind !== (damageKind || 'attack')) continue;
        value = applyModifierOperation(value, source.operation);
      }
      const entity = side === 'enemy' ? enemy : this.gameStateManager.getPlayer();
      const direct = entity.modifiers?.[attribute];
      if (typeof direct === 'number' && direct !== 0) value = applyModifierOperation(value, { operator: '+', value: direct });
    }
    return Math.max(0, roundBattleValue(value));
  }

  private async scheduleEffectCommand(
    command: Extract<EffectCommand, { type: 'schedule_effect' }>,
    sourceIsPlayer: boolean,
  ): Promise<void> {
    const state = this.gameStateManager.getGameState();
    const source = this.currentEffectSource();
    const numericRecord = (value: Readonly<Record<string, number>> | undefined): Record<string, number> | undefined => {
      if (!value) return undefined;
      const entries = Object.entries(value).filter(([id, amount]) => id.trim() && Number.isFinite(amount));
      return entries.length ? Object.fromEntries(entries) : undefined;
    };
    const captured: ScheduledEffectExecutionContext = {
      ...(!sourceIsPlayer && !this.executionContext.summonContext
        ? {
            sourceEnemyId: this.executionContext.battleContext?.enemyId ||
              this.currentResolvedEnemyId || state.activeEnemyId || state.enemy?.id,
          }
        : {}),
      ...(this.executionContext.boundEnemyTargetId
        ? { boundEnemyTargetId: this.executionContext.boundEnemyTargetId }
        : {}),
      ...(this.executionContext.summonContext
        ? {
            summonInstanceId: this.executionContext.summonContext.instanceId,
            ...(this.executionContext.summonSelfTargetsOwner ? { summonSelfTargetsOwner: true } : {}),
          }
        : {}),
      ...(this.executionContext.statusContext?.id
        ? {
            statusContext: {
              id: String(this.executionContext.statusContext.id),
              ...(typeof this.executionContext.statusContext.name === 'string'
                ? { name: this.executionContext.statusContext.name }
                : {}),
              ...(typeof this.executionContext.statusContext.emoji === 'string'
                ? { emoji: this.executionContext.statusContext.emoji }
                : {}),
              ...(typeof this.executionContext.statusContext.description === 'string'
                ? { description: this.executionContext.statusContext.description }
                : {}),
              ...(typeof this.executionContext.statusContext.stacks === 'number' &&
                Number.isFinite(this.executionContext.statusContext.stacks)
                ? { stacks: this.executionContext.statusContext.stacks }
                : {}),
            },
          }
        : {}),
      ...(typeof this.executionContext.spentEnergy === 'number' && Number.isFinite(this.executionContext.spentEnergy)
        ? { spentEnergy: this.executionContext.spentEnergy }
        : {}),
      ...(numericRecord(this.executionContext.spentResources)
        ? { spentResources: numericRecord(this.executionContext.spentResources) }
        : {}),
      ...(numericRecord(this.executionContext.xValues)
        ? { xValues: numericRecord(this.executionContext.xValues) }
        : {}),
      ...(typeof this.executionContext.xValue === 'number' && Number.isFinite(this.executionContext.xValue)
        ? { xValue: this.executionContext.xValue }
        : {}),
      ...(typeof this.executionContext.orbValue === 'number' && Number.isFinite(this.executionContext.orbValue)
        ? { orbValue: this.executionContext.orbValue }
        : {}),
    };
    this.gameStateManager.scheduleEffect({
      source,
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
        ...(Object.keys(captured).length ? { context: captured } : {}),
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

  /**
   * Enemy passives that target the player are encounter-wide auras and every
   * living source participates. Rules targeting an enemy itself belong only to
   * the concrete active/resolved enemy; otherwise one unit's stance or status
   * would leak into every other unit in the roster.
   */
  private continuousEnemyHolders(target: BattleEntityType): Enemy[] {
    if (target === 'player') return this.gameStateManager.getEnemies({ livingOnly: true });
    const state = this.gameStateManager.getGameState();
    const id = this.currentResolvedEnemyId
      || (typeof this.executionContext.battleContext?.enemyId === 'string'
        ? this.executionContext.battleContext.enemyId
        : null)
      || state.activeEnemyId
      || state.enemy?.id;
    const enemy = id ? this.gameStateManager.getEnemyById(id) : this.gameStateManager.getEnemy();
    return enemy && enemy.currentHp > 0 ? [enemy] : [];
  }

  /** Collect continuous card-play rules from passive abilities, relics, and status hold programs. */
  public getCardPlayRules(target: BattleEntityType): CardPlayRuleEvent[] {
    const state = this.gameStateManager.getGameState();
    const result: CardPlayRuleEvent[] = [];
    const addPassive = (sources: any[] | undefined, owner: BattleEntityType, enemyHolder?: Enemy): void => {
      result.push(
        ...resolvePassiveCardPlayRules(
          sources,
          owner,
          target,
          this.createCoreEffectState(owner === 'player', undefined, enemyHolder),
        ).map(entry => entry.rule),
      );
    };
    addPassive(state.player.abilities, 'player');
    addPassive(state.player.relics, 'player');
    if (state.player.stance?.passiveEffects?.length) addPassive([{
      id: state.player.stance.id, name: state.player.stance.name, trigger: 'passive',
      effectProgram: { spec: 'mwg.effect/v1', steps: state.player.stance.passiveEffects },
    }], 'player');
    const enemyHolders = this.continuousEnemyHolders(target);
    for (const enemy of enemyHolders) {
      addPassive(enemy.abilities, 'enemy', enemy);
      if (enemy.stance?.passiveEffects?.length) addPassive([{
        id: enemy.stance.id, name: enemy.stance.name, trigger: 'passive',
        effectProgram: { spec: 'mwg.effect/v1', steps: enemy.stance.passiveEffects },
      }], 'enemy', enemy);
    }

    const addStatuses = (holder: Player | Enemy | null, holderType: BattleEntityType): void => {
      if (!holder) return;
      const coreState = this.createCoreEffectState(
        holderType === 'player',
        undefined,
        holderType === 'enemy' ? holder as Enemy : undefined,
      );
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
    enemyHolders.forEach(enemy => addStatuses(enemy, 'enemy'));
    return result;
  }

  public async processStatusEffectsAtActionTiming(
    target: 'player' | 'enemy',
    timing: import('../../game-core').StatusTickTiming,
    enemyId?: string,
  ): Promise<void> {
    await this.triggerHost.processStatusEffectsAtActionTiming(target, timing, enemyId);
  }

  public async processStatusEffectsAtTurnEnd(target: 'player' | 'enemy'): Promise<void> {
    await this.triggerHost.processStatusEffectsAtTurnEnd(target);
  }

  public async processSummonStatusEffectsAtActionTiming(
    summonId: string,
    timing: import('../../game-core').StatusTickTiming,
  ): Promise<void> {
    await this.triggerHost.processSummonStatusEffectsAtActionTiming(summonId, timing);
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

  public async processAllEnemyAbilitiesByTrigger(
    trigger: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.triggerHost.processAllEnemyAbilitiesByTrigger(trigger, context);
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

  public async processInitialStance(target: 'player' | 'enemy', enemyId?: string): Promise<void> {
    const stance = target === 'enemy' && enemyId
      ? this.gameStateManager.getEnemyById(enemyId)?.stance
      : this.getEntity(target)?.stance;
    if (!stance) return;
    this.gameStateManager.recordBattleEvent({
      kind: 'stance_changed',
      turn: this.gameStateManager.getGameState().currentTurn,
      phase: 'resolve',
      actorId: target === 'enemy' && enemyId ? enemyId : this.combatantJournalId(target),
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
      {
        triggerType: 'stance_enter',
        abilityContext: stance,
        ...(target === 'enemy' && enemyId ? { battleContext: { enemyId } } : {}),
      },
    );
  }

  private currentEffectSource(): { kind: EventSourceKind; id: string; name?: string } {
    if (this.executionContext.scheduledSource) return { ...this.executionContext.scheduledSource };
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
    return owner === 'player' ? 'player' : this.gameStateManager.getEnemy()?.id || 'enemy';
  }

  private currentActorId(owner: 'player' | 'enemy'): string {
    const summon = this.executionContext.summonContext;
    if (summon?.owner === owner) return summon.instanceId;
    if (owner === 'player') return 'player';
    const state = this.gameStateManager.getGameState();
    return this.executionContext.battleContext?.enemyId
      || state.activeEnemyId
      || state.enemy?.id
      || 'enemy';
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
      type: 'set_stance' | 'channel_orb' | 'evoke_orbs' | 'set_orb_slots' | 'modify_orbs' | 'grant_extra_turn' | 'force_end_turn' | 'replay_current';
    }>,
    sourceIsPlayer: boolean,
  ): Promise<void> {
    if (command.type === 'replay_current') {
      if (!this.executionContext.requestCurrentReplay) {
        throw new Error('replay_current 只允许用于当前正在结算的卡牌主效果');
      }
      this.executionContext.requestCurrentReplay(command.count);
      return;
    }
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
        this.presentation.addLog(`${owner === 'player' ? '我方' : '敌方'}没有可用姿态槽`, 'system');
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
      this.presentation.addLog(`${owner === 'player' ? '我方' : '敌方'}充能姿态：${orb.name}`, 'info');
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

  private knownSummonerId(unit: SummonUnit): string | null {
    if (unit.owner === 'player') return unit.summonerId === undefined || unit.summonerId === 'player' ? 'player' : null;
    return typeof unit.summonerId === 'string' && this.gameStateManager.getEnemyById(unit.summonerId)
      ? unit.summonerId : null;
  }

  private summonRecipientId(owner: 'player' | 'enemy', sourceOwner: 'player' | 'enemy'): string | null {
    if (owner === 'player') return 'player';
    if (sourceOwner === 'enemy') {
      return this.executionContext.summonContext
        ? this.knownSummonerId(this.executionContext.summonContext)
        : this.executionContext.battleContext?.enemyId || this.gameStateManager.getEnemy()?.id || null;
    }
    return this.executionContext.boundEnemyTargetId || this.currentResolvedEnemyId || this.gameStateManager.getEnemy()?.id || null;
  }

  private summonJournalOwner(unit: SummonUnit): string {
    if (unit.summonerId) return unit.summonerId;
    return unit.owner === 'player' && unit.summonerId === undefined ? 'player' : 'unknown:summoner';
  }

  private hasLivingSummoner(unit: SummonUnit): boolean {
    const summonerId = this.knownSummonerId(unit);
    const holder = summonerId === null ? null : unit.owner === 'player'
      ? this.gameStateManager.getPlayer() : this.gameStateManager.getEnemyById(summonerId);
    if (holder && holder.currentHp > 0) return true;
    this.presentation.addLog(`${unit.name}的主人${unit.summonerId ? '已不在场' : '身份未能确认'}，本次主人效果未执行。`, 'system');
    return false;
  }

  private summonSource(unit: SummonUnit): { kind: 'summon'; id: string; name: string; ownerId: string } {
    return {
      kind: 'summon',
      id: unit.instanceId,
      name: unit.name,
      ownerId: this.summonJournalOwner(unit),
    };
  }

  private recordSummonTransitionEvent(draft: any, actorId: string): BattleTriggerEventContext | undefined {
    const recorded = this.gameStateManager.recordBattleEvent({
      ...draft,
      turn: this.gameStateManager.getGameState().currentTurn,
      phase: 'resolve',
      actorId,
      cause: { source: { ...this.currentEffectSource(), ownerId: actorId } },
    } as import('../../game-core').BattleEventDraft);
    return recorded.ok ? battleTriggerContextFromEvent(recorded.event, recorded.state) : undefined;
  }

  private async dispatchSummonBlockTransition(
    unit: SummonUnit,
    previousValue: number,
    nextValue: number,
    sourceOwner: 'player' | 'enemy',
  ): Promise<void> {
    const change = roundBattleValue(nextValue - previousValue);
    if (change === 0) return;
    const actorId = this.currentActorId(sourceOwner);
    const eventContext = this.recordSummonTransitionEvent({
      kind: change > 0 ? 'block_gained' : 'block_lost',
      targetId: unit.instanceId,
      previousValue,
      nextValue,
      amount: Math.abs(change),
    }, actorId);
    await this.dispatchBattleTriggers(resolveAttributeTriggerDispatch({
      attribute: 'block',
      change,
      target: unit.owner,
      source: sourceOwner,
      eventContext,
    }));
  }

  private async dispatchSummonDamageTransition(
    unit: SummonUnit,
    hit: { requested: number; modified?: number; blocked: number; hpLost: number; defeated: boolean },
    sourceOwner: 'player' | 'enemy',
    damageKind: DamageKind = 'effect',
  ): Promise<void> {
    if (hit.blocked > 0) {
      await this.dispatchSummonBlockTransition(
        unit,
        unit.block || 0,
        Math.max(0, (unit.block || 0) - hit.blocked),
        sourceOwner,
      );
    }
    if (hit.hpLost > 0) {
      const actorId = this.currentActorId(sourceOwner);
      const eventContext = this.recordSummonTransitionEvent({
        kind: 'damage_resolved',
        targetId: unit.instanceId,
        damageKind,
        requested: hit.requested,
        modified: hit.modified ?? hit.requested,
        blocked: hit.blocked,
        hpLost: hit.hpLost,
        fatal: hit.defeated,
      }, actorId);
      await this.dispatchBattleTriggers(resolveAttributeTriggerDispatch({
        attribute: 'hp',
        change: -hit.hpLost,
        target: unit.owner,
        source: sourceOwner,
        eventContext,
      }));
    }
    if (hit.defeated) {
      await this.triggerHost.processAbilitiesByTrigger(unit.owner, 'defeated', {
        summonId: unit.instanceId,
        actorId: unit.instanceId,
        targetId: unit.instanceId,
        eventJournal: this.gameStateManager.getGameState().eventJournal,
      });
    }
  }

  private async dispatchSummonHealTransition(
    unit: SummonUnit,
    previousValue: number,
    nextValue: number,
    sourceOwner: 'player' | 'enemy',
  ): Promise<void> {
    const gained = roundBattleValue(nextValue - previousValue);
    if (gained <= 0) return;
    const actorId = this.currentActorId(sourceOwner);
    const eventContext = this.recordSummonTransitionEvent({
      kind: 'heal_resolved',
      targetId: unit.instanceId,
      requested: gained,
      hpGained: gained,
    }, actorId);
    await this.dispatchBattleTriggers(resolveAttributeTriggerDispatch({
      attribute: 'hp',
      change: gained,
      target: unit.owner,
      source: sourceOwner,
      eventContext,
    }));
  }

  private async dispatchSummonResourceTransition(
    unit: SummonUnit,
    resource: string,
    previousValue: number,
    nextValue: number,
    sourceOwner: 'player' | 'enemy',
    changeType: 'gain' | 'set',
  ): Promise<void> {
    const change = roundBattleValue(nextValue - previousValue);
    if (change === 0) return;
    const actorId = this.currentActorId(sourceOwner);
    if (resource === 'lust') {
      const eventContext = this.recordSummonTransitionEvent({
        kind: change > 0 ? 'lust_increased' : 'lust_decreased',
        targetId: unit.instanceId,
        previousValue,
        nextValue,
        amount: Math.abs(change),
      }, actorId);
      await this.dispatchBattleTriggers(resolveAttributeTriggerDispatch({
        attribute: 'lust',
        change,
        target: unit.owner,
        source: sourceOwner,
        eventContext,
      }));
      return;
    }
    this.recordSummonTransitionEvent({
      kind: 'resource_changed',
      targetId: unit.instanceId,
      resource,
      previousValue,
      nextValue,
      change: changeType,
    }, actorId);
  }

  private recordSummonDefeat(unit: SummonUnit, reason: 'damage' | 'replace' | 'dismiss'): void {
    this.gameStateManager.recordBattleEvent({
      turn: this.gameStateManager.getGameState().currentTurn,
      phase: 'after',
      kind: 'summon_defeated',
      actorId: this.combatantJournalId(this.executionContext.sourceIsPlayer ? 'player' : 'enemy'),
      summonId: unit.instanceId,
      ownerId: this.summonJournalOwner(unit),
      reason,
      cause: { source: this.currentEffectSource() },
    });
  }

  private async activateSelectedSummons(
    selectedIds: ReadonlySet<string>,
    suppliedAction?: { id: string; name: string; emoji?: string; description?: string; fixed?: boolean; effectProgram: EffectProgram },
  ): Promise<void> {
    if (suppliedAction) {
      const units = [...selectedIds].map(id => this.gameStateManager.getSummonById(id)).filter((unit): unit is SummonUnit => Boolean(unit))
        .filter(unit => (unit.hasHp === false || unit.currentHp > 0) && unit.capabilities?.acts !== false)
        .sort((left, right) => Number(right.actionPriority || 0) - Number(left.actionPriority || 0) ||
          Number(right.speed || 0) - Number(left.speed || 0) || left.createdSequence - right.createdSequence);
      for (const unit of units) {
        if (this.gameStateManager.isGameOver()) break;
        await this.processSummonStatusEffectsAtActionTiming(unit.instanceId, 'before_action');
        const current = this.gameStateManager.getSummonById(unit.instanceId);
        if (!current || (current.hasHp !== false && current.currentHp <= 0) || current.capabilities?.acts === false) continue;
        this.gameStateManager.recordBattleEvent({
          turn: this.gameStateManager.getGameState().currentTurn, phase: 'resolve', kind: 'summon_acted',
          actorId: current.instanceId, summonId: current.instanceId, actionIndex: 0, cause: { source: this.summonSource(current) },
        });
        this.presentation.addLog(`${current.name}奉命发动${suppliedAction.name}`, 'action', {
          type: 'ability', name: suppliedAction.name, details: suppliedAction.description || current.description,
        });
        await this.presentation.showSummonAction(current, { ...suppliedAction, emoji: suppliedAction.emoji || current.emoji });
        await this.executeEffectProgram(suppliedAction.effectProgram, current.owner === 'player', {
          triggerType: 'summon_action', summonContext: current, summonEffectFixed: suppliedAction.fixed === true,
          abilityContext: suppliedAction,
        });
        if (!this.gameStateManager.isGameOver()) {
          await this.presentation.waitForActionPresentation?.();
          await this.processSummonStatusEffectsAtActionTiming(current.instanceId, 'after_action');
        }
      }
      return;
    }
    this.gameStateManager.ensureSummonActionsPlanned([...selectedIds]);
    const queue = [
      ...this.gameStateManager.getSummonActionQueue('player'),
      ...this.gameStateManager.getSummonActionQueue('enemy'),
    ]
      .filter(entry => selectedIds.has(entry.summonId))
      // This is the autonomous queue used at turn boundaries. Commands with a
      // supplied action keep their separate priority/speed ordering above.
      .sort((left, right) => left.createdSequence - right.createdSequence || left.actionIndex - right.actionIndex);
    for (const entry of queue) {
      if (this.gameStateManager.isGameOver()) break;
      const unit = this.gameStateManager.getSummonById(entry.summonId);
      if (!unit || (unit.hasHp !== false && unit.currentHp <= 0) || unit.capabilities?.acts === false) continue;
      await this.processSummonStatusEffectsAtActionTiming(unit.instanceId, 'before_action');
      const current = this.gameStateManager.getSummonById(entry.summonId);
      if (!current || (current.hasHp !== false && current.currentHp <= 0) || current.capabilities?.acts === false) continue;
      const action = resolvePlannedSummonAction(current, entry.actionIndex);
      if (!action) continue;
      this.gameStateManager.recordBattleEvent({
        turn: this.gameStateManager.getGameState().currentTurn,
        phase: 'resolve',
        kind: 'summon_acted',
        actorId: current.instanceId,
        summonId: current.instanceId,
        actionIndex: entry.actionIndex,
        cause: { source: this.summonSource(current) },
      });
      this.presentation.addLog(`${current.name}发动${action.name}`, 'action', {
        type: 'ability', name: action.name, details: action.description || current.description,
      });
      await this.presentation.showSummonAction(current, action);
      await this.executeEffectProgram(action.effectProgram, current.owner === 'player', {
        triggerType: 'summon_action',
        summonContext: current,
        summonEffectFixed: action.fixed === true,
        abilityContext: action,
      });
      if (!this.gameStateManager.isGameOver()) {
        await this.presentation.waitForActionPresentation?.();
        await this.processSummonStatusEffectsAtActionTiming(current.instanceId, 'after_action');
      }
    }
    // Plan only after the selected activation completes. Reading/displaying an
    // intent never advances RNG, and later entries keep their original plan.
    this.gameStateManager.planSummonActions([...selectedIds]);
  }

  private async executeSummonCommand(
    command: Extract<EffectCommand, {
      type:
        | 'spawn_summon' | 'damage_summons' | 'heal_summons' | 'modify_summons' | 'modify_summon_effects'
        | 'gain_summon_resource' | 'set_summon_resource' | 'apply_summon_status'
        | 'remove_summon_status' | 'activate_summons' | 'dismiss_summons' | 'copy_summons';
    }>,
    sourceIsPlayer: boolean,
    sharedChoice?: import('../core/effectCommandHost').SharedSummonChoice,
  ): Promise<void> {
    const sourceOwner = sourceIsPlayer ? 'player' : 'enemy';
    if (command.type === 'spawn_summon') {
      const owner = command.target === 'self'
        ? sourceOwner
        : sourceOwner === 'player' ? 'enemy' : 'player';
      const capacity = this.resolveSummonCapacity(owner, command.capacity);
      const previousIds = new Set(this.gameStateManager.selectSummons(
        { owner: owner === sourceOwner ? 'self' : 'opponent', pick: 'all', includeUntargetable: true }, sourceOwner,
      ).map(unit => unit.instanceId));
      const result = this.gameStateManager.spawnSummons(
        owner, command.summon, command.count, capacity, command.overflow,
        this.summonRecipientId(owner, sourceOwner),
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
        if (previousIds.has(unit.instanceId)) {
          const repeatIds = new Set(this.executionContext.summonRepeatIds as string[] | undefined);
          if (repeatIds.has(unit.instanceId)) continue;
          repeatIds.add(unit.instanceId);
          if (command.summon.onExistingProgram) await this.executeEffectProgram(command.summon.onExistingProgram, unit.owner === 'player', {
            triggerType: 'summon_repeat', summonContext: this.gameStateManager.getSummonById(unit.instanceId) || unit,
            summonRepeatIds: [...repeatIds],
          });
          this.presentation.addLog(`${unit.name}已存在，结算重复召唤效果。`, 'action');
          continue;
        }
        previousIds.add(unit.instanceId);
        this.gameStateManager.recordBattleEvent({
          turn: this.gameStateManager.getGameState().currentTurn,
          phase: 'resolve',
          kind: 'summon_spawned',
          actorId: this.combatantJournalId(sourceOwner),
          summonId: unit.instanceId,
          summonTemplateId: unit.templateId,
          ownerId: this.summonJournalOwner(unit),
          cause: { source: this.currentEffectSource() },
        });
        this.presentation.addLog(`${owner === 'player' ? '我方' : '敌方'}召唤${unit.name}`, 'action', {
          type: 'ability', name: unit.name, details: unit.description,
        });
        await this.triggerHost.processSummonUnitAbilities(unit, 'battle_start', {
          summonId: unit.instanceId,
        });
        const current = this.gameStateManager.getSummonById(unit.instanceId);
        if (current) await this.triggerHost.processSummonUnitAbilities(current, 'ability_gain', {
          summonId: current.instanceId,
        });
      }
      return;
    }

    const selected = await this.selectSummons(command.selector, sourceOwner, sourceIsPlayer, sharedChoice);
    const ids = selected.map(unit => unit.instanceId);
    if (command.type === 'damage_summons') {
      const sourceEnemyId = sourceOwner === 'enemy'
        ? this.executionContext.battleContext?.enemyId || this.gameStateManager.getGameState().activeEnemyId || undefined
        : undefined;
      const sourceSummonId = this.executionContext.summonContext?.instanceId;
      const result = await this.damageSummonsWithDefense(
        ids, command.amount,
        { owner: sourceOwner, ...(sourceEnemyId ? { enemyId: sourceEnemyId } : {}), ...(sourceSummonId ? { summonId: sourceSummonId } : {}) },
        'effect', false,
      );
      for (const hit of result.hits) {
        const unit = selected.find(entry => entry.instanceId === hit.summonId);
        if (!unit) continue;
        this.presentation.addLog(
          `${unit.name}受到${hit.hpLost}点伤害${hit.blocked > 0 ? `（格挡${hit.blocked}）` : ''}${hit.defeated ? '并倒下' : ''}`,
          hit.defeated ? 'damage' : 'info',
          { type: 'ability', name: unit.name, details: unit.description },
        );
      }
      return;
    }
    if (command.type === 'heal_summons') {
      const result = this.gameStateManager.healSummons(ids, command.amount);
      for (const change of result.changed) {
        const unit = selected.find(entry => entry.instanceId === change.summonId);
        const gained = roundBattleValue(change.nextHp - change.previousHp);
        if (unit) await this.dispatchSummonHealTransition(unit, change.previousHp, change.nextHp, sourceOwner);
        if (unit && gained > 0) this.presentation.addLog(`${unit.name}恢复${gained}点生命`, 'heal', {
          type: 'ability', name: unit.name, details: unit.description,
        });
      }
      return;
    }
    if (command.type === 'modify_summons') {
      const operators = { add: '+', subtract: '-', multiply: '*', divide: '/', set: '=' } as const;
      const before = new Map(selected.map(unit => [unit.instanceId, unit]));
      this.gameStateManager.modifySummons(ids, command.stat, operators[command.operator], command.value);
      if (command.stat === 'block') {
        for (const [id, previous] of before) {
          const current = this.gameStateManager.getSummonById(id);
          if (current) await this.dispatchSummonBlockTransition(
            current, previous.block || 0, current.block || 0, sourceOwner,
          );
        }
      }
      return;
    }
    if (command.type === 'modify_summon_effects') {
      this.gameStateManager.modifySummonEffects(ids, command.stat, command.operator, command.value);
      this.presentation.addLog(ids.length
        ? `${selected.map(unit => unit.name).join('、')}的行动与能力已强化。`
        : '召唤物强化未生效：场上没有符合条件的目标。', 'info');
      return;
    }
    if (command.type === 'gain_summon_resource' || command.type === 'set_summon_resource') {
      const before = new Map(selected.map(unit => [
        unit.instanceId,
        unit.resources?.[command.resource]?.current,
      ]));
      this.gameStateManager.updateSummonResources(
        ids, command.resource,
        command.type === 'gain_summon_resource' ? command.amount : command.value,
        command.type === 'gain_summon_resource' ? 'gain' : 'set',
      );
      for (const unit of selected) {
        const previous = before.get(unit.instanceId);
        const current = this.gameStateManager.getSummonById(unit.instanceId)?.resources?.[command.resource]?.current;
        if (typeof previous === 'number' && typeof current === 'number') {
          await this.dispatchSummonResourceTransition(
            unit,
            command.resource,
            previous,
            current,
            sourceOwner,
            command.type === 'gain_summon_resource' ? 'gain' : 'set',
          );
        }
      }
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
          command.targetOwner === 'same' ? 'preserve' : {
            summonerId: this.summonRecipientId(owner, sourceOwner),
          },
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
            ownerId: this.summonJournalOwner(unit),
            cause: { source: this.currentEffectSource() },
          });
          this.presentation.addLog(`${unit.name}的复制体进入战场`, 'action', {
            type: 'ability', name: unit.name, details: unit.description,
          });
          await this.triggerHost.processSummonUnitAbilities(unit, 'battle_start', {
            summonId: unit.instanceId,
            reason: 'copy',
          });
          const current = this.gameStateManager.getSummonById(unit.instanceId);
          if (current) await this.triggerHost.processSummonUnitAbilities(current, 'ability_gain', {
            summonId: current.instanceId,
            reason: 'copy',
          });
        }
      }
      return;
    }
    if (command.type === 'activate_summons' && command.trigger === 'defeated') {
      for (const unit of selected) {
        await this.triggerHost.processSummonUnitAbilities(unit, 'defeated', { summonId: unit.instanceId, reason: 'effect_only' });
        this.presentation.addLog(`${unit.name}触发死亡能力，仍留在场上。`, 'action');
      }
      return;
    }
    await this.activateSelectedSummons(new Set(ids), command.type === 'activate_summons' ? command.suppliedAction : undefined);
  }

  private async executeSummonerProgram(
    command: Extract<EffectCommand, { type: 'summoner_effects' }>,
    sourceIsPlayer: boolean,
  ): Promise<void> {
    if (!this.executionContext.summonContext)
      throw new Error('summoner_effects can only resolve from an active summon action, ability, or status');
    if (!this.hasLivingSummoner(this.executionContext.summonContext)) return;
    await this.executeEffectProgram(
      { spec: 'mwg.effect/v1', steps: structuredClone(command.effects) },
      sourceIsPlayer,
      { ...this.executionContext, summonSelfTargetsOwner: true },
    );
  }

  private resolveSummonCapacity(owner: 'player' | 'enemy', authoredCapacity: number | undefined): number {
    const baseCapacity = authoredCapacity ?? (owner === 'enemy' ? Number.MAX_SAFE_INTEGER : 3);
    let capacity = baseCapacity;
    for (const source of this.getDeclarativeModifierOperations(owner, 'summon_capacity_modifier')) {
      capacity = applyModifierOperation(capacity, source.operation);
    }
    const entity = owner === 'player' ? this.gameStateManager.getPlayer() : this.gameStateManager.getEnemy();
    const directCapacity = entity?.modifiers?.summon_capacity_modifier;
    if (typeof directCapacity === 'number' && directCapacity !== 0) capacity += directCapacity;
    return Math.max(1, Math.floor(Number.isFinite(capacity) ? capacity : baseCapacity));
  }

  /** Only automatic player draw uses this; ordinary draw effects remain unchanged. */
  public resolvePlayerBaseDraw(base: number): number {
    let count = base;
    for (const source of this.getDeclarativeModifierOperations('player', 'draw_per_turn_modifier')) {
      count = applyModifierOperation(count, source.operation);
    }
    return Math.max(0, Math.floor(Number.isFinite(count) ? count : base));
  }

  private async selectSummons(
    selector: import('../../game-core').SummonSelector,
    sourceOwner: 'player' | 'enemy',
    sourceIsPlayer: boolean,
    sharedChoice?: import('../core/effectCommandHost').SharedSummonChoice,
  ): Promise<SummonUnit[]> {
    if (selector.pick === 'source') {
      const id = this.executionContext.summonStatusContext?.summonId || this.executionContext.summonContext?.instanceId;
      if (!id) return [];
      return this.gameStateManager.selectSummons({ ...selector, pick: 'by_id', id, count: 1, includeUntargetable: true }, sourceOwner);
    }
    // Legacy generated cards sometimes use a template ID as an instance ID.
    // Preserve exact instance targeting; matching templates require a choice.
    if (selector.pick === 'by_id' && selector.id) {
      const exact = this.gameStateManager.selectSummons(selector, sourceOwner);
      if (exact.length) return exact;
      const templateSelector = { ...selector, pick: 'choose' as const, templateId: selector.templateId || selector.id, id: undefined };
      const matching = this.gameStateManager.selectSummons({ ...templateSelector, pick: 'all' }, sourceOwner);
      if (matching.length) selector = templateSelector;
    }
    if (selector.pick !== 'choose') return this.gameStateManager.selectSummons(selector, sourceOwner);
    let candidates = this.gameStateManager.selectSummons(
      { ...selector, pick: 'all', count: undefined }, sourceOwner,
    );
    if (sharedChoice) {
      const offeredById = new Map(sharedChoice.requirements.flatMap(requirement =>
        this.gameStateManager.selectSummons(
          { ...requirement.selector, pick: 'all', count: undefined }, sourceOwner,
        ).map(unit => [unit.instanceId, unit] as const)));
      const offered = [...offeredById.values()];
      if (sharedChoice.selectedIds !== undefined) {
        if (sharedChoice.selectedIds === null) return [];
        const selected = new Set(sharedChoice.selectedIds);
        return candidates.filter(unit => selected.has(unit.instanceId));
      }
      if (offered.length === 0) {
        sharedChoice.selectedIds = [];
        return [];
      }
      if (!sourceIsPlayer) {
        sharedChoice.selectedIds = [offered[0].instanceId];
        return candidates.filter(unit => unit.instanceId === offered[0].instanceId);
      }
      const selectedIds = await TavernSummonChoicePresenter.getInstance().choose(offered, 1);
      sharedChoice.selectedIds = selectedIds;
      if (selectedIds === null) throw new Error('召唤物选择已取消');
      const selected = new Set(selectedIds);
      return candidates.filter(unit => selected.has(unit.instanceId));
    }
    if (candidates.length === 0) return [];
    const required = Math.min(candidates.length, Math.max(1, Math.floor(Number(selector.count) || 1)));
    // Enemy-authored decisions must not ask the player to operate the enemy AI.
    if (!sourceIsPlayer) {
      const selected = candidates.slice(0, required);
      return selected;
    }
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
    command: Extract<EffectCommand, { type: 'spawn_enemy' | 'enemy_intent' | 'wait' | 'say' }>,
    _sourceIsPlayer: boolean,
  ): Promise<void> {
    if (command.type === 'wait') return;
    if (command.type === 'say') {
      this.presentation.addLog(command.text, 'action');
      this.presentation.showDialogue?.(command.text);
      return;
    }
    if (command.type === 'enemy_intent') {
      const enemyId = this.executionContext.battleContext?.enemyId || this.gameStateManager.getGameState().activeEnemyId;
      const enemy = enemyId ? this.gameStateManager.getEnemyById(enemyId) : null;
      if (!enemy || enemy.currentHp <= 0) return;
      const action = enemy.actions.find(action => action.id === command.actionId);
      if (!action) throw new Error(`Unknown enemy action: ${command.actionId}`);
      this.gameStateManager.updateEnemyById(enemy.id, { nextAction: structuredClone(action) });
      return;
    }

    if (command.count <= 0) return;
    const state = this.gameStateManager.getGameState();
    const living = this.gameStateManager.getEnemies({ livingOnly: true });
    const allKnown = [
      ...this.gameStateManager.getEnemies(),
      ...this.gameStateManager.getReserveEnemies(),
      ...(state.defeatedEnemies || []),
      ...(state.escapedEnemies || []),
    ];
    const liveSlots = Math.max(0, command.capacity - living.length - this.gameStateManager.getReserveEnemies().filter(enemy => enemy.currentHp > 0).length);
    const amount = Math.min(Math.floor(command.count), liveSlots);
    if (amount <= 0) {
      this.presentation.addLog('敌方增援未能进入战场：敌人容量已满', 'system');
      return;
    }

    const existingIds = new Set(allKnown.map(enemy => enemy.id));
    const spawned: Enemy[] = [];
    for (let index = 0; index < amount; index += 1) {
      const authored = structuredClone(command.enemy) as unknown as Record<string, unknown>;
      // Reinforcements are new combatants, never duplicate treasure containers.
      delete authored.defeat_reward;
      const runtimeId = allocateRuntimeId(String(authored.id || 'enemy'), existingIds);
      existingIds.add(runtimeId);
      authored.id = runtimeId;
      const enemy = convertMvuEnemy(authored, () => this.gameStateManager.nextRandom(), { fallbackId: runtimeId, deferAction: this.gameStateManager.getEnemies().length + index >= 5 });
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
    try {
      for (const enemy of spawned) {
        if (this.gameStateManager.isGameOver()) break;
        if (!this.gameStateManager.getEnemyById(enemy.id)) continue;
        this.gameStateManager.setActiveEnemy(enemy.id);
        this.presentation.addLog(`敌方增援「${enemy.name}」进入战场`, 'action', {
          type: 'ability', name: enemy.name, details: enemy.dialogue,
        });
        // A dynamically spawned enemy owns the same authored lifecycle as an
        // initial enemy. Without these hooks, its initial stance and otherwise
        // valid battle_start/ability_gain abilities were silently inert.
        await this.processInitialStance('enemy', enemy.id);
        await this.processAbilitiesByTrigger('enemy', 'battle_start', { enemyId: enemy.id, spawned: true });
        if (this.gameStateManager.isGameOver()) break;
        await this.processAbilitiesByTrigger('enemy', 'ability_gain', { enemyId: enemy.id, spawned: true });
      }
    } finally {
      const previousActive = previousActiveId ? this.gameStateManager.getEnemyById(previousActiveId) : null;
      const restoreId = previousActiveId && previousActive && previousActive.currentHp > 0
        ? previousActiveId
        : this.gameStateManager.getEnemies({ livingOnly: true })[0]?.id;
      if (restoreId) this.gameStateManager.setActiveEnemy(restoreId);
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
    damageKind?: DamageKind,
  ): number {
    const sources = this.summonModifierSources(holder);
    let result = amount;
    for (const attribute of attributes) {
      for (const source of sources[attribute] || []) {
        if (!source.operation.damageKind || source.operation.damageKind === damageKind) result = applyModifierOperation(result, source.operation);
      }
    }
    return Math.max(0, roundBattleValue(result));
  }

  private async damageSummonsWithDefense(
    targetIds: readonly string[],
    amount: number,
    source: { owner: 'player' | 'enemy'; enemyId?: string; summonId?: string },
    damageKind: DamageKind,
    bypassBlock: boolean,
    packetRequested = amount,
  ): Promise<ReturnType<GameStateManager['damageSummons']>> {
    const hits: ReturnType<GameStateManager['damageSummons']>['hits'] = [];
    for (const summonId of [...new Set(targetIds)]) {
      const before = this.gameStateManager.getSummonById(summonId);
      if (!before || before.hasHp === false || before.currentHp <= 0) continue;
      const caps = (before.statusEffects || [])
        .map(status => this.dynamicStatusManager.getStatusDefinition(status.id)?.defense?.damage_cap)
        .filter((cap): cap is number => cap !== undefined);
      const requested = Math.max(0, roundBattleValue(packetRequested));
      const incoming = Math.max(0, roundBattleValue(amount));
      const modified = caps.length ? Math.min(incoming, ...caps) : incoming;
      const postBlock = bypassBlock ? modified : Math.max(0, roundBattleValue(modified - (before.block || 0)));
      const buffer = postBlock > 0
        ? before.statusEffects?.find(status => this.dynamicStatusManager.getStatusDefinition(status.id)?.defense?.prevent_hp_loss)
        : undefined;
      const prevented = buffer
        ? await this.triggerHost.consumeSummonStatusLayer(summonId, buffer.id)
        : false;
      const result = this.gameStateManager.damageSummons([summonId], modified, bypassBlock, prevented);
      const rawHit = result.hits[0];
      if (!rawHit) continue;
      const hit = {
        ...rawHit,
        requested,
        ...(modified !== requested ? { modified } : rawHit.modified !== undefined ? { modified: rawHit.modified } : {}),
      };
      hits.push(hit);
      await this.dispatchSummonDamageTransition(before, hit, source.owner, damageKind);
      if (damageKind === 'attack') await this.retaliateSummonAttack(this.gameStateManager.getSummonById(summonId) || before, source);
      if (hit.defeated) this.recordSummonDefeat(before, 'damage');
    }
    return { state: this.gameStateManager.readSummons(), hits };
  }

  private async retaliateSummonAttack(
    defender: SummonUnit,
    attacker: { owner: 'player' | 'enemy'; enemyId?: string; summonId?: string },
  ): Promise<void> {
    for (const status of defender.statusEffects || []) {
      const rule = this.dynamicStatusManager.getStatusDefinition(status.id)?.defense?.retaliate_attack;
      const amount = rule === 'stacks' ? status.stacks : rule;
      if (!amount || amount <= 0) continue;
      if (attacker.summonId) {
        await this.damageSummonsWithDefense(
          [attacker.summonId], amount,
          { owner: defender.owner, summonId: defender.instanceId },
          'retaliation', false,
        );
      } else {
        await this.executeModernBattleCommand(
          { type: 'damage', target: 'opponent', amount, damageKind: 'retaliation' },
          defender.owner === 'player',
          attacker.owner === 'player' ? { kind: 'player', id: 'player' } : attacker.enemyId,
          { sourceSummonId: defender.instanceId },
        );
      }
    }
  }

  private async interceptDamageWithSummonDefense(request: {
    source: 'player' | 'enemy'; target: 'player' | 'enemy'; amount: number;
    damageKind: DamageKind; sourceEnemyId?: string; sourceSummonId?: string; targetEnemyId?: string;
  }): Promise<{ remainingDamage: number; interceptedDamage: number; hits: Array<{ summonId: string; blocked: number; hpLost: number; defeated: boolean }> }> {
    let remainingDamage = Math.max(0, roundBattleValue(request.amount));
    const hits: Array<{ summonId: string; blocked: number; hpLost: number; defeated: boolean }> = [];
    const eligible = this.gameStateManager.getSummons(request.target)
      .filter(unit => unit.hasHp !== false && unit.currentHp > 0)
      .filter(unit => request.target !== 'enemy' || (request.targetEnemyId !== undefined && unit.summonerId === request.targetEnemyId))
      .filter(unit => unit.capabilities?.intercepts !== false)
      .filter(unit => unit.intercept?.maxPerTurn === undefined || unit.interceptionsThisTurn < unit.intercept.maxPerTurn)
      .sort((left, right) => {
        const priority = (right.intercept?.priority || 0) - (left.intercept?.priority || 0);
        if (priority !== 0) return priority;
        const speed = left.intercept || right.intercept ? (right.speed || 0) - (left.speed || 0) : 0;
        return speed || left.createdSequence - right.createdSequence;
      });
    for (const snapshot of eligible) {
      if (remainingDamage <= 0) break;
      const unit = this.gameStateManager.getSummonById(snapshot.instanceId);
      if (!unit || unit.currentHp <= 0) continue;
      const state = this.gameStateManager.readSummons();
      this.gameStateManager.writeSummons({
        ...state,
        living: state.living.map(candidate => candidate.instanceId === unit.instanceId
          ? { ...candidate, interceptionsThisTurn: candidate.interceptionsThisTurn + 1 }
          : candidate),
      }, 'summon_interception_started');
      let modified = remainingDamage;
      for (const { operation } of this.summonModifierSources(unit).damage_taken_modifier || []) {
        if (!operation.damageKind || operation.damageKind === request.damageKind)
          modified = Math.max(0, roundBattleValue(applyModifierOperation(modified, operation)));
      }
      const result = await this.damageSummonsWithDefense(
        [unit.instanceId], modified,
        { owner: request.source, ...(request.sourceEnemyId ? { enemyId: request.sourceEnemyId } : {}), ...(request.sourceSummonId ? { summonId: request.sourceSummonId } : {}) },
        request.damageKind, false, remainingDamage,
      );
      const hit = result.hits[0];
      if (!hit) continue;
      hits.push({ summonId: unit.instanceId, blocked: hit.blocked, hpLost: hit.hpLost, defeated: hit.defeated });
      remainingDamage = hit.prevented
        ? 0
        : Math.max(0, roundBattleValue((hit.modified ?? hit.requested) - hit.blocked - hit.hpLost));
    }
    return {
      remainingDamage,
      interceptedDamage: roundBattleValue(Math.max(0, request.amount) - remainingDamage),
      hits,
    };
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
        command.damageKind === 'hp_loss' ? [] : ['damage_modifier', 'damage_taken_modifier'],
        command.damageKind || 'effect',
      );
      const sourceOwner = this.executionContext.sourceIsPlayer ? 'player' : 'enemy';
      const sourceSummonId = this.executionContext.summonContext?.instanceId;
      const sourceEnemyId = sourceOwner === 'enemy' ? this.executionContext.battleContext?.enemyId : undefined;
      await this.damageSummonsWithDefense(
        [id], amount,
        { owner: sourceOwner, ...(sourceEnemyId ? { enemyId: sourceEnemyId } : {}), ...(sourceSummonId && sourceSummonId !== id ? { summonId: sourceSummonId } : {}) },
        command.damageKind || 'effect', command.bypassBlock === true,
      );
      return;
    }
    if (command.type === 'heal') {
      const amount = this.applySummonStatusModifiers(command.amount, holder, ['heal_modifier']);
      const result = this.gameStateManager.healSummons([id], amount);
      const change = result.changed[0];
      if (change) await this.dispatchSummonHealTransition(holder, change.previousHp, change.nextHp, holder.owner);
      return;
    }
    if (command.type === 'gain_block') {
      const amount = this.applySummonStatusModifiers(command.amount, holder, ['block_modifier']);
      const previous = holder.block || 0;
      this.gameStateManager.modifySummons([id], 'block', '+', amount);
      const current = this.gameStateManager.getSummonById(id);
      if (current) await this.dispatchSummonBlockTransition(current, previous, current.block || 0, holder.owner);
      return;
    }
    if (command.type === 'gain_resource' || command.type === 'set_resource') {
      if (!holder.resources?.[command.resource])
        throw new Error(`summon ${id} does not define resource ${command.resource}`);
      const previous = holder.resources[command.resource].current;
      this.gameStateManager.updateSummonResources(
        [id],
        command.resource,
        command.type === 'gain_resource' ? command.amount : command.value,
        command.type === 'gain_resource' ? 'gain' : 'set',
      );
      const current = this.gameStateManager.getSummonById(id)?.resources?.[command.resource]?.current;
      if (typeof current === 'number') await this.dispatchSummonResourceTransition(
        holder, command.resource, previous, current, holder.owner,
        command.type === 'gain_resource' ? 'gain' : 'set',
      );
      return;
    }
    if (command.type === 'gain_energy' || command.type === 'gain_lust') {
      const resource = command.type === 'gain_energy' ? 'energy' : 'lust';
      if (!holder.resources?.[resource]) throw new Error(`summon ${id} does not define resource ${resource}`);
      const previous = holder.resources[resource].current;
      this.gameStateManager.updateSummonResources([id], resource, command.amount, 'gain');
      const current = this.gameStateManager.getSummonById(id)?.resources?.[resource]?.current;
      if (typeof current === 'number') await this.dispatchSummonResourceTransition(
        holder, resource, previous, current, holder.owner, 'gain',
      );
      return;
    }
    if (command.type === 'set_stat') {
      if (command.stat === 'block') {
        const previous = holder.block || 0;
        this.gameStateManager.modifySummons([id], 'block', '=', command.value);
        const current = this.gameStateManager.getSummonById(id);
        if (current) await this.dispatchSummonBlockTransition(current, previous, current.block || 0, holder.owner);
        return;
      }
      if (command.stat === 'energy' || command.stat === 'lust') {
        if (!holder.resources?.[command.stat])
          throw new Error(`summon ${id} does not define resource ${command.stat}`);
        const previous = holder.resources[command.stat].current;
        this.gameStateManager.updateSummonResources([id], command.stat, command.value, 'set');
        const current = this.gameStateManager.getSummonById(id)?.resources?.[command.stat]?.current;
        if (typeof current === 'number') await this.dispatchSummonResourceTransition(
          holder, command.stat, previous, current, holder.owner, 'set',
        );
        return;
      }
      const nextHp = Math.max(0, Math.min(holder.maxHp, roundBattleValue(command.value)));
      if (nextHp < holder.currentHp) {
        const result = this.gameStateManager.damageSummons([id], holder.currentHp - nextHp, true);
        if (result.hits[0]) await this.dispatchSummonDamageTransition(holder, result.hits[0], holder.owner, 'hp_loss');
        if (result.hits[0]?.defeated) this.recordSummonDefeat(holder, 'damage');
      } else if (nextHp > holder.currentHp) {
        const result = this.gameStateManager.healSummons([id], nextHp - holder.currentHp);
        const change = result.changed[0];
        if (change) await this.dispatchSummonHealTransition(holder, change.previousHp, change.nextHp, holder.owner);
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
    if (result.hits[0]) await this.dispatchSummonDamageTransition(holder, result.hits[0], holder.owner, 'hp_loss');
    if (result.hits[0]?.defeated) this.recordSummonDefeat(holder, 'damage');
  }

  /** Dedicated permanent progression is explicit, player-only, and staged for battle-end persistence. */
  private async executePersistentGrowth(
    command: Extract<EffectCommand, { type: 'persistent_growth' }>,
    sourceIsPlayer: boolean,
  ): Promise<void> {
    if (!sourceIsPlayer) throw new Error('persistent_growth may only be resolved by the player');
    if (this.executionContext.summonContext && !this.executionContext.summonSelfTargetsOwner) {
      throw new Error('persistent_growth from a summon requires explicit summoner_effects binding');
    }
    if (command.summonTemplateId) {
      this.gameStateManager.growPlayerSummonTemplate(command);
      this.gameStateManager.recordPersistentGrowth(command);
      this.presentation.addLog('召唤物获得永久成长。', 'action');
      return;
    }
    const player = this.gameStateManager.getPlayer();
    const current = command.stat === 'max_hp' ? player.maxHp : player.maxLust;
    const raw = command.operator === 'add'
      ? current + command.value
      : command.operator === 'subtract'
        ? current - command.value
        : command.value;
    const next = Math.max(1, roundBattleValue(raw));
    if (command.stat === 'max_hp') {
      this.gameStateManager.updatePlayer({ maxHp: next, currentHp: Math.min(player.currentHp, next) });
    } else {
      this.gameStateManager.updatePlayer({ maxLust: next, currentLust: Math.min(player.currentLust, next) });
    }
    this.gameStateManager.recordPersistentGrowth(command);
    this.presentation.addLog(`永久成长：${command.stat === 'max_hp' ? '生命上限' : '欲望上限'}${{add:'增加',subtract:'减少',set:'设为'}[command.operator]}${command.value}`, 'action');
  }

  private async executeModernBattleCommand(
    command: BattleEffectCommand,
    sourceIsPlayer: boolean,
    selectedTarget?: ResolvedEffectTarget | string,
    transfer?: Pick<BattleEffectRuntimeContext, 'sourceEnemyId' | 'sourceSummonId' | 'sourceModifierSources' | 'skipSourceDamageModifiers' | 'bypassBlock'>,
  ): Promise<BattleEffectRuntimeResult | undefined> {
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
    if (typeof selectedTarget === 'string') selectedTarget = { kind: 'enemy', id: selectedTarget };
    if (selectedTarget?.kind === 'summon') {
      const holder = this.gameStateManager.getSummonById(selectedTarget.id);
      if (holder && holder.owner === selectedTarget.owner) await this.executeSummonStatusBattleCommand(command, holder);
      return undefined;
    }
    const selectedEnemyId = selectedTarget?.kind === 'enemy' ? selectedTarget.id : undefined;
    if (selectedTarget?.kind === 'player') command = { ...command, target: sourceIsPlayer ? 'self' : 'opponent' };
    if (selectedEnemyId) command = { ...command, target: sourceIsPlayer ? 'opponent' : 'self' };
    const target = command.target === 'self' ? source : source === 'player' ? 'enemy' : 'player';
    if (command.target === 'self' && this.hasSummonSelfBinding(target)) {
      const summonHolder = this.activeSummonHolder(target);
      if (summonHolder) await this.executeSummonStatusBattleCommand(command, summonHolder);
      return undefined;
    }
    const state = this.gameStateManager.getGameState();
    const sourceEnemyId = source === 'enemy'
      ? transfer?.sourceEnemyId || this.executionContext.battleContext?.enemyId || state.activeEnemyId || this.gameStateManager.getEnemy()?.id || null
      : null;
    const resolvedEnemyId = target === 'enemy'
      ? selectedEnemyId || this.executionContext.boundEnemyTargetId ||
        (command.target === 'self' ? sourceEnemyId : null) || this.currentResolvedEnemyId ||
        state.activeEnemyId || this.gameStateManager.getEnemy()?.id || null
      : null;
    const eventSource = this.currentEffectSource();
    const actorId = this.currentActorId(source);
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
      const summonModifiers = transfer?.sourceModifierSources || (this.executionContext.summonContext && this.executionContext.summonEffectFixed !== true
        ? this.summonModifierSources(this.executionContext.summonContext)
        : undefined);
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
        ...(transfer?.skipSourceDamageModifiers ? { skipSourceDamageModifiers: true } : {}),
        ...(transfer?.bypassBlock ? { bypassBlock: true } : {}),
        ...(sourceEnemyId ? { sourceEnemyId } : {}),
        ...(transfer?.sourceSummonId || this.executionContext.summonContext?.instanceId
          ? { sourceSummonId: transfer?.sourceSummonId || this.executionContext.summonContext?.instanceId }
          : {}),
        ...(resolvedEnemyId ? { targetEnemyId: resolvedEnemyId } : {}),
      });
    } finally {
      // Event presentation happens synchronously inside execute and can read the
      // exact target even when the active alias advances after a lethal hit.
      this.currentResolvedEnemyId = previousResolvedEnemyId;
    }
    if (!result.applied) {
      this.presentation.addLog(`目标实体不存在: ${result.target || 'unknown'}`, 'system');
      return result;
    }
    if (result.target && result.pendingDeath !== undefined) {
      const targetId = result.target === 'enemy'
        ? resolvedEnemyId || 'enemy'
        : 'player';
      if (result.pendingDeath) {
        this.pendingDeaths.add(targetId);
        if (!this.pendingDeathDetails) this.pendingDeathDetails = new Map();
        this.pendingDeathDetails.set(targetId, {
          actorId,
          source: { ...eventSource, ownerId: actorId },
          method: effectiveCommand.type === 'execute' || effectiveCommand.type === 'kill'
            ? effectiveCommand.type
            : 'damage',
          fatal: result.fatal !== false,
          ...(result.resolvedEventId ? { fatalSourceEventId: result.resolvedEventId } : {}),
        });
      } else {
        this.pendingDeaths.delete(targetId);
        this.pendingDeathDetails.delete(targetId);
      }
    }
    return result;
  }

  /** Persist the causal event before its reactions execute. */
  private recordResolvedBattleEffectEvent(
    event: Extract<BattleEffectRuntimeEvent, {
      type: 'damage_resolved' | 'heal_resolved' | 'attribute_logged';
    }>,
  ): BattleTriggerEventContext | undefined {
    const state = this.gameStateManager.getGameState();
    const actorId = this.executionContext.summonContext?.instanceId || (event.source === 'player'
      ? 'player'
      : this.executionContext.battleContext?.enemyId || state.activeEnemyId || state.enemy?.id || 'enemy');
    const targetId = event.target === 'player'
      ? 'player'
      : this.currentResolvedEnemyId || state.activeEnemyId || state.enemy?.id || 'enemy';
    const cause = { source: { ...this.currentEffectSource(), ownerId: actorId } } as const;
    let recorded;
    if (event.type === 'damage_resolved') {
      const target = event.target === 'player'
        ? state.player
        : this.currentResolvedEnemyId
          ? this.gameStateManager.getEnemyById(this.currentResolvedEnemyId)
          : state.enemy;
      recorded = this.gameStateManager.recordBattleEvent({
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
    } else if (event.type === 'heal_resolved') {
      recorded = this.gameStateManager.recordBattleEvent({
        turn: state.currentTurn,
        phase: 'resolve',
        kind: 'heal_resolved',
        cause,
        actorId,
        targetId,
        requested: event.requested,
        hpGained: event.hpGained,
      });
    } else {
      const amount = Math.abs(roundBattleValue(event.nextValue - event.previousValue));
      if (amount <= 0 || (event.attribute !== 'lust' && event.attribute !== 'block')) return undefined;
      const increasing = event.nextValue > event.previousValue;
      recorded = this.gameStateManager.recordBattleEvent({
        turn: state.currentTurn,
        phase: 'resolve',
        kind: event.attribute === 'lust'
          ? increasing ? 'lust_increased' : 'lust_decreased'
          : increasing ? 'block_gained' : 'block_lost',
        actorId,
        targetId,
        previousValue: event.previousValue,
        nextValue: event.nextValue,
        amount,
        cause,
      });
    }
    return recorded?.ok
      ? battleTriggerContextFromEvent(recorded.event, recorded.state)
      : undefined;
  }

  /** Status ownership, trigger and removal share the same persisted causal journal as damage. */
  private recordCombatantStatusEvent(
    event: Extract<StatusLifecycleEvent, {
      type: 'status_applied' | 'trigger_completed' | 'status_removed';
    }>,
  ): BattleTriggerEventContext | undefined {
    const state = this.gameStateManager.getGameState();
    const targetId = event.target === 'player'
      ? 'player'
      : this.currentResolvedEnemyId
        || this.executionContext.boundEnemyTargetId
        || this.executionContext.battleContext?.enemyId
        || state.activeEnemyId
        || state.enemy?.id
        || 'enemy';
    const outerActorId = this.executionContext.summonContext?.instanceId || (this.executionContext.sourceIsPlayer
      ? 'player'
      : this.executionContext.battleContext?.enemyId || state.activeEnemyId || state.enemy?.id || 'enemy');
    const isTrigger = event.type === 'trigger_completed';
    const source: BattleEventSource = isTrigger
      ? { kind: 'status', id: event.status.id, name: event.status.name, ownerId: targetId }
      : { ...this.currentEffectSource(), ownerId: outerActorId };
    const recorded = this.gameStateManager.recordBattleEvent({
      turn: state.currentTurn,
      phase: 'resolve',
      kind: event.type === 'status_applied'
        ? 'status_applied'
        : event.type === 'status_removed'
          ? 'status_removed'
          : 'status_triggered',
      actorId: isTrigger ? targetId : outerActorId,
      targetId,
      statusId: event.status.id,
      statusName: event.status.name,
      statusType: event.status.type,
      stacks: event.status.stacks,
      ...(event.type === 'status_removed' ? { reason: event.reason } : { trigger: event.trigger }),
      cause: { source },
    } as import('../../game-core').BattleEventDraft);
    return recorded.ok
      ? battleTriggerContextFromEvent(recorded.event, recorded.state)
      : undefined;
  }

  private recordSummonStatusEvent(
    event: Extract<import('../../game-core').SummonStatusLifecycleEvent, {
      type: 'status_applied' | 'trigger_completed' | 'status_removed';
    }>,
  ): BattleTriggerEventContext | undefined {
    const state = this.gameStateManager.getGameState();
    const targetId = event.summon.instanceId;
    const isTrigger = event.type === 'trigger_completed';
    const outerActorId = isTrigger
      ? targetId
      : this.currentActorId(this.executionContext.sourceIsPlayer ? 'player' : 'enemy');
    const source: BattleEventSource = isTrigger
      ? { kind: 'status', id: event.status.id, name: event.status.name, ownerId: targetId }
      : { ...this.currentEffectSource(), ownerId: outerActorId };
    const recorded = this.gameStateManager.recordBattleEvent({
      turn: state.currentTurn,
      phase: 'resolve',
      kind: event.type === 'status_applied'
        ? 'status_applied'
        : event.type === 'status_removed'
          ? 'status_removed'
          : 'status_triggered',
      actorId: isTrigger ? targetId : outerActorId,
      targetId,
      statusId: event.status.id,
      statusName: event.status.name,
      statusType: event.status.type,
      stacks: event.status.stacks,
      ...(event.type === 'status_removed' ? { reason: event.reason } : { trigger: event.trigger }),
      cause: { source },
    } as import('../../game-core').BattleEventDraft);
    return recorded.ok ? battleTriggerContextFromEvent(recorded.event, recorded.state) : undefined;
  }

  private async forEachTarget(
    selector: EnemyTargetSelector,
    sourceIsPlayer: boolean,
    execute: (target: ResolvedEffectTarget) => Promise<void>,
  ): Promise<void> {
    // Recipient identity must override an outer enemy action/status resolution.
    // Changing activeEnemy alone cannot override that scope for status/ability
    // mutations. Keep the original source context and restore after each recipient.
    const executeRecipient = async (target: ResolvedEffectTarget): Promise<void> => {
      if (target.kind !== 'enemy') { await execute(target); return; }
      const previous = this.currentResolvedEnemyId;
      if (!this.gameStateManager.beginEnemyResolution(target.id)) return;
      this.currentResolvedEnemyId = target.id;
      try { await execute(target); }
      finally {
        this.currentResolvedEnemyId = previous;
        this.gameStateManager.endEnemyResolution(target.id);
      }
    };
    // The omitted/enemies form deliberately retains the pre-existing enemy-only
    // roster semantics. Relative teams are a separate mixed entity collection.
    if (selector.team === 'self' || selector.team === 'opponent') {
      const sourceOwner = sourceIsPlayer ? 'player' : 'enemy';
      const owner = selector.team === 'self' ? sourceOwner : sourceOwner === 'player' ? 'enemy' : 'player';
      const units: Array<{ id: string; currentHp: number; maxHp: number; target: ResolvedEffectTarget }> = [
        ...(owner === 'player'
          ? (() => { const player = this.gameStateManager.getPlayer(); return player.currentHp > 0 ? [{ id: 'player', currentHp: player.currentHp, maxHp: player.maxHp, target: { kind: 'player', id: 'player' } as const }] : []; })()
          : this.gameStateManager.getEnemies({ livingOnly: true }).map(enemy => ({ id: enemy.id, currentHp: enemy.currentHp, maxHp: enemy.maxHp, target: { kind: 'enemy', id: enemy.id } as const }))),
        ...this.gameStateManager.getSummons(owner).filter(unit => unit.currentHp > 0).map(unit => ({
          id: `summon:${unit.instanceId}`, currentHp: unit.currentHp, maxHp: unit.maxHp,
          target: { kind: 'summon', id: unit.instanceId, owner } as const,
        })),
      ];
      const state = this.gameStateManager.getGameState();
      const resolve = (pool: typeof units, activeId: string | null = null) => resolveEnemyTargets(
        createCombatantCollection(pool, activeId), { ...selector, team: undefined } as EnemyTargetSelector,
        state.random || createBattleRandomState(0),
      );
      if (selector.mode === 'random_n' && selector.retarget === 'each_hit') {
        const seen = new Set<string>();
        for (let hit = 0; hit < selector.count; hit += 1) {
          const pool = units.filter(unit => selector.allowRepeat || !seen.has(unit.id));
          if (!pool.length) break;
          const resolved = resolve(pool);
          this.gameStateManager.setRandomState(resolved.random);
          const chosen = resolved.targets[0]; if (!chosen) break;
          seen.add(chosen.id); await executeRecipient(chosen.target);
        }
        return;
      }
      const resolved = resolve(units);
      this.gameStateManager.setRandomState(resolved.random);
      this.reportEnemyTargetResolution(resolved.resolution);
      for (const chosen of resolved.targets) await executeRecipient(chosen.target);
      return;
    }
    const previous = this.gameStateManager.getGameState().activeEnemyId;
    const executeTarget = async (enemyId: string): Promise<void> => {
      const enemy = this.gameStateManager.getEnemyById(enemyId);
      if (!enemy || enemy.currentHp <= 0 || !this.gameStateManager.setActiveEnemy(enemyId)) return;
      await executeRecipient({ kind: 'enemy', id: enemyId });
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
        this.presentation.addLog(
          `${event.target === 'player' ? '玩家' : '敌方'}被${event.method === 'kill' ? '直接击杀' : '处决'}`,
          'damage',
        );
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
        this.presentation.showHealthChange(event.target, change, event.nextValue, entity.maxHp, event.target === 'enemy' && 'id' in entity ? entity.id : undefined, event.previousValue, entity.block);
      } else if (event.attribute === 'lust') {
        this.presentation.showLustChange(event.target, change, event.nextValue, entity.maxLust);
      } else if (event.attribute === 'block' && change !== 0) {
        this.presentation.showBlockChange(event.target, change, event.previousValue, event.nextValue, event.target === 'enemy' && 'id' in entity ? entity.id : undefined);
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
    previewEnemy?: Enemy,
  ): Array<{ operation: ModifierOperation; name: string; stacks?: number }> {
    const state = this.gameStateManager.getGameState();
    const result: Array<{ operation: ModifierOperation; name: string; stacks?: number }> = [];
    const addPassive = (
      sources: any[] | undefined,
      owner: BattleEntityType,
      label: string,
      enemyHolder?: Enemy,
    ): void => {
      for (const resolved of resolvePassiveModifierOperations(
        sources,
        owner,
        target,
        modifier,
        this.createCoreEffectState(owner === 'player', undefined, enemyHolder || previewEnemy),
      )) {
        result.push({ operation: resolved.operation, name: `${label}${resolved.source.name || resolved.source.id}` });
      }
    };
    addPassive(state.player.abilities, 'player', '能力');
    addPassive(state.player.relics, 'player', '遗物');
    if (state.player.stance?.passiveEffects?.length) addPassive([{
      id: state.player.stance.id, name: state.player.stance.name, trigger: 'passive',
      effectProgram: { spec: 'mwg.effect/v1', steps: state.player.stance.passiveEffects },
    }], 'player', '姿态');
    const enemyHolders = target === 'enemy' && previewEnemy ? [previewEnemy] : this.continuousEnemyHolders(target);
    for (const enemy of enemyHolders) {
      addPassive(enemy.abilities, 'enemy', '能力', enemy);
      if (enemy.stance?.passiveEffects?.length) addPassive([{
        id: enemy.stance.id, name: enemy.stance.name, trigger: 'passive',
        effectProgram: { spec: 'mwg.effect/v1', steps: enemy.stance.passiveEffects },
      }], 'enemy', '姿态', enemy);
    }

    const addStatuses = (holder: Player | Enemy | null, holderType: BattleEntityType): void => {
      if (!holder) return;
      const coreState = this.createCoreEffectState(
        holderType === 'player',
        undefined,
        holderType === 'enemy' ? holder as Enemy : previewEnemy,
      );
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
    enemyHolders.forEach(enemy => addStatuses(enemy, 'enemy'));
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
      const coreState = this.createCoreEffectState(summon.owner === 'player', summon);
      for (const resolved of resolvePassiveModifierOperations(summon.abilities as any, summon.owner, summon.owner, attribute, coreState)) {
        sources.push({ operation: resolved.operation, name: resolved.source.name || summon.name });
      }
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

  private async handleLustOverflow(
    target: 'player' | 'enemy',
    context: { sourceEnemyId?: string; targetEnemyId?: string } = {},
  ): Promise<void> {
    if (target === 'player') {
      const sourceEnemyId = context.sourceEnemyId
        || this.executionContext.battleContext?.enemyId
        || this.gameStateManager.getGameState().activeEnemyId
        || this.gameStateManager.getEnemy()?.id
        || null;
      const sourceEnemy = sourceEnemyId
        ? this.gameStateManager.getEnemyById(sourceEnemyId)
        : this.gameStateManager.getEnemy();
      const effect = sourceEnemy?.lustEffect;
      if (!effect) return;
      const lockKey = 'player';
      if (this.activeLustOverflows.has(lockKey)) return;
      this.activeLustOverflows.add(lockKey);
      try {
        this.presentation.logLustOverflow('玩家', effect.name);
        this.presentation.showLustOverflow('player', effect);
        await this.executeEffectProgram(effect.effectProgram, false, {
          triggerType: 'lust_overflow',
          abilityContext: effect,
          ...(sourceEnemyId ? { battleContext: { enemyId: sourceEnemyId } } : {}),
        });
      } finally {
        // 欲望效果本身仍可能包含欲望变化。保持本次溢出锁直到整段效果
        // 结束，避免它在归零前递归触发自身并卡死酒馆页面。
        this.gameStateManager.updatePlayer({ currentLust: 0 });
        this.activeLustOverflows.delete(lockKey);
      }
      return;
    }
    const effect = this.gameStateManager.getGameState().battle?.player_lust_effect;
    if (!effect?.effectProgram) return;
    // Keep the concrete overflowing enemy stable across nested damage,
    // defeated triggers and roster fallback. Updating the active alias in the
    // finally block can otherwise clear the next living enemy's lust.
    const overflowingEnemyId = context.targetEnemyId
      || this.currentResolvedEnemyId
      || this.gameStateManager.getGameState().activeEnemyId
      || this.gameStateManager.getEnemy()?.id
      || null;
    if (!overflowingEnemyId) return;
    const lockKey = `enemy:${overflowingEnemyId}`;
    if (this.activeLustOverflows.has(lockKey)) return;
    this.activeLustOverflows.add(lockKey);
    try {
      this.presentation.logLustOverflow('敌人', effect.name || '榨精支配');
      this.presentation.showLustOverflow('enemy', effect);
      await this.executeEffectProgram(effect.effectProgram, true, {
        triggerType: 'lust_overflow',
        abilityContext: effect,
        boundEnemyTargetId: overflowingEnemyId,
      });
    } finally {
      if (overflowingEnemyId && this.gameStateManager.getEnemyById(overflowingEnemyId)) {
        this.gameStateManager.updateEnemyById(overflowingEnemyId, { currentLust: 0 });
      }
      this.activeLustOverflows.delete(lockKey);
    }
  }

  private createCoreEffectState(
    sourceIsPlayer: boolean,
    summonHolder?: SummonUnit,
    enemyHolder?: Enemy,
  ): CoreEffectState {
    const state = this.gameStateManager.getGameState();
    const playerSummonCount = this.gameStateManager.getSummons('player').length;
    const enemySummonCount = this.gameStateManager.getSummons('enemy').length;
    const livingEnemies = this.gameStateManager.getEnemies({ livingOnly: true });
    const toCore = (
      entity: Player | Enemy | null,
      includeCards: boolean,
      summonCount: number,
      allyCount: number,
    ): CoreEffectState['self'] => ({
      hp: entity?.currentHp ?? 0,
      maxHp: entity?.maxHp ?? 1,
      lust: entity?.currentLust ?? 0,
      maxLust: entity?.maxLust ?? 100,
      energy: entity?.energy ?? 0,
      maxEnergy: entity?.maxEnergy ?? 0,
      block: entity?.block ?? 0,
      stanceId: entity?.stance?.id ?? null,
      ...(includeCards
        ? {
            handSize: state.player.hand.length,
            drawPileSize: state.player.drawPile.length,
            discardPileSize: state.player.discardPile.length,
            exhaustPileSize: state.player.exhaustPile.length,
          }
        : {}),
      summonCount,
      allyCount,
      statusStacks: Object.fromEntries((entity?.statusEffects || []).map(status => [status.id, status.stacks])),
      statusTypes: Object.fromEntries((entity?.statusEffects || []).map(status => [
        status.id,
        status.type === 'ens' ? 'neutral' : status.type,
      ])),
      resources: Object.fromEntries(Object.entries(entity?.resources || {}).map(([id, resource]) => [id, resource.current])),
      maxResources: Object.fromEntries(Object.entries(entity?.resources || {}).map(([id, resource]) => [id, resource.max])),
    });
    const player = toCore(state.player, true, playerSummonCount, 0);
    const boundEnemyId = typeof this.executionContext.battleContext?.enemyId === 'string'
      ? this.executionContext.battleContext.enemyId
      : null;
    const boundEnemy = boundEnemyId ? this.gameStateManager.getEnemyById(boundEnemyId) : null;
    const selectedEnemy = enemyHolder || boundEnemy || state.enemy;
    const enemy = toCore(
      selectedEnemy,
      false,
      enemySummonCount,
      selectedEnemy ? livingEnemies.filter(entry => entry.id !== selectedEnemy.id).length : 0,
    );
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
      stanceId: null,
      summonCount: currentSummon.owner === 'player' ? playerSummonCount : enemySummonCount,
      allyCount: currentSummon.owner === 'player'
        ? (state.player.currentHp > 0 ? 1 : 0)
        : livingEnemies.length,
      statusStacks: Object.fromEntries((currentSummon.statusEffects || []).map(status => [status.id, status.stacks])),
      statusTypes: Object.fromEntries((currentSummon.statusEffects || []).map(status => [status.id, status.type])),
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
        teamActorIds: sourceIsPlayer
          ? ['player', ...this.gameStateManager.getSummons('player').map(unit => unit.instanceId)]
          : [
              ...this.gameStateManager.getEnemies({ livingOnly: true }).map(entry => entry.id),
              ...this.gameStateManager.getSummons('enemy').map(unit => unit.instanceId),
            ],
        eventJournal: state.eventJournal,
      },
      enemyIntentValue: state.enemy?.intent?.value || 0,
      enemyIntentType: state.enemy?.intent?.type,
    };
  }

  private async processPendingDeaths(): Promise<void> {
    if (!this.pendingDeathDetails) this.pendingDeathDetails = new Map();
    if (this.gameStateManager.isGameOver()) {
      this.pendingDeaths.clear();
      this.pendingDeathDetails.clear();
      return;
    }
    if (this.pendingDeaths.has('player')) {
      await this.triggerHost.processAbilitiesByTrigger('player', 'defeated', {
        actorId: 'player', targetId: 'player', eventJournal: this.gameStateManager.getGameState().eventJournal,
      });
      if (this.gameStateManager.getPlayer().currentHp <= 0) {
        await this.recordFinalizedDefeat('player');
        this.pendingDeaths.clear();
        this.pendingDeathDetails.clear();
        await this.completeBattleEnd('defeat');
        return;
      }
      this.pendingDeaths.delete('player');
      this.pendingDeathDetails.delete('player');
    }
    for (const enemyId of [...this.pendingDeaths]) {
      if (enemyId === 'player') continue;
      const enemy = this.gameStateManager.getEnemyById(enemyId);
      if (!enemy || enemy.currentHp > 0) {
        this.pendingDeaths.delete(enemyId);
        this.pendingDeathDetails.delete(enemyId);
        continue;
      }
      await this.triggerHost.processAbilitiesByTrigger('enemy', 'defeated', {
        enemyId,
        actorId: enemyId,
        targetId: enemyId,
        eventJournal: this.gameStateManager.getGameState().eventJournal,
      });
      const current = this.gameStateManager.getEnemyById(enemyId);
      if (current && current.currentHp <= 0) {
        this.gameStateManager.updateEnemyById(enemyId, { currentHp: 0 });
        void Promise.resolve(this.presentation.showEnemyDefeat?.(enemyId)).catch(error => console.warn('[Battle] defeat presentation failed', error));
        await this.recordFinalizedDefeat(enemyId);
      } else {
        this.pendingDeaths.delete(enemyId);
        this.pendingDeathDetails.delete(enemyId);
      }
    }
    // Nested take-damage/gain-block/status programs get their own pending-death
    // set. They must never sweep a lethal entity that is still owned by the
    // outer damage program, otherwise its `defeated` abilities are skipped.
    const finalizedEnemyIds = [...this.pendingDeaths].filter(enemyId => enemyId !== 'player');
    const removedEnemies = this.gameStateManager.removeDefeatedEnemies(finalizedEnemyIds);
    const objectiveDefeated = removedEnemies.some(enemy => enemy.victoryOnDefeat);
    if (!objectiveDefeated) await this.admitEnemyReinforcements();
    const result = objectiveDefeated || (this.gameStateManager.getEnemies({ livingOnly: true }).length === 0 && this.gameStateManager.getReserveEnemies().every(enemy => enemy.currentHp <= 0) && removedEnemies.length > 0)
      ? 'victory'
      : null;
    this.pendingDeaths.clear();
    this.pendingDeathDetails.clear();
    if (result) await this.completeBattleEnd(result);
  }

  /** Record death only after all defeated/revival reactions have completed. */
  private async recordFinalizedDefeat(targetId: string): Promise<void> {
    const state = this.gameStateManager.getGameState();
    // Nested kill reactions must not award the same finalized death twice.
    if (state.eventJournal?.events.some(event => event.kind === 'entity_defeated' && event.targetId === targetId)) return;
    const detail = this.pendingDeathDetails?.get(targetId);
    const source = detail?.source || this.currentEffectSource();
    const parent = detail?.fatalSourceEventId
      ? state.eventJournal?.events.find(event => event.id === detail.fatalSourceEventId)
      : undefined;
    const recorded = this.gameStateManager.recordBattleEvent({
      turn: state.currentTurn,
      phase: 'after',
      kind: 'entity_defeated',
      cause: {
        source,
        ...(detail?.fatalSourceEventId ? { parentEventId: detail.fatalSourceEventId } : {}),
        ...(parent?.cause.rootEventId ? { rootEventId: parent.cause.rootEventId } : {}),
      },
      actorId: detail?.actorId || (this.executionContext.sourceIsPlayer
        ? 'player'
        : this.executionContext.battleContext?.enemyId || state.activeEnemyId || 'enemy'),
      targetId,
      ...(detail?.fatalSourceEventId ? { fatalSourceEventId: detail.fatalSourceEventId } : {}),
      defeatKind: detail?.method || 'damage',
      fatal: detail?.fatal !== false,
    });
    if (!recorded.ok) return;
    const context = battleTriggerContextFromEvent(recorded.event, recorded.state);
    const actorId = recorded.event.actorId;
    if (actorId === targetId) return;
    const playerActor = actorId === 'player';
    const enemyActor = actorId && this.gameStateManager.getEnemyById(actorId);
    const summonActor = actorId && this.gameStateManager.getSummonById(actorId);
    // A summon kill is not silently credited to its owner.
    if (!playerActor && !enemyActor && !summonActor) return;
    await this.triggerHost.processAbilitiesByTrigger(summonActor ? summonActor.owner : playerActor ? 'player' : 'enemy', 'kill', {
      ...context, ...(enemyActor ? { enemyId: actorId } : {}),
    });
    if (playerActor) await this.relicTriggerHost.triggerRelics('kill', { ...context });
  }

  private async completeBattleEnd(result: BattleEndResult, narrativeText = ''): Promise<void> {
    this.gameStateManager.setBattleOutcome(result, narrativeText);
    await this.battleEndHost.presentBattleEnd(result, narrativeText || undefined);
  }

  /** All remaining enemies may leave without producing a defeat event. */
  public async completeBattleAfterEnemyDeparture(): Promise<void> {
    if (this.gameStateManager.isGameOver()) return;
    await this.admitEnemyReinforcements();
    if (this.gameStateManager.isGameOver() || this.gameStateManager.getEnemies({ livingOnly: true }).length > 0) return;
    await this.completeBattleEnd('victory');
  }

  /** Reserves begin their lifecycle only after joining an empty frontline slot. */
  private async admitEnemyReinforcements(): Promise<void> {
    const admitted = this.gameStateManager.admitReserveEnemies();
    if (!admitted.length) return;
    const previous = this.gameStateManager.getGameState().activeEnemyId;
    const plan = prepareEnemyActionQueue(admitted, this.gameStateManager.getGameState().random || createBattleRandomState(0));
    this.gameStateManager.setRandomState(plan.random);
    for (const enemy of plan.enemies) this.gameStateManager.updateEnemyById(enemy.id, enemy as Enemy);
    try {
      for (const enemy of admitted) {
        if (this.gameStateManager.isGameOver()) break;
        this.gameStateManager.setActiveEnemy(enemy.id);
        this.presentation.addLog(`后备敌人「${enemy.name}」上场`, 'action');
        await this.processInitialStance('enemy', enemy.id);
        await this.processAbilitiesByTrigger('enemy', 'battle_start', { enemyId: enemy.id, spawned: true });
        if (!this.gameStateManager.isGameOver()) await this.processAbilitiesByTrigger('enemy', 'ability_gain', { enemyId: enemy.id, spawned: true });
      }
    } finally {
      if (previous) this.gameStateManager.setActiveEnemy(previous);
    }
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
