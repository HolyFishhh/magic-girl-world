import type { CardOrigin } from './cardIdentity';
import type { CardCost } from './combatResource';

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
  | 'resource_changed'
  | 'stance_changed'
  | 'orb_channeled'
  | 'orb_evoked'
  | 'orb_value_changed'
  | 'turn_control_changed'
  | 'summon_spawned'
  | 'summon_acted'
  | 'summon_intercepted'
  | 'summon_defeated'
  | 'summon_status_applied'
  | 'summon_status_triggered'
  | 'summon_status_removed'
  | 'entity_defeated';

export const BATTLE_EVENT_KINDS: readonly BattleEventKind[] = [
  'turn_started', 'turn_ended', 'card_drawn', 'card_moved', 'card_played', 'damage_resolved',
  'heal_resolved', 'resource_spent', 'resource_changed', 'stance_changed', 'orb_channeled',
  'orb_evoked', 'orb_value_changed', 'turn_control_changed', 'summon_spawned', 'summon_acted',
  'summon_intercepted', 'summon_defeated', 'summon_status_applied', 'summon_status_triggered',
  'summon_status_removed', 'entity_defeated',
];

export type CardMoveReason =
  | 'player_choice'
  | 'random_effect'
  | 'effect'
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
export type EventSourceKind = 'card' | 'relic' | 'status' | 'ability' | 'enemy_action' | 'system' | 'summon' | 'enchantment' | 'affliction';

export const BATTLE_EVENT_PHASES: readonly BattleEventPhase[] = ['before', 'resolve', 'after'];
export const DAMAGE_KINDS: readonly DamageKind[] = ['attack', 'effect', 'hp_loss', 'retaliation', 'damage_over_time', 'execute'];
export const EVENT_SOURCE_KINDS: readonly EventSourceKind[] = [
  'card', 'relic', 'status', 'ability', 'enemy_action', 'system', 'summon', 'enchantment', 'affliction',
];

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
      cardName?: string;
      rarity?: string;
      cost?: CardCost;
      tags?: string[];
      origin?: CardOrigin;
      upgraded?: boolean;
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
      kind: 'resource_changed';
      actorId: string;
      targetId: string;
      resource: string;
      previousValue: number;
      nextValue: number;
      change: 'gain' | 'set';
    })
  | (BattleEventBase & {
      kind: 'stance_changed';
      actorId: string;
      previousStanceId?: string;
      nextStanceId?: string;
      nextStanceName?: string;
    })
  | (BattleEventBase & {
      kind: 'orb_channeled' | 'orb_evoked';
      actorId: string;
      orbInstanceId: string;
      orbId: string;
      orbName: string;
      value: number;
    })
  | (BattleEventBase & {
      kind: 'orb_value_changed';
      actorId: string;
      orbInstanceId: string;
      orbId: string;
      previousValue: number;
      nextValue: number;
    })
  | (BattleEventBase & {
      kind: 'turn_control_changed';
      actorId: string;
      action: 'extra_turn' | 'force_end';
      amount: number;
    })
  | (BattleEventBase & {
      kind: 'summon_spawned';
      actorId: string;
      summonId: string;
      summonTemplateId: string;
      ownerId: string;
    })
  | (BattleEventBase & {
      kind: 'summon_acted';
      actorId: string;
      summonId: string;
      actionIndex: number;
    })
  | (BattleEventBase & {
      kind: 'summon_intercepted';
      actorId: string;
      targetId: string;
      summonId: string;
      blocked: number;
      hpLost: number;
      defeated: boolean;
    })
  | (BattleEventBase & {
      kind: 'summon_defeated';
      actorId: string;
      summonId: string;
      ownerId: string;
      reason: 'damage' | 'replace' | 'dismiss';
    })
  | (BattleEventBase & {
      kind: 'summon_status_applied';
      actorId: string;
      summonId: string;
      statusId: string;
      statusName: string;
      stacks: number;
      trigger: 'apply' | 'stack';
    })
  | (BattleEventBase & {
      kind: 'summon_status_triggered';
      actorId: string;
      summonId: string;
      statusId: string;
      statusName: string;
      stacks: number;
      trigger: 'apply' | 'stack' | 'tick' | 'remove';
    })
  | (BattleEventBase & {
      kind: 'summon_status_removed';
      actorId: string;
      summonId: string;
      statusId: string;
      statusName: string;
      stacks: number;
      reason: 'explicit' | 'decay';
    })
  | (BattleEventBase & {
      kind: 'entity_defeated';
      actorId: string;
      targetId: string;
      fatalSourceEventId?: string;
      defeatKind?: 'damage' | 'execute' | 'kill';
      fatal?: boolean;
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

export type EventHistoryMetric =
  | 'count'
  | 'last_damage'
  | 'last_hp_loss'
  | 'last_heal'
  | 'last_resource_spent'
  | 'last_turn'
  | 'last_sequence';

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
export function battleTriggerContextFromEvent(
  event: BattleEvent,
  eventJournal: BattleEventJournalState,
): BattleTriggerEventContext {
  return {
    eventId: event.id,
    eventRecorded: true,
    turn: event.turn,
    kind: event.kind,
    phase: event.phase,
    sourceKind: event.cause.source.kind,
    sourceId: event.cause.source.id,
    ...(event.cause.reason ? { reason: event.cause.reason } : {}),
    ...('cardType' in event ? { cardType: event.cardType } : {}),
    ...('templateId' in event ? { templateId: event.templateId } : {}),
    ...('cardInstanceId' in event ? { cardInstanceId: event.cardInstanceId } : {}),
    ...('damageKind' in event ? { damageKind: event.damageKind } : {}),
    ...('actorId' in event ? { actorId: event.actorId } : {}),
    ...('targetId' in event ? { targetId: event.targetId } : {}),
    eventJournal,
  };
}

const MAX_EVENT_DEPTH = 32;
const MAX_EVENTS_PER_ROOT_SIGNATURE = 64;

export function createRunEventHistory(records: readonly RunBattleEventRecord[] = []): RunEventHistoryState {
  return { schemaVersion: 1, records: records.map(record => structuredClone(record)) };
}

export function createBattleEventJournal(
  events: readonly BattleEvent[] = [],
  runHistory?: RunEventHistoryState,
): BattleEventJournalState {
  let state: BattleEventJournalState = {
    schemaVersion: 1,
    nextSequence: 1,
    events: [],
    counters: {},
    ...(runHistory ? { runHistory: createRunEventHistory(runHistory.records) } : {}),
  };
  for (const event of events) state = appendExistingEvent(state, event);
  return state;
}

/**
 * Commit one completed encounter into run-owned history. Reusing the same
 * encounter id replaces its previous archive, making save/retry idempotent.
 */
export function archiveBattleJournalInRun(
  runHistory: RunEventHistoryState,
  encounterId: string,
  journal: BattleEventJournalState,
): RunEventHistoryState {
  const id = encounterId.trim();
  if (!id) throw new Error('encounterId cannot be empty');
  const retained = runHistory.records.filter(record => record.encounterId !== id);
  const appended = journal.events.map(event => ({ encounterId: id, event: structuredClone(event) }));
  return createRunEventHistory([...retained, ...appended]);
}

/** Attach prior-run events to a fresh/current encounter without merging them. */
export function attachRunEventHistory(
  journal: BattleEventJournalState,
  runHistory: RunEventHistoryState,
): BattleEventJournalState {
  return { ...journal, runHistory: createRunEventHistory(runHistory.records) };
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
  if (event.kind === 'resource_spent') {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(event.resource) ||
      [event.requested, event.spent].some(value => !Number.isInteger(value) || value < 0) ||
      event.spent > event.requested
    ) return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  }
  if (event.kind === 'resource_changed') {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(event.resource) ||
      [event.previousValue, event.nextValue].some(value => !Number.isInteger(value) || value < 0)
    ) return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  }
  if ((event.kind === 'orb_channeled' || event.kind === 'orb_evoked') && (!Number.isFinite(event.value) || event.value < 0))
    return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  if (event.kind === 'orb_value_changed' && [event.previousValue, event.nextValue].some(value => !Number.isFinite(value) || value < 0))
    return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  if (event.kind === 'turn_control_changed' && (!Number.isInteger(event.amount) || event.amount < 0))
    return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  if (event.kind === 'summon_acted' && (!Number.isInteger(event.actionIndex) || event.actionIndex < 0))
    return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  if (
    event.kind === 'summon_intercepted' &&
    [event.blocked, event.hpLost].some(value => !Number.isFinite(value) || value < 0)
  ) return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  if (
    (event.kind === 'summon_status_applied' || event.kind === 'summon_status_triggered' || event.kind === 'summon_status_removed') &&
    (!event.summonId || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(event.statusId) || !event.statusName ||
      !Number.isFinite(event.stacks) || event.stacks < 0)
  ) return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  const signature = eventSignature(event);
  const repeated = state.events.filter(
    entry => entry.cause.rootEventId === rootEventId && eventSignature(entry) === signature,
  ).length;
  if (repeated >= MAX_EVENTS_PER_ROOT_SIGNATURE) return { ok: false, code: 'REENTRANT_EVENT_LIMIT', state };
  return { ok: true, state: appendExistingEvent(state, event), event };
}

export function battleEventMatches(event: BattleEvent, filter: EventCounterFilter = {}): boolean {
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
  const current = state.events.filter(event => eventInScope(event, query) && battleEventMatches(event, query.filter)).length;
  if (query.scope !== 'run') return current;
  const archived = state.runHistory?.records.filter(record => battleEventMatches(record.event, query.filter)).length || 0;
  return archived + current;
}

export function matchesEventOrdinal(state: BattleEventJournalState, eventId: string, query: EventOrdinalQuery): boolean {
  const matching = state.events.filter(event => eventInScope(event, query) && battleEventMatches(event, query.filter));
  const index = matching.findIndex(event => event.id === eventId);
  if (index < 0) return false;
  const archived = query.scope === 'run'
    ? state.runHistory?.records.filter(record => battleEventMatches(record.event, query.filter)).length || 0
    : 0;
  const ordinal = archived + index + 1;
  if (query.ordinal === 'first') return ordinal === 1;
  const n = Math.max(1, Math.floor(query.n || 1));
  return query.ordinal === 'nth' ? ordinal === n : ordinal % n === 0;
}

function contextMatchesFilter(context: BattleTriggerEventContext, filter: EventCounterFilter = {}): boolean {
  const keys: Array<keyof EventCounterFilter> = [
    'kind', 'phase', 'sourceKind', 'sourceId', 'reason', 'cardType', 'templateId', 'cardInstanceId',
    'damageKind', 'actorId', 'targetId',
  ];
  return keys.every(key => filter[key] === undefined || context[key] === filter[key]);
}

/** Match a filtered/ordinal trigger against one dispatched event. */
export function matchesEventTriggerQuery(
  context: BattleTriggerEventContext,
  query?: EventTriggerQuery,
): boolean {
  if (!query) return true;
  if (!contextMatchesFilter(context, query.filter)) return false;
  if (!query.ordinal) return true;
  const journal = context.eventJournal;
  if (!journal) return false;
  const resolvedQuery: EventTriggerQuery = {
    ...query,
    ...(query.scope === 'turn' && query.turn === undefined ? { turn: context.turn } : {}),
    ...(query.scope === 'card_instance' && query.cardInstanceId === undefined
      ? { cardInstanceId: context.cardInstanceId }
      : {}),
  };
  if (context.eventRecorded && context.eventId) {
    return matchesEventOrdinal(journal, context.eventId, { ...resolvedQuery, ordinal: query.ordinal });
  }
  // Some domain triggers are dispatched before their corresponding journal
  // event is appended. In that case the candidate is the next matching event.
  const ordinal = countBattleEvents(journal, resolvedQuery) + 1;
  if (query.ordinal === 'first') return ordinal === 1;
  const n = Math.max(1, Math.floor(query.n || 1));
  return query.ordinal === 'nth' ? ordinal === n : ordinal % n === 0;
}

export function findRecentBattleEvent(
  state: BattleEventJournalState,
  query: EventCounterQuery,
): BattleEvent | undefined {
  const current = [...state.events].reverse().find(event => eventInScope(event, query) && battleEventMatches(event, query.filter));
  if (current || query.scope !== 'run') return current ? structuredClone(current) : undefined;
  const archived = [...(state.runHistory?.records || [])].reverse().find(record => battleEventMatches(record.event, query.filter));
  return archived ? structuredClone(archived.event) : undefined;
}

export function readBattleEventHistoryValue(
  state: BattleEventJournalState,
  query: EventHistoryValueQuery,
): number {
  if (query.metric === 'count') return countBattleEvents(state, query);
  const impliedKind = query.metric === 'last_damage' || query.metric === 'last_hp_loss'
    ? 'damage_resolved'
    : query.metric === 'last_heal'
      ? 'heal_resolved'
      : query.metric === 'last_resource_spent'
        ? 'resource_spent'
        : undefined;
  const event = findRecentBattleEvent(state, {
    ...query,
    ...(impliedKind && !query.filter?.kind ? { filter: { ...(query.filter || {}), kind: impliedKind } } : {}),
  });
  if (!event) return 0;
  if (query.metric === 'last_turn') return event.turn;
  if (query.metric === 'last_sequence') return event.sequence;
  if (query.metric === 'last_damage')
    return event.kind === 'damage_resolved' ? event.modified : 0;
  if (query.metric === 'last_hp_loss')
    return event.kind === 'damage_resolved' ? event.hpLost : 0;
  if (query.metric === 'last_heal')
    return event.kind === 'heal_resolved' ? event.hpGained : 0;
  return event.kind === 'resource_spent' ? event.spent : 0;
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
