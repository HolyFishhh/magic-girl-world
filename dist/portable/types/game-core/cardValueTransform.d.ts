import type { CardValueOperator, CardValueStat, EffectProgram } from './effectDsl';
export interface CardValueTransform {
    stat: CardValueStat;
    operator: CardValueOperator;
    value: number;
}
/**
 * Change one family of authored card values without changing hit count, effect order,
 * conditions, targets, or generated-card templates.
 */
export declare function transformCardEffectProgram(program: EffectProgram, transform: CardValueTransform): EffectProgram;
