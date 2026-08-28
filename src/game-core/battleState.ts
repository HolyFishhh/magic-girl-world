import type { BattleRequest } from './battleContract';
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
import { createBattleRandomState, drawBattleRandom, type BattleRandomState } from './deterministicRandom';
import type { EffectProgram } from './effectDsl';
import { allocateRuntimeId } from './runtimeIds';
import { transitionToBattleEnd, type BattleEndResult } from './battleTerminal';
import { advanceTurnCounter, beginEnemyTurn, beginPlayerTurn, type CoreBattlePhase } from './turnState';

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
  /** Player-facing origin, for example the card, relic or status that granted it. */
  source?: string;
  trigger: string;
  effectProgram: EffectProgram;
}

export interface BattleHistoryEntry {
  turn: number;
  type: 'info' | 'damage' | 'heal' | 'action' | 'system';
  message: string;
  source?: { type: 'card' | 'relic' | 'ability' | 'status'; name: string; details?: string };
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
  /** Compact structured history survives iframe reloads and is summarized at settlement. */
  battleHistory?: BattleHistoryEntry[];
}

export type BattleStateChangeListener = (state: GameState) => void;

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    enemy: null,
    currentTurn: 0,
    cardsPlayedThisTurn: 0,
    attacksPlayedThisTurn: 0,
    skillsPlayedThisTurn: 0,
    phase: 'setup',
    isGameOver: false,
    battleResult: 'ongoing',
    battleNarrative: '',
    battleHistory: [],
  };
}

/** Host-independent mutable battle state with deterministic random and rollback support. */
export class BattleStateStore {
  protected gameState: GameState;

  private readonly listeners = new Map<string, BattleStateChangeListener[]>();
  private readonly snapshots = new Map<string, GameState>();
  private readonly inFlightCardCounts = new Map<string, number>();

  public constructor(initialState: GameState = createEmptyBattleState()) {
    this.gameState = cloneState(initialState);
  }

  protected stateDidChange(_event: string, _state: GameState): void {}

  protected notifyListeners(event: string): void {
    for (const listener of this.listeners.get(event) || []) listener(this.gameState);
    for (const listener of this.listeners.get('state_changed') || []) listener(this.gameState);
    this.stateDidChange(event, this.gameState);
  }

  public replaceState(state: GameState, event = 'state_replaced'): void {
    this.gameState = cloneState(state);
    this.notifyListeners(event);
  }

  public getGameState(): GameState {
    return { ...this.gameState };
  }

  public getPlayer(): Player {
    return { ...this.gameState.player };
  }

  public getEnemy(): Enemy | null {
    return this.gameState.enemy ? { ...this.gameState.enemy } : null;
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

  public updatePlayer(updates: Partial<Player>, _options?: { skipAttributeTriggers?: boolean }): void {
    this.gameState.player = { ...this.gameState.player, ...updates };
    this.notifyListeners('player_updated');
  }

  public updateEnemy(updates: Partial<Enemy>, _options?: { skipAttributeTriggers?: boolean }): void {
    if (!this.gameState.enemy) return;
    this.gameState.enemy = { ...this.gameState.enemy, ...updates };
    this.notifyListeners('enemy_updated');
  }

  public setEnemy(enemy: Enemy): void {
    this.gameState.enemy = enemy;
    this.notifyListeners('enemy_set');
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
  }): void {
    this.gameState.cardsPlayedThisTurn = Math.max(0, Math.trunc(counters.cardsPlayedThisTurn));
    this.gameState.attacksPlayedThisTurn = Math.max(0, Math.trunc(counters.attacksPlayedThisTurn));
    this.gameState.skillsPlayedThisTurn = Math.max(0, Math.trunc(counters.skillsPlayedThisTurn));
    this.notifyListeners('card_played_count_changed');
  }

  public setBattleOutcome(result: BattleEndResult, narrativeText = ''): void {
    this.gameState = transitionToBattleEnd(this.gameState, result, narrativeText);
    this.notifyListeners('game_over');
  }

  public addStatusEffect(target: 'player' | 'enemy', effect: StatusEffect): void {
    const entity = target === 'player' ? this.gameState.player : this.gameState.enemy;
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
    const entity = target === 'player' ? this.gameState.player : this.gameState.enemy;
    if (!entity) return;
    const index = entity.statusEffects.findIndex(effect => effect.id === effectId);
    if (index < 0) return;
    entity.statusEffects.splice(index, 1);
    this.notifyListeners(`${target}_status_removed`);
  }

  public updateStatusEffect(target: 'player' | 'enemy', effectId: string, updates: Partial<StatusEffect>): void {
    const entity = target === 'player' ? this.gameState.player : this.gameState.enemy;
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

  public moveCardToDiscard(card: Card): void {
    this.applyCardZones(appendCardToZone(this.getCardZones(), 'discardPile', card));
    this.notifyListeners('discard_updated');
  }

  public moveCardToExhaust(card: Card): void {
    this.applyCardZones(appendCardToZone(this.getCardZones(), 'exhaustPile', card));
    this.notifyListeners('exhaust_updated');
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

  public beginCardTransit(card: Card): void {
    const key = getCardSourceId(card);
    if (!key) return;
    this.inFlightCardCounts.set(key, (this.inFlightCardCounts.get(key) || 0) + 1);
  }

  public endCardTransit(card: Card): void {
    const key = getCardSourceId(card);
    if (!key) return;
    const remaining = (this.inFlightCardCounts.get(key) || 0) - 1;
    if (remaining > 0) this.inFlightCardCounts.set(key, remaining);
    else this.inFlightCardCounts.delete(key);
  }

  protected getInFlightCardCounts(): ReadonlyMap<string, number> {
    return this.inFlightCardCounts;
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
    if (this.gameState.enemy?.modifiers) {
      this.updateEnemy({
        modifiers: Object.fromEntries(
          Object.entries(this.gameState.enemy.modifiers).filter(([key]) => !temporary.has(key)),
        ),
      });
    }
  }
}
