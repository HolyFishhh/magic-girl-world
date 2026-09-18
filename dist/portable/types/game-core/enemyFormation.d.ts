/** Frontline membership is execution state, not merely a rendering limit. */
export declare const ENEMY_FRONTLINE_SLOTS = 5;
export interface FormationMember {
    id: string;
    currentHp: number;
    stageSlot?: number;
    nextAction?: unknown;
}
export declare function arrangeEnemyFrontline<T extends FormationMember>(members: readonly T[], reserves?: readonly T[]): {
    frontline: T[];
    reserves: T[];
};
export declare function admitEnemyReserves<T extends FormationMember>(frontline: readonly T[], reserves: readonly T[]): {
    frontline: T[];
    reserves: T[];
    admitted: T[];
};
