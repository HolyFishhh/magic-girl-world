/** Prompt-only foundations. Related graph families do not imply a complete bundled build. */
export interface TowerArchetypePreset {
    id: string;
    category: string;
    name: string;
    summary: string;
    loop: readonly string[];
    requirements: readonly string[];
    archetypeIds: readonly string[];
    operations: readonly string[];
    aliases: readonly string[];
}
export declare const TOWER_ARCHETYPE_CATEGORIES: readonly {
    id: string;
    name: string;
    description: string;
}[];
export declare const TOWER_ARCHETYPE_OPERATION_EXCLUSIONS: Readonly<Record<string, string>>;
/** Compound graph families map to foundations instead of selectable recipes. */
export declare const TOWER_ARCHETYPE_COMPOSITION_COVERAGE: Readonly<Record<string, readonly string[]>>;
export declare const TOWER_ARCHETYPE_PRESETS: readonly TowerArchetypePreset[];
