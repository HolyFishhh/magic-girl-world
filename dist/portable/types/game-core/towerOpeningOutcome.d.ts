import { type OpeningDeckTransform } from './towerOpeningTransforms';
export interface TowerOpeningRewardBundle {
    cards: Record<string, unknown>[];
    artifacts: Record<string, unknown>[];
    items: Record<string, unknown>[];
}
export interface TowerOpeningOutcomePlan {
    hpDelta: number;
    maxHpDelta: number;
    lustDelta: number;
    maxLustDelta: number;
    goldDelta: number;
    cardRemovalDelta: number;
    reward: TowerOpeningRewardBundle;
    deckTransforms: OpeningDeckTransform[];
}
/**
 * Normalize the small, program-settled outcome language used by the opening
 * benefactor. Card/relic/item definitions remain dynamic and are validated by
 * the existing reward library before anything is committed to MVU.
 */
export declare function planTowerOpeningOutcome(value: unknown): TowerOpeningOutcomePlan;
/**
 * Artifact ids are persistence keys, not player-facing authored prose. A
 * provider can still repeat the id of an initial relic in one mutually
 * exclusive opening gift even after being told not to; JSON Schema cannot
 * express that cross-array uniqueness rule. Preserve the authored relic and
 * mechanics, but give the offered copy a deterministic unused persistence id
 * before validation so this bookkeeping collision does not spend the single
 * model repair round-trip.
 */
export declare function canonicalizeTowerOpeningArtifactIds(choicesValue: unknown, battleValue: unknown): unknown[];
/**
 * Validate every mutually exclusive opening choice before it becomes visible.
 * Settlement uses the same reward validator again for atomic safety; this
 * earlier pass prevents a syntactically valid gift from failing only after the
 * player clicks it.
 */
export declare function validateTowerOpeningRewardCandidates(choices: readonly unknown[], battleValue: unknown): void;
