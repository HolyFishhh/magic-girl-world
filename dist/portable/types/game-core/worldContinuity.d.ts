export interface WorldContinuitySummary {
    location: string | null;
    invasion: number | null;
    trackedNpcs: Array<{
        id: string;
        name: string;
        currentAction: string;
    }>;
}
/** Read a bounded host-neutral continuity summary from an existing stat root. */
export declare function summarizeWorldContinuity(value: unknown): WorldContinuitySummary;
/** Give node generation only the most actionable existing world facts. */
export declare function formatWorldContinuityHint(value: unknown): string | null;
