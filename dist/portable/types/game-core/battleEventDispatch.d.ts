import { type AbilityTrigger, type StatusOwnershipChange } from './battleTriggers';
import type { BattleTriggerEventContext } from './battleEventJournal';
export type BattleSide = 'player' | 'enemy';
export type TriggerConsumer = 'ability' | 'relic';
export type TriggeredAttribute = 'hp' | 'lust' | 'block';
export interface BattleTriggerDispatch {
    consumer: TriggerConsumer;
    target: BattleSide;
    trigger: AbilityTrigger;
    context: Readonly<Record<string, unknown>>;
}
export interface AttributeTriggerContext {
    attribute: string;
    change: number;
    target: BattleSide;
    source: BattleSide;
    eventContext?: BattleTriggerEventContext;
}
/** Resolve the shared ability-first, relic-second order for one player-owned event. */
export declare function resolvePlayerTriggerDispatch(trigger: AbilityTrigger, context?: Readonly<Record<string, unknown>>): BattleTriggerDispatch[];
/** Resolve ability and player-relic notifications caused by one actual attribute delta. */
export declare function resolveAttributeTriggerDispatch(context: AttributeTriggerContext): BattleTriggerDispatch[];
export interface StatusOwnershipDispatchContext {
    target: BattleSide;
    /** Exact status holder. Required for enemy-owned status transitions in multi-enemy encounters. */
    targetId?: string;
    statusType: string;
    change: StatusOwnershipChange;
    eventContext?: BattleTriggerEventContext;
}
/** Resolve holder, opposing observer, and player-relic events for one status ownership transition. */
export declare function resolveStatusOwnershipTriggerDispatch(context: StatusOwnershipDispatchContext): BattleTriggerDispatch[];
