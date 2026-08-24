import type { RunNodeChoice, RunState } from './runState';
/** Shared event-choice protocol text for every host that sends a route action. */
export declare function formatEventSelectionContext(node: Pick<RunNodeChoice, 'id' | 'kind'> | null | undefined): string;
export interface RoutePromptInput {
    node: RunNodeChoice;
    runSeed: number;
    run?: Pick<RunState, 'actCount' | 'floorsPerAct' | 'nodeCounts'> | null;
    worldContinuity?: string | null;
    buildBudget?: string | null;
    enemyBudget?: string | null;
    pending?: string | null;
    shopBudget?: string | null;
    buildGuidance?: string | null;
}
/** Compose one route request without letting a host duplicate marker ordering. */
export declare function formatRoutePrompt(input: RoutePromptInput): string;
export interface OptionPromptInput {
    optionText: string;
    battle: boolean;
    node?: Pick<RunNodeChoice, 'id' | 'kind'> | null;
    pending?: string | null;
    buildBudget?: string | null;
}
/** Compose normal and battle option messages while sharing event context and pending summaries. */
export declare function formatOptionPrompt(input: OptionPromptInput): string;
/** Keep AI-authored campfire patches small without exposing host-only card fields. */
export declare function compactCardForUpgrade(cardValue: unknown): Record<string, unknown>;
export interface RestUpgradePromptInput {
    node: Pick<RunNodeChoice, 'id' | 'kind'>;
    card: unknown;
}
/** Compose the one compact campfire upgrade request shared by every host. */
export declare function formatRestUpgradePrompt(input: RestUpgradePromptInput): string;
