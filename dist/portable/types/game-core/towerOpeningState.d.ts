import type { TowerOpeningState } from './runState';
export interface TowerOpeningMutation {
    opening: TowerOpeningState;
    changed: boolean;
}
export declare function queueTowerOpening(opening: TowerOpeningState, seed: number, basedOnRevision: number): TowerOpeningMutation;
export declare function claimTowerOpening(opening: TowerOpeningState, expectedRequestId?: string): TowerOpeningMutation;
export declare function commitTowerOpening(opening: TowerOpeningState, result: {
    requestId: string;
    basedOnRevision: number;
    content: unknown;
}): TowerOpeningMutation;
export declare function failTowerOpening(opening: TowerOpeningState, result: {
    requestId: string;
    basedOnRevision: number;
    error?: string;
}): TowerOpeningMutation;
export declare function consumeTowerOpening(opening: TowerOpeningState): TowerOpeningMutation;
export declare function recoverInterruptedTowerOpening(opening: TowerOpeningState): TowerOpeningState;
