export interface ContentRepairIssueInput {
    path: string;
    code?: string;
}
/** Format a user-visible diagnostic without echoing AI-controlled names or text. */
export declare function formatBoundedContentIssueSummary(issues: readonly ContentRepairIssueInput[], limit?: number): string;
/** Build a bounded repair marker without echoing AI-controlled names or text. */
export declare function formatBoundedContentRepairPrompt(marker: string, issues: readonly ContentRepairIssueInput[], limit?: number): string;
