export type CoreBattlePhase = 'setup' | 'player_turn' | 'enemy_turn' | 'game_over';
export interface BattleTurnState {
    currentTurn: number;
    cardsPlayedThisTurn: number;
    attacksPlayedThisTurn: number;
    skillsPlayedThisTurn: number;
    phase: CoreBattlePhase;
    isGameOver: boolean;
}
export declare function beginEnemyTurn<TState extends BattleTurnState>(state: TState): TState;
export declare function advanceTurnCounter<TState extends BattleTurnState>(state: TState): TState;
export declare function beginPlayerTurn<TState extends BattleTurnState>(state: TState): TState;
