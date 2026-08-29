import {
  allocateRuntimeId,
  AbilityTriggerRuntime,
  runBattleTriggerDispatches,
  resolveAbilityTriggerPlan,
  runTriggerTransaction,
  StatusLifecycleRuntime,
  SummonStatusLifecycleRuntime,
  type AbilityTrigger,
  type AbilityTriggerPlan,
  type BattleTriggerDispatch,
  type EffectProgram,
  type StatusLifecycleEvent,
  type SummonStatusLifecycleEvent,
  type SummonUnit,
} from '../../game-core';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import type { Ability, Enemy, Player, StatusEffect } from '../../game-core';
import { BattleSessionHost } from './battleSessionHost';
import { GameStateManager } from './gameStateManager';

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
  logStatusEffect(targetName: string, statusName: string, stacks: number, duration: number, isApply: boolean, emoji?: string): void;
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
  private readonly statusRuntime = new StatusLifecycleRuntime({
    state: this.gameStateManager,
    definitions: {
      get: statusId => this.dynamicStatusManager.getStatusDefinition(statusId),
      getTriggerEffects: (statusId, trigger) =>
        this.dynamicStatusManager.getStatusTriggerEffects(statusId, trigger),
    },
    transactions: this.sessionHost.triggerTransactionPorts(),
    execute: (effect, target, context) =>
      this.ports.executeProgram(effect, target === 'player', context),
    dispatch: dispatches => this.dispatch(dispatches),
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
    present: event => this.presentSummonStatusEvent(event),
  });
  private readonly activeSummonAbilities = new Set<string>();

  public constructor(private readonly ports: BattleTriggerHostPorts) {}

  public async dispatch(dispatches: readonly BattleTriggerDispatch[]): Promise<void> {
    await runBattleTriggerDispatches(dispatches, {
      runAbility: (target, trigger, context) => this.processAbilitiesByTrigger(target, trigger, context),
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

    await this.processAbilitiesByTrigger(targetType, 'ability_gain');
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
    await this.abilityRuntime.run(targetType, trigger, {
      ...context,
      eventJournal: this.gameStateManager.getGameState().eventJournal,
    });
    await this.processSummonAbilitiesByTrigger(targetType, trigger, context);
  }

  /** Run summon-local triggered abilities while keeping ordinary `self` bound to the exact unit. */
  public async processSummonAbilitiesByTrigger(
    owner: 'player' | 'enemy',
    trigger: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const requestedId = typeof context.summonId === 'string' ? context.summonId : null;
    const summons = this.gameStateManager.getSummons(owner).filter(unit => !requestedId || unit.instanceId === requestedId);
    for (const summon of summons) await this.processSummonUnitAbilities(summon, trigger, context);
  }

  public async processSummonUnitAbilities(
    summon: SummonUnit,
    trigger: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
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
  }

  public async applyStatus(targetType: 'player' | 'enemy', statusId: string, stacks: number): Promise<void> {
    await this.statusRuntime.apply(targetType, statusId, stacks);
  }

  public async removeStatuses(targetType: 'player' | 'enemy', selection: string): Promise<void> {
    await this.statusRuntime.remove(targetType, selection);
  }

  public async processStatusEffectsAtTurnEnd(targetType: 'player' | 'enemy'): Promise<void> {
    await this.statusRuntime.processTurnEnd(targetType);
  }

  public async applyStatusToSummons(targetIds: readonly string[], statusId: string, stacks: number): Promise<void> {
    await this.summonStatusRuntime.apply(targetIds, statusId, stacks);
  }

  public async removeStatusesFromSummons(targetIds: readonly string[], selection: string): Promise<void> {
    await this.summonStatusRuntime.remove(targetIds, selection);
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
        const context: BattleTriggerExecutionContext = {
          ...dispatchContext,
          triggerType: trigger,
          abilityContext: ability,
          ...(targetType === 'enemy' && typeof dispatchContext.enemyId === 'string'
            ? { battleContext: { enemyId: dispatchContext.enemyId } }
            : {}),
        };
        await this.ports.executeProgram(plan.program, targetType === 'player', context);
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
      this.recordSummonStatusEvent({
        kind: 'summon_status_applied',
        summon: event.summon,
        status: event.status,
        trigger: event.trigger,
      });
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
      this.recordSummonStatusEvent({
        kind: 'summon_status_removed',
        summon: event.summon,
        status: event.status,
        reason: event.reason,
      });
      this.ports.addLog(
        event.reason === 'decay'
          ? `${event.summon.name}的状态结束: ${event.status.name}`
          : `${event.summon.name}移除了状态: ${event.status.name}`,
        'info',
      );
      return;
    }
    if (event.type === 'trigger_completed') {
      this.recordSummonStatusEvent({
        kind: 'summon_status_triggered',
        summon: event.summon,
        status: event.status,
        trigger: event.trigger,
      });
      return;
    }
    this.ports.addLog(
      `${event.summon.name}的${event.status.name}${event.trigger}效果执行失败，战斗状态已回滚。`,
      'system',
    );
  }

  private recordSummonStatusEvent(
    event:
      | {
          kind: 'summon_status_applied'; summon: SummonUnit;
          status: StatusEffect;
          trigger: 'apply' | 'stack';
        }
      | {
          kind: 'summon_status_triggered'; summon: SummonUnit;
          status: StatusEffect; trigger: 'apply' | 'stack' | 'tick' | 'remove';
        }
      | {
          kind: 'summon_status_removed'; summon: SummonUnit;
          status: StatusEffect; reason: 'explicit' | 'decay';
        },
  ): void {
    const state = this.gameStateManager.getGameState();
    this.gameStateManager.recordBattleEvent({
      turn: state.currentTurn,
      phase: 'resolve',
      kind: event.kind,
      actorId: event.summon.instanceId,
      summonId: event.summon.instanceId,
      statusId: event.status.id,
      statusName: event.status.name,
      stacks: event.status.stacks,
      ...('trigger' in event ? { trigger: event.trigger } : { reason: event.reason }),
      cause: {
        source: {
          kind: 'status',
          id: event.status.id,
          name: event.status.name,
          ownerId: event.summon.instanceId,
        },
      },
    } as import('../../game-core').BattleEventDraft);
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
