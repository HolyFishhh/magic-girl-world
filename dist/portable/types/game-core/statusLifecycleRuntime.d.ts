import type { BattleTriggerDispatch } from './battleEventDispatch';
import type { BattleStateStore, StatusEffect } from './battleState';
import type { BattleTriggerEventContext } from './battleEventJournal';
import type { StatusEventTrigger, StatusLifecycleTrigger, StatusTrigger } from './battleTriggers';
import { type StatusReceiveOptions } from './statusAction';
import type { RuntimeStatusDefinition, StatusRuntimeEffect, StatusTickTiming } from './statusDefinitionRuntime';
import { type TriggerTransactionPorts } from './triggerTransaction';
type MaybePromise<T> = T | Promise<T>;
export type StatusLifecycleTarget = 'player' | 'enemy';
export type StatusLifecycleActiveTrigger = Exclude<StatusLifecycleTrigger, 'hold' | 'threshold_execute'>;
export type StatusExecutableTrigger = StatusLifecycleActiveTrigger | StatusEventTrigger;
export type StatusLifecycleState = Pick<BattleStateStore, 'getPlayer' | 'getEnemy' | 'getEnemyById' | 'addStatusEffect' | 'updateStatusEffect' | 'removeStatusEffect' | 'updatePlayer' | 'updateEnemy'>;
export interface StatusDefinitionReader {
    get(statusId: string): RuntimeStatusDefinition | undefined;
    getTriggerEffects(statusId: string, trigger: StatusTrigger): StatusRuntimeEffect[];
}
export interface StatusLifecycleExecutionContext extends Readonly<Record<string, unknown>> {
    triggerType: StatusExecutableTrigger;
    statusContext: StatusEffect;
}
export type StatusLifecycleEvent = {
    type: 'missing_definition';
    target: StatusLifecycleTarget;
    statusId: string;
} | {
    type: 'status_applied';
    target: StatusLifecycleTarget;
    enemyId?: string;
    status: StatusEffect;
    trigger: 'apply' | 'stack';
} | {
    type: 'trigger_started';
    target: StatusLifecycleTarget;
    status: StatusEffect;
    trigger: StatusExecutableTrigger;
} | {
    type: 'trigger_completed';
    target: StatusLifecycleTarget;
    status: StatusEffect;
    trigger: StatusExecutableTrigger;
} | {
    type: 'status_removed';
    target: StatusLifecycleTarget;
    status: StatusEffect;
    reason: 'explicit' | 'decay';
} | {
    type: 'trigger_failed';
    target: StatusLifecycleTarget;
    status: StatusEffect;
    trigger: StatusExecutableTrigger;
    cause: unknown;
} | {
    type: 'selection_removed';
    target: StatusLifecycleTarget;
    selection: string;
    count: number;
};
export interface StatusLifecycleRuntimePorts<TToken> {
    state: StatusLifecycleState;
    definitions: StatusDefinitionReader;
    transactions: TriggerTransactionPorts<TToken>;
    execute(effect: StatusRuntimeEffect, source: StatusLifecycleTarget, context: StatusLifecycleExecutionContext): MaybePromise<void>;
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
export declare class StatusLifecycleRuntime<TToken> {
    private readonly ports;
    constructor(ports: StatusLifecycleRuntimePorts<TToken>);
    apply(target: StatusLifecycleTarget, statusId: string, stacks: number, options?: StatusReceiveOptions): Promise<StatusEffect | null>;
    remove(target: StatusLifecycleTarget, selection: string): Promise<StatusEffect[]>;
    removeStacks(target: StatusLifecycleTarget, id: string, count: number): Promise<void>;
    /** Consume precisely one holder-local defensive layer, including remove lifecycle. */
    consumeLayer(target: StatusLifecycleTarget, statusId: string): Promise<boolean>;
    /** Resolve tick effects for one exact holder at its declared action boundary. */
    processActionTiming(target: StatusLifecycleTarget, timing: StatusTickTiming, enemyId?: string): Promise<void>;
    /** Stack decay is independent of tick timing and occurs once at the holder's turn end. */
    processTurnEnd(target: StatusLifecycleTarget): Promise<void>;
    /**
     * Resolve one real battle event for statuses that were already active when
     * the event began. The caller supplies the frozen ids so a status created by
     * another listener cannot retroactively observe the event that created it.
     */
    processEvent(target: StatusLifecycleTarget, trigger: StatusEventTrigger, context?: Readonly<Record<string, unknown>>, activeStatusIds?: readonly string[]): Promise<void>;
    private removeOne;
    private applyStacksDecay;
    private executeIsolatedTrigger;
    private execute;
    private dispatchOwnership;
    private matchesSelection;
    private isAggregateSelection;
    private getEntity;
    private present;
}
export {};
