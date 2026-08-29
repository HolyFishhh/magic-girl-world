export type ContentMechanicRole = '启动' | '收益' | '桥接' | '循环' | '终结' | '成长' | '控制' | '风险';
export interface ContentMechanicFeatures {
    operations: string[];
    axes: string[];
    targets: string[];
    zones: string[];
    triggers: string[];
    resources: string[];
    statuses: string[];
    roles: ContentMechanicRole[];
    /** Structural, not numeric, estimate used only for compact design guidance. */
    complexity: number;
}
/** Extract shared structural features from authored compact content without compiling or mutating it. */
export declare function extractContentMechanicFeatures(value: unknown): ContentMechanicFeatures;
export declare function mergeContentMechanicFeatures(values: readonly ContentMechanicFeatures[]): ContentMechanicFeatures;
