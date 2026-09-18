import { renderCharacterStatus } from '../../shared/characterStatus';
import { type GameState } from '../../game-core';

/** Story, active battle, status: route selection belongs to the common view. */
export function renderBattleOverview(stat: Record<string, any>, state: GameState): void {
  const board = document.querySelector<HTMLElement>('.card-game-container');
  if (!board) return;
  const story = document.getElementById('mwg-story-panel');
  const status = renderCharacterStatus(stat, state);
  // Remove obsolete wrappers without turning the board into a floating layer.
  if (board.parentElement !== document.body) document.body.append(board);
  if (story && story.nextElementSibling !== board) board.before(story);
  if (board.nextElementSibling !== status) board.after(status);
  document.getElementById('mwg-adventure-fold')?.remove();
  document.getElementById('mwg-route-fold')?.remove();
}

export function destroyBattleOverview(): void { /* Shared status has no battle subscription. */ }
