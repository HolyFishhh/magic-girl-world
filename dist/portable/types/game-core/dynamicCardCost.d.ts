import type { CardCostOperator, CardPatchScope, PatchableCard } from './cardPatch';
import type { CardCost } from './combatResource';
import { type CardSelectorFilter, type CoreEffectState, type EffectExecutionContext, type NumericExpression } from './effectDsl';
export type DynamicCostTiming = 'on_draw' | 'while_in_hand' | 'on_play';
export interface DynamicCardCostRule {
    id: string;
    source: {
        kind: string;
        id: string;
        name?: string;
    };
    timing: DynamicCostTiming;
    scope: CardPatchScope;
    operator: CardCostOperator;
    value: NumericExpression;
    filter?: CardSelectorFilter;
    priority?: number;
    minimum?: number;
    maximum?: number;
}
export interface DynamicCardCostContext {
    state: CoreEffectState;
    effect: EffectExecutionContext;
    timing: DynamicCostTiming;
}
export interface DynamicCostLifecycleCard extends PatchableCard {
    /** Evaluated once when this concrete instance is drawn; cleared after it leaves play. */
    drawCostOverride?: CardCost;
    dynamicCostDrawTurn?: number;
}
export declare function cardDynamicCostRules(card: Pick<DynamicCostLifecycleCard, 'patches'>): DynamicCardCostRule[];
/** Resolve cost from the current base every time; while-in-hand rules never accumulate. */
export declare function resolveDynamicCardCost(card: DynamicCostLifecycleCard, rules: readonly DynamicCardCostRule[], context: DynamicCardCostContext): CardCost | undefined;
/** Freeze only draw-time randomness/conditions; later hand/play rules remain live. */
export declare function snapshotDynamicCardCostOnDraw<TCard extends DynamicCostLifecycleCard>(card: TCard, rules: readonly DynamicCardCostRule[], context: Omit<DynamicCardCostContext, 'timing'>): TCard;
/** Re-evaluate every live hand and play rule from the frozen draw cost without accumulating. */
export declare function resolveDynamicCardCostAtPlay(card: DynamicCostLifecycleCard, rules: readonly DynamicCardCostRule[], context: Omit<DynamicCardCostContext, 'timing'>): CardCost | undefined;
export declare function clearDynamicCardCostAfterPlay<TCard extends DynamicCostLifecycleCard>(card: TCard): TCard;
