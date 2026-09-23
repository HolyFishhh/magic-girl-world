import { type EffectProgram } from './effectDsl';
export type EffectTriggerPolicy = 'allow' | 'forbid' | 'require_root' | 'require_root_or_status';
export type EffectModifierPolicy = 'allow' | 'forbid' | 'only';
export interface EffectProgramPolicyOptions {
    triggerPolicy?: EffectTriggerPolicy;
    modifierPolicy?: EffectModifierPolicy;
    /** Whether the immediate program may read the energy actually paid by its card. */
    allowSpentEnergy?: boolean;
    /** Whether the immediate program belongs to an energy-X card and may read its resolved X value. */
    allowXValue?: boolean;
    /** Resource IDs whose actual paid amount may be read by the program. */
    allowSpentResources?: ReadonlySet<string>;
    /** Resource IDs whose resolved `all`/X value may be read by the program. */
    allowXResources?: ReadonlySet<string>;
    allowPendingResolution?: boolean;
    allowStatusStacks?: boolean;
    allowNarrate?: boolean;
    requireSingleNarrate?: boolean;
    /** Only programs executing as one exact summon may address its owner. */
    allowSummonerEffects?: boolean;
    /** Only the immediate program of the card currently being resolved may redirect that card. */
    allowCardDestination?: boolean;
    /** Only the immediate program of the card currently being resolved may request a complete replay. */
    allowCurrentCardReplay?: boolean;
    /** Player-owned authored programs may stage explicit battle-end attribute growth. */
    allowPersistentGrowth?: boolean;
    /**
     * Generated-card templates may be validated separately at their public
     * `creates[index]` authoring paths. Disable the recursive AST walk only in
     * that boundary validator so diagnostics never leak internal
     * `card.program.steps` paths back to an authoring model.
     */
    validateGeneratedCards?: boolean;
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
