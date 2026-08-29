import type { CardOrigin } from './cardIdentity';
import type { CardCost } from './combatResource';
export type BattleEventPhase = 'before' | 'resolve' | 'after';
export type BattleEventKind = 'turn_started' | 'turn_ended' | 'card_drawn' | 'card_moved' | 'card_played' | 'damage_resolved' | 'heal_resolved' | 'resource_spent' | 'resource_changed' | 'stance_changed' | 'orb_channeled' | 'orb_evoked' | 'orb_value_changed' | 'turn_control_changed' | 'summon_spawned' | 'summon_acted' | 'summon_intercepted' | 'summon_defeated' | 'summon_status_applied' | 'summon_status_triggered' | 'summon_status_removed' | 'entity_defeated';
export declare const BATTLE_EVENT_KINDS: readonly BattleEventKind[];
export type CardMoveReason = 'player_choice' | 'random_effect' | 'effect' | 'turn_cleanup' | 'scry' | 'recover' | 'exhaust' | 'generate' | 'copy' | 'transform' | 'auto_play' | 'other';
export type DamageKind = 'attack' | 'effect' | 'hp_loss' | 'retaliation' | 'damage_over_time' | 'execute';
export type EventSourceKind = 'card' | 'relic' | 'status' | 'ability' | 'enemy_action' | 'system' | 'summon' | 'enchantment' | 'affliction';
export declare const BATTLE_EVENT_PHASES: readonly BattleEventPhase[];
export declare const DAMAGE_KINDS: readonly DamageKind[];
export declare const EVENT_SOURCE_KINDS: readonly EventSourceKind[];
export interface BattleEventSource {
    kind: EventSourceKind;
    id: string;
    name?: string;
    ownerId?: string;
}
export interface BattleEventCause {
    source: BattleEventSource;
    reason?: CardMoveReason | string;
    parentEventId?: string;
    rootEventId?: string;
}
interface BattleEventBase {
    id: string;
    sequence: number;
    turn: number;
    phase: BattleEventPhase;
    kind: BattleEventKind;
    depth: number;
    cause: BattleEventCause;
}
export type BattleEvent = (BattleEventBase & {
    kind: 'turn_started' | 'turn_ended';
    actorId: string;
}) | (BattleEventBase & {
    kind: 'card_drawn';
    actorId: string;
    cardInstanceId: string;
    templateId: string;
    cardType: string;
    from: 'drawPile';
    to: 'hand';
}) | (BattleEventBase & {
    kind: 'card_moved';
    actorId: string;
    cardInstanceId: string;
    templateId: string;
    cardType: string;
    from: string;
    to: string;
    moveReason: CardMoveReason;
}) | (BattleEventBase & {
    kind: 'card_played';
    actorId: string;
    cardInstanceId: string;
    templateId: string;
    cardType: string;
    cardName?: string;
    rarity?: string;
    cost?: CardCost;
    tags?: string[];
    origin?: CardOrigin;
    upgraded?: boolean;
    automatic: boolean;
    replayIndex: number;
}) | (BattleEventBase & {
    kind: 'damage_resolved';
    actorId: string;
    targetId: string;
    damageKind: DamageKind;
    requested: number;
    modified: number;
    blocked: number;
    hpLost: number;
    fatal: boolean;
}) | (BattleEventBase & {
    kind: 'heal_resolved';
    actorId: string;
    targetId: string;
    requested: number;
    hpGained: number;
}) | (BattleEventBase & {
    kind: 'resource_spent';
    actorId: string;
    resource: string;
    requested: number;
    spent: number;
}) | (BattleEventBase & {
    kind: 'resource_changed';
    actorId: string;
    targetId: string;
    resource: string;
    previousValue: number;
    nextValue: number;
    change: 'gain' | 'set';
}) | (BattleEventBase & {
    kind: 'stance_changed';
    actorId: string;
    previousStanceId?: string;
    nextStanceId?: string;
    nextStanceName?: string;
}) | (BattleEventBase & {
    kind: 'orb_channeled' | 'orb_evoked';
    actorId: string;
    orbInstanceId: string;
    orbId: string;
    orbName: string;
    value: number;
}) | (BattleEventBase & {
    kind: 'orb_value_changed';
    actorId: string;
    orbInstanceId: string;
    orbId: string;
    previousValue: number;
    nextValue: number;
}) | (BattleEventBase & {
    kind: 'turn_control_changed';
    actorId: string;
    action: 'extra_turn' | 'force_end';
    amount: number;
}) | (BattleEventBase & {
    kind: 'summon_spawned';
    actorId: string;
    summonId: string;
    summonTemplateId: string;
    ownerId: string;
}) | (BattleEventBase & {
    kind: 'summon_acted';
    actorId: string;
    summonId: string;
    actionIndex: number;
}) | (BattleEventBase & {
    kind: 'summon_intercepted';
    actorId: string;
    targetId: string;
    summonId: string;
    blocked: number;
    hpLost: number;
    defeated: boolean;
}) | (BattleEventBase & {
    kind: 'summon_defeated';
    actorId: string;
    summonId: string;
    ownerId: string;
    reason: 'damage' | 'replace' | 'dismiss';
}) | (BattleEventBase & {
    kind: 'summon_status_applied';
    actorId: string;
    summonId: string;
    statusId: string;
    statusName: string;
    stacks: number;
    trigger: 'apply' | 'stack';
}) | (BattleEventBase & {
    kind: 'summon_status_triggered';
    actorId: string;
    summonId: string;
    statusId: string;
    statusName: string;
    stacks: number;
    trigger: 'apply' | 'stack' | 'tick' | 'remove';
}) | (BattleEventBase & {
    kind: 'summon_status_removed';
    actorId: string;
    summonId: string;
    statusId: string;
    statusName: string;
    stacks: number;
    reason: 'explicit' | 'decay';
}) | (BattleEventBase & {
    kind: 'entity_defeated';
    actorId: string;
    targetId: string;
    fatalSourceEventId?: string;
    defeatKind?: 'damage' | 'execute' | 'kill';
    fatal?: boolean;
});
export type BattleEventDraft = BattleEvent extends infer T ? T extends BattleEvent ? Omit<T, 'id' | 'sequence' | 'depth'> & {
    depth?: number;
} : never : never;
export interface BattleEventJournalState {
    schemaVersion: 1;
    nextSequence: number;
    events: BattleEvent[];
    counters: Record<string, number>;
    lastCardPlayed?: Extract<BattleEvent, {
        kind: 'card_played';
    }>;
    lastDamage?: Extract<BattleEvent, {
        kind: 'damage_resolved';
    }>;
    lastActualHpLoss?: Extract<BattleEvent, {
        kind: 'damage_resolved';
    }>;
    /**
     * Events from completed encounters in the same run. The current encounter is
     * deliberately kept in `events`; callers archive it explicitly at the
     * encounter boundary so reload/retry cannot count one battle twice.
     */
    runHistory?: RunEventHistoryState;
}
export interface RunBattleEventRecord {
    encounterId: string;
    event: BattleEvent;
}
/** Serializable state owned by the run host, not by an individual battle. */
export interface RunEventHistoryState {
    schemaVersion: 1;
    records: RunBattleEventRecord[];
}
export interface EventCounterFilter {
    kind?: BattleEventKind;
    phase?: BattleEventPhase;
    sourceKind?: EventSourceKind;
    sourceId?: string;
    reason?: string;
    cardType?: string;
    templateId?: string;
    cardInstanceId?: string;
    damageKind?: DamageKind;
    actorId?: string;
    targetId?: string;
}
export type HistoryScope = 'turn' | 'combat' | 'run' | 'card_instance' | 'team';
export interface EventCounterQuery {
    scope: HistoryScope;
    turn?: number;
    cardInstanceId?: string;
    teamActorIds?: readonly string[];
    filter?: EventCounterFilter;
}
export interface EventOrdinalQuery extends EventCounterQuery {
    ordinal: 'first' | 'nth' | 'every_n';
    n?: number;
}
export interface EventTriggerQuery extends EventCounterQuery {
    ordinal?: EventOrdinalQuery['ordinal'];
    n?: number;
}
export type EventHistoryMetric = 'count' | 'last_damage' | 'last_hp_loss' | 'last_heal' | 'last_resource_spent' | 'last_turn' | 'last_sequence';
export interface EventHistoryValueQuery extends EventCounterQuery {
    metric: EventHistoryMetric;
}
/** Standard metadata passed to filtered ability/relic triggers. */
export interface BattleTriggerEventContext {
    eventId?: string;
    /** True when this event is already present in the supplied journal. */
    eventRecorded?: boolean;
    turn?: number;
    kind?: BattleEventKind;
    phase?: BattleEventPhase;
    sourceKind?: EventSourceKind;
    sourceId?: string;
    reason?: string;
    cardType?: string;
    templateId?: string;
    cardInstanceId?: string;
    damageKind?: DamageKind;
    actorId?: string;
    targetId?: string;
    eventJournal?: BattleEventJournalState;
}
/** Convert one persisted event into the canonical context consumed by filtered triggers. */
export declare function battleTriggerContextFromEvent(event: BattleEvent, eventJournal: BattleEventJournalState): BattleTriggerEventContext;
export declare function createRunEventHistory(records?: readonly RunBattleEventRecord[]): RunEventHistoryState;
export declare function createBattleEventJournal(events?: readonly BattleEvent[], runHistory?: RunEventHistoryState): BattleEventJournalState;
/**
 * Commit one completed encounter into run-owned history. Reusing the same
 * encounter id replaces its previous archive, making save/retry idempotent.
 */
export declare function archiveBattleJournalInRun(runHistory: RunEventHistoryState, encounterId: string, journal: BattleEventJournalState): RunEventHistoryState;
/** Attach prior-run events to a fresh/current encounter without merging them. */
export declare function attachRunEventHistory(journal: BattleEventJournalState, runHistory: RunEventHistoryState): BattleEventJournalState;
export type AppendBattleEventResult = {
    ok: true;
    state: BattleEventJournalState;
    event: BattleEvent;
} | {
    ok: false;
    code: 'MAX_EVENT_DEPTH' | 'REENTRANT_EVENT_LIMIT' | 'INVALID_EVENT_VALUE';
    state: BattleEventJournalState;
};
export declare function appendBattleEvent(state: BattleEventJournalState, draft: BattleEventDraft): AppendBattleEventResult;
export declare function battleEventMatches(event: BattleEvent, filter?: EventCounterFilter): boolean;
export declare function countBattleEvents(state: BattleEventJournalState, query: EventCounterQuery): number;
export declare function matchesEventOrdinal(state: BattleEventJournalState, eventId: string, query: EventOrdinalQuery): boolean;
/** Match a filtered/ordinal trigger against one dispatched event. */
export declare function matchesEventTriggerQuery(context: BattleTriggerEventContext, query?: EventTriggerQuery): boolean;
export declare function findRecentBattleEvent(state: BattleEventJournalState, query: EventCounterQuery): BattleEvent | undefined;
export declare function readBattleEventHistoryValue(state: BattleEventJournalState, query: EventHistoryValueQuery): number;
export declare function resetBattleEventScope(state: BattleEventJournalState, scope: 'turn' | 'combat' | 'run', turn?: number): BattleEventJournalState;
export {};
