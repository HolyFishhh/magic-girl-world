export type ArtifactAcquisitionCandidateCategory = 'cards' | 'items';
export declare function artifactAcquisitionCandidateEntries(value: Record<string, unknown>): Array<{
    category: ArtifactAcquisitionCandidateCategory;
    value: unknown;
}>;
/** Shared structural/resource boundary for every owned relic acquisition. */
export declare function validateArtifactAcquisitionContract(value: Record<string, unknown>, options?: {
    knownResourceIds?: Iterable<string>;
    validateCandidate?: (category: ArtifactAcquisitionCandidateCategory, value: unknown) => string | null;
}): string | null;
