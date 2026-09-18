import { type AbilityTrigger } from './battleTriggers';
export interface AuthoredTriggerTimingIssue {
    code: 'EXPLICIT_TRIGGER_TIMING_MISMATCH' | 'TRIGGER_CLAIM_AUDIT_LIMIT';
    path: string;
    describedTrigger?: AbilityTrigger;
    actualTrigger?: AbilityTrigger;
    claim?: string;
    message: string;
}
/** Evidence of a contradiction only. Never mutates or synthesizes a trigger. */
export declare function diagnoseExplicitTriggerTiming(value: unknown, path: string): AuthoredTriggerTimingIssue[];
/** Fresh generated content only; this audit is not a migration of old saves. */
export declare function collectInitialTriggerTimingIssues(input: {
    player: unknown;
    opening: unknown;
}): AuthoredTriggerTimingIssue[];
export declare function formatAuthoredMechanicDescriptionContract(): string;
