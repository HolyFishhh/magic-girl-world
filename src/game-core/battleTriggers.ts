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
  'kill',
] as const;

export type AbilityTrigger = (typeof ABILITY_TRIGGERS)[number];

/** Status-owned lifecycle hooks. `hold` is continuous and never dispatched as an event. */
export const STATUS_LIFECYCLE_TRIGGERS = ['apply', 'stack', 'tick', 'remove', 'hold', 'threshold_execute'] as const;
export type StatusLifecycleTrigger = (typeof STATUS_LIFECYCLE_TRIGGERS)[number];

/**
 * A held status may observe the same concrete battle events as an ability.
 * `passive` is deliberately excluded because continuous rules belong in
 * `triggers.hold`; every remaining key represents an actual one-shot event.
 */
export const STATUS_EVENT_TRIGGERS = ABILITY_TRIGGERS.filter(
  (trigger): trigger is Exclude<AbilityTrigger, 'passive'> => trigger !== 'passive',
);
export type StatusEventTrigger = (typeof STATUS_EVENT_TRIGGERS)[number];

export const STATUS_TRIGGERS = [...STATUS_LIFECYCLE_TRIGGERS, ...STATUS_EVENT_TRIGGERS] as const;
export type StatusTrigger = StatusLifecycleTrigger | StatusEventTrigger;
export type BattleTrigger = AbilityTrigger | StatusTrigger;

/**
 * An ability event is either local to the entity that caused it, local to the
 * entity that received it, visible to the whole opposing team, or a genuine
 * side-wide lifecycle event. Hosts use this shared classification to keep a
 * combatant and its summons from impersonating one another.
 */
export type AbilityTriggerRecipientScope = 'source' | 'holder' | 'observer' | 'team' | 'owner';

const SOURCE_LOCAL_ABILITY_TRIGGERS: ReadonlySet<AbilityTrigger> = new Set([
  'kill',
  'deal_damage', 'deal_heal', 'deal_lust_increase', 'deal_lust_decrease',
]);

const HOLDER_LOCAL_ABILITY_TRIGGERS: ReadonlySet<AbilityTrigger> = new Set([
  'take_damage', 'take_heal', 'lust_increase', 'lust_decrease',
  'gain_buff', 'gain_debuff', 'lose_buff', 'lose_debuff',
  'gain_block', 'lose_block', 'defeated',
]);

const OPPOSING_OBSERVER_ABILITY_TRIGGERS: ReadonlySet<AbilityTrigger> = new Set([
  'enemy_gain_buff', 'enemy_gain_debuff', 'enemy_lose_buff', 'enemy_lose_debuff',
]);

const TEAM_ABILITY_TRIGGERS: ReadonlySet<AbilityTrigger> = new Set([
  'turn_start', 'turn_end', 'card_played', 'attack_played', 'skill_played', 'power_played',
  'on_discard', 'on_exhaust', 'on_draw', 'on_shuffle',
]);

export function abilityTriggerRecipientScope(trigger: AbilityTrigger): AbilityTriggerRecipientScope {
  if (SOURCE_LOCAL_ABILITY_TRIGGERS.has(trigger)) return 'source';
  if (HOLDER_LOCAL_ABILITY_TRIGGERS.has(trigger)) return 'holder';
  if (OPPOSING_OBSERVER_ABILITY_TRIGGERS.has(trigger)) return 'observer';
  if (TEAM_ABILITY_TRIGGERS.has(trigger)) return 'team';
  return 'owner';
}

export const ABILITY_TRIGGER_SET: ReadonlySet<string> = new Set(ABILITY_TRIGGERS);
export const STATUS_TRIGGER_SET: ReadonlySet<string> = new Set(STATUS_TRIGGERS);
export const STATUS_EVENT_TRIGGER_SET: ReadonlySet<string> = new Set(STATUS_EVENT_TRIGGERS);

/** Only these lifecycle events expose causal journal metadata for trigger filters. */
export const EVENT_FILTERABLE_TRIGGER_SET: ReadonlySet<string> = new Set([
  'kill',
  'turn_start', 'turn_end',
  'card_played', 'attack_played', 'skill_played', 'power_played',
  'on_discard', 'on_exhaust', 'on_draw', 'on_shuffle',
  'take_damage', 'take_heal', 'deal_damage', 'deal_heal',
  'lust_increase', 'lust_decrease', 'deal_lust_increase', 'deal_lust_decrease',
  'gain_buff', 'gain_debuff', 'lose_buff', 'lose_debuff',
  'enemy_gain_buff', 'enemy_gain_debuff', 'enemy_lose_buff', 'enemy_lose_debuff',
  'gain_block', 'lose_block',
]);

export type RegisterableEffectTrigger = Exclude<AbilityTrigger, 'battle_start' | 'passive'>;
/** Runtime-created abilities may also be passive; battle_start can no longer occur after registration. */
export type RuntimeRegisteredEffectTrigger = RegisterableEffectTrigger | 'passive';

export const OUTER_LIFECYCLE_TRIGGER_SET: ReadonlySet<AbilityTrigger> = new Set(['battle_start', 'passive']);

export function isOuterLifecycleTrigger(value: unknown): value is 'battle_start' | 'passive' {
  return typeof value === 'string' && OUTER_LIFECYCLE_TRIGGER_SET.has(value as AbilityTrigger);
}

/** Triggers that may be registered inside an effect AST. Outer lifecycle hooks stay excluded. */
export const REGISTERABLE_EFFECT_TRIGGERS = ABILITY_TRIGGERS.filter(
  (trigger): trigger is RegisterableEffectTrigger => !OUTER_LIFECYCLE_TRIGGER_SET.has(trigger),
);
export const REGISTERABLE_EFFECT_TRIGGER_SET: ReadonlySet<string> = new Set(REGISTERABLE_EFFECT_TRIGGERS);
export const RUNTIME_REGISTERED_EFFECT_TRIGGER_SET: ReadonlySet<string> = new Set([
  ...REGISTERABLE_EFFECT_TRIGGERS,
  'passive',
]);

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
