import {
  createBattleResult,
  recommendBattleRewardBudget,
  settleBattleOutcomeVitals,
  migratePersistentRunDeck,
  planProgressionSettlement,
  profileDeckPower,
  scoreEnemyPower,
  type BattleEndResult,
  type BattleRequest,
} from '../game-core';
import { readGameMode } from '../game-core/towerMode';
import { settleBattleRunInStat } from './runStateAdapter';
import { readRunState } from './runStateAdapter';
import { settleTowerBattleRewardInStat } from './towerBattleRewardSettlement';
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

function removeDepletedItems(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
    const count = (entry as Record<string, any>).count;
    return count === undefined || Number(count) > 0;
  });
}

function syncCombatResourceValues(value: unknown, resources: TavernBattleSettlementInput['player']['resources']): void {
  if (!Array.isArray(value) || !resources) return;
  value.forEach(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const resource = entry as Record<string, any>;
    const id = typeof resource.id === 'string' ? resource.id : '';
    const settled = resources[id];
    if (!settled || !Number.isFinite(settled.current)) return;
    const maximum =
      Number.isInteger(resource.max) && resource.max > 0
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
  awardVictoryExperience = true,
): void {
  const core = battleRoot.core;
  if (core && typeof core === 'object') {
    const vitals = result?.player || settleBattleOutcomeVitals(input.player, core);
    core.hp = vitals.hp;
    core.lust = vitals.lust;
    syncCombatResourceValues(core.resources, input.player.resources);
  }
  if (input.result === 'victory' && input.request && awardVictoryExperience) {
    const experience = recommendBattleRewardBudget(input.request.route || null).experience;
    const currentExperience = Number(battleRoot.exp);
    battleRoot.exp =
      (Number.isInteger(currentExperience) && currentExperience >= 0 ? currentExperience : 0) + experience;
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
  battleRoot.items = removeDepletedItems(battleRoot.items);
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

function towerEncounterScoreSnapshot(
  request: BattleRequest | undefined,
  stat?: Record<string, any>,
): { playerDeckScore: number; enemyScore: number } | undefined {
  if (!request?.route?.nodeId) return undefined;
  const activeNode = stat?.run_node;
  const audited = activeNode?.program_balance;
  if (
    activeNode?.node_id === request.route.nodeId
    && Number.isFinite(Number(audited?.playerDeckScore))
    && Number(audited.playerDeckScore) > 0
    && Number.isFinite(Number(audited?.finalEnemyScore))
    && Number(audited.finalEnemyScore) >= 0
  ) {
    return {
      playerDeckScore: Number(audited.playerDeckScore),
      enemyScore: Number(audited.finalEnemyScore),
    };
  }
  try {
    const profile = profileDeckPower({
      pack: request.content,
      maxHp: Math.max(1, Number(request.player.maxHp) || 1),
      maxLust: Math.max(1, Number(request.player.maxLust) || 100),
      seeds: 8,
    });
    const enemy = scoreEnemyPower(request.content);
    if (!enemy || profile.totalScore <= 0) return undefined;
    return { playerDeckScore: profile.totalScore, enemyScore: enemy.currentEncounterScore };
  } catch (error) {
    console.warn('[MagicGirlWorld] 爬塔战斗评分失败，战斗结算继续进行', error);
    return undefined;
  }
}

/** Apply the post-confirmation MUV cleanup at the Tavern storage boundary. */
export function settleTavernBattleVariables(
  variables: Record<string, any>,
  input: TavernBattleSettlementInput,
): Record<string, any> {
  const expectedTowerNodeId = input.request?.route?.nodeId;
  if (expectedTowerNodeId && readGameMode(variables.stat_data) === 'tower') {
    const run = readRunState(variables.stat_data);
    const activeNodeId = run?.phase === 'in_node' ? run.currentNode?.id : null;
    if (activeNodeId !== expectedTowerNodeId) {
      // A repeated callback from an already-scored node is an idempotent no-op.
      // Most importantly, do not let its old HP, deck, enemy cleanup or reward
      // overwrite the route that has since advanced to another floor.
      const alreadySettled = run?.score?.encounters?.some(entry => entry.nodeId === expectedTowerNodeId) === true;
      if (alreadySettled) return variables;
      throw new Error('tower battle settlement belongs to a stale route node');
    }
  }

  // Validate the complete deck before touching HP, route state, rewards or enemies.
  const persistentCards = input.persistentCards ? migratePersistentRunDeck(input.persistentCards) : null;
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

  let workingVariables = variables;
  let statDraft: Record<string, any> | null = null;
  let awardVictoryExperience = true;
  if (variables.stat_data && typeof variables.stat_data === 'object') {
    const draft: Record<string, any> = structuredClone(variables.stat_data);
    statDraft = draft;
    workingVariables = { ...variables, stat_data: draft };
    // The reward transaction clears run_node, so retain the program-authored
    // balance receipt before promoting the reward pool.
    const encounterScoreSnapshot = towerEncounterScoreSnapshot(input.request, draft);
    const towerRewardSettlement = settleTowerBattleRewardInStat(
      draft,
      battleResult?.outcome || input.result,
      battleResult?.route?.nodeId,
    );
    const runSettlement = settleBattleRunInStat(
      draft,
      battleResult?.outcome || input.result,
      battleResult?.route?.nodeId,
      encounterScoreSnapshot,
    );
    // A tower node is the idempotency receipt for its battle. Once that route
    // has already settled, a duplicate callback may refresh vitals but must not
    // award victory EXP again. Story battles keep their established behavior.
    if (towerRewardSettlement.previous) awardVictoryExperience = runSettlement !== null;
    const reward = draft.reward;
    if (reward && typeof reward === 'object' && !Array.isArray(reward)) {
      reward.request = input.rewardRequest ?? null;
    }
  }

  const roots = [workingVariables.stat_data?.battle].filter((value): value is Record<string, any> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  );
  for (const root of roots) {
    settleBattleRoot(root, input, battleResult, itemCounts, persistentCards, awardVictoryExperience);
    if (root.enemy && typeof root.enemy === 'object') clearEnemy(root.enemy);
    if (Array.isArray(root.enemies))
      root.enemies.forEach(enemy => {
        if (enemy && typeof enemy === 'object' && !Array.isArray(enemy)) clearEnemy(enemy);
      });
  }
  if (input.request) {
    const settledPlayer = battleResult?.player || {
      hp: input.player.currentHp,
      lust: input.player.currentLust,
    };
    refreshMvuContentDesignContext(workingVariables, {
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
  // Publish the canonical MVU root only after route settlement, reward
  // promotion, battle cleanup, and design-context refresh all succeed. A late
  // failure therefore leaves the caller's original snapshot untouched.
  if (statDraft) variables.stat_data = statDraft;
  return variables;
}

export async function settleCurrentMessageBattle(input: TavernBattleSettlementInput): Promise<void> {
  await Promise.resolve(updateCurrentMessageVariablesWith(variables => settleTavernBattleVariables(variables, input)));
}
