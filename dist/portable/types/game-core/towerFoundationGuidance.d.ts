import type { ContentPack } from './contentPack';
/** Local analysis only. Preferences never become invented evidence or a card rejection rule. */
export declare function buildTowerFoundationGuidance(pack: ContentPack, selectedPrompt?: string): {
    spec: string;
    catalogCount: number;
    evaluatedCount: number;
    selectedPreferences: {
        id: string;
        name: string;
        requirement: string;
        alreadyPresent: boolean;
    }[];
    originalPreference: string | undefined;
    observedMechanisms: {
        id: string;
        name: string;
        mechanism: string;
        supportingIds: string[];
        evidence: string[];
    }[];
    availableMechanismFamilies: {
        category: string;
        foundations: string[];
    }[];
    generationPolicy: string[];
};
