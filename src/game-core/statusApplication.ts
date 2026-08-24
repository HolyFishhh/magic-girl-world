/** Portable status-stack transition rules. */
export type StatusApplicationTrigger = 'apply' | 'stack' | null;

export interface StatusApplicationResult {
  nextStacks: number;
  trigger: StatusApplicationTrigger;
}

export function resolveStatusStacksChange(currentStacks: number, change: unknown): number {
  if (typeof change === 'number' && Number.isFinite(change)) {
    return Math.max(0, Math.floor(currentStacks + change));
  }
  if (typeof change !== 'string') return currentStacks;
  const normalized = change.trim().toLowerCase();
  if (normalized === 'reset') return 0;
  if (normalized === 'keep') return currentStacks;
  const multiplier = normalized.match(/^x((?:\d+(?:\.\d+)?|\.\d+))$/);
  if (!multiplier) return currentStacks;
  return Math.max(0, Math.floor(currentStacks * Number(multiplier[1])));
}

/** Resolve one status application without mutating the battle state. */
export function resolveStatusApplication(
  currentStacks: number | undefined,
  incomingStacks: number,
  maxStacks?: number,
): StatusApplicationResult {
  const current = currentStacks === undefined ? undefined : Math.max(0, Number.isFinite(currentStacks) ? currentStacks : 0);
  const incoming = Math.max(0, Number.isFinite(incomingStacks) ? incomingStacks : 0);
  const limit = maxStacks === undefined || !Number.isFinite(maxStacks) ? Number.POSITIVE_INFINITY : Math.max(0, maxStacks);
  const base = current ?? 0;
  const nextStacks = Math.min(limit, base + incoming);
  if (current === undefined) return { nextStacks, trigger: nextStacks > 0 ? 'apply' : null };
  return { nextStacks, trigger: nextStacks > current ? 'stack' : null };
}
