import { type RegisterableEffectTrigger } from './battleTriggers';
import type { CardOrigin } from './cardIdentity';
import type { PlayedCardDestination } from './cardRules';
import type { CardCostOperator, CardKeyword, CardPatchScope } from './cardPatch';
import type { EnemyTargetSelector } from './combatantCollection';
export declare const EFFECT_PROGRAM_SPEC: "mwg.effect/v1";
export type EffectTarget = 'self' | 'opponent';
export type CardZone = 'hand' | 'draw' | 'discard' | 'exhaust' | 'all';
export type CardPick = 'random' | 'choose' | 'left' | 'right' | 'top' | 'bottom' | 'all';
export type CardType = 'Attack' | 'Skill' | 'Power' | 'Event' | 'Curse';
export type CardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Corrupt';
export type RecoverCardZone = 'draw' | 'discard' | 'exhaust';
export type EffectCardPileZone = 'hand' | 'drawPile' | 'discardPile' | 'exhaustPile';
export type ModifierStat = 'damage' | 'damage_taken' | 'lust' | 'lust_taken' | 'heal' | 'block';
export type EffectModifierOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set';
export type CardValueStat = 'damage' | 'block' | 'lust' | 'stacks';
export type CardValueOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type CardPlayRuleKind = 'replay' | 'free';
export type EffectTrigger = RegisterableEffectTrigger;
export type EffectSchedulePhase = 'turn_start' | 'before_draw' | 'after_draw' | 'turn_end';
export interface CardSelector {
    zone: CardZone;
    pick: CardPick;
    count?: number;
    filter?: CardSelectorFilter;
}
export interface CardSelectorFilter {
    types?: CardType[];
    rarities?: CardRarity[];
    cost?: number | 'energy';
    minCost?: number;
    maxCost?: number;
    tags?: string[];
    templateId?: string;
    runInstanceId?: string;
    combatInstanceId?: string;
    origin?: CardOrigin;
    upgraded?: boolean;
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
export interface GeneratedCardDefinition {
    id: string;
    name: string;
    emoji: string;
    type: CardType;
    rarity: CardRarity;
    cost?: number | 'energy';
    description: string;
    program: EffectProgram;
    discardProgram?: EffectProgram;
    retain?: boolean;
    exhaust?: boolean;
    ethereal?: boolean;
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
    metric: 'last_damage' | 'last_hp_loss' | 'last_heal' | 'last_resource_spent';
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
    op: 'add_card';
    zone: 'hand' | 'draw';
    card: GeneratedCardDefinition;
    count: number;
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
    limit: NumericExpression | 'all';
    extra?: NumericExpression;
} | {
    op: 'register_trigger';
    target: EffectTarget;
    trigger: EffectTrigger;
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
    op: 'if';
    condition: ConditionExpression;
    then: EffectNode[];
    else?: EffectNode[];
} | {
    op: 'narrate';
    text: string;
};
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
    };
    enemyIntentValue?: number;
}
export interface CoreCardView {
    id: string;
    type?: CardType;
    rarity?: CardRarity;
    cost?: number | 'energy';
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
    xValue?: number;
    statusStacks?: number;
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
    type: 'add_card';
    zone: 'hand' | 'draw';
    card: GeneratedCardDefinition;
    count: number;
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
    limit: number | 'all';
    extra: number;
} | {
    type: 'register_trigger';
    target: EffectTarget;
    trigger: EffectTrigger;
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
