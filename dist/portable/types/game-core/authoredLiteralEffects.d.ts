export interface AuthoredLiteralEffectIssue {
    code: 'EXPLICIT_LITERAL_EFFECT_MISMATCH' | 'EXPLICIT_FIRST_CARD_EVENT_MISMATCH' | 'LITERAL_EFFECT_AUDIT_LIMIT';
    path: string;
    message: string;
}
/** A closed, fully understood status sentence and one immediate self benefit.
 * No keyword extraction from flavor, mixed triggers, formulas or conditions.
 */
export declare function inspectFirstCardEventMismatch(value: unknown): {
    event: string;
    condition: string;
} | null;
export declare function diagnoseAuthoredLiteralEffects(value: unknown, path: string): AuthoredLiteralEffectIssue[];
/** Fresh generation validation only. Never call as a migration of saved state. */
export declare function collectAuthoredLiteralEffectIssues(value: unknown, path?: string): AuthoredLiteralEffectIssue[];
/** AI supplies the complete small replacement. This function validates it;
 * it never builds mechanics from prose or overwrites the author's description.
 */
export declare function assertAuthoredLiteralEffectRepair(original: unknown, effects: unknown): void;
/** Repair cannot evade a known literal contradiction by deleting/rewording the
 * original claim or switching to an uninspected effect language. Other content
 * keeps the surrounding controller's existing repair ownership policy.
 */
export declare function assertAuthoredLiteralRepairPreservation(original: unknown, repaired: unknown): void;
export declare function createLiteralEffectSequenceSchema(): Record<string, unknown>;
