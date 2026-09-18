export declare const ABILITY_TRIGGERS: readonly ["battle_start", "ability_gain", "turn_start", "turn_end", "card_played", "attack_played", "skill_played", "power_played", "on_discard", "on_exhaust", "on_draw", "on_shuffle", "passive", "take_damage", "take_heal", "deal_damage", "deal_heal", "lust_increase", "lust_decrease", "deal_lust_increase", "deal_lust_decrease", "gain_buff", "gain_debuff", "lose_buff", "lose_debuff", "enemy_gain_buff", "enemy_gain_debuff", "enemy_lose_buff", "enemy_lose_debuff", "gain_block", "lose_block", "defeated", "kill"];
export type AbilityTrigger = (typeof ABILITY_TRIGGERS)[number];
/** Status-owned lifecycle hooks. `hold` is continuous and never dispatched as an event. */
export declare const STATUS_LIFECYCLE_TRIGGERS: readonly ["apply", "stack", "tick", "remove", "hold", "threshold_execute"];
export type StatusLifecycleTrigger = (typeof STATUS_LIFECYCLE_TRIGGERS)[number];
/**
 * A held status may observe the same concrete battle events as an ability.
 * `passive` is deliberately excluded because continuous rules belong in
 * `triggers.hold`; every remaining key represents an actual one-shot event.
 */
export declare const STATUS_EVENT_TRIGGERS: ("battle_start" | "ability_gain" | "turn_start" | "turn_end" | "card_played" | "attack_played" | "skill_played" | "power_played" | "on_discard" | "on_exhaust" | "on_draw" | "on_shuffle" | "take_damage" | "take_heal" | "deal_damage" | "deal_heal" | "lust_increase" | "lust_decrease" | "deal_lust_increase" | "deal_lust_decrease" | "gain_buff" | "gain_debuff" | "lose_buff" | "lose_debuff" | "enemy_gain_buff" | "enemy_gain_debuff" | "enemy_lose_buff" | "enemy_lose_debuff" | "gain_block" | "lose_block" | "defeated" | "kill")[];
export type StatusEventTrigger = (typeof STATUS_EVENT_TRIGGERS)[number];
export declare const STATUS_TRIGGERS: readonly ["apply", "stack", "tick", "remove", "hold", "threshold_execute", ...("battle_start" | "ability_gain" | "turn_start" | "turn_end" | "card_played" | "attack_played" | "skill_played" | "power_played" | "on_discard" | "on_exhaust" | "on_draw" | "on_shuffle" | "take_damage" | "take_heal" | "deal_damage" | "deal_heal" | "lust_increase" | "lust_decrease" | "deal_lust_increase" | "deal_lust_decrease" | "gain_buff" | "gain_debuff" | "lose_buff" | "lose_debuff" | "enemy_gain_buff" | "enemy_gain_debuff" | "enemy_lose_buff" | "enemy_lose_debuff" | "gain_block" | "lose_block" | "defeated" | "kill")[]];
export type StatusTrigger = StatusLifecycleTrigger | StatusEventTrigger;
export type BattleTrigger = AbilityTrigger | StatusTrigger;
/**
 * An ability event is either local to the entity that caused it, local to the
 * entity that received it, visible to the whole opposing team, or a genuine
 * side-wide lifecycle event. Hosts use this shared classification to keep a
 * combatant and its summons from impersonating one another.
 */
export type AbilityTriggerRecipientScope = 'source' | 'holder' | 'observer' | 'team' | 'owner';
export declare function abilityTriggerRecipientScope(trigger: AbilityTrigger): AbilityTriggerRecipientScope;
export declare const ABILITY_TRIGGER_SET: ReadonlySet<string>;
export declare const STATUS_TRIGGER_SET: ReadonlySet<string>;
export declare const STATUS_EVENT_TRIGGER_SET: ReadonlySet<string>;
/** Only these lifecycle events expose causal journal metadata for trigger filters. */
export declare const EVENT_FILTERABLE_TRIGGER_SET: ReadonlySet<string>;
export type RegisterableEffectTrigger = Exclude<AbilityTrigger, 'battle_start' | 'passive'>;
/** Runtime-created abilities may also be passive; battle_start can no longer occur after registration. */
export type RuntimeRegisteredEffectTrigger = RegisterableEffectTrigger | 'passive';
export declare const OUTER_LIFECYCLE_TRIGGER_SET: ReadonlySet<AbilityTrigger>;
export declare function isOuterLifecycleTrigger(value: unknown): value is 'battle_start' | 'passive';
/** Triggers that may be registered inside an effect AST. Outer lifecycle hooks stay excluded. */
export declare const REGISTERABLE_EFFECT_TRIGGERS: RegisterableEffectTrigger[];
export declare const REGISTERABLE_EFFECT_TRIGGER_SET: ReadonlySet<string>;
export declare const RUNTIME_REGISTERED_EFFECT_TRIGGER_SET: ReadonlySet<string>;
export declare function normalizeAbilityTrigger(value: string): AbilityTrigger | null;
export declare function isAbilityTrigger(value: string): value is AbilityTrigger;
export declare function isStatusTrigger(value: string): value is StatusTrigger;
export declare function isRegisterableEffectTrigger(value: string): value is RegisterableEffectTrigger;
/** Generic card-play effects resolve before the optional type-specific event. */
export declare function resolvePlayedCardTriggers(cardType: unknown): readonly AbilityTrigger[];
export type StatusPolarity = 'buff' | 'debuff';
export type StatusOwnershipChange = 'gain' | 'lose';
export interface StatusOwnershipTriggerPair {
    owner: AbilityTrigger;
    observer: AbilityTrigger;
}
/** Resolve the owner and opposing observer events emitted by a status transition. */
export declare function resolveStatusOwnershipTriggers(statusType: string, change: StatusOwnershipChange): StatusOwnershipTriggerPair | null;
