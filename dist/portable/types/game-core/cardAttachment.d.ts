import type { CardMoveReason, BattleEventSource } from './battleEventJournal';
import { type CardCostOperator, type CardKeyword, type CardPatchInheritancePolicy, type CardPatchScope, type PatchableCard } from './cardPatch';
import type { CardValueOperator, CardValueStat, NumericExpression } from './effectDsl';
import type { PlayedCardDestination } from './cardRules';
export type CardAttachmentKind = 'enchantment' | 'affliction';
export type CardAttachmentRemovalEvent = 'played' | 'discarded' | 'turn_end' | 'combat_end' | 'run_end' | 'manual';
export type CardAttachmentPatchChange = {
    kind: 'numeric';
    stat: CardValueStat;
    operator: CardValueOperator;
    value: number;
} | {
    kind: 'cost';
    operator: CardCostOperator;
    value: number;
} | {
    kind: 'keyword';
    keyword: CardKeyword;
    enabled: boolean;
} | {
    kind: 'replay';
    extra: number;
} | {
    kind: 'x_value';
    operator: CardCostOperator;
    value: number;
} | {
    kind: 'dynamic_cost';
    timing: 'on_draw' | 'while_in_hand' | 'on_play';
    operator: CardCostOperator;
    value: NumericExpression;
    minimum?: number;
    maximum?: number;
};
/** Card-local rule replacement. It composes with combatant-level card rules. */
export type CardAttachmentRuleChange = {
    kind: 'play_access';
    mode: 'deny' | 'allow';
} | {
    kind: 'discard_auto_play';
    reasons: CardMoveReason[];
    failureDestination: PlayedCardDestination;
    onlyPlayerTurn: boolean;
};
export type CardAttachmentChange = CardAttachmentPatchChange | CardAttachmentRuleChange;
export interface CardAttachment {
    id: string;
    kind: CardAttachmentKind;
    name: string;
    description?: string;
    emoji?: string;
    source: BattleEventSource;
    scope: CardPatchScope;
    appliedTurn: number;
    priority: number;
    removeOn: CardAttachmentRemovalEvent;
    /** Number of matching removal events left. Omitted means the named lifecycle boundary. */
    remaining?: number;
    /** Only meaningful for `discarded`; omitted means every real hand-discard reason. */
    discardReasons?: CardMoveReason[];
    changes: CardAttachmentChange[];
    patchIds: string[];
}
export interface CardAttachmentDraft {
    id: string;
    kind: CardAttachmentKind;
    name: string;
    description?: string;
    emoji?: string;
    source: BattleEventSource;
    scope: CardPatchScope;
    appliedTurn: number;
    priority?: number;
    removeOn?: CardAttachmentRemovalEvent;
    remaining?: number;
    discardReasons?: CardMoveReason[];
    changes: CardAttachmentChange[];
}
export interface CardWithAttachments extends PatchableCard {
    attachments?: CardAttachment[];
}
export declare function validateCardAttachmentDraft(draft: CardAttachmentDraft): void;
/** Add one named package atomically. A card may carry only one enchantment but multiple distinct afflictions. */
export declare function applyCardAttachment<TCard extends CardWithAttachments>(card: TCard, draft: CardAttachmentDraft): TCard;
export declare function removeCardAttachment<TCard extends CardWithAttachments>(card: TCard, attachmentId: string): TCard;
/** Advance named bundle lifetime after a completed event; all bundled patches are removed together. */
export declare function advanceCardAttachments<TCard extends CardWithAttachments>(card: TCard, event: CardAttachmentRemovalEvent, reason?: CardMoveReason): TCard;
export declare function inheritedCardAttachments(card: CardWithAttachments, policy: CardPatchInheritancePolicy): CardAttachment[];
export interface CardAttachmentPlayAccess {
    denied: boolean;
    explicitlyAllowed: boolean;
    sources: CardAttachment[];
}
export declare function resolveCardAttachmentPlayAccess(card: Pick<CardWithAttachments, 'attachments'>): CardAttachmentPlayAccess;
export interface DiscardAutoPlayResolution {
    attachment: CardAttachment;
    rule: Extract<CardAttachmentRuleChange, {
        kind: 'discard_auto_play';
    }>;
}
export interface CardDiscardLifecycleResolution {
    triggersDiscardLifecycle: boolean;
    autoPlay: DiscardAutoPlayResolution | null;
}
/** Resolve one deterministic auto-play request without treating cleanup, scry, or ordinary moves as a discard. */
export declare function resolveDiscardAutoPlay(card: Pick<CardWithAttachments, 'attachments'>, reason: CardMoveReason, phase: string): DiscardAutoPlayResolution | null;
/**
 * Classify one completed card move before firing discard programs, relics or Sly.
 * Cleanup, scry and non-hand moves remain journal events, but are not gameplay discards.
 */
export declare function resolveCardDiscardLifecycle(card: Pick<CardWithAttachments, 'attachments'>, reason: CardMoveReason, source: 'hand' | 'drawPile' | 'discardPile' | 'exhaustPile', phase: string): CardDiscardLifecycleResolution;
export declare function describeCardAttachmentRemaining(attachment: CardAttachment): string;
