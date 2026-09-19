/**
 * Coordinate asynchronous view bootstrap with synchronous in-place view
 * switches. A stale bootstrap may finish after common/fish has already been
 * mounted; the shared epoch lets it observe that it no longer owns the frame
 * before it replaces the document body.
 */
const RUNTIME_MOUNT_EPOCH_KEY = '__MWG_RUNTIME_MOUNT_EPOCH__';

function runtimeHost(): typeof globalThis & Record<string, unknown> {
  return globalThis as typeof globalThis & Record<string, unknown>;
}

export function claimRuntimeMountEpoch(): number {
  const host = runtimeHost();
  const previous = Number(host[RUNTIME_MOUNT_EPOCH_KEY]);
  const next = Number.isFinite(previous) && previous >= 0 ? previous + 1 : 1;
  host[RUNTIME_MOUNT_EPOCH_KEY] = next;
  return next;
}

export function isRuntimeMountEpochCurrent(epoch: number): boolean {
  return Number(runtimeHost()[RUNTIME_MOUNT_EPOCH_KEY]) === epoch;
}
