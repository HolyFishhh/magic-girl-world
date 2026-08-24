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

/** Initialize an absent/corrupt run in an adapter-owned transaction. */
export function ensureRunStateInStat(statValue: unknown, seed: number): RunMutationResult {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const previous = readRunState(stat);
  if (previous) return { previous, run: previous };
  const run = createRunState({ seed });
  stat.run = run;
  stat.run_upgrade = null;
  return { previous: run, run };
}

export function enterRunNodeInStat(statValue: unknown, choiceId: string): RunMutationResult {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  const previous = readRunState(stat);
  if (!previous) throw new Error('run state is unavailable');
  const run = enterRunNode(previous, choiceId);
  stat.run = run;
  stat.run_upgrade = null;
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
  return { previous, run };
}
