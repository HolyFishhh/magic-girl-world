import {
  commitCardPlay,
  prepareCardPlay,
  type CardPlayCard,
  type CardPlayFailure,
  type CardPlayState,
  type CommittedCardPlay,
  type PreparedCardPlay,
} from './cardPlayTransaction';
import type { PlayedCardDestination } from './cardRules';
import type { CardResourcePayment } from './combatResource';
import { clearCardPatches, type PatchableCard } from './cardPatch';
import { advanceCardAttachments } from './cardAttachment';
import { clearDynamicCardCostAfterPlay } from './dynamicCardCost';
import {
  runBattleStartFlow,
  runBattleTurnFlow,
  type BattleStartFlowResult,
  type BattleStartFlowStep,
  type BattleTurnFlowResult,
  type BattleTurnFlowStep,
} from './battleTurnFlow';

export type BattleSessionAction = 'battle_start' | 'play_card' | 'use_item' | 'end_turn';

type MaybePromise<T> = T | Promise<T>;

/** One shared gate prevents overlapping UI, API, or host actions from mutating a battle session. */
export class BattleSessionActionGate {
  private activeAction: BattleSessionAction | null = null;

  public tryEnter(action: BattleSessionAction): boolean {
    if (this.activeAction !== null) return false;
    this.activeAction = action;
    return true;
  }

  public leave(action: BattleSessionAction): void {
    if (this.activeAction === action) this.activeAction = null;
  }

  public active(): BattleSessionAction | null {
    return this.activeAction;
  }
}

export interface BattleSessionTransactionPorts<TToken> {
  gate: BattleSessionActionGate;
  beginTransaction(action: BattleSessionAction): MaybePromise<TToken>;
  commitTransaction(token: TToken): MaybePromise<void>;
  rollbackTransaction(token: TToken, cause?: unknown): MaybePromise<void>;
}

export interface BattleSessionAtomicActionPorts<TToken> extends BattleSessionTransactionPorts<TToken> {
  canRun(): boolean;
  isTerminal(): boolean;
}

export type BattleSessionAtomicActionResult<T> =
  | { status: 'busy' | 'rejected' | 'terminal' }
  | { status: 'completed'; value: T };

/** Give non-card host actions the same mutual exclusion and rollback semantics as turns and card plays. */
export async function runBattleSessionAtomicAction<TToken, TValue>(
  action: BattleSessionAction,
  ports: BattleSessionAtomicActionPorts<TToken>,
  execute: () => MaybePromise<TValue>,
): Promise<BattleSessionAtomicActionResult<TValue>> {
  if (!ports.gate.tryEnter(action)) return { status: 'busy' };

  try {
    if (!ports.canRun()) return { status: 'rejected' };
    if (ports.isTerminal()) return { status: 'terminal' };

    const token = await ports.beginTransaction(action);
    try {
      const value = await execute();
      await ports.commitTransaction(token);
      return { status: 'completed', value };
    } catch (error) {
      await ports.rollbackTransaction(token, error);
      throw error;
    }
  } finally {
    ports.gate.leave(action);
  }
}

export interface BattleSessionStartPorts<TToken> extends BattleSessionTransactionPorts<TToken> {
  restored: boolean;
  isTerminal(): boolean;
  executeStartStep(step: BattleStartFlowStep): MaybePromise<void>;
}

export type BattleSessionStartResult =
  | { status: 'busy' | 'restored' | 'terminal' }
  | { status: 'completed' | 'stopped'; flow: BattleStartFlowResult };

/** Run one-shot battle-start effects once, atomically, without owning host storage or presentation. */
export async function startBattleSession<TToken>(
  ports: BattleSessionStartPorts<TToken>,
): Promise<BattleSessionStartResult> {
  const action = 'battle_start';
  if (!ports.gate.tryEnter(action)) return { status: 'busy' };

  try {
    if (ports.restored) return { status: 'restored' };
    if (ports.isTerminal()) return { status: 'terminal' };

    const token = await ports.beginTransaction(action);
    try {
      const flow = await runBattleStartFlow({
        isTerminal: ports.isTerminal,
        execute: ports.executeStartStep,
      });
      await ports.commitTransaction(token);
      return { status: flow.completed ? 'completed' : 'stopped', flow };
    } catch (error) {
      await ports.rollbackTransaction(token, error);
      throw error;
    }
  } finally {
    ports.gate.leave(action);
  }
}

export interface BattleSessionTurnPorts<TToken> extends BattleSessionTransactionPorts<TToken> {
  canEndTurn(): boolean;
  isTerminal(): boolean;
  beginEnemyTurn(): MaybePromise<void>;
  consumeExtraTurn?(actor: 'player' | 'enemy'): MaybePromise<boolean>;
  executeTurnStep(step: BattleTurnFlowStep): MaybePromise<void>;
}

export type BattleSessionTurnResult =
  | { status: 'busy' | 'rejected' | 'terminal' }
  | { status: 'completed' | 'stopped'; flow: BattleTurnFlowResult };

/** Run a complete player-end -> enemy -> next-player cycle as one host transaction. */
export async function advanceBattleSessionTurn<TToken>(
  ports: BattleSessionTurnPorts<TToken>,
): Promise<BattleSessionTurnResult> {
  const action = 'end_turn';
  if (!ports.gate.tryEnter(action)) return { status: 'busy' };

  try {
    if (!ports.canEndTurn()) return { status: 'rejected' };
    if (ports.isTerminal()) return { status: 'terminal' };

    const token = await ports.beginTransaction(action);
    try {
      const flow = await runBattleTurnFlow({
        isTerminal: ports.isTerminal,
        execute: ports.executeTurnStep,
        beginEnemyTurn: ports.beginEnemyTurn,
        consumeExtraTurn: ports.consumeExtraTurn,
      });
      await ports.commitTransaction(token);
      return { status: flow.completed ? 'completed' : 'stopped', flow };
    } catch (error) {
      await ports.rollbackTransaction(token, error);
      throw error;
    }
  } finally {
    ports.gate.leave(action);
  }
}

export interface BattleSessionCardPlayPorts<TCard extends CardPlayCard, TToken>
  extends BattleSessionTransactionPorts<TToken> {
  readCardPlayState(): CardPlayState<TCard>;
  isTerminal(): boolean;
  presentCardPlay?(prepared: PreparedCardPlay<TCard>): MaybePromise<void>;
  applyCardPlayCommit(committed: CommittedCardPlay<TCard>): MaybePromise<void>;
  beginCardTransit(card: TCard): MaybePromise<void>;
  endCardTransit(card: TCard): MaybePromise<void>;
  executeCardEffect(card: TCard, payment: CardResourcePayment, repeatIndex: number): MaybePromise<void>;
  movePlayedCard(card: TCard, destination: PlayedCardDestination): MaybePromise<void>;
  resolvePlayedCardDestination?(card: TCard, defaultDestination: PlayedCardDestination): PlayedCardDestination;
  triggerPostCardPlay(card: TCard): MaybePromise<void>;
  recordCardPlayEvent?(
    card: TCard,
    payment: CardResourcePayment,
    event: { phase: 'before' | 'after'; replayIndex: number; automatic: boolean },
  ): MaybePromise<void>;
  recordCardResourceSpent?(card: TCard, payment: CardResourcePayment): MaybePromise<void>;
  recordPlayedCardMoved?(card: TCard, destination: PlayedCardDestination): MaybePromise<void>;
}

export type BattleSessionCardPlayResult<TCard extends CardPlayCard> =
  | { status: 'busy' }
  | { status: 'rejected'; failure: CardPlayFailure }
  | {
      status: 'completed';
      card: TCard;
      destination: PlayedCardDestination;
      repeatsExecuted: number;
      terminal: boolean;
    };

/**
 * Coordinate payment, effects, destination and post-play triggers around the portable card rules.
 * Effect-owned card choices remain inside CardEffectRuntime and share this outer transaction.
 */
export async function playBattleSessionCard<TCard extends CardPlayCard, TToken>(
  cardId: string,
  ports: BattleSessionCardPlayPorts<TCard, TToken>,
): Promise<BattleSessionCardPlayResult<TCard>> {
  const action = 'play_card';
  if (!ports.gate.tryEnter(action)) return { status: 'busy' };

  try {
    const prepared = prepareCardPlay(cardId, ports.readCardPlayState());
    if (!prepared.ok) return { status: 'rejected', failure: prepared };

    const token = await ports.beginTransaction(action);
    let transitStarted = false;
    try {
      await ports.presentCardPlay?.(prepared);
      const committed = commitCardPlay(prepared, ports.readCardPlayState());
      if (!committed.ok) {
        await ports.rollbackTransaction(token, committed);
        return { status: 'rejected', failure: committed };
      }

      await ports.beginCardTransit(committed.card);
      transitStarted = true;
      await ports.applyCardPlayCommit(committed);
      await ports.recordCardResourceSpent?.(committed.card, committed.payment);

      let repeatsExecuted = 0;
      for (let index = 0; index < committed.repeatCount; index += 1) {
        if (ports.isTerminal()) break;
        await ports.recordCardPlayEvent?.(committed.card, committed.payment, {
          phase: 'before',
          replayIndex: index,
          automatic: index > 0,
        });
        await ports.executeCardEffect(committed.card, committed.payment, index);
        await ports.recordCardPlayEvent?.(committed.card, committed.payment, {
          phase: 'after',
          replayIndex: index,
          automatic: index > 0,
        });
        repeatsExecuted += 1;
      }

      const playedCard = clearDynamicCardCostAfterPlay(advanceCardAttachments((
        'patchBase' in committed.card || 'patches' in committed.card
          ? clearCardPatches(committed.card as TCard & PatchableCard, 'played')
          : { ...committed.card, doubleEffect: undefined, replayCount: 0 }
      ) as TCard & PatchableCard, 'played')) as TCard;
      const destination = ports.resolvePlayedCardDestination?.(playedCard, committed.destination) ?? committed.destination;
      await ports.movePlayedCard(playedCard, destination);
      await ports.recordPlayedCardMoved?.(playedCard, destination);
      await ports.endCardTransit(committed.card);
      transitStarted = false;

      if (!ports.isTerminal()) await ports.triggerPostCardPlay(playedCard);
      await ports.commitTransaction(token);
      return {
        status: 'completed',
        card: playedCard,
        destination,
        repeatsExecuted,
        terminal: ports.isTerminal(),
      };
    } catch (error) {
      try {
        if (transitStarted) await ports.endCardTransit(prepared.card);
      } finally {
        await ports.rollbackTransaction(token, error);
      }
      throw error;
    }
  } finally {
    ports.gate.leave(action);
  }
}
