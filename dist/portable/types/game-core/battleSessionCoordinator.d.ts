import { type CardPlayCard, type CardPlayFailure, type CardPlayState, type CommittedCardPlay, type PreparedCardPlay } from './cardPlayTransaction';
import type { CardEnergyPayment, PlayedCardDestination } from './cardRules';
import { type BattleStartFlowResult, type BattleStartFlowStep, type BattleTurnFlowResult, type BattleTurnFlowStep } from './battleTurnFlow';
export type BattleSessionAction = 'battle_start' | 'play_card' | 'use_item' | 'end_turn';
type MaybePromise<T> = T | Promise<T>;
/** One shared gate prevents overlapping UI, API, or host actions from mutating a battle session. */
export declare class BattleSessionActionGate {
    private activeAction;
    tryEnter(action: BattleSessionAction): boolean;
    leave(action: BattleSessionAction): void;
    active(): BattleSessionAction | null;
}
export interface BattleSessionTransactionPorts<TToken> {
    gate: BattleSessionActionGate;
    beginTransaction(action: BattleSessionAction): MaybePromise<TToken>;
    commitTransaction(token: TToken): MaybePromise<void>;
    rollbackTransaction(token: TToken, cause?: unknown): MaybePromise<void>;
}
export interface BattleSessionAtomicActionPorts<TToken> extends BattleSessionTransactionPorts<TToken> {
    canRun(): boolean;
    isTerminal(): boolean;
}
export type BattleSessionAtomicActionResult<T> = {
    status: 'busy' | 'rejected' | 'terminal';
} | {
    status: 'completed';
    value: T;
};
/** Give non-card host actions the same mutual exclusion and rollback semantics as turns and card plays. */
export declare function runBattleSessionAtomicAction<TToken, TValue>(action: BattleSessionAction, ports: BattleSessionAtomicActionPorts<TToken>, execute: () => MaybePromise<TValue>): Promise<BattleSessionAtomicActionResult<TValue>>;
export interface BattleSessionStartPorts<TToken> extends BattleSessionTransactionPorts<TToken> {
    restored: boolean;
    isTerminal(): boolean;
    executeStartStep(step: BattleStartFlowStep): MaybePromise<void>;
}
export type BattleSessionStartResult = {
    status: 'busy' | 'restored' | 'terminal';
} | {
    status: 'completed' | 'stopped';
    flow: BattleStartFlowResult;
};
/** Run one-shot battle-start effects once, atomically, without owning host storage or presentation. */
export declare function startBattleSession<TToken>(ports: BattleSessionStartPorts<TToken>): Promise<BattleSessionStartResult>;
export interface BattleSessionTurnPorts<TToken> extends BattleSessionTransactionPorts<TToken> {
    canEndTurn(): boolean;
    isTerminal(): boolean;
    beginEnemyTurn(): MaybePromise<void>;
    executeTurnStep(step: BattleTurnFlowStep): MaybePromise<void>;
}
export type BattleSessionTurnResult = {
    status: 'busy' | 'rejected' | 'terminal';
} | {
    status: 'completed' | 'stopped';
    flow: BattleTurnFlowResult;
};
/** Run a complete player-end -> enemy -> next-player cycle as one host transaction. */
export declare function advanceBattleSessionTurn<TToken>(ports: BattleSessionTurnPorts<TToken>): Promise<BattleSessionTurnResult>;
export interface BattleSessionCardPlayPorts<TCard extends CardPlayCard, TToken> extends BattleSessionTransactionPorts<TToken> {
    readCardPlayState(): CardPlayState<TCard>;
    isTerminal(): boolean;
    presentCardPlay?(prepared: PreparedCardPlay<TCard>): MaybePromise<void>;
    applyCardPlayCommit(committed: CommittedCardPlay<TCard>): MaybePromise<void>;
    beginCardTransit(card: TCard): MaybePromise<void>;
    endCardTransit(card: TCard): MaybePromise<void>;
    executeCardEffect(card: TCard, payment: CardEnergyPayment, repeatIndex: number): MaybePromise<void>;
    movePlayedCard(card: TCard, destination: PlayedCardDestination): MaybePromise<void>;
    resolvePlayedCardDestination?(card: TCard, defaultDestination: PlayedCardDestination): PlayedCardDestination;
    triggerPostCardPlay(card: TCard): MaybePromise<void>;
    recordCardPlayEvent?(card: TCard, payment: CardEnergyPayment, event: {
        phase: 'before' | 'after';
        replayIndex: number;
        automatic: boolean;
    }): MaybePromise<void>;
    recordCardResourceSpent?(card: TCard, payment: CardEnergyPayment): MaybePromise<void>;
    recordPlayedCardMoved?(card: TCard, destination: PlayedCardDestination): MaybePromise<void>;
}
export type BattleSessionCardPlayResult<TCard extends CardPlayCard> = {
    status: 'busy';
} | {
    status: 'rejected';
    failure: CardPlayFailure;
} | {
    status: 'completed';
    card: TCard;
    destination: PlayedCardDestination;
    repeatsExecuted: number;
    terminal: boolean;
};
/**
 * Coordinate payment, effects, destination and post-play triggers around the portable card rules.
 * Effect-owned card choices remain inside CardEffectRuntime and share this outer transaction.
 */
export declare function playBattleSessionCard<TCard extends CardPlayCard, TToken>(cardId: string, ports: BattleSessionCardPlayPorts<TCard, TToken>): Promise<BattleSessionCardPlayResult<TCard>>;
export {};
