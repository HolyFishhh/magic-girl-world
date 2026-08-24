/** Portable numeric rules shared by battle runtimes and adapters. */
export type BattleNumericOperator = '+' | '-' | '*' | '/' | '=' | 'set';
export interface BattleAttributeLimits {
    maxHp?: number;
    maxLust?: number;
}
export interface BlockAbsorptionResult {
    damage: number;
    blockUsed: number;
    remainingBlock: number;
}
/** Parse a complete numeric literal without accepting parseFloat-style trailing content. */
export declare function parseBattleNumericLiteral(value: unknown): number | null;
export declare function applyNumericOperator(current: number, operator: string, operand: number): number;
export declare function clampBattleAttribute(attribute: string, value: number, limits?: BattleAttributeLimits): number;
export declare function roundBattleValue(value: number): number;
export declare function absorbDamageWithBlock(incomingDamage: number, currentBlock: number): BlockAbsorptionResult;
/** Evaluate numeric arithmetic without executing JavaScript or rounding the result. */
export declare function evaluateFiniteBattleMathExpression(expression: string): number;
/** Evaluate an effect amount and apply the battle rule that amounts are integers. */
export declare function evaluateBattleMathExpression(expression: string): number;
/** Evaluate a variable-free battle condition without executing JavaScript. */
export declare function evaluateBattleConditionExpression(expression: string): boolean;
