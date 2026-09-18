import { validateCombatResourceDefinitions } from './combatResource';
import { resolveInitialCardReference } from './initialCardReference';
import { INITIAL_DRAFT_SPEC, INITIAL_DRAFT_ROOT_FIELDS, collectInitialDraftEnvelopeIssues } from './initialDraftEnvelope';

export { INITIAL_DRAFT_SPEC } from './initialDraftEnvelope';
type JsonObject = Record<string, any>;
export type DraftPath = Array<string | number>;
export type DraftRegistryKind = 'statuses' | 'resources' | 'templates';
export interface InitialDraftDiagnostic {
  code: 'INVALID_DRAFT' | 'UNKNOWN_FIELD' | 'INVALID_REGISTRY' | 'INVALID_DEFINITION_ID'
    | 'DUPLICATE_DEFINITION' | 'INLINE_DEFINITION' | 'UNKNOWN_STATUS_REF' | 'UNKNOWN_RESOURCE_REF'
    | 'UNKNOWN_TEMPLATE_REF' | 'INVALID_REFERENCE' | 'TEMPLATE_CYCLE' | 'UNSUPPORTED_TEMPLATE_OWNER';
  owner: DraftPath;
  path: DraftPath;
  ref?: string;
  relatedPath?: DraftPath;
  /** Only a central-registry reference can be repaired by a registry addition. */
  repairRegistry?: DraftRegistryKind;
  message: string;
}
export interface InitialDraft {
  spec: typeof INITIAL_DRAFT_SPEC;
  narrative: string;
  player: JsonObject;
  opening: JsonObject;
  registry: { statuses: JsonObject[]; resources: JsonObject[]; templates: JsonObject[] };
}
export interface CompiledInitialDraft {
  narrative: string;
  player: JsonObject;
  opening: JsonObject;
}
export type InitialDraftCompilation =
  | { ok: true; value: CompiledInitialDraft; diagnostics: [] }
  | { ok: false; diagnostics: InitialDraftDiagnostic[] };

const isRecord = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const PRESENTATION_FIELDS = new Set(['id', 'name', 'emoji', 'description', 'source', 'narrate', '$meta']);
const TEMPLATE_OPERATIONS = new Set(['add_card', 'ensure_card', 'transform_card']);
const STATUS_OPERATIONS = new Set(['apply_status', 'remove_status']);
const STATUS_SELECTORS = new Set(['all', 'buffs', 'debuffs']);
const compareIds = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/**
 * Compile a registry draft to the EXISTING initial-response representation.
 * This is not a gameplay validator or a commit. The caller must still run the
 * authoritative content/opening/readiness checks before persisting any data.
 * Registry resources explicitly define the initial PLAYER pool; summon/enemy
 * pools remain local canonical data in v1. No mechanics are inferred from prose.
 */
export function compileInitialDraftToMvu(input: unknown): InitialDraftCompilation {
  return compileInitialDraft(input);
}

/**
 * Diagnostic-only preview. Missing references must not hide independent rule
 * errors before the one repair request is planned. The preview contains ONLY
 * authored/resolved definitions: absent definitions are never fabricated.
 * A preview is not a successful compilation and is never returned as content.
 * Callers must still compile and validate the repaired draft for publication.
 */
export function inspectInitialDraft<T>(input: unknown,
  inspectRules: (preview: CompiledInitialDraft) => readonly T[],
): { references: InitialDraftDiagnostic[]; rules: T[]; inspected: boolean } {
  let rules: T[] = [];
  let inspected = false;
  const compilation = compileInitialDraft(input, preview => {
    inspected = true;
    rules = [...inspectRules(preview)];
  });
  return { references: compilation.ok ? [] : compilation.diagnostics, rules, inspected };
}

/** Deliberately NOT CompiledInitialDraft: every fragment may be missing or
 * malformed. Consumers may inspect independently usable authored regions but
 * must not treat this view as publishable content or fabricate missing peers.
 */
export interface InitialDraftFragments {
  narrative: unknown;
  player: unknown;
  opening: unknown;
}

export function inspectInitialDraftFragments<T>(input: unknown,
  inspectFragments: (fragments: InitialDraftFragments) => readonly T[],
): { references: InitialDraftDiagnostic[]; rules: T[]; inspected: boolean } {
  let rules: T[] = [];
  let inspected = false;
  const compilation = compileInitialDraft(input, undefined, fragments => {
    inspected = true;
    rules = [...inspectFragments(fragments)];
  });
  return { references: compilation.ok ? [] : compilation.diagnostics, rules, inspected };
}

function compileInitialDraft(input: unknown,
  inspectRules?: (preview: CompiledInitialDraft) => void,
  inspectFragments?: (fragments: InitialDraftFragments) => void,
): InitialDraftCompilation {
  const diagnostics: InitialDraftDiagnostic[] = [];
  const issue = (code: InitialDraftDiagnostic['code'], owner: DraftPath, path: DraftPath, message: string,
    ref?: string, relatedPath?: DraftPath, repairRegistry?: DraftRegistryKind): void => {
    diagnostics.push({ code, owner: [...owner], path: [...path], message,
      ...(ref === undefined ? {} : { ref }), ...(relatedPath ? { relatedPath: [...relatedPath] } : {}),
      ...(repairRegistry ? { repairRegistry } : {}) });
  };
  const envelopeIssues = collectInitialDraftEnvelopeIssues(input);
  for (const error of envelopeIssues) issue('INVALID_DRAFT', [], error.path, error.message);
  if (!isRecord(input)) return { ok: false, diagnostics };
  for (const key of Object.keys(input)) {
    if (!(INITIAL_DRAFT_ROOT_FIELDS as readonly string[]).includes(key)) issue('UNKNOWN_FIELD', [], [key], '草稿根字段不受支持');
  }
  // A malformed player/opening container must not hide independently
  // checkable registry faults from the single repair planner. Never invent
  // containers or run reference expansion on an invalid envelope.
  if (!isRecord(input.registry)) {
    // No reference expansion is possible, but independent authored effects
    // still need diagnosis before the caller spends its only repair request.
    // Keep fragments raw: no fabricated registry, statuses or resource pool.
    inspectFragments?.(structuredClone({ narrative: input.narrative, player: input.player, opening: input.opening }));
    return { ok: false, diagnostics };
  }
  for (const key of Object.keys(input.registry)) {
    if (!['statuses', 'resources', 'templates'].includes(key)) issue('UNKNOWN_FIELD', ['registry'], ['registry', key], '定义库字段不受支持');
  }
  const registry: Record<DraftRegistryKind, Map<string, { value: JsonObject; path: DraftPath }>> = {
    statuses: new Map(), resources: new Map(), templates: new Map(),
  };
  for (const kind of ['statuses', 'resources', 'templates'] as const) {
    const definitions = input.registry[kind];
    if (!Array.isArray(definitions) || definitions.length > (kind === 'resources' ? 16 : 128)) {
      issue('INVALID_REGISTRY', ['registry', kind], ['registry', kind], '定义库必须是有界数组');
      continue;
    }
    definitions.forEach((definition, index) => {
      const path: DraftPath = ['registry', kind, index];
      const pattern = kind === 'templates' ? /^[A-Za-z_][A-Za-z0-9_-]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/;
      if (!isRecord(definition) || typeof definition.id !== 'string' || !pattern.test(definition.id)) {
        issue('INVALID_DEFINITION_ID', path, [...path, 'id'], '定义需要稳定英文 ID');
        return;
      }
      const previous = registry[kind].get(definition.id);
      if (previous) issue('DUPLICATE_DEFINITION', path, [...path, 'id'], '同一 ID 只能定义一次', definition.id, previous.path);
      else registry[kind].set(definition.id, { value: structuredClone(definition), path });
    });
  }
  if (Array.isArray(input.registry.resources)) {
    validateCombatResourceDefinitions(input.registry.resources, 'resources', (error, relativePath) => {
      // Locations originate at validation, never by parsing display messages.
      const owner: DraftPath = ['registry', 'resources', ...relativePath.slice(0, 1)];
      issue('INVALID_REGISTRY', owner, ['registry', 'resources', ...relativePath], `${error.code}: ${error.message}`);
    });
  }
  const candidate: CompiledInitialDraft = {
    narrative: input.narrative, player: structuredClone(input.player), opening: structuredClone(input.opening),
  };
  const playerResources = new Set(registry.resources.keys());
  let visitedNodes = 0;
  let exhausted = false;
  const rejectInline = (object: JsonObject, path: DraftPath, keys: string[]): void => {
    if (!isRecord(object)) return;
    for (const key of keys) {
      if (object[key] !== undefined) issue('INLINE_DEFINITION', path, [...path, key], '草稿定义只能放在 registry，不能在内容中重复登记');
    }
  };
  rejectInline(candidate.player, ['player'], ['statuses']);
  rejectInline(candidate.player?.core, ['player', 'core'], ['resources']);

  // Each closure is a separate eventual ownership domain. Reward-only status
  // definitions must not leak into the initial player library before selection.
  interface Closure { statuses: Set<string>; pending: string[] }
  interface ResourceScope { local: Set<string> | null; summoner: Set<string> | null }
  const initialResourceScope: ResourceScope = { local: playerResources, summoner: null };
  const addStatus = (id: unknown, path: DraftPath, owner: DraftPath, closure: Closure): void => {
    if (typeof id !== 'string' || STATUS_SELECTORS.has(id)) return;
    if (!registry.statuses.has(id)) {
      issue('UNKNOWN_STATUS_REF', owner, path, '状态引用没有定义', id, undefined, 'statuses');
      return;
    }
    if (!closure.statuses.has(id)) { closure.statuses.add(id); closure.pending.push(id); }
  };
  const addResource = (id: string, path: DraftPath, owner: DraftPath, scope: Set<string> | null): void => {
    // Opponents/selected summons are runtime identities, not the player pool.
    if (id !== 'energy' && scope !== null && !scope.has(id))
      issue('UNKNOWN_RESOURCE_REF', owner, path, '当前资源归属没有此定义', id, undefined, scope === playerResources ? 'resources' : undefined);
  };

  const processOwner = (owner: JsonObject, ownerPath: DraftPath, closure: Closure, scope: ResourceScope,
    allowTemplates = true, expansionStack: string[] = []): void => {
    rejectInline(owner, ownerPath, ['creates', 'statuses']);
    const templates = new Map<string, JsonObject>();
    const loadTemplate = (id: string, path: DraftPath, stack: string[]): void => {
      if (!allowTemplates) {
        issue('UNSUPPORTED_TEMPLATE_OWNER', ownerPath, path, '此内容没有 creates 容器，不能引用临时牌模板', id);
        return;
      }
      if (stack.includes(id)) {
        issue('TEMPLATE_CYCLE', ownerPath, path, '临时牌模板不能循环生成', id);
        return;
      }
      if (templates.has(id)) return;
      const definition = registry.templates.get(id);
      if (!definition) { issue('UNKNOWN_TEMPLATE_REF', ownerPath, path, '临时牌模板引用没有定义', id, undefined, 'templates'); return; }
      const copy = structuredClone(definition.value);
      rejectInline(copy, definition.path, ['creates', 'statuses']);
      // Generated cards always enter the player's card zones, even when the
      // producer is a summon action. Their later costs and formulas therefore
      // resolve against player resources; the producing summon itself remains
      // under its local resource scope in the surrounding walk.
      // Visit before caching so a transitive cycle cannot hide in the cache.
      walk(copy, definition.path, [...stack, id], initialResourceScope);
      templates.set(id, copy);
    };
    const walk = (value: unknown, path: DraftPath, stack: string[], resourceScope: ResourceScope): void => {
      if (exhausted) return;
      if (++visitedNodes > 100_000 || path.length > 128 || stack.length > 32) {
        exhausted = true;
        issue('INVALID_DRAFT', ownerPath, path, '草稿展开超过安全深度或节点上限');
        return;
      }
      if (typeof value === 'string') {
        // These are exact canonical formula identifiers, not diagnostic prose.
        for (const match of value.matchAll(/\b(?:self|opponent)\.status\.([A-Za-z_][A-Za-z0-9_]*)\.stacks\b/g)) addStatus(match[1], path, ownerPath, closure);
        for (const match of value.matchAll(/\bevent_status_is\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\)/g)) addStatus(match[2], path, ownerPath, closure);
        for (const match of value.matchAll(/\bself\.resource\.([A-Za-z_][A-Za-z0-9_]*)\.(?:current|max)\b|\b(?:spent_resource|x_resource)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
          addResource(match[1] || match[2], path, ownerPath, resourceScope.local);
        }
        return;
      }
      if (Array.isArray(value)) { value.forEach((child, i) => walk(child, [...path, i], stack, resourceScope)); return; }
      if (!isRecord(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (PRESENTATION_FIELDS.has(key) || ['creates', 'statuses', 'resources'].includes(key)) continue;
        const childPath = [...path, key];
        if (TEMPLATE_OPERATIONS.has(key)) {
          if (typeof child === 'string') loadTemplate(child, childPath, stack);
          else issue('INVALID_REFERENCE', ownerPath, childPath, '模板操作需要明确的 ID 字符串');
          continue;
        }
        if (STATUS_OPERATIONS.has(key)) {
          if (typeof child === 'string') addStatus(child, childPath, ownerPath, closure);
          else issue('INVALID_REFERENCE', ownerPath, childPath, '状态操作需要明确的 ID 字符串');
        }
        if (['apply_summon_status', 'remove_summon_status'].includes(key) && isRecord(child)) addStatus(child.id, [...childPath, 'id'], ownerPath, closure);
        if (key === 'cost' && isRecord(child)) {
          Object.keys(child).forEach(id => addResource(id, [...childPath, id], ownerPath, resourceScope.local));
        }
        if (['resource', 'set_resource'].includes(key) && isRecord(child) && typeof child.id === 'string') {
          addResource(child.id, [...childPath, 'id'], ownerPath, value.to === undefined || value.to === 'self' ? resourceScope.local : null);
        }
        if (key === 'summoner_effects') {
          walk(child, childPath, stack, { local: resourceScope.summoner, summoner: null });
          continue;
        }
        if ((key === 'spawn_summon' || key === 'spawn_enemy') && isRecord(child)) {
          const nested = key === 'spawn_summon'
            ? new Set(isRecord(child.resources) ? Object.keys(child.resources) : [])
            : new Set(Array.isArray(child.resources) ? child.resources.map((r: any) => r?.id).filter((id: unknown): id is string => typeof id === 'string') : []);
          const nestedScope: ResourceScope = { local: nested, summoner: key === 'spawn_summon' ? resourceScope.local : null };
          for (const field of ['actions', 'abilities'] as const) {
            if (Array.isArray(child[field])) child[field].forEach((content: unknown, i: number) => {
              if (isRecord(content)) processOwner(content, [...childPath, field, i], closure, nestedScope, true, stack);
            });
          }
          if (isRecord(child.lust_effect)) processOwner(child.lust_effect, [...childPath, 'lust_effect'], closure, nestedScope, true, stack);
          for (const [field, entry] of Object.entries(child)) {
            if (!PRESENTATION_FIELDS.has(field) && !['actions', 'abilities', 'lust_effect', 'resources'].includes(field)) walk(entry, [...childPath, field], stack, nestedScope);
          }
          continue;
        }
        if (key === 'status_effects' || key === 'player_status_effects') {
          if (Array.isArray(child)) child.forEach((active, i) => { if (isRecord(active)) addStatus(active.id, [...childPath, i, 'id'], ownerPath, closure); });
        }
        walk(child, childPath, stack, resourceScope);
      }
    };
    walk(owner, ownerPath, expansionStack, scope);
    if (templates.size) owner.creates = [...templates.entries()].sort(([a], [b]) => compareIds(a, b)).map(([, template]) => template);
  };
  const finishClosure = (closure: Closure): JsonObject[] => {
    const processed = new Map<string, JsonObject>();
    while (closure.pending.length) {
      const id = closure.pending.shift()!;
      if (processed.has(id)) continue;
      const definition = registry.statuses.get(id)!;
      const copy = structuredClone(definition.value);
      // A status may be held by either side. Do not silently assume the player
      // owns its resources. Full runtime content validation follows compilation.
      processOwner(copy, definition.path, closure, { local: null, summoner: null });
      processed.set(id, copy);
    }
    return [...processed.entries()].sort(([a], [b]) => compareIds(a, b)).map(([, value]) => value);
  };
  const playerClosure: Closure = { statuses: new Set(), pending: [] };
  if (isRecord(candidate.player?.core)) processOwner(candidate.player.core, ['player', 'core'], playerClosure, initialResourceScope, false);
  for (const field of ['cards', 'artifacts', 'items', 'player_abilities'] as const) {
    if (Array.isArray(candidate.player?.[field])) candidate.player[field].forEach((owner: unknown, i: number) => {
      if (isRecord(owner)) processOwner(owner, ['player', field, i], playerClosure, initialResourceScope);
    });
  }
  if (isRecord(candidate.player?.player_lust_effect)) processOwner(candidate.player.player_lust_effect, ['player', 'player_lust_effect'], playerClosure, initialResourceScope);
  for (const [i, active] of (Array.isArray(candidate.player?.player_status_effects) ? candidate.player.player_status_effects : []).entries()) {
    if (isRecord(active)) addStatus(active.id, ['player', 'player_status_effects', i, 'id'], ['player'], playerClosure);
  }
  const playerStatuses = finishClosure(playerClosure);
  if (isRecord(candidate.player)) candidate.player.statuses = playerStatuses;
  if (isRecord(candidate.player?.core)) candidate.player.core.resources = [...registry.resources.values()].sort((a, b) => compareIds(a.value.id, b.value.id)).map(entry => structuredClone(entry.value));
  if (Array.isArray(candidate.opening?.choices)) candidate.opening.choices.forEach((choice: unknown, choiceIndex: number) => {
    if (!isRecord(choice) || !isRecord(choice.outcome)) return;
    if (Array.isArray(choice.outcome.deck_transforms)) choice.outcome.deck_transforms.forEach((action: unknown, index: number) => {
      if (!isRecord(action) || !isRecord(action.replacement)) return;
      const owner = action.replacement;
      const path: DraftPath = ['opening', 'choices', choiceIndex, 'outcome', 'deck_transforms', index, 'replacement'];
      rejectInline(owner, path, ['status']);
      const closure: Closure = { statuses: new Set(), pending: [] };
      processOwner(owner, path, closure, initialResourceScope);
      const statuses = finishClosure(closure).filter(status => !playerClosure.statuses.has(status.id));
      if (statuses.length) owner.statuses = statuses;
    });
    if (!isRecord(choice.outcome.reward)) return;
    const reward = choice.outcome.reward;
    const rewardPath: DraftPath = ['opening', 'choices', choiceIndex, 'outcome', 'reward'];
    rejectInline(reward, rewardPath, ['status', 'statuses', 'creates']);
    for (const field of ['cards', 'artifacts', 'items'] as const) {
      if (!Array.isArray(reward[field])) continue;
      reward[field].forEach((entry: unknown, i: number) => {
        let owner = entry;
        if (!isRecord(owner)) return;
        const path = [...rewardPath, field, i];
        // An explicit draft-only reference copies authored mechanics, not prose
        // or a heuristic match. Resolve from the unexpanded player definition so
        // the ordinary status/template closure below runs exactly once per owner.
        if (field === 'cards' && Object.hasOwn(owner, 'card_ref')) {
          // Its source container is already diagnosed. Do not reinterpret an
          // unavailable card library as an empty library/missing identity.
          if (!Array.isArray(input.player?.cards)) return;
          const resolved = resolveInitialCardReference(owner, input.player.cards);
          if (!resolved) {
            issue('INVALID_REFERENCE', path, [...path, 'card_ref'],
              '馈赠卡牌引用必须仅含 card_ref 和 1..100 整数 quantity，并指向本次 player.cards 中唯一完整定义');
            return;
          }
          owner = resolved;
          reward[field][i] = owner;
        }
        if (!isRecord(owner)) return;
        rejectInline(owner, path, ['status']);
        const closure: Closure = { statuses: new Set(), pending: [] };
        processOwner(owner, path, closure, initialResourceScope);
        const statuses = finishClosure(closure).filter(status => !playerClosure.statuses.has(status.id));
        if (statuses.length) owner.statuses = statuses;
      });
    }
  });
  // The explicitly partial diagnostic boundary receives original missing/bad
  // containers unchanged. It cannot authorize successful compilation. The
  // full rule preview below remains unavailable for an invalid envelope.
  inspectFragments?.(structuredClone(candidate));
  if (envelopeIssues.length) return { ok: false, diagnostics };
  // A diagnostic consumer cannot mutate the compiler's result or source.
  // Deliberately do not catch validator exceptions and reinterpret them as a
  // clean report. Invalid envelopes above never reach this preview boundary.
  inspectRules?.(structuredClone(candidate));
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, value: candidate, diagnostics: [] };
}
