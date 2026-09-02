import { type TowerOpeningOutcomePlan } from './towerOpeningOutcome';
import type { RunNodeOutcome } from './runState';
export interface TowerEventOutcomePlan extends Omit<TowerOpeningOutcomePlan, 'reward'> {
    routeOutcome: RunNodeOutcome;
    reward: Record<string, unknown> | null;
}
/**
 * Validate the compact, program-settled outcome used by pre-generated tower
 * events. Reward candidate validation remains runtime-owned because it needs
 * the player's current card/status/resource libraries.
 */
export declare function planTowerEventOutcome(value: unknown): TowerEventOutcomePlan;
