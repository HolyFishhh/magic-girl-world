import type { ActiveStance } from './specialCombatContainers';
import { type AbilityTriggerPlan, type TriggerExecutionContext } from './triggerDefinitionRuntime';
type Side = 'player' | 'enemy';
export interface StanceTriggerRuntimePorts {
    readStance(side: Side, context: TriggerExecutionContext): ActiveStance | null | undefined;
    execute(side: Side, plan: AbilityTriggerPlan, context: TriggerExecutionContext): void | Promise<void>;
}
/**
 * A stance owns listeners only while this exact activation remains installed.
 * Prepare before other listeners run: a stance acquired mid-event cannot react
 * retroactively. The in-flight effect finishes, but leaving/re-entering cancels
 * any remaining listeners from the former activation. No permanent abilities
 * are added; save/load persists definitions in the ordinary stance snapshot.
 */
export declare class StanceTriggerRuntime {
    private readonly ports;
    private readonly active;
    constructor(ports: StanceTriggerRuntimePorts);
    prepare(side: Side, requestedTrigger: string, context?: TriggerExecutionContext): () => Promise<void>;
}
export {};
