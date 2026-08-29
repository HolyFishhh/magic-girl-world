import type { Ability, Relic } from './battleState';
import { type AbilityTrigger } from './battleTriggers';
import type { EffectProgram } from './effectDsl';
type MaybePromise<T> = T | Promise<T>;
export type TriggerExecutionContext = Readonly<Record<string, unknown>>;
export interface AbilityTriggerPlan {
    source: Ability;
    trigger: AbilityTrigger;
    program: EffectProgram;
}
export interface RelicTriggerPlan {
    source: Relic;
    trigger: AbilityTrigger;
    program: EffectProgram;
}
/** Resolve one ability without executing or translating modern programs. */
export declare function resolveAbilityTriggerPlan(ability: Ability, requestedTrigger: string, context?: TriggerExecutionContext): AbilityTriggerPlan | null;
/** Resolve one relic without executing or translating modern programs. */
export declare function resolveRelicTriggerPlan(relic: Relic, requestedTrigger: string, context?: TriggerExecutionContext): RelicTriggerPlan | null;
export interface AbilityTriggerRuntimePorts {
    readAbilities(target: 'player' | 'enemy', context?: TriggerExecutionContext): readonly Ability[] | undefined;
    execute(target: 'player' | 'enemy', plan: AbilityTriggerPlan, context: TriggerExecutionContext): MaybePromise<void>;
}
/** Portable ordered ability matching with recursion protection. */
export declare class AbilityTriggerRuntime {
    private readonly ports;
    private readonly active;
    constructor(ports: AbilityTriggerRuntimePorts);
    run(target: 'player' | 'enemy', requestedTrigger: string, context?: TriggerExecutionContext): Promise<void>;
}
export interface RelicTriggerRuntimePorts {
    readRelics(): readonly Relic[] | undefined;
    execute(plan: RelicTriggerPlan, context: TriggerExecutionContext): MaybePromise<void>;
}
/** Portable ordered relic matching with recursion protection. */
export declare class RelicTriggerRuntime {
    private readonly ports;
    private readonly active;
    constructor(ports: RelicTriggerRuntimePorts);
    run(requestedTrigger: string, context?: TriggerExecutionContext): Promise<void>;
}
export {};
