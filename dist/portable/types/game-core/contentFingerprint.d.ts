import type { ContentPack } from './contentPack';
/** Evaluation caches preserve identities and every authored dependency. Reskin
 * matching below is intentionally coarser and must never key execution results. */
export declare function createContentEvaluationFingerprint(value: unknown): string;
export declare function playerEvaluationState(pack: ContentPack): {
    enemy: null;
    enemies: never[];
    desireEffects: {
        player: Readonly<Record<string, any>> | null;
        enemy: null;
    };
    schemaVersion: typeof import("./contentPack").CONTENT_PACK_SCHEMA_VERSION;
    cards: import("./contentPack").ContentDefinition[];
    statuses: import("./contentPack").ContentDefinition[];
    relics: import("./contentPack").ContentDefinition[];
    items: import("./contentPack").ContentDefinition[];
    abilities: import("./contentPack").ContentDefinition[];
    activeStatuses: import("./contentPack").ContentDefinition[];
    playerResources?: import("./contentPack").ContentDefinition[];
    playerCardPatches?: import("./cardPatch").CardPatch[];
    playerSummonGrowth?: import("./persistentGrowth").PersistentGrowthOperation[];
    playerStance?: import("./contentPack").ContentDefinition | null;
    playerOrbSlots?: number;
    playerOrbs?: import("./contentPack").ContentDefinition[];
};
/** Stable signature whose value is unchanged by names, prose, emoji, or narrative source labels. */
export declare function createContentMechanicsFingerprint(value: unknown): string;
/** Coarser signature for finding reskins and number-only variants of the same authored structure. */
export declare function createContentStructuralFingerprint(value: unknown): string;
export declare function createContentFingerprintPair(value: unknown): {
    exact: string;
    structural: string;
};
