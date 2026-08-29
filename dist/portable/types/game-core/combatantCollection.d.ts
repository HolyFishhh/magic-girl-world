import type { BattleRandomState } from './deterministicRandom';
export declare const COMBATANT_COLLECTION_SCHEMA_VERSION: 1;
export interface IdentifiedCombatant {
    id: string;
    currentHp: number;
    maxHp: number;
}
export interface CombatantCollection<T extends IdentifiedCombatant> {
    schemaVersion: typeof COMBATANT_COLLECTION_SCHEMA_VERSION;
    order: string[];
    byId: Record<string, T>;
    activeId: string | null;
}
export type EnemyTargetSelector = {
    mode: 'active';
} | {
    mode: 'by_id';
    id: string;
} | {
    mode: 'all';
} | {
    mode: 'random';
    allowRepeat?: boolean;
    retarget?: 'locked' | 'each_hit';
} | {
    mode: 'random_n';
    count: number;
    allowRepeat?: boolean;
    retarget?: 'locked' | 'each_hit';
} | {
    mode: 'lowest_hp';
} | {
    mode: 'highest_hp';
};
export interface ResolvedCombatantTargets<T extends IdentifiedCombatant> {
    targets: T[];
    random: BattleRandomState;
    resolution: CombatantTargetResolution;
}
export interface CombatantTargetResolution {
    requestedCount: number;
    availableCount: number;
    resolvedCount: number;
    complete: boolean;
    code?: 'NO_LIVING_TARGETS' | 'TARGET_NOT_FOUND' | 'INSUFFICIENT_TARGETS';
    targetId?: string;
}
export declare function createCombatantCollection<T extends IdentifiedCombatant>(combatants?: readonly T[], activeId?: string | null): CombatantCollection<T>;
export declare function listCombatants<T extends IdentifiedCombatant>(collection: CombatantCollection<T>, options?: {
    livingOnly?: boolean;
}): T[];
export declare function getActiveCombatant<T extends IdentifiedCombatant>(collection: CombatantCollection<T>): T | null;
export declare function setActiveCombatant<T extends IdentifiedCombatant>(collection: CombatantCollection<T>, id: string): CombatantCollection<T>;
export declare function updateCombatant<T extends IdentifiedCombatant>(collection: CombatantCollection<T>, id: string, update: Partial<T> | ((current: T) => T)): CombatantCollection<T>;
export declare function removeCombatant<T extends IdentifiedCombatant>(collection: CombatantCollection<T>, id: string): CombatantCollection<T>;
export declare function removeDefeatedCombatants<T extends IdentifiedCombatant>(collection: CombatantCollection<T>): {
    collection: CombatantCollection<T>;
    removed: T[];
};
/** Resolve and lock targets before an effect transaction. Multi-hit effects reuse this list unless explicitly re-resolved. */
export declare function resolveEnemyTargets<T extends IdentifiedCombatant>(collection: CombatantCollection<T>, selector: EnemyTargetSelector, random: BattleRandomState): ResolvedCombatantTargets<T>;
export declare function validateCombatantCollection(value: unknown): value is CombatantCollection<IdentifiedCombatant>;
