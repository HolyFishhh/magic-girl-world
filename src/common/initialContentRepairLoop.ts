export class InitialContentCandidateRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InitialContentCandidateRejectedError';
  }
}

export interface InitialContentRepairLoopResult {
  repaired: boolean;
  attempts: number;
  error: unknown;
}

export function isInitialContentCandidateRejected(error: unknown): boolean {
  if (error instanceof InitialContentCandidateRejectedError) return true;
  // Tavern Helper can surface callback failures across an iframe/event boundary.
  // The stable error name survives that boundary even when the JavaScript
  // prototype identity does not, so do not discard the owned second candidate.
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'InitialContentCandidateRejectedError'
  );
}

/**
 * Runs a bounded sequence of candidates inside one repair transaction.
 *
 * The persistent browser counter prevents a rebuilt iframe from starting
 * repair transactions forever. It must not also limit the candidates owned by
 * a transaction that has already started: the first candidate can be parsed
 * successfully yet still fail the gameplay contract, and the second candidate
 * must then receive the concrete validation errors.
 */
export async function runInitialContentRepairLoop(
  maxCandidates: number,
  executeCandidate: (attempt: number) => Promise<void>,
): Promise<InitialContentRepairLoopResult> {
  const limit = Math.max(1, Math.floor(maxCandidates));
  let attempts = 0;
  let error: unknown = null;

  while (attempts < limit) {
    attempts += 1;
    try {
      await executeCandidate(attempts);
      return { repaired: true, attempts, error: null };
    } catch (candidateError) {
      error = candidateError;
      if (!isInitialContentCandidateRejected(candidateError)) break;
    }
  }

  return { repaired: false, attempts, error };
}
