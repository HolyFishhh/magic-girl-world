import { type DraftPath, type DraftRegistryKind, type InitialDraft, type InitialDraftDiagnostic } from './initialDraft';
import type { TowerJsonSchema } from './towerRequest';
export declare const INITIAL_DRAFT_REGISTRY_REPAIR_SPEC = "mwg.initial-draft-registry-repair/v1";
export interface InitialDraftRegistryRepairSlot {
    token: string;
    kind: DraftRegistryKind;
    id: string;
    references: DraftPath[];
}
export interface InitialDraftRegistryRepairPlan {
    /** Program-owned snapshot. Never accept a replacement plan from the model. */
    original: InitialDraft;
    slots: InitialDraftRegistryRepairSlot[];
}
export type InitialDraftRegistryRepairPlanning = {
    kind: 'not_needed';
} | {
    kind: 'unsupported';
    diagnostics: InitialDraftDiagnostic[];
} | {
    kind: 'repair';
    plan: InitialDraftRegistryRepairPlan;
};
/** Typed references only. Diagnostic messages/prose never choose repair targets. */
export declare function planInitialDraftRegistryRepair(input: unknown, coveredSourcePaths?: readonly DraftPath[]): InitialDraftRegistryRepairPlanning;
/** Schema preserves the existing compact definition grammar; only IDs/tokens are fixed. */
export declare function createInitialDraftRegistryRepairJsonSchema(plan: InitialDraftRegistryRepairPlan): TowerJsonSchema;
type RepairMerge = {
    ok: true;
    draft: InitialDraft;
} | {
    ok: false;
    message: string;
};
/**
 * Only adds exact requested IDs; never replaces an existing definition/content.
 * This is a merge, NOT acceptance. The host must recompile and validate the
 * entire candidate, and must not start a second repair if new errors remain.
 */
export declare function applyInitialDraftRegistryRepair(plan: InitialDraftRegistryRepairPlan, response: unknown): RepairMerge;
export {};
