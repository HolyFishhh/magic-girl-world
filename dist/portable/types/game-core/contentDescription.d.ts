export { describeOpeningDeckTransforms } from './towerOpeningTransforms';
export interface ContentRuleReference {
    kind?: 'resource' | 'stance';
    id: string;
    name: string;
    rules: string;
    flavor?: string;
    summon?: unknown;
    card?: unknown;
    stance?: unknown;
    stanceContext?: unknown;
    references?: ContentRuleReference[];
}
export interface CompactCardDescriptionOptions {
    inlineStatusDetails?: boolean;
    onSummonReference?: (reference: ContentRuleReference) => void;
    onCardReference?: (reference: ContentRuleReference) => void;
    onStanceReference?: (reference: ContentRuleReference) => void;
    cardDefinitions?: Readonly<Record<string, unknown>>;
    referenceTrail?: readonly string[];
    includeKeywords?: boolean;
    /** Program-owned context: status effects default to their exact holder. */
    implicitTarget?: 'self' | 'opponent';
    enemyCollectionTarget?: 'self' | 'opponent';
    statusNames?: Readonly<Record<string, string>>;
    /** Exact compiled definitions in this content's scope; display only, never inferred from prose. */
    statusDefinitions?: Readonly<Record<string, unknown>>;
    resourceNames?: Readonly<Record<string, string>>;
    resourceEmojis?: Readonly<Record<string, string>>;
    summonerResourceNames?: Readonly<Record<string, string>>;
    summonerResourceEmojis?: Readonly<Record<string, string>>;
    cardNames?: Readonly<Record<string, string>>;
    summonNames?: Readonly<Record<string, string>>;
    stanceNames?: Readonly<Record<string, string>>;
    stanceDefinitions?: Readonly<Record<string, Record<string, unknown>>>;
    enemyActionNames?: Readonly<Record<string, string>>;
    /** Stable runtime enemy ID → visible name mapping for exact protection references. */
    enemyNames?: Readonly<Record<string, string>>;
    /** Perspective for identity predicates; defaults are source-relative. */
    selfLabel?: string;
    opponentLabel?: string;
}
/** Keep internal IDs and formula paths out of player-facing AI prose. */
export declare function normalizeChinesePlayerDescription(value: unknown): string;
/** Detect prose that merely repeats literal mechanic numbers already shown as effect tags. */
export declare function isMechanicalDescriptionRestatement(value: unknown): boolean;
export declare function describeCompactEffectList(effects: unknown, creates?: unknown, options?: CompactCardDescriptionOptions): string;
/** Structured top-level rule groups for pill rendering. Each group preserves its own bundle and timing. */
export declare function describeCompactContentRuleGroups(value: unknown, options?: CompactCardDescriptionOptions): string[];
export declare function describeCompactCardRuleGroups(value: unknown, options?: CompactCardDescriptionOptions): string[];
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
export declare function describeStatusStackChange(value: unknown): string;
/** Build player-facing status rules, including triggers, stun, decay and stack cap. */
export declare function describeCompactStatus(value: unknown, options?: CompactCardDescriptionOptions): string;
export declare function describeCompactStatusRuleGroups(value: unknown, options?: CompactCardDescriptionOptions): string[];
export declare function canGenerateCompactStatusDescription(value: unknown): boolean;
/** Build player-facing card rules from the same shallow fields the compiler validates. */
export declare function describeCompactCard(value: unknown, options?: CompactCardDescriptionOptions): string;
export declare function describeCompactCardWhenNeeded(value: unknown, options?: CompactCardDescriptionOptions): string;
/** Card-specific display description with authoritative conditional and discard rules. */
export declare function resolveCompactCardDescription(value: unknown, options?: CompactCardDescriptionOptions): string;
