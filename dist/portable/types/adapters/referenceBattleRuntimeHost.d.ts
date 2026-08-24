import { BattleSessionActionGate, BattleEffectRuntime, BattleStateStore, CardEffectRuntime, AbilityTriggerRuntime, RelicTriggerRuntime, StatusLifecycleRuntime, type AbilityTriggerRuntimePorts, type BattleSessionAction, type BattleEffectRuntimePorts, type BattleSessionTransactionPorts, type CardEffectRuntimePorts, type GameState, type TriggerTransactionPorts, type RelicTriggerRuntimePorts, type StatusDefinitionReader, type StatusLifecycleRuntimePorts } from '../game-core';
/**
 * Reference host for websites, services, tests, and Mods.
 * It combines portable battle state with the shared transaction protocols and no Tavern dependencies.
 */
export declare class ReferenceBattleRuntimeHost extends BattleStateStore {
    readonly gate: BattleSessionActionGate;
    private sequence;
    constructor(initialState?: GameState);
    beginTransaction(action: BattleSessionAction): string;
    beginScopedTransaction(scope: string): string;
    commitTransaction(token: string): void;
    rollbackTransaction(token: string): void;
    transactionPorts(): BattleSessionTransactionPorts<string>;
    triggerTransactionPorts(): TriggerTransactionPorts<string>;
    createCardEffectRuntime(ports: CardEffectRuntimePorts): CardEffectRuntime;
    createBattleEffectRuntime(ports: BattleEffectRuntimePorts): BattleEffectRuntime;
    createAbilityTriggerRuntime(execute: AbilityTriggerRuntimePorts['execute']): AbilityTriggerRuntime;
    createRelicTriggerRuntime(execute: RelicTriggerRuntimePorts['execute']): RelicTriggerRuntime;
    createStatusLifecycleRuntime(definitions: StatusDefinitionReader, ports: Omit<StatusLifecycleRuntimePorts<string>, 'state' | 'definitions' | 'transactions'>): StatusLifecycleRuntime<string>;
}
