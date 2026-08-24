import { completeRunNode, requireActiveRunNode, type RunNodeOutcome, type RunState } from './runState';

export interface EventOutcomeInput {
  nodeId: string;
  outcome: RunNodeOutcome;
  goldDelta?: number;
  hpDelta?: number;
}

function validateEventOutcomeInput(value: unknown): EventOutcomeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('节点结果必须是对象');
  }
  const input = value as Record<string, unknown>;
  if (typeof input.nodeId !== 'string' || input.nodeId.trim().length === 0) {
    throw new Error('节点结果 node_id 无效');
  }
  if (!['cleared', 'failed', 'escaped'].includes(String(input.outcome))) {
    throw new Error('节点结果 outcome 无效');
  }
  const readDelta = (value: unknown, field: 'gold' | 'hp'): number | undefined => {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || Number(value) < -999 || Number(value) > 999) {
      throw new Error(`节点结果 ${field} 无效`);
    }
    return Number(value);
  };
  return {
    nodeId: input.nodeId.trim(),
    outcome: input.outcome as RunNodeOutcome,
    goldDelta: readDelta(input.goldDelta, 'gold'),
    hpDelta: readDelta(input.hpDelta, 'hp'),
  };
}

/**
 * Parse the short snake_case command written by an AI into the portable core
 * input. This is the single shape/range gate for Tavern, web, and Mod hosts.
 */
export function parseRunResultInput(value: unknown): EventOutcomeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('节点结果必须是对象');
  }
  const input = value as Record<string, unknown>;
  const unknownField = Object.keys(input).find(key => !['node_id', 'outcome', 'gold', 'hp'].includes(key));
  if (unknownField) throw new Error(`节点结果字段不允许: ${unknownField}`);
  if (typeof input.node_id !== 'string' || input.node_id.trim().length === 0) {
    throw new Error('节点结果 node_id 无效');
  }
  if (!['cleared', 'failed', 'escaped'].includes(String(input.outcome))) {
    throw new Error('节点结果 outcome 无效');
  }
  return validateEventOutcomeInput({
    nodeId: input.node_id,
    outcome: input.outcome,
    goldDelta: input.gold,
    hpDelta: input.hp,
  });
}

export interface EventPlayerVitals {
  hp: number;
  maxHp: number;
}

export interface EventOutcomeSettlement {
  run: RunState;
  hp: number | null;
}

/** Settle host-neutral event costs and route progress without mutating the input. */
export function settleEventOutcome(
  run: RunState,
  pending: EventOutcomeInput,
  player: EventPlayerVitals | null = null,
): EventOutcomeSettlement {
  const normalized = validateEventOutcomeInput(pending);
  let currentNode: ReturnType<typeof requireActiveRunNode>;
  try {
    currentNode = requireActiveRunNode(run, 'event');
  } catch {
    if (run.phase !== 'in_node' || !run.currentNode) throw new Error('当前没有可结算的路线节点');
    throw new Error('AI 只能提交事件节点结果');
  }
  if (normalized.nodeId !== currentNode.id) throw new Error('节点结果已过期');

  const goldDelta = normalized.goldDelta ?? 0;
  const hpDelta = normalized.hpDelta ?? 0;

  let hp: number | null = null;
  if (hpDelta !== 0) {
    if (
      !player ||
      typeof player.hp !== 'number' ||
      !Number.isFinite(player.hp) ||
      typeof player.maxHp !== 'number' ||
      !Number.isFinite(player.maxHp) ||
      player.maxHp <= 0 ||
      player.hp < 0 ||
      player.hp > player.maxHp
    ) {
      throw new Error('事件生命结算失败：生命值数据无效');
    }
    if (normalized.outcome !== 'failed' && player.hp + hpDelta < 1) {
      throw new Error('非失败事件不能使生命降到 0');
    }
    hp = Math.min(player.maxHp, Math.max(normalized.outcome === 'failed' ? 0 : 1, player.hp + hpDelta));
  }

  return {
    run: completeRunNode(run, { outcome: normalized.outcome, goldDelta }),
    hp,
  };
}
