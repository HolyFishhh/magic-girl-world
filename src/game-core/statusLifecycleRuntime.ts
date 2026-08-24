import type { BattleTriggerDispatch } from './battleEventDispatch';
import { resolveStatusOwnershipTriggerDispatch } from './battleEventDispatch';
import type { BattleStateStore, Enemy, Player, StatusEffect } from './battleState';
import type { StatusTrigger } from './battleTriggers';
import { resolveStatusApplication, resolveStatusStacksChange } from './statusApplication';
import type { RuntimeStatusDefinition, StatusRuntimeEffect } from './statusDefinitionRuntime';
import { runTriggerTransaction, type TriggerTransactionPorts } from './triggerTransaction';

type MaybePromise<T> = T | Promise<T>;
export type StatusLifecycleTarget = 'player' | 'enemy';
export type StatusLifecycleActiveTrigger = Exclude<StatusTrigger, 'hold'>;

export type StatusLifecycleState = Pick<
  BattleStateStore,
  | 'getPlayer'
  | 'getEnemy'
  | 'addStatusEffect'
  | 'updateStatusEffect'
  | 'removeStatusEffect'
  | 'updatePlayer'
  | 'updateEnemy'
>;

export interface StatusDefinitionReader {
  get(statusId: string): RuntimeStatusDefinition | undefined;
  getTriggerEffects(statusId: string, trigger: StatusTrigger): StatusRuntimeEffect[];
}

export interface StatusLifecycleExecutionContext extends Readonly<Record<string, unknown>> {
  triggerType: StatusLifecycleActiveTrigger;
  statusContext: StatusEffect;
}

export type StatusLifecycleEvent =
  | { type: 'missing_definition'; target: StatusLifecycleTarget; statusId: string }
  | {
      type: 'status_applied';
      target: StatusLifecycleTarget;
      status: StatusEffect;
      trigger: 'apply' | 'stack';
    }
  | {
      type: 'trigger_started';
      target: StatusLifecycleTarget;
      status: StatusEffect;
      trigger: 'apply' | 'stack';
    }
  | {
      type: 'status_removed';
      target: StatusLifecycleTarget;
      status: StatusEffect;
      reason: 'explicit' | 'decay';
    }
  | {
      type: 'trigger_failed';
      target: StatusLifecycleTarget;
      status: StatusEffect;
      trigger: 'tick' | 'remove';
      cause: unknown;
    }
  | {
      type: 'selection_removed';
      target: StatusLifecycleTarget;
      selection: string;
      count: number;
    };

export interface StatusLifecycleRuntimePorts<TToken> {
  state: StatusLifecycleState;
  definitions: StatusDefinitionReader;
  transactions: TriggerTransactionPorts<TToken>;
  execute(
    effect: StatusRuntimeEffect,
    source: StatusLifecycleTarget,
    context: StatusLifecycleExecutionContext,
  ): MaybePromise<void>;
  dispatch(dispatches: readonly BattleTriggerDispatch[]): MaybePromise<void>;
  present?(event: StatusLifecycleEvent): void;
}

/**
 * Portable status lifecycle. Apply/stack effects stay inside their caller's
 * outer action, while tick/remove use recover-and-continue nested snapshots.
 */
export class StatusLifecycleRuntime<TToken> {
  public constructor(private readonly ports: StatusLifecycleRuntimePorts<TToken>) {}

  public async apply(
    target: StatusLifecycleTarget,
    statusId: string,
    stacks: number,
  ): Promise<StatusEffect | null> {
    const definition = this.ports.definitions.get(statusId);
    if (!definition) {
      this.present({ type: 'missing_definition', target, statusId });
      return null;
    }

    const existing = this.getEntity(target)?.statusEffects.find(status => status.id === statusId);
    const application = resolveStatusApplication(existing?.stacks, stacks, definition.maxStacks);
    if (!application.trigger) return existing ? { ...existing } : null;

    const status: StatusEffect = {
      id: statusId,
      name: definition.name,
      type: definition.type,
      description: definition.description,
      emoji: definition.emoji,
      stacks: application.nextStacks,
    };
    if (existing) this.ports.state.updateStatusEffect(target, statusId, { stacks: application.nextStacks });
    else this.ports.state.addStatusEffect(target, status);

    const active = this.getEntity(target)?.statusEffects.find(candidate => candidate.id === statusId) || status;
    this.present({ type: 'status_applied', target, status: { ...active }, trigger: application.trigger });

    const effects = this.ports.definitions.getTriggerEffects(statusId, application.trigger);
    if (effects.length > 0) {
      this.present({ type: 'trigger_started', target, status: { ...active }, trigger: application.trigger });
    }
    for (const effect of effects) {
      await this.execute(effect, target, application.trigger, active);
    }
    await this.dispatchOwnership(target, definition.type, 'gain');
    return { ...active };
  }

  public async remove(target: StatusLifecycleTarget, selection: string): Promise<StatusEffect[]> {
    const entity = this.getEntity(target);
    if (!entity) return [];
    const selected = entity.statusEffects.filter(status => this.matchesSelection(status, selection));
    for (const status of selected) await this.removeOne(target, status.id, 'explicit');
    if (selected.length > 0 && this.isAggregateSelection(selection)) {
      this.present({ type: 'selection_removed', target, selection, count: selected.length });
    }
    return selected.map(status => ({ ...status }));
  }

  public async processTurnEnd(target: StatusLifecycleTarget): Promise<void> {
    const entity = this.getEntity(target);
    if (!entity) return;
    for (const status of [...entity.statusEffects]) {
      await this.executeIsolatedTrigger(
        target,
        status,
        'tick',
        this.ports.definitions.getTriggerEffects(status.id, 'tick'),
      );
    }
    await this.applyStacksDecay(target);
  }

  private async removeOne(
    target: StatusLifecycleTarget,
    statusId: string,
    reason: 'explicit' | 'decay',
  ): Promise<void> {
    const removed = this.getEntity(target)?.statusEffects.find(status => status.id === statusId);
    if (!removed) return;
    this.ports.state.removeStatusEffect(target, statusId);
    this.present({ type: 'status_removed', target, status: { ...removed }, reason });
    await this.executeIsolatedTrigger(
      target,
      removed,
      'remove',
      this.ports.definitions.getTriggerEffects(statusId, 'remove'),
    );
    const statusType = this.ports.definitions.get(statusId)?.type || removed.type;
    await this.dispatchOwnership(target, statusType, 'lose');
  }

  private async applyStacksDecay(target: StatusLifecycleTarget): Promise<void> {
    const entity = this.getEntity(target);
    if (!entity) return;
    const updated = entity.statusEffects
      .map(status => {
        const change = this.ports.definitions.get(status.id)?.stacks_change;
        return change === undefined ? { ...status } : { ...status, stacks: resolveStatusStacksChange(status.stacks, change) };
      })
      .filter(status => status.stacks > 0);
    const removed = entity.statusEffects.filter(status => !updated.some(candidate => candidate.id === status.id));

    if (target === 'player') this.ports.state.updatePlayer({ statusEffects: updated });
    else this.ports.state.updateEnemy({ statusEffects: updated });

    for (const status of removed) {
      this.present({ type: 'status_removed', target, status: { ...status }, reason: 'decay' });
      await this.executeIsolatedTrigger(
        target,
        status,
        'remove',
        this.ports.definitions.getTriggerEffects(status.id, 'remove'),
      );
      const statusType = this.ports.definitions.get(status.id)?.type || status.type;
      await this.dispatchOwnership(target, statusType, 'lose');
    }
  }

  private async executeIsolatedTrigger(
    target: StatusLifecycleTarget,
    status: StatusEffect,
    trigger: 'tick' | 'remove',
    effects: readonly StatusRuntimeEffect[],
  ): Promise<void> {
    if (effects.length === 0) return;
    const result = await runTriggerTransaction(
      `status_${trigger}`,
      this.ports.transactions,
      async () => {
        for (const effect of effects) await this.execute(effect, target, trigger, status);
      },
      'recover-and-continue',
    );
    if (result.status === 'rolled_back') {
      this.present({ type: 'trigger_failed', target, status: { ...status }, trigger, cause: result.cause });
    }
  }

  private async execute(
    effect: StatusRuntimeEffect,
    target: StatusLifecycleTarget,
    trigger: StatusLifecycleActiveTrigger,
    status: StatusEffect,
  ): Promise<void> {
    await this.ports.execute(effect, target, {
      triggerType: trigger,
      statusContext: { ...status },
    });
  }

  private async dispatchOwnership(
    target: StatusLifecycleTarget,
    statusType: string,
    change: 'gain' | 'lose',
  ): Promise<void> {
    await this.ports.dispatch(resolveStatusOwnershipTriggerDispatch({ target, statusType, change }));
  }

  private matchesSelection(status: StatusEffect, selection: string): boolean {
    if (selection === 'all_buffs') return true;
    const type = this.ports.definitions.get(status.id)?.type;
    if (selection === 'buffs') return type === 'buff';
    if (selection === 'debuffs') return type === 'debuff';
    return status.id === selection;
  }

  private isAggregateSelection(selection: string): boolean {
    return selection === 'all_buffs' || selection === 'buffs' || selection === 'debuffs';
  }

  private getEntity(target: StatusLifecycleTarget): Player | Enemy | null {
    return target === 'player' ? this.ports.state.getPlayer() : this.ports.state.getEnemy();
  }

  private present(event: StatusLifecycleEvent): void {
    this.ports.present?.(event);
  }
}
