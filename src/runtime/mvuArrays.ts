const MVU_ARRAY_MARKER = '$__META_EXTENSIBLE__$';

export interface MvuArrayOptions {
  /** Fish content conversion accepts only object entries. */
  objectsOnly?: boolean;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeDefinition(value: Record<string, any>): boolean {
  return (
    typeof value.id === 'string' ||
    typeof value.name === 'string' ||
    Object.hasOwn(value, 'effects') ||
    Object.hasOwn(value, 'triggers')
  );
}

function recordEntries(value: Record<string, any>): unknown[] {
  if (looksLikeDefinition(value)) return [value];
  return Object.entries(value).map(([key, entry]) => {
    if (!isRecord(entry) || typeof entry.id === 'string') return entry;
    return { id: key, ...entry };
  });
}

/**
 * Read one current MagVarUpdate collection and remove schema markers at the Tavern boundary.
 * Canonical MVU state uses arrays; an ID-keyed object is also accepted because models commonly
 * choose that shorter registry shape even when the prompt asks for an array.
 */
export function flattenMvuArray<T = unknown>(value: unknown, options: MvuArrayOptions = {}): T[] {
  const entries = Array.isArray(value) ? value : isRecord(value) ? recordEntries(value) : [];
  return entries.filter(entry => {
    if (entry === MVU_ARRAY_MARKER || entry == null) return false;
    return !options.objectsOnly || (typeof entry === 'object' && !Array.isArray(entry));
  }) as T[];
}

/** Normalize the two frequent model variations at the single MVU boundary. */
export function normalizeMvuStatusDefinitions(value: unknown): Record<string, any>[] {
  return flattenMvuArray<Record<string, any>>(value, { objectsOnly: true }).map(status => {
    if (!isRecord(status.triggers)) return status;
    let changed = false;
    const triggers = Object.fromEntries(
      Object.entries(status.triggers).map(([trigger, definition]) => {
        if (
          isRecord(definition) &&
          Object.keys(definition).length === 1 &&
          Object.hasOwn(definition, 'effects')
        ) {
          changed = true;
          return [trigger, definition.effects];
        }
        return [trigger, definition];
      }),
    );
    return changed ? { ...status, triggers } : status;
  });
}
