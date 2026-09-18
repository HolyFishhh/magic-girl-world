/** Authored event stages are immutable. The cursor belongs to the run save. */
export interface TowerEventFlowChoice {
    id: string;
    label: string;
    description?: string;
    outcome: Record<string, unknown>;
    next_stage?: string;
}
export interface TowerEventFlowStage {
    id: string;
    narrative?: string;
    choices: TowerEventFlowChoice[];
}
export interface TowerEventFlow {
    version: 1 | 2;
    startStage: string;
    stages: TowerEventFlowStage[];
}
export interface TowerEventFlowState {
    spec: 'mwg.tower-event-state/v1';
    node_id: string;
    stage_id: string;
    revision: number;
    phase: 'choosing' | 'reward';
    next_stage?: string;
    /** Keyed by JSON.stringify([choice id, action id]); values are run instances. */
    random_targets: Record<string, string[]>;
    /** After a manual action, targets depend on that answer; freeze the ordering seed instead. */
    random_seeds?: Record<string, string>;
}
/**
 * Legacy choices keep their original terminal semantics. New stages use a
 * finite graph: every price, replacement and subsequent offer already exists
 * in the authored document, and following an edge never requires generation.
 * Outcome validation is supplied by the shared settlement contract caller.
 */
export declare function parseTowerEventFlow(value: unknown, validateOutcome: (outcome: Record<string, unknown>) => unknown): TowerEventFlow;
export declare function towerEventRandomKey(choiceId: string, actionId: string): string;
export declare function requireTowerEventStage(flow: TowerEventFlow, stageId: string): TowerEventFlowStage;
