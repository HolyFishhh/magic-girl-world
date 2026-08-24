import { type EffectProgram } from './effectDsl';
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
    creates?: unknown;
    statusNames?: Readonly<Record<string, string>>;
}
/** Compile AI-facing shallow effects and optional card templates into the portable internal AST. */
export declare function compileCompactEffectList(value: unknown, options?: CompactEffectCompilationOptions): CompactEffectCompilationResult;
