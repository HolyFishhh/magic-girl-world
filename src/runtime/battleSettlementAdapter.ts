import {
  createBattleResult,
  recommendBattleRewardBudget,
  settleBattleOutcomeVitals,
  type BattleEndResult,
  type BattleRequest,
} from '../game-core';
import { settleBattleRunInStat } from './runStateAdapter';
import { updateCurrentMessageVariablesWith } from './messageVariables';

export interface TavernBattleSettlementInput {
  result: BattleEndResult;
  request?: BattleRequest;
  player: { currentHp: number; currentLust: number };
  items?: ReadonlyArray<{ id: string; count: number }>;
  turns: number;
  rewardRequest?: Record<string, unknown> | null;
}

function syncItemCounts(value: unknown, itemCounts: ReadonlyMap<string, number>): void {
  if (!Array.isArray(value)) return;
  value.forEach(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const item = entry as Record<string, any>;
    if (typeof item.id === 'string' && itemCounts.has(item.id)) item.count = itemCounts.get(item.id);
  });
}

function settleBattleRoot(
  battleRoot: Record<string, any>,
  input: TavernBattleSettlementInput,
  result: ReturnType<typeof createBattleResult> | null,
  itemCounts: ReadonlyMap<string, number>,
): void {
  const core = battleRoot.core;
  if (core && typeof core === 'object') {
    const vitals = result?.player || settleBattleOutcomeVitals(input.player, core);
    core.hp = vitals.hp;
    core.lust = vitals.lust;
  }
  if (input.result === 'victory' && input.request) {
    const experience = recommendBattleRewardBudget(input.request.route || null).experience;
    const currentExperience = Number(battleRoot.exp);
    battleRoot.exp = (Number.isInteger(currentExperience) && currentExperience >= 0 ? currentExperience : 0) + experience;
  }
  battleRoot.player_abilities = [];
  battleRoot.player_status_effects = [];
  syncItemCounts(battleRoot.items, itemCounts);
}

function clearEnemy(enemyRoot: Record<string, any>): void {
  enemyRoot.name = '';
  enemyRoot.emoji = '';
  enemyRoot.max_hp = 0;
  enemyRoot.hp = 0;
  enemyRoot.max_lust = 100;
  enemyRoot.lust = 0;
  enemyRoot.description = '';
  enemyRoot.actions = [];
  enemyRoot.abilities = [];
  enemyRoot.status_effects = [];
  enemyRoot.lust_effect =
    enemyRoot.lust_effect && typeof enemyRoot.lust_effect === 'object' ? enemyRoot.lust_effect : {};
  enemyRoot.lust_effect.name = '';
  enemyRoot.lust_effect.description = '';
  enemyRoot.lust_effect.effects = [];
  enemyRoot.action_mode = enemyRoot.action_mode || 'random';
  enemyRoot.action_config = {};
}

/** Apply the post-confirmation MUV cleanup at the Tavern storage boundary. */
export function settleTavernBattleVariables(
  variables: Record<string, any>,
  input: TavernBattleSettlementInput,
): Record<string, any> {
  const battleResult = input.request
    ? createBattleResult({
        request: input.request,
        outcome: input.result,
        player: { hp: input.player.currentHp, lust: input.player.currentLust },
        items: input.items || [],
        turns: input.turns,
      })
    : null;
  const itemCounts = new Map((battleResult?.items || input.items || []).map(item => [item.id, item.count]));

  if (variables.stat_data && typeof variables.stat_data === 'object') {
    settleBattleRunInStat(
      variables.stat_data,
      battleResult?.outcome || input.result,
      battleResult?.route?.nodeId,
    );
    const reward = variables.stat_data.reward;
    if (reward && typeof reward === 'object' && !Array.isArray(reward)) {
      reward.request = input.rewardRequest ?? null;
    }
  }

  const roots = [variables.stat_data?.battle].filter(
    (value): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  );
  for (const root of roots) {
    settleBattleRoot(root, input, battleResult, itemCounts);
    if (root.enemy && typeof root.enemy === 'object') clearEnemy(root.enemy);
    if (Array.isArray(root.enemies)) root.enemies.forEach(enemy => {
      if (enemy && typeof enemy === 'object' && !Array.isArray(enemy)) clearEnemy(enemy);
    });
  }
  return variables;
}

export async function settleCurrentMessageBattle(input: TavernBattleSettlementInput): Promise<void> {
  await Promise.resolve(
    updateCurrentMessageVariablesWith(variables => settleTavernBattleVariables(variables, input)),
  );
}
