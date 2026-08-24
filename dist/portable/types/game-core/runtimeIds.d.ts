/** Allocate a readable runtime ID without reading time, randomness, or host globals. */
export declare function allocateRuntimeId(sourceId: unknown, existingIds: ReadonlySet<string>): string;
