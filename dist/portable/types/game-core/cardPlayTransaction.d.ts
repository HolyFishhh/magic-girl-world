import { type CardRuleCard, type PlayedCardDestination } from './cardRules';
import { type CardPlayRuleEvent } from './cardPlayRuleRuntime';
import { type DynamicCardCostRule } from './dynamicCardCost';
import type { CoreEffectState, EffectExecutionContext } from './effectDsl';
import type { SelectableCard } from './cardSelectorRuntime';
import { type CardAttachment } from './cardAttachment';
import { type CardResourcePayment, type CardCost, type CombatResourcePool } from './combatResource';
export interface CardPlayCard extends CardRuleCard {
    doubleEffect?: boolean;
    replayCount?: number;
    attachments?: CardAttachment[];
}
export interface CardPlayState<TCard extends CardPlayCard> {
    phase: string;
    hasOpponent: boolean;
    hand: readonly TCard[];
    energy: number;
    /** Custom/current resource amounts; energy is always read from the dedicated compatibility field. */
    resources?: CombatResourcePool;
    cardsPlayedThisTurn: number;
    cardRuleUsesThisTurn?: number;
    attacksPlayedThisTurn?: number;
    skillsPlayedThisTurn?: number;
    stunned?: boolean;
    statusIds?: Iterable<string>;
    cardPlayRules?: readonly CardPlayRuleEvent[];
    playedCardsThisTurn?: readonly SelectableCard[];
    dynamicCostRules?: readonly DynamicCardCostRule[];
    dynamicCostState?: CoreEffectState;
    dynamicCostContext?: EffectExecutionContext;
}
export type CardPlayFailureCode = 'NO_OPPONENT' | 'WRONG_PHASE' | 'CARD_NOT_FOUND' | 'CURSE_UNPLAYABLE' | 'STUNNED' | 'DOMINATED_ATTACK' | 'SILENCED_SKILL' | 'RULE_DENIED' | 'RULE_LIMIT_REACHED' | 'INSUFFICIENT_ENERGY' | 'INSUFFICIENT_RESOURCE';
export interface CardPlayFailure {
    ok: false;
    code: CardPlayFailureCode;
    requiredEnergy?: number;
    availableEnergy?: number;
    resource?: string;
    requiredResource?: number;
    availableResource?: number;
    /** Cost preview metadata is retained for read-only UI even when payment cannot commit. */
    effectiveCost?: CardCost;
    payment?: CardResourcePayment;
}
export interface PreparedCardPlay<TCard extends CardPlayCard> {
    ok: true;
    card: TCard;
    payment: CardResourcePayment;
    destination: PlayedCardDestination;
    repeatCount: number;
}
export interface CommittedCardPlay<TCard extends CardPlayCard> extends PreparedCardPlay<TCard> {
    hand: TCard[];
    energy: number;
    resources: Record<string, number>;
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
