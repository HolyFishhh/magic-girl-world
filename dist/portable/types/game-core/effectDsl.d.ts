import { type RegisterableEffectTrigger } from './battleTriggers';
import type { CardOrigin } from './cardIdentity';
import type { PlayedCardDestination } from './cardRules';
import type { CardCostOperator, CardKeyword, CardPatchScope } from './cardPatch';
import type { EnemyTargetSelector } from './combatantCollection';
import { type BattleEventJournalState, type CardMoveReason, type DamageKind, type EventCounterFilter, type EventHistoryMetric, type EventTriggerQuery, type HistoryScope } from './battleEventJournal';
import type { CardAttachmentKind, CardAttachmentRemovalEvent } from './cardAttachment';
import { type CardCost } from './combatResource';
import type { SummonOverflowPolicy, SummonSelector, SummonUnitDefinition } from './summonUnit';
export declare const EFFECT_PROGRAM_SPEC: "mwg.effect/v1";
export type EffectTarget = 'self' | 'opponent';
export type CardZone = 'hand' | 'draw' | 'discard' | 'exhaust' | 'all' | 'combat';
export type CardPick = 'random' | 'choose' | 'left' | 'right' | 'top' | 'bottom' | 'all';
export type CardType = 'Attack' | 'Skill' | 'Power' | 'Event' | 'Curse';
export type CardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Corrupt';
export type RecoverCardZone = 'draw' | 'discard' | 'exhaust';
export type EffectCardPileZone = 'hand' | 'drawPile' | 'discardPile' | 'exhaustPile';
export type ModifierStat = 'damage' | 'damage_taken' | 'lust' | 'lust_taken' | 'heal' | 'block' | 'summon_capacity';
export type EffectModifierOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set';
export type CardValueStat = 'damage' | 'block' | 'lust' | 'stacks';
export type CardValueOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type CardPlayRuleKind = 'replay' | 'free' | 'retain_hand' | 'retain_block' | 'limit_draw' | 'limit_block_gain' | 'limit_energy_gain' | 'deny_card_play' | 'allow_card_play' | 'limit_card_play' | 'card_destination';
export type EffectTrigger = RegisterableEffectTrigger;
export type EffectSchedulePhase = 'turn_start' | 'before_draw' | 'after_draw' | 'turn_end';
export interface CardSelector {
    zone: CardZone;
    pick: CardPick;
    count?: number;
    filter?: CardSelectorFilter;
}
export interface CardSelectorFilter {
    /** Exact visible card name. Distinct from template and instance identity. */
    name?: string;
    types?: CardType[];
    rarities?: CardRarity[];
    cost?: CardCost;
    minCost?: number;
    maxCost?: number;
    tags?: string[];
    templateId?: string;
    runInstanceId?: string;
    combatInstanceId?: string;
    origin?: CardOrigin;
    upgraded?: boolean;
    /** Select lineage roots only; temporary copied combat instances are excluded. */
    rootOnly?: boolean;
}
export type CardPatchMatch = 'instance' | 'run_instance' | 'template' | 'filter';
interface EffectCardPatchBase {
    scope: CardPatchScope;
    match?: CardPatchMatch;
    includeFutureCopies?: boolean;
}
export type EffectCardPatch = (EffectCardPatchBase & {
    kind: 'numeric';
    stat: CardValueStat;
    operator: CardValueOperator;
    value: NumericExpression;
}) | (EffectCardPatchBase & {
    kind: 'cost';
    operator: CardCostOperator;
    value: NumericExpression;
}) | (EffectCardPatchBase & {
    kind: 'keyword';
    keyword: CardKeyword;
    enabled: boolean;
}) | (EffectCardPatchBase & {
    kind: 'replay';
    extra: NumericExpression;
}) | (EffectCardPatchBase & {
    kind: 'x_value';
    operator: CardCostOperator;
    value: NumericExpression;
}) | (EffectCardPatchBase & {
    kind: 'dynamic_cost';
    timing: 'on_draw' | 'while_in_hand' | 'on_play';
    operator: CardCostOperator;
    value: NumericExpression;
    minimum?: number;
    maximum?: number;
});
export type EffectCardUpgradeChange = {
    kind: 'numeric';
    stat: CardValueStat;
    operator: CardValueOperator;
    value: NumericExpression;
} | {
    kind: 'cost';
    operator: CardCostOperator;
    value: NumericExpression;
} | {
    kind: 'keyword';
    keyword: CardKeyword;
    enabled: boolean;
} | {
    kind: 'replay';
    extra: NumericExpression;
} | {
    kind: 'x_value';
    operator: CardCostOperator;
    value: NumericExpression;
} | {
    kind: 'dynamic_cost';
    timing: 'on_draw' | 'while_in_hand' | 'on_play';
    operator: CardCostOperator;
    value: NumericExpression;
    minimum?: number;
    maximum?: number;
};
export type EffectCardAttachmentChange = EffectCardUpgradeChange | {
    kind: 'play_access';
    mode: 'deny' | 'allow';
} | {
    kind: 'discard_auto_play';
    reasons: CardMoveReason[];
    failureDestination: PlayedCardDestination;
    onlyPlayerTurn: boolean;
};
export interface EffectCardAttachmentDefinition {
    id: string;
    kind: CardAttachmentKind;
    name: string;
    description?: string;
    emoji?: string;
    scope: CardPatchScope;
    removeOn?: CardAttachmentRemovalEvent;
    remaining?: number;
    discardReasons?: CardMoveReason[];
    priority?: number;
    changes: EffectCardAttachmentChange[];
}
export interface GeneratedCardDefinition {
    id: string;
    name: string;
    emoji: string;
    type: CardType;
    rarity: CardRarity;
    cost?: CardCost;
    description: string;
    program: EffectProgram;
    discardProgram?: EffectProgram;
    retain?: boolean;
    exhaust?: boolean;
    ethereal?: boolean;
}
/** Mutually-exclusive combat mode carried by one combatant. */
export interface EffectStanceDefinition {
    id: string;
    name: string;
    emoji?: string;
    description?: string;
    enterEffects?: EffectNode[];
    exitEffects?: EffectNode[];
    passiveEffects?: EffectNode[];
}
/** Ordered slot entity with an independent value and passive/evoke programs. */
export interface EffectOrbDefinition {
    id: string;
    name: string;
    emoji?: string;
    description?: string;
    value: NumericExpression;
    passiveEffects?: EffectNode[];
    evokeEffects?: EffectNode[];
}
export interface EffectOrbSelector {
    pick: 'first' | 'last' | 'all';
    count?: number;
    id?: string;
}
export type EffectSummonDefinition = Omit<SummonUnitDefinition, 'statusEffects'>;
export type SummonValueStat = 'max_hp' | 'block' | 'actions_per_activation' | 'speed' | 'action_priority';
export type SummonValueOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set';
/**
 * JSON-safe authored enemy template carried by a spawn effect. The Tavern
 * adapter performs the same full content compilation used for initial MVU
 * enemies before admitting an instance into the live encounter.
 */
export interface EffectEnemySpawnDefinition {
    id: string;
    name: string;
    emoji: string;
    max_hp: number;
    hp?: number;
    max_lust?: number;
    lust?: number;
    block?: number;
    description?: string;
    actions: Array<Record<string, unknown>>;
    abilities?: Array<Record<string, unknown>>;
    status_effects?: Array<Record<string, unknown>>;
    lust_effect: Record<string, unknown>;
    action_mode?: string;
    action_config?: Record<string, unknown>;
    action_priority?: number;
    speed?: number;
    tags?: string[];
    resources?: Record<string, unknown>;
    stance?: Record<string, unknown> | null;
    orb_slots?: number;
    orbs?: Array<Record<string, unknown>>;
}
export type NumericExpression = number | {
    op: 'var';
    path: string;
} | BinaryNumericExpression | UnaryNumericExpression | {
    op: 'clamp_min';
    value: NumericExpression;
    minimum: number;
} | AggregateNumericExpression | {
    op: 'count_cards';
    selector: CardSelector;
} | {
    op: 'count_statuses';
    target: EffectTarget;
} | {
    op: 'history';
    metric: EventHistoryMetric;
    scope?: HistoryScope;
    turn?: number;
    cardInstanceId?: string;
    teamActorIds?: string[];
    filter?: EventCounterFilter;
} | {
    op: 'intent_value';
};
export type BinaryNumericExpression = {
    [TOperator in 'add' | 'subtract' | 'multiply' | 'divide']: {
        op: TOperator;
        left: NumericExpression;
        right: NumericExpression;
    };
}['add' | 'subtract' | 'multiply' | 'divide'];
export type UnaryNumericExpression = {
    [TOperator in 'negate' | 'floor' | 'ceil' | 'abs']: {
        op: TOperator;
        value: NumericExpression;
    };
}['negate' | 'floor' | 'ceil' | 'abs'];
export type AggregateNumericExpression = {
    [TOperator in 'min' | 'max']: {
        op: TOperator;
        values: NumericExpression[];
    };
}['min' | 'max'];
export type ConditionExpression = ComparisonCondition | {
    op: 'all' | 'any';
    conditions: ConditionExpression[];
} | {
    op: 'not';
    condition: ConditionExpression;
} | {
    op: 'last_card_type';
    cardType: CardType;
} | {
    op: 'intent_type';
    intentType: string;
};
export interface ComparisonCondition {
    op: 'compare';
    relation: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
    left: NumericExpression;
    right: NumericExpression;
}
export type EffectNode = {
    op: 'damage';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: NumericExpression;
    damageKind?: Exclude<DamageKind, 'execute'>;
    bypassBlock?: boolean;
    lifesteal?: NumericExpression;
} | {
    op: 'execute';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    threshold: NumericExpression;
    thresholdMode: 'hp' | 'hp_percent';
    excludeTags?: string[];
    triggerFatal?: boolean;
} | {
    op: 'kill';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    excludeTags?: string[];
    triggerFatal?: boolean;
} | {
    op: 'heal';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: NumericExpression;
} | {
    op: 'gain_block';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: NumericExpression;
} | {
    op: 'gain_energy';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: NumericExpression;
} | {
    op: 'gain_resource';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    resource: string;
    amount: NumericExpression;
} | {
    op: 'set_resource';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    resource: string;
    value: NumericExpression;
} | {
    op: 'gain_lust';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: NumericExpression;
} | {
    op: 'set_stat';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    stat: 'hp' | 'lust' | 'energy' | 'block';
    value: NumericExpression;
} | {
    op: 'apply_status';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    status: string;
    stacks: NumericExpression;
} | {
    op: 'remove_status';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    status: string;
} | {
    op: 'draw_cards';
    amount: NumericExpression;
} | {
    op: 'scry_cards';
    amount: NumericExpression;
} | {
    op: 'discard_cards';
    selector: CardSelector;
    amount: NumericExpression;
} | {
    op: 'exhaust_cards';
    selector: CardSelector;
    amount: NumericExpression;
} | {
    op: 'recover_cards';
    source: RecoverCardZone;
    pick: 'random' | 'choose' | 'all';
    amount: NumericExpression;
} | {
    op: 'reduce_card_cost';
    selector: CardSelector;
    amount: NumericExpression;
} | {
    op: 'modify_card_value';
    selector: CardSelector;
    stat: CardValueStat;
    operator: CardValueOperator;
    value: NumericExpression;
} | {
    op: 'copy_cards';
    selector: CardSelector;
} | {
    op: 'double_card_effect';
    selector: CardSelector;
} | {
    op: 'auto_play_cards';
    selector: CardSelector;
    free: boolean;
} | {
    op: 'set_card_destination';
    destination: PlayedCardDestination;
} | {
    op: 'move_cards';
    selector: CardSelector;
    amount: number;
    destination: EffectCardPileZone;
    position: 'top' | 'bottom';
} | {
    op: 'remove_cards';
    selector: CardSelector;
    amount: number;
} | {
    op: 'transform_cards';
    selector: CardSelector;
    replacement: GeneratedCardDefinition;
} | {
    op: 'apply_card_patch';
    selector: CardSelector;
    patch: EffectCardPatch;
} | {
    op: 'apply_card_attachment';
    selector: CardSelector;
    attachment: EffectCardAttachmentDefinition;
} | {
    op: 'upgrade_cards';
    selector: CardSelector;
    scope: 'combat' | 'run' | 'permanent';
    levels: number;
    maxLevel?: number;
    changes: EffectCardUpgradeChange[];
} | {
    op: 'add_card';
    zone: 'hand' | 'draw';
    card: GeneratedCardDefinition;
    count: number;
} | {
    op: 'ensure_card';
    zone: 'hand' | 'draw';
    card: GeneratedCardDefinition;
    minimum: number;
    includeCopies?: boolean;
} | {
    op: 'spawn_summon';
    target: EffectTarget;
    summon: EffectSummonDefinition;
    count: NumericExpression;
    capacity?: number;
    overflow?: SummonOverflowPolicy;
} | {
    op: 'spawn_enemy';
    enemy: EffectEnemySpawnDefinition;
    count: NumericExpression;
    /** Maximum simultaneously living enemies after this effect resolves. */
    capacity?: number;
} | {
    op: 'damage_summons';
    selector: SummonSelector;
    amount: NumericExpression;
} | {
    op: 'heal_summons';
    selector: SummonSelector;
    amount: NumericExpression;
} | {
    op: 'modify_summons';
    selector: SummonSelector;
    stat: SummonValueStat;
    operator: SummonValueOperator;
    value: NumericExpression;
} | {
    op: 'modify_summon_effects';
    selector: SummonSelector;
    stat: CardValueStat;
    operator: CardValueOperator;
    value: NumericExpression;
} | {
    op: 'gain_summon_resource';
    selector: SummonSelector;
    resource: string;
    amount: NumericExpression;
} | {
    op: 'set_summon_resource';
    selector: SummonSelector;
    resource: string;
    value: NumericExpression;
} | {
    op: 'apply_summon_status';
    selector: SummonSelector;
    status: string;
    stacks: NumericExpression;
} | {
    op: 'remove_summon_status';
    selector: SummonSelector;
    status: string;
} | {
    op: 'activate_summons';
    selector: SummonSelector;
} | {
    op: 'dismiss_summons';
    selector: SummonSelector;
    retainCorpse?: boolean;
} | {
    op: 'copy_summons';
    selector: SummonSelector;
    targetOwner?: 'same' | EffectTarget;
    capacity?: number;
    overflow?: SummonOverflowPolicy;
}
/**
 * Resolve a nested program against the combatant who owns the active summon.
 * Ordinary summon `self` remains the exact summon; authors opt in explicitly
 * when a passive/action should grant its summoner block, energy, statuses, etc.
 */
 | {
    op: 'summoner_effects';
    effects: EffectNode[];
} | {
    op: 'modify';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    stat: ModifierStat;
    operator: EffectModifierOperator;
    value: NumericExpression;
} | {
    op: 'card_play_rule';
    target: EffectTarget;
    rule: CardPlayRuleKind;
    limit?: NumericExpression | 'all';
    extra?: NumericExpression;
    selector?: CardSelector;
    destination?: PlayedCardDestination;
    priority?: number;
    /** all waives every component; a list waives only those resource IDs. */
    freeResources?: 'all' | string[];
} | {
    op: 'set_stance';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    stance: EffectStanceDefinition | null;
} | {
    op: 'channel_orb';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    orb: EffectOrbDefinition;
} | {
    op: 'evoke_orbs';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    selector: EffectOrbSelector;
} | {
    op: 'set_orb_slots';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: NumericExpression;
} | {
    op: 'modify_orbs';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    selector: EffectOrbSelector;
    operator: CardValueOperator;
    value: NumericExpression;
} | {
    op: 'grant_extra_turn';
    target: EffectTarget;
    amount: NumericExpression;
} | {
    op: 'force_end_turn';
    target: EffectTarget;
} | {
    op: 'register_trigger';
    target: EffectTarget;
    trigger: EffectTrigger;
    eventQuery?: EventTriggerQuery;
    effects: EffectNode[];
} | {
    op: 'schedule_effect';
    afterTurns: number;
    phase: EffectSchedulePhase;
    priority?: number;
    repeatEvery?: number;
    repeats?: number;
    effects: EffectNode[];
} | {
    op: 'choose_one';
    choiceId: string;
    options: EffectChoiceOption[];
} | {
    op: 'if';
    condition: ConditionExpression;
    then: EffectNode[];
    else?: EffectNode[];
} | {
    op: 'narrate';
    text: string;
};
export interface EffectChoiceOption {
    id: string;
    label: string;
    effects: EffectNode[];
}
export interface EffectProgram {
    spec: typeof EFFECT_PROGRAM_SPEC;
    steps: EffectNode[];
}
export interface CoreCombatantState {
    hp: number;
    maxHp: number;
    lust: number;
    maxLust: number;
    energy: number;
    maxEnergy: number;
    block: number;
    handSize?: number;
    drawPileSize?: number;
    discardPileSize?: number;
    exhaustPileSize?: number;
    statusStacks?: Record<string, number>;
    resources?: Record<string, number>;
    maxResources?: Record<string, number>;
    tags?: string[];
}
export interface CoreEffectState {
    self: CoreCombatantState;
    opponent: CoreCombatantState;
    currentTurn: number;
    cardsPlayedThisTurn: number;
    attacksPlayedThisTurn: number;
    skillsPlayedThisTurn: number;
    cardZones?: {
        hand: CoreCardView[];
        draw: CoreCardView[];
        discard: CoreCardView[];
        exhaust: CoreCardView[];
    };
    history?: {
        lastDamage?: number;
        lastHpLoss?: number;
        lastHeal?: number;
        lastResourceSpent?: number;
        lastCardType?: string;
        /** Full structured history enables filtered counters and recent-event reads. */
        eventJournal?: BattleEventJournalState;
    };
    enemyIntentValue?: number;
    enemyIntentType?: string;
}
export interface CoreCardView {
    id: string;
    name?: string;
    type?: CardType;
    rarity?: CardRarity;
    cost?: CardCost;
    tags?: string[];
    originalId?: string;
    templateId?: string;
    runInstanceId?: string;
    combatInstanceId?: string;
    origin?: CardOrigin;
    upgraded?: boolean;
    upgradeLevel?: number;
}
export interface EffectExecutionContext {
    spentEnergy: number;
    spentResources?: Readonly<Record<string, number>>;
    xValues?: Readonly<Record<string, number>>;
    xValue?: number;
    statusStacks?: number;
    orbValue?: number;
    choiceSelections?: Readonly<Record<string, string>>;
}
export interface EffectValidationIssue {
    path: string;
    code: string;
    message: string;
}
export type EffectValidationResult = {
    ok: true;
    value: EffectProgram;
} | {
    ok: false;
    issues: EffectValidationIssue[];
};
export type CoreEffectEvent = {
    type: 'damage';
    target: EffectTarget;
    requested: number;
    blocked: number;
    hpLost: number;
    damageKind?: Exclude<DamageKind, 'execute'>;
    bypassBlock?: boolean;
    lifesteal?: number;
} | {
    type: 'defeat';
    target: EffectTarget;
    method: 'execute' | 'kill';
    succeeded: boolean;
    previousHp: number;
    threshold?: number;
    thresholdMode?: 'hp' | 'hp_percent';
    fatal: boolean;
    excludedBy?: string;
} | {
    type: 'heal';
    target: EffectTarget;
    requested: number;
    hpGained: number;
} | {
    type: 'gain_block';
    target: EffectTarget;
    amount: number;
} | {
    type: 'gain_energy';
    target: EffectTarget;
    amount: number;
} | {
    type: 'gain_resource';
    target: EffectTarget;
    resource: string;
    amount: number;
} | {
    type: 'set_resource';
    target: EffectTarget;
    resource: string;
    value: number;
} | {
    type: 'gain_lust';
    target: EffectTarget;
    amount: number;
} | {
    type: 'set_stat';
    target: EffectTarget;
    stat: 'hp' | 'lust' | 'energy' | 'block';
    value: number;
} | {
    type: 'apply_status';
    target: EffectTarget;
    status: string;
    stacks: number;
} | {
    type: 'remove_status';
    target: EffectTarget;
    status: string;
} | {
    type: 'draw_cards';
    amount: number;
} | {
    type: 'scry_cards';
    amount: number;
} | {
    type: 'discard_cards' | 'exhaust_cards';
    selector: CardSelector;
    amount: number;
} | {
    type: 'recover_cards';
    source: RecoverCardZone;
    pick: 'random' | 'choose' | 'all';
    amount: number;
} | {
    type: 'reduce_card_cost';
    selector: CardSelector;
    amount: number;
} | {
    type: 'modify_card_value';
    selector: CardSelector;
    stat: CardValueStat;
    operator: CardValueOperator;
    value: number;
} | {
    type: 'copy_cards' | 'double_card_effect';
    selector: CardSelector;
} | {
    type: 'auto_play_cards';
    selector: CardSelector;
    free: boolean;
} | {
    type: 'set_card_destination';
    destination: PlayedCardDestination;
} | {
    type: 'move_cards';
    selector: CardSelector;
    amount: number;
    destination: EffectCardPileZone;
    position: 'top' | 'bottom';
} | {
    type: 'remove_cards';
    selector: CardSelector;
    amount: number;
} | {
    type: 'transform_cards';
    selector: CardSelector;
    replacement: GeneratedCardDefinition;
} | {
    type: 'apply_card_patch';
    selector: CardSelector;
    patch: EffectCardPatch;
} | {
    type: 'apply_card_attachment';
    selector: CardSelector;
    attachment: EffectCardAttachmentDefinition;
} | {
    type: 'upgrade_cards';
    selector: CardSelector;
    scope: 'combat' | 'run' | 'permanent';
    levels: number;
    maxLevel?: number;
    changes: EffectCardUpgradeChange[];
} | {
    type: 'add_card';
    zone: 'hand' | 'draw';
    card: GeneratedCardDefinition;
    count: number;
} | {
    type: 'ensure_card';
    zone: 'hand' | 'draw';
    card: GeneratedCardDefinition;
    minimum: number;
    includeCopies: boolean;
} | {
    type: 'spawn_summon';
    target: EffectTarget;
    summon: EffectSummonDefinition;
    count: number;
    capacity: number;
    overflow: SummonOverflowPolicy;
} | {
    type: 'spawn_enemy';
    enemy: EffectEnemySpawnDefinition;
    count: number;
    capacity: number;
} | {
    type: 'damage_summons' | 'heal_summons';
    selector: SummonSelector;
    amount: number;
} | {
    type: 'modify_summons';
    selector: SummonSelector;
    stat: SummonValueStat;
    operator: SummonValueOperator;
    value: number;
} | {
    type: 'modify_summon_effects';
    selector: SummonSelector;
    stat: CardValueStat;
    operator: CardValueOperator;
    value: number;
} | {
    type: 'gain_summon_resource';
    selector: SummonSelector;
    resource: string;
    amount: number;
} | {
    type: 'set_summon_resource';
    selector: SummonSelector;
    resource: string;
    value: number;
} | {
    type: 'apply_summon_status';
    selector: SummonSelector;
    status: string;
    stacks: number;
} | {
    type: 'remove_summon_status';
    selector: SummonSelector;
    status: string;
} | {
    type: 'activate_summons';
    selector: SummonSelector;
} | {
    type: 'dismiss_summons';
    selector: SummonSelector;
    retainCorpse: boolean;
} | {
    type: 'copy_summons';
    selector: SummonSelector;
    targetOwner: 'same' | EffectTarget;
    capacity: number;
    overflow: SummonOverflowPolicy;
} | {
    type: 'summoner_effects';
    effects: EffectNode[];
} | {
    type: 'modify';
    target: EffectTarget;
    stat: ModifierStat;
    operator: EffectModifierOperator;
    value: number;
} | {
    type: 'card_play_rule';
    target: EffectTarget;
    rule: CardPlayRuleKind;
    limit?: number | 'all';
    extra: number;
    selector?: CardSelector;
    destination?: PlayedCardDestination;
    priority: number;
    freeResources?: 'all' | string[];
} | {
    type: 'set_stance';
    target: EffectTarget;
    stance: EffectStanceDefinition | null;
} | {
    type: 'channel_orb';
    target: EffectTarget;
    orb: EffectOrbDefinition;
} | {
    type: 'evoke_orbs';
    target: EffectTarget;
    selector: EffectOrbSelector;
} | {
    type: 'set_orb_slots';
    target: EffectTarget;
    amount: number;
} | {
    type: 'modify_orbs';
    target: EffectTarget;
    selector: EffectOrbSelector;
    operator: CardValueOperator;
    value: number;
} | {
    type: 'grant_extra_turn';
    target: EffectTarget;
    amount: number;
} | {
    type: 'force_end_turn';
    target: EffectTarget;
} | {
    type: 'register_trigger';
    target: EffectTarget;
    trigger: EffectTrigger;
    eventQuery?: EventTriggerQuery;
    effects: EffectNode[];
} | {
    type: 'schedule_effect';
    afterTurns: number;
    phase: EffectSchedulePhase;
    priority: number;
    repeatEvery?: number;
    repeats?: number;
    effects: EffectNode[];
} | {
    type: 'choice_selected';
    choiceId: string;
    optionId: string;
    label: string;
} | {
    type: 'narration';
    text: string;
};
export type EffectExecutionResult = {
    ok: true;
    state: CoreEffectState;
    events: CoreEffectEvent[];
} | {
    ok: false;
    error: EffectExecutionError;
    state: CoreEffectState;
    events: [];
};
export declare class EffectExecutionError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
export declare function isSupportedVariablePath(path: string): boolean;
export declare function validateEffectProgram(value: unknown): EffectValidationResult;
export declare function resolveNumericVariable(path: string, state: CoreEffectState, context: EffectExecutionContext): number;
export declare function evaluateNumericExpression(expression: NumericExpression, state: CoreEffectState, context: EffectExecutionContext, path?: string): number;
export declare function evaluateConditionExpression(condition: ConditionExpression, state: CoreEffectState, context: EffectExecutionContext, path?: string): boolean;
export declare function executeEffectProgram(value: unknown, inputState: CoreEffectState, context: EffectExecutionContext): EffectExecutionResult;
export {};
