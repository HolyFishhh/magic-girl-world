import { type StatusTrigger } from './battleTriggers';
import type { EffectProgram } from './effectDsl';
export type StatusRuntimeEffect = EffectProgram;
export interface RuntimeStatusDefinition {
    id: string;
    name: string;
    emoji: string;
    description: string;
    type: 'buff' | 'debuff' | 'neutral';
    stacks_change?: number | string;
    maxStacks?: number;
    stun: boolean;
    triggers: Partial<Record<StatusTrigger, EffectProgram[]>>;
}
export interface StatusDefinitionRegistryLoadResult {
    loaded: readonly RuntimeStatusDefinition[];
    rejected: readonly unknown[];
}
/** Normalize one modern shallow status definition into the portable runtime shape. */
export declare function normalizeRuntimeStatusDefinition(value: unknown, options?: {
    statusNames?: Readonly<Record<string, string>>;
}): RuntimeStatusDefinition | null;
export declare class StatusDefinitionRegistry {
    private readonly definitions;
    replace(values: readonly unknown[], options?: {
        statusNames?: Readonly<Record<string, string>>;
    }): StatusDefinitionRegistryLoadResult;
    get(statusId: string): RuntimeStatusDefinition | undefined;
    getTriggerEffects(statusId: string, trigger: StatusTrigger): EffectProgram[];
    getAll(): Map<string, RuntimeStatusDefinition>;
}
