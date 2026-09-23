import { type ContentContractIssue } from './contentContract';
export type RewardCandidateCategory = 'cards' | 'artifacts' | 'items';
export type RewardCandidateValidationResult = {
    ok: true;
} | {
    ok: false;
    message: string;
};
export type RewardCandidateSupportStatusesResult = {
    ok: true;
    statuses: Record<string, unknown>[];
} | {
    ok: false;
    message: string;
};
export interface RewardCandidateLibrary {
    /** Owner-level overflow effect: a reward is not an independent character. */
    playerDesireEffect?: unknown;
    existing?: readonly unknown[];
    knownStatusIds?: Iterable<string>;
    statusDefinitions?: readonly unknown[];
    knownResourceIds?: Iterable<string>;
}
/**
 * Run the shared content contract against one reward candidate and return all
 * independently discoverable structural issues. The ordinary validator below
 * still owns library identity and cross-reference rules; this pass prevents a
 * repair request from seeing only the first malformed field in the same card.
 */
export declare function collectRewardCandidateContractIssues(category: RewardCandidateCategory, value: unknown, library?: RewardCandidateLibrary): string[];
/** Structured counterpart for pre-repair source mapping; no message parsing. */
export declare function collectRewardCandidateTypedContractIssues(category: RewardCandidateCategory, value: unknown, library?: RewardCandidateLibrary): ContentContractIssue[];
/** Read the amount granted by one reward candidate. AI card candidates commonly use 0 to mean "not owned yet". */
export declare function readRewardCandidateQuantity(category: RewardCandidateCategory, value: unknown): number | null;
/**
 * Read the candidate-owned status library. `status` remains accepted for old
 * cards while new generators can close any finite status dependency graph in
 * `statuses`. Equal duplicate ids are harmless and collapse to one definition;
 * conflicting duplicates are rejected before anything reaches persistent MVU.
 */
export declare function readRewardCandidateSupportStatuses(value: unknown, referenceDefinitions?: readonly unknown[]): RewardCandidateSupportStatusesResult;
export declare function rewardStatusDefinitionsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean;
/** Validate an AI reward before it is committed to persistent MUV state. */
export declare function validateRewardCandidate(category: RewardCandidateCategory, value: unknown): RewardCandidateValidationResult;
/** Validate references and identity against the persistent content library. */
export declare function validateRewardCandidateAgainstLibrary(category: RewardCandidateCategory, value: unknown, library: RewardCandidateLibrary): RewardCandidateValidationResult;
