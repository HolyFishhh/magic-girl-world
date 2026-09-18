import { type DraftPath } from './initialDraft';
export interface InitialEnvelopeRepairPlan {
    original: Record<string, any>;
    /** Only the joint caller may defer references to its exact addition slots. */
    deferMissingReferences?: true;
    slots: Array<{
        token: string;
        path: DraftPath;
        diagnostic: string;
        valueType: 'array' | 'object' | 'number' | 'string';
        definitionId?: string;
    }>;
}
/** Structural locations come from the shared envelope contract, not model text.
 * Invalid/missing containers and precisely diagnosed definition fields share
 * one response. Identity and every non-target sibling remain locked.
 */
export declare function planInitialEnvelopeRepair(input: unknown, deferMissingReferences?: boolean): InitialEnvelopeRepairPlan | null;
/** Merge only; callers MUST compile and validate the entire draft afterwards. */
export declare function applyInitialEnvelopeRepair(plan: InitialEnvelopeRepairPlan, response: unknown): Record<string, any>;
