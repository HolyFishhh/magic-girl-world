export interface CompactCardDescriptionOptions {
    includeKeywords?: boolean;
    statusNames?: Readonly<Record<string, string>>;
}
export declare function describeCompactEffectList(effects: unknown, creates?: unknown, options?: CompactCardDescriptionOptions): string;
/** Build player-facing rules for relics, items, abilities and other shallow effect definitions. */
export declare function describeCompactContent(value: unknown, options?: CompactCardDescriptionOptions): string;
/** Build player-facing status rules, including triggers, stun, decay and stack cap. */
export declare function describeCompactStatus(value: unknown, options?: CompactCardDescriptionOptions): string;
export declare function canGenerateCompactStatusDescription(value: unknown): boolean;
/** Build player-facing card rules from the same shallow fields the compiler validates. */
export declare function describeCompactCard(value: unknown, options?: CompactCardDescriptionOptions): string;
