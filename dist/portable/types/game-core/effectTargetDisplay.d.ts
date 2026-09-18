import type { EnemyTargetSelector } from './combatantCollection';
export declare const describeEffectTarget: (target: "self" | "opponent", context: {
    selfLabel?: string;
    opponentLabel?: string;
}, selector?: EnemyTargetSelector) => string;
