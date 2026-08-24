/** Portable status-stack transition rules. */
export type StatusApplicationTrigger = 'apply' | 'stack' | null;
export interface StatusApplicationResult {
    nextStacks: number;
    trigger: StatusApplicationTrigger;
}
export declare function resolveStatusStacksChange(currentStacks: number, change: unknown): number;
/** Resolve one status application without mutating the battle state. */
export declare function resolveStatusApplication(currentStacks: number | undefined, incomingStacks: number, maxStacks?: number): StatusApplicationResult;
