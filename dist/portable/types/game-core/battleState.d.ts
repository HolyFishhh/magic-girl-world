import type { BattleRequest } from './battleContract';
import { type CardPileZone, type CardZoneState } from './cardZoneReducer';
import { type CardZoneOperationPlan, type CommitCardZoneOperationResult } from './cardZoneOperation';
import { type BattleRandomState } from './deterministicRandom';
import type { EffectProgram } from './effectDsl';
import { type BattleEndResult } from './battleTerminal';
import { type CoreBattlePhase } from './turnState';
export interface Card {
    id: string;
    originalId?: string;
    name: string;
    cost: number | 'energy' | undefined;
    type: 'Attack' | 'Skill' | 'Power' | 'Event' | 'Curse';
    rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Corrupt';
    emoji: string;
    effectProgram: EffectProgram;
    description: string;
    discardEffectProgram?: EffectProgram;
    retain?: boolean;
    exhaust?: boolean;
    ethereal?: boolean;
    innate?: boolean;
    doubleEffect?: boolean;
}
export interface StatusEffect {
    id: string;
    name: string;
    type: 'buff' | 'debuff' | 'neutral' | 'ens';
    stacks: number;
    duration?: number;
    description: string;
    emoji: string;
}
export interface Item {
    id: string;
    name: string;
    description: string;
    effectProgram: EffectProgram;
    emoji: string;
    count: number;
}
export interface Relic {
    id: string;
    name: string;
    description: string;
    effectProgram: EffectProgram;
    emoji: string;
    rarity: 'Common' | 'Uncommon' | 'Rare' | 'Boss' | 'ENS';
    trigger: string;
}
export interface Ability {
    id: string;
    name?: string;
    emoji?: string;
    description?: string;
    trigger: string;
    effectProgram: EffectProgram;
}
export interface Player {
    maxHp: number;
    currentHp: number;
    maxLust: number;
    currentLust: number;
    energy: number;
    maxEnergy: number;
    block: number;
    statusEffects: StatusEffect[];
    relics: Relic[];
    deck: Card[];
    abilities?: Ability[];
    items?: Item[];
    modifiers?: Record<string, number>;
    hand: Card[];
    drawPile: Card[];
    discardPile: Card[];
    exhaustPile: Card[];
    drawPerTurn: number;
}
export interface EnemyIntent {
    type: 'attack' | 'defend' | 'buff' | 'debuff' | 'special';
    value?: number;
    description: string;
    emoji: string;
}
export interface EnemyAction {
    name: string;
    effectProgram: EffectProgram;
    description: string;
    weight: number;
}
export interface Enemy {
    id: string;
    name: string;
    maxHp: number;
    currentHp: number;
    maxLust: number;
    currentLust: number;
    energy: number;
    maxEnergy: number;
    block: number;
    statusEffects: StatusEffect[];
    intent: EnemyIntent;
    emoji: string;
    actions: EnemyAction[];
    nextAction: EnemyAction | null;
    lustEffect?: {
        name: string;
        description: string;
        effectProgram: EffectProgram;
    };
    abilities?: Ability[];
    dialogue: string;
    modifiers?: Record<string, number>;
    actionMode?: string;
    actionConfig?: Record<string, any>;
    _sequenceIndex?: number;
    _sequenceDoneOnce?: boolean;
}
export type BattlePhase = CoreBattlePhase;
export interface GameState {
    player: Player;
    enemy: Enemy | null;
    currentTurn: number;
    cardsPlayedThisTurn: number;
    attacksPlayedThisTurn: number;
    skillsPlayedThisTurn: number;
    phase: BattlePhase;
    isGameOver: boolean;
    battle?: Record<string, any>;
    battleRequest?: BattleRequest;
    random?: BattleRandomState;
    battleResult: BattleEndResult | 'ongoing';
    battleNarrative: string;
}
export type BattleStateChangeListener = (state: GameState) => void;
export declare function createEmptyPlayer(): Player;
export declare function createEmptyBattleState(): GameState;
/** Host-independent mutable battle state with deterministic random and rollback support. */
export declare class BattleStateStore {
    protected gameState: GameState;
    private readonly listeners;
    private readonly snapshots;
    private readonly inFlightCardCounts;
    constructor(initialState?: GameState);
    protected stateDidChange(_event: string, _state: GameState): void;
    protected notifyListeners(event: string): void;
    replaceState(state: GameState, event?: string): void;
    getGameState(): GameState;
    getPlayer(): Player;
    getEnemy(): Enemy | null;
    getCurrentPhase(): BattlePhase;
    isGameOver(): boolean;
    nextRandom(): number;
    updatePlayer(updates: Partial<Player>, _options?: {
        skipAttributeTriggers?: boolean;
    }): void;
    updateEnemy(updates: Partial<Enemy>, _options?: {
        skipAttributeTriggers?: boolean;
    }): void;
    setEnemy(enemy: Enemy): void;
    setPhase(phase: BattlePhase): void;
    incrementTurn(): void;
    beginEnemyTurn(): void;
    beginPlayerTurn(): void;
    setCurrentTurn(turn: number): void;
    setCardPlayCounters(counters: {
        cardsPlayedThisTurn: number;
        attacksPlayedThisTurn: number;
        skillsPlayedThisTurn: number;
    }): void;
    setBattleOutcome(result: BattleEndResult, narrativeText?: string): void;
    addStatusEffect(target: 'player' | 'enemy', effect: StatusEffect): void;
    removeStatusEffect(target: 'player' | 'enemy', effectId: string): void;
    updateStatusEffect(target: 'player' | 'enemy', effectId: string, updates: Partial<StatusEffect>): void;
    private getCardZones;
    private applyCardZones;
    removeCardFromHand(cardId: string): Card | null;
    moveCardToDiscard(card: Card): void;
    moveCardToExhaust(card: Card): void;
    moveOwnedCardsToExhaust(cardIds: readonly string[]): Card[];
    recoverOwnedCards(cardIds: readonly string[], source: 'draw' | 'discard' | 'exhaust'): Card[];
    scryOwnedCards(amount: number, cardIds: readonly string[]): Card[];
    updateOwnedCards(cardIds: readonly string[], update: (card: Card) => Card, sources?: readonly CardPileZone[]): Card[];
    replaceCardZones(zones: CardZoneState<Card>, event: 'draw' | 'shuffle'): void;
    readCardZoneState(): CardZoneState<Card>;
    commitCardZoneOperation(plan: CardZoneOperationPlan, selectedIds?: readonly string[]): CommitCardZoneOperationResult<Card>;
    createRuntimeCardId(sourceId: string): string;
    addCardToHand(card: Card): boolean;
    addCardToDeck(card: Card): void;
    beginCardTransit(card: Card): void;
    endCardTransit(card: Card): void;
    protected getInFlightCardCounts(): ReadonlyMap<string, number>;
    addEventListener(event: string, listener: BattleStateChangeListener): () => void;
    resetGame(): void;
    createSnapshot(name: string): boolean;
    restoreSnapshot(name: string): boolean;
    deleteSnapshot(name: string): boolean;
    clearTemporaryModifiers(): void;
}
