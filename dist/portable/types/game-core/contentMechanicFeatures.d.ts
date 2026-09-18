export type ContentMechanicRole = '启动' | '收益' | '桥接' | '循环' | '终结' | '成长' | '控制' | '风险';
export interface ContentMechanicFeatures {
    operations: string[];
    axes: string[];
    targets: string[];
    zones: string[];
    triggers: string[];
    resources: string[];
    statuses: string[];
    /** Stable summon template identities, used to join setup and command cards. */
    summons: string[];
    roles: ContentMechanicRole[];
    /** Structural, not numeric, estimate used only for compact design guidance. */
    complexity: number;
}
/**
 * A starter attack or guard is deliberately not a deck identity.  This is a
 * recognition-only predicate: callers may omit it from archetype evidence,
 * while combat analysis still sees the authored card unchanged.
 */
export declare function isPlainLowValueStarterDefinition(value: unknown): boolean;
/** Extract shared structural features from authored compact content without compiling or mutating it. */
export declare function extractContentMechanicFeatures(value: unknown): ContentMechanicFeatures;
export declare function mergeContentMechanicFeatures(values: readonly ContentMechanicFeatures[]): ContentMechanicFeatures;
