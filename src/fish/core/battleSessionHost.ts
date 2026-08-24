import { BattleSessionActionGate, type BattleSessionAction, type TriggerTransactionPorts } from '../../game-core';
import { GameStateManager } from './gameStateManager';

/** Tavern-side transaction adapter for the portable battle-session coordinator. */
export class BattleSessionHost {
  private static instance: BattleSessionHost;
  private transactionSequence = 0;
  public readonly gate = new BattleSessionActionGate();

  private constructor(private readonly gameStateManager = GameStateManager.getInstance()) {}

  public static getInstance(): BattleSessionHost {
    if (!BattleSessionHost.instance) BattleSessionHost.instance = new BattleSessionHost();
    return BattleSessionHost.instance;
  }

  public beginTransaction(action: BattleSessionAction): string {
    return this.beginScopedTransaction(action);
  }

  public beginScopedTransaction(scope: string): string {
    const token = `${scope}_${++this.transactionSequence}`;
    this.gameStateManager.createSnapshot(token);
    return token;
  }

  public commitTransaction(token: string): void {
    this.gameStateManager.deleteSnapshot(token);
  }

  public rollbackTransaction(token: string): void {
    this.gameStateManager.restoreSnapshot(token);
    this.gameStateManager.deleteSnapshot(token);
  }

  public triggerTransactionPorts(): TriggerTransactionPorts<string> {
    return {
      beginTransaction: scope => this.beginScopedTransaction(scope),
      commitTransaction: token => this.commitTransaction(token),
      rollbackTransaction: token => this.rollbackTransaction(token),
    };
  }
}
