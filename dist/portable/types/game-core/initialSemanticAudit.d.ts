import { type DraftPath, type InitialDraftDiagnostic } from './initialDraft';
import { projectStatusThroughNextTurn } from './statusDurationProjection';
export interface InitialSemanticFact {
    kind: 'stance_read' | 'stance_entry' | 'listener' | 'status_listener' | 'card_generation' | 'discard' | 'recover' | 'resource_payment' | 'resource_delta' | 'resource_set' | 'resource_read';
    path: DraftPath;
    actor: string;
    id: string;
    /** Exact definition identity for status-local lifecycle/event listeners. */
    statusId?: string;
    comparison?: '==' | '!=';
    /** Uninterpreted authored amount. A formula or assignment is not proof of consumption. */
    value?: number | string;
    resourceField?: 'current' | 'max';
}
export interface InitialSemanticAudit {
    inspected: boolean;
    references: InitialDraftDiagnostic[];
    facts: InitialSemanticFact[];
    edges: Array<{
        from: DraftPath;
        to: DraftPath;
        actor: string;
    }>;
    /** Known executable dependency sites this diagnostic walker has not expanded. */
    unexpandedPaths: DraftPath[];
    observations: Array<{
        code: 'NO_LOCAL_STANCE_ENTRY' | 'NO_OWNED_RESOURCE_USE';
        path: DraftPath;
        actor: string;
        id: string;
    }>;
    truncated: boolean;
    isolatedStatusTiming: Array<{
        applicationPath: DraftPath;
        statusId: string;
        projection: ReturnType<typeof projectStatusThroughNextTurn>;
    }>;
}
/**
 * Diagnostic facts only: potential structural paths, NOT proof of gameplay
 * reachability or prose fidelity. Never repairs, commits, or rejects content.
 * Reuses the authoritative compiler for reference errors. External combatants
 * may supply state, so absence of a local producer is only an observation.
 */
export declare function auditInitialSemanticStructure(input: unknown): InitialSemanticAudit;
