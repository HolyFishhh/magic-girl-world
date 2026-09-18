declare const PROFILE_FIELDS: readonly [readonly ["name", "name"], readonly ["customDescription", "appearance"], readonly ["world", "world"], readonly ["profession", "identity"], readonly ["opening", "opening"], readonly ["card", "card"], readonly ["towerRequirements", "tower_requirements"]];
type StartProfile = Partial<Record<typeof PROFILE_FIELDS[number][0], string>> & {
    mode?: unknown;
    selectedMechanics?: string;
};
/** Code-owned UI envelope. Kept shared so deduplication never guesses at user prose. */
export declare function createCharacterStartMessage(config: StartProfile): string;
/** Only the exact current tower UI envelope is redundant with the full config. */
export declare function isCanonicalTowerStartRequest(request: string, config: Record<string, string>): boolean;
export {};
