export declare const CONTENT_PACK_SCHEMA_VERSION: 1;
export type ContentDefinition = Readonly<Record<string, any>>;
export interface ContentPack {
    schemaVersion: typeof CONTENT_PACK_SCHEMA_VERSION;
    cards: ContentDefinition[];
    statuses: ContentDefinition[];
    relics: ContentDefinition[];
    items: ContentDefinition[];
    abilities: ContentDefinition[];
    activeStatuses: ContentDefinition[];
    enemy: ContentDefinition | null;
    desireEffects: {
        player: ContentDefinition | null;
        enemy: ContentDefinition | null;
    };
}
export interface CreateContentPackInput {
    cards?: unknown;
    statuses?: unknown;
    relics?: unknown;
    items?: unknown;
    abilities?: unknown;
    activeStatuses?: unknown;
    enemy?: unknown;
    playerDesireEffect?: unknown;
}
/** Copy AI content into a host-neutral JSON package before runtime conversion. */
export declare function createContentPack(input: CreateContentPackInput): ContentPack;
export declare function isContentPack(value: unknown): value is ContentPack;
export declare function createContentPackFingerprint(pack: ContentPack): string;
export interface BuildBudget {
    deck: number;
    attack: number;
    defense: number;
    sustain: number;
    draw: number;
    energy: number;
    hp: number;
    maxHp: number;
}
export interface BuildBudgetScenarioRange {
    expected: BuildBudget;
    min: BuildBudget;
    max: BuildBudget;
}
/** Estimate one five-card hand. This is a short generation hint, not a combat simulation. */
export declare function summarizeBuildBudget(pack: ContentPack, player: {
    hp: number;
    maxHp: number;
}): BuildBudget;
/** Evaluate the whole build against the same detached scenarios used by content analysis. */
export declare function summarizeBuildBudgetScenarios(pack: ContentPack, player: {
    hp: number;
    maxHp: number;
}): BuildBudgetScenarioRange;
export declare function formatBuildBudget(budget: BuildBudget): string;
