export type RewardCandidateCategory = 'cards' | 'artifacts' | 'items';
export type RewardCandidateValidationResult = {
    ok: true;
} | {
    ok: false;
    message: string;
};
export interface RewardCandidateLibrary {
    existing?: readonly unknown[];
    knownStatusIds?: Iterable<string>;
    statusDefinitions?: readonly unknown[];
    knownResourceIds?: Iterable<string>;
}
/** Read the amount granted by one reward candidate. AI card candidates commonly use 0 to mean "not owned yet". */
export declare function readRewardCandidateQuantity(category: RewardCandidateCategory, value: unknown): number | null;
/** Validate an AI reward before it is committed to persistent MUV state. */
export declare function validateRewardCandidate(category: RewardCandidateCategory, value: unknown): RewardCandidateValidationResult;
/** Validate references and identity against the persistent content library. */
export declare function validateRewardCandidateAgainstLibrary(category: RewardCandidateCategory, value: unknown, library: RewardCandidateLibrary): RewardCandidateValidationResult;
