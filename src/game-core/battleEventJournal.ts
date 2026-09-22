import type { CardOrigin } from './cardIdentity';
import type { CardCost } from './combatResource';
import { abilityTriggerRecipientScope, type AbilityTrigger } from './battleTriggers';
import { impliedTriggerEventFilter, triggerEventFilterConflicts } from './triggerEventContract';
import { CARD_DISCARD_TRIGGER_REASONS } from './cardAttachment';

export type BattleEventPhase = 'before' | 'resolve' | 'after';
export type BattleEventKind =
  | 'turn_started'
  | 'turn_ended'
  | 'card_drawn'
  | 'draw_pile_shuffled'
  | 'card_moved'
  | 'card_played'
  | 'damage_resolved'
  | 'heal_resolved'
  | 'lust_increased'
  | 'lust_decreased'
  | 'block_gained'
  | 'block_lost'
  | 'resource_spent'
  | 'resource_changed'
  | 'status_applied'
  | 'status_triggered'
  | 'status_removed'
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
  'turn_started', 'turn_ended', 'card_drawn', 'draw_pile_shuffled', 'card_moved', 'card_played',
  'damage_resolved', 'heal_resolved', 'lust_increased', 'lust_decreased', 'block_gained', 'block_lost',
  'resource_spent', 'resource_changed', 'status_applied', 'status_triggered', 'status_removed',
  'stance_changed', 'orb_channeled',
  'orb_evoked', 'orb_value_changed', 'turn_control_changed', 'summon_spawned', 'summon_acted',
  'summon_intercepted', 'summon_defeated', 'summon_status_applied', 'summon_status_triggered',
  'summon_status_removed', 'entity_defeated',
];

export type CardMoveReason =
  | 'player_choice'
  // Resolving a played card is not a hand-discard lifecycle. In particular it
  // must not consume first/nth on_discard event ordinals.
  | 'played'
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
  /** Runtime-owned provenance survives unit removal and encounter changes. */
  actorSide?: 'player' | 'enemy';
  targetSide?: 'player' | 'enemy';
}

export type BattleEvent =
  | (BattleEventBase & { kind: 'turn_started' | 'turn_ended'; actorId: string })
  | (BattleEventBase & { kind: 'draw_pile_shuffled'; actorId: string; recycledCards: number })
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
      /** Immutable actual payment for this accepted card play/replay event. */
      paidEnergy?: number;
      paidTotal?: number;
      paidResources?: Record<string, number>;
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
      kind: 'lust_increased' | 'lust_decreased' | 'block_gained' | 'block_lost';
      actorId: string;
      targetId: string;
      previousValue: number;
      nextValue: number;
      amount: number;
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
      kind: 'status_applied';
      /** Persist polarity, rather than guessing it from prose or a later registry. */
      statusType?: string;
      actorId: string;
      targetId: string;
      statusId: string;
      statusName: string;
      stacks: number;
      trigger: 'apply' | 'stack';
    })
  | (BattleEventBase & {
      kind: 'status_triggered';
      statusType?: string;
      actorId: string;
      targetId: string;
      statusId: string;
      statusName: string;
      stacks: number;
      trigger: 'apply' | 'stack' | 'tick' | 'remove';
    })
  | (BattleEventBase & {
      kind: 'status_removed';
      statusType?: string;
      actorId: string;
      targetId: string;
      statusId: string;
      statusName: string;
      stacks: number;
      reason: 'explicit' | 'decay';
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
  ordinal: 'first' | 'first_n' | 'nth' | 'every_n';
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
  /** Status affected by this event; distinct from the causing sourceId. */
  statusId?: string;
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
  actorSide?: 'player' | 'enemy';
  targetSide?: 'player' | 'enemy';
  paidEnergy?: number;
  paidTotal?: number;
  paidResources?: Readonly<Record<string, number>>;
  /** Runtime-owned actor ids used when an AI-facing query selects team scope. */
  teamActorIds?: readonly string[];
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
    ...('statusId' in event ? { statusId: event.statusId } : {}),
    ...('paidEnergy' in event ? { paidEnergy: event.paidEnergy } : {}),
    ...('paidTotal' in event ? { paidTotal: event.paidTotal } : {}),
    ...('paidResources' in event ? { paidResources: structuredClone(event.paidResources) } : {}),
    ...('actorId' in event ? { actorId: event.actorId } : {}),
    ...('targetId' in event ? { targetId: event.targetId } : {}),
    ...(event.actorSide ? { actorSide: event.actorSide } : {}),
    ...(event.targetSide ? { targetSide: event.targetSide } : {}),
    eventJournal,
  };
}

const MAX_EVENT_DEPTH = 32;
const MAX_EVENTS_PER_ROOT_SIGNATURE = 64;

export function createRunEventHistory(records: readonly RunBattleEventRecord[] = []): RunEventHistoryState {
  return { schemaVersion: 1, records: records.map(record => structuredClone(record)) };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStoredBattleEvent(value: unknown): value is BattleEvent {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' || !value.id ||
    !Number.isInteger(value.sequence) || value.sequence < 1 ||
    !Number.isInteger(value.turn) || value.turn < 0 ||
    !Number.isInteger(value.depth) || value.depth < 0 || value.depth > MAX_EVENT_DEPTH ||
    !BATTLE_EVENT_KINDS.includes(value.kind) ||
    !BATTLE_EVENT_PHASES.includes(value.phase) ||
    !isRecord(value.cause) || !isRecord(value.cause.source) ||
    !EVENT_SOURCE_KINDS.includes(value.cause.source.kind) ||
    typeof value.cause.source.id !== 'string' || !value.cause.source.id
  ) return false;

  const { id: _id, sequence: _sequence, depth: _depth, ...draft } = value;
  return appendBattleEvent(createBattleEventJournal(), draft as BattleEventDraft).ok;
}

/** Strict reader for run-owned history restored from host variables. */
export function readRunEventHistory(value: unknown): RunEventHistoryState | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.records)) return null;
  const records: RunBattleEventRecord[] = [];
  for (const record of value.records) {
    if (
      !isRecord(record) || typeof record.encounterId !== 'string' ||
      !record.encounterId.trim() || record.encounterId.length > 128 ||
      !isStoredBattleEvent(record.event)
    ) return null;
    records.push({ encounterId: record.encounterId, event: structuredClone(record.event) });
  }
  return { schemaVersion: 1, records };
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
  if ([draft.actorSide, draft.targetSide].some(side => side !== undefined && side !== 'player' && side !== 'enemy'))
    return { ok: false, code: 'INVALID_EVENT_VALUE', state };
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
  if (event.kind === 'card_played') {
    if (
      !Number.isInteger(event.paidEnergy ?? 0) || (event.paidEnergy ?? 0) < 0 ||
      !Number.isInteger(event.paidTotal ?? 0) || (event.paidTotal ?? 0) < 0 ||
      (event.paidResources !== undefined && (
        !isRecord(event.paidResources) || Object.entries(event.paidResources).some(([id, amount]) =>
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || !Number.isInteger(amount) || amount < 0)
      ))
    ) return { ok: false, code: 'INVALID_EVENT_VALUE', state };
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
  if (event.kind === 'draw_pile_shuffled' && (!Number.isInteger(event.recycledCards) || event.recycledCards < 0))
    return { ok: false, code: 'INVALID_EVENT_VALUE', state };
  if (
    (event.kind === 'lust_increased' || event.kind === 'lust_decreased' ||
      event.kind === 'block_gained' || event.kind === 'block_lost') &&
    ([event.previousValue, event.nextValue, event.amount].some(value => !Number.isFinite(value) || value < 0) || event.amount === 0)
  ) return { ok: false, code: 'INVALID_EVENT_VALUE', state };
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
    (event.kind === 'status_applied' || event.kind === 'status_triggered' || event.kind === 'status_removed' ||
      event.kind === 'summon_status_applied' || event.kind === 'summon_status_triggered' || event.kind === 'summon_status_removed') &&
    (('summonId' in event && !event.summonId) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(event.statusId) || !event.statusName ||
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

export function countBattleEvents(
  state: BattleEventJournalState,
  query: EventCounterQuery,
  predicate: (event: BattleEvent) => boolean = () => true,
): number {
  const current = state.events.filter(event => eventInScope(event, query) && battleEventMatches(event, query.filter) && predicate(event)).length;
  if (query.scope !== 'run') return current;
  const archived = state.runHistory?.records.filter(record => battleEventMatches(record.event, query.filter) && predicate(record.event)).length || 0;
  return archived + current;
}

export function matchesEventOrdinal(
  state: BattleEventJournalState,
  eventId: string,
  query: EventOrdinalQuery,
  predicate: (event: BattleEvent) => boolean = () => true,
): boolean {
  const matching = state.events.filter(event => eventInScope(event, query) && battleEventMatches(event, query.filter) && predicate(event));
  const index = matching.findIndex(event => event.id === eventId);
  if (index < 0) return false;
  const archived = query.scope === 'run'
    ? state.runHistory?.records.filter(record => battleEventMatches(record.event, query.filter) && predicate(record.event)).length || 0
    : 0;
  const ordinal = archived + index + 1;
  if (query.ordinal === 'first') return ordinal === 1;
  const n = Math.max(1, Math.floor(query.n || 1));
  if (query.ordinal === 'first_n') return ordinal <= n;
  return query.ordinal === 'nth' ? ordinal === n : ordinal % n === 0;
}

function contextMatchesFilter(context: BattleTriggerEventContext, filter: EventCounterFilter = {}): boolean {
  const keys: Array<keyof EventCounterFilter> = [
    'kind', 'phase', 'sourceKind', 'sourceId', 'reason', 'cardType', 'templateId', 'cardInstanceId',
    'damageKind', 'actorId', 'targetId',
  ];
  return keys.every(key => filter[key] === undefined || context[key] === filter[key]);
}

/** Count only events capable of dispatching this gameplay trigger to this recipient. */
function triggerHistoryPredicate(
  trigger: AbilityTrigger,
  context: BattleTriggerEventContext,
  scope: HistoryScope,
  checkPolarity = true,
): (event: BattleEvent) => boolean {
  const role = abilityTriggerRecipientScope(trigger);
  const roleKey = role === 'holder' || role === 'observer' ? 'targetId' : 'actorId';
  const currentOwner = context[roleKey];
  const team = context.teamActorIds;
  const sideKey = roleKey === 'targetId' ? 'targetSide' : 'actorSide';
  const currentSide = context[sideKey];
  const polarity = trigger.endsWith('_debuff') ? 'debuff' : trigger.endsWith('_buff') ? 'buff' : undefined;
  return event => {
    if (trigger === 'on_discard' && (
      event.kind !== 'card_moved' || event.from !== 'hand' || event.to !== 'discardPile' ||
      !CARD_DISCARD_TRIGGER_REASONS.has(event.moveReason)
    )) return false;
    if (trigger === 'on_exhaust' && (
      event.kind !== 'card_moved' || event.to !== 'exhaustPile' || event.moveReason !== 'exhaust'
    )) return false;
    if (event.kind === 'damage_resolved' && event.hpLost <= 0) return false;
    if (event.kind === 'heal_resolved' && event.hpGained <= 0) return false;
    if (role === 'source' && 'targetId' in event && event.actorId === event.targetId) return false;
    // Older journals did not persist polarity. Never infer it from a status
    // name; those ambiguous records are handled before ordinal evaluation.
    if (checkPolarity && polarity && (!('statusType' in event) || event.statusType !== polarity)) return false;
    const entityId = roleKey === 'targetId' && 'targetId' in event ? event.targetId
      : roleKey === 'actorId' && 'actorId' in event ? event.actorId : undefined;
    if (!entityId) return false;
    if ((role === 'observer' || scope === 'team') && currentSide && event[sideKey])
      return event[sideKey] === currentSide;
    if (role === 'observer' && team?.length) return !team.includes(entityId);
    if (scope === 'team') return Boolean(team?.includes(entityId));
    return currentOwner !== undefined && entityId === currentOwner;
  };
}

/** Match a filtered/ordinal trigger against one dispatched event. */
export function matchesEventTriggerQuery(
  context: BattleTriggerEventContext,
  query?: EventTriggerQuery,
  trigger?: AbilityTrigger,
): boolean {
  if (!query) return true;
  if (triggerEventFilterConflicts(trigger, query.filter)) return false;
  query = { ...query, filter: { ...impliedTriggerEventFilter(trigger), ...query.filter } };
  if (!contextMatchesFilter(context, query.filter)) return false;
  if (!query.ordinal) return true;
  const journal = context.eventJournal;
  if (!journal) return false;
  // A legacy journal lacking polarity cannot establish an exact nth buff or
  // debuff. Fail closed instead of ignoring that history and firing again.
  if (trigger && (trigger.endsWith('_buff') || trigger.endsWith('_debuff'))) {
    const sameRecipient = triggerHistoryPredicate(trigger, context, query.scope, false);
    const relevant = (event: BattleEvent) => battleEventMatches(event, query.filter) &&
      sameRecipient(event) &&
      (query.scope !== 'turn' || event.turn === (query.turn ?? context.turn)) &&
      (query.scope !== 'card_instance' || ('cardInstanceId' in event && event.cardInstanceId === (query.cardInstanceId ?? context.cardInstanceId)));
    const ambiguous = (event: BattleEvent) => relevant(event) &&
      (!('statusType' in event) || !['buff', 'debuff', 'neutral'].includes(event.statusType || ''));
    if (journal.events.some(ambiguous) ||
      (query.scope === 'run' && journal.runHistory?.records.some(record => ambiguous(record.event)))) return false;
  }
  const resolvedQuery: EventTriggerQuery = {
    ...query,
    ...(query.scope === 'turn' && query.turn === undefined ? { turn: context.turn } : {}),
    ...(query.scope === 'card_instance' && query.cardInstanceId === undefined
      ? { cardInstanceId: context.cardInstanceId }
      : {}),
    ...(query.scope === 'team' && query.teamActorIds === undefined && context.teamActorIds
      ? { teamActorIds: context.teamActorIds }
      : {}),
  };
  const predicate = trigger ? triggerHistoryPredicate(trigger, context, query.scope) : undefined;
  // A holder's team query follows the recipients, not the attackers. The
  // trigger-aware predicate applies that boundary; generic history queries
  // retain their existing actor-based team semantics.
  if (trigger && query.scope === 'team') resolvedQuery.scope = 'combat';
  if (context.eventRecorded && context.eventId) {
    return matchesEventOrdinal(journal, context.eventId, { ...resolvedQuery, ordinal: query.ordinal }, predicate);
  }
  // Some domain triggers are dispatched before their corresponding journal
  // event is appended. In that case the candidate is the next matching event.
  const ordinal = countBattleEvents(journal, resolvedQuery, predicate) + 1;
  if (query.ordinal === 'first') return ordinal === 1;
  const n = Math.max(1, Math.floor(query.n || 1));
  if (query.ordinal === 'first_n') return ordinal <= n;
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
