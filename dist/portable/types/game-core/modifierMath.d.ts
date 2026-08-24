import { type CoreEffectState, type EffectExecutionContext, type EffectModifierOperator, type EffectProgram, type EffectTarget, type ModifierStat } from './effectDsl';
/** Portable modifier parsing and aggregation rules. */
export type ModifierOperator = '+' | '-' | '*' | '/' | '=';
export interface ModifierOperation {
    operator: ModifierOperator;
    value: number;
}
export interface ModifierBreakdown {
    add: number;
    mul: number;
}
export declare const MODIFIER_ATTRIBUTE_BY_STAT: Record<ModifierStat, string>;
export declare const MODIFIER_SYMBOL_BY_OPERATOR: Record<EffectModifierOperator, ModifierOperator>;
export interface ResolvedProgramModifier {
    target: EffectTarget;
    stat: ModifierStat;
    operation: ModifierOperation;
}
/** Resolve validated modifier programs through the existing core evaluator. */
export declare function resolveEffectProgramModifiers(program: EffectProgram, state: CoreEffectState, context?: EffectExecutionContext): ResolvedProgramModifier[];
export declare function applyModifierOperation(currentValue: number, operation: ModifierOperation): number;
export declare function addModifierOperation(breakdown: ModifierBreakdown, operation: ModifierOperation): ModifierBreakdown;
export declare function roundModifierBreakdown(breakdown: ModifierBreakdown): ModifierBreakdown;
