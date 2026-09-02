import { readGameModeLock, type RunState } from '../game-core';

/** Strict boundary: unlocked, story, and legacy-window saves keep the established common UI. */
export function isLockedTowerMapRun(stat: unknown, run: RunState | null): boolean {
  const lock = readGameModeLock(stat);
  return lock?.mode === 'tower' && run?.schemaVersion === 3 && run.routeMode === 'map' && !!run.map;
}
