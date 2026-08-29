import {
  planCardSelection,
  resolveCardSelection,
  type CardSelectionFailureCode,
  type CardSelectionMode,
} from '../../game-core';
import type { Card } from '../../game-core';
import type { CombatResourceState } from '../../game-core';
import { TavernCardInteractionPresenter } from '../ui/cardInteractionPresenter';

export interface TavernCardSelectionRequest {
  mode: CardSelectionMode;
  minimum: number;
  maximum: number;
  title: string;
  allowCancel?: boolean;
  random?: () => number;
  resources?: Readonly<Record<string, Pick<CombatResourceState, 'name' | 'emoji'>>>;
}

export type TavernCardSelectionResult =
  | { status: 'selected'; cards: Card[]; selectedIds: string[] }
  | { status: 'cancelled' }
  | { status: 'invalid'; code: CardSelectionFailureCode };

/** Maps Tavern card objects to the portable ID selection protocol and the single modal presenter. */
export class TavernCardSelectionHost {
  private static instance: TavernCardSelectionHost;
  private readonly presentation = TavernCardInteractionPresenter.getInstance();

  public static getInstance(): TavernCardSelectionHost {
    if (!TavernCardSelectionHost.instance) TavernCardSelectionHost.instance = new TavernCardSelectionHost();
    return TavernCardSelectionHost.instance;
  }

  public async select(
    candidates: readonly Card[],
    request: TavernCardSelectionRequest,
  ): Promise<TavernCardSelectionResult> {
    const plan = planCardSelection(
      {
        candidateIds: candidates.map(card => card.id),
        mode: request.mode,
        minimum: request.minimum,
        maximum: request.maximum,
        allowCancel: request.allowCancel !== false,
      },
      request.random,
    );
    if (!plan.ok) return { status: 'invalid', code: plan.code };

    const response =
      plan.kind === 'interactive'
        ? await this.presentation.selectCards(candidates, {
            title: request.title,
            minimum: plan.minimum,
            maximum: plan.maximum,
            allowCancel: plan.allowCancel,
            resources: request.resources,
          })
        : undefined;
    const resolved = resolveCardSelection(plan, response);
    if (resolved.status !== 'selected') return resolved;

    const cardsById = new Map(candidates.map(card => [card.id, card]));
    const cards = resolved.selectedIds.map(id => cardsById.get(id)).filter((card): card is Card => card !== undefined);
    if (cards.length !== resolved.selectedIds.length) return { status: 'invalid', code: 'INVALID_RESPONSE' };
    return { status: 'selected', cards, selectedIds: resolved.selectedIds };
  }
}
