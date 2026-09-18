import type { EffectProgram } from './effectDsl';
export type CompactStatusValidationResult = {
    ok: true;
} | {
    ok: false;
    message: string;
};
/** Threshold execution is a dedicated terminal phase, not a general tick. */
export declare function isThresholdExecuteProgram(program: EffectProgram): boolean;
/**
 * Collect independently discoverable defects from one status definition.
 * Keep the report bounded so a malformed object cannot flood the single
 * model-repair prompt, while avoiding fail-fast masking within one status.
 */
export declare function collectCompactStatusDefinitionIssues(value: unknown): string[];
/** Validate the only supported AI-facing shallow status format. */
export declare function validateCompactStatusDefinition(value: unknown): CompactStatusValidationResult;
export declare function collectEffectProgramStatusReferences(program: EffectProgram): Set<string>;
/** Collect status dependencies from one compact definition without executing it. */
export declare function collectCompactStatusDefinitionReferences(value: unknown): Set<string>;
