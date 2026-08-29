import {
  createBattleResult,
  recommendBattleRewardBudget,
  settleBattleOutcomeVitals,
  migratePersistentRunDeck,
  planProgressionSettlement,
  type BattleEndResult,
  type BattleRequest,
} from '../game-core';
import { settleBattleRunInStat } from './runStateAdapter';
import { updateCurrentMessageVariablesWith } from './messageVariables';
import { refreshMvuContentDesignContext } from './contentDesignContextAdapter';

export interface TavernBattleSettlementInput {
  result: BattleEndResult;
  request?: BattleRequest;
  player: {
    currentHp: number;
    currentLust: number;
    /** Final custom-resource values. Definitions remain in canonical MVU state across battles. */
    resources?: Readonly<Record<string, { id: string; current: number; max: number; refresh: 'reset' | 'retain' }>>;
  };
  items?: ReadonlyArray<{ id: string; count: number }>;
  turns: number;
  rewardRequest?: Record<string, unknown> | null;
  /** Canonical one-record-per-owned-card deck after runtime run/permanent write-back. */
  persistentCards?: ReadonlyArray<Record<string, any>>;
}

function syncItemCounts(value: unknown, itemCounts: ReadonlyMap<string, number>): void {
  if (!Array.isArray(value)) return;
  value.forEach(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const item = entry as Record<string, any>;
    if (typeof item.id === 'string' && itemCounts.has(item.id)) item.count = itemCounts.get(item.id);
  });
}

function syncCombatResourceValues(
  value: unknown,
  resources: TavernBattleSettlementInput['player']['resources'],
): void {
  if (!Array.isArray(value) || !resources) return;
  value.forEach(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const resource = entry as Record<string, any>;
    const id = typeof resource.id === 'string' ? resource.id : '';
    const settled = resources[id];
    if (!settled || !Number.isFinite(settled.current)) return;
    const maximum = Number.isInteger(resource.max) && resource.max > 0
      ? resource.max
      : Math.max(1, Math.floor(Number(settled.max) || 1));
    resource.current = Math.min(maximum, Math.max(0, Math.floor(settled.current)));
  });
}

function settleBattleRoot(
  battleRoot: Record<string, any>,
  input: TavernBattleSettlementInput,
  result: ReturnType<typeof createBattleResult> | null,
  itemCounts: ReadonlyMap<string, number>,
  persistentCards: Record<string, any>[] | null,
): void {
  const core = battleRoot.core;
  if (core && typeof core === 'object') {
    const vitals = result?.player || settleBattleOutcomeVitals(input.player, core);
    core.hp = vitals.hp;
    core.lust = vitals.lust;
    syncCombatResourceValues(core.resources, input.player.resources);
  }
  if (input.result === 'victory' && input.request) {
    const experience = recommendBattleRewardBudget(input.request.route || null).experience;
    const currentExperience = Number(battleRoot.exp);
    battleRoot.exp = (Number.isInteger(currentExperience) && currentExperience >= 0 ? currentExperience : 0) + experience;
  }
  // Progression belongs to the battle settlement transaction, not to whichever
  // status iframe happens to mount next.  The common page keeps the same
  // idempotent settlement as a compatibility fallback for non-battle EXP.
  const progression = planProgressionSettlement(battleRoot);
  if (progression.changed) {
    battleRoot.level = progression.after.level;
    battleRoot.exp = progression.after.exp;
    if (progression.promotions > 0) {
      if (!battleRoot.core || typeof battleRoot.core !== 'object' || Array.isArray(battleRoot.core)) {
        battleRoot.core = {};
      }
      battleRoot.core.card_removal_count = progression.nextCardRemovalCount;
    }
  }
  battleRoot.player_abilities = [];
  battleRoot.player_status_effects = [];
  syncItemCounts(battleRoot.items, itemCounts);
  if (persistentCards) battleRoot.cards = structuredClone(persistentCards);
}

function clearEnemy(enemyRoot: Record<string, any>): void {
  enemyRoot.name = '';
  enemyRoot.family_id = '';
  enemyRoot.family_name = '';
  enemyRoot.evolution_stage = '';
  enemyRoot.emoji = '';
  enemyRoot.max_hp = 0;
  enemyRoot.hp = 0;
  enemyRoot.max_lust = 100;
  enemyRoot.lust = 0;
  enemyRoot.description = '';
  enemyRoot.actions = [];
  enemyRoot.abilities = [];
  enemyRoot.status_effects = [];
  enemyRoot.resources = [];
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
  // Validate the complete deck before touching HP, route state, rewards or enemies.
  const persistentCards = input.persistentCards
    ? migratePersistentRunDeck(input.persistentCards)
    : null;
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
    settleBattleRoot(root, input, battleResult, itemCounts, persistentCards);
    if (root.enemy && typeof root.enemy === 'object') clearEnemy(root.enemy);
    if (Array.isArray(root.enemies)) root.enemies.forEach(enemy => {
      if (enemy && typeof enemy === 'object' && !Array.isArray(enemy)) clearEnemy(enemy);
    });
  }
  if (input.request) {
    const settledPlayer = battleResult?.player || {
      hp: input.player.currentHp,
      lust: input.player.currentLust,
    };
    refreshMvuContentDesignContext(variables, {
      request: input.request,
      player: {
        hp: settledPlayer.hp,
        maxHp: input.request.player.maxHp,
        lust: settledPlayer.lust,
        maxLust: input.request.player.maxLust,
      },
      outcome: {
        outcome: input.result,
        turns: Math.max(0, Math.floor(Number(input.turns) || 0)),
        hpRatio: input.request.player.maxHp > 0 ? settledPlayer.hp / input.request.player.maxHp : 0,
        lustRatio: input.request.player.maxLust > 0 ? settledPlayer.lust / input.request.player.maxLust : 0,
      },
    });
  }
  return variables;
}

export async function settleCurrentMessageBattle(input: TavernBattleSettlementInput): Promise<void> {
  await Promise.resolve(
    updateCurrentMessageVariablesWith(variables => settleTavernBattleVariables(variables, input)),
  );
}
