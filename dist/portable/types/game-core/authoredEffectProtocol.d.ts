export type EffectProtocolPlacement = 'runtime' | 'initial-draft';
export interface EffectProtocolSection {
    id: string;
    title: string;
    clauses: string[];
}
/** One semantic reference shared by initial drafts, node generation and repairs.
 * Placement projects definition ownership only; it never changes execution rules.
 * Keep task inputs and error-specific advice out of this reference.
 */
export declare function compactEffectProtocolSections(placement?: EffectProtocolPlacement): EffectProtocolSection[];
export declare function formatCompactEffectProtocol(placement?: EffectProtocolPlacement): string;
