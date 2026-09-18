import { type EncounterTrial } from './encounterEvaluation';
import type { TowerBuildMeasurement } from './towerEncounterBudget';
/** A versioned design index, NOT predicted win probability. Every number comes
 * from a complete production-engine trial. Pick one policy per scenario using
 * all its seeds; never splice offense from one policy and defense from another.
 */
export declare function assessMeasuredBuild(measurement: TowerBuildMeasurement | null | undefined): {
    spec: string;
    score: number | null;
    cases: {
        id: "desire" | "burst" | "single" | "group" | "swarm" | "endurance" | "duel" | "weakness";
        label: "欲望压力" | "单体持续压力" | "三敌持续压力" | "五敌多段压力" | "单体周期爆发" | "十回合续航" | "标准遭遇" | "虚弱干扰";
        best: {
            policy: string;
            rows: EncounterTrial[];
            score: number;
            floor: number;
        };
        candidates: {
            policy: string;
            rows: EncounterTrial[];
            score: number;
            floor: number;
        }[];
        turns: 6 | 10 | 5;
        detail: string;
    }[];
    dimensions: Record<string, string>;
    recommendations: string[];
    methodology: string[];
    completed: number;
} | null;
