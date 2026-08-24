import { ABILITY_TRIGGER_SET } from './battleTriggers';
import { compileCompactEffectList } from './compactEffectDsl';
import { isCompactEffectList } from './compactEffectContract';
import {
  collectCompactStatusDefinitionReferences,
  collectEffectProgramStatusReferences,
  validateCompactStatusDefinition,
} from './statusDefinitionValidation';
import { CARD_RARITY_SET, CARD_TYPE_SET, RELIC_RARITY_SET } from './contentCatalog';

export type RewardCandidateCategory = 'cards' | 'artifacts' | 'items';

export type RewardCandidateValidationResult = { ok: true } | { ok: false; message: string };

export interface RewardCandidateLibrary {
  existing?: readonly unknown[];
  knownStatusIds?: Iterable<string>;
  statusDefinitions?: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failure(message: string): RewardCandidateValidationResult {
  return { ok: false, message };
}

function compactPrograms(value: Record<string, unknown>): unknown[] {
  const programs: unknown[] = [];
  for (const [field, trigger] of [
    ['effects', value.trigger],
    ['discard_effects', undefined],
  ] as const) {
    if (!isCompactEffectList(value[field])) continue;
    const compiled = compileCompactEffectList(value[field], { trigger, creates: value.creates });
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
  options: { trigger?: unknown; creates?: unknown; allowModifiers?: boolean } = {},
): RewardCandidateValidationResult {
  for (const field of ['effect', 'effect_program', 'effectProgram']) {
    if (Object.prototype.hasOwnProperty.call(value, field)) return failure(`${field} 已移除，请使用浅层 effects`);
  }
  const hasCompact = isCompactEffectList(value.effects);
  if (!hasCompact) return failure('必须提供浅层 effects');
  const compiled = compileCompactEffectList(value.effects, { trigger: options.trigger, creates: options.creates });
  if (!compiled.ok) {
    const issue = compiled.issues[0];
    return failure(`${issue.path}: ${issue.message}`);
  }
  const encoded = JSON.stringify(compiled.value);
  if (encoded.includes('context.status_stacks')) return failure('stacks 只允许用于状态 triggers');
  if (!options.allowModifiers && encoded.includes('"op":"modify"')) {
    return failure('modify 只允许用于 passive 或状态 hold');
  }
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
    const quantity = Number(value.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return failure('卡牌 quantity 必须是 1..100');
    if (Object.prototype.hasOwnProperty.call(value, 'discard_requirement')) {
      return failure('卡牌 discard_requirement 已移除');
    }
    if (type === 'Curse') {
      if (value.cost !== undefined) return failure('Curse 不得包含 cost');
    } else if (
      (value.cost ?? 0) !== 'energy' &&
      (!Number.isInteger(value.cost ?? 0) || ((value.cost ?? 0) as number) < 0)
    ) {
      return failure('卡牌 cost 必须是非负整数或 energy');
    }
    const trigger = type === 'Power' ? value.trigger : undefined;
    if ((type === 'Power') !== (value.trigger !== undefined)) return failure('只有 Power 必须提供 trigger');
    for (const flag of ['retain', 'exhaust', 'ethereal', 'innate']) {
      if (value[flag] !== undefined && typeof value[flag] !== 'boolean') return failure(`卡牌 ${flag} 必须是布尔值`);
    }
    const main = validateEffects(value, { trigger, creates: value.creates });
    if (!main.ok) return main;
    if (Object.prototype.hasOwnProperty.call(value, 'discard_effect')) {
      return failure('discard_effect 已移除，请使用浅层 discard_effects');
    }
    if (value.discard_effects !== undefined) {
      const discard = compileCompactEffectList(value.discard_effects, { creates: value.creates });
      if (!discard.ok)
        return failure(`discard_effects${discard.issues[0].path.slice(1)}: ${discard.issues[0].message}`);
    }
    return { ok: true };
  }

  if (category === 'artifacts') {
    if (!RELIC_RARITY_SET.has(String(value.rarity ?? 'Common'))) return failure('遗物 rarity 无效');
    const compact = isCompactEffectList(value.effects);
    if (compact && (typeof value.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(value.trigger))) {
      return failure('浅层遗物必须提供合法 trigger');
    }
    return validateEffects(value, { allowModifiers: value.trigger === 'passive' });
  }

  const count = Number(value.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 999) return failure('道具 count 必须是 1..999');
  if (value.trigger !== undefined) return failure('道具不得包含 trigger');
  return validateEffects(value);
}

/** Validate references and identity against the persistent content library. */
export function validateRewardCandidateAgainstLibrary(
  category: RewardCandidateCategory,
  value: unknown,
  library: RewardCandidateLibrary,
): RewardCandidateValidationResult {
  const base = validateRewardCandidate(category, value);
  if (!base.ok || !isRecord(value)) return base;

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
