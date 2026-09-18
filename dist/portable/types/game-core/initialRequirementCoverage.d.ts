import { type InitialSemanticFact } from './initialSemanticAudit';
/** Request-owned necessary conditions, never inferred from generated descriptions.
 * This first layer detects missing structural candidates; it cannot prove timing,
 * availability, effect magnitude, loops, or complete free-text satisfaction. */
export interface InitialRequirementProbe {
    id: string;
    kind: 'stance_entry' | 'resource_accumulate' | 'resource_consume' | 'card_generation' | 'discard' | 'recover' | 'discard_or_recover' | 'status_lifecycle';
    actor: string;
    resourceId?: string;
    /** An explicitly requested status-local entry, not a ban on equivalent
     * artifact/ability listeners. Do not infer this probe from arbitrary prose. */
    statusId?: string;
    lifecycle?: 'apply' | 'stack' | 'tick' | 'remove';
}
export interface InitialRequirementEvidence {
    id: string;
    status: 'missing_candidate' | 'candidate_present_unverified' | 'unverified';
    candidates: InitialSemanticFact[];
}
/** No writes, model calls, guessed implementation, or readiness verdict. */
export declare function inspectInitialRequirementCandidates(input: unknown, probes: readonly InitialRequirementProbe[]): {
    results: InitialRequirementEvidence[];
    structurallyTruncated: boolean;
    unexpandedPaths: import("./initialDraft").DraftPath[];
    overallVerified: false;
};
