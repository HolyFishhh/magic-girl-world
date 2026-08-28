import {
  allocateRuntimeId,
  AbilityTriggerRuntime,
  runBattleTriggerDispatches,
  runTriggerTransaction,
  StatusLifecycleRuntime,
  type AbilityTrigger,
  type AbilityTriggerPlan,
  type BattleTriggerDispatch,
  type EffectProgram,
  type StatusLifecycleEvent,
} from '../../game-core';
import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import type { Ability, Enemy, Player, StatusEffect } from '../../game-core';
import { BattleSessionHost } from './battleSessionHost';
import { GameStateManager } from './gameStateManager';

export type BattleTriggerExecutionContext = Record<string, unknown> & {
  triggerType?: string;
  statusContext?: StatusEffect;
  abilityContext?: Ability;
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
  logStatusEffect(targetName: string, statusName: string, stacks: number, duration: number, isApply: boolean): void;
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
    readAbilities: target => this.getEntity(target)?.abilities,
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
    await this.abilityRuntime.run(targetType, trigger, context);
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

  private getEntity(targetType: 'player' | 'enemy'): Player | Enemy | null {
    return targetType === 'player' ? this.gameStateManager.getPlayer() : this.gameStateManager.getEnemy();
  }

  private updateAbilities(targetType: 'player' | 'enemy', abilities: Ability[]): void {
    if (targetType === 'player') this.gameStateManager.updatePlayer({ abilities });
    else this.gameStateManager.updateEnemy({ abilities });
  }
}
