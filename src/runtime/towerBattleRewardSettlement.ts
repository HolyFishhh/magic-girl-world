import { isBattleRunNode, type BattleEndResult, type RunState } from '../game-core';
import { readGameMode } from '../game-core/towerMode';
import { readRunState } from './runStateAdapter';
import {
  normalizeTowerReward,
  TOWER_ACTIVE_NODE_SCHEMA_VERSION,
  TOWER_STAGED_REWARD_SCHEMA_VERSION,
  type TowerActiveNodeState,
  type TowerStagedRewardState,
} from './towerContentActivation';

export interface TowerBattleRewardSettlementResult {
  previous: RunState | null;
  run: RunState | null;
  changed: boolean;
  promoted: boolean;
  nodeId: string | null;
}

type JsonRecord = Record<string, any>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function replaceRecord(target: JsonRecord, source: JsonRecord): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function emptyReward(): JsonRecord {
  return {
    card: [],
    artifact: [],
    item: [],
    limits: {},
    request: null,
    disabled_categories: [],
    pool_revision: 0,
    reroll_count: 0,
  };
}

function readActiveNode(value: unknown): TowerActiveNodeState | null {
  if (value === null || value === undefined) return null;
  const node = requireRecord(value, 'tower active node state is invalid');
  if (
    node.schemaVersion !== TOWER_ACTIVE_NODE_SCHEMA_VERSION ||
    typeof node.node_id !== 'string' ||
    !node.node_id ||
    typeof node.kind !== 'string'
  ) {
    throw new Error('tower active node state is invalid');
  }
  return node as TowerActiveNodeState;
}

function readStagedReward(value: unknown): TowerStagedRewardState | null {
  if (value === null || value === undefined) return null;
  const staged = requireRecord(value, 'tower staged reward state is invalid');
  if (
    staged.schemaVersion !== TOWER_STAGED_REWARD_SCHEMA_VERSION ||
    typeof staged.node_id !== 'string' ||
    !staged.node_id ||
    typeof staged.kind !== 'string' ||
    !isRecord(staged.reward)
  ) {
    throw new Error('tower staged reward state is invalid');
  }
  return staged as TowerStagedRewardState;
}

function normalizeStagedReward(staged: TowerStagedRewardState, battle: unknown): JsonRecord {
  const allowed = new Set([
    'card',
    'artifact',
    'item',
    'limits',
    'disabled_categories',
    'pool_revision',
    'reroll_count',
  ]);
  const unknown = Object.keys(staged.reward).find(key => !allowed.has(key));
  if (unknown) throw new Error(`tower staged reward contains unsupported field: ${unknown}`);
  return normalizeTowerReward(
    {
      card: staged.reward.card,
      artifact: staged.reward.artifact,
      item: staged.reward.item,
      limits: staged.reward.limits,
    },
    battle,
  );
}

/**
 * Promote the hidden reward pool only for a victorious active tower battle.
 * Defeat/escape discard it. All node ids are checked before the stat root is
 * replaced, so a late battle callback can never claim another node's reward.
 */
export function settleTowerBattleRewardInStat(
  statValue: unknown,
  result: BattleEndResult,
  expectedNodeId?: string,
): TowerBattleRewardSettlementResult {
  const stat = requireRecord(statValue, 'stat_data is unavailable');
  if (readGameMode(stat) !== 'tower') {
    return { previous: null, run: null, changed: false, promoted: false, nodeId: null };
  }
  const previous = readRunState(stat);
  if (
    !previous ||
    previous.routeMode !== 'map' ||
    previous.phase !== 'in_node' ||
    !previous.currentNode ||
    !isBattleRunNode(previous.currentNode.kind)
  ) {
    return { previous, run: previous, changed: false, promoted: false, nodeId: null };
  }
  if (!['victory', 'defeat', 'terminated'].includes(result)) throw new Error('battle result is invalid');
  const nodeId = previous.currentNode.id;
  if (expectedNodeId && expectedNodeId !== nodeId) throw new Error('tower battle reward node is stale');

  const activeNode = readActiveNode(stat.run_node);
  const staged = readStagedReward(stat.run_node_reward);
  // Old tower saves that did not use pre-generated activation remain compatible.
  if (!activeNode && !staged) {
    return { previous, run: previous, changed: false, promoted: false, nodeId };
  }
  if (!activeNode || activeNode.node_id !== nodeId || activeNode.kind !== previous.currentNode.kind) {
    throw new Error('tower active node does not match the battle result');
  }
  if (staged && (staged.node_id !== nodeId || staged.kind !== previous.currentNode.kind)) {
    throw new Error('tower staged reward belongs to another node');
  }

  const draft = structuredClone(stat);
  let promoted = false;
  if (result === 'victory' && staged) {
    draft.reward = normalizeStagedReward(staged, draft.battle);
    promoted = true;
  } else if (result !== 'victory') {
    draft.reward = emptyReward();
  }
  draft.run_node = null;
  draft.run_node_reward = null;
  draft.run_event = null;
  draft.run_shop = null;
  draft.run_treasure = null;
  draft.run_rest = null;
  replaceRecord(stat, draft);
  return { previous, run: previous, changed: true, promoted, nodeId };
}
