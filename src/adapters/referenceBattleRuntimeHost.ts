import {
  BattleSessionActionGate,
  BattleEffectRuntime,
  BattleStateStore,
  CardEffectRuntime,
  AbilityTriggerRuntime,
  RelicTriggerRuntime,
  StatusLifecycleRuntime,
  type AbilityTriggerRuntimePorts,
  type BattleSessionAction,
  type BattleEffectRuntimePorts,
  type BattleSessionTransactionPorts,
  type CardEffectRuntimePorts,
  type GameState,
  type TriggerTransactionPorts,
  type RelicTriggerRuntimePorts,
  type StatusDefinitionReader,
  type StatusLifecycleRuntimePorts,
} from '../game-core';

/**
 * Reference host for websites, services, tests, and Mods.
 * It combines portable battle state with the shared transaction protocols and no Tavern dependencies.
 */
export class ReferenceBattleRuntimeHost extends BattleStateStore {
  public readonly gate = new BattleSessionActionGate();

  private sequence = 0;

  public constructor(initialState?: GameState) {
    super(initialState);
  }

  public beginTransaction(action: BattleSessionAction): string {
    return this.beginScopedTransaction(action);
  }

  public beginScopedTransaction(scope: string): string {
    const token = `${scope}_${++this.sequence}`;
    this.createSnapshot(token);
    return token;
  }

  public commitTransaction(token: string): void {
    if (!this.deleteSnapshot(token)) throw new Error(`unknown battle transaction: ${token}`);
  }

  public rollbackTransaction(token: string): void {
    if (!this.restoreSnapshot(token)) throw new Error(`unknown battle transaction: ${token}`);
    this.deleteSnapshot(token);
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

  public createCardEffectRuntime(ports: CardEffectRuntimePorts): CardEffectRuntime {
    return new CardEffectRuntime(this, ports);
  }

  public createBattleEffectRuntime(ports: BattleEffectRuntimePorts): BattleEffectRuntime {
    return new BattleEffectRuntime(this, ports);
  }

  public createAbilityTriggerRuntime(
    execute: AbilityTriggerRuntimePorts['execute'],
  ): AbilityTriggerRuntime {
    return new AbilityTriggerRuntime({
      readAbilities: target => (target === 'player' ? this.getPlayer() : this.getEnemy())?.abilities,
      execute,
    });
  }

  public createRelicTriggerRuntime(execute: RelicTriggerRuntimePorts['execute']): RelicTriggerRuntime {
    return new RelicTriggerRuntime({
      readRelics: () => this.getPlayer().relics,
      execute,
    });
  }

  public createStatusLifecycleRuntime(
    definitions: StatusDefinitionReader,
    ports: Omit<StatusLifecycleRuntimePorts<string>, 'state' | 'definitions' | 'transactions'>,
  ): StatusLifecycleRuntime<string> {
    return new StatusLifecycleRuntime({
      state: this,
      definitions,
      transactions: this.triggerTransactionPorts(),
      ...ports,
    });
  }
}
