/** Card play gate, distinct from a conditional effect after paying the cost. */
export function describeSummonPlayRequirement(id: unknown, names: Readonly<Record<string, string>> = {}): string | undefined {
  return typeof id === 'string' && id ? `仅在我方存在“${names[id] || id}”召唤物时可打出` : undefined;
}
