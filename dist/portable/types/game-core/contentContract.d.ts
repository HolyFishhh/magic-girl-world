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
}
/**
 * Validate the portable content boundary shared by Tavern, websites, services, and Mods.
 * Removed effect fields are rejected here so every host consumes one modern contract.
 */
export declare function validateContentPackContract(value: unknown, options?: ContentContractOptions): ContentContractResult;
export declare function formatContentContractIssues(issues: readonly ContentContractIssue[], limit?: number): string;
/** Project a portable content path onto the canonical MUV battle root. */
export declare function contentPathToBattlePath(path: string): string;
