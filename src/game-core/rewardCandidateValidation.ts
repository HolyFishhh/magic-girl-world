import { expandBuiltinStatusDefinitions } from './builtinStatusCatalog';
import { ABILITY_TRIGGER_SET } from './battleTriggers';
import { compileCompactEffectList } from './compactEffectDsl';
import { isCompactEffectList } from './compactEffectContract';
import {
  collectCompactStatusDefinitionIssues,
  collectCompactStatusDefinitionReferences,
  collectEffectProgramStatusReferences,
} from './statusDefinitionValidation';
import { CARD_RARITY_SET, CARD_TYPE_SET, RELIC_RARITY_SET } from './contentCatalog';
import { validateEffectProgramPolicy } from './effectProgramPolicy';
import { resolveTriggerInput } from './triggerInput';
import type { EffectProgram } from './effectDsl';
import { normalizeCardCost, validateCardCost } from './combatResource';
import { createContentPack } from './contentPack';
import { validateContentPackContract, type ContentContractIssue } from './contentContract';
import { validateArtifactAcquisitionContract } from './artifactAcquisitionValidation';

export type RewardCandidateCategory = 'cards' | 'artifacts' | 'items';

export type RewardCandidateValidationResult = { ok: true } | { ok: false; message: string };

export type RewardCandidateSupportStatusesResult =
  | { ok: true; statuses: Record<string, unknown>[] }
  | { ok: false; message: string };

export interface RewardCandidateLibrary {
  /** Owner-level overflow effect: a reward is not an independent character. */
  playerDesireEffect?: unknown;
  existing?: readonly unknown[];
  knownStatusIds?: Iterable<string>;
  statusDefinitions?: readonly unknown[];
  knownResourceIds?: Iterable<string>;
}

/**
 * Run the shared content contract against one reward candidate and return all
 * independently discoverable structural issues. The ordinary validator below
 * still owns library identity and cross-reference rules; this pass prevents a
 * repair request from seeing only the first malformed field in the same card.
 */
export function collectRewardCandidateContractIssues(
  category: RewardCandidateCategory,
  value: unknown,
  library: RewardCandidateLibrary = {},
): string[] {
  return collectRewardCandidateTypedContractIssues(category, value, library)
    .map(issue => issue.code === 'INVALID_SUPPORT_STATUSES' ? issue.message : `${issue.path}: ${issue.message}`);
}

/** Structured counterpart for pre-repair source mapping; no message parsing. */
export function collectRewardCandidateTypedContractIssues(
  category: RewardCandidateCategory,
  value: unknown,
  library: RewardCandidateLibrary = {},
): ContentContractIssue[] {
  if (!isRecord(value)) return [];
  const candidate = structuredClone(value);
  const supportStatuses = readRewardCandidateSupportStatuses(candidate, library.statusDefinitions);
  delete candidate.status;
  delete candidate.statuses;
  if (category === 'cards' && (candidate.quantity === undefined || candidate.quantity === 0)) candidate.quantity = 1;
  if (category === 'items' && candidate.count === undefined) candidate.count = 1;
  // Existing status definitions belong to the persistent library and are
  // validated once by its ordinary content pass. Re-inserting all of them
  // into every candidate pack duplicated one unrelated global error for each
  // reward. Only the candidate-owned support status is validated here; all
  // other definitions remain reference-resolution and traversal context.
  const statuses = supportStatuses.ok ? supportStatuses.statuses : [];
  const knownStatusIds = new Set([
    ...(library.knownStatusIds || []),
    ...(library.statusDefinitions || [])
      .filter(isRecord)
      .map(definition => definition.id)
      .filter((id): id is string => typeof id === 'string'),
  ]);
  const pack = createContentPack({
    knownStatusIds,
    playerDesireEffect: library.playerDesireEffect,
    cards: category === 'cards' ? [candidate] : [],
    statuses,
    relics: category === 'artifacts' ? [candidate] : [],
    items: category === 'items' ? [candidate] : [],
  });
  const result = validateContentPackContract(pack, {
    requireExecutable: true, knownStatusIds,
    knownResourceIds: library.knownResourceIds,
    referenceStatusDefinitions: library.statusDefinitions,
  });
  const issues: ContentContractIssue[] = supportStatuses.ok ? [] : [{ path: 'statuses', code: 'INVALID_SUPPORT_STATUSES', message: supportStatuses.message }];
  if (!result.ok) issues.push(...result.issues);
  return issues;
}

/** Read the amount granted by one reward candidate. AI card candidates commonly use 0 to mean "not owned yet". */
export function readRewardCandidateQuantity(category: RewardCandidateCategory, value: unknown): number | null {
  if (!isRecord(value)) return null;
  if (category === 'artifacts') return 1;

  const raw = category === 'items' ? value.count : value.quantity;
  if (raw === undefined || raw === null || raw === '') return 1;
  const quantity = Number(raw);
  if (category === 'cards' && quantity === 0) return 1;
  const maximum = category === 'items' ? 999 : 100;
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= maximum ? quantity : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(message: string): RewardCandidateValidationResult {
  return { ok: false, message };
}

/**
 * Read the candidate-owned status library. `status` remains accepted for old
 * cards while new generators can close any finite status dependency graph in
 * `statuses`. Equal duplicate ids are harmless and collapse to one definition;
 * conflicting duplicates are rejected before anything reaches persistent MVU.
 */
export function readRewardCandidateSupportStatuses(value: unknown, referenceDefinitions: readonly unknown[] = []): RewardCandidateSupportStatusesResult {
  if (!isRecord(value)) return { ok: true, statuses: [] };
  const entries: Array<{ definition: Record<string, unknown>; path: string }> = [];
  if (value.status !== undefined) {
    if (!isRecord(value.status)) return { ok: false, message: '候选 status 必须是一个状态定义对象' };
    entries.push({ definition: structuredClone(value.status), path: 'status' });
  }
  if (value.statuses !== undefined) {
    if (!Array.isArray(value.statuses) || value.statuses.length < 1 || value.statuses.length > 16) {
      return { ok: false, message: '候选 statuses 必须是包含 1..16 个状态定义对象的数组' };
    }
    for (let index = 0; index < value.statuses.length; index += 1) {
      const status = value.statuses[index];
      if (!isRecord(status)) return { ok: false, message: `候选 statuses[${index}] 必须是状态定义对象` };
      entries.push({ definition: structuredClone(status), path: `statuses[${index}]` });
    }
  }
  if (entries.length > 16) return { ok: false, message: '候选最多只能携带 16 个状态定义' };

  const statuses = new Map<string, Record<string, unknown>>();
  for (let index = 0; index < entries.length; index += 1) {
    const { definition: status, path } = entries[index];
    const validationIssues = collectCompactStatusDefinitionIssues(status);
    if (validationIssues.length > 0) {
      return {
        ok: false,
        message: validationIssues.map(message => `候选 ${path} 无效: ${message}`).join('；'),
      };
    }
    const id = String(status.id);
    const existing = statuses.get(id);
    if (existing && !rewardStatusDefinitionsEqual(existing, status)) {
      return { ok: false, message: `候选状态 ${id} 重复但规则不同` };
    }
    if (!existing) statuses.set(id, status);
  }
  return { ok: true, statuses: expandBuiltinStatusDefinitions(Array.from(statuses.values()), value, referenceDefinitions.filter(isRecord).map(definition => String(definition.id))) };
}

function compactPrograms(value: Record<string, unknown>): unknown[] {
  const programs: unknown[] = [];
  const resolved = resolveTriggerInput(value);
  if (resolved.structured) {
    for (const [effects, trigger] of [
      [resolved.immediateEffects, undefined],
      [resolved.triggeredEffects, value.type === 'Power' ? resolved.trigger : undefined],
    ] as const) {
      if (!isCompactEffectList(effects)) continue;
      const compiled = compileCompactEffectList(effects, { trigger, creates: value.creates });
      if (compiled.ok) programs.push(compiled.value);
    }
  }
  for (const [field, trigger] of [
    ['effects', resolved.structured ? undefined : value.trigger],
    ['discard_effects', undefined],
  ] as const) {
    if (field === 'effects' && resolved.structured) continue;
    if (!isCompactEffectList(value[field])) continue;
    const compiled = compileCompactEffectList(value[field], {
      trigger: field === 'effects' && value.type === 'Power' ? trigger : undefined,
      when: field === 'effects' ? value.when : undefined,
      creates: value.creates,
    });
    if (compiled.ok) programs.push(compiled.value);
  }
  return programs;
}

function comparableDefinition(value: Record<string, unknown>): string {
  const ignored = new Set([
    'quantity',
    'count',
    'price',
    'status',
    'statuses',
    'description',
    'upgrade_level',
    '$meta',
    // Persistent tower decks store one owned instance per record. These fields
    // describe ownership, not card rules, and must not split an otherwise
    // identical reward definition.
    'runInstanceId',
    'templateId',
    'origin',
    'parentRunInstanceId',
  ]);
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (!isRecord(entry)) return entry;
    return Object.fromEntries(
      Object.keys(entry)
        .filter(key => !ignored.has(key))
        .sort()
        .map(key => [key, normalize(entry[key])]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function rewardStatusDefinitionsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const normalizeTriggerLists = (definition: Record<string, unknown>): Record<string, unknown> => {
    if (!isRecord(definition.triggers)) return definition;
    return {
      ...definition,
      triggers: Object.fromEntries(Object.entries(definition.triggers).map(([trigger, effects]) => [
        trigger,
        isRecord(effects) ? [effects] : effects,
      ])),
    };
  };
  return comparableDefinition(normalizeTriggerLists(left)) === comparableDefinition(normalizeTriggerLists(right));
}

function hasValidIdentity(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    /^[a-z_][a-z0-9_-]*$/i.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0
  );
}

function validateEffects(
  value: Record<string, unknown>,
  options: {
    trigger?: unknown;
    when?: unknown;
    creates?: unknown;
    allowModifiers?: boolean;
    power?: boolean;
    allowSpentEnergy?: boolean;
    allowXValue?: boolean;
    allowSpentResources?: ReadonlySet<string>;
    allowXResources?: ReadonlySet<string>;
    allowCardDestination?: boolean;
    allowCurrentCardReplay?: boolean;
    allowMissing?: boolean;
  } = {},
): RewardCandidateValidationResult {
  for (const field of ['effect', 'effect_program', 'effectProgram']) {
    if (Object.prototype.hasOwnProperty.call(value, field)) return failure(`${field} 已移除，请使用浅层 effects`);
  }
  const resolved = resolveTriggerInput(value);
  const sources = resolved.structured
    ? [
        [resolved.immediateEffects, undefined],
        // A Power registers its trigger when played. Relics and abilities are
        // already owned trigger sources, so their body is validated directly.
        [resolved.triggeredEffects, options.power ? resolved.trigger : undefined],
      ] as const
    : [[value.effects, options.trigger]] as const;
  const programs: EffectProgram[] = [];
  for (const [effects, trigger] of sources) {
    if (effects === undefined) continue;
    if (!isCompactEffectList(effects)) return failure('必须提供浅层 effects');
    const compiled = compileCompactEffectList(effects, {
      trigger,
      when: trigger ? undefined : options.when,
      creates: options.creates,
    });
    if (!compiled.ok) {
      const issue = compiled.issues[0];
      return failure(`${issue.path}: ${issue.message}`);
    }
    programs.push(compiled.value);
  }
  if (programs.length === 0) return options.allowMissing ? { ok: true } : failure('必须提供浅层 effects');
  const combined: EffectProgram = { spec: 'mwg.effect/v1', steps: programs.flatMap(program => program.steps) };
  const encoded = JSON.stringify(combined);
  if (encoded.includes('context.status_stacks')) return failure('stacks 只允许用于状态 triggers');
  const policy = validateEffectProgramPolicy(combined, {
    // All reward candidates execute as player-owned content after acquisition.
    allowPersistentGrowth: true,
    triggerPolicy: options.power ? 'require_root_or_status' : 'forbid',
    // A passive trigger is compiled as a root register_trigger node. The
    // shared policy automatically validates its nested program with the
    // modifier-only grammar while immediate siblings remain modifier-free.
    modifierPolicy: options.power ? 'forbid' : options.allowModifiers ? 'only' : 'forbid',
    allowSpentEnergy: options.allowSpentEnergy,
    allowXValue: options.allowXValue,
    allowSpentResources: options.allowSpentResources,
    allowXResources: options.allowXResources,
    allowCardDestination: options.allowCardDestination,
    allowCurrentCardReplay: options.allowCurrentCardReplay,
  });
  if (!policy.ok) return failure(`${policy.issues[0].path}: ${policy.issues[0].message}`);
  return { ok: true };
}

function validateArtifactAcquisition(
  value: Record<string, unknown>,
  library?: RewardCandidateLibrary,
): RewardCandidateValidationResult {
  if (value.on_acquire === undefined) return { ok: true };
  const message = validateArtifactAcquisitionContract(value, {
    knownResourceIds: library?.knownResourceIds,
    validateCandidate: (category, candidate) => {
      const result = library
        ? validateRewardCandidateAgainstLibrary(category, candidate, library)
        : validateRewardCandidate(category, candidate);
      return result.ok ? null : result.message;
    },
  });
  return message ? failure(message) : { ok: true };
}

/** Validate an AI reward before it is committed to persistent MUV state. */
export function validateRewardCandidate(
  category: RewardCandidateCategory,
  value: unknown,
): RewardCandidateValidationResult {
  if (!isRecord(value) || !hasValidIdentity(value)) return failure('候选项必须有合法且稳定的 id/name');

  if (category === 'cards') {
    const type = String(value.type ?? 'Skill');
    const rarity = String(value.rarity ?? 'Common');
    if (!CARD_TYPE_SET.has(type) || !CARD_RARITY_SET.has(rarity)) {
      return failure('卡牌 type/rarity 无效');
    }
    if (readRewardCandidateQuantity(category, value) === null) return failure('卡牌 quantity 必须是 0..100');
    if (Object.prototype.hasOwnProperty.call(value, 'discard_requirement')) {
      return failure('卡牌 discard_requirement 已移除');
    }
    if (type === 'Curse') {
      if (value.cost !== undefined) return failure('Curse 不得包含 cost');
    } else if (validateCardCost(value.cost ?? 0)) {
      return failure('卡牌 cost 必须是非负整数、energy 或合法资源费用对象');
    }
    const triggerInput = resolveTriggerInput(value);
    const trigger = type === 'Power' ? triggerInput.trigger : undefined;
    if (type !== 'Power' && value.trigger !== undefined) return failure('只有 Power 可以提供 trigger');
    for (const flag of ['retain', 'exhaust', 'ethereal', 'innate', 'sly']) {
      if (value[flag] !== undefined && typeof value[flag] !== 'boolean') return failure(`卡牌 ${flag} 必须是布尔值`);
    }
    const costComponents = normalizeCardCost((value.cost ?? 0) as any);
    const main = validateEffects(value, {
      trigger,
      when: value.when,
      creates: value.creates,
      power: type === 'Power',
      allowModifiers: trigger === 'passive',
      allowSpentEnergy: Object.prototype.hasOwnProperty.call(costComponents, 'energy'),
      allowXValue: costComponents.energy === 'all',
      allowSpentResources: new Set(Object.keys(costComponents)),
      allowXResources: new Set(Object.entries(costComponents).filter(([, component]) => component === 'all').map(([id]) => id)),
      allowCardDestination: type !== 'Event',
      allowCurrentCardReplay: type !== 'Power' && type !== 'Event',
      allowMissing: type === 'Curse',
    });
    if (!main.ok) return main;
    if (Object.prototype.hasOwnProperty.call(value, 'discard_effect')) {
      return failure('discard_effect 已移除，请使用浅层 discard_effects');
    }
    if (value.discard_effects !== undefined) {
      const discard = validateEffects(
        { effects: value.discard_effects, creates: value.creates },
        { creates: value.creates },
      );
      if (!discard.ok) return failure(`discard_effects: ${discard.message}`);
    }
    return { ok: true };
  }

  if (category === 'artifacts') {
    if (!RELIC_RARITY_SET.has(String(value.rarity ?? 'Common'))) return failure('遗物 rarity 无效');
    const triggerInput = resolveTriggerInput(value);
    const hasTrigger = typeof triggerInput.trigger === 'string' && ABILITY_TRIGGER_SET.has(triggerInput.trigger);
    if (value.trigger !== undefined && !hasTrigger) return failure('浅层遗物 trigger 无效');
    if (!hasTrigger && value.on_acquire === undefined) {
      return failure('浅层遗物必须提供合法 trigger 或 on_acquire');
    }
    if (hasTrigger) {
      const effects = validateEffects(value, {
        when: value.when,
        creates: value.creates,
        allowModifiers: triggerInput.trigger === 'passive',
      });
      if (!effects.ok) return effects;
    }
    return validateArtifactAcquisition(value);
  }

  if (readRewardCandidateQuantity(category, value) === null) return failure('道具 count 必须是 1..999');
  if (value.trigger !== undefined) return failure('道具不得包含 trigger');
  return validateEffects(value, { when: value.when, creates: value.creates });
}

/** Validate references and identity against the persistent content library. */
export function validateRewardCandidateAgainstLibrary(
  category: RewardCandidateCategory,
  value: unknown,
  library: RewardCandidateLibrary,
): RewardCandidateValidationResult {
  const contractIssues = collectRewardCandidateContractIssues(category, value, library);
  if (contractIssues.length > 0) return failure(contractIssues.join('；'));
  const base = validateRewardCandidate(category, value);
  if (!base.ok || !isRecord(value)) return base;
  if (category === 'artifacts') {
    const acquisition = validateArtifactAcquisition(value, library);
    if (!acquisition.ok) return acquisition;
  }
  if (category === 'cards' && (library.existing || []).some(entry => isRecord(entry)
    && entry.id === value.id && (entry.unique === true || value.unique === true))) {
    return failure(`唯一卡牌“${value.name || value.id}”已持有，请提供其他奖励或明确强化原牌`);
  }

  if (library.knownResourceIds) {
    const knownResources = new Set(['energy', ...library.knownResourceIds]);
    if (category === 'cards') {
      const missingCostResources = Object.keys(normalizeCardCost((value.cost ?? 0) as any))
        .filter(id => !knownResources.has(id));
      if (missingCostResources.length > 0)
        return failure(`费用引用了未注册资源: ${missingCostResources.sort().join(', ')}`);
    }
    const missing = new Set<string>();
    type ResourceScope = { ids: ReadonlySet<string> | null; summoner?: ResourceScope; summon?: boolean };
    const playerScope: ResourceScope = { ids: knownResources };
    const requireResource = (id: string, scope: ResourceScope): void => {
      if (id !== 'energy' && scope.ids && !scope.ids.has(id)) missing.add(id);
    };
    const definitionIds = (resources: unknown): Set<string> => new Set(Array.isArray(resources)
      ? resources.filter(isRecord).map(resource => resource.id).filter((id): id is string => typeof id === 'string')
      : isRecord(resources) ? Object.keys(resources) : []);
    const visit = (entry: unknown, scope: ResourceScope): void => {
      if (typeof entry === 'string') {
        // Opponent resources are runtime identities. Nested actors resolve
        // self against their own pool, never the reward recipient's pool.
        for (const match of entry.matchAll(/\bself\.resource\.([A-Za-z_][A-Za-z0-9_]*)\.(?:current|max)/g)) {
          requireResource(match[1], scope);
        }
        return;
      }
      if (Array.isArray(entry)) {
        entry.forEach(value => visit(value, scope));
        return;
      }
      if (!isRecord(entry)) return;
      if ((entry.op === 'gain_resource' || entry.op === 'set_resource')
        && entry.target !== 'opponent' && typeof entry.resource === 'string') {
        requireResource(entry.resource, scope);
      }
      if ((entry.op === 'gain_summon_resource' || entry.op === 'set_summon_resource')
        && scope.summon && isRecord(entry.selector) && entry.selector.pick === 'source'
        && typeof entry.resource === 'string') requireResource(entry.resource, scope);
      // Spawned enemies carry authored effects, while summons carry compiled
      // programs. Both forms must retain their actor ownership boundary.
      for (const key of ['resource', 'set_resource'] as const) {
        const resource = entry[key];
        if (isRecord(resource) && typeof resource.id === 'string' && entry.to !== 'opponent')
          requireResource(resource.id, scope);
      }
      for (const [key, child] of Object.entries(entry)) {
        if (['name', 'description', 'emoji', 'id', 'resources'].includes(key)) continue;
        if (((entry.op === 'spawn_summon' && key === 'summon') || key === 'spawn_summon') && isRecord(child)) {
          visit(child, { ids: definitionIds(child.resources), summon: true,
            summoner: entry.target === 'opponent' || entry.to === 'opponent' ? { ids: null } : scope });
        } else if (((entry.op === 'spawn_enemy' && key === 'enemy') || key === 'spawn_enemy') && isRecord(child)) {
          visit(child, { ids: definitionIds(child.resources) });
        } else if ((entry.op === 'summoner_effects' && key === 'effects') || key === 'summoner_effects') {
          visit(child, scope.summoner ?? { ids: null });
        } else if ((['add_card', 'ensure_card'].includes(String(entry.op)) && key === 'card')
          || (entry.op === 'transform_cards' && key === 'replacement')) {
          visit(child, playerScope);
        } else {
          visit(child, scope);
        }
      }
    };
    compactPrograms(value).forEach(program => visit(program, playerScope));
    if (missing.size > 0) return failure(`引用了未注册资源: ${[...missing].sort().join(', ')}`);
  }

  const supportStatusesResult = readRewardCandidateSupportStatuses(value, library.statusDefinitions);
  if (!supportStatusesResult.ok) return failure(supportStatusesResult.message);
  const supportStatuses = supportStatusesResult.statuses;

  if (library.knownStatusIds || library.statusDefinitions || supportStatuses.length > 0) {
    const libraryDefinitions = (library.statusDefinitions || []).filter(isRecord);
    const localDefinitions = new Map(supportStatuses.map(definition => [String(definition.id), definition]));
    const known = new Set([
      ...(library.knownStatusIds || []),
      ...libraryDefinitions.map(definition => definition.id).filter((id): id is string => typeof id === 'string'),
      ...localDefinitions.keys(),
    ]);
    const directReferences = new Set<string>();
    compactPrograms(value).forEach(program => {
      collectEffectProgramStatusReferences(program as import('./effectDsl').EffectProgram).forEach(id => directReferences.add(id));
    });
    const definitionReferences = new Map<string, Set<string>>();
    const references = new Set(directReferences);
    for (const [id, definition] of localDefinitions) {
      const dependencies = collectCompactStatusDefinitionReferences(definition);
      definitionReferences.set(id, dependencies);
      dependencies.forEach(dependency => references.add(dependency));
    }
    const missing = [...references].filter(id => !known.has(id)).sort();
    if (missing.length > 0) return failure(`引用了未注册状态: ${missing.join(', ')}`);

    const reachable = new Set<string>();
    const pending = [...directReferences];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (!localDefinitions.has(id) || reachable.has(id)) continue;
      reachable.add(id);
      definitionReferences.get(id)?.forEach(dependency => pending.push(dependency));
    }
    const unused = [...localDefinitions.keys()].filter(id => !reachable.has(id)).sort();
    if (unused.length > 0) return failure(`候选 statuses 未被该候选引用: ${unused.join(', ')}`);

    for (const [supportId, supportStatus] of localDefinitions) {
      const existingDefinition = libraryDefinitions.find(definition => definition.id === supportId);
      if (
        existingDefinition &&
        !rewardStatusDefinitionsEqual(existingDefinition, supportStatus)
      ) {
        return failure(`状态定义 ID 已存在但规则不同: ${supportId}`);
      }
    }
  }

  const existing = (library.existing || []).filter(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.id === value.id,
  );
  if (existing.length > 1) {
    const definitions = new Set(existing.map(comparableDefinition));
    if (definitions.size > 1) return failure(`已有内容包含重复 ID: ${String(value.id)}`);
  }
  if (existing.length === 0) return { ok: true };
  if (category === 'artifacts') return failure(`遗物已持有: ${String(value.id)}`);
  if (comparableDefinition(existing[0]) !== comparableDefinition(value)) {
    return failure(`ID ${String(value.id)} 已存在但规则不同，请使用新 ID`);
  }
  return { ok: true };
}
