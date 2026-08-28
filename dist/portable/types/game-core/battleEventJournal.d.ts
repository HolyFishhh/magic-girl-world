export type BattleEventPhase = 'before' | 'resolve' | 'after';
export type BattleEventKind = 'turn_started' | 'turn_ended' | 'card_drawn' | 'card_moved' | 'card_played' | 'damage_resolved' | 'heal_resolved' | 'resource_spent' | 'entity_defeated';
export type CardMoveReason = 'player_choice' | 'random_effect' | 'turn_cleanup' | 'scry' | 'recover' | 'exhaust' | 'generate' | 'copy' | 'transform' | 'auto_play' | 'other';
export type DamageKind = 'attack' | 'effect' | 'hp_loss' | 'retaliation' | 'damage_over_time' | 'execute';
export type EventSourceKind = 'card' | 'relic' | 'status' | 'ability' | 'enemy_action' | 'system' | 'summon';
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
    kind: 'entity_defeated';
    actorId: string;
    targetId: string;
    fatalSourceEventId?: string;
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
export declare function createBattleEventJournal(events?: readonly BattleEvent[]): BattleEventJournalState;
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
export declare function countBattleEvents(state: BattleEventJournalState, query: EventCounterQuery): number;
export declare function matchesEventOrdinal(state: BattleEventJournalState, eventId: string, query: EventOrdinalQuery): boolean;
export declare function resetBattleEventScope(state: BattleEventJournalState, scope: 'turn' | 'combat' | 'run', turn?: number): BattleEventJournalState;
export {};
