import { type CardSelector, type CardPlayRuleKind, type CardValueOperator, type CardValueStat, type CoreEffectState, type EffectExecutionContext, type EffectCardPatch, type EffectSchedulePhase, type EffectCardPileZone, type EffectModifierOperator, type EffectNode, type EffectTarget, type EffectTrigger, type GeneratedCardDefinition, type ModifierStat, type RecoverCardZone } from './effectDsl';
import type { EnemyTargetSelector } from './combatantCollection';
export type EffectCommand = {
    type: 'damage' | 'heal' | 'gain_block' | 'gain_energy' | 'gain_lust';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: number;
} | {
    type: 'set_stat';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    stat: 'hp' | 'lust' | 'energy' | 'block';
    value: number;
} | {
    type: 'apply_status';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    status: string;
    stacks: number;
} | {
    type: 'remove_status';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    status: string;
} | {
    type: 'draw_cards';
    amount: number;
} | {
    type: 'scry_cards';
    amount: number;
} | {
    type: 'discard_cards';
    selector: CardSelector;
    amount: number;
} | {
    type: 'exhaust_cards';
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
    type: 'copy_cards';
    selector: CardSelector;
} | {
    type: 'double_card_effect';
    selector: CardSelector;
} | {
    type: 'auto_play_cards';
    selector: CardSelector;
    free: boolean;
} | {
    type: 'set_card_destination';
    destination: import('./cardRules').PlayedCardDestination;
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
    targetSelector?: EnemyTargetSelector;
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
export interface EffectCommandRuntimePorts {
    readState(): CoreEffectState;
    execute(command: EffectCommand, path: string): void | Promise<void>;
    isTerminal?(): boolean;
}
export interface EffectCommandRuntimeResult {
    completed: boolean;
    commands: EffectCommand[];
    stoppedAfter?: string;
}
/**
 * Resolve a validated effect program one step at a time against the latest host state.
 * The core owns order, branching and formulas; the host owns animations, choices and persistence.
 */
export declare function runEffectCommandProgram(value: unknown, context: EffectExecutionContext, ports: EffectCommandRuntimePorts): Promise<EffectCommandRuntimeResult>;
