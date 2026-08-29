/** Stable signature whose value is unchanged by names, prose, emoji, or narrative source labels. */
export declare function createContentMechanicsFingerprint(value: unknown): string;
/** Coarser signature for finding reskins and number-only variants of the same authored structure. */
export declare function createContentStructuralFingerprint(value: unknown): string;
export declare function createContentFingerprintPair(value: unknown): {
    exact: string;
    structural: string;
};
