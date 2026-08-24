import { type RegisterableEffectTrigger } from './battleTriggers';
export declare const EFFECT_PROGRAM_SPEC: "mwg.effect/v1";
export type EffectTarget = 'self' | 'opponent';
export type CardZone = 'hand' | 'draw' | 'discard' | 'all';
export type CardPick = 'random' | 'choose' | 'left' | 'right' | 'all';
export type RecoverCardZone = 'draw' | 'discard' | 'exhaust';
export type ModifierStat = 'damage' | 'damage_taken' | 'lust' | 'lust_taken' | 'heal' | 'block';
export type EffectModifierOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set';
export type EffectTrigger = RegisterableEffectTrigger;
export interface CardSelector {
    zone: CardZone;
    pick: CardPick;
    count?: number;
}
export interface GeneratedCardDefinition {
    id: string;
    name: string;
    emoji: string;
    type: 'Attack' | 'Skill' | 'Power' | 'Event' | 'Curse';
    rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Corrupt';
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
} | BinaryNumericExpression | {
    op: 'negate';
    value: NumericExpression;
};
export interface BinaryNumericExpression {
    op: 'add' | 'subtract' | 'multiply' | 'divide';
    left: NumericExpression;
    right: NumericExpression;
}
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
    amount: NumericExpression;
} | {
    op: 'heal';
    target: EffectTarget;
    amount: NumericExpression;
} | {
    op: 'gain_block';
    target: EffectTarget;
    amount: NumericExpression;
} | {
    op: 'gain_energy';
    target: EffectTarget;
    amount: NumericExpression;
} | {
    op: 'gain_lust';
    target: EffectTarget;
    amount: NumericExpression;
} | {
    op: 'set_stat';
    target: EffectTarget;
    stat: 'hp' | 'lust' | 'energy' | 'block';
    value: NumericExpression;
} | {
    op: 'apply_status';
    target: EffectTarget;
    status: string;
    stacks: NumericExpression;
} | {
    op: 'remove_status';
    target: EffectTarget;
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
    op: 'copy_cards';
    selector: CardSelector;
} | {
    op: 'double_card_effect';
    selector: CardSelector;
} | {
    op: 'add_card';
    zone: 'hand' | 'draw';
    card: GeneratedCardDefinition;
    count: number;
} | {
    op: 'modify';
    target: EffectTarget;
    stat: ModifierStat;
    operator: EffectModifierOperator;
    value: NumericExpression;
} | {
    op: 'register_trigger';
    target: EffectTarget;
    trigger: EffectTrigger;
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
}
export interface EffectExecutionContext {
    spentEnergy: number;
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
    type: 'copy_cards' | 'double_card_effect';
    selector: CardSelector;
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
    type: 'register_trigger';
    target: EffectTarget;
    trigger: EffectTrigger;
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
