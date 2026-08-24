type MaybePromise<T> = T | Promise<T>;
export type TriggerTransactionFailurePolicy = 'propagate' | 'recover-and-continue';
export interface TriggerTransactionPorts<TToken> {
    beginTransaction(scope: string): MaybePromise<TToken>;
    commitTransaction(token: TToken): MaybePromise<void>;
    rollbackTransaction(token: TToken, cause?: unknown): MaybePromise<void>;
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
