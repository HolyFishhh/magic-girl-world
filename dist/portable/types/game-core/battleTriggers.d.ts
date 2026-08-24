export declare const ABILITY_TRIGGERS: readonly ["battle_start", "ability_gain", "turn_start", "turn_end", "card_played", "attack_played", "skill_played", "power_played", "on_discard", "on_exhaust", "on_draw", "on_shuffle", "passive", "take_damage", "take_heal", "deal_damage", "deal_heal", "lust_increase", "lust_decrease", "deal_lust_increase", "deal_lust_decrease", "gain_buff", "gain_debuff", "lose_buff", "lose_debuff", "enemy_gain_buff", "enemy_gain_debuff", "enemy_lose_buff", "enemy_lose_debuff", "gain_block", "lose_block"];
export type AbilityTrigger = (typeof ABILITY_TRIGGERS)[number];
export declare const STATUS_TRIGGERS: readonly ["apply", "stack", "tick", "remove", "hold"];
export type StatusTrigger = (typeof STATUS_TRIGGERS)[number];
export type BattleTrigger = AbilityTrigger | StatusTrigger;
export declare const ABILITY_TRIGGER_SET: ReadonlySet<string>;
export declare const STATUS_TRIGGER_SET: ReadonlySet<string>;
export type RegisterableEffectTrigger = Exclude<AbilityTrigger, 'battle_start' | 'passive'>;
export declare const OUTER_LIFECYCLE_TRIGGER_SET: ReadonlySet<AbilityTrigger>;
export declare function isOuterLifecycleTrigger(value: unknown): value is 'battle_start' | 'passive';
/** Triggers that may be registered inside an effect AST. Outer lifecycle hooks stay excluded. */
export declare const REGISTERABLE_EFFECT_TRIGGERS: RegisterableEffectTrigger[];
export declare const REGISTERABLE_EFFECT_TRIGGER_SET: ReadonlySet<string>;
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
