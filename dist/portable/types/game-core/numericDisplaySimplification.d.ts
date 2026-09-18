import type { NumericExpression } from './effectDsl';
/** Never changes the stored/executed expression. Fold safe integer additions and redundant guards only. */
export declare function simplifyNumericDisplay(value: NumericExpression): NumericExpression;
