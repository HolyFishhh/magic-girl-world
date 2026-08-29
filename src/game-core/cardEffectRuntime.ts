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
import { orderedCardsForSelector, selectorZones } from './cardSelectorRuntime';
import { createCardCopyIdentity, ensureCardIdentity } from './cardIdentity';
import {
  appendCardPatch,
  inheritedCardPatches,
  materializeCardPatches,
  TEMPORARY_COPY_PATCH_POLICY,
  cardPatchApplies,
  validateCardPatch,
  type CardPatch,
  type CardPatchLedger,
} from './cardPatch';
import { applyCardAttachment, inheritedCardAttachments } from './cardAttachment';
import type { CardMoveReason } from './battleEventJournal';
import type { EffectCommand } from './effectCommandRuntime';
import { applyCardUpgradeBundle, type CardUpgradeChange } from './cardProgression';
import {
  planAdvancedCardZoneTransaction,
  transformCardInstance,
  type AdvancedCardZonePlan,
  type AdvancedCardZoneRequest,
  type AdvancedCardZoneCommit,
} from './advancedCardZoneTransaction';

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
      | 'modify_card_value'
      | 'copy_cards'
      | 'double_card_effect'
      | 'auto_play_cards'
      | 'move_cards'
      | 'remove_cards'
      | 'transform_cards'
      | 'apply_card_patch'
      | 'apply_card_attachment'
      | 'upgrade_cards'
      | 'add_card'
      | 'ensure_card';
  }
>;

export type CardEffectChoicePurpose =
  | 'discard'
  | 'exhaust'
  | 'recover'
  | 'seek'
  | 'scry'
  | 'reduce_cost'
  | 'modify_value'
  | 'copy'
  | 'double_effect'
  | 'auto_play'
  | 'move'
  | 'remove'
  | 'transform'
  | 'patch'
  | 'attachment'
  | 'upgrade';

export interface CardEffectChoiceRequest {
  purpose: CardEffectChoicePurpose;
  minimum: number;
  maximum: number;
  allowCancel: boolean;
}

export type CardEffectRuntimeEvent =
  | { type: 'card_added'; zone: 'hand' | 'draw' | 'discard'; card: Card }
  | { type: 'card_cost_reduced'; card: Card; previousCost: number; nextCost: number }
  | {
      type: 'card_value_modified';
      card: Card;
      stat: Extract<CardEffectCommand, { type: 'modify_card_value' }>['stat'];
      operator: Extract<CardEffectCommand, { type: 'modify_card_value' }>['operator'];
      value: number;
    }
  | { type: 'card_recovered'; source: 'draw' | 'discard' | 'exhaust'; card: Card }
  | { type: 'card_scry_discarded'; card: Card }
  | { type: 'card_moved'; card: Card; destination: CardPileZone; position: 'top' | 'bottom' }
  | { type: 'card_removed'; card: Card }
  | { type: 'card_transformed'; previous: Card; card: Card }
  | { type: 'card_upgraded'; previous: Card; card: Card; levels: number; scope: 'combat' | 'run' | 'permanent' }
  | { type: 'card_attachment_applied'; card: Card; attachmentId: string; attachmentKind: 'enchantment' | 'affliction' };

export interface CardEffectRuntimeContext {
  currentCardId?: string;
  excludedCardIds?: readonly string[];
  doubleEffectFilter?: 'playable' | 'any';
  currentTurn?: number;
  source?: { kind: CardPatch['source']['kind']; id: string; name?: string };
}

export interface CardEffectStatePort {
  getPlayer(): Player;
  nextRandom(): number;
  readCardZoneState(): CardZoneState<Card>;
  readCardPatchLedger(): CardPatchLedger;
  writeCardPatchLedger(ledger: CardPatchLedger): void;
  commitCardZoneOperation(
    plan: CardZoneOperationPlan,
    selectedIds?: readonly string[],
  ): CommitCardZoneOperationResult<Card>;
  commitAdvancedCardZoneTransaction(
    plan: AdvancedCardZonePlan,
    selectedIds?: readonly string[],
  ): AdvancedCardZoneCommit<Card> | { ok: false; code: string };
  updateOwnedCards(
    cardIds: readonly string[],
    update: (card: Card) => Card,
    sources?: readonly CardPileZone[],
  ): Card[];
  createRuntimeCardId(sourceId: string): string;
  addCardToHand(card: Card): boolean;
  addCardToDeck(card: Card): void;
  placeGeneratedCard(card: Card, preferredZone: 'hand' | 'draw'): 'hand' | 'draw' | 'discard';
}

export interface CardEffectRuntimePorts {
  drawCards(count: number): Promise<void>;
  chooseCards(candidates: readonly Card[], request: CardEffectChoiceRequest): Promise<readonly string[] | null>;
  onCardDiscarded(card: Card, reason: CardMoveReason, source: CardPileZone): Promise<void>;
  onCardExhausted(card: Card, source: CardPileZone): Promise<void>;
  autoPlayCard(card: Card, source: CardPileZone, free: boolean): Promise<boolean>;
  present?(event: CardEffectRuntimeEvent): void;
}

const CARD_EFFECT_COMMAND_TYPES = new Set<CardEffectCommand['type']>([
  'draw_cards',
  'scry_cards',
  'discard_cards',
  'exhaust_cards',
  'recover_cards',
  'reduce_card_cost',
  'modify_card_value',
  'copy_cards',
  'double_card_effect',
  'auto_play_cards',
  'move_cards',
  'remove_cards',
  'transform_cards',
  'apply_card_patch',
  'apply_card_attachment',
  'upgrade_cards',
  'add_card',
  'ensure_card',
]);

export function isCardEffectCommand(command: unknown): command is CardEffectCommand {
  return Boolean(
    command && typeof command === 'object' && !Array.isArray(command) &&
    CARD_EFFECT_COMMAND_TYPES.has((command as CardEffectCommand).type),
  );
}

function normalizeCount(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function selectorMode(pick: CardSelector['pick']): CardSelectionMode {
  if (pick === 'left') return 'leftmost';
  if (pick === 'right') return 'rightmost';
  if (pick === 'top') return 'rightmost';
  if (pick === 'bottom') return 'leftmost';
  return pick;
}

function selectionPurpose(request: CardZoneOperationRequest): CardEffectChoicePurpose {
  if (request.type === 'scry_cards') return 'scry';
  if (request.type === 'discard_cards') return 'discard';
  if (request.type === 'exhaust_cards') return 'exhaust';
  return 'source' in request && request.source === 'draw' ? 'seek' : 'recover';
}

function discardReason(request: { selector: CardSelector }): CardMoveReason {
  if (request.selector.pick === 'choose') return 'player_choice';
  if (request.selector.pick === 'random') return 'random_effect';
  return 'effect';
}

function generatedCard(definition: GeneratedCardDefinition, runtimeId: string): Card {
  return ensureCardIdentity({
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
  }, { origin: 'generated', templateId: definition.id, combatInstanceId: runtimeId });
}

function nextPatchId(card: Card, context: CardEffectRuntimeContext, kind: CardPatch['kind']): string {
  const source = context.source || { kind: 'system' as const, id: context.currentCardId || 'effect' };
  const prefix = `${source.kind}:${source.id}:${Math.max(0, Math.floor(context.currentTurn || 0))}:${kind}:`;
  const used = new Set((card.patches || []).map(patch => patch.id));
  let sequence = 1;
  while (used.has(`${prefix}${sequence}`)) sequence += 1;
  return `${prefix}${sequence}`;
}

function patchBase(context: CardEffectRuntimeContext, card: Card, kind: CardPatch['kind']) {
  return {
    id: nextPatchId(card, context, kind),
    source: context.source || { kind: 'system' as const, id: context.currentCardId || 'effect' },
    createdTurn: Math.max(0, Math.floor(context.currentTurn || 0)),
    priority: 0,
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
    if (command.type === 'modify_card_value') return this.modifyCardValue(command, context);
    if (command.type === 'copy_cards') return this.copyCards(command.selector, context);
    if (command.type === 'double_card_effect') return this.markDoubleEffect(command.selector, context);
    if (command.type === 'auto_play_cards') return this.autoPlayCards(command.selector, command.free, context);
    if (command.type === 'move_cards') return this.moveCards(command, context);
    if (command.type === 'remove_cards') return this.removeCards(command, context);
    if (command.type === 'transform_cards') return this.transformCards(command, context);
    if (command.type === 'apply_card_patch') return this.applyStructuredPatch(command, context);
    if (command.type === 'apply_card_attachment') return this.applyStructuredAttachment(command, context);
    if (command.type === 'upgrade_cards') return this.upgradeCards(command, context);
    if (command.type === 'ensure_card') return this.ensureCardInstances(command);
    return this.addGeneratedCards(command.card, command.count, command.zone);
  }

  public async executeZoneOperation(
    request: CardZoneOperationRequest,
    context: CardEffectRuntimeContext = {},
  ): Promise<readonly Card[]> {
    const zones = this.state.readCardZoneState();
    const sourceById = new Map<string, CardPileZone>();
    for (const zone of ['hand', 'drawPile', 'discardPile', 'exhaustPile'] as const)
      zones[zone].forEach(card => sourceById.set(card.id, zone));
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
      const reason = discardReason(request);
      for (const card of committed.moved)
        await this.ports.onCardDiscarded(card, reason, sourceById.get(card.id) || 'hand');
    } else if (request.type === 'exhaust_cards') {
      for (const card of committed.moved)
        await this.ports.onCardExhausted(card, sourceById.get(card.id) || 'hand');
    } else if (request.type === 'recover_cards') {
      for (const card of committed.moved) this.ports.present?.({ type: 'card_recovered', source: request.source, card });
    } else {
      for (const card of committed.moved) this.ports.present?.({ type: 'card_scry_discarded', card });
    }
    return committed.moved;
  }

  private candidates(selector: CardSelector, context: CardEffectRuntimeContext): Card[] {
    const excluded = new Set([
      ...(context.excludedCardIds || []),
      ...(context.currentCardId ? [context.currentCardId] : []),
    ]);
    return orderedCardsForSelector(this.state.readCardZoneState(), selector, { excludeCardIds: excluded });
  }

  private async selectCards(
    selector: CardSelector,
    purpose: CardEffectChoicePurpose,
    context: CardEffectRuntimeContext,
    filter?: (card: Card) => boolean,
  ): Promise<Card[]> {
    const candidates = this.candidates(selector, context).filter(card => (filter ? filter(card) : true));
    const requested = selector.pick === 'all' ? candidates.length : normalizeCount(selector.count ?? 1);
    const plan = planCardSelection(
      {
        candidateIds: candidates.map(card => card.id),
        mode: selectorMode(selector.pick),
        minimum: requested,
        maximum: requested,
        allowCancel: true,
      },
      () => this.state.nextRandom(),
    );
    if (!plan.ok) {
      if (plan.code === 'INSUFFICIENT_CANDIDATES') return [];
      throw new Error(`card selection failed: ${plan.code}`);
    }
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
    const selectedIds = selector.pick === 'top' ? [...resolved.selectedIds].reverse() : resolved.selectedIds;
    return selectedIds.map(id => byId.get(id)).filter((card): card is Card => card !== undefined);
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
      card => appendCardPatch(card, {
        ...patchBase(context, card, 'cost'),
        kind: 'cost',
        scope: 'combat',
        removeOn: 'combat_end',
        operator: 'subtract',
        value: normalizeCount(reduction),
      }),
      selectorZones(selector.zone),
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
      const combatInstanceId = this.state.createRuntimeCardId(card.templateId || card.originalId || card.id);
      const copy = {
        ...card,
        ...createCardCopyIdentity(card, {
          temporaryCombatCopy: true,
          existingCombatIds: new Set([card.id]),
        }),
        id: combatInstanceId,
        combatInstanceId,
        origin: 'copied' as const,
        patches: inheritedCardPatches(card, TEMPORARY_COPY_PATCH_POLICY),
        attachments: inheritedCardAttachments(card, TEMPORARY_COPY_PATCH_POLICY),
      };
      if (!this.state.addCardToHand(materializeCardPatches(copy))) break;
    }
    return selected;
  }

  private async modifyCardValue(
    command: Extract<CardEffectCommand, { type: 'modify_card_value' }>,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    if (!Number.isFinite(command.value)) throw new Error('card value transform must be finite');
    if (command.operator === 'divide' && command.value === 0) {
      throw new Error('card value transform cannot divide by zero');
    }
    const selected = await this.selectCards(command.selector, 'modify_value', context);
    const updated = this.state.updateOwnedCards(
      selected.map(card => card.id),
      card => appendCardPatch(card, {
        ...patchBase(context, card, 'numeric'),
        kind: 'numeric',
        scope: 'combat',
        removeOn: 'combat_end',
          stat: command.stat,
          operator: command.operator,
          value: command.value,
      }),
      selectorZones(command.selector.zone),
    );
    for (const card of updated) {
      this.ports.present?.({
        type: 'card_value_modified',
        card,
        stat: command.stat,
        operator: command.operator,
        value: command.value,
      });
    }
    return updated;
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
      card => appendCardPatch(card, {
        ...patchBase(context, card, 'replay'),
        kind: 'replay',
        scope: 'until_played',
        removeOn: 'played',
        extra: 1,
      }),
      selectorZones(selector.zone),
    );
  }

  private async autoPlayCards(
    selector: CardSelector,
    free: boolean,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    const selected = await this.selectCards(selector, 'auto_play', context, card => card.type !== 'Curse');
    const played: Card[] = [];
    for (const card of selected) {
      const zones = this.state.readCardZoneState();
      const source = (['hand', 'drawPile', 'discardPile', 'exhaustPile'] as const)
        .find(zone => zones[zone].some(entry => entry.id === card.id));
      if (!source) continue;
      if (await this.ports.autoPlayCard(card, source, free)) played.push(card);
    }
    return played;
  }

  private async executeAdvancedZoneRequest(
    request: AdvancedCardZoneRequest,
    purpose: 'move' | 'remove',
    context: CardEffectRuntimeContext,
  ): Promise<AdvancedCardZoneCommit<Card>> {
    const zones = this.state.readCardZoneState();
    const planned = planAdvancedCardZoneTransaction(zones, request, () => this.state.nextRandom());
    if (!planned.ok) throw new Error(`advanced card zone plan failed: ${planned.code}`);
    let response: readonly string[] | undefined;
    if (planned.selection.kind === 'interactive') {
      const byId = new Map(Object.values(zones).flat().map(card => [card.id, card]));
      const candidates = planned.candidateIds.map(id => byId.get(id)).filter((card): card is Card => Boolean(card));
      const selected = await this.ports.chooseCards(candidates, {
        purpose,
        minimum: planned.selection.minimum,
        maximum: planned.selection.maximum,
        allowCancel: true,
      });
      if (selected === null) {
        return { ok: true, zones, selected: [], created: [], removed: [] };
      }
      response = selected;
    }
    const committed = this.state.commitAdvancedCardZoneTransaction(planned, response);
    if (!committed.ok) throw new Error(`advanced card zone commit failed: ${committed.code}`);
    return committed;
  }

  private async moveCards(
    command: Extract<CardEffectCommand, { type: 'move_cards' }>,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    const before = this.state.readCardZoneState();
    const sourceById = new Map<string, CardPileZone>();
    for (const zone of ['hand', 'drawPile', 'discardPile', 'exhaustPile'] as const)
      before[zone].forEach(card => sourceById.set(card.id, zone));
    const committed = await this.executeAdvancedZoneRequest({
      type: 'move', selector: command.selector, amount: command.amount,
      destination: command.destination, position: command.position,
    }, 'move', context);
    for (const card of committed.selected) {
      if (command.destination === 'discardPile' && sourceById.get(card.id) === 'hand')
        await this.ports.onCardDiscarded(card, 'effect', 'hand');
      if (command.destination === 'exhaustPile' && sourceById.get(card.id) !== 'exhaustPile')
        await this.ports.onCardExhausted(card, sourceById.get(card.id) || 'hand');
      this.ports.present?.({ type: 'card_moved', card, destination: command.destination, position: command.position });
    }
    return committed.selected;
  }

  private async removeCards(
    command: Extract<CardEffectCommand, { type: 'remove_cards' }>,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    const committed = await this.executeAdvancedZoneRequest({
      type: 'remove', selector: command.selector, amount: command.amount,
    }, 'remove', context);
    for (const card of committed.removed) this.ports.present?.({ type: 'card_removed', card });
    return committed.removed;
  }

  private async transformCards(
    command: Extract<CardEffectCommand, { type: 'transform_cards' }>,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    const selected = await this.selectCards(command.selector, 'transform', context);
    const previous = new Map(selected.map(card => [card.id, card]));
    const zones = selectorZones(command.selector.zone);
    const updated = this.state.updateOwnedCards(selected.map(card => card.id), card => {
      const generated = generatedCard(command.replacement, card.id);
      const {
        id: _id,
        runInstanceId: _runInstanceId,
        combatInstanceId: _combatInstanceId,
        patches: _patches,
        patchBase: _patchBase,
        attachments: _attachments,
        ...replacement
      } = generated;
      return transformCardInstance(card, replacement);
    }, zones);
    for (const card of updated) {
      const prior = previous.get(card.id);
      if (prior) this.ports.present?.({ type: 'card_transformed', previous: prior, card });
    }
    return updated;
  }

  private async upgradeCards(
    command: Extract<CardEffectCommand, { type: 'upgrade_cards' }>,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    const selected = await this.selectCards(command.selector, 'upgrade', context);
    if (selected.length === 0) return [];
    const previous = new Map(selected.map(card => [card.id, card]));
    const changes = command.changes.map(change => {
      if (change.kind === 'numeric' || change.kind === 'cost' || change.kind === 'x_value') {
        if (typeof change.value !== 'number') throw new Error('resolved card upgrade change requires a number');
      }
      if (change.kind === 'replay' && typeof change.extra !== 'number')
        throw new Error('resolved card replay upgrade requires a number');
      return structuredClone(change) as CardUpgradeChange;
    });
    const source = context.source || { kind: 'system' as const, id: context.currentCardId || 'upgrade' };
    const updated = this.state.updateOwnedCards(
      selected.map(card => card.id),
      card => applyCardUpgradeBundle(card, {
        source,
        scope: command.scope,
        createdTurn: Math.max(0, Math.floor(context.currentTurn || 0)),
        levels: command.levels,
        ...(command.maxLevel !== undefined ? { maxLevel: command.maxLevel } : {}),
        changes,
      }),
      selectorZones(command.selector.zone),
    );
    for (const card of updated) {
      const prior = previous.get(card.id);
      if (prior) this.ports.present?.({
        type: 'card_upgraded', previous: prior, card, levels: command.levels, scope: command.scope,
      });
    }
    return updated;
  }

  private async applyStructuredPatch(
    command: Extract<CardEffectCommand, { type: 'apply_card_patch' }>,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    const selected = await this.selectCards(command.selector, 'patch', context);
    if (selected.length === 0) return [];
    const source = context.source || { kind: 'system' as const, id: context.currentCardId || 'effect' };
    const turn = Math.max(0, Math.floor(context.currentTurn || 0));
    const removalByScope = {
      resolution: 'resolution_end',
      turn: 'turn_end',
      until_played: 'played',
      combat: 'combat_end',
      run: 'run_end',
      permanent: 'manual',
    } as const;
    const allZones: CardPileZone[] = ['hand', 'drawPile', 'discardPile', 'exhaustPile'];
    const allCards = allZones.flatMap(zone => this.state.readCardZoneState()[zone]);
    const patches: CardPatch[] = [];
    const keys = new Set<string>();

    for (const anchor of selected) {
      const match = command.patch.match || 'instance';
      const target = match === 'instance'
        ? { match: 'instance' as const, combatInstanceId: anchor.combatInstanceId || anchor.id }
        : match === 'run_instance'
          ? { match: 'run_instance' as const, runInstanceId: anchor.runInstanceId || anchor.id }
          : match === 'template'
            ? {
                match: 'template' as const,
                templateId: anchor.templateId || anchor.originalId || anchor.id,
                includeFutureCopies: command.patch.includeFutureCopies === true,
              }
            : {
                match: 'filter' as const,
                filter: command.selector.filter || {},
                includeFutureCopies: command.patch.includeFutureCopies === true,
              };
      const targetKey = JSON.stringify(target);
      if (keys.has(targetKey)) continue;
      keys.add(targetKey);
      const ledger = this.state.readCardPatchLedger();
      const sequence = Math.max(1, Math.floor(ledger.nextSequence || 1)) + patches.length;
      const common = {
        id: `${source.kind}:${source.id}:${turn}:patch:${sequence}`,
        source,
        scope: command.patch.scope,
        createdTurn: turn,
        priority: 0,
        removeOn: removalByScope[command.patch.scope],
        target,
      };
      let patch: CardPatch;
      if (command.patch.kind === 'numeric') {
        if (typeof command.patch.value !== 'number') throw new Error('resolved numeric card patch requires a number');
        patch = { ...common, kind: 'numeric', stat: command.patch.stat, operator: command.patch.operator, value: command.patch.value };
      } else if (command.patch.kind === 'cost') {
        if (typeof command.patch.value !== 'number') throw new Error('resolved cost card patch requires a number');
        patch = { ...common, kind: 'cost', operator: command.patch.operator, value: command.patch.value };
      } else if (command.patch.kind === 'keyword') {
        patch = { ...common, kind: 'keyword', keyword: command.patch.keyword, enabled: command.patch.enabled };
      } else if (command.patch.kind === 'replay') {
        if (typeof command.patch.extra !== 'number') throw new Error('resolved replay card patch requires a number');
        patch = { ...common, kind: 'replay', extra: command.patch.extra };
      } else if (command.patch.kind === 'x_value') {
        if (typeof command.patch.value !== 'number') throw new Error('resolved X value card patch requires a number');
        patch = { ...common, kind: 'x_value', operator: command.patch.operator, value: command.patch.value };
      } else {
        patch = {
          ...common,
          kind: 'dynamic_cost',
          timing: command.patch.timing,
          operator: command.patch.operator,
          value: structuredClone(command.patch.value),
          ...(command.patch.minimum !== undefined ? { minimum: command.patch.minimum } : {}),
          ...(command.patch.maximum !== undefined ? { maximum: command.patch.maximum } : {}),
        };
      }
      validateCardPatch(patch);
      patches.push(patch);
    }

    for (const patch of patches) {
      const ids = allCards.filter(card => cardPatchApplies(card, patch)).map(card => card.id);
      this.state.updateOwnedCards(ids, card => appendCardPatch(card, patch), allZones);
      if (
        (patch.target?.match === 'template' || patch.target?.match === 'filter') &&
        patch.target.includeFutureCopies
      ) {
        const ledger = this.state.readCardPatchLedger();
        this.state.writeCardPatchLedger({
          patches: [...ledger.patches, patch],
          nextSequence: Math.max(ledger.nextSequence, ledger.patches.length + 2),
        });
      }
    }
    const updatedById = new Map(allZones.flatMap(zone => this.state.readCardZoneState()[zone]).map(card => [card.id, card]));
    return selected.map(card => updatedById.get(card.id)).filter((card): card is Card => Boolean(card));
  }

  private async applyStructuredAttachment(
    command: Extract<CardEffectCommand, { type: 'apply_card_attachment' }>,
    context: CardEffectRuntimeContext,
  ): Promise<Card[]> {
    const selected = await this.selectCards(command.selector, 'attachment', context);
    if (selected.length === 0) return [];
    const source = context.source || { kind: 'system' as const, id: context.currentCardId || 'effect' };
    const turn = Math.max(0, Math.floor(context.currentTurn || 0));
    const updated = this.state.updateOwnedCards(
      selected.map(card => card.id),
      card => applyCardAttachment(card, {
        ...structuredClone(command.attachment),
        source: structuredClone(source),
        appliedTurn: turn,
      }),
      selectorZones(command.selector.zone),
    );
    for (const card of updated) this.ports.present?.({
      type: 'card_attachment_applied',
      card,
      attachmentId: command.attachment.id,
      attachmentKind: command.attachment.kind,
    });
    return updated;
  }

  private addGeneratedCards(
    definition: GeneratedCardDefinition,
    requestedCount: number,
    zone: 'hand' | 'draw',
    options: { inheritFuturePatches?: boolean } = {},
  ): Card[] {
    const cards: Card[] = [];
    for (let index = 0; index < normalizeCount(requestedCount); index += 1) {
      let card = generatedCard(definition, this.state.createRuntimeCardId(definition.id));
      if (options.inheritFuturePatches !== false) {
        const futurePatches = this.state.readCardPatchLedger().patches.filter(patch => cardPatchApplies(card, patch));
        for (const patch of futurePatches) card = appendCardPatch(card, patch);
      }
      const placedZone = this.state.placeGeneratedCard(card, zone);
      cards.push(card);
      this.ports.present?.({ type: 'card_added', zone: placedZone, card });
    }
    return cards;
  }

  /**
   * Guarantee concrete combat roots without mutating a persistent template or
   * counting temporary copies. This is intentionally a current-battle
   * operation: later instance patches affect only the cards now present.
   */
  private ensureCardInstances(
    command: Extract<CardEffectCommand, { type: 'ensure_card' }>,
  ): Card[] {
    const allZones: CardPileZone[] = ['hand', 'drawPile', 'discardPile', 'exhaustPile'];
    const matches = (): Card[] => allZones
      .flatMap(zone => this.state.readCardZoneState()[zone])
      .filter(card => {
        if ((card.templateId || card.originalId || card.id) !== command.card.id) return false;
        return command.includeCopies || card.origin !== 'copied';
      });
    const existing = matches();
    const missing = Math.max(0, normalizeCount(command.minimum) - existing.length);
    if (missing > 0) {
      this.addGeneratedCards(command.card, missing, command.zone, { inheritFuturePatches: false });
    }
    return matches();
  }
}
