import type { BattleTriggerDispatch } from './battleEventDispatch';
import type { BattleStateStore, StatusEffect } from './battleState';
import type { StatusTrigger } from './battleTriggers';
import type { RuntimeStatusDefinition, StatusRuntimeEffect } from './statusDefinitionRuntime';
import { type TriggerTransactionPorts } from './triggerTransaction';
type MaybePromise<T> = T | Promise<T>;
export type StatusLifecycleTarget = 'player' | 'enemy';
export type StatusLifecycleActiveTrigger = Exclude<StatusTrigger, 'hold'>;
export type StatusLifecycleState = Pick<BattleStateStore, 'getPlayer' | 'getEnemy' | 'addStatusEffect' | 'updateStatusEffect' | 'removeStatusEffect' | 'updatePlayer' | 'updateEnemy'>;
export interface StatusDefinitionReader {
    get(statusId: string): RuntimeStatusDefinition | undefined;
    getTriggerEffects(statusId: string, trigger: StatusTrigger): StatusRuntimeEffect[];
}
export interface StatusLifecycleExecutionContext extends Readonly<Record<string, unknown>> {
    triggerType: StatusLifecycleActiveTrigger;
    statusContext: StatusEffect;
}
export type StatusLifecycleEvent = {
    type: 'missing_definition';
    target: StatusLifecycleTarget;
    statusId: string;
} | {
    type: 'status_applied';
    target: StatusLifecycleTarget;
    status: StatusEffect;
    trigger: 'apply' | 'stack';
} | {
    type: 'trigger_started';
    target: StatusLifecycleTarget;
    status: StatusEffect;
    trigger: 'apply' | 'stack';
} | {
    type: 'status_removed';
    target: StatusLifecycleTarget;
    status: StatusEffect;
    reason: 'explicit' | 'decay';
} | {
    type: 'trigger_failed';
    target: StatusLifecycleTarget;
    status: StatusEffect;
    trigger: 'tick' | 'remove';
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
    present?(event: StatusLifecycleEvent): void;
}
/**
 * Portable status lifecycle. Apply/stack effects stay inside their caller's
 * outer action, while tick/remove use recover-and-continue nested snapshots.
 */
export declare class StatusLifecycleRuntime<TToken> {
    private readonly ports;
    constructor(ports: StatusLifecycleRuntimePorts<TToken>);
    apply(target: StatusLifecycleTarget, statusId: string, stacks: number): Promise<StatusEffect | null>;
    remove(target: StatusLifecycleTarget, selection: string): Promise<StatusEffect[]>;
    processTurnEnd(target: StatusLifecycleTarget): Promise<void>;
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
