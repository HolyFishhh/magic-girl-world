function normalizeIdSource(sourceId: unknown): string {
  const value = String(sourceId ?? '').trim().replace(/\s+/g, '_');
  return value || 'card';
}

/** Allocate a readable runtime ID without reading time, randomness, or host globals. */
export function allocateRuntimeId(sourceId: unknown, existingIds: ReadonlySet<string>): string {
  const base = normalizeIdSource(sourceId);
  let sequence = 1;
  let candidate = `${base}__${sequence}`;
  while (existingIds.has(candidate)) {
    sequence += 1;
    candidate = `${base}__${sequence}`;
  }
  return candidate;
}
