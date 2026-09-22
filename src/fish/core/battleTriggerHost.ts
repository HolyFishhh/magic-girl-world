import {
  allocateRuntimeId,
  abilityTriggerRecipientScope,
  AbilityTriggerRuntime,
  battleTriggerContextFromEvent,
  normalizeAbilityTrigger,
  runBattleTriggerDispatches,
  resolveAbilityTriggerPlan,
  runTriggerTransaction,
  StatusLifecycleRuntime,
  SummonStatusLifecycleRuntime,
  type AbilityTrigger,
  type AbilityTriggerPlan,
  type BattleTriggerDispatch,
  type BattleTriggerEventContext,
  type EffectProgram,
  type StatusLifecycleEvent,
  type StatusEventTrigger,
  type SummonStatusLifecycleEvent,
  type SummonUnit,
} from '../../game-core';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import type { Ability, Enemy, Player, StatusEffect } from '../../game-core';
import { BattleSessionHost } from './battleSessionHost';
import { GameStateManager } from './gameStateManager';
import { StanceTriggerRuntime } from '../../game-core/stanceTriggerRuntime';

export type BattleTriggerExecutionContext = Record<string, unknown> & {
  triggerType?: string;
  statusContext?: StatusEffect;
  abilityContext?: Ability;
  summonContext?: SummonUnit;
  summonStatusContext?: { summonId: string };
  summonEffectFixed?: boolean;
};

export interface BattleTriggerHostPorts {
  executeProgram(
    program: EffectProgram,
    sourceIsPlayer: boolean,
    context: BattleTriggerExecutionContext,
  ): Promise<void>;
  runRelic(trigger: AbilityTrigger, context: Readonly<Record<string, unknown>>): Promise<void>;
  addLog(
    message: string,
    type?: 'info' | 'damage' | 'heal' | 'action' | 'system',
    source?: { type: 'card' | 'relic' | 'ability' | 'status'; name: string; details?: string },
  ): void;
  logStatusEffect(targetName: string, statusName: string, stacks: number, duration: number, isApply: boolean, emoji?: string, enemyId?: string): void;
  recordStatusEvent?(event: Extract<StatusLifecycleEvent, {
    type: 'status_applied' | 'trigger_completed' | 'status_removed';
  }>): BattleTriggerEventContext | undefined;
  recordSummonStatusEvent?(event: Extract<SummonStatusLifecycleEvent, {
    type: 'status_applied' | 'trigger_completed' | 'status_removed';
  }>): BattleTriggerEventContext | undefined;
}

/**
 * Tavern host for ability and dynamic-status lifecycles.
 *
 * It owns trigger recursion guards and nested rollback, while effect parsing and
 * execution remain injected ports so the lifecycle has only one executor.
 */
export class TavernBattleTriggerHost {
  private readonly gameStateManager = GameStateManager.getInstance();
  private readonly dynamicStatusManager = DynamicStatusManager.getInstance();
  private readonly sessionHost = BattleSessionHost.getInstance();
  private readonly abilityRuntime = new AbilityTriggerRuntime({
    readAbilities: (target, context) => this.getEntity(
      target,
      target === 'enemy' && typeof context?.enemyId === 'string' ? context.enemyId : undefined,
    )?.abilities,
    execute: (target, plan, context) => this.executeAbilityTriggerTransaction(target, plan, context),
  });
  private readonly stanceRuntime = new StanceTriggerRuntime({
    readStance: (target, context) => this.getEntity(
      target, target === 'enemy' && typeof context.enemyId === 'string' ? context.enemyId : undefined,
    )?.stance,
    execute: (target, plan, context) => this.executeAbilityTriggerTransaction(target, plan, context),
  });
  private readonly statusRuntime = new StatusLifecycleRuntime({
    state: this.gameStateManager,
    definitions: {
      get: statusId => this.dynamicStatusManager.getStatusDefinition(statusId),
      getTriggerEffects: (statusId, trigger) =>
        this.dynamicStatusManager.getStatusTriggerEffects(statusId, trigger),
    },
    transactions: this.sessionHost.triggerTransactionPorts(),
    execute: (effect, target, context) =>
      this.ports.executeProgram(effect, target === 'player', {
        ...context,
        ...(target === 'enemy' && typeof context.enemyId === 'string'
          ? { battleContext: { enemyId: context.enemyId } }
          : {}),
      }),
    dispatch: dispatches => this.dispatch(dispatches),
    record: event => this.ports.recordStatusEvent?.(event),
    present: event => this.presentStatusEvent(event),
  });
  private readonly summonStatusRuntime = new SummonStatusLifecycleRuntime({
    state: this.gameStateManager,
    definitions: {
      get: statusId => this.dynamicStatusManager.getStatusDefinition(statusId),
      getTriggerEffects: (statusId, trigger) =>
        this.dynamicStatusManager.getStatusTriggerEffects(statusId, trigger),
    },
    transactions: this.sessionHost.triggerTransactionPorts(),
    execute: (effect, owner, context) =>
      this.ports.executeProgram(effect, owner === 'player', context),
    record: event => this.ports.recordSummonStatusEvent?.(event) || this.recordSummonStatusEvent(event),
    dispatch: dispatches => this.dispatch(dispatches),
    present: event => this.presentSummonStatusEvent(event),
  });
  private readonly activeSummonAbilities = new Set<string>();
  private readonly activeStatusEvents = new Set<string>();

  public constructor(private readonly ports: BattleTriggerHostPorts) {}

  private teamActorIds(owner: 'player' | 'enemy'): string[] {
    return owner === 'player'
      ? ['player', ...this.gameStateManager.getSummons('player').map(unit => unit.instanceId)]
      : [
          // `enemy` is the stable id of the side-level turn lifecycle event;
          // concrete action and effect events still use the exact enemy id.
          'enemy',
          ...this.gameStateManager.getEnemies({ livingOnly: true }).map(enemy => enemy.id),
          ...this.gameStateManager.getSummons('enemy').map(unit => unit.instanceId),
        ];
  }

  private triggerRecipient(
    trigger: string,
    context: Readonly<Record<string, unknown>>,
  ): { scope: import('../../game-core').AbilityTriggerRecipientScope; entityId: string | null } | null {
    const normalized = normalizeAbilityTrigger(trigger);
    if (!normalized) return null;
    const scope = abilityTriggerRecipientScope(normalized);
    const stringValue = (key: string): string | null =>
      typeof context[key] === 'string' && context[key] ? String(context[key]) : null;
    const entityId = scope === 'source'
      ? stringValue('actorId')
      : scope === 'holder'
        ? stringValue('targetId') || stringValue('summonId')
        : scope === 'owner'
          ? stringValue('summonId') || stringValue('targetId') || stringValue('actorId') || stringValue('enemyId')
          : null;
    return { scope, entityId };
  }

  private combatantReceivesTrigger(
    owner: 'player' | 'enemy',
    trigger: string,
    context: Readonly<Record<string, unknown>>,
  ): boolean {
    const recipient = this.triggerRecipient(trigger, context);
    if (!recipient || recipient.scope === 'team' || recipient.scope === 'observer') return true;
    if (!recipient.entityId) return true;
    if (owner === 'player') return recipient.entityId === 'player';
    return Boolean(this.gameStateManager.getEnemyById(recipient.entityId));
  }

  private summonRecipients(
    owner: 'player' | 'enemy',
    trigger: string,
    context: Readonly<Record<string, unknown>>,
  ): SummonUnit[] {
    const recipient = this.triggerRecipient(trigger, context);
    if (!recipient) return [];
    if (recipient.scope === 'team' || recipient.scope === 'observer') {
      return this.gameStateManager.getSummons(owner);
    }
    if (!recipient.entityId) return [];
    const exact = this.gameStateManager.getSummonById(recipient.entityId);
    return exact?.owner === owner ? [exact] : [];
  }

  public async dispatch(dispatches: readonly BattleTriggerDispatch[]): Promise<void> {
    await runBattleTriggerDispatches(dispatches, {
      runAbility: async (target, trigger, context) => {
        if (target === 'enemy' && context.enemyScope === 'all_living') {
          await this.processAllEnemyAbilitiesByTrigger(trigger, context);
          return;
        }
        await this.processAbilitiesByTrigger(target, trigger, context);
      },
      runRelic: (trigger, context) => this.ports.runRelic(trigger, context),
    });
  }

  public async registerAbility(
    targetType: 'player' | 'enemy',
    definition: {
      trigger: string;
      eventQuery?: import('../../game-core').EventTriggerQuery;
      effectProgram: EffectProgram;
      name?: string;
      emoji?: string;
      description?: string;
      source?: string;
    },
  ): Promise<void> {
    const entity = this.getEntity(targetType);
    if (!entity) return;
    const existingIds = new Set((entity.abilities || []).map(existing => existing.id));
    const ability: Ability = {
      id: allocateRuntimeId('ability', existingIds),
      ...definition,
    };
    this.updateAbilities(targetType, [...(entity.abilities || []), ability]);
    this.ports.addLog(`获得能力: ${ability.name || ability.id}`, 'info');

    await this.processAbilitiesByTrigger(targetType, 'ability_gain',
      targetType === 'enemy' && 'id' in entity ? { enemyId: entity.id } : {},
    );
    if (targetType === 'player') {
      await this.ports.runRelic('ability_gain', { ability, targetType });
    }
  }

  public async removeAbility(targetType: 'player' | 'enemy', abilityIdentifier: string): Promise<boolean> {
    const entity = this.getEntity(targetType);
    if (!entity) return false;
    const abilities = entity.abilities || [];
    const updated = abilities.filter(ability => ability.id !== abilityIdentifier);
    if (updated.length === abilities.length) return false;
    this.updateAbilities(targetType, updated);
    this.ports.addLog(`失去能力: ${abilityIdentifier}`, 'info');
    return true;
  }

  public async processAbilitiesByTrigger(
    targetType: 'player' | 'enemy',
    trigger: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const runtimeContext: Readonly<Record<string, unknown>> = {
      ...context,
      teamActorIds: this.teamActorIds(targetType),
      eventJournal: this.gameStateManager.getGameState().eventJournal,
    };
    const receivesCombatant = this.combatantReceivesTrigger(targetType, trigger, runtimeContext);
    const runStance = receivesCombatant ? this.stanceRuntime.prepare(targetType, trigger, runtimeContext) : null;
    const eventTrigger = this.statusEventTrigger(trigger);
    const combatantStatusIds = receivesCombatant && eventTrigger
      ? (this.getEntity(
          targetType,
          targetType === 'enemy' && typeof runtimeContext.enemyId === 'string'
            ? runtimeContext.enemyId
            : undefined,
        )?.statusEffects || []).map(status => status.id)
      : [];
    const summonSnapshots = eventTrigger
      ? this.summonRecipients(targetType, trigger, runtimeContext).map(summon => ({
          summon,
          statusIds: (summon.statusEffects || []).map(status => status.id),
        }))
      : [];
    if (receivesCombatant) {
      await this.abilityRuntime.run(targetType, trigger, runtimeContext);
      await runStance?.();
    }
    if (eventTrigger) {
      for (const entry of summonSnapshots) {
        await this.processSummonUnitAbilities(entry.summon, trigger, runtimeContext, entry.statusIds);
      }
      if (receivesCombatant) {
        await this.processCombatantStatusesByTrigger(
          targetType,
          eventTrigger,
          runtimeContext,
          combatantStatusIds,
        );
      }
    } else {
      await this.processSummonAbilitiesByTrigger(targetType, trigger, runtimeContext);
    }
  }

  /**
   * Resolve one side-wide enemy event exactly once per living enemy, then once
   * for the enemy summon team. Calling the ordinary method in a roster loop
   * would make every summon ability fire once for every enemy in the roster.
   */
  public async processAllEnemyAbilitiesByTrigger(
    trigger: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const teamActorIds = this.teamActorIds('enemy');
    const eventTrigger = this.statusEventTrigger(trigger);
    const summonSnapshots = eventTrigger
      ? this.summonRecipients('enemy', trigger, context).map(summon => ({
          summon,
          statusIds: (summon.statusEffects || []).map(status => status.id),
        }))
      : [];
    // Freeze every stance before ANY listener for this team event executes.
    // An earlier enemy's ability may otherwise grant a later enemy a stance
    // and accidentally make that new listener participate retroactively.
    const enemyDispatches = this.gameStateManager.getEnemies({ livingOnly: true }).map(enemy => {
      const enemyContext = {
        ...context,
        enemyScope: undefined,
        enemyId: enemy.id,
        teamActorIds,
        eventJournal: this.gameStateManager.getGameState().eventJournal,
      };
      return { enemy, enemyContext, runStance: this.stanceRuntime.prepare('enemy', trigger, enemyContext) };
    });
    for (const { enemy, enemyContext, runStance } of enemyDispatches) {
      if (this.gameStateManager.isGameOver()) break;
      const statusIds = eventTrigger ? (enemy.statusEffects || []).map(status => status.id) : [];
      await this.abilityRuntime.run('enemy', trigger, enemyContext);
      await runStance();
      if (eventTrigger) {
        await this.processCombatantStatusesByTrigger('enemy', eventTrigger, enemyContext, statusIds);
      }
    }
    if (!this.gameStateManager.isGameOver()) {
      const summonContext = { ...context, teamActorIds };
      if (eventTrigger) {
        for (const entry of summonSnapshots) {
          await this.processSummonUnitAbilities(entry.summon, trigger, summonContext, entry.statusIds);
        }
      } else {
        await this.processSummonAbilitiesByTrigger('enemy', trigger, summonContext);
      }
    }
  }

  /** Run summon-local triggered abilities while keeping ordinary `self` bound to the exact unit. */
  public async processSummonAbilitiesByTrigger(
    owner: 'player' | 'enemy',
    trigger: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const summons = this.summonRecipients(owner, trigger, context);
    for (const summon of summons) await this.processSummonUnitAbilities(summon, trigger, context);
  }

  public async processSummonUnitAbilities(
    summon: SummonUnit,
    trigger: string,
    context: Readonly<Record<string, unknown>> = {},
    activeStatusIds?: readonly string[],
  ): Promise<void> {
    const eventTrigger = this.statusEventTrigger(trigger);
    const statusIds = eventTrigger
      ? activeStatusIds || (summon.statusEffects || []).map(status => status.id)
      : [];
    const eventContext = {
      ...context,
      summonId: summon.instanceId,
      eventJournal: this.gameStateManager.getGameState().eventJournal,
    };
    for (const ability of summon.abilities || []) {
      const source: Ability = {
        ...ability,
        source: `召唤单位「${summon.name}」`,
      };
      const plan = resolveAbilityTriggerPlan(source, trigger, eventContext);
      if (!plan) continue;
      const activeKey = `${summon.instanceId}:${plan.trigger}:${ability.id}`;
      if (this.activeSummonAbilities.has(activeKey)) continue;
      this.activeSummonAbilities.add(activeKey);
      try {
        const result = await runTriggerTransaction(
          `summon_ability_${plan.trigger}`,
          this.sessionHost.triggerTransactionPorts(),
          () => this.ports.executeProgram(plan.program, summon.owner === 'player', {
            ...eventContext,
            triggerType: plan.trigger,
            summonContext: summon,
            summonEffectFixed: ability.fixed === true,
            abilityContext: source,
          }),
          'recover-and-continue',
        );
        if (result.status === 'rolled_back') {
          this.ports.addLog(`${summon.name}的${source.name || source.id}执行失败，战斗状态已回滚。`, 'system');
        } else {
          this.ports.addLog(`${summon.name}触发：${source.name || source.id}`, 'action', {
            type: 'ability',
            name: source.name || source.id,
            details: source.description || `触发：${plan.trigger}`,
          });
        }
      } finally {
        this.activeSummonAbilities.delete(activeKey);
      }
    }
    if (eventTrigger) {
      await this.processSummonStatusesByTrigger(summon, eventTrigger, eventContext, statusIds);
    }
  }

  private statusEventTrigger(trigger: string): StatusEventTrigger | null {
    const normalized = normalizeAbilityTrigger(trigger);
    return normalized && normalized !== 'passive' ? normalized : null;
  }

  private async processCombatantStatusesByTrigger(
    targetType: 'player' | 'enemy',
    trigger: StatusEventTrigger,
    context: Readonly<Record<string, unknown>>,
    statusIds: readonly string[],
  ): Promise<void> {
    const enemyId = targetType === 'enemy' && typeof context.enemyId === 'string' ? context.enemyId : null;
    for (const statusId of [...new Set(statusIds)]) {
      const holderId = targetType === 'player' ? 'player' : enemyId || 'enemy';
      const activeKey = `${holderId}:${statusId}:${trigger}`;
      if (this.activeStatusEvents.has(activeKey)) continue;
      this.activeStatusEvents.add(activeKey);
      const bound = enemyId ? this.gameStateManager.beginEnemyResolution(enemyId) : false;
      try {
        if (enemyId && !bound) continue;
        await this.statusRuntime.processEvent(targetType, trigger, context, [statusId]);
      } finally {
        if (enemyId && bound) this.gameStateManager.endEnemyResolution(enemyId);
        this.activeStatusEvents.delete(activeKey);
      }
    }
  }

  private async processSummonStatusesByTrigger(
    summon: SummonUnit,
    trigger: StatusEventTrigger,
    context: Readonly<Record<string, unknown>>,
    statusIds: readonly string[],
  ): Promise<void> {
    for (const statusId of [...new Set(statusIds)]) {
      const activeKey = `${summon.instanceId}:${statusId}:${trigger}`;
      if (this.activeStatusEvents.has(activeKey)) continue;
      this.activeStatusEvents.add(activeKey);
      try {
        await this.summonStatusRuntime.processEvent(summon, trigger, context, [statusId]);
      } finally {
        this.activeStatusEvents.delete(activeKey);
      }
    }
  }

  public async applyStatus(targetType: 'player' | 'enemy', statusId: string, stacks: number, options?: import('../../game-core/statusAction').StatusReceiveOptions): Promise<void> {
    await this.statusRuntime.apply(targetType, statusId, stacks, options);
  }

  public async removeStatusStacks(targetType: 'player' | 'enemy', statusId: string, count: number): Promise<void> {
    await this.statusRuntime.removeStacks(targetType, statusId, count);
  }

  public async removeStatuses(targetType: 'player' | 'enemy', selection: string): Promise<void> {
    await this.statusRuntime.remove(targetType, selection);
  }

  public async consumeStatusLayer(targetType: 'player' | 'enemy', statusId: string): Promise<boolean> {
    return this.statusRuntime.consumeLayer(targetType, statusId);
  }

  public async processStatusEffectsAtActionTiming(
    targetType: 'player' | 'enemy',
    timing: import('../../game-core/statusDefinitionRuntime').StatusTickTiming,
    enemyId?: string,
  ): Promise<void> {
    await this.statusRuntime.processActionTiming(targetType, timing, enemyId);
  }

  public async processStatusEffectsAtTurnEnd(targetType: 'player' | 'enemy'): Promise<void> {
    await this.statusRuntime.processTurnEnd(targetType);
  }

  public async applyStatusToSummons(targetIds: readonly string[], statusId: string, stacks: number, options?: import('../../game-core/statusAction').StatusReceiveOptions): Promise<void> {
    await this.summonStatusRuntime.apply(targetIds, statusId, stacks, options);
  }

  public async removeSummonStatusStacks(id: string, statusId: string, count: number): Promise<void> {
    await this.summonStatusRuntime.removeStacks(id, statusId, count);
  }

  public async removeStatusesFromSummons(targetIds: readonly string[], selection: string): Promise<void> {
    await this.summonStatusRuntime.remove(targetIds, selection);
  }

  public async consumeSummonStatusLayer(summonId: string, statusId: string): Promise<boolean> {
    return this.summonStatusRuntime.consumeLayer(summonId, statusId);
  }

  public async processSummonStatusEffectsAtActionTiming(
    summonId: string,
    timing: import('../../game-core/statusDefinitionRuntime').StatusTickTiming,
  ): Promise<void> {
    await this.summonStatusRuntime.processActionTiming(summonId, timing);
  }

  public async processSummonStatusEffectsAtTurnEnd(owner: 'player' | 'enemy'): Promise<void> {
    await this.summonStatusRuntime.processTurnEnd(owner);
  }

  private async executeAbilityTriggerTransaction(
    targetType: 'player' | 'enemy',
    plan: AbilityTriggerPlan,
    dispatchContext: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const { source: ability, trigger } = plan;
    const result = await runTriggerTransaction(
      `ability_${trigger}`,
      this.sessionHost.triggerTransactionPorts(),
      async () => {
        const requestedEnemyId = targetType === 'enemy' && typeof dispatchContext.enemyId === 'string'
          ? dispatchContext.enemyId
          : null;
        const context: BattleTriggerExecutionContext = {
          ...dispatchContext,
          triggerType: trigger,
          abilityContext: ability,
          ...(targetType === 'enemy' && typeof dispatchContext.enemyId === 'string'
            ? { battleContext: { enemyId: dispatchContext.enemyId } }
            : {}),
        };
        const bound = requestedEnemyId
          ? this.gameStateManager.beginEnemyResolution(requestedEnemyId)
          : false;
        try {
          if (requestedEnemyId && !bound) return;
          await this.ports.executeProgram(plan.program, targetType === 'player', context);
        } finally {
          if (requestedEnemyId && bound) this.gameStateManager.endEnemyResolution(requestedEnemyId);
        }
      },
      'recover-and-continue',
    );
    if (result.status === 'rolled_back') {
      this.ports.addLog(`${ability.name || ability.id}的${trigger}效果执行失败，战斗状态已回滚。`, 'system');
      return;
    }

    const abilityName = ability.name || ability.id;
    const details = [ability.source ? `来源：${ability.source}` : '', `触发：${trigger}`].filter(Boolean).join('；');
    this.ports.addLog(`能力触发：${abilityName}`, 'action', {
      type: 'ability',
      name: abilityName,
      details,
    });
  }

  private presentStatusEvent(event: StatusLifecycleEvent): void {
    if (event.type === 'missing_definition') {
      this.ports.addLog(`未找到状态定义: ${event.statusId}`, 'system');
      return;
    }
    if (event.type === 'status_applied') {
      this.ports.logStatusEffect(
        event.target === 'player' ? '玩家' : '敌人',
        event.status.name,
        event.status.stacks,
        0,
        true,
        event.status.emoji,
        event.enemyId,
      );
      return;
    }
    if (event.type === 'trigger_started') {
      this.ports.addLog(`${event.status.name}触发${event.trigger}效果`, 'action', {
        type: 'status',
        name: event.status.name,
        details: `触发：${event.trigger}`,
      });
      return;
    }
    if (event.type === 'trigger_completed') return;
    if (event.type === 'status_removed') {
      this.ports.addLog(
        event.reason === 'decay' ? `状态效果结束: ${event.status.name}` : `移除了状态: ${event.status.name}`,
        'info',
      );
      return;
    }
    if (event.type === 'trigger_failed') {
      this.ports.addLog(`${event.status.name}的${event.trigger}效果执行失败，战斗状态已回滚。`, 'system');
      return;
    }
    const label =
      event.selection === 'all_buffs'
        ? '所有状态'
        : event.selection === 'buffs'
          ? '所有增益状态'
          : event.selection === 'debuffs'
            ? '所有减益状态'
            : '';
    if (label) this.ports.addLog(`移除了${label}`, 'info');
  }

  private presentSummonStatusEvent(event: SummonStatusLifecycleEvent): void {
    if (event.type === 'missing_definition') {
      this.ports.addLog(`召唤状态未注册: ${event.statusId}`, 'system');
      return;
    }
    if (event.type === 'status_applied') {
      this.ports.logStatusEffect(event.summon.name, event.status.name, event.status.stacks, 0, true, event.status.emoji);
      return;
    }
    if (event.type === 'trigger_started') {
      this.ports.addLog(`${event.summon.name}的${event.status.name}触发${event.trigger}效果`, 'action', {
        type: 'status',
        name: event.status.name,
        details: `持有者：${event.summon.name}；触发：${event.trigger}`,
      });
      return;
    }
    if (event.type === 'status_removed') {
      this.ports.addLog(
        event.reason === 'decay'
          ? `${event.summon.name}的状态结束: ${event.status.name}`
          : `${event.summon.name}移除了状态: ${event.status.name}`,
        'info',
      );
      return;
    }
    if (event.type === 'trigger_completed') {
      return;
    }
    this.ports.addLog(
      `${event.summon.name}的${event.status.name}${event.trigger}效果执行失败，战斗状态已回滚。`,
      'system',
    );
  }

  private recordSummonStatusEvent(
    event: Extract<SummonStatusLifecycleEvent, {
      type: 'status_applied' | 'trigger_completed' | 'status_removed';
    }>,
  ): BattleTriggerEventContext | undefined {
    const state = this.gameStateManager.getGameState();
    const recorded = this.gameStateManager.recordBattleEvent({
      turn: state.currentTurn,
      phase: 'resolve',
      kind: event.type === 'status_applied'
        ? 'status_applied'
        : event.type === 'status_removed'
          ? 'status_removed'
          : 'status_triggered',
      actorId: event.summon.instanceId,
      targetId: event.summon.instanceId,
      statusId: event.status.id,
      statusName: event.status.name,
      statusType: event.status.type,
      stacks: event.status.stacks,
      ...(event.type === 'status_removed' ? { reason: event.reason } : { trigger: event.trigger }),
      cause: {
        source: {
          kind: 'status',
          id: event.status.id,
          name: event.status.name,
          ownerId: event.summon.instanceId,
        },
      },
    } as import('../../game-core').BattleEventDraft);
    return recorded.ok ? battleTriggerContextFromEvent(recorded.event, recorded.state) : undefined;
  }

  private getEntity(targetType: 'player' | 'enemy', enemyId?: string): Player | Enemy | null {
    return targetType === 'player'
      ? this.gameStateManager.getPlayer()
      : enemyId
        ? this.gameStateManager.getEnemyById(enemyId)
        : this.gameStateManager.getEnemy();
  }

  private updateAbilities(targetType: 'player' | 'enemy', abilities: Ability[]): void {
    if (targetType === 'player') this.gameStateManager.updatePlayer({ abilities });
    else this.gameStateManager.updateEnemy({ abilities });
  }
}
