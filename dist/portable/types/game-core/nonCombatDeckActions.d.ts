import { type PersistentCardCarrier, type PersistentRunCard } from './cardProgression';
export type NonCombatDeckAction = {
    id: string;
    kind: 'remove' | 'transform' | 'duplicate';
    count: number;
    pick: 'choose' | 'random';
    filter?: {
        ids?: string[];
        types?: string[];
    };
    replacement?: Record<string, unknown>;
};
export type NonCombatDeckPlan<T extends PersistentCardCarrier> = {
    action: NonCombatDeckAction;
    candidates: PersistentRunCard<T>[];
    selectedIds: string[];
    pending: boolean;
};
export declare function parseNonCombatDeckActions(value: unknown): NonCombatDeckAction[];
export declare function planNonCombatDeckAction<T extends PersistentCardCarrier>(cards: readonly T[], raw: NonCombatDeckAction, seed: string, chosen?: readonly string[]): NonCombatDeckPlan<T>;
export declare function executeNonCombatDeckPlan<T extends PersistentCardCarrier>(cards: readonly T[], plan: NonCombatDeckPlan<T>, validator: (card: Record<string, unknown>) => Record<string, unknown> | void): PersistentRunCard<T>[];
