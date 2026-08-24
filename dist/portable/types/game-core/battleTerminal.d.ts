export type BattleEndResult = 'victory' | 'defeat' | 'terminated';
export type BattleTerminalSide = 'player' | 'enemy';
export interface BattleTerminalState {
    phase: string;
    isGameOver: boolean;
    battleResult: BattleEndResult | 'ongoing';
    battleNarrative: string;
}
/** Both sides reaching zero in one effect chain preserves the established player-priority rule. */
export declare function resolvePendingBattleEnd(pendingDeaths: Iterable<BattleTerminalSide>): BattleEndResult | null;
export declare function transitionToBattleEnd<TState extends BattleTerminalState>(state: TState, result: BattleEndResult, narrativeText?: string): TState;
export declare function readBattleEndResult(state: BattleTerminalState): BattleEndResult | null;
export declare function formatBattleEndResult(result: BattleEndResult): string;
