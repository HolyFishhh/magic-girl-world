type MaybePromise<T> = T | Promise<T>;
export type TriggerTransactionFailurePolicy = 'propagate' | 'recover-and-continue';
/**
 * Diagnostics emitted after a recover-and-continue trigger was restored.
 * The error is the original trigger failure; a rollback failure still rejects.
 */
export interface RecoveredTriggerFailure {
    scope: string;
    error: unknown;
}
/**
 * Observers are deliberately diagnostic-only: their own failures cannot turn
 * an established recover-and-continue UI path into a failed battle action.
 */
export type TriggerTransactionRecoveryObserver = (failure: RecoveredTriggerFailure) => MaybePromise<void>;
export interface TriggerTransactionPorts<TToken> {
    beginTransaction(scope: string): MaybePromise<TToken>;
    commitTransaction(token: TToken): MaybePromise<void>;
    rollbackTransaction(token: TToken, cause?: unknown): MaybePromise<void>;
    /** Optional observer for callers that must distinguish recovered triggers from a clean run. */
    onRecoveredFailure?: TriggerTransactionRecoveryObserver;
}
export type TriggerTransactionResult<TValue> = {
    status: 'completed';
    value: TValue;
} | {
    status: 'rolled_back';
    cause: unknown;
};
export declare class TriggerTransactionRollbackError extends Error {
    readonly scope: string;
    readonly transactionCause: unknown;
    readonly rollbackCause: unknown;
    readonly name = "TriggerTransactionRollbackError";
    constructor(scope: string, transactionCause: unknown, rollbackCause: unknown);
}
/**
 * Run one nested trigger atomically without entering the player-action gate.
 * The host owns snapshots; callers own trigger-specific logging and recovery UX.
 */
export declare function runTriggerTransaction<TToken, TValue>(scope: string, ports: TriggerTransactionPorts<TToken>, execute: () => MaybePromise<TValue>, failurePolicy?: TriggerTransactionFailurePolicy): Promise<TriggerTransactionResult<TValue>>;
export {};
