/** Maintained event-design menu. Entries describe capabilities, never add protocol fields. */
export type TowerEventCapability = 'scalar_outcome' | 'registered_resources' | 'gain_cards' | 'reward' | 'card_removal_credit' | 'deck_remove' | 'persistent_growth' | 'deck_transform' | 'deck_duplicate' | 'random_deck_target' | 'repeat_stages' | 'seeded_random' | 'battle_challenge' | 'delayed_task' | 'memory_minigame' | 'cross_run_memory' | 'modular_creation';
export interface TowerEventMechanic {
    id: string;
    category: string;
    forms: string[];
    required: TowerEventCapability[];
    sources: string[];
    status: 'available' | 'planned';
}
export declare const AVAILABLE_TOWER_EVENT_CAPABILITIES: readonly TowerEventCapability[];
export declare const TOWER_EVENT_MECHANICS: readonly TowerEventMechanic[];
export declare function availableTowerEventMechanics(available?: readonly TowerEventCapability[]): TowerEventMechanic[];
export declare function towerEventGenerationGuidance(): string;
