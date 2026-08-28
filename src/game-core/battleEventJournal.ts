export type BattleEventPhase = 'before' | 'resolve' | 'after';
export type BattleEventKind =
  | 'turn_started'
  | 'turn_ended'
  | 'card_drawn'
  | 'card_moved'
  | 'card_played'
  | 'damage_resolved'
  | 'heal_resolved'
  | 'resource_spent'
  | 'entity_defeated';

export type CardMoveReason =
  | 'player_choice'
  | 'random_effect'
  | 'turn_cleanup'
  | 'scry'
  | 'recover'
  | 'exhaust'
  | 'generate'
  | 'copy'
  | 'transform'
  | 'auto_play'
  | 'other';

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

export type BattleEvent =
  | (BattleEventBase & { kind: 'turn_started' | 'turn_ended'; actorId: string })
  | (BattleEventBase & {
      kind: 'card_drawn';
      actorId: string;
      cardInstanceId: string;
      templateId: string;
      cardType: string;
      from: 'drawPile';
      to: 'hand';
    })
  | (BattleEventBase & {
      kind: 'card_moved';
      actorId: string;
      cardInstanceId: string;
      templateId: string;
      cardType: string;
      from: string;
      to: string;
      moveReason: CardMoveReason;
    })
  | (BattleEventBase & {
      kind: 'card_played';
      actorId: string;
      cardInstanceId: string;
      templateId: string;
      cardType: string;
      automatic: boolean;
      replayIndex: number;
    })
  | (BattleEventBase & {
      kind: 'damage_resolved';
      actorId: string;
      targetId: string;
      damageKind: DamageKind;
      requested: number;
      modified: number;
      blocked: number;
      hpLost: number;
      fatal: boolean;
    })
  | (BattleEventBase & {
      kind: 'heal_resolved';
      actorId: string;
      targetId: string;
      requested: number;
      hpGained: number;
    })
  | (BattleEventBase & {
      kind: 'resource_spent';
      actorId: string;
      resource: string;
      requested: number;
      spent: number;
    })
  | (BattleEventBase & {
      kind: 'entity_defeated';
      actorId: string;
      targetId: string;
      fatalSourceEventId?: string;
    });

export type BattleEventDraft = BattleEvent extends infer T
  ? T extends BattleEvent
    ? Omit<T, 'id' | 'sequence' | 'depth'> & { depth?: number }
    : never
  : never;

export interface BattleEventJournalState {
  schemaVersion: 1;
  nextSequence: number;
  events: BattleEvent[];
  counters: Record<string, number>;
  lastCardPlayed?: Extract<BattleEvent, { kind: 'card_played' }>;
  lastDamage?: Extract<BattleEvent, { kind: 'damage_resolved' }>;
  lastActualHpLoss?: Extract<BattleEvent, { kind: 'damage_resolved' }>;
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

const MAX_EVENT_DEPTH = 32;
const MAX_EVENTS_PER_ROOT_SIGNATURE = 64;

export function createBattleEventJournal(events: readonly BattleEvent[] = []): BattleEventJournalState {
  let state: BattleEventJournalState = { schemaVersion: 1, nextSequence: 1, events: [], counters: {} };
  for (const event of events) state = appendExistingEvent(state, event);
  return state;
}

function eventSignature(event: Pick<BattleEvent, 'kind' | 'phase' | 'cause'>): string {
  return `${event.kind}|${event.phase}|${event.cause.source.kind}|${event.cause.source.id}`;
}

function increment(counters: Record<string, number>, key: string): void {
  counters[key] = (counters[key] || 0) + 1;
}

function appendExistingEvent(state: BattleEventJournalState, event: BattleEvent): BattleEventJournalState {
  const counters = { ...state.counters };
  increment(counters, `combat:${eventSignature(event)}`);
  increment(counters, `turn:${event.turn}:${eventSignature(event)}`);
  increment(counters, `run:${eventSignature(event)}`);
  if ('cardInstanceId' in event) increment(counters, `card:${event.cardInstanceId}:${eventSignature(event)}`);
  increment(counters, `actor:${'actorId' in event ? event.actorId : ''}:${eventSignature(event)}`);
  return {
    ...state,
    nextSequence: Math.max(state.nextSequence, event.sequence + 1),
    events: [...state.events, structuredClone(event)],
    counters,
    ...(event.kind === 'card_played' ? { lastCardPlayed: structuredClone(event) } : {}),
    ...(event.kind === 'damage_resolved' ? { lastDamage: structuredClone(event) } : {}),
    ...(event.kind === 'damage_resolved' && event.hpLost > 0 ? { lastActualHpLoss: structuredClone(event) } : {}),
  };
}

export type AppendBattleEventResult =
  | { ok: true; state: BattleEventJournalState; event: BattleEvent }
  | { ok: false; code: 'MAX_EVENT_DEPTH' | 'REENTRANT_EVENT_LIMIT' | 'INVALID_EVENT_VALUE'; state: BattleEventJournalState };

export function appendBattleEvent(state: BattleEventJournalState, draft: BattleEventDraft): AppendBattleEventResult {
  const sequence = Math.max(1, Math.floor(state.nextSequence || 1));
  const depth = Math.max(0, Math.floor(draft.depth || 0));
  if (depth > MAX_EVENT_DEPTH) return { ok: false, code: 'MAX_EVENT_DEPTH', state };
  const id = `event:${sequence}`;
  const rootEventId = draft.cause.rootEventId || draft.cause.parentEventId || id;
  const event = {
    ...structuredClone(draft),
    id,
    sequence,
    depth,
    cause: { ...structuredClone(draft.cause), rootEventId },
  } as BattleEvent;
  if (event.kind === 'damage_resolved') {
    if ([event.requested, event.modified, event.blocked, event.hpLost].some(value => !Number.isFinite(value) || value < 0))
      return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  }
  const signature = eventSignature(event);
  const repeated = state.events.filter(
    entry => entry.cause.rootEventId === rootEventId && eventSignature(entry) === signature,
  ).length;
  if (repeated >= MAX_EVENTS_PER_ROOT_SIGNATURE) return { ok: false, code: 'REENTRANT_EVENT_LIMIT', state };
  return { ok: true, state: appendExistingEvent(state, event), event };
}

function eventMatches(event: BattleEvent, filter: EventCounterFilter = {}): boolean {
  if (filter.kind && event.kind !== filter.kind) return false;
  if (filter.phase && event.phase !== filter.phase) return false;
  if (filter.sourceKind && event.cause.source.kind !== filter.sourceKind) return false;
  if (filter.sourceId && event.cause.source.id !== filter.sourceId) return false;
  if (filter.reason && event.cause.reason !== filter.reason && (!('moveReason' in event) || event.moveReason !== filter.reason)) return false;
  if (filter.cardType && (!('cardType' in event) || event.cardType !== filter.cardType)) return false;
  if (filter.templateId && (!('templateId' in event) || event.templateId !== filter.templateId)) return false;
  if (filter.cardInstanceId && (!('cardInstanceId' in event) || event.cardInstanceId !== filter.cardInstanceId)) return false;
  if (filter.damageKind && (!('damageKind' in event) || event.damageKind !== filter.damageKind)) return false;
  if (filter.actorId && (!('actorId' in event) || event.actorId !== filter.actorId)) return false;
  if (filter.targetId && (!('targetId' in event) || event.targetId !== filter.targetId)) return false;
  return true;
}

function eventInScope(event: BattleEvent, query: EventCounterQuery): boolean {
  if (query.scope === 'turn' && event.turn !== query.turn) return false;
  if (query.scope === 'card_instance' && (!('cardInstanceId' in event) || event.cardInstanceId !== query.cardInstanceId)) return false;
  if (query.scope === 'team' && (!('actorId' in event) || !query.teamActorIds?.includes(event.actorId))) return false;
  return true;
}

export function countBattleEvents(state: BattleEventJournalState, query: EventCounterQuery): number {
  return state.events.filter(event => eventInScope(event, query) && eventMatches(event, query.filter)).length;
}

export function matchesEventOrdinal(state: BattleEventJournalState, eventId: string, query: EventOrdinalQuery): boolean {
  const matching = state.events.filter(event => eventInScope(event, query) && eventMatches(event, query.filter));
  const index = matching.findIndex(event => event.id === eventId);
  if (index < 0) return false;
  const ordinal = index + 1;
  if (query.ordinal === 'first') return ordinal === 1;
  const n = Math.max(1, Math.floor(query.n || 1));
  return query.ordinal === 'nth' ? ordinal === n : ordinal % n === 0;
}

export function resetBattleEventScope(
  state: BattleEventJournalState,
  scope: 'turn' | 'combat' | 'run',
  turn?: number,
): BattleEventJournalState {
  const prefix = scope === 'turn' ? `turn:${Math.max(0, Math.floor(turn || 0))}:` : `${scope}:`;
  return {
    ...state,
    counters: Object.fromEntries(Object.entries(state.counters).filter(([key]) => !key.startsWith(prefix))),
    ...(scope === 'combat' ? { lastCardPlayed: undefined, lastDamage: undefined, lastActualHpLoss: undefined } : {}),
  };
}
