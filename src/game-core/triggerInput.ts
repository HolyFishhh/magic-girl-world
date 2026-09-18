import type {
  BattleEventKind,
  BattleEventPhase,
  DamageKind,
  EventSourceKind,
  EventTriggerQuery,
  HistoryScope,
} from './battleEventJournal';
import { impliedTriggerEventFilter } from './triggerEventContract';

export interface ResolvedTriggerInput {
  /** Raw trigger name. Validation remains the caller's responsibility. */
  trigger: unknown;
  /** Effects owned by the trigger, or the legacy sibling effects source. */
  triggeredEffects: unknown;
  /** Effects resolved immediately when a structured trigger is also present. */
  immediateEffects: unknown;
  structured: boolean;
  /** Optional event metadata/ordinal filter carried by the trigger definition. */
  eventQuery?: EventTriggerQuery;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function omitEmptyOptionalEffectSource(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 0) return undefined;
  if (isRecord(value) && Object.keys(value).length === 0) return undefined;
  return value;
}

const EVENT_QUERY_KEYS = new Set([
  'scope', 'ordinal', 'n', 'event', 'phase', 'reason', 'source_kind', 'source_id', 'damage_type',
  'card_type', 'template_id', 'card_instance_id', 'actor_id', 'target_id',
]);

export function resolveEventTriggerQueryInput(value: unknown): EventTriggerQuery | undefined {
  if (!isRecord(value)) return undefined;
  const hasQuery = Object.keys(value).some(key => EVENT_QUERY_KEYS.has(key));
  if (!hasQuery) return undefined;
  const filter = {
    ...impliedTriggerEventFilter(value.on),
    ...(value.event !== undefined ? { kind: value.event as BattleEventKind } : {}),
    ...(value.phase !== undefined ? { phase: value.phase as BattleEventPhase } : {}),
    ...(value.reason !== undefined ? { reason: String(value.reason) } : {}),
    ...(value.source_kind !== undefined ? { sourceKind: value.source_kind as EventSourceKind } : {}),
    ...(value.source_id !== undefined ? { sourceId: String(value.source_id) } : {}),
    ...(value.damage_type !== undefined ? { damageKind: value.damage_type as DamageKind } : {}),
    ...(value.card_type !== undefined ? { cardType: String(value.card_type) } : {}),
    ...(value.template_id !== undefined ? { templateId: String(value.template_id) } : {}),
    ...(value.card_instance_id !== undefined ? { cardInstanceId: String(value.card_instance_id) } : {}),
    ...(value.actor_id !== undefined ? { actorId: String(value.actor_id) } : {}),
    ...(value.target_id !== undefined ? { targetId: String(value.target_id) } : {}),
  };
  return {
    scope: (value.scope || 'combat') as HistoryScope,
    ...(value.ordinal !== undefined ? { ordinal: value.ordinal as EventTriggerQuery['ordinal'] } : {}),
    ...(value.n !== undefined ? { n: Number(value.n) } : {}),
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
  };
}

/**
 * Resolve the AI-facing trigger boundary.
 *
 * The preferred shape keeps timing and behavior together:
 * `trigger: { on: "...", effects: {...} }`.
 * A sibling string trigger is still read so already-created saves remain playable.
 */
export function resolveTriggerInput(value: Record<string, unknown>): ResolvedTriggerInput {
  if (isRecord(value.trigger)) {
    return {
      trigger: value.trigger.on,
      triggeredEffects: value.trigger.effects,
      // A structured trigger owns the actual executable behavior. An empty
      // optional root effect is therefore exactly equivalent to omission and
      // should not force a model repair. Empty trigger.effects stays strict.
      immediateEffects: omitEmptyOptionalEffectSource(value.effects),
      structured: true,
      ...(resolveEventTriggerQueryInput(value.trigger)
        ? { eventQuery: resolveEventTriggerQueryInput(value.trigger) }
        : {}),
    };
  }
  // Some JSON-schema transports serialize an omitted optional property as
  // `null`. A null trigger carries no timing or behavior and is therefore
  // semantically identical to omission. Required-trigger consumers still
  // reject it as missing, while ordinary cards and status-installing Powers
  // do not need a model repair solely to delete this empty optional key.
  const trigger = value.trigger === null ? undefined : value.trigger;
  return {
    trigger,
    triggeredEffects: value.effects,
    immediateEffects: undefined,
    structured: false,
  };
}

export function isStructuredTriggerInput(value: unknown): value is { on?: unknown; effects?: unknown } {
  return isRecord(value);
}
