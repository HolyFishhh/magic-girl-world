import type { TowerNodeContentEnvelope } from './towerContentState';
export declare const CAMPFIRE_RULES: {
    readonly healRatio: 0.3;
    readonly maxHpGain: 5;
    readonly goldMinimum: 15;
    readonly goldMaximum: 35;
};
export type CampfireAction = 'rest' | 'train' | 'scavenge' | 'recall';
/** Fixed rooms have no model request, including their scene text. */
export declare function fixedCampfireEnvelope(previous: TowerNodeContentEnvelope): TowerNodeContentEnvelope;
/** Stable per room: reopening or reloading cannot reroll a payout. */
export declare function campfireGold(seed: number, nodeId: string): number;
