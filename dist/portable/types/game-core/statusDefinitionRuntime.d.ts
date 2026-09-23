import { type InterceptionRule } from './interception';
import { type StatusTrigger } from './battleTriggers';
import { type CompactCardDescriptionOptions } from './contentDescription';
import type { EffectProgram } from './effectDsl';
import { type DamageProtectionRule } from './damageProtection';
import { type StatusDefenseRule } from './statusDefense';
export type StatusRuntimeEffect = EffectProgram;
export type StatusTickTiming = 'before_action' | 'after_action';
export interface RuntimeStatusDefinition {
    tags?: string[];
    id: string;
    name: string;
    emoji: string;
    description: string;
    /** Authored flavor is preserved separately and never overrides the rules. */
    flavorText?: string;
    type: 'buff' | 'debuff' | 'neutral';
    stacks_change?: number | string;
    /** Tick effects resolve around the exact holder action; omitted content defaults before it. */
    tick_timing: StatusTickTiming;
    maxStacks?: number;
    stun: boolean;
    character_emoji?: string;
    triggers: Partial<Record<StatusTrigger, EffectProgram[]>>;
    protection?: DamageProtectionRule;
    defense?: StatusDefenseRule;
    intercepts?: InterceptionRule[];
    interceptCreates?: unknown;
}
export interface StatusDefinitionRegistryLoadResult {
    loaded: readonly RuntimeStatusDefinition[];
    rejected: readonly unknown[];
}
/** Normalize one modern shallow status definition into the portable runtime shape. */
export declare function normalizeRuntimeStatusDefinition(value: unknown, options?: CompactCardDescriptionOptions): RuntimeStatusDefinition | null;
export declare class StatusDefinitionRegistry {
    private readonly definitions;
    replace(values: readonly unknown[], options?: CompactCardDescriptionOptions): StatusDefinitionRegistryLoadResult;
    get(statusId: string): RuntimeStatusDefinition | undefined;
    getTriggerEffects(statusId: string, trigger: StatusTrigger): EffectProgram[];
    getAll(): Map<string, RuntimeStatusDefinition>;
}
