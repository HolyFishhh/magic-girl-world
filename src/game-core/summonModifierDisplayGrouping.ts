/** Display-only grouping. Never rewrite executable effects or resolve a random target. */
export function summonModifierDisplayGroups<T>(entries: readonly T[], format: 'compact' | 'program'): T[][] {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${stable(v)}`).join(',')}}`;
    return JSON.stringify(value) ?? '';
  };
  const key = (entry: T): string | undefined => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const record = entry as Record<string, any>;
    const compactOp = Object.keys(record)[0];
    // Conditions, timing, repeats and other wrappers are separate executions.
    if (format === 'compact' && (Object.keys(record).length !== 1 || !['modify_summon', 'modify_summon_effect'].includes(compactOp))) return;
    if (format === 'program' && !['modify_summons', 'modify_summon_effects'].includes(record.op)) return;
    const payload = format === 'compact' ? record[compactOp] : record;
    if (!payload || typeof payload !== 'object') return;
    const amount = format === 'compact' ? payload.add : payload.operator === 'add' ? payload.value : undefined;
    // Only unconditional positive constants: formulas may read a changed value,
    // and reductions can remove a target before the next selection is resolved.
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return;
    const selector = payload.selector;
    if (!selector || !['left', 'right', 'first', 'last', 'all', 'by_id', 'source'].includes(selector.pick)) return;
    return `${format === 'compact' ? compactOp : record.op}:${stable(selector)}`;
  };
  const groups: T[][] = [];
  let previous: string | undefined;
  for (const entry of entries) {
    const next = key(entry);
    if (next !== undefined && next === previous) groups[groups.length - 1].push(entry);
    else groups.push([entry]);
    previous = next;
  }
  return groups;
}

/** The target prefix is shared only after structured ownership checks above. */
export function joinSummonModifierDescriptions(texts: readonly string[]): string {
  if (texts.length < 2) return texts[0] || '';
  const prefix = texts[0].slice(0, texts[0].lastIndexOf('的') + 1);
  if (!prefix || !texts.every(text => text.startsWith(prefix))) return texts.join('；');
  return prefix + texts.map(text => text.slice(prefix.length)).join('、');
}
