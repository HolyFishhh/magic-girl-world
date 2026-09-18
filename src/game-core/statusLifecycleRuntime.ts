import type { BattleTriggerDispatch } from './battleEventDispatch';
import { resolveStatusOwnershipTriggerDispatch } from './battleEventDispatch';
import type { BattleStateStore, Enemy, Player, StatusEffect } from './battleState';
import type { BattleTriggerEventContext } from './battleEventJournal';
import type { StatusEventTrigger, StatusLifecycleTrigger, StatusTrigger } from './battleTriggers';
import { resolveStatusApplication, resolveStatusStacksChange } from './statusApplication';
import type { RuntimeStatusDefinition, StatusRuntimeEffect, StatusTickTiming } from './statusDefinitionRuntime';
import { runTriggerTransaction, type TriggerTransactionPorts } from './triggerTransaction';

type MaybePromise<T> = T | Promise<T>;
export type StatusLifecycleTarget = 'player' | 'enemy';
export type StatusLifecycleActiveTrigger = Exclude<StatusLifecycleTrigger, 'hold' | 'threshold_execute'>;
export type StatusExecutableTrigger = StatusLifecycleActiveTrigger | StatusEventTrigger;

export type StatusLifecycleState = Pick<
  BattleStateStore,
  | 'getPlayer'
  | 'getEnemy'
  | 'getEnemyById'
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
  triggerType: StatusExecutableTrigger;
  statusContext: StatusEffect;
}

export type StatusLifecycleEvent =
  | { type: 'missing_definition'; target: StatusLifecycleTarget; statusId: string }
  | {
      type: 'status_applied';
      target: StatusLifecycleTarget;
      enemyId?: string;
      status: StatusEffect;
      trigger: 'apply' | 'stack';
    }
  | {
      type: 'trigger_started';
      target: StatusLifecycleTarget;
      status: StatusEffect;
      trigger: StatusExecutableTrigger;
    }
  | {
      type: 'trigger_completed';
      target: StatusLifecycleTarget;
      status: StatusEffect;
      trigger: StatusExecutableTrigger;
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
      trigger: StatusExecutableTrigger;
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
  record?(event: Extract<StatusLifecycleEvent, {
    type: 'status_applied' | 'trigger_completed' | 'status_removed';
  }>): BattleTriggerEventContext | undefined;
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
    const appliedEvent = { type: 'status_applied', target, ...(target === 'enemy' ? { enemyId: this.ports.state.getEnemy()?.id } : {}), status: { ...active }, trigger: application.trigger } as const;
    const recordedApplication = this.ports.record?.(appliedEvent);
    this.present(appliedEvent);

    const effects = this.ports.definitions.getTriggerEffects(statusId, application.trigger);
    if (effects.length > 0) {
      this.present({ type: 'trigger_started', target, status: { ...active }, trigger: application.trigger });
    }
    for (const effect of effects) {
      await this.execute(effect, target, application.trigger, active, { ...recordedApplication });
    }
    if (effects.length > 0) {
      const completed = { type: 'trigger_completed', target, status: { ...active }, trigger: application.trigger } as const;
      this.ports.record?.(completed);
      this.present(completed);
    }
    await this.dispatchOwnership(target, definition.type, 'gain', recordedApplication);
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

  /** Resolve tick effects for one exact holder at its declared action boundary. */
  public async processActionTiming(
    target: StatusLifecycleTarget,
    timing: StatusTickTiming,
    enemyId?: string,
  ): Promise<void> {
    const entity = this.getEntity(target, enemyId);
    if (!entity || (target === 'enemy' && entity.currentHp <= 0)) return;
    // Do not resolve a side alias twice: a lethal tick may remove this enemy and
    // cause the legacy active-enemy alias to point at a later queue entry.
    const holderId = target === 'enemy' ? (entity as Enemy).id : undefined;
    for (const snapshot of [...entity.statusEffects]) {
      const holder = this.getEntity(target, holderId);
      if (!holder || (target === 'enemy' && holder.currentHp <= 0)) break;
      const status = holder.statusEffects.find(candidate => candidate.id === snapshot.id);
      if (!status || (this.ports.definitions.get(status.id)?.tick_timing ?? 'before_action') !== timing) continue;
      await this.executeIsolatedTrigger(
        target,
        { ...status },
        'tick',
        this.ports.definitions.getTriggerEffects(status.id, 'tick'),
        {},
        holderId,
      );
    }
  }

  /** Stack decay is independent of tick timing and occurs once at the holder's turn end. */
  public async processTurnEnd(target: StatusLifecycleTarget): Promise<void> {
    await this.applyStacksDecay(target);
  }

  /**
   * Resolve one real battle event for statuses that were already active when
   * the event began. The caller supplies the frozen ids so a status created by
   * another listener cannot retroactively observe the event that created it.
   */
  public async processEvent(
    target: StatusLifecycleTarget,
    trigger: StatusEventTrigger,
    context: Readonly<Record<string, unknown>> = {},
    activeStatusIds?: readonly string[],
  ): Promise<void> {
    const entity = this.getEntity(target);
    if (!entity) return;
    const snapshot = activeStatusIds
      ? [...new Set(activeStatusIds)]
      : entity.statusEffects.map(status => status.id);
    for (const statusId of snapshot) {
      const active = this.getEntity(target)?.statusEffects.find(status => status.id === statusId);
      if (!active) continue;
      await this.executeIsolatedTrigger(
        target,
        { ...active },
        trigger,
        this.ports.definitions.getTriggerEffects(statusId, trigger),
        context,
      );
    }
  }

  private async removeOne(
    target: StatusLifecycleTarget,
    statusId: string,
    reason: 'explicit' | 'decay',
  ): Promise<void> {
    const removed = this.getEntity(target)?.statusEffects.find(status => status.id === statusId);
    if (!removed) return;
    this.ports.state.removeStatusEffect(target, statusId);
    const removedEvent = { type: 'status_removed', target, status: { ...removed }, reason } as const;
    const recordedRemoval = this.ports.record?.(removedEvent);
    this.present(removedEvent);
    await this.executeIsolatedTrigger(
      target,
      removed,
      'remove',
      this.ports.definitions.getTriggerEffects(statusId, 'remove'),
      { ...recordedRemoval },
    );
    const statusType = this.ports.definitions.get(statusId)?.type || removed.type;
    await this.dispatchOwnership(target, statusType, 'lose', recordedRemoval);
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
      const removedEvent = { type: 'status_removed', target, status: { ...status }, reason: 'decay' } as const;
      const recordedRemoval = this.ports.record?.(removedEvent);
      this.present(removedEvent);
      await this.executeIsolatedTrigger(
        target,
        status,
        'remove',
        this.ports.definitions.getTriggerEffects(status.id, 'remove'),
        { ...recordedRemoval },
      );
      const statusType = this.ports.definitions.get(status.id)?.type || status.type;
      await this.dispatchOwnership(target, statusType, 'lose', recordedRemoval);
    }
  }

  private async executeIsolatedTrigger(
    target: StatusLifecycleTarget,
    status: StatusEffect,
    trigger: StatusExecutableTrigger,
    effects: readonly StatusRuntimeEffect[],
    context: Readonly<Record<string, unknown>> = {},
    enemyId?: string,
  ): Promise<void> {
    if (effects.length === 0) return;
    this.present({ type: 'trigger_started', target, status: { ...status }, trigger });
    const result = await runTriggerTransaction(
      `status_${trigger}_${target}_${status.id}`,
      this.ports.transactions,
      async () => {
        for (const effect of effects) {
          // A later enemy may become active after this holder dies. Never let a
          // remaining effect in this trigger migrate to that incidental alias.
          const holder = this.getEntity(target, enemyId);
          if (!holder || (target === 'enemy' && holder.currentHp <= 0)) break;
          await this.execute(effect, target, trigger, status, context, enemyId);
        }
      },
      'recover-and-continue',
    );
    if (result.status === 'rolled_back') {
      this.present({ type: 'trigger_failed', target, status: { ...status }, trigger, cause: result.cause });
    } else {
      const completed = { type: 'trigger_completed', target, status: { ...status }, trigger } as const;
      this.ports.record?.(completed);
      this.present(completed);
    }
  }

  private async execute(
    effect: StatusRuntimeEffect,
    target: StatusLifecycleTarget,
    trigger: StatusExecutableTrigger,
    status: StatusEffect,
    context: Readonly<Record<string, unknown>> = {},
    enemyId?: string,
  ): Promise<void> {
    // Apply/remove can run under a selected recipient scope without an explicit
    // enemyId argument. Snapshot that holder before entering its nested effects.
    const holder = target === 'enemy' ? this.getEntity(target) : null;
    const holderId = target === 'enemy' ? enemyId || (holder && 'id' in holder ? holder.id : undefined) : undefined;
    await this.ports.execute(effect, target, {
      ...context,
      ...(holderId ? { enemyId: holderId } : {}),
      triggerType: trigger,
      statusContext: { ...status },
    });
  }

  private async dispatchOwnership(
    target: StatusLifecycleTarget,
    statusType: string,
    change: 'gain' | 'lose',
    eventContext?: BattleTriggerEventContext,
  ): Promise<void> {
    const targetId = target === 'enemy' ? this.ports.state.getEnemy()?.id : undefined;
    await this.ports.dispatch(resolveStatusOwnershipTriggerDispatch({
      target,
      ...(targetId ? { targetId } : {}),
      statusType,
      change,
      ...(eventContext ? { eventContext } : {}),
    }));
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

  private getEntity(target: StatusLifecycleTarget, enemyId?: string): Player | Enemy | null {
    if (target === 'player') return this.ports.state.getPlayer();
    // Supplying an id intentionally disables the mutable active-enemy fallback.
    return enemyId ? this.ports.state.getEnemyById(enemyId) : this.ports.state.getEnemy();
  }

  private present(event: StatusLifecycleEvent): void {
    this.ports.present?.(event);
  }
}
