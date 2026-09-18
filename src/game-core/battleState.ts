import { growSummonDefinition, type PersistentGrowthOperation } from './persistentGrowth';
import type { BattleRequest } from './battleContract';
import { roundBattleValue } from './battleMath';
import type { PlayedCardDestination } from './cardRules';
import { getCardSourceId } from './cardRules';
import {
  appendCardToZone,
  insertCardIntoZone,
  moveCardsBetweenZones,
  removeCardFromZone,
  scryCardsFromDraw,
  updateCardsInZones,
  type CardPileZone,
  type CardZoneState,
} from './cardZoneReducer';
import {
  commitCardZoneOperation,
  type CardZoneOperationPlan,
  type CommitCardZoneOperationResult,
} from './cardZoneOperation';
import {
  commitAdvancedCardZoneTransaction,
  type AdvancedCardZoneCommit,
  type AdvancedCardZonePlan,
  type AdvancedCardZoneFailureCode,
} from './advancedCardZoneTransaction';
import { createBattleRandomState, drawBattleRandom, type BattleRandomState } from './deterministicRandom';
import type { ConditionExpression, EffectProgram } from './effectDsl';
import { allocateRuntimeId } from './runtimeIds';
import { arrangeEnemyFrontline, admitEnemyReserves } from './enemyFormation';
import type { CardIdentity, CardOrigin } from './cardIdentity';
import type { CardPatch, CardPatchBaseSnapshot, CardPatchLedger } from './cardPatch';
import type { CardAttachment } from './cardAttachment';
import type { CardCost, CombatResourceState } from './combatResource';
import { advanceCardAttachments, type CardAttachmentRemovalEvent } from './cardAttachment';
import type { CardMoveReason } from './battleEventJournal';
import { clearCardPatches, createCardPatchLedger, type CardPatchCleanupReason } from './cardPatch';
import { cleanupCardProgression } from './cardProgression';
import { transitionToBattleEnd, type BattleEndResult } from './battleTerminal';
import { advanceTurnCounter, beginEnemyTurn, beginPlayerTurn, type CoreBattlePhase } from './turnState';
import {
  createEffectSchedulerState,
  scheduleEffect as appendScheduledEffect,
  type EffectSchedulerState,
  type ScheduleEffectDraft,
  type ScheduledEffect,
} from './effectScheduler';
import {
  appendBattleEvent,
  createBattleEventJournal,
  type AppendBattleEventResult,
  type BattleEventDraft,
  type BattleEventJournalState,
} from './battleEventJournal';
import {
  addExtraTurns,
  channelOrb as channelOrbInContainer,
  consumeExtraTurn as consumeQueuedExtraTurn,
  modifyOrbValues as modifyValuesInOrbContainer,
  normalizeOrbContainer,
  normalizeTurnControl,
  removeSelectedOrbs,
  resizeOrbContainer,
  setForceEndTurn,
  transitionStance,
  type ActiveStance,
  type OrbContainer,
  type OrbInstance,
  type TurnControlState,
} from './specialCombatContainers';
import type { CardValueOperator, EffectOrbSelector } from './effectDsl';
import type { DamageProtectionRule } from './damageProtection';
import {
  applySummonStatus,
  buildSummonActionQueue,
  createSummonCollectionState,
  copySummonUnits,
  damageSummonUnits,
  dismissSummonUnits,
  healSummonUnits,
  interceptUnblockedAttack,
  modifySummonUnits,
  modifySummonEffectPrograms,
  planSummonActions,
  removeSummonStatus,
  resetSummonTurnState,
  resolveSummonTargets,
  spawnSummonUnits,
  updateSummonResources,
  type BattleOwner,
  type SummonActionQueueEntry,
  type SummonCollectionState,
  type SummonDamageResult,
  type SummonInterceptResult,
  type SummonOverflowPolicy,
  type SummonSelector,
  type SummonStatusState,
  type SummonUnit,
  type SummonUnitDefinition,
} from './summonUnit';

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
  source?: { type: 'card' | 'relic' | 'ability' | 'status'; name: string; details?: string };
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

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

export function createEmptyPlayer(): Player {
  return {
    emoji: '✨',
    maxHp: 80,
    currentHp: 80,
    maxLust: 100,
    currentLust: 0,
    energy: 3,
    maxEnergy: 3,
    block: 0,
    statusEffects: [],
    relics: [],
    deck: [],
    hand: [],
    drawPile: [],
    discardPile: [],
    exhaustPile: [],
    drawPerTurn: 5,
  };
}

export function createEmptyBattleState(): GameState {
  return {
    player: createEmptyPlayer(),
    enemies: [],
    defeatedEnemies: [],
    escapedEnemies: [],
    activeEnemyId: null,
    enemy: null,
    currentTurn: 0,
    cardsPlayedThisTurn: 0,
    attacksPlayedThisTurn: 0,
    skillsPlayedThisTurn: 0,
    cardRuleUsesThisTurn: 0,
    phase: 'setup',
    isGameOver: false,
    battleResult: 'ongoing',
    battleNarrative: '',
    battleHistory: [],
    eventJournal: createBattleEventJournal(),
    cardPatchLedger: createCardPatchLedger(),
    effectScheduler: createEffectSchedulerState(),
    turnControl: normalizeTurnControl(),
    summons: createSummonCollectionState(),
    persistentGrowth: [],
  };
}

/** Host-independent mutable battle state with deterministic random and rollback support. */
export class BattleStateStore {
  protected gameState: GameState;

  private readonly listeners = new Map<string, BattleStateChangeListener[]>();
  private readonly snapshots = new Map<string, GameState>();
  private readonly inFlightCardCounts = new Map<string, number>();
  private readonly inFlightRunInstanceCounts = new Map<string, number>();
  /** Runtime-only owner binding for nested enemy effects, including defeated owners. */
  private readonly enemyResolutionStack: string[] = [];

  public constructor(
    initialState: GameState = createEmptyBattleState(),
    private readonly identityPorts: { persistentGrowthNonce?: () => string } = {},
  ) {
    this.gameState = cloneState(initialState);
    this.normalizeEnemyCollection();
    this.gameState.eventJournal = initialState.eventJournal
      ? createBattleEventJournal(initialState.eventJournal.events || [], initialState.eventJournal.runHistory)
      : createBattleEventJournal();
    this.gameState.cardPatchLedger = initialState.cardPatchLedger
      ? createCardPatchLedger(initialState.cardPatchLedger.patches)
      : createCardPatchLedger();
    this.gameState.effectScheduler = initialState.effectScheduler
      ? createEffectSchedulerState(initialState.effectScheduler.queue)
      : createEffectSchedulerState();
    this.gameState.turnControl = normalizeTurnControl(initialState.turnControl);
    this.gameState.summons = createSummonCollectionState(
      initialState.summons?.living || [],
      initialState.summons?.defeated || [],
    );
    this.gameState.summons.nextSequence = Math.max(
      this.gameState.summons.nextSequence,
      initialState.summons?.nextSequence || 1,
    );
    this.gameState.player.orbs = normalizeOrbContainer(initialState.player.orbs);
    this.gameState.cardRuleUsesThisTurn = Math.max(
      0,
      Math.trunc(initialState.cardRuleUsesThisTurn ?? initialState.cardsPlayedThisTurn ?? 0),
    );
  }

  protected normalizeEnemyCollection(): void {
    const source = Array.isArray(this.gameState.enemies) && (this.gameState.enemies.length > 0 || !this.gameState.enemy)
      ? this.gameState.enemies
      : this.gameState.enemy
        ? [this.gameState.enemy]
        : [];
    const seen = new Set<string>();
    const unique = source.filter(enemy => {
      if (!enemy?.id || seen.has(enemy.id)) return false;
      seen.add(enemy.id);
      return true;
    }).map(enemy => ({ ...enemy, orbs: normalizeOrbContainer(enemy.orbs) }));
    const formation = arrangeEnemyFrontline(unique, this.gameState.reserveEnemies || []);
    this.gameState.enemies = formation.frontline;
    this.gameState.reserveEnemies = formation.reserves;
    const requested = this.gameState.activeEnemyId;
    this.gameState.activeEnemyId = requested && this.gameState.enemies.some(enemy => enemy.id === requested)
      ? requested
      : this.gameState.enemies.find(enemy => enemy.currentHp > 0)?.id || this.gameState.enemies[0]?.id || null;
    this.syncLegacyEnemyAlias();
  }

  private syncLegacyEnemyAlias(): void {
    const requested = this.gameState.enemies?.find(enemy => enemy.id === this.gameState.activeEnemyId) || null;
    const active = (requested?.currentHp || 0) > 0
      ? requested
      : this.gameState.enemies?.find(enemy => enemy.currentHp > 0) || requested;
    this.gameState.activeEnemyId = active?.id || null;
    this.gameState.enemy = active ? cloneState(active) : null;
  }

  protected stateDidChange(_event: string, _state: GameState): void {}

  protected notifyListeners(event: string): void {
    for (const listener of this.listeners.get(event) || []) listener(this.gameState);
    for (const listener of this.listeners.get('state_changed') || []) listener(this.gameState);
    this.stateDidChange(event, this.gameState);
  }

  public replaceState(state: GameState, event = 'state_replaced'): void {
    this.gameState = cloneState(state);
    this.gameState.turnControl = normalizeTurnControl(this.gameState.turnControl);
    this.gameState.player.orbs = normalizeOrbContainer(this.gameState.player.orbs);
    this.normalizeEnemyCollection();
    this.notifyListeners(event);
  }

  public getGameState(): GameState {
    return { ...this.gameState };
  }

  public getPlayer(): Player {
    return { ...this.gameState.player };
  }

  public recordBattleEvent(draft: BattleEventDraft): AppendBattleEventResult {
    const sideOf = (id: string | undefined): 'player' | 'enemy' | undefined => {
      if (!id) return undefined;
      if (id === 'player') return 'player';
      if (id === 'enemy' || this.getEnemyById(id)) return 'enemy';
      return this.getSummonById(id)?.owner;
    };
    const actorSide = sideOf('actorId' in draft ? draft.actorId : undefined);
    const targetSide = sideOf('targetId' in draft ? draft.targetId : undefined);
    const result = appendBattleEvent(this.gameState.eventJournal || createBattleEventJournal(), {
      ...draft,
      ...(actorSide ? { actorSide } : {}),
      ...(targetSide ? { targetSide } : {}),
    });
    if (result.ok) {
      this.gameState.eventJournal = result.state;
      this.notifyListeners('battle_event_recorded');
    }
    return result;
  }

  public readEffectScheduler(): EffectSchedulerState {
    return cloneState(this.gameState.effectScheduler || createEffectSchedulerState());
  }

  public writeEffectScheduler(scheduler: EffectSchedulerState): void {
    this.gameState.effectScheduler = cloneState(scheduler);
    this.notifyListeners('effect_scheduler_updated');
  }

  public scheduleEffect(draft: ScheduleEffectDraft): ScheduledEffect {
    const result = appendScheduledEffect(this.readEffectScheduler(), draft);
    this.writeEffectScheduler(result.state);
    return cloneState(result.scheduled);
  }

  public readCardPatchLedger(): CardPatchLedger {
    return cloneState(this.gameState.cardPatchLedger || createCardPatchLedger());
  }

  public writeCardPatchLedger(ledger: CardPatchLedger): void {
    this.gameState.cardPatchLedger = cloneState(ledger);
    this.notifyListeners('card_patch_ledger_updated');
  }

  public readSummons(): SummonCollectionState {
    return cloneState(this.gameState.summons || createSummonCollectionState());
  }

  public writeSummons(summons: SummonCollectionState, event = 'summons_updated'): void {
    const normalized = createSummonCollectionState(summons.living, summons.defeated);
    normalized.nextSequence = Math.max(normalized.nextSequence, summons.nextSequence || 1);
    this.gameState.summons = normalized;
    this.notifyListeners(event);
  }

  public getSummons(owner?: BattleOwner, livingOnly = true): SummonUnit[] {
    const summons = this.readSummons();
    const values = livingOnly ? summons.living : [...summons.living, ...summons.defeated];
    return values.filter(unit => !owner || unit.owner === owner);
  }

  public getSummonById(summonId: string): SummonUnit | null {
    const summons = this.readSummons();
    const unit = [...summons.living, ...summons.defeated].find(entry => entry.instanceId === summonId);
    return unit ? cloneState(unit) : null;
  }

  public spawnSummons(
    owner: BattleOwner,
    definition: SummonUnitDefinition,
    count: number,
    capacity = owner === 'enemy' ? Number.MAX_SAFE_INTEGER : 3,
    overflow: SummonOverflowPolicy = 'replace_oldest',
    summonerId: string | null = owner === 'player' ? 'player' : null,
  ): { spawned: SummonUnit[]; replaced: SummonUnit[] } {
    const result = spawnSummonUnits(
      this.readSummons(), owner, owner === 'player' ? growSummonDefinition(definition, this.gameState.summonGrowth || []) : definition, count, capacity, overflow, this.gameState.currentTurn, summonerId,
    );
    this.gameState.summonLimits = { ...this.gameState.summonLimits, [owner]: capacity };
    this.writeSummons(result.state, 'summons_spawned');
    this.planSummonActions(result.spawned.map(unit => unit.instanceId));
    return { spawned: result.spawned.map(unit => this.getSummonById(unit.instanceId) || unit), replaced: result.replaced };
  }

  public selectSummons(selector: SummonSelector, source: BattleOwner): SummonUnit[] {
    return resolveSummonTargets(this.readSummons(), selector, source, () => this.nextRandom());
  }

  public copySummons(
    targetIds: readonly string[],
    owner: BattleOwner,
    capacity = owner === 'enemy' ? Number.MAX_SAFE_INTEGER : 3,
    overflow: SummonOverflowPolicy = 'replace_oldest',
    binding: { summonerId: string | null } | 'preserve' = 'preserve',
  ): ReturnType<typeof copySummonUnits> {
    const result = copySummonUnits(
      this.readSummons(), targetIds, owner, capacity, overflow, this.gameState.currentTurn, binding,
    );
    this.writeSummons(result.state, 'summons_copied');
    this.planSummonActions(result.copied.map(unit => unit.instanceId));
    return { ...result, copied: result.copied.map(unit => this.getSummonById(unit.instanceId) || unit) };
  }

  public damageSummons(targetIds: readonly string[], amount: number, bypassBlock = false): SummonDamageResult {
    const result = damageSummonUnits(this.readSummons(), targetIds, amount, bypassBlock);
    this.writeSummons(result.state, 'summons_damaged');
    return result;
  }

  public healSummons(targetIds: readonly string[], amount: number): ReturnType<typeof healSummonUnits> {
    const result = healSummonUnits(this.readSummons(), targetIds, amount);
    this.writeSummons(result.state, 'summons_healed');
    return result;
  }

  public modifySummons(
    targetIds: readonly string[],
    stat: 'max_hp' | 'block' | 'actions_per_activation' | 'speed' | 'action_priority',
    operator: '+' | '-' | '*' | '/' | '=',
    value: number,
  ): SummonCollectionState {
    const result = modifySummonUnits(this.readSummons(), targetIds, stat, operator, value);
    this.writeSummons(result, 'summons_modified');
    return this.readSummons();
  }

  public modifySummonEffects(
    targetIds: readonly string[],
    stat: import('./effectDsl').CardValueStat,
    operator: import('./effectDsl').CardValueOperator,
    value: number,
  ): SummonCollectionState {
    const result = modifySummonEffectPrograms(this.readSummons(), targetIds, stat, operator, value);
    this.writeSummons(result, 'summon_effects_modified');
    return this.readSummons();
  }

  public applyStatusToSummons(
    targetIds: readonly string[],
    definition: Omit<SummonStatusState, 'stacks'>,
    stacks: number,
  ): SummonCollectionState {
    const result = applySummonStatus(this.readSummons(), targetIds, definition, stacks);
    this.writeSummons(result, 'summon_status_applied');
    return this.readSummons();
  }

  public removeStatusFromSummons(targetIds: readonly string[], statusId: string): SummonCollectionState {
    const result = removeSummonStatus(this.readSummons(), targetIds, statusId);
    this.writeSummons(result, 'summon_status_removed');
    return this.readSummons();
  }

  public dismissSummons(targetIds: readonly string[], retainCorpse = false): SummonUnit[] {
    const result = dismissSummonUnits(this.readSummons(), targetIds, retainCorpse);
    this.writeSummons(result.state, 'summons_dismissed');
    return result.dismissed;
  }

  public updateSummonResources(
    targetIds: readonly string[],
    resourceId: string,
    value: number,
    mode: 'gain' | 'set',
  ): ReturnType<typeof updateSummonResources> {
    const result = updateSummonResources(this.readSummons(), targetIds, resourceId, value, mode);
    this.writeSummons(result.state, 'summon_resources_updated');
    return result;
  }

  public interceptDamageWithSummons(owner: BattleOwner, amount: number, protectedEnemyIdOrMitigate?: string | ((unit: SummonUnit, incoming: number) => number), mitigate?: (unit: SummonUnit, incoming: number) => number): SummonInterceptResult {
    const protectedEnemyId = typeof protectedEnemyIdOrMitigate === 'string' ? protectedEnemyIdOrMitigate : undefined;
    const effectiveMitigate = typeof protectedEnemyIdOrMitigate === 'function' ? protectedEnemyIdOrMitigate : mitigate;
    const result = interceptUnblockedAttack(this.readSummons(), owner, amount, effectiveMitigate, protectedEnemyId);
    if (result.hits.length > 0) this.writeSummons(result.state, 'summon_damage_intercepted');
    return result;
  }

  public resetSummonsForTurn(owner: BattleOwner): void {
    this.writeSummons(resetSummonTurnState(this.readSummons(), owner), 'summon_turn_reset');
  }

  public getSummonActionQueue(owner: BattleOwner): SummonActionQueueEntry[] {
    return buildSummonActionQueue(this.readSummons(), owner);
  }

  /** Plan a full next activation at a state transition, never while reading an intent. */
  public planSummonActions(targetIds: readonly string[]): void {
    if (targetIds.length === 0) return;
    this.writeSummons(planSummonActions(this.readSummons(), targetIds, () => this.nextRandom()), 'summon_actions_planned');
  }

  /** Restore/legacy compatibility: fill only missing plan slots without changing an already visible intent. */
  public ensureSummonActionsPlanned(targetIds: readonly string[]): void {
    if (targetIds.length === 0) return;
    this.writeSummons(planSummonActions(this.readSummons(), targetIds, () => this.nextRandom(), false), 'summon_actions_planned');
  }

  public getEnemy(): Enemy | null {
    const resolvedId = this.enemyResolutionStack.at(-1);
    if (resolvedId) {
      const resolved = this.gameState.enemies?.find(enemy => enemy.id === resolvedId);
      if (resolved) return cloneState(resolved);
    }
    this.syncLegacyEnemyAlias();
    return this.gameState.enemy ? cloneState(this.gameState.enemy) : null;
  }

  public getEnemies(options: { livingOnly?: boolean } = {}): Enemy[] {
    return cloneState((this.gameState.enemies || []).filter(enemy => !options.livingOnly || enemy.currentHp > 0));
  }

  public getEnemyById(enemyId: string): Enemy | null {
    const enemy = this.gameState.enemies?.find(entry => entry.id === enemyId);
    return enemy ? cloneState(enemy) : null;
  }

  /** Bind legacy side-based operations to one exact enemy for a nested resolution. */
  public beginEnemyResolution(enemyId: string): boolean {
    if (!this.gameState.enemies?.some(enemy => enemy.id === enemyId)) return false;
    this.enemyResolutionStack.push(enemyId);
    return true;
  }

  public endEnemyResolution(enemyId: string): void {
    const index = this.enemyResolutionStack.lastIndexOf(enemyId);
    if (index >= 0) this.enemyResolutionStack.splice(index, 1);
  }

  private currentEnemyId(): string | null {
    const resolvedId = this.enemyResolutionStack.at(-1);
    if (resolvedId && this.gameState.enemies?.some(enemy => enemy.id === resolvedId)) return resolvedId;
    return this.gameState.activeEnemyId || this.gameState.enemy?.id || null;
  }

  private currentEnemy(): Enemy | null {
    const enemyId = this.currentEnemyId();
    return enemyId ? this.gameState.enemies?.find(enemy => enemy.id === enemyId) || null : null;
  }

  public setActiveEnemy(enemyId: string): boolean {
    const enemy = this.gameState.enemies?.find(entry => entry.id === enemyId && entry.currentHp > 0);
    if (!enemy) return false;
    this.gameState.activeEnemyId = enemyId;
    this.syncLegacyEnemyAlias();
    this.notifyListeners('active_enemy_changed');
    return true;
  }

  public getCurrentPhase(): BattlePhase {
    return this.gameState.phase;
  }

  public isGameOver(): boolean {
    return this.gameState.isGameOver;
  }

  public setBattleHistory(entries: readonly BattleHistoryEntry[]): void {
    this.gameState.battleHistory = cloneState(entries.slice(-600));
    this.notifyListeners('battle_history_updated');
  }

  public nextRandom(): number {
    const current = this.gameState.random || createBattleRandomState(0);
    const draw = drawBattleRandom(current);
    this.gameState.random = draw.state;
    return draw.value;
  }

  public setRandomState(random: BattleRandomState): void {
    this.gameState.random = cloneState(random);
    this.notifyListeners('random_updated');
  }

  public updatePlayer(updates: Partial<Player>, _options?: { skipAttributeTriggers?: boolean }): void {
    this.gameState.player = { ...this.gameState.player, ...updates };
    this.notifyListeners('player_updated');
  }

  /** Record only the dedicated permanent-growth operation; ordinary combat stat changes never enter this ledger. */
  public recordPersistentGrowth(entry: Omit<PersistentGrowthEntry, 'id'>): void {
    if (!Number.isFinite(entry.value)) throw new Error('persistent growth value must be finite');
    const existingIds = new Set((this.gameState.persistentGrowth || []).map(value => value.id));
    // Hosts supply a unique receipt namespace; portable replay stays deterministic.
    // The allocated ID is saved in the ledger and survives reload unchanged.
    const nonce = this.identityPorts.persistentGrowthNonce?.() || 'replay';
    const source = `persistent_growth_${this.gameState.battleRequest?.seed ?? 'combat'}_${nonce}`;
    this.gameState.persistentGrowth = [
      ...(this.gameState.persistentGrowth || []),
      { ...entry, id: allocateRuntimeId(source, existingIds), value: roundBattleValue(entry.value) },
    ];
    this.notifyListeners('persistent_growth_recorded');
  }

  public growPlayerSummonTemplate(entry: PersistentGrowthOperation): void {
    const collection = this.readSummons();
    const grow = (unit: SummonUnit): SummonUnit => {
      if (unit.owner !== 'player' || unit.templateId !== entry.summonTemplateId) return unit;
      const definition = growSummonDefinition({ ...unit, id: unit.templateId }, [entry]);
      return { ...unit, ...definition, id: unit.id, maxHp: definition.maxHp ?? unit.maxHp,
        currentHp: Math.min(unit.currentHp, definition.maxHp ?? unit.maxHp) };
    };
    this.gameState.summonGrowth = [...(this.gameState.summonGrowth || []), structuredClone(entry)];
    this.writeSummons({ ...collection, living: collection.living.map(grow), defeated: collection.defeated.map(grow) }, 'summon_permanent_growth');
  }

  public updateEnemy(updates: Partial<Enemy>, _options?: { skipAttributeTriggers?: boolean }): void {
    const enemyId = this.currentEnemyId();
    if (!enemyId) return;
    this.updateEnemyById(enemyId, updates, _options);
  }

  public updateEnemyById(
    enemyId: string,
    updates: Partial<Enemy>,
    _options?: { skipAttributeTriggers?: boolean },
  ): void {
    const index = this.gameState.enemies?.findIndex(enemy => enemy.id === enemyId) ?? -1;
    if (index < 0 || !this.gameState.enemies) return;
    if (updates.id !== undefined && updates.id !== enemyId) throw new Error('enemy id is immutable');
    this.gameState.enemies[index] = { ...this.gameState.enemies[index], ...cloneState(updates), id: enemyId };
    this.syncLegacyEnemyAlias();
    this.notifyListeners('enemy_updated');
  }

  public setCombatantStance(
    target: 'player' | 'enemy',
    stance: Omit<ActiveStance, 'enteredTurn'> | null,
  ): ReturnType<typeof transitionStance> {
    const entity = target === 'player' ? this.gameState.player : this.currentEnemy();
    const result = transitionStance(entity?.stance, stance, this.gameState.currentTurn);
    if (!entity || !result.changed) return result;
    if (result.next?.events?.length) {
      const largest = Math.max(0, this.gameState.stanceActivationSequence || 0,
        this.gameState.player.stance?.activationId || 0,
        ...(this.gameState.enemies || []).map(enemy => enemy.stance?.activationId || 0));
      if (!Number.isSafeInteger(largest) || largest >= Number.MAX_SAFE_INTEGER) throw new Error('Stance activation identity exhausted');
      this.gameState.stanceActivationSequence = largest + 1;
      result.next.activationId = largest + 1;
    }
    if (target === 'player') this.gameState.player.stance = result.next;
    else this.updateEnemy({ stance: result.next });
    if (target === 'player') this.notifyListeners('stance_changed');
    return result;
  }

  public setCombatantOrbSlots(
    target: 'player' | 'enemy',
    slots: number,
  ): ReturnType<typeof resizeOrbContainer> {
    const entity = target === 'player' ? this.gameState.player : this.currentEnemy();
    const result = resizeOrbContainer(entity?.orbs, slots);
    if (!entity) return result;
    if (target === 'player') {
      this.gameState.player.orbs = result.container;
      this.notifyListeners('orbs_changed');
    } else {
      this.updateEnemy({ orbs: result.container });
    }
    return result;
  }

  public channelCombatantOrb(
    target: 'player' | 'enemy',
    definition: Omit<OrbInstance, 'instanceId'>,
  ): ReturnType<typeof channelOrbInContainer> {
    const entity = target === 'player' ? this.gameState.player : this.currentEnemy();
    const current = normalizeOrbContainer(entity?.orbs);
    const instanceId = allocateRuntimeId(definition.id, new Set(current.orbs.map(orb => orb.instanceId)));
    const result = channelOrbInContainer(current, { ...cloneState(definition), instanceId });
    if (!entity || !result.accepted) return result;
    if (target === 'player') {
      this.gameState.player.orbs = result.container;
      this.notifyListeners('orbs_changed');
    } else {
      this.updateEnemy({ orbs: result.container });
    }
    return result;
  }

  public removeCombatantOrbs(
    target: 'player' | 'enemy',
    selector: EffectOrbSelector,
  ): ReturnType<typeof removeSelectedOrbs> {
    const entity = target === 'player' ? this.gameState.player : this.currentEnemy();
    const result = removeSelectedOrbs(entity?.orbs, selector);
    if (!entity) return result;
    if (target === 'player') {
      this.gameState.player.orbs = result.container;
      this.notifyListeners('orbs_changed');
    } else {
      this.updateEnemy({ orbs: result.container });
    }
    return result;
  }

  public modifyCombatantOrbValues(
    target: 'player' | 'enemy',
    selector: EffectOrbSelector,
    operator: CardValueOperator,
    value: number,
  ): ReturnType<typeof modifyValuesInOrbContainer> {
    const entity = target === 'player' ? this.gameState.player : this.currentEnemy();
    const result = modifyValuesInOrbContainer(entity?.orbs, selector, operator, value);
    if (!entity) return result;
    if (target === 'player') {
      this.gameState.player.orbs = result.container;
      this.notifyListeners('orbs_changed');
    } else {
      this.updateEnemy({ orbs: result.container });
    }
    return result;
  }

  public queueExtraTurns(actor: 'player' | 'enemy', amount: number): void {
    this.gameState.turnControl = addExtraTurns(this.gameState.turnControl, actor, amount);
    this.notifyListeners('turn_control_changed');
  }

  public consumeExtraTurn(actor: 'player' | 'enemy'): boolean {
    const result = consumeQueuedExtraTurn(this.gameState.turnControl, actor);
    this.gameState.turnControl = result.state;
    if (result.consumed) this.notifyListeners('turn_control_changed');
    return result.consumed;
  }

  public requestForceEndTurn(actor: 'player' | 'enemy'): void {
    this.gameState.turnControl = setForceEndTurn(this.gameState.turnControl, actor, true);
    this.notifyListeners('turn_control_changed');
  }

  public isForceEndTurnRequested(actor: 'player' | 'enemy'): boolean {
    const state = normalizeTurnControl(this.gameState.turnControl);
    return actor === 'player' ? state.forceEndPlayer : state.forceEndEnemy;
  }

  public consumeForceEndTurn(actor: 'player' | 'enemy'): boolean {
    const requested = this.isForceEndTurnRequested(actor);
    if (!requested) return false;
    this.gameState.turnControl = setForceEndTurn(this.gameState.turnControl, actor, false);
    this.notifyListeners('turn_control_changed');
    return true;
  }

  public setEnemy(enemy: Enemy): void {
    this.setEnemies([enemy], enemy.id);
  }

  public setEnemies(enemies: readonly Enemy[], activeEnemyId?: string | null): void {
    const ids = enemies.map(enemy => enemy.id);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('enemy ids must be non-empty and unique');
    const previous = new Map((this.gameState.enemies || []).map(enemy => [enemy.id, enemy.stageSlot]));
    const formation = arrangeEnemyFrontline(enemies.map(enemy => ({ ...enemy, stageSlot: enemy.stageSlot ?? previous.get(enemy.id) })), this.gameState.reserveEnemies || []);
    this.gameState.enemies = formation.frontline;
    this.gameState.reserveEnemies = formation.reserves;
    this.gameState.activeEnemyId = activeEnemyId ?? enemies.find(enemy => enemy.currentHp > 0)?.id ?? null;
    this.syncLegacyEnemyAlias();
    this.notifyListeners('enemy_set');
  }

  public removeDefeatedEnemies(enemyIds?: readonly string[]): Enemy[] {
    const selectedIds = enemyIds ? new Set(enemyIds) : null;
    const removed = (this.gameState.enemies || []).filter(enemy =>
      enemy.currentHp <= 0 && (!selectedIds || selectedIds.has(enemy.id)),
    );
    if (removed.length === 0) return [];
    const removedIds = new Set(removed.map(enemy => enemy.id));
    this.gameState.enemies = (this.gameState.enemies || []).filter(enemy => !removedIds.has(enemy.id));
    const previous = this.gameState.defeatedEnemies || [];
    const known = new Set(previous.map(enemy => enemy.id));
    this.gameState.defeatedEnemies = [...previous, ...removed.filter(enemy => !known.has(enemy.id))];
    this.syncLegacyEnemyAlias();
    this.notifyListeners('enemies_removed');
    return cloneState(removed);
  }

  public getReserveEnemies(): Enemy[] { return cloneState(this.gameState.reserveEnemies || []); }

  public admitReserveEnemies(): Enemy[] {
    const next = admitEnemyReserves(this.gameState.enemies || [], this.gameState.reserveEnemies || []);
    this.gameState.enemies = next.frontline;
    this.gameState.reserveEnemies = next.reserves;
    this.syncLegacyEnemyAlias();
    if (next.admitted.length) this.notifyListeners('enemies_admitted');
    return cloneState(next.admitted);
  }

  public setRewardEligibleEnemyIds(enemyIds: readonly string[]): void {
    this.gameState.rewardEligibleEnemyIds = [...new Set(enemyIds.filter(id => typeof id === 'string' && id))];
    this.notifyListeners('reward_eligible_enemies_updated');
  }

  /** Remove a living enemy without processing defeat hooks or adding a kill receipt. */
  public removeEscapingEnemy(enemyId: string): Enemy | null {
    const enemy = this.gameState.enemies?.find(entry => entry.id === enemyId && entry.currentHp > 0);
    if (!enemy) return null;
    this.gameState.enemies = (this.gameState.enemies || []).filter(entry => entry.id !== enemyId);
    const previous = this.gameState.escapedEnemies || [];
    this.gameState.escapedEnemies = previous.some(entry => entry.id === enemyId)
      ? previous
      : [...previous, cloneState(enemy)];
    this.syncLegacyEnemyAlias();
    this.notifyListeners('enemy_escaped');
    return cloneState(enemy);
  }

  public setPhase(phase: BattlePhase): void {
    this.gameState.phase = phase;
    this.notifyListeners('phase_changed');
  }

  public incrementTurn(): void {
    this.gameState.currentTurn = advanceTurnCounter(this.gameState).currentTurn;
    this.notifyListeners('turn_incremented');
  }

  public beginEnemyTurn(): void {
    const next = beginEnemyTurn(this.gameState);
    if (next === this.gameState) return;
    this.gameState.phase = next.phase;
    this.notifyListeners('phase_changed');
  }

  public beginPlayerTurn(): void {
    const next = beginPlayerTurn(this.gameState);
    if (next === this.gameState) return;
    this.gameState.phase = next.phase;
    this.gameState.cardsPlayedThisTurn = next.cardsPlayedThisTurn;
    this.gameState.attacksPlayedThisTurn = next.attacksPlayedThisTurn;
    this.gameState.skillsPlayedThisTurn = next.skillsPlayedThisTurn;
    this.gameState.cardRuleUsesThisTurn = 0;
    this.notifyListeners('phase_changed');
    this.notifyListeners('cards_played_reset');
  }

  public setCurrentTurn(turn: number): void {
    this.gameState.currentTurn = turn;
    this.notifyListeners('turn_set');
  }

  public setCardPlayCounters(counters: {
    cardsPlayedThisTurn: number;
    attacksPlayedThisTurn: number;
    skillsPlayedThisTurn: number;
    cardRuleUsesThisTurn?: number;
  }): void {
    this.gameState.cardsPlayedThisTurn = Math.max(0, Math.trunc(counters.cardsPlayedThisTurn));
    this.gameState.attacksPlayedThisTurn = Math.max(0, Math.trunc(counters.attacksPlayedThisTurn));
    this.gameState.skillsPlayedThisTurn = Math.max(0, Math.trunc(counters.skillsPlayedThisTurn));
    this.gameState.cardRuleUsesThisTurn = Math.max(
      0,
      Math.trunc(counters.cardRuleUsesThisTurn ?? counters.cardsPlayedThisTurn),
    );
    this.notifyListeners('card_played_count_changed');
  }

  public setBattleOutcome(result: BattleEndResult, narrativeText = ''): void {
    this.gameState = transitionToBattleEnd(this.gameState, result, narrativeText);
    this.notifyListeners('game_over');
  }

  public addStatusEffect(target: 'player' | 'enemy', effect: StatusEffect): void {
    const entity = target === 'player' ? this.gameState.player : this.currentEnemy();
    if (!entity) return;
    const existing = entity.statusEffects.find(entry => entry.id === effect.id);
    if (existing) {
      existing.stacks += effect.stacks;
      if (effect.duration !== undefined) existing.duration = Math.max(existing.duration || 0, effect.duration);
    } else {
      entity.statusEffects.push({ ...effect });
    }
    this.notifyListeners(`${target}_status_added`);
  }

  public removeStatusEffect(target: 'player' | 'enemy', effectId: string): void {
    const entity = target === 'player' ? this.gameState.player : this.currentEnemy();
    if (!entity) return;
    const index = entity.statusEffects.findIndex(effect => effect.id === effectId);
    if (index < 0) return;
    entity.statusEffects.splice(index, 1);
    this.notifyListeners(`${target}_status_removed`);
  }

  public updateStatusEffect(target: 'player' | 'enemy', effectId: string, updates: Partial<StatusEffect>): void {
    const entity = target === 'player' ? this.gameState.player : this.currentEnemy();
    const effect = entity?.statusEffects.find(entry => entry.id === effectId);
    if (!effect) return;
    Object.assign(effect, updates);
    this.notifyListeners(`${target}_status_updated`);
  }

  private getCardZones(): CardZoneState<Card> {
    return {
      hand: this.gameState.player.hand,
      drawPile: this.gameState.player.drawPile,
      discardPile: this.gameState.player.discardPile,
      exhaustPile: this.gameState.player.exhaustPile,
    };
  }

  private applyCardZones(zones: CardZoneState<Card>): void {
    Object.assign(this.gameState.player, zones);
  }

  public removeCardFromHand(cardId: string): Card | null {
    const result = removeCardFromZone(this.getCardZones(), 'hand', cardId);
    if (!result.card) return null;
    this.applyCardZones(result.zones);
    this.notifyListeners('hand_updated');
    return result.card;
  }

  public removeOwnedCardFromZone(cardId: string, zone: CardPileZone): Card | null {
    const result = removeCardFromZone(this.getCardZones(), zone, cardId);
    if (!result.card) return null;
    this.applyCardZones(result.zones);
    this.notifyListeners('card_removed_from_zone');
    return result.card;
  }

  public moveCardToDiscard(card: Card): void {
    this.applyCardZones(appendCardToZone(this.getCardZones(), 'discardPile', card));
    this.notifyListeners('discard_updated');
  }

  public moveCardToExhaust(card: Card): void {
    this.applyCardZones(appendCardToZone(this.getCardZones(), 'exhaustPile', card));
    this.notifyListeners('exhaust_updated');
  }

  public purgeOwnedCard(card: Card): void {
    // Temporary copies share lineage but must never delete their original.
    if (card.runInstanceId && !(card.origin === 'copied' && card.parentCombatInstanceId) && this.gameState.player.deck.some(c => c.runInstanceId === card.runInstanceId)) {
      this.gameState.purgedRunInstanceIds = [...new Set([...(this.gameState.purgedRunInstanceIds || []), card.runInstanceId])];
      this.gameState.player.deck = this.gameState.player.deck.filter(owned => owned.runInstanceId !== card.runInstanceId);
    }
    this.notifyListeners('card_purged');
  }

  public placeResolvedCard(card: Card, destination: PlayedCardDestination): PlayedCardDestination {
    if (destination === 'remove') {
      this.notifyListeners('card_removed_after_play');
      return destination;
    }
    if (destination === 'discard') {
      this.moveCardToDiscard(card);
      return destination;
    }
    if (destination === 'exhaust') {
      this.moveCardToExhaust(card);
      return destination;
    }
    if (destination === 'hand') {
      if (this.addCardToHand(card)) return destination;
      this.moveCardToDiscard(card);
      return 'discard';
    }
    const index = destination === 'draw_bottom' ? 0 : this.gameState.player.drawPile.length;
    this.applyCardZones(insertCardIntoZone(this.getCardZones(), 'drawPile', card, index));
    this.notifyListeners('card_returned_to_draw');
    return destination;
  }

  public moveOwnedCardsToExhaust(cardIds: readonly string[]): Card[] {
    const result = moveCardsBetweenZones(
      this.getCardZones(),
      cardIds,
      ['hand', 'drawPile', 'discardPile'],
      'exhaustPile',
    );
    this.applyCardZones(result.zones);
    if (result.moved.length > 0) this.notifyListeners('exhaust_updated');
    return result.moved;
  }

  public recoverOwnedCards(cardIds: readonly string[], source: 'draw' | 'discard' | 'exhaust'): Card[] {
    const sourceZone = source === 'draw' ? 'drawPile' : source === 'discard' ? 'discardPile' : 'exhaustPile';
    const result = moveCardsBetweenZones(this.getCardZones(), cardIds, [sourceZone], 'hand', 10);
    this.applyCardZones(result.zones);
    if (result.moved.length > 0) this.notifyListeners('card_recovered_to_hand');
    return result.moved;
  }

  public scryOwnedCards(amount: number, cardIds: readonly string[]): Card[] {
    const result = scryCardsFromDraw(this.getCardZones(), amount, cardIds);
    this.applyCardZones(result.zones);
    if (result.discarded.length > 0) this.notifyListeners('cards_scry_discarded');
    return result.discarded;
  }

  public updateOwnedCards(
    cardIds: readonly string[],
    update: (card: Card) => Card,
    sources: readonly CardPileZone[] = ['hand', 'drawPile', 'discardPile'],
  ): Card[] {
    const result = updateCardsInZones(this.getCardZones(), cardIds, sources, update);
    this.applyCardZones(result.zones);
    if (result.updated.length > 0) this.notifyListeners('cards_updated');
    return result.updated;
  }

  public clearOwnedCardPatches(reason: CardPatchCleanupReason): Card[] {
    const zones = this.getCardZones();
    const ids = [...zones.hand, ...zones.drawPile, ...zones.discardPile, ...zones.exhaustPile]
      .filter(card => (card.patches || []).some(patch => patch.removeOn === reason))
      .map(card => card.id);
    if (ids.length === 0) return [];
    return this.updateOwnedCards(ids, card => clearCardPatches(card, reason), [
      'hand',
      'drawPile',
      'discardPile',
      'exhaustPile',
    ]);
  }

  public advanceOwnedCardAttachments(event: CardAttachmentRemovalEvent, reason?: CardMoveReason): Card[] {
    const zones = this.getCardZones();
    const ids = [...zones.hand, ...zones.drawPile, ...zones.discardPile, ...zones.exhaustPile]
      .filter(card => (card.attachments || []).some(attachment => attachment.removeOn === event))
      .map(card => card.id);
    if (ids.length === 0) return [];
    return this.updateOwnedCards(ids, card => advanceCardAttachments(card, event, reason), [
      'hand',
      'drawPile',
      'discardPile',
      'exhaustPile',
    ]);
  }

  /** Finalize card-local lifetimes at the real combat/run boundary, including upgrade history. */
  public cleanupOwnedCardProgression(event: 'combat_end' | 'run_end'): Card[] {
    const zones = this.getCardZones();
    const cards = [...zones.hand, ...zones.drawPile, ...zones.discardPile, ...zones.exhaustPile];
    if (cards.length === 0) return [];
    return this.updateOwnedCards(
      cards.map(card => card.id),
      card => cleanupCardProgression(card, event),
      ['hand', 'drawPile', 'discardPile', 'exhaustPile'],
    );
  }

  public replaceCardZones(zones: CardZoneState<Card>, event: 'draw' | 'shuffle'): void {
    this.applyCardZones(zones);
    this.notifyListeners(event === 'shuffle' ? 'deck_shuffled' : 'cards_drawn');
  }

  public readCardZoneState(): CardZoneState<Card> {
    const zones = this.getCardZones();
    return {
      hand: [...zones.hand],
      drawPile: [...zones.drawPile],
      discardPile: [...zones.discardPile],
      exhaustPile: [...zones.exhaustPile],
    };
  }

  public commitCardZoneOperation(
    plan: CardZoneOperationPlan,
    selectedIds?: readonly string[],
  ): CommitCardZoneOperationResult<Card> {
    const result = commitCardZoneOperation(this.getCardZones(), plan, selectedIds);
    if (result.ok) {
      this.applyCardZones(result.zones);
      this.notifyListeners('card_zones_updated');
    }
    return result;
  }

  public commitAdvancedCardZoneTransaction(
    plan: AdvancedCardZonePlan,
    selectedIds?: readonly string[],
  ): AdvancedCardZoneCommit<Card> | { ok: false; code: AdvancedCardZoneFailureCode } {
    const result = commitAdvancedCardZoneTransaction(this.getCardZones(), plan, selectedIds);
    if (result.ok) {
      this.applyCardZones(result.zones);
      this.notifyListeners('advanced_card_zones_updated');
    }
    return result;
  }

  public createRuntimeCardId(sourceId: string): string {
    const player = this.gameState.player;
    const existingIds = new Set(
      [...player.deck, ...player.hand, ...player.drawPile, ...player.discardPile, ...player.exhaustPile].map(
        card => card.id,
      ),
    );
    return allocateRuntimeId(sourceId, existingIds);
  }

  public addCardToHand(card: Card): boolean {
    if (this.gameState.player.hand.length >= 10) return false;
    this.applyCardZones(appendCardToZone(this.getCardZones(), 'hand', card));
    this.notifyListeners('card_added_to_hand');
    return true;
  }

  public addCardToDeck(card: Card): void {
    const insertIndex = Math.floor(this.nextRandom() * (this.gameState.player.drawPile.length + 1));
    this.applyCardZones(insertCardIntoZone(this.getCardZones(), 'drawPile', card, insertIndex));
    this.notifyListeners('card_added_to_deck');
  }

  /** One authoritative placement rule for generated cards and hand overflow. */
  public placeGeneratedCard(card: Card, preferredZone: 'hand' | 'draw' | 'discard'): 'hand' | 'draw' | 'discard' {
    if (preferredZone === 'draw') {
      this.addCardToDeck(card);
      return 'draw';
    }
    if (preferredZone === 'discard') {
      this.moveCardToDiscard(card);
      return 'discard';
    }
    if (this.addCardToHand(card)) return 'hand';
    this.moveCardToDiscard(card);
    return 'discard';
  }

  public beginCardTransit(card: Card): void {
    // A resolving card is temporarily outside every pile but is still owned.
    // Persistent MVU decks reconcile exact run identities, not just templates.
    if (card.runInstanceId) {
      this.inFlightRunInstanceCounts.set(card.runInstanceId, (this.inFlightRunInstanceCounts.get(card.runInstanceId) || 0) + 1);
    }
    const key = getCardSourceId(card);
    if (!key) return;
    this.inFlightCardCounts.set(key, (this.inFlightCardCounts.get(key) || 0) + 1);
  }

  public endCardTransit(card: Card): void {
    if (card.runInstanceId) {
      const remaining = (this.inFlightRunInstanceCounts.get(card.runInstanceId) || 0) - 1;
      if (remaining > 0) this.inFlightRunInstanceCounts.set(card.runInstanceId, remaining);
      else this.inFlightRunInstanceCounts.delete(card.runInstanceId);
    }
    const key = getCardSourceId(card);
    if (!key) return;
    const remaining = (this.inFlightCardCounts.get(key) || 0) - 1;
    if (remaining > 0) this.inFlightCardCounts.set(key, remaining);
    else this.inFlightCardCounts.delete(key);
  }

  protected getInFlightCardCounts(): ReadonlyMap<string, number> {
    return this.inFlightCardCounts;
  }

  protected getInFlightRunInstanceIds(): IterableIterator<string> {
    return this.inFlightRunInstanceCounts.keys();
  }

  public addEventListener(event: string, listener: BattleStateChangeListener): () => void {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return () => {
      const current = this.listeners.get(event);
      if (!current) return;
      const index = current.indexOf(listener);
      if (index >= 0) current.splice(index, 1);
    };
  }

  public resetGame(): void {
    this.gameState = createEmptyBattleState();
    this.snapshots.clear();
    this.inFlightCardCounts.clear();
    this.inFlightRunInstanceCounts.clear();
    this.notifyListeners('game_reset');
  }

  public createSnapshot(name: string): boolean {
    const isNew = !this.snapshots.has(name);
    this.snapshots.set(name, cloneState(this.gameState));
    return isNew;
  }

  public restoreSnapshot(name: string): boolean {
    const snapshot = this.snapshots.get(name);
    if (!snapshot) return false;
    this.gameState = cloneState(snapshot);
    this.gameState.turnControl = normalizeTurnControl(this.gameState.turnControl);
    this.gameState.player.orbs = normalizeOrbContainer(this.gameState.player.orbs);
    this.normalizeEnemyCollection();
    this.notifyListeners('snapshot_restored');
    return true;
  }

  public deleteSnapshot(name: string): boolean {
    return this.snapshots.delete(name);
  }

  public clearTemporaryModifiers(): void {
    const temporary = new Set(['draw', 'discard', 'energy_gain', 'card_play_limit']);
    if (this.gameState.player.modifiers) {
      this.updatePlayer({
        modifiers: Object.fromEntries(
          Object.entries(this.gameState.player.modifiers).filter(([key]) => !temporary.has(key)),
        ),
      });
    }
    for (const enemy of this.getEnemies()) {
      if (!enemy.modifiers) continue;
      this.updateEnemyById(enemy.id, {
        modifiers: Object.fromEntries(Object.entries(enemy.modifiers).filter(([key]) => !temporary.has(key))),
      });
    }
  }
}




