/** Resolve authored and runtime card identities for player-facing descriptions. */
export function collectCardDisplayNames(...roots: unknown[]): Record<string, string> {
  const names: Record<string, string> = Object.create(null);
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const entry = value as Record<string, any>;
    if (typeof entry.name === 'string' && ['Attack', 'Skill', 'Power', 'Event', 'Curse'].includes(entry.type)) {
      for (const id of [entry.id, entry.templateId, entry.originalId, entry.runInstanceId, entry.combatInstanceId]) {
        if (typeof id === 'string') names[id] = entry.name;
      }
    }
    Object.values(entry).forEach(visit);
  };
  roots.forEach(visit);
  return names;
}
