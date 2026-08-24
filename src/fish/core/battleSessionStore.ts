import { getCurrentMessageVariables, updateCurrentMessageVariablesWith } from '../../runtime/messageVariables';
import {
  canRestoreBattleSession,
  createBattleFingerprint,
  createBattleSessionSnapshot,
  readBattleSessionSnapshot as readPortableBattleSessionSnapshot,
  type BattleSessionSnapshot,
  type GameState,
} from '../../game-core';

export const BATTLE_SESSION_NAMESPACE = '__magic_girl_world';
export const BATTLE_SESSION_KEY = 'battle_session';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readBattleSessionSnapshot(variables: unknown): BattleSessionSnapshot | null {
  if (!isRecord(variables)) return null;
  const namespace = variables[BATTLE_SESSION_NAMESPACE];
  if (!isRecord(namespace)) return null;
  return readPortableBattleSessionSnapshot(namespace[BATTLE_SESSION_KEY]);
}

export interface BattleSessionVariablesStore {
  read(): Record<string, any>;
  update(
    updater: (variables: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>,
  ): Record<string, any> | Promise<Record<string, any>>;
}

const DEFAULT_SAVE_DELAY_MS = 75;

/** Owns the current-message persistence lifecycle for one battle iframe. */
export class BattleSessionStore {
  private fingerprint: string | null = null;
  private restored = false;
  private enabled = false;
  private restoring = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private suspensionDepth = 0;
  private pendingState: GameState | null = null;

  public constructor(
    private readonly variables: BattleSessionVariablesStore = {
      read: getCurrentMessageVariables,
      update: updateCurrentMessageVariablesWith,
    },
    private readonly saveDelayMs = DEFAULT_SAVE_DELAY_MS,
  ) {}

  public prepare(variables: unknown, battleData: unknown): GameState | null {
    this.cancelTimer();
    this.generation += 1;
    this.restored = false;
    this.restoring = false;
    this.suspensionDepth = 0;
    this.pendingState = null;

    if (!battleData) {
      this.fingerprint = null;
      this.enabled = false;
      return null;
    }

    const fingerprint = createBattleFingerprint(battleData);
    const snapshot = readBattleSessionSnapshot(variables);
    this.fingerprint = fingerprint;

    if (!canRestoreBattleSession(snapshot, fingerprint)) {
      this.enabled = false;
      return null;
    }

    this.enabled = true;
    this.restored = true;
    this.restoring = true;
    const restoredState = JSON.parse(JSON.stringify(snapshot.state)) as GameState;
    if (restoredState.phase === 'enemy_turn' && !restoredState.isGameOver) {
      // Replaying an interrupted enemy pipeline risks duplicate damage, so preserve
      // the committed state and only unlock player input.
      restoredState.phase = 'player_turn';
      console.warn('Recovered an interrupted enemy turn as a player turn.');
    }
    return restoredState;
  }

  public finishRestore(): void {
    this.restoring = false;
  }

  public enable(): void {
    this.enabled = this.fingerprint !== null;
  }

  public wasRestored(): boolean {
    return this.restored;
  }

  public schedule(state: GameState): void {
    if (!this.canSave()) return;
    if (this.suspensionDepth > 0) {
      this.pendingState = state;
      return;
    }
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist(state);
    }, this.saveDelayMs);
  }

  public async flush(state: GameState): Promise<void> {
    if (this.suspensionDepth > 0) {
      this.pendingState = state;
      return;
    }
    this.cancelTimer();
    await this.persist(state);
  }

  public suspend(): void {
    this.suspensionDepth += 1;
    this.cancelTimer();
  }

  public resume(state: GameState): void {
    if (this.suspensionDepth === 0) return;
    this.pendingState = state;
    this.suspensionDepth -= 1;
    if (this.suspensionDepth > 0) return;

    const pendingState = this.pendingState;
    this.pendingState = null;
    if (pendingState) this.schedule(pendingState);
  }

  public async clear(): Promise<void> {
    const previous = {
      enabled: this.enabled,
      restored: this.restored,
      restoring: this.restoring,
      fingerprint: this.fingerprint,
      suspensionDepth: this.suspensionDepth,
      pendingState: this.pendingState,
      generation: this.generation,
    };
    this.enabled = false;
    this.restored = false;
    this.restoring = false;
    this.fingerprint = null;
    this.suspensionDepth = 0;
    this.pendingState = null;
    this.cancelTimer();
    this.generation += 1;

    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        await Promise.resolve(
          this.variables.update(currentVariables => {
            const currentNamespace = currentVariables?.[BATTLE_SESSION_NAMESPACE];
            if (!currentNamespace || typeof currentNamespace !== 'object') return currentVariables;

            const nextNamespace = { ...currentNamespace };
            delete nextNamespace[BATTLE_SESSION_KEY];
            if (Object.keys(nextNamespace).length > 0) {
              currentVariables[BATTLE_SESSION_NAMESPACE] = nextNamespace;
            } else {
              delete currentVariables[BATTLE_SESSION_NAMESPACE];
            }
            return currentVariables;
          }),
        );
      });

    try {
      await this.queue;
    } catch (error) {
      // The source-floor variables still contain the session. Keep the in-memory
      // store usable so the caller can retry or restore the full exit transaction.
      this.enabled = previous.enabled;
      this.restored = previous.restored;
      this.restoring = previous.restoring;
      this.fingerprint = previous.fingerprint;
      this.suspensionDepth = previous.suspensionDepth;
      this.pendingState = previous.pendingState;
      this.generation = previous.generation;
      console.error('Failed to clear the battle session from message variables:', error);
      throw error;
    }
  }

  private canSave(): boolean {
    return this.enabled && this.fingerprint !== null && !this.restoring;
  }

  private cancelTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async persist(state: GameState): Promise<void> {
    if (!this.canSave() || !this.fingerprint) return;

    const fingerprint = this.fingerprint;
    const generation = this.generation;
    const snapshot = createBattleSessionSnapshot(fingerprint, state, Date.now());
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (generation !== this.generation || !this.enabled || fingerprint !== this.fingerprint) return;
        await Promise.resolve(
          this.variables.update(currentVariables => {
            const currentNamespace = currentVariables?.[BATTLE_SESSION_NAMESPACE];
            currentVariables[BATTLE_SESSION_NAMESPACE] = {
              ...(currentNamespace && typeof currentNamespace === 'object' ? currentNamespace : {}),
              [BATTLE_SESSION_KEY]: snapshot,
            };
            return currentVariables;
          }),
        );
      });

    try {
      await this.queue;
    } catch (error) {
      console.error('Failed to save the battle session to message variables:', error);
    }
  }
}
