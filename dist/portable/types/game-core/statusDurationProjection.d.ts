/** Isolated holder-action-phase application. This is not whole-combat reachability:
 * other cards, statuses, enemies and lifecycle effects may change the stacks. */
export declare function projectStatusThroughNextTurn(input: {
    incomingStacks: number;
    currentStacks?: number;
    maxStacks?: number;
    stacksChange?: number | string;
}): {
    projected: false;
    reason: "unsupported_or_invalid_numeric_input";
    initialStacks?: undefined;
    applicationTrigger?: undefined;
    afterApplication?: undefined;
    afterTurnEnd?: undefined;
    presentAtNextTurnStart?: undefined;
    assumption?: undefined;
    wholeCombatVerified?: undefined;
} | {
    projected: true;
    initialStacks: number | null;
    applicationTrigger: import("./statusApplication").StatusApplicationTrigger;
    afterApplication: number;
    afterTurnEnd: number;
    presentAtNextTurnStart: boolean;
    assumption: "effect executes in holder action phase from initialStacks; no intervening stack changes or lifecycle side effects";
    wholeCombatVerified: false;
    reason?: undefined;
};
