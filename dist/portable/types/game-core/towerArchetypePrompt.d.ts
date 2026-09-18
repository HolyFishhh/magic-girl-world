import { type TowerArchetypePreset } from './towerArchetypeCatalog';
export declare function buildTowerArchetypePrompt(values: readonly TowerArchetypePreset[]): string;
export declare function readTowerArchetypePresets(value: string): TowerArchetypePreset[];
/**
 * One-time migration for the old picker, which injected an exact generated block
 * into the card textarea. Free prose is never inferred from names alone.
 */
export declare function extractLegacyTowerArchetypeSelection(value: string): {
    card: string;
    selectedMechanicIds: string[];
} | undefined;
/** Compatibility for older callers and old one-preset saved prompts. */
export declare function readTowerArchetypePreset(value: string): TowerArchetypePreset | undefined;
export declare function replaceTowerArchetypePrompt(value: string, values?: readonly TowerArchetypePreset[]): string;
