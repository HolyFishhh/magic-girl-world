import { BattleSessionActionGate, type BattleSessionAction, type BattleSessionTransactionPorts, type TriggerTransactionPorts } from '../game-core';
export type SerializableClone<T> = (value: T) => T;
/**
 * Minimal storage adapter for websites, services, tests, and Mods.
 * It owns no battle rules; consumers pass these transaction ports to the game-core coordinator.
 */
export declare class ReferenceBattleSessionHost<TState> {
    private state;
    private readonly clone;
    readonly gate: BattleSessionActionGate;
    private readonly snapshots;
    private sequence;
    constructor(state: TState, clone?: SerializableClone<TState>);
    read(): TState;
    replace(state: TState): void;
    update(update: (draft: TState) => void): TState;
    beginTransaction(action: BattleSessionAction): string;
    beginScopedTransaction(scope: string): string;
    commitTransaction(token: string): void;
    rollbackTransaction(token: string): void;
    transactionPorts(): BattleSessionTransactionPorts<string>;
    triggerTransactionPorts(): TriggerTransactionPorts<string>;
}
