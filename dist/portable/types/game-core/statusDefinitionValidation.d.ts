import type { EffectProgram } from './effectDsl';
export type CompactStatusValidationResult = {
    ok: true;
} | {
    ok: false;
    message: string;
};
/** Validate the only supported AI-facing shallow status format. */
export declare function validateCompactStatusDefinition(value: unknown): CompactStatusValidationResult;
export declare function collectEffectProgramStatusReferences(program: EffectProgram): Set<string>;
/** Collect status dependencies from one compact definition without executing it. */
export declare function collectCompactStatusDefinitionReferences(value: unknown): Set<string>;
