import {
  CARD_RARITY_SET,
  CARD_TYPE_SET,
  compileCompactEffectList,
  normalizeChinesePlayerDescription,
  resolveCompactCardDescription,
  resolveCompactContentDescription,
  normalizeAbilityTrigger,
  normalizeCompactNamedEffectInput,
  restorePersistentCardProgression,
  resolveTriggerInput,
  RELIC_RARITY_SET,
  validateCardCost,
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
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): EffectProgram | null {
  const resolved = resolveTriggerInput(value);
  if (!resolved.structured) {
    const compiled = compileCompactEffectList(value.effects, {
      trigger: value.trigger,
      when: value.when,
      creates: value.creates,
      statusNames: options.statusNames,
    });
    return compiled.ok ? compiled.value : null;
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
    ? { spec: 'mwg.effect/v1', steps: programs.flatMap(program => program.steps) }
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
  const effectProgram = compileCardEffects(value, options);
  if (!hasValidId(id) || !name || !effectProgram) return null;

  const type = readText(value, 'type', 'Skill');
  const rarity = readText(value, 'rarity', 'Common');
  if (!CARD_TYPE_SET.has(type) || !CARD_RARITY_SET.has(rarity)) return null;
  const quantity = Number(value.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null;

  let cost: CardCost | undefined;
  if (type === 'Curse') cost = undefined;
  else {
    const candidate = value.cost ?? 0;
    if (validateCardCost(candidate)) return null;
    cost = typeof candidate === 'object' ? structuredClone(candidate) as CardCost : candidate as CardCost;
  }

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
    discardEffectProgram = discard.value;
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
    description: resolveCompactCardDescription(value, {
      includeKeywords: false,
      statusNames: options.statusNames,
    }),
    effectProgram,
    ...(discardEffectProgram ? { discardEffectProgram } : {}),
    retain: value.retain === true,
    exhaust: type === 'Power' || value.exhaust === true,
    ethereal: value.ethereal === true,
    innate: value.innate === true,
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
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): Relic | null {
  if (!isContentRecord(value)) return null;
  const id = readText(value, 'id');
  const name = readText(value, 'name');
  const resolvedTrigger = resolveTriggerInput(value);
  const trigger = normalizeAbilityTrigger(typeof resolvedTrigger.trigger === 'string' ? resolvedTrigger.trigger : '');
  const effectProgram = compileEffects(value, { requireTrigger: true });
  const rarity = readText(value, 'rarity', 'Common');
  if (!hasValidId(id) || !name || !trigger || !effectProgram || !RELIC_RARITY_SET.has(rarity)) return null;
  return {
    id,
    name,
    emoji: readText(value, 'emoji', '🔮'),
    description: resolveCompactContentDescription(value, { statusNames: options.statusNames }),
    effectProgram,
    rarity: rarity as Relic['rarity'],
    trigger,
    ...(resolvedTrigger.eventQuery ? { eventQuery: resolvedTrigger.eventQuery } : {}),
  };
}

export function normalizeItemDefinition(
  value: unknown,
  options: { statusNames?: Readonly<Record<string, string>> } = {},
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
    description: resolveCompactContentDescription(value, { statusNames: options.statusNames }),
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
  const effectProgram = compileEffects(value, {
    requireTrigger: true,
    enemyCollectionTarget: options.enemyCollectionTarget,
  });
  if (!hasValidId(id) || !trigger || !effectProgram) return null;
  return {
    id,
    name: readText(value, 'name', id),
    emoji: readText(value, 'emoji', '⚡'),
    description: resolveCompactContentDescription(value, { statusNames: options.statusNames }),
    source: readText(value, 'source', '剧情获得'),
    trigger,
    ...(resolvedTrigger.eventQuery ? { eventQuery: resolvedTrigger.eventQuery } : {}),
    effectProgram,
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
  const name = readText(value, 'name');
  const effectProgram = compileEffects(value, {
    forbidTrigger: true,
    enemyCollectionTarget: options.enemyCollectionTarget ?? 'self',
  });
  const weight = Number(value.weight ?? 1);
  if (!name || !effectProgram || !Number.isFinite(weight) || weight <= 0) return null;
  return {
    name,
    effectProgram,
    description: resolveCompactContentDescription(value, { statusNames: options.statusNames }),
    weight,
  };
}

export interface NormalizedNamedEffect {
  name: string;
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
    description: resolveCompactContentDescription(normalized, { statusNames: options.statusNames }),
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
