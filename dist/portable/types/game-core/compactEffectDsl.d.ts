import { type ConditionExpression, type EffectProgram, type EffectTarget } from './effectDsl';
import { type EventTriggerQuery } from './battleEventJournal';
export interface CompactEffectValidationIssue {
    path: string;
    code: string;
    message: string;
}
export type CompactEffectCompilationResult = {
    ok: true;
    value: EffectProgram;
} | {
    ok: false;
    issues: CompactEffectValidationIssue[];
};
export interface CompactEffectCompilationOptions {
    trigger?: unknown;
    triggerQuery?: EventTriggerQuery;
    /** Optional condition shared by every top-level effect in a named definition. */
    when?: unknown;
    creates?: unknown;
    statusNames?: Readonly<Record<string, string>>;
    implicitTarget?: EffectTarget;
    /** Relative side whose combatant collection may be addressed by `targets`. */
    enemyCollectionTarget?: EffectTarget;
}
/** Keep structured trigger metadata identical to the model-facing JSON Schema. */
export declare function validateStructuredTriggerInput(value: unknown, path: string, issues: CompactEffectValidationIssue[]): void;
/** Compile one authored condition for a runtime feature that shares `when` semantics. */
export declare function compileCompactCondition(value: unknown, path?: string): {
    ok: true;
    value: ConditionExpression;
} | {
    ok: false;
    issues: CompactEffectValidationIssue[];
};
/** Compile AI-facing shallow effects and optional card templates into the portable internal AST. */
export declare function compileCompactEffectList(value: unknown, options?: CompactEffectCompilationOptions): CompactEffectCompilationResult;
