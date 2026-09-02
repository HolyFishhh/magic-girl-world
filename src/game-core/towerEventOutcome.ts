import { planTowerOpeningOutcome, type TowerOpeningOutcomePlan } from './towerOpeningOutcome';
import type { RunNodeOutcome } from './runState';

export interface TowerEventOutcomePlan extends Omit<TowerOpeningOutcomePlan, 'reward'> {
  routeOutcome: RunNodeOutcome;
  reward: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the compact, program-settled outcome used by pre-generated tower
 * events. Reward candidate validation remains runtime-owned because it needs
 * the player's current card/status/resource libraries.
 */
export function planTowerEventOutcome(value: unknown): TowerEventOutcomePlan {
  if (!isRecord(value)) throw new Error('事件结果必须是对象');
  const unknown = Object.keys(value).find(
    key => !['outcome', 'hp', 'max_hp', 'gold', 'card_removals', 'reward'].includes(key),
  );
  if (unknown) throw new Error(`事件结果不支持字段：${unknown}`);
  const routeOutcome = value.outcome === undefined ? 'cleared' : String(value.outcome);
  if (!['cleared', 'failed', 'escaped'].includes(routeOutcome)) throw new Error('事件路线结果无效');
  if (value.reward !== undefined && !isRecord(value.reward)) throw new Error('事件 reward 必须是对象');
  const scalar = planTowerOpeningOutcome({
    ...(value.hp === undefined ? {} : { hp: value.hp }),
    ...(value.max_hp === undefined ? {} : { max_hp: value.max_hp }),
    ...(value.gold === undefined ? {} : { gold: value.gold }),
    ...(value.card_removals === undefined ? {} : { card_removals: value.card_removals }),
  });
  return {
    routeOutcome: routeOutcome as RunNodeOutcome,
    hpDelta: scalar.hpDelta,
    maxHpDelta: scalar.maxHpDelta,
    goldDelta: scalar.goldDelta,
    cardRemovalDelta: scalar.cardRemovalDelta,
    reward: value.reward === undefined ? null : structuredClone(value.reward),
  };
}
