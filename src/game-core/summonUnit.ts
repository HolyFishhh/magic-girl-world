import { absorbDamageWithBlock, applyNumericOperator, roundBattleValue } from './battleMath';
import type { CombatResourceState } from './combatResource';
import type { EventTriggerQuery } from './battleEventJournal';
import type { BattleTriggerDispatch } from './battleEventDispatch';
import { resolveStatusOwnershipTriggerDispatch } from './battleEventDispatch';
import type { BattleTriggerEventContext } from './battleEventJournal';
import type { CardValueOperator, CardValueStat, EffectProgram } from './effectDsl';
import { transformCardEffectProgram } from './cardValueTransform';
import { resolveStatusApplication, resolveStatusStacksChange } from './statusApplication';
import type { RuntimeStatusDefinition, StatusRuntimeEffect, StatusTickTiming } from './statusDefinitionRuntime';
import type { StatusEventTrigger, StatusTrigger } from './battleTriggers';
import { runTriggerTransaction, type TriggerTransactionPorts } from './triggerTransaction';

export type BattleOwner = 'player' | 'enemy';
export type SummonOverflowPolicy = 'reject' | 'replace_oldest' | 'replace_lowest_hp';
export type SummonPick =
  | 'left' | 'right' | 'choose'
  /** Compatibility aliases retained for already-authored content. */
  | 'first' | 'last'
  | 'random' | 'random_n' | 'all' | 'lowest_hp' | 'highest_hp' | 'by_id' | 'source';

export interface SummonStatusState {
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
  hits: Array<{ summonId: string; requested: number; modified?: number; blocked: number; hpLost: number; prevented?: number; defeated: boolean }>;
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
  summonStatusContext: { summonId: string };
}

export type SummonStatusLifecycleEvent =
  | { type: 'missing_definition'; summonId: string; statusId: string }
  | {
      type: 'status_applied'; summon: SummonUnit; status: SummonStatusState;
      trigger: 'apply' | 'stack';
    }
  | {
      type: 'trigger_started'; summon: SummonUnit; status: SummonStatusState;
      trigger: SummonStatusExecutableTrigger;
    }
  | {
      type: 'trigger_completed'; summon: SummonUnit; status: SummonStatusState;
      trigger: SummonStatusExecutableTrigger;
    }
  | {
      type: 'status_removed'; summon: SummonUnit; status: SummonStatusState;
      reason: 'explicit' | 'decay';
    }
  | {
      type: 'trigger_failed'; summon: SummonUnit; status: SummonStatusState;
      trigger: SummonStatusExecutableTrigger; cause: unknown;
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
  execute(
    effect: StatusRuntimeEffect,
    owner: BattleOwner,
    context: SummonStatusLifecycleExecutionContext,
  ): MaybePromise<void>;
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

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function count(value: unknown, minimum = 0, maximum = 100): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function hpRatio(unit: SummonUnit): number {
  return unit.hasHp === false ? 1 : unit.maxHp > 0 ? unit.currentHp / unit.maxHp : 0;
}

export function isSummonAlive(unit: Pick<SummonUnit, 'hasHp' | 'currentHp'>): boolean {
  return unit.hasHp === false || unit.currentHp > 0;
}

function storedSummonerId(unit: Pick<SummonUnit, 'owner' | 'summonerId'>): string | null {
  // Only a missing legacy player field is unambiguous. Explicit null stays unknown.
  return unit.summonerId === undefined ? (unit.owner === 'player' ? 'player' : null) : unit.summonerId;
}

export function createSummonCollectionState(
  living: readonly SummonUnit[] = [],
  defeated: readonly SummonUnit[] = [],
): SummonCollectionState {
  const seen = new Set<string>();
  const normalize = (values: readonly SummonUnit[], shouldLive: boolean): SummonUnit[] => values
    .filter(unit => Boolean(unit?.instanceId) && !seen.has(unit.instanceId))
    .map(unit => {
      seen.add(unit.instanceId);
      const hasHp = unit.hasHp !== false;
      const maxHp = hasHp ? Math.max(1, roundBattleValue(unit.maxHp)) : 0;
      const currentHp = hasHp ? Math.min(maxHp, Math.max(0, roundBattleValue(unit.currentHp))) : 0;
      return {
        ...clone(unit),
        hasHp,
        maxHp,
        currentHp: shouldLive && hasHp ? Math.max(0.01, currentHp) : 0,
        block: Math.max(0, roundBattleValue(unit.block || 0)),
        actionsPerActivation: count(unit.actionsPerActivation ?? 1, 0, 20),
        createdSequence: count(unit.createdSequence, 1, Number.MAX_SAFE_INTEGER),
        interceptionsThisTurn: count(unit.interceptionsThisTurn, 0, 100),
        plannedActionIds: (unit.plannedActionIds || []).filter(id => typeof id === 'string' && id.length > 0),
      };
    });
  const normalizedLiving = normalize(living.filter(isSummonAlive), true);
  const normalizedDefeated = normalize(defeated, false);
  const highest = [...normalizedLiving, ...normalizedDefeated].reduce(
    (maximum, unit) => Math.max(maximum, unit.createdSequence),
    0,
  );
  return { living: normalizedLiving, defeated: normalizedDefeated, nextSequence: highest + 1 };
}

export function validateSummonDefinition(definition: SummonUnitDefinition): string[] {
  const issues: string[] = [];
  if (!ID.test(definition.id)) issues.push('id');
  if (!definition.name?.trim()) issues.push('name');
  if (!definition.emoji?.trim()) issues.push('emoji');
  if (definition.hasHp !== undefined && typeof definition.hasHp !== 'boolean') issues.push('hasHp');
  if (definition.hasHp !== false && (!Number.isFinite(definition.maxHp) || Number(definition.maxHp) <= 0)) issues.push('maxHp');
  if (definition.hasHp === false && definition.maxHp !== undefined && definition.maxHp !== 0) issues.push('maxHp');
  if (definition.block !== undefined && (!Number.isFinite(definition.block) || definition.block < 0)) issues.push('block');
  if (definition.actionProgram && definition.actions !== undefined) issues.push('actions');
  if (definition.modifiers !== undefined && Object.entries(definition.modifiers).some(([key, value]) =>
    ![
      'damage_modifier', 'damage_taken_modifier', 'lust_damage_modifier',
      'lust_damage_taken_modifier', 'heal_modifier', 'block_modifier',
    ].includes(key) || typeof value !== 'number' || !Number.isFinite(value)
  )) issues.push('modifiers');
  if (!Number.isInteger(definition.actionsPerActivation ?? 1) || (definition.actionsPerActivation ?? 1) < 0 || (definition.actionsPerActivation ?? 1) > 20)
    issues.push('actionsPerActivation');
  if (definition.actionProgram && (definition.actionProgram.spec !== 'mwg.effect/v1' || !Array.isArray(definition.actionProgram.steps)))
    issues.push('actionProgram');
  if (definition.actions !== undefined && (
    !Array.isArray(definition.actions) || definition.actions.length > 20 || definition.actions.some(action =>
      !ID.test(action?.id || '') || !action?.name?.trim() ||
      (action.fixed !== undefined && typeof action.fixed !== 'boolean') ||
      (action.weight !== undefined && (!Number.isFinite(action.weight) || action.weight <= 0)) ||
      action.effectProgram?.spec !== 'mwg.effect/v1' || !Array.isArray(action.effectProgram?.steps)
    )
  )) issues.push('actions');
  if (definition.abilities !== undefined && (
    !Array.isArray(definition.abilities) || definition.abilities.length > 20 || definition.abilities.some(ability =>
      !ID.test(ability?.id || '') || !ability?.trigger?.trim() ||
      (ability.fixed !== undefined && typeof ability.fixed !== 'boolean') ||
      ability.effectProgram?.spec !== 'mwg.effect/v1' || !Array.isArray(ability.effectProgram?.steps)
    )
  )) issues.push('abilities');
  if (definition.intercept?.maxPerTurn !== undefined && (!Number.isInteger(definition.intercept.maxPerTurn) || definition.intercept.maxPerTurn < 1))
    issues.push('intercept.maxPerTurn');
  if (definition.slot !== undefined && (!ID.test(definition.slot) || definition.onExisting === 'add_instance')) issues.push('slot');
  if (definition.onExistingProgram && (!definition.slot || definition.onExisting === 'replace' ||
    definition.onExistingProgram.spec !== 'mwg.effect/v1' || !definition.onExistingProgram.steps?.length)) issues.push('onExistingProgram');
  return [...new Set(issues)];
}

export function spawnSummonUnits(
  current: SummonCollectionState,
  owner: BattleOwner,
  definition: SummonUnitDefinition,
  requestedCount: number,
  capacity = owner === 'enemy' ? Number.MAX_SAFE_INTEGER : 3,
  overflow: SummonOverflowPolicy = 'replace_oldest',
  createdTurn = 0,
  summonerId: string | null = owner === 'player' ? 'player' : null,
): { state: SummonCollectionState; spawned: SummonUnit[]; replaced: SummonUnit[] } {
  const issues = validateSummonDefinition(definition);
  if (issues.length > 0) throw new Error(`invalid summon definition: ${issues.join(',')}`);
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, count(current.nextSequence, 1, Number.MAX_SAFE_INTEGER));
  const spawned: SummonUnit[] = [];
  const replaced: SummonUnit[] = [];
  const limit = count(capacity, 1, Number.MAX_SAFE_INTEGER);
  for (let index = 0; index < count(requestedCount, 0, 32); index += 1) {
    const slotMatch = definition.slot
      ? state.living.find(unit => unit.owner === owner && unit.slot === definition.slot &&
        storedSummonerId(unit) === summonerId)
      : undefined;
    if (slotMatch) {
      const existingPolicy = definition.onExisting || 'reinforce';
      if (existingPolicy === 'reinforce') {
        const existingIndex = state.living.findIndex(unit => unit.instanceId === slotMatch.instanceId);
        const addedHp = definition.hasHp === false || definition.onExistingProgram ? 0 : roundBattleValue(Number(definition.maxHp));
        state.living[existingIndex] = {
          ...slotMatch,
          maxHp: slotMatch.hasHp === false ? 0 : roundBattleValue(slotMatch.maxHp + addedHp),
          currentHp: slotMatch.hasHp === false ? 0 : roundBattleValue(slotMatch.currentHp + addedHp),
        };
        spawned.push(clone(state.living[existingIndex]));
        continue;
      }
      state.living = state.living.filter(unit => unit.instanceId !== slotMatch.instanceId);
      const defeated = { ...slotMatch, currentHp: 0 };
      state.defeated.push(defeated);
      replaced.push(clone(defeated));
    }
    const corpseIndex = definition.slot
      ? state.defeated.findIndex(unit => unit.owner === owner && unit.slot === definition.slot &&
        storedSummonerId(unit) === summonerId)
      : -1;
    if (corpseIndex >= 0 && definition.onDefeated && definition.onDefeated !== 'new_instance') {
      const corpse = state.defeated.splice(corpseIndex, 1)[0];
      const reinforce = definition.onDefeated === 'revive_reinforce';
      const hasHp = definition.hasHp !== false;
      const authoredMaxHp = hasHp ? roundBattleValue(Number(definition.maxHp)) : 0;
      const maxHp = hasHp && reinforce ? roundBattleValue(corpse.maxHp + authoredMaxHp) : authoredMaxHp;
      const revived: SummonUnit = {
        ...corpse,
        ...clone(definition),
        id: corpse.id,
        templateId: corpse.templateId,
        instanceId: corpse.instanceId,
        owner,
        summonerId,
        hasHp,
        maxHp,
        currentHp: hasHp ? maxHp : 0,
        createdTurn: count(createdTurn, 0, Number.MAX_SAFE_INTEGER),
        interceptionsThisTurn: 0,
      };
      state.living.push(revived);
      spawned.push(clone(revived));
      continue;
    }
    const owned = state.living.filter(unit => unit.owner === owner);
    if (owned.length >= limit) {
      if (overflow === 'reject') break;
      const victim = [...owned].sort((left, right) => overflow === 'replace_oldest'
        ? left.createdSequence - right.createdSequence
        : hpRatio(left) - hpRatio(right) || left.createdSequence - right.createdSequence)[0];
      if (!victim) break;
      state.living = state.living.filter(unit => unit.instanceId !== victim.instanceId);
      const defeated = { ...victim, currentHp: 0 };
      state.defeated.push(defeated);
      replaced.push(clone(defeated));
    }
    const sequence = state.nextSequence++;
    const hasHp = definition.hasHp !== false;
    const maxHp = hasHp ? roundBattleValue(Number(definition.maxHp)) : 0;
    const unit: SummonUnit = {
      ...clone(definition),
      id: `${definition.id}__summon__${sequence}`,
      templateId: definition.id,
      instanceId: `${definition.id}__summon__${sequence}`,
      owner,
      summonerId,
      hasHp,
      maxHp,
      currentHp: maxHp,
      block: Math.max(0, roundBattleValue(definition.block || 0)),
      statusEffects: clone(definition.statusEffects || []),
      resources: clone(definition.resources || {}),
      modifiers: clone(definition.modifiers || {}),
      actionsPerActivation: count(definition.actionsPerActivation ?? 1, 0, 20),
      createdTurn: count(createdTurn, 0, Number.MAX_SAFE_INTEGER),
      createdSequence: sequence,
      interceptionsThisTurn: 0,
    };
    state.living.push(unit);
    spawned.push(clone(unit));
  }
  return { state, spawned, replaced };
}

function ownerMatches(unit: SummonUnit, selector: SummonSelector, source: BattleOwner): boolean {
  if (selector.owner === 'any') return true;
  const resolved = selector.owner === 'self' ? source : source === 'player' ? 'enemy' : 'player';
  return unit.owner === resolved;
}

export function resolveSummonTargets(
  state: SummonCollectionState,
  selector: SummonSelector,
  source: BattleOwner,
  random: () => number = Math.random,
): SummonUnit[] {
  // Source is bound by the execution host; never randomly choose without context.
  if (selector.pick === 'source') return [];
  let candidates = state.living.filter(unit => isSummonAlive(unit) && ownerMatches(unit, selector, source));
  if (!selector.includeUntargetable) candidates = candidates.filter(unit => unit.capabilities?.selectable !== false);
  if (selector.id) candidates = candidates.filter(unit => unit.instanceId === selector.id);
  if (selector.templateId) candidates = candidates.filter(unit => unit.templateId === selector.templateId);
  if (selector.slot) candidates = candidates.filter(unit => unit.slot === selector.slot);
  if (selector.tags?.length) candidates = candidates.filter(unit => selector.tags!.every(tag => unit.tags?.includes(tag)));
  candidates = [...candidates].sort((left, right) => left.createdSequence - right.createdSequence);
  const requested = selector.pick === 'all'
    ? candidates.length
    : Math.min(candidates.length, Math.max(1, Math.floor(Number(selector.count) || 1)));
  if (selector.pick === 'all') return clone(candidates);
  if (selector.pick === 'left' || selector.pick === 'first') return clone(candidates.slice(0, requested));
  if (selector.pick === 'right' || selector.pick === 'last') return clone(candidates.slice(-requested));
  // Manual selection is resolved by an interactive host. The portable core
  // deliberately returns no implicit target instead of silently picking left.
  if (selector.pick === 'choose') return [];
  if (selector.pick === 'by_id') return clone(candidates.slice(0, 1));
  if (selector.pick === 'lowest_hp' || selector.pick === 'highest_hp') {
    candidates = candidates.filter(unit => unit.hasHp !== false);
    const direction = selector.pick === 'lowest_hp' ? 1 : -1;
    return clone([...candidates].sort((left, right) => direction * (hpRatio(left) - hpRatio(right)) || left.createdSequence - right.createdSequence).slice(0, requested));
  }
  const pool = [...candidates];
  const chosen: SummonUnit[] = [];
  const amount = selector.pick === 'random' ? 1 : requested;
  while (pool.length > 0 && chosen.length < amount) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('summon random source must return [0,1)');
    chosen.push(...pool.splice(Math.floor(sample * pool.length), 1));
  }
  return clone(chosen);
}

/**
 * Copy concrete runtime summons, including their transformed actions,
 * triggered abilities, statuses and resources. New identities and queue order
 * are allocated here; capacity and overflow use the same rules as spawning.
 */
export function copySummonUnits(
  current: SummonCollectionState,
  targetIds: readonly string[],
  owner: BattleOwner,
  capacity = owner === 'enemy' ? Number.MAX_SAFE_INTEGER : 3,
  overflow: SummonOverflowPolicy = 'replace_oldest',
  createdTurn = 0,
  binding: { summonerId: string | null } | 'preserve' = 'preserve',
): SummonCopyResult {
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, count(current.nextSequence, 1, Number.MAX_SAFE_INTEGER));
  const sourceById = new Map(state.living.map(unit => [unit.instanceId, clone(unit)]));
  const sources = [...new Set(targetIds)].map(id => sourceById.get(id)).filter((unit): unit is SummonUnit => Boolean(unit));
  const copied: SummonUnit[] = [];
  const replaced: SummonUnit[] = [];
  const limit = count(capacity, 1, Number.MAX_SAFE_INTEGER);

  for (const source of sources) {
    const owned = state.living.filter(unit => unit.owner === owner);
    if (owned.length >= limit) {
      if (overflow === 'reject') break;
      const victim = [...owned].sort((left, right) => overflow === 'replace_oldest'
        ? left.createdSequence - right.createdSequence
        : hpRatio(left) - hpRatio(right) || left.createdSequence - right.createdSequence)[0];
      if (!victim) break;
      state.living = state.living.filter(unit => unit.instanceId !== victim.instanceId);
      const defeated = { ...victim, currentHp: 0 };
      state.defeated.push(defeated);
      replaced.push(clone(defeated));
    }

    const sequence = state.nextSequence++;
    const instanceId = `${source.templateId}__summon__${sequence}`;
    const unit: SummonUnit = {
      ...clone(source),
      id: instanceId,
      instanceId,
      owner,
      summonerId: binding === 'preserve'
        ? (source.owner === owner ? storedSummonerId(source) : owner === 'player' ? 'player' : null)
        : binding.summonerId,
      // A copied runtime unit is an independent instance, not a second owner
      // of the source's unique companion slot.
      slot: undefined,
      onExisting: undefined,
      onDefeated: undefined,
      createdTurn: count(createdTurn, 0, Number.MAX_SAFE_INTEGER),
      createdSequence: sequence,
      interceptionsThisTurn: 0,
    };
    state.living.push(unit);
    copied.push(clone(unit));
  }
  return { state, copied, replaced };
}

function moveDefeated(state: SummonCollectionState): SummonCollectionState {
  const defeatedNow = state.living.filter(unit => unit.hasHp !== false && unit.currentHp <= 0).map(unit => ({ ...unit, currentHp: 0 }));
  return {
    ...state,
    living: state.living.filter(isSummonAlive),
    defeated: [
      ...state.defeated,
      ...defeatedNow.filter(unit => unit.retainCorpse !== false),
    ],
  };
}

export function damageSummonUnits(
  current: SummonCollectionState,
  targetIds: readonly string[],
  requestedDamage: number,
  bypassBlock = false,
  preventHpLoss = false,
): SummonDamageResult {
  let state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const hits: SummonDamageResult['hits'] = [];
  const damage = Math.max(0, roundBattleValue(requestedDamage));
  for (const id of [...new Set(targetIds)]) {
    const index = state.living.findIndex(unit => unit.instanceId === id);
    if (index < 0) continue;
    const unit = state.living[index];
    if (unit.hasHp === false) continue;
    const absorbed = bypassBlock
      ? { damage, remainingBlock: unit.block || 0, blockUsed: 0 }
      : absorbDamageWithBlock(damage, unit.block || 0);
    const prevented = preventHpLoss ? absorbed.damage : 0;
    const nextHp = Math.max(0, roundBattleValue(unit.currentHp - (preventHpLoss ? 0 : absorbed.damage)));
    state.living[index] = { ...unit, block: absorbed.remainingBlock, currentHp: nextHp };
    hits.push({ summonId: id, requested: damage, blocked: absorbed.blockUsed, hpLost: roundBattleValue(unit.currentHp - nextHp), ...(prevented > 0 ? { prevented } : {}), defeated: nextHp <= 0 });
  }
  state = moveDefeated(state);
  return { state, hits };
}

export function interceptUnblockedAttack(
  current: SummonCollectionState,
  owner: BattleOwner,
  requestedDamage: number,
  mitigate: (unit: SummonUnit, incoming: number) => number = (_unit, incoming) => incoming,
  /** Exact enemy holder being damaged. Enemy summons never fall back to active aliases. */
  protectedEnemyId?: string,
): SummonInterceptResult {
  let state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  let remainingDamage = Math.max(0, roundBattleValue(requestedDamage));
  const hits: SummonDamageResult['hits'] = [];
  const eligible = state.living
    .filter(unit => unit.owner === owner && unit.hasHp !== false && unit.currentHp > 0)
    .filter(unit => owner !== 'enemy' || (protectedEnemyId !== undefined && unit.summonerId === protectedEnemyId))
    .filter(unit => unit.capabilities?.intercepts !== false)
    .filter(unit => unit.intercept?.maxPerTurn === undefined || unit.interceptionsThisTurn < unit.intercept.maxPerTurn)
    .sort((left, right) => {
      const priority = (right.intercept?.priority || 0) - (left.intercept?.priority || 0);
      if (priority !== 0) return priority;
      const explicitSpeed = left.intercept || right.intercept ? (right.speed || 0) - (left.speed || 0) : 0;
      return explicitSpeed || left.createdSequence - right.createdSequence;
    });
  for (const candidate of eligible) {
    if (remainingDamage <= 0) break;
    const index = state.living.findIndex(unit => unit.instanceId === candidate.instanceId);
    if (index < 0) continue;
    const unit = state.living[index];
    if (unit.hasHp === false) continue;
    const incoming = remainingDamage;
    const mitigated = Math.max(0, roundBattleValue(mitigate(unit, incoming)));
    const absorbed = absorbDamageWithBlock(mitigated, unit.block || 0);
    const hpLost = Math.min(unit.currentHp, absorbed.damage);
    const nextHp = Math.max(0, roundBattleValue(unit.currentHp - hpLost));
    state.living[index] = {
      ...unit,
      block: absorbed.remainingBlock,
      currentHp: nextHp,
      interceptionsThisTurn: unit.interceptionsThisTurn + 1,
    };
    // Reduction belongs to this recipient. Only actual post-mitigation overkill spills over.
    remainingDamage = Math.max(0, roundBattleValue(absorbed.damage - hpLost));
    hits.push({ summonId: unit.instanceId, requested: incoming, modified: mitigated, blocked: absorbed.blockUsed, hpLost, defeated: nextHp <= 0 });
  }
  state = moveDefeated(state);
  return {
    state,
    hits,
    remainingDamage,
    interceptedDamage: roundBattleValue(Math.max(0, requestedDamage) - remainingDamage),
  };
}

export function healSummonUnits(
  current: SummonCollectionState,
  targetIds: readonly string[],
  amount: number,
): { state: SummonCollectionState; changed: Array<{ summonId: string; previousHp: number; nextHp: number }> } {
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const changed: Array<{ summonId: string; previousHp: number; nextHp: number }> = [];
  const healing = Math.max(0, roundBattleValue(amount));
  for (const id of [...new Set(targetIds)]) {
    const index = state.living.findIndex(unit => unit.instanceId === id);
    if (index < 0) continue;
    const unit = state.living[index];
    if (unit.hasHp === false) continue;
    const nextHp = Math.min(unit.maxHp, roundBattleValue(unit.currentHp + healing));
    state.living[index] = { ...unit, currentHp: nextHp };
    changed.push({ summonId: id, previousHp: unit.currentHp, nextHp });
  }
  return { state, changed };
}

export function modifySummonUnits(
  current: SummonCollectionState,
  targetIds: readonly string[],
  stat: 'max_hp' | 'block' | 'actions_per_activation' | 'speed' | 'action_priority',
  operator: '+' | '-' | '*' | '/' | '=',
  value: number,
): SummonCollectionState {
  if (operator === '/' && value === 0) throw new Error('summon modifier cannot divide by zero');
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const targets = new Set(targetIds);
  state.living = state.living.map(unit => {
    if (!targets.has(unit.instanceId)) return unit;
    const currentValue = stat === 'max_hp' ? unit.maxHp
      : stat === 'actions_per_activation' ? unit.actionsPerActivation || 0
        : stat === 'action_priority' ? unit.actionPriority || 0
          : stat === 'speed' ? unit.speed || 0 : unit.block || 0;
    const calculated = applyNumericOperator(currentValue, operator, value);
    if (!Number.isFinite(calculated)) throw new Error('summon modifier produced a non-finite value');
    if (stat === 'max_hp') {
      if (unit.hasHp === false) return unit;
      const maxHp = Math.max(1, roundBattleValue(calculated));
      return { ...unit, maxHp, currentHp: Math.min(unit.currentHp, maxHp) };
    }
    if (stat === 'actions_per_activation') return { ...unit, actionsPerActivation: count(calculated, 0, 20) };
    if (stat === 'action_priority') return { ...unit, actionPriority: Math.trunc(calculated) };
    if (stat === 'speed') return { ...unit, speed: Math.trunc(calculated) };
    return { ...unit, block: Math.max(0, roundBattleValue(calculated)) };
  });
  return state;
}

/**
 * Apply the same four numeric channels used by card-value editing to summon
 * actions and triggered abilities. Entries marked `fixed` are deliberately
 * skipped, so economy effects can remain stable while attacks and exit bursts
 * scale with the summon build.
 */
export function modifySummonEffectPrograms(
  current: SummonCollectionState,
  targetIds: readonly string[],
  stat: CardValueStat,
  operator: CardValueOperator,
  value: number,
): SummonCollectionState {
  if (!Number.isFinite(value)) throw new Error('summon effect modifier must be finite');
  if (operator === 'divide' && value === 0) throw new Error('summon effect modifier cannot divide by zero');
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const targets = new Set(targetIds);
  const transform = { stat, operator, value };
  state.living = state.living.map(unit => {
    if (!targets.has(unit.instanceId)) return unit;
    return {
      ...unit,
      ...(unit.actionProgram ? { actionProgram: transformCardEffectProgram(unit.actionProgram, transform) } : {}),
      ...(unit.actions ? {
        actions: unit.actions.map(action => action.fixed === true
          ? action
          : { ...action, effectProgram: transformCardEffectProgram(action.effectProgram, transform) }),
      } : {}),
      ...(unit.abilities ? {
        abilities: unit.abilities.map(ability => ability.fixed === true
          ? ability
          : { ...ability, effectProgram: transformCardEffectProgram(ability.effectProgram, transform) }),
      } : {}),
    };
  });
  return state;
}

export function applySummonStatus(
  current: SummonCollectionState,
  targetIds: readonly string[],
  definition: Omit<SummonStatusState, 'stacks'>,
  stacks: number,
): SummonCollectionState {
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const targets = new Set(targetIds);
  state.living = state.living.map(unit => {
    if (!targets.has(unit.instanceId) || unit.capabilities?.acceptsStatus === false) return unit;
    const statuses = [...(unit.statusEffects || [])];
    const index = statuses.findIndex(status => status.id === definition.id);
    const amount = count(stacks, 0, 9999);
    if (index < 0 && amount > 0) statuses.push({ ...clone(definition), stacks: amount });
    else if (index >= 0) statuses[index] = { ...statuses[index], ...clone(definition), stacks: statuses[index].stacks + amount };
    return { ...unit, statusEffects: statuses };
  });
  return state;
}

export function removeSummonStatus(
  current: SummonCollectionState,
  targetIds: readonly string[],
  statusId: string,
): SummonCollectionState {
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const targets = new Set(targetIds);
  state.living = state.living.map(unit => targets.has(unit.instanceId)
    ? { ...unit, statusEffects: (unit.statusEffects || []).filter(status => statusId === 'all' ? false : status.id !== statusId) }
    : unit);
  return state;
}

/**
 * Portable lifecycle for statuses held by summons.
 *
 * Every entry point accepts concrete summon instance ids. It deliberately does
 * not resolve owner-wide selectors: a status trigger's ordinary `self` must be
 * rebound by the host to `context.summonContext`, never expanded to all allied
 * summons. Apply/stack stay inside the caller's transaction; tick/remove use
 * recover-and-continue nested snapshots, matching combatant status semantics.
 */
export class SummonStatusLifecycleRuntime<TToken> {
  public constructor(private readonly ports: SummonStatusLifecycleRuntimePorts<TToken>) {}

  public async apply(
    targetIds: readonly string[],
    statusId: string,
    stacks: number,
  ): Promise<Array<{ summon: SummonUnit; status: SummonStatusState }>> {
    const applied: Array<{ summon: SummonUnit; status: SummonStatusState }> = [];
    for (const summonId of [...new Set(targetIds)]) {
      const summon = this.getLiving(summonId);
      if (!summon || summon.capabilities?.acceptsStatus === false) continue;
      const definition = this.ports.definitions.get(statusId);
      if (!definition) {
        this.present({ type: 'missing_definition', summonId, statusId });
        continue;
      }
      const defender = definition.type === 'debuff'
        ? summon.statusEffects?.find(status => this.ports.definitions.get(status.id)?.defense?.negate_debuff)
        : undefined;
      if (defender) {
        if (defender.stacks <= 1) await this.removeOne(summon, defender, 'explicit');
        else this.updateLiving(summonId, unit => ({ ...unit, statusEffects: (unit.statusEffects || []).map(status => status.id === defender.id ? { ...status, stacks: status.stacks - 1 } : status) }), 'summon_status_defense_consumed');
        continue;
      }
      const existing = summon.statusEffects?.find(status => status.id === statusId);
      const application = resolveStatusApplication(existing?.stacks, stacks, definition.maxStacks);
      if (!application.trigger) continue;
      const next: SummonStatusState = existing
        ? { ...existing, stacks: application.nextStacks }
        : this.createStatus(definition, application.nextStacks);
      this.updateLiving(summonId, unit => ({
        ...unit,
        statusEffects: existing
          ? (unit.statusEffects || []).map(status => status.id === statusId ? clone(next) : status)
          : [...(unit.statusEffects || []), clone(next)],
      }), 'summon_status_applied');
      const activeSummon = this.getLiving(summonId);
      const activeStatus = activeSummon?.statusEffects?.find(status => status.id === statusId);
      if (!activeSummon || !activeStatus) continue;
      const appliedEvent = {
        type: 'status_applied', summon: clone(activeSummon), status: clone(activeStatus),
        trigger: application.trigger,
      } as const;
      const recordedApplication = this.ports.record?.(appliedEvent);
      this.present(appliedEvent);
      const effects = this.ports.definitions.getTriggerEffects(statusId, application.trigger);
      if (effects.length > 0) this.present({
        type: 'trigger_started', summon: clone(activeSummon), status: clone(activeStatus),
        trigger: application.trigger,
      });
      for (const effect of effects) {
        await this.execute(effect, activeSummon, activeStatus, application.trigger, { ...recordedApplication });
      }
      if (effects.length > 0) {
        const completed = {
        type: 'trigger_completed', summon: clone(activeSummon), status: clone(activeStatus),
        trigger: application.trigger,
        } as const;
        this.ports.record?.(completed);
        this.present(completed);
      }
      await this.dispatchOwnership(activeSummon, activeStatus.type, 'gain', recordedApplication);
      applied.push({ summon: clone(activeSummon), status: clone(activeStatus) });
    }
    return applied;
  }

  public async remove(
    targetIds: readonly string[],
    selection: string,
  ): Promise<Array<{ summon: SummonUnit; status: SummonStatusState }>> {
    const removed: Array<{ summon: SummonUnit; status: SummonStatusState }> = [];
    for (const summonId of [...new Set(targetIds)]) {
      const summon = this.getLiving(summonId);
      if (!summon) continue;
      const selected = (summon.statusEffects || []).filter(status => this.matchesSelection(status, selection));
      for (const status of selected) {
        const current = this.getLiving(summonId)?.statusEffects?.find(candidate => candidate.id === status.id);
        if (!current) continue;
        const holder = this.getLiving(summonId);
        if (!holder) continue;
        await this.removeOne(holder, current, 'explicit');
        removed.push({ summon: clone(holder), status: clone(current) });
      }
    }
    return removed;
  }

  /** Consume precisely one layer from one exact summon holder. */
  public async consumeLayer(summonId: string, statusId: string): Promise<boolean> {
    const summon = this.getLiving(summonId);
    const status = summon?.statusEffects?.find(candidate => candidate.id === statusId);
    if (!summon || !status) return false;
    if (status.stacks <= 1) await this.removeOne(summon, status, 'explicit');
    else this.updateLiving(summonId, unit => ({
      ...unit,
      statusEffects: (unit.statusEffects || []).map(candidate =>
        candidate.id === statusId ? { ...candidate, stacks: candidate.stacks - 1 } : candidate),
    }), 'summon_status_defense_consumed');
    return true;
  }

  /** Resolve tick effects for one exact summon at its declared action boundary. */
  public async processActionTiming(summonId: string, timing: StatusTickTiming): Promise<void> {
    const summon = this.getLiving(summonId);
    if (!summon) return;
    for (const snapshot of [...(summon.statusEffects || [])]) {
      const holder = this.getLiving(summonId);
      const status = holder?.statusEffects?.find(candidate => candidate.id === snapshot.id);
      if (!holder || !status || (this.ports.definitions.get(status.id)?.tick_timing ?? 'before_action') !== timing) continue;
      await this.executeIsolatedTrigger(
        holder,
        clone(status),
        'tick',
        this.ports.definitions.getTriggerEffects(status.id, 'tick'),
      );
    }
  }

  /** Stack decay is independent of tick timing and occurs once at each owner's turn end. */
  public async processTurnEnd(owner: BattleOwner): Promise<void> {
    const holderIds = this.ports.state.readSummons().living
      .filter(unit => unit.owner === owner && isSummonAlive(unit))
      .sort((left, right) => left.createdSequence - right.createdSequence)
      .map(unit => unit.instanceId);
    for (const summonId of holderIds) await this.applyStacksDecay(summonId);
  }

  /** Resolve a concrete battle event for statuses present before that event began. */
  public async processEvent(
    summon: SummonUnit,
    trigger: StatusEventTrigger,
    context: Readonly<Record<string, unknown>> = {},
    activeStatusIds?: readonly string[],
  ): Promise<void> {
    const current = this.getLiving(summon.instanceId) || (trigger === 'defeated' ? summon : null);
    if (!current) return;
    const snapshot = activeStatusIds
      ? [...new Set(activeStatusIds)]
      : (current.statusEffects || []).map(status => status.id);
    for (const statusId of snapshot) {
      const holder = this.getLiving(summon.instanceId) || (trigger === 'defeated' ? current : null);
      const status = holder?.statusEffects?.find(candidate => candidate.id === statusId);
      if (!holder || !status) continue;
      await this.executeIsolatedTrigger(
        holder,
        clone(status),
        trigger,
        this.ports.definitions.getTriggerEffects(statusId, trigger),
        context,
      );
    }
  }

  private async applyStacksDecay(summonId: string): Promise<void> {
    const holder = this.getLiving(summonId);
    if (!holder) return;
    const changed: SummonStatusState[] = [];
    const removed: SummonStatusState[] = [];
    for (const status of holder.statusEffects || []) {
      const change = this.ports.definitions.get(status.id)?.stacks_change;
      const nextStacks = change === undefined ? status.stacks : resolveStatusStacksChange(status.stacks, change);
      if (nextStacks > 0) changed.push({ ...status, stacks: nextStacks });
      else removed.push(clone(status));
    }
    this.updateLiving(summonId, unit => ({ ...unit, statusEffects: changed }), 'summon_status_decay');
    for (const status of removed) {
      const summon = this.getLiving(summonId);
      if (!summon) break;
      const removedEvent = { type: 'status_removed', summon: clone(summon), status: clone(status), reason: 'decay' } as const;
      const recordedRemoval = this.ports.record?.(removedEvent);
      this.present(removedEvent);
      await this.executeIsolatedTrigger(
        summon,
        status,
        'remove',
        this.ports.definitions.getTriggerEffects(status.id, 'remove'),
        { ...recordedRemoval },
      );
      await this.dispatchOwnership(summon, status.type, 'lose', recordedRemoval);
    }
  }

  private async removeOne(
    summon: SummonUnit,
    status: SummonStatusState,
    reason: 'explicit' | 'decay',
  ): Promise<void> {
    this.updateLiving(summon.instanceId, unit => ({
      ...unit,
      statusEffects: (unit.statusEffects || []).filter(candidate => candidate.id !== status.id),
    }), 'summon_status_removed');
    const currentHolder = this.getLiving(summon.instanceId) || summon;
    const removedEvent = {
      type: 'status_removed', summon: clone(currentHolder), status: clone(status), reason,
    } as const;
    const recordedRemoval = this.ports.record?.(removedEvent);
    this.present(removedEvent);
    await this.executeIsolatedTrigger(
      currentHolder,
      status,
      'remove',
      this.ports.definitions.getTriggerEffects(status.id, 'remove'),
      { ...recordedRemoval },
    );
    await this.dispatchOwnership(currentHolder, status.type, 'lose', recordedRemoval);
  }

  private async executeIsolatedTrigger(
    summon: SummonUnit,
    status: SummonStatusState,
    trigger: SummonStatusExecutableTrigger,
    effects: readonly StatusRuntimeEffect[],
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    if (effects.length === 0) return;
    this.present({ type: 'trigger_started', summon: clone(summon), status: clone(status), trigger });
    const result = await runTriggerTransaction(
      `summon_status_${trigger}_${summon.instanceId}_${status.id}`,
      this.ports.transactions,
      async () => {
        for (const effect of effects) await this.execute(effect, summon, status, trigger, context);
      },
      'recover-and-continue',
    );
    if (result.status === 'rolled_back') this.present({
      type: 'trigger_failed', summon: clone(summon), status: clone(status), trigger, cause: result.cause,
    });
    else {
      const completed = {
        type: 'trigger_completed', summon: clone(summon), status: clone(status), trigger,
      } as const;
      this.ports.record?.(completed);
      this.present(completed);
    }
  }

  private async dispatchOwnership(
    summon: SummonUnit,
    statusType: string,
    change: 'gain' | 'lose',
    eventContext?: BattleTriggerEventContext,
  ): Promise<void> {
    if (!this.ports.dispatch) return;
    await this.ports.dispatch(resolveStatusOwnershipTriggerDispatch({
      target: summon.owner,
      targetId: summon.instanceId,
      statusType,
      change,
      ...(eventContext ? { eventContext } : {}),
    }));
  }

  private async execute(
    effect: StatusRuntimeEffect,
    summon: SummonUnit,
    status: SummonStatusState,
    trigger: SummonStatusExecutableTrigger,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.ports.execute(effect, summon.owner, {
      ...context,
      triggerType: trigger,
      statusContext: clone(status),
      summonContext: clone(summon),
      summonStatusContext: { summonId: summon.instanceId },
    });
  }

  private createStatus(definition: RuntimeStatusDefinition, stacks: number): SummonStatusState {
    return {
      id: definition.id,
      name: definition.name,
      emoji: definition.emoji,
      description: definition.description,
      type: definition.type,
      stacks,
    };
  }

  private matchesSelection(status: SummonStatusState, selection: string): boolean {
    if (selection === 'all' || selection === 'all_buffs') return true;
    const type = this.ports.definitions.get(status.id)?.type || status.type;
    if (selection === 'buffs') return type === 'buff';
    if (selection === 'debuffs') return type === 'debuff';
    return status.id === selection;
  }

  private getLiving(summonId: string): SummonUnit | null {
    const summon = this.ports.state.getSummonById(summonId);
    if (!summon || !isSummonAlive(summon)) return null;
    return this.ports.state.readSummons().living.some(unit => unit.instanceId === summonId) ? summon : null;
  }

  private updateLiving(
    summonId: string,
    update: (summon: SummonUnit) => SummonUnit,
    event: string,
  ): void {
    const state = this.ports.state.readSummons();
    if (!state.living.some(unit => unit.instanceId === summonId)) return;
    this.ports.state.writeSummons({
      ...state,
      living: state.living.map(unit => unit.instanceId === summonId ? update(unit) : unit),
    }, event);
  }

  private present(event: SummonStatusLifecycleEvent): void {
    this.ports.present?.(event);
  }
}

export function updateSummonResources(
  current: SummonCollectionState,
  targetIds: readonly string[],
  resourceId: string,
  value: number,
  mode: 'gain' | 'set',
): { state: SummonCollectionState; changed: Array<{ summonId: string; previousValue: number; nextValue: number }> } {
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const targets = new Set(targetIds);
  const changed: Array<{ summonId: string; previousValue: number; nextValue: number }> = [];
  state.living = state.living.map(unit => {
    if (!targets.has(unit.instanceId)) return unit;
    const definition = unit.resources?.[resourceId];
    if (!definition) return unit;
    const previousValue = definition.current;
    const nextValue = Math.max(0, Math.min(definition.max, Math.floor(mode === 'gain' ? previousValue + value : value)));
    changed.push({ summonId: unit.instanceId, previousValue, nextValue });
    return { ...unit, resources: { ...(unit.resources || {}), [resourceId]: { ...definition, current: nextValue } } };
  });
  return { state, changed };
}

export function dismissSummonUnits(
  current: SummonCollectionState,
  targetIds: readonly string[],
  retainCorpse = false,
): { state: SummonCollectionState; dismissed: SummonUnit[] } {
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const targets = new Set(targetIds);
  const dismissed = state.living.filter(unit => targets.has(unit.instanceId)).map(unit => ({ ...unit, currentHp: 0 }));
  state.living = state.living.filter(unit => !targets.has(unit.instanceId));
  if (retainCorpse) state.defeated.push(...dismissed);
  return { state, dismissed: clone(dismissed) };
}

export function resetSummonTurnState(current: SummonCollectionState, owner: BattleOwner): SummonCollectionState {
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  state.living = state.living.map(unit => unit.owner === owner ? { ...unit, interceptionsThisTurn: 0 } : unit);
  return state;
}

export function buildSummonActionQueue(
  state: SummonCollectionState,
  owner: BattleOwner,
): SummonActionQueueEntry[] {
  return state.living
    .filter(unit => unit.owner === owner && isSummonAlive(unit) &&
      (unit.actionProgram || unit.actions?.some(action => action.effectProgram?.steps?.length)) &&
      (unit.actionsPerActivation || 0) > 0)
    .filter(unit => unit.capabilities?.acts !== false)
    .flatMap(unit => Array.from({ length: count(unit.actionsPerActivation || 0, 0, 20) }, (_, actionIndex) => ({
      summonId: unit.instanceId,
      owner,
      actionIndex,
      priority: Math.trunc(unit.actionPriority || 0),
      speed: Math.trunc(unit.speed || 0),
      createdSequence: unit.createdSequence,
    })))
    // Autonomous turns use summon arrival order. Explicit command resolution
    // retains its own priority/speed policy at the caller boundary.
    .sort((left, right) => left.createdSequence - right.createdSequence || left.actionIndex - right.actionIndex);
}

/** Select the action identities for an upcoming activation and persist them on the units. */
export function planSummonActions(
  current: SummonCollectionState,
  targetIds: readonly string[],
  random: () => number,
  replace = true,
): SummonCollectionState {
  const state = createSummonCollectionState(current.living, current.defeated);
  state.nextSequence = Math.max(state.nextSequence, current.nextSequence || 1);
  const targets = new Set(targetIds);
  state.living = state.living.map(unit => {
    if (!targets.has(unit.instanceId) || unit.capabilities?.acts === false) return unit;
    const count = Math.max(0, Math.trunc(unit.actionsPerActivation ?? 1));
    const availableIds = new Set((unit.actions || []).map(action => action.id));
    const planned: string[] = replace ? [] : (unit.plannedActionIds || []).filter(id =>
      id === `${unit.templateId}_action` || availableIds.has(id),
    ).slice(0, count);
    for (let index = planned.length; index < count; index += 1) {
      const action = resolveSummonAction(unit, random);
      if (!action) break;
      planned.push(action.id);
    }
    return { ...unit, plannedActionIds: planned };
  });
  return state;
}

/** Resolve a previously selected action without drawing RNG. */
export function resolvePlannedSummonAction(unit: SummonUnit, actionIndex: number): ResolvedSummonAction | null {
  // A legacy save with exactly one legal action has an implicit plan and does
  // not need a random draw during migration/display.
  const soleAction = (unit.actions || []).filter(action => action.effectProgram?.steps?.length).length === 1
    ? unit.actions!.find(action => action.effectProgram?.steps?.length)! : undefined;
  const plannedId = unit.plannedActionIds?.[actionIndex]
    || (soleAction
      ? soleAction.id || '__implicit_single_action__'
      : unit.actionProgram?.steps?.length ? `${unit.templateId}_action` : undefined);
  if (!plannedId) return null;
  const selected = plannedId === '__implicit_single_action__' ? soleAction : (unit.actions || []).find(action => action.id === plannedId);
  if (selected?.effectProgram?.steps?.length) return {
    id: selected.id || `${unit.templateId || 'summon'}_action`,
    name: selected.name,
    emoji: selected.emoji || unit.emoji,
    ...(selected.description ? { description: selected.description } : {}),
      ...(selected.dialogue ? { dialogue: selected.dialogue } : {}),
    ...(selected.fixed === true ? { fixed: true } : {}),
    effectProgram: clone(selected.effectProgram),
  };
  if (plannedId === `${unit.templateId}_action` && unit.actionProgram?.steps?.length) return {
    id: plannedId, name: unit.name, emoji: unit.emoji,
    ...(unit.description ? { description: unit.description } : {}), effectProgram: clone(unit.actionProgram),
  };
  return null;
}

/** Select one autonomous behaviour without coupling summon design to a fixed content preset. */
export function resolveSummonAction(
  unit: SummonUnit,
  random: () => number = Math.random,
): ResolvedSummonAction | null {
  const actions = (unit.actions || []).filter(action => action.effectProgram?.steps?.length);
  if (actions.length > 0) {
    const weights = actions.map(action => Number.isFinite(action.weight) && Number(action.weight) > 0 ? Number(action.weight) : 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
      throw new Error('summon action random source must return [0,1)');
    let cursor = sample * total;
    const selected = actions.find((_, index) => {
      cursor -= weights[index];
      return cursor < 0;
    }) || actions.at(-1)!;
    return {
      id: selected.id,
      name: selected.name,
      emoji: selected.emoji || unit.emoji,
      ...(selected.description ? { description: selected.description } : {}),
      ...(selected.dialogue ? { dialogue: selected.dialogue } : {}),
      ...(selected.fixed === true ? { fixed: true } : {}),
      effectProgram: clone(selected.effectProgram),
    };
  }
  if (!unit.actionProgram?.steps?.length) return null;
  return {
    id: `${unit.templateId}_action`,
    name: unit.name,
    emoji: unit.emoji,
    ...(unit.description ? { description: unit.description } : {}),
    effectProgram: clone(unit.actionProgram),
  };
}


