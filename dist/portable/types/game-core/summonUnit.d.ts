import type { CombatResourceState } from './combatResource';
import type { EventTriggerQuery } from './battleEventJournal';
import type { BattleTriggerDispatch } from './battleEventDispatch';
import type { BattleTriggerEventContext } from './battleEventJournal';
import type { CardValueOperator, CardValueStat, EffectProgram } from './effectDsl';
import { type StatusReceiveOptions } from './statusAction';
import type { RuntimeStatusDefinition, StatusRuntimeEffect, StatusTickTiming } from './statusDefinitionRuntime';
import type { StatusEventTrigger, StatusTrigger } from './battleTriggers';
import { type TriggerTransactionPorts } from './triggerTransaction';
export type BattleOwner = 'player' | 'enemy';
export type SummonOverflowPolicy = 'reject' | 'replace_oldest' | 'replace_lowest_hp';
export type SummonPick = 'left' | 'right' | 'choose'
/** Compatibility aliases retained for already-authored content. */
 | 'first' | 'last' | 'random' | 'random_n' | 'all' | 'lowest_hp' | 'highest_hp' | 'by_id' | 'source';
export interface SummonStatusState {
    interceptionUses?: import('./interception').InterceptionUsage;
    id: string;
    name: string;
    emoji: string;
    description: string;
    type: 'buff' | 'debuff' | 'neutral';
    stacks: number;
    duration?: number;
}
export interface SummonInterceptRule {
    /** Intercept after the protected combatant's vulnerability, before recipient mitigation/block. */
    mode: 'unblocked_attack';
    priority?: number;
    maxPerTurn?: number;
}
/** One selectable autonomous behaviour. `weight` is relative and never fixes a theme. */
export interface SummonActionDefinition {
    id: string;
    name: string;
    emoji?: string;
    description?: string;
    dialogue?: string;
    weight?: number;
    /** Fixed entries ignore summon effect-value amplification. */
    fixed?: boolean;
    effectProgram: EffectProgram;
}
/** A summon-local trigger. It observes its owner's battle events and executes as this exact summon. */
export interface SummonAbilityDefinition {
    id: string;
    name?: string;
    emoji?: string;
    description?: string;
    trigger: string;
    eventQuery?: EventTriggerQuery;
    /** Fixed entries ignore summon effect-value amplification. */
    fixed?: boolean;
    effectProgram: EffectProgram;
}
export interface SummonUnitDefinition {
    id: string;
    name: string;
    emoji: string;
    description?: string;
    /** Defaults to true. HP-less units act and trigger but cannot intercept, take damage, or be healed. */
    hasHp?: boolean;
    maxHp?: number;
    block?: number;
    tags?: string[];
    statusEffects?: SummonStatusState[];
    resources?: Record<string, CombatResourceState>;
    modifiers?: Record<string, number>;
    /** Compatibility action used by existing content. New content may provide weighted `actions`. */
    actionProgram?: EffectProgram;
    actions?: SummonActionDefinition[];
    abilities?: SummonAbilityDefinition[];
    actionsPerActivation?: number;
    actionPriority?: number;
    speed?: number;
    intercept?: SummonInterceptRule;
    /** Optional owner-local slot. A slot can model a persistent companion without constraining ordinary summons. */
    slot?: string;
    onExisting?: 'add_instance' | 'reinforce' | 'replace';
    onExistingProgram?: EffectProgram;
    onDefeated?: 'new_instance' | 'revive_reset' | 'revive_reinforce';
    retainCorpse?: boolean;
    capabilities?: {
        selectable?: boolean;
        acceptsStatus?: boolean;
        acts?: boolean;
        intercepts?: boolean;
    };
}
export interface SummonUnit extends Omit<SummonUnitDefinition, 'id' | 'maxHp'> {
    id: string;
    templateId: string;
    instanceId: string;
    owner: BattleOwner;
    /** Program-owned combatant identity, never authored in a summon definition.
     * Missing legacy enemy identity is unknown, not the currently selected enemy. */
    summonerId?: string | null;
    maxHp: number;
    currentHp: number;
    createdTurn: number;
    createdSequence: number;
    interceptionsThisTurn: number;
    /**
     * Chosen before this unit's next activation.  This records the behaviour
     * identity only: effect programs still come from the current runtime unit,
     * so buffs, statuses and formula inputs remain live when it resolves.
     */
    plannedActionIds?: string[];
}
export interface SummonCollectionState {
    living: SummonUnit[];
    defeated: SummonUnit[];
    nextSequence: number;
}
export interface SummonSelector {
    owner: 'self' | 'opponent' | 'any';
    pick: SummonPick;
    count?: number;
    id?: string;
    templateId?: string;
    tags?: string[];
    slot?: string;
    /** Internal companion commands may address a unit that ordinary target selection cannot. */
    includeUntargetable?: boolean;
}
export interface SummonActionQueueEntry {
    summonId: string;
    owner: BattleOwner;
    actionIndex: number;
    priority: number;
    speed: number;
    createdSequence: number;
}
export interface ResolvedSummonAction {
    dialogue?: string;
    id: string;
    name: string;
    emoji: string;
    description?: string;
    fixed?: boolean;
    effectProgram: EffectProgram;
}
export interface SummonDamageResult {
    state: SummonCollectionState;
    hits: Array<{
        summonId: string;
        requested: number;
        modified?: number;
        blocked: number;
        hpLost: number;
        prevented?: number;
        defeated: boolean;
    }>;
}
export interface SummonCopyResult {
    state: SummonCollectionState;
    copied: SummonUnit[];
    replaced: SummonUnit[];
}
type MaybePromise<T> = T | Promise<T>;
export type SummonStatusLifecycleTrigger = 'apply' | 'stack' | 'tick' | 'remove';
export type SummonStatusExecutableTrigger = SummonStatusLifecycleTrigger | StatusEventTrigger;
export interface SummonStatusLifecycleExecutionContext extends Readonly<Record<string, unknown>> {
    triggerType: SummonStatusExecutableTrigger;
    statusContext: SummonStatusState;
    /** The exact holder. Hosts must keep ordinary `self` effects bound to this unit. */
    summonContext: SummonUnit;
    summonStatusContext: {
        summonId: string;
    };
}
export type SummonStatusLifecycleEvent = {
    type: 'missing_definition';
    summonId: string;
    statusId: string;
} | {
    type: 'status_applied';
    summon: SummonUnit;
    status: SummonStatusState;
    trigger: 'apply' | 'stack';
} | {
    type: 'trigger_started';
    summon: SummonUnit;
    status: SummonStatusState;
    trigger: SummonStatusExecutableTrigger;
} | {
    type: 'trigger_completed';
    summon: SummonUnit;
    status: SummonStatusState;
    trigger: SummonStatusExecutableTrigger;
} | {
    type: 'status_removed';
    summon: SummonUnit;
    status: SummonStatusState;
    reason: 'explicit' | 'decay';
} | {
    type: 'trigger_failed';
    summon: SummonUnit;
    status: SummonStatusState;
    trigger: SummonStatusExecutableTrigger;
    cause: unknown;
};
export interface SummonStatusDefinitionReader {
    get(statusId: string): RuntimeStatusDefinition | undefined;
    getTriggerEffects(statusId: string, trigger: StatusTrigger): StatusRuntimeEffect[];
}
export interface SummonStatusLifecycleState {
    readSummons(): SummonCollectionState;
    writeSummons(summons: SummonCollectionState, event?: string): void;
    getSummonById(summonId: string): SummonUnit | null;
}
export interface SummonStatusLifecycleRuntimePorts<TToken> {
    state: SummonStatusLifecycleState;
    definitions: SummonStatusDefinitionReader;
    transactions: TriggerTransactionPorts<TToken>;
    execute(effect: StatusRuntimeEffect, owner: BattleOwner, context: SummonStatusLifecycleExecutionContext): MaybePromise<void>;
    record?(event: Extract<SummonStatusLifecycleEvent, {
        type: 'status_applied' | 'trigger_completed' | 'status_removed';
    }>): BattleTriggerEventContext | undefined;
    dispatch?(dispatches: readonly BattleTriggerDispatch[]): MaybePromise<void>;
    present?(event: SummonStatusLifecycleEvent): void;
}
export interface SummonInterceptResult extends SummonDamageResult {
    remainingDamage: number;
    interceptedDamage: number;
}
export declare function isSummonAlive(unit: Pick<SummonUnit, 'hasHp' | 'currentHp'>): boolean;
export declare function createSummonCollectionState(living?: readonly SummonUnit[], defeated?: readonly SummonUnit[]): SummonCollectionState;
export declare function validateSummonDefinition(definition: SummonUnitDefinition): string[];
export declare function spawnSummonUnits(current: SummonCollectionState, owner: BattleOwner, definition: SummonUnitDefinition, requestedCount: number, capacity?: number, overflow?: SummonOverflowPolicy, createdTurn?: number, summonerId?: string | null): {
    state: SummonCollectionState;
    spawned: SummonUnit[];
    replaced: SummonUnit[];
};
export declare function resolveSummonTargets(state: SummonCollectionState, selector: SummonSelector, source: BattleOwner, random?: () => number): SummonUnit[];
/**
 * Copy concrete runtime summons, including their transformed actions,
 * triggered abilities, statuses and resources. New identities and queue order
 * are allocated here; capacity and overflow use the same rules as spawning.
 */
export declare function copySummonUnits(current: SummonCollectionState, targetIds: readonly string[], owner: BattleOwner, capacity?: number, overflow?: SummonOverflowPolicy, createdTurn?: number, binding?: {
    summonerId: string | null;
} | 'preserve'): SummonCopyResult;
export declare function damageSummonUnits(current: SummonCollectionState, targetIds: readonly string[], requestedDamage: number, bypassBlock?: boolean, preventHpLoss?: boolean): SummonDamageResult;
export declare function interceptUnblockedAttack(current: SummonCollectionState, owner: BattleOwner, requestedDamage: number, mitigate?: (unit: SummonUnit, incoming: number) => number, 
/** Exact enemy holder being damaged. Enemy summons never fall back to active aliases. */
protectedEnemyId?: string): SummonInterceptResult;
export declare function healSummonUnits(current: SummonCollectionState, targetIds: readonly string[], amount: number): {
    state: SummonCollectionState;
    changed: Array<{
        summonId: string;
        previousHp: number;
        nextHp: number;
    }>;
};
export declare function modifySummonUnits(current: SummonCollectionState, targetIds: readonly string[], stat: 'max_hp' | 'block' | 'actions_per_activation' | 'speed' | 'action_priority', operator: '+' | '-' | '*' | '/' | '=', value: number): SummonCollectionState;
/**
 * Apply the same four numeric channels used by card-value editing to summon
 * actions and triggered abilities. Entries marked `fixed` are deliberately
 * skipped, so economy effects can remain stable while attacks and exit bursts
 * scale with the summon build.
 */
export declare function modifySummonEffectPrograms(current: SummonCollectionState, targetIds: readonly string[], stat: CardValueStat, operator: CardValueOperator, value: number): SummonCollectionState;
export declare function applySummonStatus(current: SummonCollectionState, targetIds: readonly string[], definition: Omit<SummonStatusState, 'stacks'>, stacks: number): SummonCollectionState;
export declare function removeSummonStatus(current: SummonCollectionState, targetIds: readonly string[], statusId: string): SummonCollectionState;
/**
 * Portable lifecycle for statuses held by summons.
 *
 * Every entry point accepts concrete summon instance ids. It deliberately does
 * not resolve owner-wide selectors: a status trigger's ordinary `self` must be
 * rebound by the host to `context.summonContext`, never expanded to all allied
 * summons. Apply/stack stay inside the caller's transaction; tick/remove use
 * recover-and-continue nested snapshots, matching combatant status semantics.
 */
export declare class SummonStatusLifecycleRuntime<TToken> {
    private readonly ports;
    constructor(ports: SummonStatusLifecycleRuntimePorts<TToken>);
    apply(targetIds: readonly string[], statusId: string, stacks: number, options?: StatusReceiveOptions): Promise<Array<{
        summon: SummonUnit;
        status: SummonStatusState;
    }>>;
    remove(targetIds: readonly string[], selection: string): Promise<Array<{
        summon: SummonUnit;
        status: SummonStatusState;
    }>>;
    /** Consume precisely one layer from one exact summon holder. */
    removeStacks(summonId: string, statusId: string, count: number): Promise<void>;
    consumeLayer(summonId: string, statusId: string): Promise<boolean>;
    /** Resolve tick effects for one exact summon at its declared action boundary. */
    processActionTiming(summonId: string, timing: StatusTickTiming): Promise<void>;
    /** Stack decay is independent of tick timing and occurs once at each owner's turn end. */
    processTurnEnd(owner: BattleOwner): Promise<void>;
    /** Resolve a concrete battle event for statuses present before that event began. */
    processEvent(summon: SummonUnit, trigger: StatusEventTrigger, context?: Readonly<Record<string, unknown>>, activeStatusIds?: readonly string[]): Promise<void>;
    private applyStacksDecay;
    private removeOne;
    private executeIsolatedTrigger;
    private dispatchOwnership;
    private execute;
    private createStatus;
    private matchesSelection;
    private getLiving;
    private updateLiving;
    private present;
}
export declare function updateSummonResources(current: SummonCollectionState, targetIds: readonly string[], resourceId: string, value: number, mode: 'gain' | 'set'): {
    state: SummonCollectionState;
    changed: Array<{
        summonId: string;
        previousValue: number;
        nextValue: number;
    }>;
};
export declare function dismissSummonUnits(current: SummonCollectionState, targetIds: readonly string[], retainCorpse?: boolean): {
    state: SummonCollectionState;
    dismissed: SummonUnit[];
};
export declare function resetSummonTurnState(current: SummonCollectionState, owner: BattleOwner): SummonCollectionState;
export declare function buildSummonActionQueue(state: SummonCollectionState, owner: BattleOwner): SummonActionQueueEntry[];
/** Select the action identities for an upcoming activation and persist them on the units. */
export declare function planSummonActions(current: SummonCollectionState, targetIds: readonly string[], random: () => number, replace?: boolean): SummonCollectionState;
/** Resolve a previously selected action without drawing RNG. */
export declare function resolvePlannedSummonAction(unit: SummonUnit, actionIndex: number): ResolvedSummonAction | null;
/** Select one autonomous behaviour without coupling summon design to a fixed content preset. */
export declare function resolveSummonAction(unit: SummonUnit, random?: () => number): ResolvedSummonAction | null;
export {};
