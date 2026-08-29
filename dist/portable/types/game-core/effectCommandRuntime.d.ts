import { type CardSelector, type CardPlayRuleKind, type CardValueOperator, type CardValueStat, type CoreEffectState, type EffectExecutionContext, type EffectCardPatch, type EffectCardAttachmentDefinition, type EffectCardUpgradeChange, type EffectSchedulePhase, type EffectStanceDefinition, type EffectOrbDefinition, type EffectOrbSelector, type EffectCardPileZone, type EffectModifierOperator, type EffectNode, type EffectTarget, type EffectTrigger, type GeneratedCardDefinition, type ModifierStat, type RecoverCardZone, type EffectSummonDefinition, type EffectEnemySpawnDefinition, type SummonValueOperator, type SummonValueStat } from './effectDsl';
import type { EnemyTargetSelector } from './combatantCollection';
import type { SummonOverflowPolicy, SummonSelector } from './summonUnit';
import type { CardAttachmentChange } from './cardAttachment';
export type ResolvedEffectCardAttachmentDefinition = Omit<EffectCardAttachmentDefinition, 'changes'> & {
    changes: CardAttachmentChange[];
};
export type EffectCommand = {
    type: 'damage';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: number;
    damageKind?: Exclude<import('./battleEventJournal').DamageKind, 'execute'>;
    bypassBlock?: boolean;
    lifesteal?: number;
} | {
    type: 'execute';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    threshold: number;
    thresholdMode: 'hp' | 'hp_percent';
    excludeTags?: string[];
    triggerFatal: boolean;
} | {
    type: 'kill';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    excludeTags?: string[];
    triggerFatal: boolean;
} | {
    type: 'heal' | 'gain_block' | 'gain_energy' | 'gain_lust';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: number;
} | {
    type: 'gain_resource';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    resource: string;
    amount: number;
} | {
    type: 'set_resource';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    resource: string;
    value: number;
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
    type: 'apply_card_attachment';
    selector: CardSelector;
    attachment: ResolvedEffectCardAttachmentDefinition;
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
    targetSelector?: EnemyTargetSelector;
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
    destination?: import('./cardRules').PlayedCardDestination;
    priority: number;
    freeResources?: 'all' | string[];
} | {
    type: 'set_stance';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    stance: EffectStanceDefinition | null;
} | {
    type: 'channel_orb';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    orb: EffectOrbDefinition;
} | {
    type: 'evoke_orbs';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    selector: EffectOrbSelector;
} | {
    type: 'set_orb_slots';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
    amount: number;
} | {
    type: 'modify_orbs';
    target: EffectTarget;
    targetSelector?: EnemyTargetSelector;
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
    eventQuery?: import('./battleEventJournal').EventTriggerQuery;
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
export interface EffectCommandRuntimePorts {
    readState(): CoreEffectState;
    execute(command: EffectCommand, path: string): void | Promise<void>;
    isTerminal?(): boolean;
    chooseEffectOption?(choice: Extract<EffectNode, {
        op: 'choose_one';
    }>, path: string): string | null | Promise<string | null>;
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
