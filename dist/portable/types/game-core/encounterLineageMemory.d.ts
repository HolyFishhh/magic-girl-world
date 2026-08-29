import { type ContentDefinition, type ContentPack } from './contentPack';
export declare const ENCOUNTER_LINEAGE_SPEC: "mwg.encounter-lineage/v1";
export interface EnemyActionMemory {
    id: string;
    name: string;
    mechanicsFingerprint: string;
    structuralFingerprint: string;
    /** Bounded canonical definition allows an upper-rank enemy to reuse the real action. */
    definition: ContentDefinition;
}
export interface EnemyLineageFamily {
    key: string;
    label: string;
    encounters: number;
    memberNames: string[];
    stages: string[];
    themeAxes: string[];
    statusIds: string[];
    canonicalActions: EnemyActionMemory[];
}
export interface RecentEnemyMemory {
    id: string;
    name: string;
    familyKey?: string;
    stage?: string;
    fingerprint: string;
    themeAxes: string[];
    actions: Array<{
        name: string;
        structuralFingerprint: string;
    }>;
}
export interface EncounterLineageMemory {
    spec: typeof ENCOUNTER_LINEAGE_SPEC;
    families: EnemyLineageFamily[];
    recentEnemies: RecentEnemyMemory[];
}
export interface LineageContinuityReview {
    knownFamily: boolean;
    sharedActionCount: number;
    sharedAxes: string[];
    issues: string[];
    guidance: string[];
}
/** Only explicit identity metadata groups a family; names and prose are left for the model to interpret. */
export declare function explicitEnemyFamilyKey(enemy: ContentDefinition): string | null;
/** Update bounded long-term memory after an enemy has actually been generated. */
export declare function updateEncounterLineageMemory(previous: unknown, pack: ContentPack): EncounterLineageMemory;
/**
 * Keep the full archive in a program-owned MVU path, but expose only the families
 * most likely to matter to the next generation.  This prevents old action JSON
 * from growing the second-model prompt without losing long-term continuity.
 */
export declare function createEncounterLineagePromptView(memory: EncounterLineageMemory, pack?: ContentPack): EncounterLineageMemory;
export declare function reviewEnemyLineageContinuity(memory: EncounterLineageMemory, enemy: ContentDefinition): LineageContinuityReview;
export declare function formatEncounterLineageForModel(memory: EncounterLineageMemory): string[];
