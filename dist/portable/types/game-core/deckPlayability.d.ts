import { type ContentAnalysis } from './contentAnalysis';
/** Host-neutral card data used by the minimum deck diagnostics. */
export interface DeckPlayabilityCard {
    type?: string;
    cost?: number | 'energy';
    quantity?: number;
    analysis?: Pick<ContentAnalysis, 'metrics' | 'dynamicMetrics'> | null;
}
export interface DeckPlayabilityOptions {
    /** Energy available to a normal turn. Defaults to the game's 3. */
    baseEnergy?: number;
}
export interface DeckPlayabilityAssessment {
    deckQuantity: number;
    hasPlayableCard: boolean;
    hasVictoryPressure: boolean;
    hasDefenseOrRecovery: boolean;
}
/** Assess minimum deck properties without reading a host runtime or simulating combat. */
export declare function assessDeckPlayability(cards: readonly DeckPlayabilityCard[], options?: DeckPlayabilityOptions): DeckPlayabilityAssessment;
