import type { BattleRequest } from './battleContract';
import type { PlayedCardDestination } from './cardRules';
import { type CardPileZone, type CardZoneState } from './cardZoneReducer';
import { type CardZoneOperationPlan, type CommitCardZoneOperationResult } from './cardZoneOperation';
import { type AdvancedCardZoneCommit, type AdvancedCardZonePlan, type AdvancedCardZoneFailureCode } from './advancedCardZoneTransaction';
import { type BattleRandomState } from './deterministicRandom';
import type { EffectProgram } from './effectDsl';
import type { CardIdentity, CardOrigin } from './cardIdentity';
import type { CardPatch, CardPatchBaseSnapshot, CardPatchLedger } from './cardPatch';
import { type CardPatchCleanupReason } from './cardPatch';
import { type BattleEndResult } from './battleTerminal';
import { type CoreBattlePhase } from './turnState';
import { type EffectSchedulerState, type ScheduleEffectDraft, type ScheduledEffect } from './effectScheduler';
import { type AppendBattleEventResult, type BattleEventDraft, type BattleEventJournalState } from './battleEventJournal';
export interface Card extends Partial<CardIdentity> {
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
    origin?: CardOrigin;
    tags?: string[];
    upgraded?: boolean;
    upgradeLevel?: number;
    patchBase?: CardPatchBaseSnapshot;
    patches?: CardPatch[];
    replayCount?: number;
    xValueBonus?: number;
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
    /** Player-facing origin, for example the card, relic or status that granted it. */
    source?: string;
    trigger: string;
    effectProgram: EffectProgram;
}
export interface BattleHistoryEntry {
    turn: number;
    type: 'info' | 'damage' | 'heal' | 'action' | 'system';
    message: string;
    source?: {
        type: 'card' | 'relic' | 'ability' | 'status';
        name: string;
        details?: string;
    };
    actor?: 'player' | 'enemy';
    actionName?: string;
}
export interface Player {
    emoji: string;
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
    /** Higher priority acts first; speed breaks equal-priority ties. */
    actionPriority?: number;
    speed?: number;
}
export type BattlePhase = CoreBattlePhase;
export interface GameState {
    player: Player;
    /** Ordered living/defeated enemy entities. New code uses this collection. */
    enemies?: Enemy[];
    /** Player-selected or compatibility opponent. */
    activeEnemyId?: string | null;
    /** Legacy active-opponent alias; kept synchronized with enemies. */
    enemy: Enemy | null;
    currentTurn: number;
    cardsPlayedThisTurn: number;
    attacksPlayedThisTurn: number;
    skillsPlayedThisTurn: number;
    /** Player-initiated plays consume per-turn free/Replay windows; automatic plays do not. */
    cardRuleUsesThisTurn?: number;
    phase: BattlePhase;
    isGameOver: boolean;
    battle?: Record<string, any>;
    battleRequest?: BattleRequest;
    random?: BattleRandomState;
    battleResult: BattleEndResult | 'ongoing';
    battleNarrative: string;
    /** Compact structured history survives iframe reloads and is summarized at settlement. */
    battleHistory?: BattleHistoryEntry[];
    /** Structured causal history for counters, triggers, save/restore and complete battle reports. */
    eventJournal?: BattleEventJournalState;
    /** Template/future-copy patches are persisted separately from concrete card instances. */
    cardPatchLedger?: CardPatchLedger;
    effectScheduler?: EffectSchedulerState;
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
    protected normalizeEnemyCollection(): void;
    private syncLegacyEnemyAlias;
    protected stateDidChange(_event: string, _state: GameState): void;
    protected notifyListeners(event: string): void;
    replaceState(state: GameState, event?: string): void;
    getGameState(): GameState;
    getPlayer(): Player;
    recordBattleEvent(draft: BattleEventDraft): AppendBattleEventResult;
    readEffectScheduler(): EffectSchedulerState;
    writeEffectScheduler(scheduler: EffectSchedulerState): void;
    scheduleEffect(draft: ScheduleEffectDraft): ScheduledEffect;
    readCardPatchLedger(): CardPatchLedger;
    writeCardPatchLedger(ledger: CardPatchLedger): void;
    getEnemy(): Enemy | null;
    getEnemies(options?: {
        livingOnly?: boolean;
    }): Enemy[];
    getEnemyById(enemyId: string): Enemy | null;
    setActiveEnemy(enemyId: string): boolean;
    getCurrentPhase(): BattlePhase;
    isGameOver(): boolean;
    setBattleHistory(entries: readonly BattleHistoryEntry[]): void;
    nextRandom(): number;
    setRandomState(random: BattleRandomState): void;
    updatePlayer(updates: Partial<Player>, _options?: {
        skipAttributeTriggers?: boolean;
    }): void;
    updateEnemy(updates: Partial<Enemy>, _options?: {
        skipAttributeTriggers?: boolean;
    }): void;
    updateEnemyById(enemyId: string, updates: Partial<Enemy>, _options?: {
        skipAttributeTriggers?: boolean;
    }): void;
    setEnemy(enemy: Enemy): void;
    setEnemies(enemies: readonly Enemy[], activeEnemyId?: string | null): void;
    removeDefeatedEnemies(): Enemy[];
    setPhase(phase: BattlePhase): void;
    incrementTurn(): void;
    beginEnemyTurn(): void;
    beginPlayerTurn(): void;
    setCurrentTurn(turn: number): void;
    setCardPlayCounters(counters: {
        cardsPlayedThisTurn: number;
        attacksPlayedThisTurn: number;
        skillsPlayedThisTurn: number;
        cardRuleUsesThisTurn?: number;
    }): void;
    setBattleOutcome(result: BattleEndResult, narrativeText?: string): void;
    addStatusEffect(target: 'player' | 'enemy', effect: StatusEffect): void;
    removeStatusEffect(target: 'player' | 'enemy', effectId: string): void;
    updateStatusEffect(target: 'player' | 'enemy', effectId: string, updates: Partial<StatusEffect>): void;
    private getCardZones;
    private applyCardZones;
    removeCardFromHand(cardId: string): Card | null;
    removeOwnedCardFromZone(cardId: string, zone: CardPileZone): Card | null;
    moveCardToDiscard(card: Card): void;
    moveCardToExhaust(card: Card): void;
    placeResolvedCard(card: Card, destination: PlayedCardDestination): PlayedCardDestination;
    moveOwnedCardsToExhaust(cardIds: readonly string[]): Card[];
    recoverOwnedCards(cardIds: readonly string[], source: 'draw' | 'discard' | 'exhaust'): Card[];
    scryOwnedCards(amount: number, cardIds: readonly string[]): Card[];
    updateOwnedCards(cardIds: readonly string[], update: (card: Card) => Card, sources?: readonly CardPileZone[]): Card[];
    clearOwnedCardPatches(reason: CardPatchCleanupReason): Card[];
    replaceCardZones(zones: CardZoneState<Card>, event: 'draw' | 'shuffle'): void;
    readCardZoneState(): CardZoneState<Card>;
    commitCardZoneOperation(plan: CardZoneOperationPlan, selectedIds?: readonly string[]): CommitCardZoneOperationResult<Card>;
    commitAdvancedCardZoneTransaction(plan: AdvancedCardZonePlan, selectedIds?: readonly string[]): AdvancedCardZoneCommit<Card> | {
        ok: false;
        code: AdvancedCardZoneFailureCode;
    };
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
