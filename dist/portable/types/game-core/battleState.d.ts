import { type PersistentGrowthOperation } from './persistentGrowth';
import type { BattleRequest } from './battleContract';
import type { PlayedCardDestination } from './cardRules';
import { type CardPileZone, type CardZoneState } from './cardZoneReducer';
import { type CardZoneOperationPlan, type CommitCardZoneOperationResult } from './cardZoneOperation';
import { type AdvancedCardZoneCommit, type AdvancedCardZonePlan, type AdvancedCardZoneFailureCode } from './advancedCardZoneTransaction';
import { type BattleRandomState } from './deterministicRandom';
import type { ConditionExpression, EffectProgram } from './effectDsl';
import type { CardIdentity, CardOrigin } from './cardIdentity';
import type { CardPatch, CardPatchBaseSnapshot, CardPatchLedger } from './cardPatch';
import type { CardAttachment } from './cardAttachment';
import type { CardCost, CombatResourceState } from './combatResource';
import { type CardAttachmentRemovalEvent } from './cardAttachment';
import type { CardMoveReason } from './battleEventJournal';
import { type CardPatchCleanupReason } from './cardPatch';
import { type BattleEndResult } from './battleTerminal';
import { type CoreBattlePhase } from './turnState';
import { type EffectSchedulerState, type ScheduleEffectDraft, type ScheduledEffect } from './effectScheduler';
import { type AppendBattleEventResult, type BattleEventDraft, type BattleEventJournalState } from './battleEventJournal';
import { channelOrb as channelOrbInContainer, modifyOrbValues as modifyValuesInOrbContainer, removeSelectedOrbs, resizeOrbContainer, transitionStance, type ActiveStance, type OrbContainer, type OrbInstance, type TurnControlState } from './specialCombatContainers';
import type { CardValueOperator, EffectOrbSelector } from './effectDsl';
import type { DamageProtectionRule } from './damageProtection';
import { copySummonUnits, healSummonUnits, updateSummonResources, type BattleOwner, type SummonActionQueueEntry, type SummonCollectionState, type SummonDamageResult, type SummonInterceptResult, type SummonOverflowPolicy, type SummonSelector, type SummonStatusState, type SummonUnit, type SummonUnitDefinition } from './summonUnit';
export interface Card extends Partial<CardIdentity> {
    /** Optional player-facing line shown when this card resolves. */
    dialogue?: string;
    unique?: boolean;
    lifecycle?: import('./cardLifecycle').CardLifecycle;
    id: string;
    originalId?: string;
    name: string;
    cost: CardCost | undefined;
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
    attachments?: CardAttachment[];
    replayCount?: number;
    xValueBonus?: number;
    requiresSummonTemplateId?: string;
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
    /** Omitted for acquisition-only relics; battle trigger resolution treats them as no-ops. */
    effectProgram?: EffectProgram;
    emoji: string;
    rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Boss' | 'ENS';
    trigger?: string;
    eventQuery?: import('./battleEventJournal').EventTriggerQuery;
    onAcquire?: import('./nonCombatSettlement').NonCombatSettlementPlan;
}
export interface Ability {
    id: string;
    name?: string;
    emoji?: string;
    description?: string;
    /** Player-facing origin, for example the card, relic or status that granted it. */
    source?: string;
    trigger: string;
    eventQuery?: import('./battleEventJournal').EventTriggerQuery;
    effectProgram: EffectProgram;
    /** Continuous ally protection; runtime resolves exact enemy IDs, never active aliases. */
    protection?: DamageProtectionRule;
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
    /** Stable acting entity identity; distinguishes several enemies in one turn. */
    actorId?: string;
    actorName?: string;
}
export interface Player {
    tags?: string[];
    emoji: string;
    maxHp: number;
    currentHp: number;
    maxLust: number;
    currentLust: number;
    energy: number;
    maxEnergy: number;
    /** Custom resources exclude the compatibility energy channel. */
    resources?: Record<string, CombatResourceState>;
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
    stance?: ActiveStance | null;
    orbs?: OrbContainer;
}
export interface EnemyIntent {
    type: 'attack' | 'defend' | 'buff' | 'debuff' | 'special';
    value?: number;
    description: string;
    emoji: string;
}
export interface EnemyAction {
    /** Stable authored identity used by event filters and lineage memory. */
    id?: string;
    name: string;
    emoji?: string;
    effectProgram: EffectProgram;
    description: string;
    dialogue?: string;
    weight: number;
}
export interface Enemy {
    id: string;
    /** Stable visible position. Defeat never shifts the surviving members. */
    stageSlot?: number;
    /** This enemy's finalized defeat ends the encounter, even with reserves. */
    victoryOnDefeat?: boolean;
    name: string;
    maxHp: number;
    currentHp: number;
    maxLust: number;
    currentLust: number;
    energy: number;
    maxEnergy: number;
    resources?: Record<string, CombatResourceState>;
    block: number;
    statusEffects: StatusEffect[];
    intent: EnemyIntent;
    emoji: string;
    actions: EnemyAction[];
    nextAction: EnemyAction | null;
    lustEffect?: {
        name: string;
        emoji?: string;
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
    /** Stable semantic tags used by generic targeting and execute exclusions. */
    tags?: string[];
    stance?: ActiveStance | null;
    orbs?: OrbContainer;
    /** Compiled from authored escape_when; JSON-safe and retained by battle snapshots. */
    escapeCondition?: ConditionExpression;
    /** Shown before departure; this is the earliest enemy turn that may remove it. */
    escapePending?: boolean;
    escapeReadyTurn?: number;
    /** Direct authored loot for this original encounter enemy; never retained by spawned reinforcements. */
    defeatReward?: Record<string, unknown>;
}
export type BattlePhase = CoreBattlePhase;
export interface PersistentGrowthEntry extends PersistentGrowthOperation {
    /** Stable across a battle-session reload; used by settlement receipts. */
    id: string;
}
export interface GameState {
    /** Explicit player-growth operations awaiting the one atomic battle settlement. */
    persistentGrowth?: PersistentGrowthEntry[];
    summonGrowth?: PersistentGrowthOperation[];
    /** Monotonic identity for event-bearing stances, persisted with battle state. */
    stanceActivationSequence?: number;
    player: Player;
    /** Ordered living/defeated enemy entities. New code uses this collection. */
    enemies?: Enemy[];
    /** Inactive wave members: excluded from targeting, timers, triggers and intentions. */
    reserveEnemies?: Enemy[];
    /** Removed combatants retained for complete logs and post-battle narration. */
    defeatedEnemies?: Enemy[];
    /** Combatants that left without being defeated. They never count as kills or reward receipts. */
    escapedEnemies?: Enemy[];
    /** Original encounter roster eligible for program-owned base gold; reinforcements are excluded. */
    rewardEligibleEnemyIds?: string[];
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
    /** Exact owned-card tombstones; persisted with the combat session until settlement. */
    purgedRunInstanceIds?: string[];
    effectScheduler?: EffectSchedulerState;
    turnControl?: TurnControlState;
    /** Independent allied/enemy sub-entities with their own HP, statuses and action order. */
    summons?: SummonCollectionState;
    /** Last capacity actually used by each side's summon operation; UI metadata. */
    summonLimits?: Partial<Record<BattleOwner, number>>;
}
export type BattleStateChangeListener = (state: GameState) => void;
export declare function createEmptyPlayer(): Player;
export declare function createEmptyBattleState(): GameState;
/** Host-independent mutable battle state with deterministic random and rollback support. */
export declare class BattleStateStore {
    private readonly identityPorts;
    protected gameState: GameState;
    private readonly listeners;
    private readonly snapshots;
    private readonly inFlightCardCounts;
    private readonly inFlightRunInstanceCounts;
    /** Runtime-only owner binding for nested enemy effects, including defeated owners. */
    private readonly enemyResolutionStack;
    constructor(initialState?: GameState, identityPorts?: {
        persistentGrowthNonce?: () => string;
    });
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
    readSummons(): SummonCollectionState;
    writeSummons(summons: SummonCollectionState, event?: string): void;
    getSummons(owner?: BattleOwner, livingOnly?: boolean): SummonUnit[];
    getSummonById(summonId: string): SummonUnit | null;
    spawnSummons(owner: BattleOwner, definition: SummonUnitDefinition, count: number, capacity?: number, overflow?: SummonOverflowPolicy, summonerId?: string | null): {
        spawned: SummonUnit[];
        replaced: SummonUnit[];
    };
    selectSummons(selector: SummonSelector, source: BattleOwner): SummonUnit[];
    copySummons(targetIds: readonly string[], owner: BattleOwner, capacity?: number, overflow?: SummonOverflowPolicy, binding?: {
        summonerId: string | null;
    } | 'preserve'): ReturnType<typeof copySummonUnits>;
    damageSummons(targetIds: readonly string[], amount: number, bypassBlock?: boolean): SummonDamageResult;
    healSummons(targetIds: readonly string[], amount: number): ReturnType<typeof healSummonUnits>;
    modifySummons(targetIds: readonly string[], stat: 'max_hp' | 'block' | 'actions_per_activation' | 'speed' | 'action_priority', operator: '+' | '-' | '*' | '/' | '=', value: number): SummonCollectionState;
    modifySummonEffects(targetIds: readonly string[], stat: import('./effectDsl').CardValueStat, operator: import('./effectDsl').CardValueOperator, value: number): SummonCollectionState;
    applyStatusToSummons(targetIds: readonly string[], definition: Omit<SummonStatusState, 'stacks'>, stacks: number): SummonCollectionState;
    removeStatusFromSummons(targetIds: readonly string[], statusId: string): SummonCollectionState;
    dismissSummons(targetIds: readonly string[], retainCorpse?: boolean): SummonUnit[];
    updateSummonResources(targetIds: readonly string[], resourceId: string, value: number, mode: 'gain' | 'set'): ReturnType<typeof updateSummonResources>;
    interceptDamageWithSummons(owner: BattleOwner, amount: number, protectedEnemyIdOrMitigate?: string | ((unit: SummonUnit, incoming: number) => number), mitigate?: (unit: SummonUnit, incoming: number) => number): SummonInterceptResult;
    resetSummonsForTurn(owner: BattleOwner): void;
    getSummonActionQueue(owner: BattleOwner): SummonActionQueueEntry[];
    /** Plan a full next activation at a state transition, never while reading an intent. */
    planSummonActions(targetIds: readonly string[]): void;
    /** Restore/legacy compatibility: fill only missing plan slots without changing an already visible intent. */
    ensureSummonActionsPlanned(targetIds: readonly string[]): void;
    getEnemy(): Enemy | null;
    getEnemies(options?: {
        livingOnly?: boolean;
    }): Enemy[];
    getEnemyById(enemyId: string): Enemy | null;
    /** Bind legacy side-based operations to one exact enemy for a nested resolution. */
    beginEnemyResolution(enemyId: string): boolean;
    endEnemyResolution(enemyId: string): void;
    private currentEnemyId;
    private currentEnemy;
    setActiveEnemy(enemyId: string): boolean;
    getCurrentPhase(): BattlePhase;
    isGameOver(): boolean;
    setBattleHistory(entries: readonly BattleHistoryEntry[]): void;
    nextRandom(): number;
    setRandomState(random: BattleRandomState): void;
    updatePlayer(updates: Partial<Player>, _options?: {
        skipAttributeTriggers?: boolean;
    }): void;
    /** Record only the dedicated permanent-growth operation; ordinary combat stat changes never enter this ledger. */
    recordPersistentGrowth(entry: Omit<PersistentGrowthEntry, 'id'>): void;
    growPlayerSummonTemplate(entry: PersistentGrowthOperation): void;
    updateEnemy(updates: Partial<Enemy>, _options?: {
        skipAttributeTriggers?: boolean;
    }): void;
    updateEnemyById(enemyId: string, updates: Partial<Enemy>, _options?: {
        skipAttributeTriggers?: boolean;
    }): void;
    setCombatantStance(target: 'player' | 'enemy', stance: Omit<ActiveStance, 'enteredTurn'> | null): ReturnType<typeof transitionStance>;
    setCombatantOrbSlots(target: 'player' | 'enemy', slots: number): ReturnType<typeof resizeOrbContainer>;
    channelCombatantOrb(target: 'player' | 'enemy', definition: Omit<OrbInstance, 'instanceId'>): ReturnType<typeof channelOrbInContainer>;
    removeCombatantOrbs(target: 'player' | 'enemy', selector: EffectOrbSelector): ReturnType<typeof removeSelectedOrbs>;
    modifyCombatantOrbValues(target: 'player' | 'enemy', selector: EffectOrbSelector, operator: CardValueOperator, value: number): ReturnType<typeof modifyValuesInOrbContainer>;
    queueExtraTurns(actor: 'player' | 'enemy', amount: number): void;
    consumeExtraTurn(actor: 'player' | 'enemy'): boolean;
    requestForceEndTurn(actor: 'player' | 'enemy'): void;
    isForceEndTurnRequested(actor: 'player' | 'enemy'): boolean;
    consumeForceEndTurn(actor: 'player' | 'enemy'): boolean;
    setEnemy(enemy: Enemy): void;
    setEnemies(enemies: readonly Enemy[], activeEnemyId?: string | null): void;
    removeDefeatedEnemies(enemyIds?: readonly string[]): Enemy[];
    getReserveEnemies(): Enemy[];
    admitReserveEnemies(): Enemy[];
    setRewardEligibleEnemyIds(enemyIds: readonly string[]): void;
    /** Remove a living enemy without processing defeat hooks or adding a kill receipt. */
    removeEscapingEnemy(enemyId: string): Enemy | null;
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
    purgeOwnedCard(card: Card): void;
    placeResolvedCard(card: Card, destination: PlayedCardDestination): PlayedCardDestination;
    moveOwnedCardsToExhaust(cardIds: readonly string[]): Card[];
    recoverOwnedCards(cardIds: readonly string[], source: 'draw' | 'discard' | 'exhaust'): Card[];
    scryOwnedCards(amount: number, cardIds: readonly string[]): Card[];
    updateOwnedCards(cardIds: readonly string[], update: (card: Card) => Card, sources?: readonly CardPileZone[]): Card[];
    clearOwnedCardPatches(reason: CardPatchCleanupReason): Card[];
    advanceOwnedCardAttachments(event: CardAttachmentRemovalEvent, reason?: CardMoveReason): Card[];
    /** Finalize card-local lifetimes at the real combat/run boundary, including upgrade history. */
    cleanupOwnedCardProgression(event: 'combat_end' | 'run_end'): Card[];
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
    /** One authoritative placement rule for generated cards and hand overflow. */
    placeGeneratedCard(card: Card, preferredZone: 'hand' | 'draw' | 'discard'): 'hand' | 'draw' | 'discard';
    beginCardTransit(card: Card): void;
    endCardTransit(card: Card): void;
    protected getInFlightCardCounts(): ReadonlyMap<string, number>;
    protected getInFlightRunInstanceIds(): IterableIterator<string>;
    addEventListener(event: string, listener: BattleStateChangeListener): () => void;
    resetGame(): void;
    createSnapshot(name: string): boolean;
    restoreSnapshot(name: string): boolean;
    deleteSnapshot(name: string): boolean;
    clearTemporaryModifiers(): void;
}
