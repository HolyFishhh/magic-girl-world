import {
  completeRunNode,
  createRunState,
  enterRunNode,
  settleEventOutcome,
  spendRunGold,
  validateRunState,
  parseRunResultInput,
  type RunNodeKind,
  type RunNodeOutcome,
  type RunState,
  type BattleEndResult,
} from '../game-core';
import { flattenMvuArray } from './mvuArrays';

export type BattleRunResult = BattleEndResult;

export interface RunMutationResult {
  previous: RunState;
  run: RunState;
}

export interface PendingRunResult {
  node_id: string;
  outcome: 'cleared' | 'failed' | 'escaped';
  gold?: number;
  hp?: number;
}

function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function deriveRunSeed(statValue: unknown): number {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const status = stat.status && typeof stat.status === 'object' ? stat.status : {};
  const profession = status.profession && typeof status.profession === 'object' ? status.profession : {};
  const cards = flattenMvuArray<Record<string, any>>(stat.battle?.cards, { objectsOnly: true });
  const signature = JSON.stringify([
    status.time || '',
    status.location || '',
    profession.name || '',
    cards
      .filter(card => card && typeof card === 'object')
      .map(card => [card.id || '', card.name || '', card.quantity || 1]),
  ]);
  return stableHash(signature);
}

const BATTLE_GOLD: Record<RunNodeKind, number> = {
  battle: 20,
  elite: 40,
  boss: 75,
  event: 0,
  rest: 0,
  shop: 0,
};

function requireRecord(value: unknown, message: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, any>;
}

export function readRunState(statValue: unknown): RunState | null {
  if (!statValue || typeof statValue !== 'object' || Array.isArray(statValue)) return null;
  const parsed = validateRunState((statValue as Record<string, unknown>).run);
  return parsed.ok ? parsed.value : null;
}

/** Persist schema migrations and initialize program-owned transaction fields for old chats. */
export function migrateRunProgramStateInStat(statValue: unknown): RunState | null {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const run = readRunState(stat);
  if (run && stat.run?.schemaVersion !== run.schemaVersion) stat.run = run;
  if (stat.run_upgrade_target === undefined) stat.run_upgrade_target = null;
  if (stat.run_transform === undefined) stat.run_transform = null;
  if (stat.run_transform_target === undefined) stat.run_transform_target = null;
  if (stat.run_reward_reroll === undefined) stat.run_reward_reroll = null;
  if (!Array.isArray(stat.run_rules)) stat.run_rules = [];
  if (!Array.isArray(stat.run_trigger_invocations)) stat.run_trigger_invocations = [];
  if (!stat.run_trigger_counters || typeof stat.run_trigger_counters !== 'object' || Array.isArray(stat.run_trigger_counters)) {
    stat.run_trigger_counters = { total: 0, by_trigger: {}, by_source_kind: {}, by_source: {} };
  } else {
    if (!Number.isInteger(stat.run_trigger_counters.total) || stat.run_trigger_counters.total < 0) {
      stat.run_trigger_counters.total = 0;
    }
    if (
      !stat.run_trigger_counters.by_trigger ||
      typeof stat.run_trigger_counters.by_trigger !== 'object' ||
      Array.isArray(stat.run_trigger_counters.by_trigger)
    ) {
      stat.run_trigger_counters.by_trigger = {};
    }
    if (
      !stat.run_trigger_counters.by_source_kind ||
      typeof stat.run_trigger_counters.by_source_kind !== 'object' ||
      Array.isArray(stat.run_trigger_counters.by_source_kind)
    ) {
      stat.run_trigger_counters.by_source_kind = {};
    }
    if (
      !stat.run_trigger_counters.by_source ||
      typeof stat.run_trigger_counters.by_source !== 'object' ||
      Array.isArray(stat.run_trigger_counters.by_source)
    ) {
      stat.run_trigger_counters.by_source = {};
    }
  }
  if (!Number.isInteger(stat.run_transaction_revision) || stat.run_transaction_revision < 0) {
    stat.run_transaction_revision = 0;
  }
  if (!Array.isArray(stat.run_transaction_log)) stat.run_transaction_log = [];
  if (!Array.isArray(stat.run_transaction_events)) stat.run_transaction_events = [];
  if (!stat.run_transaction_counters || typeof stat.run_transaction_counters !== 'object' || Array.isArray(stat.run_transaction_counters)) {
    stat.run_transaction_counters = { total: 0, by_event: {}, by_source: {} };
  } else {
    if (!Number.isInteger(stat.run_transaction_counters.total) || stat.run_transaction_counters.total < 0) {
      stat.run_transaction_counters.total = 0;
    }
    if (
      !stat.run_transaction_counters.by_event ||
      typeof stat.run_transaction_counters.by_event !== 'object' ||
      Array.isArray(stat.run_transaction_counters.by_event)
    ) {
      stat.run_transaction_counters.by_event = {};
    }
    if (
      !stat.run_transaction_counters.by_source ||
      typeof stat.run_transaction_counters.by_source !== 'object' ||
      Array.isArray(stat.run_transaction_counters.by_source)
    ) {
      stat.run_transaction_counters.by_source = {};
    }
  }
  const reward = stat.reward && typeof stat.reward === 'object' && !Array.isArray(stat.reward) ? stat.reward : null;
  if (reward) {
    if (!Array.isArray(reward.disabled_categories)) reward.disabled_categories = [];
    if (!Number.isInteger(reward.pool_revision) || reward.pool_revision < 0) reward.pool_revision = 0;
    if (!Number.isInteger(reward.reroll_count) || reward.reroll_count < 0) reward.reroll_count = 0;
  }
  return run;
}

/** Initialize an absent/corrupt run in an adapter-owned transaction. */
export function ensureRunStateInStat(statValue: unknown, seed: number): RunMutationResult {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  migrateRunProgramStateInStat(stat);
  const previous = readRunState(stat);
  if (previous) return { previous, run: previous };
  const run = createRunState({ seed });
  stat.run = run;
  stat.run_upgrade = null;
  stat.run_transform = null;
  stat.run_transform_target = null;
  stat.run_trigger_invocations = [];
  stat.run_trigger_counters = { total: 0, by_trigger: {}, by_source_kind: {}, by_source: {} };
  return { previous: run, run };
}

export function enterRunNodeInStat(statValue: unknown, choiceId: string): RunMutationResult {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const previous = readRunState(stat);
  if (!previous) throw new Error('run state is unavailable');
  const run = enterRunNode(previous, choiceId);
  stat.run = run;
  stat.run_upgrade = null;
  stat.run_transform = null;
  stat.run_transform_target = null;
  return { previous, run };
}

export function completeRunNodeInStat(
  statValue: unknown,
  outcome: RunNodeOutcome,
  goldDelta = 0,
): RunMutationResult {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const previous = readRunState(stat);
  if (!previous) throw new Error('run state is unavailable');
  const run = completeRunNode(previous, { outcome, goldDelta });
  stat.run = run;
  stat.run_upgrade = null;
  stat.run_transform = null;
  stat.run_transform_target = null;
  return { previous, run };
}

export function spendRunGoldInStat(statValue: unknown, amount: number): RunMutationResult {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const previous = readRunState(stat);
  if (!previous) throw new Error('run state is unavailable');
  const run = spendRunGold(previous, amount);
  stat.run = run;
  return { previous, run };
}

export function restartRunInStat(statValue: unknown): RunState {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const previous = readRunState(stat);
  const seed = previous ? (previous.seed + 0x9e3779b9) >>> 0 : deriveRunSeed(stat);
  const run = createRunState({ seed });
  stat.run = run;
  stat.run_upgrade = null;
  stat.run_upgrade_target = null;
  stat.run_transform = null;
  stat.run_transform_target = null;
  stat.run_reward_reroll = null;
  stat.run_trigger_invocations = [];
  stat.run_trigger_counters = { total: 0, by_trigger: {}, by_source_kind: {}, by_source: {} };
  stat.run_transaction_revision = 0;
  stat.run_transaction_log = [];
  stat.run_transaction_events = [];
  stat.run_transaction_counters = { total: 0, by_event: {}, by_source: {} };
  const core = stat.battle?.core;
  if (core && typeof core === 'object') {
    const maxHp = Number(core.max_hp);
    if (Number.isFinite(maxHp) && maxHp > 0) core.hp = maxHp;
    if (Number.isFinite(Number(core.max_lust))) core.lust = 0;
  }
  const reward = stat.reward && typeof stat.reward === 'object' ? stat.reward : null;
  if (reward) {
    reward.card = [];
    reward.artifact = [];
    reward.item = [];
    reward.limits = {};
    reward.disabled_categories = [];
    reward.pool_revision = 0;
    reward.reroll_count = 0;
  }
  return run;
}

export function consumePendingRunResultInStat(statValue: unknown): RunMutationResult | null {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  if (stat.run_result == null) return null;
  const pending = parseRunResultInput(stat.run_result);
  const previous = readRunState(stat);
  if (!previous || previous.phase !== 'in_node' || !previous.currentNode) {
    throw new Error('当前没有可结算的路线节点');
  }
  let core: Record<string, any> | null = null;
  let player: { hp: number; maxHp: number } | null = null;
  if (pending.hpDelta !== undefined && pending.hpDelta !== 0) {
    const battle = requireRecord(stat.battle, '事件生命结算失败：battle 数据不存在');
    core = requireRecord(battle.core, '事件生命结算失败：battle.core 数据不存在');
    player = { hp: core.hp, maxHp: core.max_hp };
  }
  const settlement = settleEventOutcome(
    previous,
    pending,
    player,
  );
  if (core && settlement.hp !== null) core.hp = settlement.hp;
  stat.run = settlement.run;
  stat.run_result = null;
  stat.run_upgrade = null;
  stat.run_transform = null;
  stat.run_transform_target = null;
  return { previous, run: settlement.run };
}

/** Settle a route node only when a real battle owns the current run node. */
export function settleBattleRunInStat(
  statValue: unknown,
  result: BattleRunResult,
  expectedNodeId?: string,
): RunMutationResult | null {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const previous = readRunState(stat);
  if (!previous || previous.phase !== 'in_node' || !previous.currentNode) return null;
  if (expectedNodeId && previous.currentNode.id !== expectedNodeId) throw new Error('战斗结果所属路线节点已过期');
  if (previous.currentNode.kind === 'rest' || previous.currentNode.kind === 'shop') return null;
  const outcome: RunNodeOutcome = result === 'victory' ? 'cleared' : result === 'defeat' ? 'failed' : 'escaped';
  const goldDelta = result === 'victory' ? BATTLE_GOLD[previous.currentNode.kind] : 0;
  const run = completeRunNode(previous, { outcome, goldDelta });
  stat.run = run;
  stat.run_upgrade = null;
  stat.run_transform = null;
  stat.run_transform_target = null;
  return { previous, run };
}
