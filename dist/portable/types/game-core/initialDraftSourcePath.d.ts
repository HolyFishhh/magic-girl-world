import type { InitialDraftFragments, DraftPath, InitialDraft } from './initialDraft';
/** Resolve a diagnostic/repair leaf back to the single authored definition.
 * Only compiler-owned expansion boundaries are traversed. IDs choose entries
 * within the exact registry kind, never by names/prose or a global ID search.
 * A changed/derived leaf has no writable source. This grants no repair rights;
 * the caller still needs a bounded validated slot and a fresh compilation.
 */
export declare function initialDraftSourcePath(draft: InitialDraft, preview: InitialDraftFragments, path: DraftPath): DraftPath | null;
/** Project an ALREADY slot-validated preview edit back to authored sources.
 * This is not a response parser: callers must prove the preview write set first.
 * Array shape changes are atomic here; the slot merger owns splice validation.
 */
export declare function applyInitialDraftPreviewEdits(draft: InitialDraft, before: InitialDraftFragments, after: InitialDraftFragments): InitialDraft;
