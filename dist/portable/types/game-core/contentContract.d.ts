import { type ContentPack } from './contentPack';
export interface ContentContractIssue {
    path: string;
    code: string;
    message: string;
}
export type ContentContractResult = {
    ok: true;
    value: ContentPack;
} | {
    ok: false;
    issues: ContentContractIssue[];
};
export interface ContentContractOptions {
    /** Battle requests require an enemy; analysis-only packs may omit it. */
    requireEnemy?: boolean;
    /** Battle requests require every executable definition to expose one effect source. */
    requireExecutable?: boolean;
    /**
     * Status ids supplied by the surrounding persistent library. They are used
     * only to resolve references; their definitions are validated by the owner
     * of that library instead of being revalidated for every isolated candidate.
     */
    knownStatusIds?: Iterable<string>;
    /** External player resource ids for an isolated candidate wrapper. */
    knownResourceIds?: Iterable<string>;
    /** Surrounding definitions used for executable reference traversal only;
     * their owner validates them, while pack.statuses remain candidate-owned. */
    referenceStatusDefinitions?: readonly unknown[];
    /** Only for a complete starting deck, never an isolated reward candidate. */
    requireVictoryRoute?: boolean;
}
/**
 * Validate the portable content boundary shared by Tavern, websites, services, and Mods.
 * Removed effect fields are rejected here so every host consumes one modern contract.
 */
export declare function validateContentPackContract(value: unknown, options?: ContentContractOptions): ContentContractResult;
export declare function formatContentContractIssues(issues: readonly ContentContractIssue[], limit?: number): string;
/** Project a portable content path onto the canonical MUV battle root. */
export declare function contentPathToBattlePath(path: string): string;
