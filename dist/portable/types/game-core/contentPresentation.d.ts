import { type CompactCardDescriptionOptions } from './contentDescription';
export interface CompactContentPresentation {
    /** Authored prose is not a source of executable rules. */
    flavorText: string;
    /** Always generated, even for a simple literal effect normally shown as a tag. */
    rulesText: string;
    /** Structured boundaries; hosts must never split the rendered prose to build pills. */
    rulesGroups: string[];
    /** Only present when the caller identifies an actual battle-item container. */
    usageText?: string;
}
export declare function presentCompactContent(value: unknown, kind: 'card' | 'status' | 'content' | 'item', options?: CompactCardDescriptionOptions): CompactContentPresentation;
/** Plain text only. Hosts must escape it if they insert it into HTML. */
export declare function formatCompactContentPresentation(value: CompactContentPresentation): string;
