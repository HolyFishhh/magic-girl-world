export type BattleEndResult = 'victory' | 'defeat' | 'terminated';
export type BattleTerminalSide = 'player' | 'enemy';

export interface BattleTerminalState {
  phase: string;
  isGameOver: boolean;
  battleResult: BattleEndResult | 'ongoing';
  battleNarrative: string;
}

/** Both sides reaching zero in one effect chain preserves the established player-priority rule. */
export function resolvePendingBattleEnd(pendingDeaths: Iterable<BattleTerminalSide>): BattleEndResult | null {
  const deaths = new Set(pendingDeaths);
  if (deaths.has('enemy')) return 'victory';
  if (deaths.has('player')) return 'defeat';
  return null;
}

export function transitionToBattleEnd<TState extends BattleTerminalState>(
  state: TState,
  result: BattleEndResult,
  narrativeText = '',
): TState {
  return {
    ...state,
    phase: 'game_over',
    isGameOver: true,
    battleResult: result,
    battleNarrative: result === 'terminated' ? narrativeText : '',
  };
}

export function readBattleEndResult(state: BattleTerminalState): BattleEndResult | null {
  if (!state.isGameOver || state.phase !== 'game_over') return null;
  return state.battleResult === 'ongoing' ? null : state.battleResult;
}

export function formatBattleEndResult(result: BattleEndResult): string {
  return result === 'terminated' ? '战斗终止' : result === 'victory' ? '胜利' : '失败';
}
