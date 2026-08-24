type MaybePromise<T> = T | Promise<T>;

export type TriggerTransactionFailurePolicy = 'propagate' | 'recover-and-continue';

export interface TriggerTransactionPorts<TToken> {
  beginTransaction(scope: string): MaybePromise<TToken>;
  commitTransaction(token: TToken): MaybePromise<void>;
  rollbackTransaction(token: TToken, cause?: unknown): MaybePromise<void>;
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
    return { status: 'rolled_back', cause };
  }
}
