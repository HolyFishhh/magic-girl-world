import { type CardEnergyPayment, type CardRuleCard, type PlayedCardDestination } from './cardRules';
import { type CardPlayRuleEvent } from './cardPlayRuleRuntime';
import { type DynamicCardCostRule } from './dynamicCardCost';
import type { CoreEffectState, EffectExecutionContext } from './effectDsl';
export interface CardPlayCard extends CardRuleCard {
    doubleEffect?: boolean;
    replayCount?: number;
}
export interface CardPlayState<TCard extends CardPlayCard> {
    phase: string;
    hasOpponent: boolean;
    hand: readonly TCard[];
    energy: number;
    cardsPlayedThisTurn: number;
    cardRuleUsesThisTurn?: number;
    attacksPlayedThisTurn?: number;
    skillsPlayedThisTurn?: number;
    stunned?: boolean;
    statusIds?: Iterable<string>;
    cardPlayRules?: readonly CardPlayRuleEvent[];
    dynamicCostRules?: readonly DynamicCardCostRule[];
    dynamicCostState?: CoreEffectState;
    dynamicCostContext?: EffectExecutionContext;
}
export type CardPlayFailureCode = 'NO_OPPONENT' | 'WRONG_PHASE' | 'CARD_NOT_FOUND' | 'CURSE_UNPLAYABLE' | 'STUNNED' | 'DOMINATED_ATTACK' | 'SILENCED_SKILL' | 'INSUFFICIENT_ENERGY';
export interface CardPlayFailure {
    ok: false;
    code: CardPlayFailureCode;
    requiredEnergy?: number;
    availableEnergy?: number;
}
export interface PreparedCardPlay<TCard extends CardPlayCard> {
    ok: true;
    card: TCard;
    payment: CardEnergyPayment;
    destination: PlayedCardDestination;
    repeatCount: number;
}
export interface CommittedCardPlay<TCard extends CardPlayCard> extends PreparedCardPlay<TCard> {
    hand: TCard[];
    energy: number;
    cardsPlayedThisTurn: number;
    cardRuleUsesThisTurn: number;
    attacksPlayedThisTurn: number;
    skillsPlayedThisTurn: number;
}
export type PrepareCardPlayResult<TCard extends CardPlayCard> = PreparedCardPlay<TCard> | CardPlayFailure;
export type CommitCardPlayResult<TCard extends CardPlayCard> = CommittedCardPlay<TCard> | CardPlayFailure;
/** Validate a play before any selection UI or state mutation begins. */
export declare function prepareCardPlay<TCard extends CardPlayCard>(cardId: string, state: CardPlayState<TCard>): PrepareCardPlayResult<TCard>;
/** Commit from the latest state so animation or host work cannot overwrite newer values. */
export declare function commitCardPlay<TCard extends CardPlayCard>(prepared: PreparedCardPlay<TCard>, latest: CardPlayState<TCard>): CommitCardPlayResult<TCard>;
