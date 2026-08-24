import { type CardSelector, type CoreEffectState, type EffectExecutionContext, type EffectModifierOperator, type EffectNode, type EffectTarget, type EffectTrigger, type GeneratedCardDefinition, type ModifierStat, type RecoverCardZone } from './effectDsl';
export type EffectCommand = {
    type: 'damage' | 'heal' | 'gain_block' | 'gain_energy' | 'gain_lust';
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
    type: 'copy_cards';
    selector: CardSelector;
} | {
    type: 'double_card_effect';
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
