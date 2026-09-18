// Offline evidence migration ONLY: do not use this as a production fallback.
// It moves explicit definition bodies; it never invents missing definitions.
export function canonicalInitialFixtureToDraft(value) {
  const candidate = structuredClone(value);
  if (!candidate?.player?.core || !Array.isArray(candidate?.player?.cards)) throw new Error('Fixture is not a canonical initial response');
  const definitions = { statuses: new Map(), resources: new Map(), templates: new Map() };
  const errors = [];
  const stable = value => JSON.stringify(value, function (_key, child) {
    return child && typeof child === 'object' && !Array.isArray(child)
      ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child;
  });
  const add = (kind, definition, path) => {
    if (!definition || typeof definition.id !== 'string') { errors.push({ kind, path, code: 'INVALID_DEFINITION' }); return; }
    const previous = definitions[kind].get(definition.id);
    if (previous && stable(previous) !== stable(definition)) errors.push({ kind, path, id: definition.id, code: 'CONFLICTING_DEFINITION' });
    else definitions[kind].set(definition.id, definition);
  };
  const walk = (value, path = []) => {
    if (Array.isArray(value)) { value.forEach((child, i) => walk(child, [...path, i])); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'statuses' || key === 'creates') && Array.isArray(child)) {
        child.forEach((definition, i) => add(key === 'creates' ? 'templates' : 'statuses', definition, [...path, key, i]));
        delete value[key];
        child.forEach((definition, i) => walk(definition, [...path, key, i]));
      } else if (key === 'status' && child?.id && child?.triggers) {
        add('statuses', child, [...path, key]);
        delete value[key];
        walk(child, [...path, key]);
      } else walk(child, [...path, key]);
    }
  };
  if (candidate.player.core.resources !== undefined) {
    if (!Array.isArray(candidate.player.core.resources)) errors.push({ code: 'INVALID_RESOURCE_COLLECTION' });
    else candidate.player.core.resources.forEach((definition, i) => add('resources', definition, ['player', 'core', 'resources', i]));
    delete candidate.player.core.resources;
  }
  walk(candidate);
  return errors.length ? { ok: false, errors } : {
    ok: true,
    draft: { spec: 'mwg.initial-draft/v1', ...candidate,
      registry: Object.fromEntries(Object.entries(definitions).map(([kind, entries]) => [kind, [...entries.values()]])) },
  };
}
