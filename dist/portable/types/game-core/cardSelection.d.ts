export type CardSelectionMode = 'choose' | 'leftmost' | 'rightmost' | 'all' | 'random';
export type CardSelectionFailureCode = 'DUPLICATE_CANDIDATE_ID' | 'RANDOM_SOURCE_REQUIRED' | 'CANCEL_NOT_ALLOWED' | 'INVALID_RESPONSE';
export interface CardSelectionRequest {
    candidateIds: readonly string[];
    mode: CardSelectionMode;
    minimum: number;
    maximum: number;
    allowCancel: boolean;
}
export type CardSelectionPlan = {
    ok: true;
    kind: 'interactive';
    candidateIds: string[];
    minimum: number;
    maximum: number;
    allowCancel: boolean;
} | {
    ok: true;
    kind: 'automatic';
    candidateIds: string[];
    selectedIds: string[];
    minimum: number;
    maximum: number;
    allowCancel: boolean;
} | {
    ok: false;
    code: CardSelectionFailureCode;
};
export type CardSelectionResult = {
    status: 'selected';
    selectedIds: string[];
} | {
    status: 'cancelled';
} | {
    status: 'invalid';
    code: CardSelectionFailureCode;
};
/** Build a stable, host-independent selection plan from card IDs. */
export declare function planCardSelection(request: CardSelectionRequest, random?: () => number): CardSelectionPlan;
/** Validate a host response and restore authored candidate order. */
export declare function resolveCardSelection(plan: Exclude<CardSelectionPlan, {
    ok: false;
}>, response?: readonly string[] | null): CardSelectionResult;
