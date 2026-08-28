import { type EffectProgram, type EffectTarget } from './effectDsl';
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
    /** Optional condition shared by every top-level effect in a named definition. */
    when?: unknown;
    creates?: unknown;
    statusNames?: Readonly<Record<string, string>>;
    implicitTarget?: EffectTarget;
}
/** Compile AI-facing shallow effects and optional card templates into the portable internal AST. */
export declare function compileCompactEffectList(value: unknown, options?: CompactEffectCompilationOptions): CompactEffectCompilationResult;
