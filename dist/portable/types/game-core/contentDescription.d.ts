export interface CompactCardDescriptionOptions {
    includeKeywords?: boolean;
    statusNames?: Readonly<Record<string, string>>;
    resourceNames?: Readonly<Record<string, string>>;
}
/** Keep internal IDs and formula paths out of player-facing AI prose. */
export declare function normalizeChinesePlayerDescription(value: unknown): string;
/** Detect prose that merely repeats literal mechanic numbers already shown as effect tags. */
export declare function isMechanicalDescriptionRestatement(value: unknown): boolean;
export declare function describeCompactEffectList(effects: unknown, creates?: unknown, options?: CompactCardDescriptionOptions): string;
/**
 * Simple literal effects are already clearer as UI tags. Only synthesize a rules
 * sentence when conditions, formulas or secondary programs would otherwise be hidden.
 */
export declare function needsCompactRuleDescription(value: unknown): boolean;
/** Build player-facing rules for relics, items, abilities and other shallow effect definitions. */
export declare function describeCompactContent(value: unknown, options?: CompactCardDescriptionOptions): string;
export declare function describeCompactContentWhenNeeded(value: unknown, options?: CompactCardDescriptionOptions): string;
/** Keep creative prose, but always replace authored mechanical restatements with rules generated from executable data. */
export declare function resolveCompactContentDescription(value: unknown, options?: CompactCardDescriptionOptions): string;
/** Build player-facing status rules, including triggers, stun, decay and stack cap. */
export declare function describeCompactStatus(value: unknown, options?: CompactCardDescriptionOptions): string;
export declare function canGenerateCompactStatusDescription(value: unknown): boolean;
/** Build player-facing card rules from the same shallow fields the compiler validates. */
export declare function describeCompactCard(value: unknown, options?: CompactCardDescriptionOptions): string;
export declare function describeCompactCardWhenNeeded(value: unknown, options?: CompactCardDescriptionOptions): string;
/** Card-specific display description with authoritative conditional and discard rules. */
export declare function resolveCompactCardDescription(value: unknown, options?: CompactCardDescriptionOptions): string;
