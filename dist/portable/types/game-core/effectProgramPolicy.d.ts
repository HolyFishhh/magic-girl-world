import { type EffectProgram } from './effectDsl';
export type EffectTriggerPolicy = 'allow' | 'forbid' | 'require_root' | 'require_root_or_status';
export type EffectModifierPolicy = 'allow' | 'forbid' | 'only';
export interface EffectProgramPolicyOptions {
    triggerPolicy?: EffectTriggerPolicy;
    modifierPolicy?: EffectModifierPolicy;
    allowSpentEnergy?: boolean;
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
