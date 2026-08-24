import { planCardSelection, resolveCardSelection, type CardSelectionMode } from './cardSelection';
import {
  planCardZoneOperation,
  type CardZoneOperationPlan,
  type CardZoneOperationRequest,
  type CommitCardZoneOperationResult,
} from './cardZoneOperation';
import type { CardPileZone, CardZoneState } from './cardZoneReducer';
import type { Card, Player } from './battleState';
import type { CardSelector, GeneratedCardDefinition } from './effectDsl';
import type { EffectCommand } from './effectCommandRuntime';

export type CardEffectCommand = Extract<
  EffectCommand,
  {
    type:
      | 'draw_cards'
      | 'scry_cards'
      | 'discard_cards'
      | 'exhaust_cards'
      | 'recover_cards'
      | 'reduce_card_cost'
      | 'copy_cards'
      | 'double_card_effect'
      | 'add_card';
  }
>;

export type CardEffectChoicePurpose =
  | 'discard'
  | 'exhaust'
  | 'recover'
  | 'seek'
  | 'scry'
  | 'reduce_cost'
  | 'copy'
  | 'double_effect';

export interface CardEffectChoiceRequest {
  purpose: CardEffectChoicePurpose;
  minimum: number;
  maximum: number;
  allowCancel: boolean;
}

export type CardEffectRuntimeEvent =
  | { type: 'card_added'; zone: 'hand' | 'draw'; card: Card }
  | { type: 'card_cost_reduced'; card: Card; previousCost: number; nextCost: number }
  | { type: 'card_recovered'; source: 'draw' | 'discard' | 'exhaust'; card: Card }
  | { type: 'card_scry_discarded'; card: Card };

export interface CardEffectRuntimeContext {
  currentCardId?: string;
  excludedCardIds?: readonly string[];
  doubleEffectFilter?: 'playable' | 'any';
}

export interface CardEffectStatePort {
  getPlayer(): Player;
  nextRandom(): number;
  readCardZoneState(): CardZoneState<Card>;
  commitCardZoneOperation(
    plan: CardZoneOperationPlan,
    selectedIds?: readonly string[],
  ): CommitCardZoneOperationResult<Card>;
  updateOwnedCards(
    cardIds: readonly string[],
    update: (card: Card) => Card,
    sources?: readonly CardPileZone[],
  ): Card[];
  createRuntimeCardId(sourceId: string): string;
  addCardToHand(card: Card): boolean;
  addCardToDeck(card: Card): void;
}

export interface CardEffectRuntimePorts {
  drawCards(count: number): Promise<void>;
  chooseCards(candidates: readonly Card[], request: CardEffectChoiceRequest): Promise<readonly string[] | null>;
  onCardDiscarded(card: Card): Promise<void>;
  onCardExhausted(card: Card): Promise<void>;
  present?(event: CardEffectRuntimeEvent): void;
}

const CARD_EFFECT_COMMAND_TYPES = new Set<CardEffectCommand['type']>([
  'draw_cards',
  'scry_cards',
  'discard_cards',
  'exhaust_cards',
  'recover_cards',
  'reduce_card_cost',
  'copy_cards',
  'double_card_effect',
  'add_card',
]);

export function isCardEffectCommand(command: EffectCommand): command is CardEffectCommand {
  return CARD_EFFECT_COMMAND_TYPES.has(command.type as CardEffectCommand['type']);
}

function normalizeCount(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function selectorMode(pick: CardSelector['pick']): CardSelectionMode {
  if (pick === 'left') return 'leftmost';
  if (pick === 'right') return 'rightmost';
  return pick;
}

function selectionPurpose(request: CardZoneOperationRequest): CardEffectChoicePurpose {
  if (request.type === 'scry_cards') return 'scry';
  if (request.type === 'discard_cards') return 'discard';
  if (request.type === 'exhaust_cards') return 'exhaust';
  return 'source' in request && request.source === 'draw' ? 'seek' : 'recover';
}

function selectorSources(selector: CardSelector): CardPileZone[] {
  if (selector.zone === 'hand') return ['hand'];
  if (selector.zone === 'draw') return ['drawPile'];
  if (selector.zone === 'discard') return ['discardPile'];
  return ['hand', 'drawPile', 'discardPile'];
}

function generatedCard(definition: GeneratedCardDefinition, runtimeId: string): Card {
  return {
    id: runtimeId,
    originalId: definition.id,
    name: definition.name,
    emoji: definition.emoji,
    type: definition.type,
    rarity: definition.rarity,
    cost: definition.cost ?? 1,
    effectProgram: definition.program,
    description: definition.description,
    ...(definition.discardProgram ? { discardEffectProgram: definition.discardProgram } : {}),
    retain: definition.retain === true,
    exhaust: definition.type === 'Power' || definition.exhaust === true,
    ethereal: definition.ethereal === true,
  };
}

/** Host-independent execution of every modern card-side-effect command. */
export class CardEffectRuntime {
  public constructor(
    private readonly state: CardEffectStatePort,
    private readonly ports: CardEffectRuntimePorts,
  ) {}

  public async execute(
    command: CardEffectCommand,
    context: CardEffectRuntimeContext = {},
  ): Promise<readonly Card[]> {
    if (command.type === 'draw_cards') {
      await this.ports.drawCards(normalizeCount(command.amount));
      return [];
    }
    if (
      command.type === 'scry_cards' ||
      command.type === 'discard_cards' ||
      command.type === 'exhaust_cards' ||
      command.type === 'recover_cards'
    ) {
      return this.executeZoneOperation(command, context);
    }
    if (command.type === 'reduce_card_cost') return this.reduceCardCost(command.selector, command.amount, context);
    if (command.type === 'copy_cards') return this.copyCards(command.selector, context);
    if (command.type === 'double_card_effect') return this.markDoubleEffect(command.selector, context);
    return this.addGeneratedCards(command.card, command.count, command.zone);
  }

  public async executeZoneOperation(
    request: CardZoneOperationRequest,
    context: CardEffectRuntimeContext = {},
  ): Promise<readonly Card[]> {
    const zones = this.state.readCardZoneState();
    const excludedCardIds = new Set([
      ...(context.excludedCardIds || []),
      ...(context.currentCardId ? [context.currentCardId] : []),
    ]);
    const planned = planCardZoneOperation(zones, request, {
      handLimit: 10,
      random: () => this.state.nextRandom(),
      excludeCardIds: excludedCardIds,
    });
    if (!planned.ok) throw new Error(`card zone plan failed: ${planned.code}`);

    let selectedCardIds: readonly string[] | undefined;
    if (planned.selection.kind === 'interactive') {
      const cardsById = new Map(
        [zones.hand, zones.drawPile, zones.discardPile, zones.exhaustPile].flat().map(card => [card.id, card]),
      );
      const candidates = planned.candidateCardIds
        .map(id => cardsById.get(id))
        .filter((card): card is Card => card !== undefined);
      const selected = await this.ports.chooseCards(candidates, {
        purpose: selectionPurpose(request),
        minimum: planned.selection.minimum,
        maximum: planned.selection.maximum,
        allowCancel: true,
      });
      if (selected === null) return [];
      selectedCardIds = selected;
    }

    const committed = this.state.commitCardZoneOperation(planned, selectedCardIds);
    if (!committed.ok) throw new Error(`card zone commit failed: ${committed.code}`);

    if (request.type === 'discard_cards') {
      for (const card of committed.moved) await this.ports.onCardDiscarded(card);
    } else if (request.type === 'exhaust_cards') {
      for (const card of committed.moved) await this.ports.onCardExhausted(card);
    } else if (request.type === 'recover_cards') {
      for (const card of committed.moved) this.ports.present?.({ type: 'card_recovered', source: request.source, card });
    } else {
      for (const card of committed.moved) this.ports.present?.({ type: 'card_scry_discarded', card });
    }
    return committed.moved;
  }

  private candidates(selector: CardSelector, context: CardEffectRuntimeContext): Card[] {
    const player = this.state.getPlayer();
    const excluded = new Set([
      ...(context.excludedCardIds || []),
      ...(context.currentCardId ? [context.currentCardId] : []),
    ]);
    const cards = selectorSources(selector).flatMap(zone => {
      if (zone === 'hand') return player.hand;
      if (zone === 'drawPile') return player.drawPile;
      return player.discardPile;
    });
    return cards.filter(card => !excluded.has(card.id));
  }

  private async selectCards(
    selector: CardSelector,
    purpose: CardEffectChoicePurpose,
    context: CardEffectRuntimeContext,
    filter?: (card: Card) => boolean,
  ): Promise<Card[]> {
    const candidates = this.candidates(selector, context).filter(card => (filter ? filter(card) : true));
    const requested = selector.pick === 'all' ? candidates.length : normalizeCount(selector.count ?? 1);
    const maximum = Math.min(candidates.length, requested);
    const plan = planCardSelection(
      {
        candidateIds: candidates.map(card => card.id),
        mode: selectorMode(selector.pick),
        minimum: maximum,
        maximum,
        allowCancel: true,
      },
      () => this.state.nextRandom(),
    );
    if (!plan.ok) throw new Error(`card selection failed: ${plan.code}`);
    const response =
      plan.kind === 'interactive'
        ? await this.ports.chooseCards(candidates, {
            purpose,
            minimum: plan.minimum,
            maximum: plan.maximum,
            allowCancel: plan.allowCancel,
          })
        : undefined;
    const resolved = resolveCardSelection(plan, response);
    if (resolved.status === 'cancelled') return [];
    if (resolved.status === 'invalid') throw new Error(`card selection failed: ${resolved.code}`);
    const byId = new Map(candidates.map(card => [card.id, card]));
    return resolved.selectedIds.map(id => byId.get(id)).filter((card): card is Card => card !== undefined);
  }

  private async reduceCardCost(
    selector: CardSelector,
    reduction: number,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    const selected = await this.selectCards(selector, 'reduce_cost', context, card => {
      return card.type !== 'Curse' && card.cost !== 'energy' && Number(card.cost) > 0;
    });
    const previousCosts = new Map(selected.map(card => [card.id, Number(card.cost) || 0]));
    const updated = this.state.updateOwnedCards(
      selected.map(card => card.id),
      card => ({ ...card, cost: Math.max(0, (Number(card.cost) || 0) - normalizeCount(reduction)) }),
      selectorSources(selector),
    );
    for (const card of updated) {
      this.ports.present?.({
        type: 'card_cost_reduced',
        card,
        previousCost: previousCosts.get(card.id) || 0,
        nextCost: Number(card.cost) || 0,
      });
    }
    return updated;
  }

  private async copyCards(selector: CardSelector, context: CardEffectRuntimeContext): Promise<Card[]> {
    const selected = await this.selectCards(selector, 'copy', context);
    for (const card of selected) {
      const copy = { ...card, id: this.state.createRuntimeCardId(card.originalId || card.id) };
      if (!this.state.addCardToHand(copy)) break;
    }
    return selected;
  }

  private async markDoubleEffect(selector: CardSelector, context: CardEffectRuntimeContext): Promise<Card[]> {
    const selected = await this.selectCards(
      selector,
      'double_effect',
      context,
      context.doubleEffectFilter === 'any' ? undefined : card => card.type !== 'Curse' && card.type !== 'Event',
    );
    return this.state.updateOwnedCards(
      selected.map(card => card.id),
      card => ({ ...card, doubleEffect: true }),
      selectorSources(selector),
    );
  }

  private addGeneratedCards(
    definition: GeneratedCardDefinition,
    requestedCount: number,
    zone: 'hand' | 'draw',
  ): Card[] {
    const cards: Card[] = [];
    for (let index = 0; index < normalizeCount(requestedCount); index += 1) {
      const card = generatedCard(definition, this.state.createRuntimeCardId(definition.id));
      if (zone === 'hand' && !this.state.addCardToHand(card)) break;
      if (zone === 'draw') this.state.addCardToDeck(card);
      cards.push(card);
      this.ports.present?.({ type: 'card_added', zone, card });
    }
    return cards;
  }
}
