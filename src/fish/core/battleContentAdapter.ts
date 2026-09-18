import { validateStructuredTriggerInput } from '../../game-core/compactEffectDsl';
import { isEmptyProtectionEffect } from '../../game-core/damageProtection';
import {
  CARD_RARITY_SET,
  CARD_TYPE_SET,
  compileCompactEffectList,
  normalizeCardCost,
  normalizeChinesePlayerDescription,
  parseNonCombatSettlement,
  resolveCompactContentDescription,
  normalizeAbilityTrigger,
  normalizeDamageProtectionRule,
  normalizeCompactNamedEffectInput,
  restorePersistentCardProgression,
  resolveTriggerInput,
  RELIC_RARITY_SET,
  validateCardCost,
  validateEffectProgramPolicy,
  type Ability,
  type Card,
  type CardCost,
  type EffectProgram,
  type EnemyAction,
  type Item,
  type Relic,
  type StatusEffect,
} from '../../game-core';

function isContentRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText(source: Record<string, any>, key: string, fallback = ''): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

function hasValidId(value: string): boolean {
  return /^[a-z_][a-z0-9_-]*$/i.test(value);
}

function hasRemovedEffectFields(value: Record<string, any>): boolean {
  return ['effect', 'effect_program', 'effectProgram'].some(key => Object.prototype.hasOwnProperty.call(value, key));
}

function compileEffects(
  value: Record<string, any>,
  options: {
    requireTrigger?: boolean;
    forbidTrigger?: boolean;
    enemyCollectionTarget?: 'self' | 'opponent';
  } = {},
): EffectProgram | null {
  if (hasRemovedEffectFields(value)) return null;
  const resolved = resolveTriggerInput(value);
  if (options.forbidTrigger && resolved.trigger !== undefined) return null;
  if (options.requireTrigger && !normalizeAbilityTrigger(typeof resolved.trigger === 'string' ? resolved.trigger : '')) return null;
  if (options.requireTrigger && resolved.structured && resolved.immediateEffects !== undefined) return null;
  if (resolved.triggeredEffects === undefined) return null;
  const compiled = compileCompactEffectList(resolved.triggeredEffects, {
    creates: value.creates,
    when: resolved.structured ? undefined : value.when,
    enemyCollectionTarget: options.enemyCollectionTarget,
  });
  return compiled.ok ? compiled.value : null;
}

function compileCardEffects(
  value: Record<string, any>,
  type: Card['type'],
  cost: CardCost | undefined,
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): EffectProgram | null {
  const costComponents = normalizeCardCost(cost);
  const validateProgram = (program: EffectProgram): EffectProgram | null => {
    const policy = validateEffectProgramPolicy(program, {
      triggerPolicy: type === 'Power' ? 'require_root_or_status' : 'forbid',
      modifierPolicy: 'forbid',
      allowPersistentGrowth: true,
      allowSpentEnergy: Object.prototype.hasOwnProperty.call(costComponents, 'energy'),
      allowXValue: costComponents.energy === 'all',
      allowSpentResources: new Set(Object.keys(costComponents)),
      allowXResources: new Set(
        Object.entries(costComponents)
          .filter(([, component]) => component === 'all')
          .map(([id]) => id),
      ),
      allowNarrate: type === 'Event',
      requireSingleNarrate: type === 'Event',
      allowCardDestination: type !== 'Event',
      allowCurrentCardReplay: type !== 'Power' && type !== 'Event',
      ...(options.statusNames ? { knownStatusIds: new Set(Object.keys(options.statusNames)) } : {}),
    });
    return policy.ok ? policy.value : null;
  };
  const resolved = resolveTriggerInput(value);
  if (!resolved.structured) {
    const compiled = compileCompactEffectList(value.effects, {
      trigger: value.trigger,
      when: value.when,
      creates: value.creates,
      statusNames: options.statusNames,
    });
    return compiled.ok ? validateProgram(compiled.value) : null;
  }
  const programs: EffectProgram[] = [];
  if (resolved.immediateEffects !== undefined) {
    const immediate = compileCompactEffectList(resolved.immediateEffects, {
      when: value.when,
      creates: value.creates,
      statusNames: options.statusNames,
    });
    if (!immediate.ok) return null;
    programs.push(immediate.value);
  }
  if (resolved.triggeredEffects !== undefined) {
    const triggered = compileCompactEffectList(resolved.triggeredEffects, {
      trigger: resolved.trigger,
      triggerQuery: resolved.eventQuery,
      creates: value.creates,
      statusNames: options.statusNames,
    });
    if (!triggered.ok) return null;
    programs.push(triggered.value);
  }
  return programs.length > 0
    ? validateProgram({ spec: 'mwg.effect/v1', steps: programs.flatMap(program => program.steps) })
    : null;
}

export interface NormalizedCardDefinition extends Omit<Card, 'id'> {
  id: string;
  quantity: number;
}

export function normalizeCardDefinition(
  value: unknown,
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): NormalizedCardDefinition | null {
  if (!isContentRecord(value) || hasRemovedEffectFields(value)) return null;
  const id = readText(value, 'id');
  const name = readText(value, 'name');
  const type = readText(value, 'type', 'Skill');
  const rarity = readText(value, 'rarity', 'Common');
  if (!hasValidId(id) || !name || !CARD_TYPE_SET.has(type) || !CARD_RARITY_SET.has(rarity)) return null;
  const quantity = Number(value.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null;

  let cost: CardCost | undefined;
  if (type === 'Curse') cost = undefined;
  else {
    const candidate = value.cost ?? 0;
    if (validateCardCost(candidate)) return null;
    cost = typeof candidate === 'object' ? structuredClone(candidate) as CardCost : candidate as CardCost;
  }

  const compiledEffectProgram = compileCardEffects(value, type as Card['type'], cost, options);
  const effectProgram = compiledEffectProgram || (
    type === 'Curse'
    && value.effects === undefined
    && value.trigger === undefined
      ? { spec: 'mwg.effect/v1' as const, steps: [] }
      : null
  );
  if (!effectProgram) return null;

  if (['discard_effect', 'discardEffect', 'on_discard', 'onDiscard', 'discardEffectProgram'].some(key => key in value)) {
    return null;
  }
  let discardEffectProgram: EffectProgram | undefined;
  if (Object.prototype.hasOwnProperty.call(value, 'discard_effects')) {
    const discard = compileCompactEffectList(value.discard_effects, {
      creates: value.creates,
      statusNames: options.statusNames,
    });
    if (!discard.ok) return null;
    const discardPolicy = validateEffectProgramPolicy(discard.value, {
      triggerPolicy: 'forbid',
      modifierPolicy: 'forbid',
      allowPersistentGrowth: true,
      ...(options.statusNames ? { knownStatusIds: new Set(Object.keys(options.statusNames)) } : {}),
    });
    if (!discardPolicy.ok) return null;
    discardEffectProgram = discardPolicy.value;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'discard_requirement')) return null;

  const normalized = {
    id,
    name,
    emoji: readText(value, 'emoji', '🃏'),
    type: type as Card['type'],
    rarity: rarity as Card['rarity'],
    cost,
    quantity,
    // Description is authored prose only. Views render rules from the current
    // effectProgram, including battle-time upgrades, instead of caching a
    // mechanical sentence that becomes stale after a card patch.
    description: normalizeChinesePlayerDescription(value.description),
    ...(typeof value.dialogue === 'string' && value.dialogue.trim() ? { dialogue: value.dialogue.trim() } : {}),
    effectProgram,
    ...(discardEffectProgram ? { discardEffectProgram } : {}),
    retain: value.retain === true,
    lifecycle: value.lifecycle ? structuredClone(value.lifecycle) : undefined,
    exhaust: type === 'Power' || value.exhaust === true,
    ethereal: value.ethereal === true,
    innate: value.innate === true,
    unique: value.unique === true,
    ...((value.requires_summon || value.requiresSummonTemplateId) ? { requiresSummonTemplateId: String(value.requires_summon || value.requiresSummonTemplateId) } : {}),
    ...(Array.isArray(value.tags) ? { tags: [...value.tags] } : {}),
    ...(typeof value.templateId === 'string' && value.templateId.trim() ? { templateId: value.templateId.trim() } : {}),
    ...(typeof value.runInstanceId === 'string' && value.runInstanceId.trim()
      ? { runInstanceId: value.runInstanceId.trim() }
      : {}),
    ...(typeof value.origin === 'string' && ['deck', 'generated', 'copied', 'transformed'].includes(value.origin)
      ? { origin: value.origin as Card['origin'] }
      : {}),
    ...(typeof value.parentRunInstanceId === 'string' && value.parentRunInstanceId.trim()
      ? { parentRunInstanceId: value.parentRunInstanceId.trim() }
      : {}),
  } satisfies NormalizedCardDefinition;
  return restorePersistentCardProgression(normalized, value);
}

export function normalizeRelicDefinition(
  value: unknown,
  _options: { statusNames?: Readonly<Record<string, string>> } = {},
): Relic | null {
  if (!isContentRecord(value)) return null;
  const id = readText(value, 'id');
  const name = readText(value, 'name');
  const resolvedTrigger = resolveTriggerInput(value);
  const trigger = normalizeAbilityTrigger(typeof resolvedTrigger.trigger === 'string' ? resolvedTrigger.trigger : '');
  const effectProgram = trigger ? compileEffects(value, { requireTrigger: true }) : null;
  const rarity = readText(value, 'rarity', 'Common');
  let onAcquire: Relic['onAcquire'];
  if (value.on_acquire !== undefined) {
    try {
      onAcquire = parseNonCombatSettlement(value.on_acquire);
    } catch {
      return null;
    }
  }
  if (!hasValidId(id) || !name || (!trigger && !onAcquire) || (trigger && !effectProgram) || !RELIC_RARITY_SET.has(rarity)) return null;
  return {
    id,
    name,
    emoji: readText(value, 'emoji', '🔮'),
    description: resolveCompactContentDescription(value),
    ...(effectProgram ? { effectProgram } : {}),
    rarity: rarity as Relic['rarity'],
    ...(trigger ? { trigger } : {}),
    ...(resolvedTrigger.eventQuery ? { eventQuery: resolvedTrigger.eventQuery } : {}),
    ...(onAcquire ? { onAcquire } : {}),
  };
}

export function normalizeItemDefinition(
  value: unknown,
  _options: { statusNames?: Readonly<Record<string, string>> } = {},
): Item | null {
  if (!isContentRecord(value)) return null;
  const id = readText(value, 'id');
  const name = readText(value, 'name');
  const effectProgram = compileEffects(value, { forbidTrigger: true });
  const count = Number(value.count ?? 1);
  if (!hasValidId(id) || !name || !effectProgram || !Number.isInteger(count) || count < 1 || count > 999) return null;
  return {
    id,
    name,
    emoji: readText(value, 'emoji', '🧪'),
    description: normalizeChinesePlayerDescription(value.description),
    effectProgram,
    count,
  };
}

export function normalizeAbilityDefinition(
  value: unknown,
  options: {
    statusNames?: Readonly<Record<string, string>>;
    enemyCollectionTarget?: 'self' | 'opponent';
  } = {},
): Ability | null {
  if (!isContentRecord(value)) return null;
  const id = readText(value, 'id');
  const resolvedTrigger = resolveTriggerInput(value);
  const trigger = normalizeAbilityTrigger(typeof resolvedTrigger.trigger === 'string' ? resolvedTrigger.trigger : '');
  const protection = normalizeDamageProtectionRule(value.protection);
  const compiledEffectProgram = compileEffects(value, {
    requireTrigger: true,
    enemyCollectionTarget: options.enemyCollectionTarget,
  });
  const protectionTriggerIssues: Parameters<typeof validateStructuredTriggerInput>[2] = [];
  if (resolvedTrigger.structured) validateStructuredTriggerInput(value.trigger, 'trigger', protectionTriggerIssues);
  const protectionOnlyPassive = Boolean(
    protectionTriggerIssues.length === 0 &&
    protection && trigger === 'passive' &&
    isEmptyProtectionEffect(resolveTriggerInput(value).triggeredEffects) &&
    resolveTriggerInput(value).immediateEffects === undefined &&
    !hasRemovedEffectFields(value),
  );
  const effectProgram = compiledEffectProgram || (protectionOnlyPassive ? { spec: 'mwg.effect/v1' as const, steps: [] } : null);
  if (!hasValidId(id) || !trigger || !effectProgram || (value.protection !== undefined && !protection)) return null;
  return {
    id,
    name: readText(value, 'name', id),
    emoji: readText(value, 'emoji', '⚡'),
    description: normalizeChinesePlayerDescription(value.description),
    source: readText(value, 'source', '剧情获得'),
    trigger,
    ...(resolvedTrigger.eventQuery ? { eventQuery: resolvedTrigger.eventQuery } : {}),
    effectProgram,
    ...(protection ? { protection } : {}),
  };
}

export function normalizeEnemyAction(
  value: unknown,
  options: {
    statusNames?: Readonly<Record<string, string>>;
    enemyCollectionTarget?: 'self' | 'opponent';
  } = {},
): EnemyAction | null {
  if (!isContentRecord(value)) return null;
  const id = readText(value, 'id');
  const name = readText(value, 'name');
  const emoji = readText(value, 'emoji');
  const effectProgram = compileEffects(value, {
    forbidTrigger: true,
    enemyCollectionTarget: options.enemyCollectionTarget ?? 'self',
  });
  const weight = Number(value.weight ?? 1);
  if (!name || !effectProgram || !Number.isFinite(weight) || weight <= 0) return null;
  return {
    ...(hasValidId(id) ? { id } : {}),
    name,
    ...(emoji ? { emoji } : {}),
    effectProgram,
    description: normalizeChinesePlayerDescription(value.description),
    ...(typeof value.dialogue === 'string' && value.dialogue.trim() ? { dialogue: value.dialogue.trim() } : {}),
    weight,
  };
}

export interface NormalizedNamedEffect {
  name: string;
  emoji?: string;
  description: string;
  effectProgram: EffectProgram;
}

export function normalizeNamedEffectDefinition(
  value: unknown,
  options: {
    statusNames?: Readonly<Record<string, string>>;
    fallbackName?: string;
    enemyCollectionTarget?: 'self' | 'opponent';
  } = {},
): NormalizedNamedEffect | null {
  const normalized = normalizeCompactNamedEffectInput(value, options.fallbackName || '欲望效果');
  if (!isContentRecord(normalized)) return null;
  const name = readText(normalized, 'name');
  const effectProgram = compileEffects(normalized, {
    forbidTrigger: true,
    enemyCollectionTarget: options.enemyCollectionTarget,
  });
  if (!name || !effectProgram) return null;
  return {
    name,
    ...(readText(normalized, 'emoji') ? { emoji: readText(normalized, 'emoji') } : {}),
    description: normalizeChinesePlayerDescription(normalized.description),
    effectProgram,
  };
}

export function normalizeActiveStatus(
  value: unknown,
  options: {
    statusNames?: Readonly<Record<string, string>>;
    statusDescriptions?: Readonly<Record<string, string>>;
  } = {},
): StatusEffect | null {
  if (!isContentRecord(value)) return null;
  const id = readText(value, 'id');
  const stacks = Number(value.stacks ?? 1);
  const type = readText(value, 'type', 'neutral');
  if (!hasValidId(id) || !Number.isFinite(stacks) || stacks <= 0) return null;
  if (!['buff', 'debuff', 'neutral', 'ens'].includes(type)) return null;
  return {
    id,
    name: readText(value, 'name', options.statusNames?.[id] || id),
    emoji: readText(value, 'emoji', '✨'),
    description:
      normalizeChinesePlayerDescription(value.description) ||
      normalizeChinesePlayerDescription(options.statusDescriptions?.[id]),
    type: type as StatusEffect['type'],
    stacks: Math.floor(stacks),
  };
}

