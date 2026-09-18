import { isBattleRunNode, type BattleEndResult, type RunState } from '../game-core';
import { readGameMode } from '../game-core/towerMode';
import { readRunState } from './runStateAdapter';
import { applyDesireEffectGrowth } from './desireEffectGrowth';
import { readRewardCardGroups } from '../game-core/rewardCardGroups';
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

export interface TowerDefeatRewardReceipt {
  enemyId: string;
  reward: Record<string, unknown>;
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
    gold: 0,
    gold_claimed: true,
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
    'gold',
    'gold_claimed',
    'defeat_reward_receipts',
    'card_choice_groups',
  ]);
  const unknown = Object.keys(staged.reward).find(key => !allowed.has(key));
  if (unknown) throw new Error(`tower staged reward contains unsupported field: ${unknown}`);
  const normalized = normalizeTowerReward(
    {
      card: staged.reward.card,
      artifact: staged.reward.artifact,
      item: staged.reward.item,
      limits: staged.reward.limits,
      ...(staged.reward.card_choice_groups === undefined ? {} : {card_choice_groups:staged.reward.card_choice_groups}),
    },
    battle,
  );
  // Saves created before program-owned currency staged only content pools.
  // Keep those in-flight victories claimable once, without manufacturing a
  // retroactive currency drop that was never part of their saved snapshot.
  if (staged.reward.gold === undefined && staged.reward.gold_claimed === undefined) {
    return { ...normalized, gold: 0, gold_claimed: true };
  }
  const gold = Number(staged.reward.gold);
  if (!Number.isInteger(gold) || gold < 0 || staged.reward.gold_claimed !== false) {
    throw new Error('tower staged reward gold is invalid');
  }
  return { ...normalized, gold, gold_claimed: false };
}

function appendDefeatRewards(
  staged: TowerStagedRewardState,
  battle: unknown,
  receipts: readonly TowerDefeatRewardReceipt[],
): JsonRecord {
  const normalized = normalizeStagedReward(staged, battle);
  normalized.card_choice_groups = readRewardCardGroups(normalized, normalized.card.length);
  const claimed = new Set(
    Array.isArray((staged as Record<string, any>).defeat_reward_receipts)
      ? (staged as Record<string, any>).defeat_reward_receipts.filter((id: unknown): id is string => typeof id === 'string')
      : [],
  );
  for (const receipt of receipts) {
    if (!receipt || typeof receipt.enemyId !== 'string' || !receipt.enemyId || claimed.has(receipt.enemyId)) continue;
    const source = receipt.reward;
    if (!isRecord(source)) throw new Error('enemy defeat reward is invalid');
    const extra = normalizeTowerReward({
      cards: source.cards ?? [],
      artifacts: source.artifacts ?? [],
      items: source.items ?? [],
      limits: {
        cards: Array.isArray(source.cards) ? source.cards.length : 0,
        artifacts: Array.isArray(source.artifacts) ? source.artifacts.length : 0,
        items: Array.isArray(source.items) ? source.items.length : 0,
      },
    }, battle);
    const offset=normalized.card.length;
    normalized.card.push(...extra.card);
    if(extra.card.length) normalized.card_choice_groups.push({id:`defeat:${receipt.enemyId}`,indices:extra.card.map((_card:unknown,index:number)=>offset+index),pick:extra.limits.cards});
    normalized.artifact.push(...extra.artifact);
    normalized.item.push(...extra.item);
    normalized.limits.cards += extra.limits.cards;
    normalized.limits.artifacts += extra.limits.artifacts;
    normalized.limits.items += extra.limits.items;
    const gold = Number(source.gold ?? 0);
    if (!Number.isInteger(gold) || gold < 0) throw new Error('enemy defeat reward gold is invalid');
    claimed.add(receipt.enemyId);
  }
  return normalized;
}

function prorateBaseGold(
  reward: JsonRecord,
  defeatedEnemyIds: readonly string[],
  eligibleEnemyIds: readonly string[] | undefined,
): void {
  // Legacy snapshots predate the original-roster receipt. Preserve their
  // saved payout; new battles store the exact roster before reinforcements.
  if (!eligibleEnemyIds?.length) return;
  const eligible = new Set(eligibleEnemyIds);
  const defeated = new Set(defeatedEnemyIds);
  const count = [...eligible].filter(id => defeated.has(id)).length;
  reward.gold = Math.floor((Number(reward.gold) || 0) * count / eligible.size);
  reward.gold_claimed = reward.gold <= 0;
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
  defeatRewards: readonly TowerDefeatRewardReceipt[] = [],
  defeatedEnemyIds: readonly string[] = [],
  eligibleEnemyIds?: readonly string[],
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
    if (staged.desire_growth !== undefined) draft.battle = applyDesireEffectGrowth(draft.battle, staged.desire_growth);
    draft.reward = appendDefeatRewards(staged, draft.battle, defeatRewards);
    prorateBaseGold(draft.reward, defeatedEnemyIds, eligibleEnemyIds);
    // Special loot gold is granted only to actual defeat receipts, after the
    // ordinary roster share is calculated.
    for (const receipt of defeatRewards) {
      const gold = Number(receipt.reward?.gold ?? 0);
      if (Number.isInteger(gold) && gold > 0) {
        draft.reward.gold += gold;
        draft.reward.gold_claimed = false;
      }
    }
    promoted = true;
  } else if (result !== 'victory') {
    draft.reward = emptyReward();
  }
  draft.run_node = null;
  draft.run_node_reward = null;
  draft.run_event = null;
  draft.run_event_state = null;
  draft.run_shop = null;
  draft.run_treasure = null;
  draft.run_rest = null;
  replaceRecord(stat, draft);
  return { previous, run: previous, changed: true, promoted, nodeId };
}
