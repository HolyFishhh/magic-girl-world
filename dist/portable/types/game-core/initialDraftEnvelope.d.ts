/** Program-owned protocol structure only. No story, numbers or effects defaults. */
export declare const INITIAL_DRAFT_SPEC = "mwg.initial-draft/v1";
export declare const INITIAL_DRAFT_ROOT_FIELDS: readonly ["spec", "narrative", "player", "opening", "registry"];
export declare const INITIAL_DRAFT_AUTHOR_REQUIRED_ROOTS: readonly ["registry", "player", "opening"];
export interface InitialDraftEnvelopeIssue {
    path: string[];
    message: string;
}
/** Match the compiler's structural boundary, collecting independent faults.
 * Deeper gameplay/readiness checks remain authoritative and separate. */
export declare function collectInitialDraftEnvelopeIssues(value: unknown): InitialDraftEnvelopeIssue[];
export declare function initialDraftAuthorEnvelopeContract(): string;
