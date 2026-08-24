export type CoreBattlePhase = 'setup' | 'player_turn' | 'enemy_turn' | 'game_over';

export interface BattleTurnState {
  currentTurn: number;
  cardsPlayedThisTurn: number;
  attacksPlayedThisTurn: number;
  skillsPlayedThisTurn: number;
  phase: CoreBattlePhase;
  isGameOver: boolean;
}

function normalizedTurn(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function beginEnemyTurn<TState extends BattleTurnState>(state: TState): TState {
  if (state.isGameOver || state.phase !== 'player_turn') return state;
  return { ...state, phase: 'enemy_turn' };
}

export function advanceTurnCounter<TState extends BattleTurnState>(state: TState): TState {
  if (state.isGameOver) return state;
  return { ...state, currentTurn: normalizedTurn(state.currentTurn) + 1 };
}

export function beginPlayerTurn<TState extends BattleTurnState>(state: TState): TState {
  if (state.isGameOver) return state;
  return {
    ...state,
    phase: 'player_turn',
    cardsPlayedThisTurn: 0,
    attacksPlayedThisTurn: 0,
    skillsPlayedThisTurn: 0,
  };
}
