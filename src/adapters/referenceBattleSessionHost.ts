import {
  BattleSessionActionGate,
  type BattleSessionAction,
  type BattleSessionTransactionPorts,
  type TriggerTransactionPorts,
} from '../game-core';

export type SerializableClone<T> = (value: T) => T;

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Minimal storage adapter for websites, services, tests, and Mods.
 * It owns no battle rules; consumers pass these transaction ports to the game-core coordinator.
 */
export class ReferenceBattleSessionHost<TState> {
  public readonly gate = new BattleSessionActionGate();
  private readonly snapshots = new Map<string, TState>();
  private sequence = 0;

  public constructor(
    private state: TState,
    private readonly clone: SerializableClone<TState> = jsonClone,
  ) {
    this.state = this.clone(state);
  }

  public read(): TState {
    return this.clone(this.state);
  }

  public replace(state: TState): void {
    this.state = this.clone(state);
  }

  public update(update: (draft: TState) => void): TState {
    const draft = this.read();
    update(draft);
    this.replace(draft);
    return this.read();
  }

  public beginTransaction(action: BattleSessionAction): string {
    return this.beginScopedTransaction(action);
  }

  public beginScopedTransaction(scope: string): string {
    const token = `${scope}_${++this.sequence}`;
    this.snapshots.set(token, this.read());
    return token;
  }

  public commitTransaction(token: string): void {
    if (!this.snapshots.delete(token)) throw new Error(`unknown battle transaction: ${token}`);
  }

  public rollbackTransaction(token: string): void {
    const snapshot = this.snapshots.get(token);
    if (snapshot === undefined) throw new Error(`unknown battle transaction: ${token}`);
    this.replace(snapshot);
    this.snapshots.delete(token);
  }

  public transactionPorts(): BattleSessionTransactionPorts<string> {
    return {
      gate: this.gate,
      beginTransaction: action => this.beginTransaction(action),
      commitTransaction: token => this.commitTransaction(token),
      rollbackTransaction: token => this.rollbackTransaction(token),
    };
  }

  public triggerTransactionPorts(): TriggerTransactionPorts<string> {
    return {
      beginTransaction: scope => this.beginScopedTransaction(scope),
      commitTransaction: token => this.commitTransaction(token),
      rollbackTransaction: token => this.rollbackTransaction(token),
    };
  }
}
