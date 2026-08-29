import { ABILITY_TRIGGER_SET } from './battleTriggers';
import { compileCompactEffectList } from './compactEffectDsl';
import { isCompactEffectList } from './compactEffectContract';
import {
  collectCompactStatusDefinitionReferences,
  collectEffectProgramStatusReferences,
  validateCompactStatusDefinition,
} from './statusDefinitionValidation';
import { CARD_RARITY_SET, CARD_TYPE_SET, RELIC_RARITY_SET } from './contentCatalog';
import { validateEffectProgramPolicy } from './effectProgramPolicy';
import { resolveTriggerInput } from './triggerInput';
import type { EffectProgram } from './effectDsl';
import { normalizeCardCost, validateCardCost } from './combatResource';

export type RewardCandidateCategory = 'cards' | 'artifacts' | 'items';

export type RewardCandidateValidationResult = { ok: true } | { ok: false; message: string };

export interface RewardCandidateLibrary {
  existing?: readonly unknown[];
  knownStatusIds?: Iterable<string>;
  statusDefinitions?: readonly unknown[];
  knownResourceIds?: Iterable<string>;
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
  const ignored = new Set(['quantity', 'count', 'price', 'status', 'description', 'upgrade_level', '$meta']);
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
    allowSpentResources?: ReadonlySet<string>;
    allowXResources?: ReadonlySet<string>;
  } = {},
): RewardCandidateValidationResult {
  for (const field of ['effect', 'effect_program', 'effectProgram']) {
    if (Object.prototype.hasOwnProperty.call(value, field)) return failure(`${field} 已移除，请使用浅层 effects`);
  }
  const resolved = resolveTriggerInput(value);
  const sources = resolved.structured
    ? [
        [resolved.immediateEffects, undefined],
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
  if (programs.length === 0) return failure('必须提供浅层 effects');
  const combined: EffectProgram = { spec: 'mwg.effect/v1', steps: programs.flatMap(program => program.steps) };
  const encoded = JSON.stringify(combined);
  if (encoded.includes('context.status_stacks')) return failure('stacks 只允许用于状态 triggers');
  if (
    !options.allowModifiers &&
    (encoded.includes('"op":"modify"') || encoded.includes('"op":"card_play_rule"'))
  ) {
    return failure('持续修饰或出牌规则只允许用于 passive 或状态 hold');
  }
  const policy = validateEffectProgramPolicy(combined, {
    triggerPolicy: options.power ? 'require_root_or_status' : 'forbid',
    modifierPolicy: options.allowModifiers ? 'only' : 'forbid',
    allowSpentEnergy: options.allowSpentEnergy,
    allowSpentResources: options.allowSpentResources,
    allowXResources: options.allowXResources,
  });
  if (!policy.ok) return failure(`${policy.issues[0].path}: ${policy.issues[0].message}`);
  return { ok: true };
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
    for (const flag of ['retain', 'exhaust', 'ethereal', 'innate']) {
      if (value[flag] !== undefined && typeof value[flag] !== 'boolean') return failure(`卡牌 ${flag} 必须是布尔值`);
    }
    const costComponents = normalizeCardCost((value.cost ?? 0) as any);
    const main = validateEffects(value, {
      trigger,
      when: value.when,
      creates: value.creates,
      power: type === 'Power',
      allowSpentEnergy: costComponents.energy === 'all',
      allowSpentResources: new Set(Object.keys(costComponents)),
      allowXResources: new Set(Object.entries(costComponents).filter(([, component]) => component === 'all').map(([id]) => id)),
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
    if (typeof triggerInput.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(triggerInput.trigger)) {
      return failure('浅层遗物必须提供合法 trigger');
    }
    return validateEffects(value, {
      when: value.when,
      allowModifiers: triggerInput.trigger === 'passive',
    });
  }

  if (readRewardCandidateQuantity(category, value) === null) return failure('道具 count 必须是 1..999');
  if (value.trigger !== undefined) return failure('道具不得包含 trigger');
  return validateEffects(value, { when: value.when });
}

/** Validate references and identity against the persistent content library. */
export function validateRewardCandidateAgainstLibrary(
  category: RewardCandidateCategory,
  value: unknown,
  library: RewardCandidateLibrary,
): RewardCandidateValidationResult {
  const base = validateRewardCandidate(category, value);
  if (!base.ok || !isRecord(value)) return base;

  if (library.knownResourceIds) {
    const knownResources = new Set(['energy', ...library.knownResourceIds]);
    if (category === 'cards') {
      const missingCostResources = Object.keys(normalizeCardCost((value.cost ?? 0) as any))
        .filter(id => !knownResources.has(id));
      if (missingCostResources.length > 0)
        return failure(`费用引用了未注册资源: ${missingCostResources.sort().join(', ')}`);
    }
    const references = new Set<string>();
    const visit = (entry: unknown): void => {
      if (typeof entry === 'string') {
        for (const match of entry.matchAll(/(?:self|opponent)\.resource\.([A-Za-z_][A-Za-z0-9_]*)\.(?:current|max)/g)) {
          references.add(match[1]);
        }
        return;
      }
      if (Array.isArray(entry)) {
        entry.forEach(visit);
        return;
      }
      if (!isRecord(entry)) return;
      if ((entry.op === 'gain_resource' || entry.op === 'set_resource') && typeof entry.resource === 'string') {
        references.add(entry.resource);
      }
      Object.values(entry).forEach(visit);
    };
    compactPrograms(value).forEach(visit);
    const missing = [...references].filter(id => !knownResources.has(id)).sort();
    if (missing.length > 0) return failure(`引用了未注册资源: ${missing.join(', ')}`);
  }

  const supportStatus = value.status;
  if (supportStatus !== undefined && !isRecord(supportStatus)) return failure('候选 status 必须是一个状态定义对象');
  if (isRecord(supportStatus)) {
    const validation = validateCompactStatusDefinition(supportStatus);
    if (!validation.ok) return failure(`候选 status 无效: ${validation.message}`);
  }

  if (library.knownStatusIds || library.statusDefinitions || isRecord(supportStatus)) {
    const definitions = [
      ...(library.statusDefinitions || []).filter(isRecord),
      ...(isRecord(supportStatus) ? [supportStatus] : []),
    ];
    const known = new Set([
      ...(library.knownStatusIds || []),
      ...definitions.map(definition => definition.id).filter((id): id is string => typeof id === 'string'),
    ]);
    const references = new Set<string>();
    compactPrograms(value).forEach(program => {
      collectEffectProgramStatusReferences(program as import('./effectDsl').EffectProgram).forEach(id => references.add(id));
    });
    if (isRecord(supportStatus)) {
      const supportId = String(supportStatus.id);
      if (!references.has(supportId)) return failure(`候选 status ${supportId} 未被该候选引用`);
      collectCompactStatusDefinitionReferences(supportStatus).forEach(id => references.add(id));
    }
    const missing = [...references].filter(id => !known.has(id)).sort();
    if (missing.length > 0) return failure(`引用了未注册状态: ${missing.join(', ')}`);
    for (const id of references) {
      const matches = definitions.filter(definition => definition.id === id);
      if (matches.length > 1) return failure(`状态定义 ID 重复: ${id}`);
      if (matches.length === 1) {
        const validation = validateCompactStatusDefinition(matches[0]);
        if (!validation.ok) return failure(`状态 ${id} 无效: ${validation.message}`);
      }
    }
  }

  const existing = (library.existing || []).filter(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.id === value.id,
  );
  if (existing.length > 1) return failure(`已有内容包含重复 ID: ${String(value.id)}`);
  if (existing.length === 0) return { ok: true };
  if (category === 'artifacts') return failure(`遗物已持有: ${String(value.id)}`);
  if (comparableDefinition(existing[0]) !== comparableDefinition(value)) {
    return failure(`ID ${String(value.id)} 已存在但规则不同，请使用新 ID`);
  }
  return { ok: true };
}
