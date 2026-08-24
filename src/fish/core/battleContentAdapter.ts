import {
  CARD_RARITY_SET,
  CARD_TYPE_SET,
  compileCompactEffectList,
  describeCompactCard,
  describeCompactContent,
  normalizeAbilityTrigger,
  RELIC_RARITY_SET,
  type Ability,
  type Card,
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
  options: { requireTrigger?: boolean; forbidTrigger?: boolean } = {},
): EffectProgram | null {
  if (hasRemovedEffectFields(value) || !Object.prototype.hasOwnProperty.call(value, 'effects')) return null;
  if (options.forbidTrigger && value.trigger !== undefined) return null;
  if (options.requireTrigger && !normalizeAbilityTrigger(readText(value, 'trigger'))) return null;
  const compiled = compileCompactEffectList(value.effects, { creates: value.creates });
  return compiled.ok ? compiled.value : null;
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
  const compiled = compileCompactEffectList(value.effects, {
    trigger: value.trigger,
    creates: value.creates,
    statusNames: options.statusNames,
  });
  if (!hasValidId(id) || !name || !compiled.ok) return null;

  const type = readText(value, 'type', 'Skill');
  const rarity = readText(value, 'rarity', 'Common');
  if (!CARD_TYPE_SET.has(type) || !CARD_RARITY_SET.has(rarity)) return null;
  const quantity = Number(value.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null;

  let cost: number | 'energy' | undefined;
  if (type === 'Curse') cost = undefined;
  else if (value.cost === 'energy') cost = 'energy';
  else {
    const numericCost = Number(value.cost ?? 0);
    if (!Number.isInteger(numericCost) || numericCost < 0) return null;
    cost = numericCost;
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

  return {
    id,
    name,
    emoji: readText(value, 'emoji', '🃏'),
    type: type as Card['type'],
    rarity: rarity as Card['rarity'],
    cost,
    quantity,
    description:
      readText(value, 'description') ||
      describeCompactCard(value, { includeKeywords: false, statusNames: options.statusNames }),
    effectProgram: compiled.value,
    ...(discardEffectProgram ? { discardEffectProgram } : {}),
    retain: value.retain === true,
    exhaust: type === 'Power' || value.exhaust === true,
    ethereal: value.ethereal === true,
    innate: value.innate === true,
  };
}

export function normalizeRelicDefinition(
  value: unknown,
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): Relic | null {
  if (!isContentRecord(value)) return null;
  const id = readText(value, 'id');
  const name = readText(value, 'name');
  const trigger = normalizeAbilityTrigger(readText(value, 'trigger'));
  const effectProgram = compileEffects(value, { requireTrigger: true });
  const rarity = readText(value, 'rarity', 'Common');
  if (!hasValidId(id) || !name || !trigger || !effectProgram || !RELIC_RARITY_SET.has(rarity)) return null;
  return {
    id,
    name,
    emoji: readText(value, 'emoji', '🔮'),
    description: readText(value, 'description') || describeCompactContent(value, { statusNames: options.statusNames }),
    effectProgram,
    rarity: rarity as Relic['rarity'],
    trigger,
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
    description: readText(value, 'description') || describeCompactContent(value, { statusNames: options.statusNames }),
    effectProgram,
    count,
  };
}

export function normalizeAbilityDefinition(
  value: unknown,
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): Ability | null {
  if (!isContentRecord(value)) return null;
  const id = readText(value, 'id');
  const trigger = normalizeAbilityTrigger(readText(value, 'trigger'));
  const effectProgram = compileEffects(value, { requireTrigger: true });
  if (!hasValidId(id) || !trigger || !effectProgram) return null;
  return {
    id,
    name: readText(value, 'name', id),
    emoji: readText(value, 'emoji', '⚡'),
    description: readText(value, 'description') || describeCompactContent(value, { statusNames: options.statusNames }),
    trigger,
    effectProgram,
  };
}

export function normalizeEnemyAction(
  value: unknown,
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): EnemyAction | null {
  if (!isContentRecord(value)) return null;
  const name = readText(value, 'name');
  const effectProgram = compileEffects(value, { forbidTrigger: true });
  const weight = Number(value.weight ?? 1);
  if (!name || !effectProgram || !Number.isFinite(weight) || weight <= 0) return null;
  return {
    name,
    effectProgram,
    description: readText(value, 'description') || describeCompactContent(value, { statusNames: options.statusNames }) || name,
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
  options: { statusNames?: Readonly<Record<string, string>> } = {},
): NormalizedNamedEffect | null {
  if (!isContentRecord(value)) return null;
  const name = readText(value, 'name');
  const effectProgram = compileEffects(value, { forbidTrigger: true });
  if (!name || !effectProgram) return null;
  return {
    name,
    description: readText(value, 'description') || describeCompactContent(value, { statusNames: options.statusNames }),
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
    description: readText(value, 'description', options.statusDescriptions?.[id] || ''),
    type: type as StatusEffect['type'],
    stacks: Math.floor(stacks),
  };
}
