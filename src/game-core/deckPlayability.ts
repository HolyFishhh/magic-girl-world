import { hasContentMetric, type ContentAnalysis } from './contentAnalysis';

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

function cardQuantity(value: unknown): number {
  if (value === undefined) return 1;
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function cardHasMetric(card: DeckPlayabilityCard, metric: Parameters<typeof hasContentMetric>[1]): boolean {
  const analysis = card.analysis;
  if (!analysis) return false;
  return hasContentMetric(analysis, metric);
}

function canPlayAtBaseEnergy(card: DeckPlayabilityCard, baseEnergy: number): boolean {
  if (card.type === 'Curse') return false;
  if (card.cost === 'energy') return true;
  return typeof card.cost === 'number' && Number.isFinite(card.cost) && card.cost <= baseEnergy;
}

/** Assess minimum deck properties without reading a host runtime or simulating combat. */
export function assessDeckPlayability(
  cards: readonly DeckPlayabilityCard[],
  options: DeckPlayabilityOptions = {},
): DeckPlayabilityAssessment {
  const baseEnergy =
    typeof options.baseEnergy === 'number' && Number.isFinite(options.baseEnergy)
      ? Math.max(0, options.baseEnergy)
      : 3;
  let deckQuantity = 0;
  let hasPlayableCard = false;
  let hasVictoryPressure = false;
  let hasDefenseOrRecovery = false;

  for (const card of cards) {
    deckQuantity += cardQuantity(card.quantity);
    hasPlayableCard ||= canPlayAtBaseEnergy(card, baseEnergy);
    hasVictoryPressure ||= card.type === 'Event' || cardHasMetric(card, 'attack');
    hasDefenseOrRecovery ||= cardHasMetric(card, 'defense') || cardHasMetric(card, 'sustain');
  }

  return { deckQuantity, hasPlayableCard, hasVictoryPressure, hasDefenseOrRecovery };
}
