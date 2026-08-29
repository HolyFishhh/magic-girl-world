export const ABILITY_TRIGGERS = [
  'battle_start',
  'ability_gain',
  'turn_start',
  'turn_end',
  'card_played',
  'attack_played',
  'skill_played',
  'power_played',
  'on_discard',
  'on_exhaust',
  'on_draw',
  'on_shuffle',
  'passive',
  'take_damage',
  'take_heal',
  'deal_damage',
  'deal_heal',
  'lust_increase',
  'lust_decrease',
  'deal_lust_increase',
  'deal_lust_decrease',
  'gain_buff',
  'gain_debuff',
  'lose_buff',
  'lose_debuff',
  'enemy_gain_buff',
  'enemy_gain_debuff',
  'enemy_lose_buff',
  'enemy_lose_debuff',
  'gain_block',
  'lose_block',
  'defeated',
] as const;

export type AbilityTrigger = (typeof ABILITY_TRIGGERS)[number];

export const STATUS_TRIGGERS = ['apply', 'stack', 'tick', 'remove', 'hold', 'threshold_execute'] as const;
export type StatusTrigger = (typeof STATUS_TRIGGERS)[number];
export type BattleTrigger = AbilityTrigger | StatusTrigger;

export const ABILITY_TRIGGER_SET: ReadonlySet<string> = new Set(ABILITY_TRIGGERS);
export const STATUS_TRIGGER_SET: ReadonlySet<string> = new Set(STATUS_TRIGGERS);

export type RegisterableEffectTrigger = Exclude<AbilityTrigger, 'battle_start' | 'passive'>;

export const OUTER_LIFECYCLE_TRIGGER_SET: ReadonlySet<AbilityTrigger> = new Set(['battle_start', 'passive']);

export function isOuterLifecycleTrigger(value: unknown): value is 'battle_start' | 'passive' {
  return typeof value === 'string' && OUTER_LIFECYCLE_TRIGGER_SET.has(value as AbilityTrigger);
}

/** Triggers that may be registered inside an effect AST. Outer lifecycle hooks stay excluded. */
export const REGISTERABLE_EFFECT_TRIGGERS = ABILITY_TRIGGERS.filter(
  (trigger): trigger is RegisterableEffectTrigger => !OUTER_LIFECYCLE_TRIGGER_SET.has(trigger),
);
export const REGISTERABLE_EFFECT_TRIGGER_SET: ReadonlySet<string> = new Set(REGISTERABLE_EFFECT_TRIGGERS);

export function normalizeAbilityTrigger(value: string): AbilityTrigger | null {
  const normalized = value.trim().toLowerCase();
  return ABILITY_TRIGGER_SET.has(normalized) ? (normalized as AbilityTrigger) : null;
}

export function isAbilityTrigger(value: string): value is AbilityTrigger {
  return normalizeAbilityTrigger(value) === value.trim().toLowerCase();
}

export function isStatusTrigger(value: string): value is StatusTrigger {
  return STATUS_TRIGGER_SET.has(value.trim().toLowerCase());
}

export function isRegisterableEffectTrigger(value: string): value is RegisterableEffectTrigger {
  return REGISTERABLE_EFFECT_TRIGGER_SET.has(value.trim().toLowerCase());
}

const PLAYED_CARD_TYPE_TRIGGER: Readonly<Record<string, AbilityTrigger>> = {
  Attack: 'attack_played',
  Skill: 'skill_played',
  Power: 'power_played',
};

/** Generic card-play effects resolve before the optional type-specific event. */
export function resolvePlayedCardTriggers(cardType: unknown): readonly AbilityTrigger[] {
  const specific = typeof cardType === 'string' ? PLAYED_CARD_TYPE_TRIGGER[cardType] : undefined;
  return specific ? ['card_played', specific] : ['card_played'];
}

export type StatusPolarity = 'buff' | 'debuff';
export type StatusOwnershipChange = 'gain' | 'lose';

export interface StatusOwnershipTriggerPair {
  owner: AbilityTrigger;
  observer: AbilityTrigger;
}

const STATUS_OWNERSHIP_TRIGGER_MAP: Readonly<
  Record<StatusOwnershipChange, Readonly<Record<StatusPolarity, StatusOwnershipTriggerPair>>>
> = {
  gain: {
    buff: { owner: 'gain_buff', observer: 'enemy_gain_buff' },
    debuff: { owner: 'gain_debuff', observer: 'enemy_gain_debuff' },
  },
  lose: {
    buff: { owner: 'lose_buff', observer: 'enemy_lose_buff' },
    debuff: { owner: 'lose_debuff', observer: 'enemy_lose_debuff' },
  },
};

/** Resolve the owner and opposing observer events emitted by a status transition. */
export function resolveStatusOwnershipTriggers(
  statusType: string,
  change: StatusOwnershipChange,
): StatusOwnershipTriggerPair | null {
  if (statusType !== 'buff' && statusType !== 'debuff') return null;
  return STATUS_OWNERSHIP_TRIGGER_MAP[change][statusType];
}
