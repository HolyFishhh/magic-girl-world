import { inspectInitialDraft, type DraftPath, type InitialDraftDiagnostic } from './initialDraft';
import { projectStatusThroughNextTurn } from './statusDurationProjection';
import jsep from 'jsep';

type ObjectValue = Record<string, any>;
export interface InitialSemanticFact {
  kind: 'stance_read' | 'stance_entry' | 'listener' | 'status_listener' | 'card_generation' | 'discard' | 'recover'
    | 'resource_payment' | 'resource_delta' | 'resource_set' | 'resource_read';
  path: DraftPath;
  actor: string;
  id: string;
  /** Exact definition identity for status-local lifecycle/event listeners. */
  statusId?: string;
  comparison?: '==' | '!=';
  /** Uninterpreted authored amount. A formula or assignment is not proof of consumption. */
  value?: number | string;
  resourceField?: 'current' | 'max';
}
export interface InitialSemanticAudit {
  inspected: boolean;
  references: InitialDraftDiagnostic[];
  facts: InitialSemanticFact[];
  edges: Array<{ from: DraftPath; to: DraftPath; actor: string }>;
  /** Known executable dependency sites this diagnostic walker has not expanded. */
  unexpandedPaths: DraftPath[];
  observations: Array<{ code: 'NO_LOCAL_STANCE_ENTRY' | 'NO_OWNED_RESOURCE_USE'; path: DraftPath; actor: string; id: string }>;
  truncated: boolean;
  isolatedStatusTiming: Array<{ applicationPath: DraftPath; statusId: string; projection: ReturnType<typeof projectStatusThroughNextTurn> }>;
}
const record = (v: unknown): v is ObjectValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const display = new Set(['id', 'name', 'emoji', 'description', 'source', 'narrate', '$meta']);

/**
 * Diagnostic facts only: potential structural paths, NOT proof of gameplay
 * reachability or prose fidelity. Never repairs, commits, or rejects content.
 * Reuses the authoritative compiler for reference errors. External combatants
 * may supply state, so absence of a local producer is only an observation.
 */
export function auditInitialSemanticStructure(input: unknown): InitialSemanticAudit {
  const inspected = inspectInitialDraft(input, () => []);
  const report: InitialSemanticAudit = { inspected: inspected.inspected, references: inspected.references, facts: [], edges: [], unexpandedPaths: [], observations: [], truncated: false, isolatedStatusTiming: [] };
  if (!inspected.inspected || !record(input)) return report;
  const draft = input;
  const registry = new Map<string, { value: ObjectValue; path: DraftPath }>();
  for (const kind of ['statuses', 'templates'] as const) {
    for (const [index, value] of (Array.isArray(draft.registry[kind]) ? draft.registry[kind] : []).entries()) {
      if (record(value) && typeof value.id === 'string' && !registry.has(`${kind}:${value.id}`))
        registry.set(`${kind}:${value.id}`, { value, path: ['registry', kind, index] });
    }
  }
  type Context = { actor: string; opponent?: string; summoner?: string; statusHolder?: boolean };
  const actors = new Map<string, Context>([
    ['player', { actor: 'player', opponent: 'opponent' }],
    ['opponent', { actor: 'opponent', opponent: 'player' }],
  ]);
  const actorContext = (actor: string): Context => actors.get(actor) || { actor };
  const queue: Array<{ value: unknown; path: DraftPath; context: Context }> = [];
  const visited = new Set<string>();
  let remaining = 100_000;
  const target = (context: Context, to: unknown): string => to === undefined || to === 'self'
    ? context.actor : context.opponent || 'external';
  const follow = (kind: 'statuses' | 'templates', id: unknown, from: DraftPath, context: Context): void => {
    if (typeof id !== 'string') return;
    const definition = registry.get(`${kind}:${id}`);
    if (!definition) return; // Compiler owns missing/duplicate reference diagnostics.
    report.edges.push({ from: [...from], to: [...definition.path], actor: context.actor });
    const key = JSON.stringify([definition.path, context.actor, context.summoner]);
    if (visited.has(key)) return;
    visited.add(key);
    // A status runs as its holder. A generated card is a future ordinary
    // effect source and must not inherit its creating status's default target.
    queue.push({ ...definition, context: { ...context, statusHolder: kind === 'statuses' } });
  };
  const walk = (value: unknown, path: DraftPath, context: Context): void => {
    if (--remaining < 0 || path.length > 128) { report.truncated = true; return; }
    if (typeof value === 'string') {
      // Parse member expressions, never prose or quoted lookalike paths. A
      // current-pool read is a possible use, not proof of reachable benefit.
      if (value.includes('.resource.')) {
        if (value.length > 100_000) { report.truncated = true; return; }
        try {
          const memberPath = (node: any): string | undefined => {
            if (node?.type === 'Identifier') return node.name;
            if (node?.type !== 'MemberExpression' || node.computed || node.property?.type !== 'Identifier') return;
            const parent = memberPath(node.object);
            return parent ? `${parent}.${node.property.name}` : undefined;
          };
          const visit = (node: any, depth = 0): void => {
            if (--remaining < 0 || depth > 128) { report.truncated = true; return; }
            if (!node || typeof node !== 'object') return;
            if (node.type === 'Literal') return;
            const match = memberPath(node)?.match(/^(self|opponent)\.resource\.([A-Za-z_][A-Za-z0-9_]*)\.(current|max)$/);
            if (match) report.facts.push({ kind: 'resource_read', path: [...path], actor: target(context, match[1]),
              id: match[2], resourceField: match[3] as 'current' | 'max' });
            for (const child of Object.values(node)) {
              if (Array.isArray(child)) child.forEach(entry => visit(entry, depth + 1));
              else if (child && typeof child === 'object') visit(child, depth + 1);
            }
          };
          visit(jsep(value));
        } catch { /* Invalid expressions remain the compiler's responsibility. */ }
      }
      // Exact public stance comparisons only, not natural-language matching.
      for (const match of value.matchAll(/\b(self|opponent)\.stance\s*(==|!=)\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\3/g)) {
        report.facts.push({ kind: 'stance_read', path: [...path], actor: target(context, match[1]), id: match[4], comparison: match[2] as '==' | '!=' });
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, [...path, i], context)); return; }
    if (!record(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (display.has(key) || ['statuses', 'templates', 'creates', 'resources'].includes(key)) continue;
      const next = [...path, key];
      // Selection/removal can execute another holder's status programs. Until
      // these relations are expanded, missing local facts are not absence proof.
      if (key === 'apply_summon_status' || key === 'remove_summon_status'
        || key === 'spawn_enemy' || key === 'copy_summon'
        || (key === 'spawn_summon' && !record(child))
        || (key === 'status_effects' && Array.isArray(child) && child.length > 0))
        report.unexpandedPaths.push(next);
      if (key === 'remove_status') {
        const definition = typeof child === 'string' && !['all', 'buffs', 'debuffs'].includes(child)
          ? registry.get(`statuses:${child}`) : undefined;
        if (!definition) report.unexpandedPaths.push(next);
        else if (record(definition.value.triggers) && definition.value.triggers.remove !== undefined) {
          const actor = target(context, value.to === undefined ? (context.statusHolder ? 'self' : 'opponent') : value.to);
          const callbackPath = [...definition.path, 'triggers', 'remove'];
          report.edges.push({ from: next, to: callbackPath, actor });
          const callbackKey = JSON.stringify([callbackPath, actor, context.summoner]);
          if (!visited.has(callbackKey)) {
            visited.add(callbackKey);
            queue.push({ value: definition.value.triggers.remove, path: callbackPath,
              context: { ...actorContext(actor), statusHolder: true } });
          }
        }
      }
      // Distinguish actual payment/delta/assignment sites from formula reads.
      // Do not infer signs of formulas or treat set_resource as a payment.
      if (key === 'cost' && record(child)) {
        for (const [id, amount] of Object.entries(child)) {
          if (id !== 'energy' && (typeof amount === 'number' || typeof amount === 'string'))
            report.facts.push({ kind: 'resource_payment', path: [...next, id], actor: context.actor, id, value: amount });
        }
      }
      if ((key === 'resource' || key === 'set_resource') && record(child) && typeof child.id === 'string') {
        const amount = key === 'resource' ? child.amount : child.value;
        if (typeof amount === 'number' || typeof amount === 'string')
          report.facts.push({ kind: key === 'resource' ? 'resource_delta' : 'resource_set', path: next,
            actor: target(context, value.to), id: child.id, value: amount });
      }
      if (key === 'apply_status') follow('statuses', child, next,
        actorContext(target(context, value.to === undefined ? (context.statusHolder ? 'self' : 'opponent') : value.to)));
      // Only direct self-targeted ordinary card effects: no assumption that a
      // trigger, enemy action or scheduled effect runs in the holder's action phase.
      if (key === 'apply_status' && typeof child === 'string' && value.to === 'self'
        && path[0] === 'player' && path[1] === 'cards' && path[3] === 'effects'
        && (path.length === 4 || (path.length === 5 && typeof path[4] === 'number'))
        && typeof value.stacks === 'number') {
        const definition = registry.get(`statuses:${child}`)?.value;
        const card = draft.player.cards[path[2] as number];
        if (definition && ['Attack', 'Skill', 'Power'].includes(card?.type)) {
          report.isolatedStatusTiming.push({ applicationPath: next, statusId: child,
            projection: projectStatusThroughNextTurn({ incomingStacks: value.stacks,
              maxStacks: definition.maxStacks, stacksChange: definition.stacks_change }) });
        }
      }
      // Templates become cards in the player's shared card zones. A summon may
      // produce one, but it never becomes the future card's resource owner.
      if (['add_card', 'ensure_card', 'transform_card'].includes(key)) follow('templates', child, next, actorContext('player'));
      if (['add_card', 'ensure_card', 'transform_card'].includes(key) && typeof child === 'string')
        report.facts.push({kind:'card_generation',path:next,actor:context.actor,id:child});
      if (key === 'discard' || key === 'recover')
        report.facts.push({kind:key,path:next,actor:context.actor,id:typeof value.from === 'string' ? value.from : 'unspecified'});
      // Status event carriers differ from artifact/Power root triggers. Keep
      // their source paths so callers cannot count an unrelated root listener.
      if (key === 'triggers' && path[0] === 'registry' && path[1] === 'statuses'
        && path.length === 3 && record(child)) {
        for (const event of Object.keys(child).filter(event => event !== 'hold' && event !== 'threshold_execute'))
          report.facts.push({kind:'status_listener',path:[...next,event],actor:context.actor,id:event,statusId:value.id});
      }
      if (key === 'trigger' && record(child) && typeof child.on === 'string')
        report.facts.push({ kind: 'listener', path: next, actor: context.actor, id: child.on });
      if (key === 'stance' && record(child) && typeof child.id === 'string')
        report.facts.push({ kind: 'stance_entry', path: next, actor: target(context, value.to), id: child.id });
      if (key === 'summoner_effects') {
        if (!context.summoner) report.unexpandedPaths.push(next);
        walk(child, next, actorContext(context.summoner || `unknown-summoner:${context.actor}`));
        continue;
      }
      if (key === 'spawn_summon' && record(child)) {
        // Runtime summonRecipientId binds a combatant on the receiving side.
        // Nested summons do not make the creating pet the new unit's owner.
        const sourceOwner = context.summoner || context.actor;
        const owner = target(actorContext(sourceOwner), value.to);
        const nested: Context = { actor: `spawn_summon:${JSON.stringify([next, owner])}`,
          opponent: actorContext(owner).opponent, summoner: owner };
        actors.set(nested.actor, nested);
        report.edges.push({ from: [...path], to: next, actor: nested.actor });
        if (owner !== 'player' && owner !== 'opponent') report.unexpandedPaths.push(next);
        for (const [field, entry] of Object.entries(child)) {
          if (display.has(field) || field === 'resources') continue;
          // Count is evaluated by the creator; action/ability programs by the new unit.
          walk(entry, [...next, field], field === 'count' ? context : nested);
        }
        continue;
      }
      if (key === 'spawn_enemy' && record(child)) {
        walk(child, next, { actor: `spawn_enemy:${JSON.stringify(next)}`, opponent: 'player' });
        continue;
      }
      walk(child, next, context);
    }
  };
  const player = actorContext('player');
  // Unselected opening rewards and unreferenced definitions are not roots.
  for (const key of ['core', 'cards', 'artifacts', 'items', 'player_abilities', 'player_lust_effect'])
    queue.push({ value: draft.player[key], path: ['player', key], context: player });
  for (const [index, status] of (Array.isArray(draft.player.player_status_effects) ? draft.player.player_status_effects : []).entries())
    if (record(status)) follow('statuses', status.id, ['player', 'player_status_effects', index], player);
  for (let index = 0; index < queue.length && remaining >= 0; index++) {
    const entry = queue[index];
    walk(entry.value, entry.path, entry.context);
  }
  const entries = new Set(report.facts.filter(f => f.kind === 'stance_entry').map(f => JSON.stringify([f.actor, f.id])));
  const complete = !report.truncated && !report.unexpandedPaths.length && !report.references.length;
  if (complete) for (const fact of report.facts) {
    if (fact.kind !== 'stance_read' || fact.comparison !== '==' || fact.actor !== 'player') continue;
    if (!entries.has(JSON.stringify([fact.actor, fact.id])))
      report.observations.push({ code: 'NO_LOCAL_STANCE_ENTRY', path: [...fact.path], actor: fact.actor, id: fact.id });
  }
  // Only a complete owned-content traversal can report a missing local use.
  // Future rewards/external actors may legitimately supply one: this remains
  // an observation, never a rejection, default effect, or automatic repair.
  if (complete) {
    for (const [index, resource] of (Array.isArray(draft.registry.resources) ? draft.registry.resources : []).entries()) {
      if (!record(resource) || typeof resource.id !== 'string') continue;
      const facts = report.facts.filter(f => f.actor === 'player' && f.id === resource.id);
      const initial = resource.current ?? resource.start;
      const hasSupply = typeof initial === 'number' && initial > 0 || facts.some(f =>
        (f.kind === 'resource_delta' || f.kind === 'resource_set') && typeof f.value === 'number' && f.value > 0);
      const hasUse = facts.some(f => f.kind === 'resource_read' && f.resourceField === 'current'
        || f.kind === 'resource_payment' && (f.value === 'all' || typeof f.value === 'number' && f.value > 0)
        || f.kind === 'resource_delta' && typeof f.value === 'number' && f.value < 0);
      if (hasSupply && !hasUse) report.observations.push({ code: 'NO_OWNED_RESOURCE_USE',
        path: ['registry', 'resources', index], actor: 'player', id: resource.id });
    }
  }
  return report;
}
