import type {
  RunTransactionCounters,
  RunTransactionEvent,
  RunTransactionEventType,
  RunTransactionSourceKind,
} from './runTransactions';

export type RunTriggerSourceKind = 'artifact' | 'ability' | 'status' | 'rule';
export type RunTriggerRewardCategory = 'cards' | 'artifacts' | 'items';

export interface RunTriggerSource {
  kind: RunTriggerSourceKind;
  id: string;
  name: string;
}

export type RunTriggerAction =
  | { op: 'gold'; amount: number }
  | { op: 'hp'; amount: number }
  | { op: 'card_removal'; amount: number }
  | { op: 'reward_category'; category: RunTriggerRewardCategory; enabled: boolean }
  | { op: 'reward_limit'; category: RunTriggerRewardCategory; amount: number };

export interface RunTriggerCountWindow {
  min?: number;
  max?: number;
  every?: number;
  offset?: number;
}

export type RunTriggerTransactionCounterCondition = RunTriggerCountWindow & (
  | { scope: 'total' }
  | { scope: 'event'; event: RunTransactionEventType }
  | { scope: 'source'; source_kind: RunTransactionSourceKind; source_id: string }
);

export interface RunTriggerCondition {
  node_kinds?: string[];
  source_kinds?: Array<RunTransactionEvent['source']['kind']>;
  node_id?: string;
  source_id?: string;
  min_gold_delta?: number;
  max_gold_delta?: number;
  event_sequence?: RunTriggerCountWindow;
  transaction_counters?: RunTriggerTransactionCounterCondition[];
}

export interface RunTriggerDefinition {
  id: string;
  on: RunTransactionEventType | RunTransactionEventType[];
  priority?: number;
  when?: RunTriggerCondition;
  actions: RunTriggerAction[];
  max_uses?: number;
}

export interface RunTriggerInvocation {
  id: string;
  eventId: string;
  eventSequence: number;
  triggerId: string;
  triggerKey: string;
  source: RunTriggerSource;
  priority: number;
  actions: Array<{ op: RunTriggerAction['op']; before: unknown; after: unknown }>;
}

export interface RunTriggerCounters {
  total: number;
  by_trigger: Record<string, number>;
  by_source_kind: Partial<Record<RunTriggerSourceKind, number>>;
  by_source: Record<string, number>;
}

export interface RunTriggerExecutionResult {
  invocations: RunTriggerInvocation[];
  counters: RunTriggerCounters;
}

interface ResolvedRunTrigger {
  source: RunTriggerSource;
  definition: RunTriggerDefinition;
  sourceOrder: number;
  declarationOrder: number;
  key: string;
}

const EVENT_TYPES = new Set<RunTransactionEventType>([
  'reward_claimed',
  'event_reward_claimed',
  'reward_pool_changed',
  'shop_purchased',
  'shop_left',
  'rest_healed',
  'card_removed',
  'card_duplicated',
  'card_transformed',
  'card_upgraded',
]);
const SOURCE_KINDS = new Set(['player', 'artifact', 'ability', 'status', 'event', 'system']);
const TRANSACTION_COUNTER_SCOPES = new Set(['total', 'event', 'source']);
const REWARD_CATEGORIES = new Set<RunTriggerRewardCategory>(['cards', 'artifacts', 'items']);
const SOURCE_ORDER: Record<RunTriggerSourceKind, number> = {
  artifact: 0,
  ability: 1,
  status: 2,
  rule: 3,
};
const INVOCATION_LIMIT = 200;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function records(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([key, entry]) => key !== '$meta' && isRecord(entry))
    .map(([, entry]) => entry as Record<string, any>);
}

function sourceIdentity(kind: RunTriggerSourceKind, value: Record<string, any>, index: number): RunTriggerSource {
  const id = String(value.id || '').trim();
  if (!id) throw new Error(`${kind} run trigger source at index ${index} requires a stable id`);
  return { kind, id, name: String(value.name || id) };
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const resolved = Number(value);
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return resolved;
}

function stableId(value: unknown, label: string, maximum = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new Error(`${label} must be a non-empty string up to ${maximum} characters`);
  }
  return value.trim();
}

function rejectUnknownKeys(value: Record<string, any>, allowed: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unsupported fields: ${unknown.join(', ')}`);
}

function validateCountWindow(
  value: Record<string, any>,
  label: string,
  minimum: number,
): RunTriggerCountWindow {
  const window: RunTriggerCountWindow = {};
  if (value.min !== undefined) window.min = integer(value.min, `${label}.min`, minimum, 999999999);
  if (value.max !== undefined) window.max = integer(value.max, `${label}.max`, minimum, 999999999);
  if (value.every !== undefined) window.every = integer(value.every, `${label}.every`, 1, 999999999);
  if (value.offset !== undefined) window.offset = integer(value.offset, `${label}.offset`, 0, 999999998);
  if (Object.keys(window).length === 0) throw new Error(`${label} must declare min, max, or every`);
  if (window.min !== undefined && window.max !== undefined && window.min > window.max) {
    throw new Error(`${label} has an inverted range`);
  }
  if (window.offset !== undefined && window.every === undefined) {
    throw new Error(`${label}.offset requires every`);
  }
  if (window.offset !== undefined && window.every !== undefined && window.offset >= window.every) {
    throw new Error(`${label}.offset must be smaller than every`);
  }
  return window;
}

function validateTransactionCounterCondition(
  value: unknown,
  label: string,
): RunTriggerTransactionCounterCondition {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  rejectUnknownKeys(
    value,
    new Set(['scope', 'event', 'source_kind', 'source_id', 'min', 'max', 'every', 'offset']),
    label,
  );
  if (!TRANSACTION_COUNTER_SCOPES.has(value.scope)) throw new Error(`${label} has an invalid scope`);
  const window = validateCountWindow(value, label, 0);
  if (value.scope === 'total') {
    if (value.event !== undefined || value.source_kind !== undefined || value.source_id !== undefined) {
      throw new Error(`${label} total scope cannot declare event or source fields`);
    }
    return { scope: 'total', ...window };
  }
  if (value.scope === 'event') {
    if (!EVENT_TYPES.has(value.event) || value.source_kind !== undefined || value.source_id !== undefined) {
      throw new Error(`${label} event scope requires one valid event and no source fields`);
    }
    return { scope: 'event', event: value.event, ...window };
  }
  if (!SOURCE_KINDS.has(value.source_kind) || value.event !== undefined) {
    throw new Error(`${label} source scope requires a valid source_kind and no event`);
  }
  return {
    scope: 'source',
    source_kind: value.source_kind,
    source_id: stableId(value.source_id, `${label}.source_id`, 96),
    ...window,
  };
}

function validateDefinition(value: unknown, source: RunTriggerSource, index: number): RunTriggerDefinition {
  if (!isRecord(value)) throw new Error(`${source.kind}:${source.id} run trigger ${index} must be an object`);
  const id = String(value.id || '').trim();
  if (!id || id.length > 96) throw new Error(`${source.kind}:${source.id} run trigger requires a stable id`);
  const on = Array.isArray(value.on) ? value.on : [value.on];
  if (on.length < 1 || new Set(on).size !== on.length || on.some(event => !EVENT_TYPES.has(event))) {
    throw new Error(`${source.kind}:${source.id}:${id} has invalid run trigger events`);
  }
  const priority = value.priority === undefined ? 0 : integer(value.priority, 'run trigger priority', -999, 999);
  const maxUses = value.max_uses === undefined ? undefined : integer(value.max_uses, 'run trigger max_uses', 1, 999);
  if (!Array.isArray(value.actions) || value.actions.length < 1 || value.actions.length > 32) {
    throw new Error(`${source.kind}:${source.id}:${id} must declare 1..32 run trigger actions`);
  }
  const actions = value.actions.map((action: unknown): RunTriggerAction => {
    if (!isRecord(action) || typeof action.op !== 'string') throw new Error(`${source.kind}:${source.id}:${id} has an invalid action`);
    if (action.op === 'gold' || action.op === 'hp' || action.op === 'card_removal') {
      return { op: action.op, amount: integer(action.amount, `${action.op} amount`, -9999, 9999) };
    }
    if (action.op === 'reward_category') {
      if (!REWARD_CATEGORIES.has(action.category) || typeof action.enabled !== 'boolean') {
        throw new Error(`${source.kind}:${source.id}:${id} has an invalid reward_category action`);
      }
      return { op: action.op, category: action.category, enabled: action.enabled };
    }
    if (action.op === 'reward_limit') {
      if (!REWARD_CATEGORIES.has(action.category)) {
        throw new Error(`${source.kind}:${source.id}:${id} has an invalid reward_limit category`);
      }
      return { op: action.op, category: action.category, amount: integer(action.amount, 'reward_limit amount', -99, 99) };
    }
    throw new Error(`${source.kind}:${source.id}:${id} has an unsupported action`);
  });
  let when: RunTriggerCondition | undefined;
  if (value.when !== undefined) {
    if (!isRecord(value.when)) throw new Error(`${source.kind}:${source.id}:${id} has invalid conditions`);
    rejectUnknownKeys(
      value.when,
      new Set([
        'node_kinds',
        'source_kinds',
        'node_id',
        'source_id',
        'min_gold_delta',
        'max_gold_delta',
        'event_sequence',
        'transaction_counters',
      ]),
      `${source.kind}:${source.id}:${id} conditions`,
    );
    const condition: RunTriggerCondition = {};
    if (value.when.node_kinds !== undefined) {
      if (!Array.isArray(value.when.node_kinds) || value.when.node_kinds.some((kind: unknown) => typeof kind !== 'string' || !kind)) {
        throw new Error(`${source.kind}:${source.id}:${id} has invalid node_kinds`);
      }
      condition.node_kinds = [...new Set(value.when.node_kinds)];
    }
    if (value.when.source_kinds !== undefined) {
      if (!Array.isArray(value.when.source_kinds) || value.when.source_kinds.some((kind: unknown) => !SOURCE_KINDS.has(String(kind)))) {
        throw new Error(`${source.kind}:${source.id}:${id} has invalid source_kinds`);
      }
      condition.source_kinds = [...new Set(value.when.source_kinds)] as Array<RunTransactionEvent['source']['kind']>;
    }
    if (value.when.node_id !== undefined) condition.node_id = stableId(value.when.node_id, 'node_id');
    if (value.when.source_id !== undefined) condition.source_id = stableId(value.when.source_id, 'source_id', 96);
    if (value.when.min_gold_delta !== undefined) {
      condition.min_gold_delta = integer(value.when.min_gold_delta, 'min_gold_delta', -999999, 999999);
    }
    if (value.when.max_gold_delta !== undefined) {
      condition.max_gold_delta = integer(value.when.max_gold_delta, 'max_gold_delta', -999999, 999999);
    }
    if (condition.min_gold_delta !== undefined && condition.max_gold_delta !== undefined && condition.min_gold_delta > condition.max_gold_delta) {
      throw new Error(`${source.kind}:${source.id}:${id} has an inverted gold delta range`);
    }
    if (value.when.event_sequence !== undefined) {
      if (!isRecord(value.when.event_sequence)) throw new Error(`${source.kind}:${source.id}:${id} has invalid event_sequence`);
      rejectUnknownKeys(
        value.when.event_sequence,
        new Set(['min', 'max', 'every', 'offset']),
        `${source.kind}:${source.id}:${id} event_sequence`,
      );
      condition.event_sequence = validateCountWindow(
        value.when.event_sequence,
        `${source.kind}:${source.id}:${id} event_sequence`,
        1,
      );
    }
    if (value.when.transaction_counters !== undefined) {
      if (
        !Array.isArray(value.when.transaction_counters) ||
        value.when.transaction_counters.length < 1 ||
        value.when.transaction_counters.length > 16
      ) {
        throw new Error(`${source.kind}:${source.id}:${id} transaction_counters must contain 1..16 conditions`);
      }
      condition.transaction_counters = value.when.transaction_counters.map((entry: unknown, conditionIndex: number) =>
        validateTransactionCounterCondition(
          entry,
          `${source.kind}:${source.id}:${id} transaction_counters[${conditionIndex}]`,
        ));
    }
    when = condition;
  }
  return {
    id,
    on: on as RunTransactionEventType[],
    priority,
    ...(when ? { when } : {}),
    actions,
    ...(maxUses !== undefined ? { max_uses: maxUses } : {}),
  };
}

function activeStatusIds(stat: Record<string, any>): Set<string> {
  return new Set(records(stat.battle?.player_status_effects)
    .map(status => String(status.id || status.status || status.statusId || '').trim())
    .filter(Boolean));
}

function triggerSources(stat: Record<string, any>): Array<{ kind: RunTriggerSourceKind; value: Record<string, any> }> {
  const activeIds = activeStatusIds(stat);
  const activeEffects = records(stat.battle?.player_status_effects);
  const statusDefinitions = new Map(records(stat.battle?.statuses)
    .filter(status => activeIds.has(String(status.id || '')))
    .map(status => [String(status.id), status]));
  const activeStatuses = activeEffects.map(effect =>
    effect.run_triggers !== undefined ? effect : statusDefinitions.get(String(effect.id || effect.status || effect.statusId || '')) || effect);
  return [
    ...records(stat.battle?.artifacts).map(value => ({ kind: 'artifact' as const, value })),
    ...records(stat.battle?.player_abilities).map(value => ({ kind: 'ability' as const, value })),
    ...activeStatuses.map(value => ({ kind: 'status' as const, value })),
    ...records(stat.status?.permanent_status).map(value => ({ kind: 'status' as const, value })),
    ...records(stat.status?.temporary_status).map(value => ({ kind: 'status' as const, value })),
    ...records(stat.run_rules).map(value => ({ kind: 'rule' as const, value })),
  ];
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectTriggers(stat: Record<string, any>): ResolvedRunTrigger[] {
  const resolved: ResolvedRunTrigger[] = [];
  const seen = new Set<string>();
  triggerSources(stat).forEach(({ kind, value }, sourceIndex) => {
    if (value.run_triggers === undefined) return;
    if (!Array.isArray(value.run_triggers)) throw new Error(`${kind} run_triggers must be an array`);
    const source = sourceIdentity(kind, value, sourceIndex);
    value.run_triggers.forEach((raw: unknown, declarationOrder: number) => {
      const definition = validateDefinition(raw, source, declarationOrder);
      const key = `${source.kind}:${source.id}:${definition.id}`;
      if (seen.has(key)) throw new Error(`duplicate run trigger identity: ${key}`);
      seen.add(key);
      resolved.push({ source, definition, sourceOrder: SOURCE_ORDER[kind], declarationOrder, key });
    });
  });
  return resolved.sort((left, right) =>
    (right.definition.priority || 0) - (left.definition.priority || 0) ||
    left.sourceOrder - right.sourceOrder ||
    compareStableText(left.source.id, right.source.id) ||
    compareStableText(left.definition.id, right.definition.id) ||
    left.declarationOrder - right.declarationOrder);
}

function readCounters(stat: Record<string, any>): RunTriggerCounters {
  const value = stat.run_trigger_counters ?? {
    total: 0,
    by_trigger: {},
    by_source_kind: {},
    by_source: {},
  };
  const bySourceKind = value.by_source_kind ?? {};
  const bySource = value.by_source ?? {};
  if (
    !isRecord(value) ||
    !Number.isInteger(value.total) ||
    value.total < 0 ||
    !isRecord(value.by_trigger) ||
    !isRecord(bySourceKind) ||
    !isRecord(bySource)
  ) {
    throw new Error('run trigger counters are invalid');
  }
  for (const kind of Object.keys(bySourceKind)) {
    if (!Object.hasOwn(SOURCE_ORDER, kind)) throw new Error('run trigger source-kind counter is invalid');
  }
  for (const count of [...Object.values(value.by_trigger), ...Object.values(bySourceKind), ...Object.values(bySource)]) {
    if (!Number.isInteger(count) || Number(count) < 0) throw new Error('run trigger counter is invalid');
  }
  return {
    total: value.total,
    by_trigger: clone(value.by_trigger),
    by_source_kind: clone(bySourceKind),
    by_source: clone(bySource),
  };
}

function readInvocations(stat: Record<string, any>): RunTriggerInvocation[] {
  const value = stat.run_trigger_invocations ?? [];
  if (!Array.isArray(value)) throw new Error('run trigger invocations are invalid');
  return clone(value);
}

function readNextTransactionCounters(
  stat: Record<string, any>,
  event: RunTransactionEvent,
): RunTransactionCounters {
  const value = stat.run_transaction_counters ?? { total: 0, by_event: {}, by_source: {} };
  if (
    !isRecord(value) ||
    !Number.isInteger(value.total) ||
    value.total < 0 ||
    !isRecord(value.by_event) ||
    !isRecord(value.by_source)
  ) {
    throw new Error('run transaction counters are invalid');
  }
  for (const count of [...Object.values(value.by_event), ...Object.values(value.by_source)]) {
    if (!Number.isInteger(count) || Number(count) < 0) throw new Error('run transaction counter is invalid');
  }
  const sourceKey = `${event.source.kind}:${event.source.id}`;
  return {
    total: value.total + 1,
    by_event: {
      ...clone(value.by_event),
      [event.type]: Number(value.by_event[event.type] || 0) + 1,
    },
    by_source: {
      ...clone(value.by_source),
      [sourceKey]: Number(value.by_source[sourceKey] || 0) + 1,
    },
  };
}

function matchesCountWindow(value: number, window: RunTriggerCountWindow): boolean {
  if (window.min !== undefined && value < window.min) return false;
  if (window.max !== undefined && value > window.max) return false;
  if (window.every !== undefined && value % window.every !== (window.offset || 0)) return false;
  return true;
}

function transactionCounterValue(
  condition: RunTriggerTransactionCounterCondition,
  counters: RunTransactionCounters,
): number {
  if (condition.scope === 'total') return counters.total;
  if (condition.scope === 'event') return counters.by_event[condition.event] || 0;
  return counters.by_source[`${condition.source_kind}:${condition.source_id}`] || 0;
}

function matches(
  trigger: ResolvedRunTrigger,
  event: RunTransactionEvent,
  transactionCounters: RunTransactionCounters,
): boolean {
  const events = Array.isArray(trigger.definition.on) ? trigger.definition.on : [trigger.definition.on];
  if (!events.includes(event.type)) return false;
  const when = trigger.definition.when;
  if (!when) return true;
  if (when.node_kinds && (!event.nodeKind || !when.node_kinds.includes(event.nodeKind))) return false;
  if (when.source_kinds && !when.source_kinds.includes(event.source.kind)) return false;
  if (when.node_id !== undefined && event.nodeId !== when.node_id) return false;
  if (when.source_id !== undefined && event.source.id !== when.source_id) return false;
  if (when.min_gold_delta !== undefined && event.goldDelta < when.min_gold_delta) return false;
  if (when.max_gold_delta !== undefined && event.goldDelta > when.max_gold_delta) return false;
  if (when.event_sequence && !matchesCountWindow(event.sequence, when.event_sequence)) return false;
  if (
    when.transaction_counters &&
    when.transaction_counters.some(condition =>
      !matchesCountWindow(transactionCounterValue(condition, transactionCounters), condition))
  ) return false;
  return true;
}

function rewardRoot(stat: Record<string, any>): Record<string, any> {
  if (!isRecord(stat.reward)) throw new Error('run trigger reward action requires reward data');
  return stat.reward;
}

function executeAction(stat: Record<string, any>, action: RunTriggerAction): { op: RunTriggerAction['op']; before: unknown; after: unknown } {
  if (action.op === 'gold') {
    if (!isRecord(stat.run) || !Number.isInteger(stat.run.gold)) throw new Error('run trigger gold action requires an active run');
    const before = stat.run.gold;
    stat.run.gold = Math.max(0, before + action.amount);
    return { op: action.op, before, after: stat.run.gold };
  }
  if (action.op === 'hp') {
    if (!isRecord(stat.battle?.core)) throw new Error('run trigger hp action requires battle.core');
    const hp = Number(stat.battle.core.hp);
    const maxHp = Number(stat.battle.core.max_hp);
    if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) throw new Error('run trigger hp action requires valid hp values');
    stat.battle.core.hp = Math.max(0, Math.min(maxHp, hp + action.amount));
    return { op: action.op, before: hp, after: stat.battle.core.hp };
  }
  if (action.op === 'card_removal') {
    if (!isRecord(stat.battle?.core)) throw new Error('run trigger card_removal action requires battle.core');
    const before = Number(stat.battle.core.card_removal_count ?? 0);
    if (!Number.isInteger(before) || before < 0) throw new Error('run trigger card removal count is invalid');
    stat.battle.core.card_removal_count = Math.max(0, before + action.amount);
    return { op: action.op, before, after: stat.battle.core.card_removal_count };
  }
  if (action.op === 'reward_category') {
    const reward = rewardRoot(stat);
    const before = Array.isArray(reward.disabled_categories) ? [...reward.disabled_categories] : [];
    const disabled = new Set(before.filter((value: unknown) => REWARD_CATEGORIES.has(value as RunTriggerRewardCategory)));
    if (action.enabled) disabled.delete(action.category);
    else disabled.add(action.category);
    reward.disabled_categories = [...disabled].sort();
    return { op: action.op, before, after: clone(reward.disabled_categories) };
  }
  const reward = rewardRoot(stat);
  if (!isRecord(reward.limits)) reward.limits = {};
  const before = Number(reward.limits[action.category] ?? 0);
  if (!Number.isInteger(before) || before < 0) throw new Error('run trigger reward limit is invalid');
  reward.limits[action.category] = Math.max(0, before + action.amount);
  return { op: action.op, before, after: reward.limits[action.category] };
}

/** Execute current-event run triggers inline. Existing event history is never replayed. */
export function executeRunTransactionTriggers(
  statValue: unknown,
  event: RunTransactionEvent,
): RunTriggerExecutionResult {
  if (!isRecord(statValue)) throw new Error('run trigger stat root is invalid');
  const stat = statValue;
  const invocations = readInvocations(stat);
  const invocationIds = new Set(invocations.map(invocation => invocation.id));
  let counters = readCounters(stat);
  const transactionCounters = readNextTransactionCounters(stat, event);
  const current: RunTriggerInvocation[] = [];

  for (const trigger of collectTriggers(stat)) {
    if (!matches(trigger, event, transactionCounters)) continue;
    const used = counters.by_trigger[trigger.key] || 0;
    if (trigger.definition.max_uses !== undefined && used >= trigger.definition.max_uses) continue;
    const id = `${event.id}:${trigger.key}`;
    if (invocationIds.has(id)) continue;
    const actions = trigger.definition.actions.map(action => executeAction(stat, action));
    const invocation: RunTriggerInvocation = {
      id,
      eventId: event.id,
      eventSequence: event.sequence,
      triggerId: trigger.definition.id,
      triggerKey: trigger.key,
      source: clone(trigger.source),
      priority: trigger.definition.priority || 0,
      actions,
    };
    current.push(invocation);
    invocations.push(invocation);
    invocationIds.add(id);
    const sourceKey = `${trigger.source.kind}:${trigger.source.id}`;
    counters = {
      total: counters.total + 1,
      by_trigger: { ...counters.by_trigger, [trigger.key]: used + 1 },
      by_source_kind: {
        ...counters.by_source_kind,
        [trigger.source.kind]: (counters.by_source_kind[trigger.source.kind] || 0) + 1,
      },
      by_source: {
        ...counters.by_source,
        [sourceKey]: (counters.by_source[sourceKey] || 0) + 1,
      },
    };
  }

  stat.run_trigger_invocations = invocations.slice(-INVOCATION_LIMIT);
  stat.run_trigger_counters = counters;
  return { invocations: clone(current), counters: clone(counters) };
}
