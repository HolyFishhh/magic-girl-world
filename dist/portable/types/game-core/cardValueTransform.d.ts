import type { CardValueOperator, CardValueStat, EffectProgram } from './effectDsl';
export interface CardValueTransform {
    stat: CardValueStat;
    operator: CardValueOperator;
    value: number;
}
/** Only the card's own execution tree counts; summon/template programs have another owner. */
export declare function hasCardValueTarget(program: EffectProgram | undefined, stat: CardValueStat): boolean;
/**
 * Change one family of authored card values without changing hit count, effect order,
 * conditions, targets, or generated-card templates.
 */
export declare function transformCardEffectProgram(program: EffectProgram, transform: CardValueTransform): EffectProgram;
/** True only for compiler-marked authored damage groups; legacy nodes remain one hit each. */
export declare function hasCardHitTarget(program: EffectProgram | undefined): boolean;
/** Add bounded strikes to each authored card-root damage group, never to summon/template programs. */
export declare function transformCardHitGroups(program: EffectProgram, add: number): EffectProgram;
/** Change only this card's offensive effects; summoned units and created cards keep their own targets. */
export declare function transformCardAttacksToArea(program: EffectProgram): EffectProgram;
