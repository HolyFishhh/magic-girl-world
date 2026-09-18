/** Collect display identities from authored summon definitions, never prose. */
export function collectSummonDisplayNames(...roots: unknown[]): Record<string, string> {
  const names: Record<string, string> = Object.create(null);
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const entry = value as Record<string, any>;
    const summon = entry.spawn_summon;
    if (summon && typeof summon.id === 'string' && typeof summon.name === 'string') names[summon.id] = summon.name;
    if (entry.op === 'spawn_summon' && entry.summon?.id && entry.summon?.name) names[entry.summon.id] = entry.summon.name;
    if (entry.instanceId && entry.templateId && entry.name) { names[entry.instanceId] = entry.name; names[entry.templateId] = entry.name; }
    Object.values(entry).forEach(visit);
  };
  roots.forEach(visit);
  return names;
}
