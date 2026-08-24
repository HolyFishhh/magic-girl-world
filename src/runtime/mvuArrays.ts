const MVU_ARRAY_MARKER = '$__META_EXTENSIBLE__$';

export interface MvuArrayOptions {
  /** Fish content conversion accepts only object entries. */
  objectsOnly?: boolean;
}

/** Read one current MagVarUpdate array and remove schema markers at the Tavern boundary. */
export function flattenMvuArray<T = unknown>(value: unknown, options: MvuArrayOptions = {}): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(entry => {
    if (entry === MVU_ARRAY_MARKER || entry == null) return false;
    return !options.objectsOnly || (typeof entry === 'object' && !Array.isArray(entry));
  }) as T[];
}
