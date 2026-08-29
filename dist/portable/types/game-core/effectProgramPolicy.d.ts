import { type EffectProgram } from './effectDsl';
export type EffectTriggerPolicy = 'allow' | 'forbid' | 'require_root' | 'require_root_or_status';
export type EffectModifierPolicy = 'allow' | 'forbid' | 'only';
export interface EffectProgramPolicyOptions {
    triggerPolicy?: EffectTriggerPolicy;
    modifierPolicy?: EffectModifierPolicy;
    allowSpentEnergy?: boolean;
    /** Resource IDs whose actual paid amount may be read by the program. */
    allowSpentResources?: ReadonlySet<string>;
    /** Resource IDs whose resolved `all`/X value may be read by the program. */
    allowXResources?: ReadonlySet<string>;
    allowStatusStacks?: boolean;
    allowNarrate?: boolean;
    requireSingleNarrate?: boolean;
    knownStatusIds?: ReadonlySet<string>;
}
export interface EffectProgramPolicyIssue {
    path: string;
    code: string;
    message: string;
}
export type EffectProgramPolicyResult = {
    ok: true;
    value: EffectProgram;
} | {
    ok: false;
    issues: EffectProgramPolicyIssue[];
};
/** Enforce where a portable program may be used. */
export declare function validateEffectProgramPolicy(value: unknown, options?: EffectProgramPolicyOptions): EffectProgramPolicyResult;
