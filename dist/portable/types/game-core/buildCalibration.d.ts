import { type EncounterEvaluation } from './encounterEvaluation';
/** Versioned, fixed opponents: player HP upgrades must not secretly strengthen the benchmark. */
export declare const BUILD_CALIBRATION_SPEC: "mwg.build-calibration/v1";
export declare const BUILD_REFERENCE_CASES: readonly [{
    readonly id: "single";
    readonly label: "单体持续压力";
    readonly count: 1;
    readonly turns: 5;
    readonly damage: 12;
    readonly hp: 400;
    readonly burst: false;
}, {
    readonly id: "group";
    readonly label: "三敌持续压力";
    readonly count: 3;
    readonly turns: 5;
    readonly damage: 12;
    readonly hp: 400;
    readonly burst: false;
}, {
    readonly id: "swarm";
    readonly label: "五敌多段压力";
    readonly count: 5;
    readonly turns: 5;
    readonly damage: 12;
    readonly hp: 400;
    readonly burst: false;
}, {
    readonly id: "burst";
    readonly label: "单体周期爆发";
    readonly count: 1;
    readonly turns: 6;
    readonly damage: 36;
    readonly hp: 400;
    readonly burst: true;
}, {
    readonly id: "endurance";
    readonly label: "十回合续航";
    readonly count: 1;
    readonly turns: 10;
    readonly damage: 12;
    readonly hp: 800;
    readonly burst: false;
}, {
    readonly id: "duel";
    readonly label: "标准遭遇";
    readonly count: 1;
    readonly turns: 6;
    readonly damage: 10;
    readonly hp: 90;
    readonly burst: false;
}, {
    readonly id: "desire";
    readonly label: "欲望压力";
    readonly count: 1;
    readonly turns: 6;
    readonly damage: 6;
    readonly hp: 120;
    readonly burst: false;
    readonly lust: 18;
}, {
    readonly id: "weakness";
    readonly label: "虚弱干扰";
    readonly count: 1;
    readonly turns: 6;
    readonly damage: 10;
    readonly hp: 120;
    readonly burst: false;
    readonly weakness: true;
}];
export interface BuildCalibrationCase {
    id: string;
    label: string;
    turns: number;
    enemyHp: number;
    pressure: string;
    policies: {
        policy: string;
        samples: number;
        survival: number | null;
        survivalFloor: number | null;
        offense: number | null;
    }[];
}
/** Actual final player health incorporates interception, mitigation, control, healing and kill prevention.
 * Summon pool size is not added to HP: non-intercepting or unused HP earns no imaginary protection.
 * These are scenario outcomes, not a universal power rating or win probability. */
export declare function calibrateBuildCase(reference: typeof BUILD_REFERENCE_CASES[number], result: EncounterEvaluation, maxHp: number): BuildCalibrationCase;
