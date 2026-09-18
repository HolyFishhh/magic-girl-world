import { planTowerOpeningOutcome, type TowerOpeningOutcomePlan } from './towerOpeningOutcome';
import { parseNonCombatSettlement } from './nonCombatSettlement';
import type { RunNodeOutcome } from './runState';

export interface TowerEventOutcomePlan extends Omit<TowerOpeningOutcomePlan, 'reward' | 'maxLustDelta' | 'deckTransforms'> {
  routeOutcome: RunNodeOutcome;
  resourceDeltas: Record<string, number>;
  reward: Record<string, unknown> | null;
  grantedCards: Record<string, unknown>[];
  maxLustDelta: number;
  cost: import('./nonCombatSettlement').NonCombatSettlementCosts;
  deckActions: import('./nonCombatDeckActions').NonCombatDeckAction[];
  grant: import('./nonCombatSettlement').NonCombatGrantPlan | null;
}

export interface TowerEventResourceChange {
  id: string;
  name: string;
  emoji: string;
  delta: number;
  before: number;
  after: number;
  max: number;
}

export interface TowerEventResourceSettlementPlan {
  affordable: boolean;
  changes: TowerEventResourceChange[];
  resources: Record<string, unknown>[];
  shortage?: {
    id: string;
    name: string;
    required: number;
    available: number;
  };
}

const RESOURCE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseResourceDeltas(value: unknown): Record<string, number> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('事件资源变化必须是“资源 ID 到整数”的对象');
  const entries = Object.entries(value);
  if (entries.length > 16) throw new Error('事件资源变化最多包含 16 项');
  const result: Record<string, number> = {};
  for (const [id, delta] of entries) {
    if (!RESOURCE_ID.test(id) || id === 'energy') throw new Error(`事件资源 ID 无效：${id}`);
    if (!Number.isInteger(delta) || Number(delta) < -999 || Number(delta) > 999) {
      throw new Error(`事件资源变化必须是 -999..999 的整数：${id}`);
    }
    result[id] = Number(delta);
  }
  return result;
}

function resourceDefinitions(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord).map(entry => structuredClone(entry));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([key, entry]) => ({
      ...(RESOURCE_ID.test(String(entry.id || '')) ? {} : { id: key }),
      ...structuredClone(entry),
    }));
}

/**
 * Resolve one event's persistent custom-resource changes against the player's
 * current registered resource library. The whole plan is atomic: when one
 * cost is unaffordable none of the returned resource values are changed.
 */
export function planTowerEventResourceSettlement(
  deltasValue: unknown,
  resourcesValue: unknown,
): TowerEventResourceSettlementPlan {
  const deltas = parseResourceDeltas(deltasValue);
  const resources = resourceDefinitions(resourcesValue);
  if (Object.keys(deltas).length === 0) return { affordable: true, changes: [], resources };

  const byId = new Map<string, { index: number; value: Record<string, unknown> }>();
  resources.forEach((resource, index) => {
    const id = String(resource.id || '');
    if (!RESOURCE_ID.test(id) || id === 'energy') throw new Error(`玩家自定义资源定义无效：${id || index}`);
    if (byId.has(id)) throw new Error(`玩家自定义资源重复：${id}`);
    byId.set(id, { index, value: resource });
  });

  const changes: TowerEventResourceChange[] = [];
  let shortage: TowerEventResourceSettlementPlan['shortage'];
  for (const [id, delta] of Object.entries(deltas)) {
    const registered = byId.get(id);
    if (!registered) throw new Error(`事件引用了未注册的玩家资源：${id}`);
    const resource = registered.value;
    const max = Number(resource.max);
    const before = Number(resource.current === undefined ? (resource.start ?? 0) : resource.current);
    if (!Number.isInteger(max) || max <= 0 || !Number.isInteger(before) || before < 0 || before > max) {
      throw new Error(`玩家资源当前值无效：${id}`);
    }
    const name = typeof resource.name === 'string' && resource.name.trim() ? resource.name.trim() : id;
    const emoji = typeof resource.emoji === 'string' ? resource.emoji.trim() : '';
    if (delta < 0 && before < Math.abs(delta) && !shortage) {
      shortage = { id, name, required: Math.abs(delta), available: before };
    }
    changes.push({
      id,
      name,
      emoji,
      delta,
      before,
      after: Math.min(max, Math.max(0, before + delta)),
      max,
    });
  }

  if (!shortage) {
    for (const change of changes) {
      const registered = byId.get(change.id)!;
      resources[registered.index] = { ...registered.value, current: change.after };
    }
  }
  return {
    affordable: !shortage,
    changes,
    resources,
    ...(shortage ? { shortage } : {}),
  };
}

/**
 * Validate the compact, program-settled outcome used by pre-generated tower
 * events. Reward candidate validation remains runtime-owned because it needs
 * the player's current card/status/resource libraries.
 */
export function planTowerEventOutcome(value: unknown): TowerEventOutcomePlan {
  const { outcome: _routeOutcome, reward: _reward, ...settlement } = isRecord(value) ? value : {};
  void _routeOutcome;
  void _reward;
  const shared = parseNonCombatSettlement(settlement);
  if (!isRecord(value)) throw new Error('事件结果必须是对象');
  const unknown = Object.keys(value).find(
    key =>
      ![
        'outcome',
        'hp',
        'max_hp',
        'lust',
        'max_lust',
        'gold',
        'card_removals',
        'resources',
        'reward',
        'gain_cards',
        'cost',
        'deck_actions',
        'grant',
      ].includes(key),
  );
  if (unknown) throw new Error(`事件结果不支持字段：${unknown}`);
  const routeOutcome = value.outcome === undefined ? 'cleared' : String(value.outcome);
  if (!['cleared', 'failed', 'escaped'].includes(routeOutcome)) throw new Error('事件路线结果无效');
  if (value.reward !== undefined && !isRecord(value.reward)) throw new Error('事件 reward 必须是对象');
  if (
    value.gain_cards !== undefined &&
    (!Array.isArray(value.gain_cards) || value.gain_cards.some(card => !isRecord(card)))
  )
    throw new Error('事件 gain_cards 必须是完整卡牌数组');
  const scalar = planTowerOpeningOutcome({
    ...(value.hp === undefined ? {} : { hp: value.hp }),
    ...(value.max_hp === undefined ? {} : { max_hp: value.max_hp }),
    ...(value.lust === undefined ? {} : { lust: value.lust }),
    ...(value.max_lust === undefined ? {} : { max_lust: value.max_lust }),
    ...(value.gold === undefined ? {} : { gold: value.gold }),
    ...(value.card_removals === undefined ? {} : { card_removals: value.card_removals }),
  });
  return {
    routeOutcome: routeOutcome as RunNodeOutcome,
    hpDelta: scalar.hpDelta,
    maxHpDelta: scalar.maxHpDelta,
    lustDelta: scalar.lustDelta,
    maxLustDelta: shared.maxLustDelta,
    goldDelta: scalar.goldDelta,
    cardRemovalDelta: scalar.cardRemovalDelta,
    resourceDeltas: parseResourceDeltas(value.resources),
    grantedCards: structuredClone((value.gain_cards ?? []) as Record<string, unknown>[]),
    reward: value.reward === undefined ? null : structuredClone(value.reward),
    cost: shared.costs,
    deckActions: shared.deckActions,
    grant: shared.grant,
  };
}
