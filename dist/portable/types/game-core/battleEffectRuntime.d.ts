import { type BattleSide, type BattleTriggerDispatch } from './battleEventDispatch';
import type { Enemy, Player } from './battleState';
import type { EffectCommand } from './effectCommandRuntime';
import { MODIFIER_ATTRIBUTE_BY_STAT, type ModifierOperation } from './modifierMath';
export type BattleEffectCommand = Extract<EffectCommand, {
    type: 'damage' | 'heal' | 'gain_block' | 'gain_energy' | 'gain_lust' | 'set_stat' | 'modify';
}>;
export type BattleEffectAttribute = 'hp' | 'lust' | 'energy' | 'block';
export type BattleModifierAttribute = (typeof MODIFIER_ATTRIBUTE_BY_STAT)[keyof typeof MODIFIER_ATTRIBUTE_BY_STAT];
export interface BattleModifierSource {
    operation: ModifierOperation;
    name: string;
    stacks?: number;
}
export type BattleEffectRuntimeEvent = {
    type: 'modifier_applied';
    target: BattleSide;
    modifier: BattleModifierAttribute;
    source: BattleModifierSource;
    previousValue: number;
    nextValue: number;
} | {
    type: 'block_absorbed';
    target: BattleSide;
    amount: number;
} | {
    type: 'damage_resolved';
    source: BattleSide;
    target: BattleSide;
    requested: number;
    modified: number;
    blocked: number;
    hpLost: number;
    damageKind: import('./battleEventJournal').DamageKind;
} | {
    type: 'heal_resolved';
    source: BattleSide;
    target: BattleSide;
    requested: number;
    modified: number;
    hpGained: number;
} | {
    type: 'attribute_changed';
    target: BattleSide;
    attribute: BattleEffectAttribute;
    previousValue: number;
    nextValue: number;
} | {
    type: 'attribute_logged';
    target: BattleSide;
    attribute: BattleEffectAttribute;
    previousValue: number;
    nextValue: number;
} | {
    type: 'direct_modifier_changed';
    target: BattleSide;
    modifier: BattleModifierAttribute;
    operation: ModifierOperation;
    previousValue: number;
    nextValue: number;
};
export interface BattleEffectStatePort {
    getPlayer(): Player;
    getEnemy(): Enemy | null;
    getEnemyById?(enemyId: string): Enemy | null;
    updatePlayer(updates: Partial<Player>): void;
    updateEnemy(updates: Partial<Enemy>): void;
    updateEnemyById?(enemyId: string, updates: Partial<Enemy>): void;
}
export interface BattleEffectRuntimePorts {
    readModifierSources(target: BattleSide, modifier: BattleModifierAttribute): readonly BattleModifierSource[];
    dispatchTriggers(dispatches: readonly BattleTriggerDispatch[]): Promise<void>;
    handleLustOverflow(target: BattleSide): Promise<void>;
    present?(event: BattleEffectRuntimeEvent): void;
}
export interface BattleEffectRuntimeContext {
    source: BattleSide;
    damageKind?: import('./battleEventJournal').DamageKind;
}
export interface BattleEffectRuntimeResult {
    applied: boolean;
    target?: BattleSide;
    pendingDeath?: boolean;
}
export declare function isBattleEffectCommand(command: EffectCommand): command is BattleEffectCommand;
export declare function resolveBattleEffectTarget(target: 'self' | 'opponent', source: BattleSide): BattleSide;
/** Host-independent execution for modern numeric battle commands. */
export declare class BattleEffectRuntime {
    private readonly state;
    private readonly ports;
    constructor(state: BattleEffectStatePort, ports: BattleEffectRuntimePorts);
    execute(command: BattleEffectCommand, context: BattleEffectRuntimeContext): Promise<BattleEffectRuntimeResult>;
    private getEntity;
    private updateEntity;
    private modifierSources;
    private applyModifiers;
    private executeAttribute;
    private executeModifier;
}
