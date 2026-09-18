type MaybePromise<T> = T | Promise<T>;

export type TriggerTransactionFailurePolicy = 'propagate' | 'recover-and-continue';

/**
 * Diagnostics emitted after a recover-and-continue trigger was restored.
 * The error is the original trigger failure; a rollback failure still rejects.
 */
export interface RecoveredTriggerFailure {
  scope: string;
  error: unknown;
}

/**
 * Observers are deliberately diagnostic-only: their own failures cannot turn
 * an established recover-and-continue UI path into a failed battle action.
 */
export type TriggerTransactionRecoveryObserver = (
  failure: RecoveredTriggerFailure,
) => MaybePromise<void>;

export interface TriggerTransactionPorts<TToken> {
  beginTransaction(scope: string): MaybePromise<TToken>;
  commitTransaction(token: TToken): MaybePromise<void>;
  rollbackTransaction(token: TToken, cause?: unknown): MaybePromise<void>;
  /** Optional observer for callers that must distinguish recovered triggers from a clean run. */
  onRecoveredFailure?: TriggerTransactionRecoveryObserver;
}

export type TriggerTransactionResult<TValue> =
  { status: 'completed'; value: TValue } | { status: 'rolled_back'; cause: unknown };

export class TriggerTransactionRollbackError extends Error {
  public readonly name = 'TriggerTransactionRollbackError';

  public constructor(
    public readonly scope: string,
    public readonly transactionCause: unknown,
    public readonly rollbackCause: unknown,
  ) {
    super(`Failed to roll back trigger transaction: ${scope}`);
  }
}

/**
 * Run one nested trigger atomically without entering the player-action gate.
 * The host owns snapshots; callers own trigger-specific logging and recovery UX.
 */
export async function runTriggerTransaction<TToken, TValue>(
  scope: string,
  ports: TriggerTransactionPorts<TToken>,
  execute: () => MaybePromise<TValue>,
  failurePolicy: TriggerTransactionFailurePolicy = 'propagate',
): Promise<TriggerTransactionResult<TValue>> {
  const token = await ports.beginTransaction(scope);

  try {
    const value = await execute();
    await ports.commitTransaction(token);
    return { status: 'completed', value };
  } catch (cause) {
    try {
      await ports.rollbackTransaction(token, cause);
    } catch (rollbackCause) {
      throw new TriggerTransactionRollbackError(scope, cause, rollbackCause);
    }

    if (failurePolicy === 'propagate') throw cause;
    try {
      await ports.onRecoveredFailure?.({ scope, error: cause });
    } catch {
      // Diagnostic observers must not change the established recovery contract.
    }
    return { status: 'rolled_back', cause };
  }
}
