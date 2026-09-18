import { type InitialDraft } from './initialDraft';
import type { TowerJsonSchema } from './towerRequest';
export declare const INITIAL_TEMPLATE_REPAIR_SPEC = "mwg.initial-template-repair/v1";
type Slot = {
    token: string;
    index: number;
    id: string;
    fields: string[];
};
export interface InitialTemplateRepairPlan {
    original: InitialDraft;
    slots: Slot[];
}
/** No prose matching or whole-draft rewrite. Initially cover a single malformed
 * root reference operation; mixed sequences and other diagnostics fail closed. */
export declare function planInitialTemplateRepair(input: unknown): InitialTemplateRepairPlan | null;
export declare function createInitialTemplateRepairSchema(plan: InitialTemplateRepairPlan): TowerJsonSchema;
/** Merge only. The caller must recompile AND validate the whole candidate. */
export declare function applyInitialTemplateRepair(plan: InitialTemplateRepairPlan, response: unknown): InitialDraft;
export {};
