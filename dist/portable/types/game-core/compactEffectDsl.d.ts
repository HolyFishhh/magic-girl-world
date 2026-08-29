import { type EffectProgram, type EffectTarget } from './effectDsl';
import type { EventTriggerQuery } from './battleEventJournal';
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
/** Compile AI-facing shallow effects and optional card templates into the portable internal AST. */
export declare function compileCompactEffectList(value: unknown, options?: CompactEffectCompilationOptions): CompactEffectCompilationResult;
