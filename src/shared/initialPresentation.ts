import { readGameMode } from '../game-core/towerMode';

/** The single-floor initializer commits a run only after all content validates.
 * Empty/template cards are not proof of a successful start. Later acts, terminal
 * runs and archived expeditions retain their normal story/status presentation.
 */
export function isTowerInitialSetup(stat: Record<string, any>): boolean {
  return readGameMode(stat) === 'tower' && !stat.run && !stat.completed_expedition?.run;
}
