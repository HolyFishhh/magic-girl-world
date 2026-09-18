import { parseNonCombatSettlement, planNonCombatCosts, type NonCombatGrantPlan } from '../game-core/nonCombatSettlement';
import { executeNonCombatDeckPlan, planNonCombatDeckAction } from '../game-core/nonCombatDeckActions';
import { migratePersistentRunDeck } from '../game-core/cardProgression';
import { planTowerEventResourceSettlement } from '../game-core/towerEventOutcome';
import { flattenMvuArray } from '../runtime/mvuArrays';
import { preparePersistentReplacement } from './persistentReplacement';

export interface NonCombatAnswers {
  deck?: Record<string, string[]>;
  grant?: { cards: number[]; items: number[] };
}

export interface NonCombatSettlementExecution {
  seed: string;
  randomTargets?: Record<string, string[]>;
  randomSeeds?: Record<string, string>;
  requireFrozenRandom?: boolean;
  /** The existing reward validator/grant path owns card, status and slot rules. */
  grant(
    stat: Record<string, any>,
    bundle: NonCombatGrantPlan,
    selections: { cards: number[]; items: number[] },
  ): void;
}

function replace(target: Record<string, any>, next: Record<string, any>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
}

/**
 * Shared event/acquisition transaction. Selection UI runs before this call;
 * all validation and mutations operate on a private draft until the complete
 * package succeeds. In particular, grant/transform failures refund all costs.
 */
export function applyNonCombatSettlementInStat(
  stat: Record<string, any>,
  value: unknown,
  answers: NonCombatAnswers,
  execution: NonCombatSettlementExecution,
): void {
  const plan = parseNonCombatSettlement(value);
  const draft = structuredClone(stat);
  const core = draft.battle?.core;
  if (!core || typeof core !== 'object') throw new Error('非战斗结算缺少玩家状态');
  if ((plan.costs.gold || plan.goldDelta) && !draft.run) throw new Error('金币结算缺少当前冒险');
  const changesLust = plan.lustDelta !== 0 || plan.maxLustDelta !== 0;
  const paid = planNonCombatCosts(plan.costs, {
    hp: core.hp,
    max_hp: core.max_hp,
    lust: changesLust ? core.lust : 0,
    max_lust: changesLust ? core.max_lust : 1,
    gold: draft.run?.gold ?? 0,
    resources: core.resources,
  });
  const knownActionIds = new Set(plan.deckActions.map(action => action.id));
  if (Object.keys(answers.deck ?? {}).some(id => !knownActionIds.has(id))) throw new Error('选牌答案包含已失效的行动');

  let cards = migratePersistentRunDeck(flattenMvuArray<Record<string, any>>(draft.battle.cards));
  for (const action of plan.deckActions) {
    const frozenSeed = execution.randomSeeds?.[action.id];
    let deckPlan = planNonCombatDeckAction(cards, action, frozenSeed ?? execution.seed, answers.deck?.[action.id]);
    if (action.pick === 'random') {
      const frozen = execution.randomTargets?.[action.id];
      if (!frozen && !frozenSeed && execution.requireFrozenRandom) throw new Error('随机选牌尚未固定，请重新打开事件');
      // A saved random result is an identity list, never an invitation to
      // substitute another card if the originally selected instance vanished.
      if (frozen) deckPlan = { ...deckPlan, selectedIds: [...frozen], pending: false };
      const shown = answers.deck?.[action.id];
      if (shown && (shown.length !== deckPlan.selectedIds.length || shown.some((id, index) => id !== deckPlan.selectedIds[index]))) {
        throw new Error('随机选牌结果已变化，请重新确认；本次交易尚未结算');
      }
    }
    if (deckPlan.pending) throw new Error('请先完成选牌；本次交易尚未结算');
    const sourceId = deckPlan.selectedIds[0];
    cards = executeNonCombatDeckPlan(cards, deckPlan, replacement =>
      preparePersistentReplacement(draft, cards, sourceId, replacement),
    );
  }
  if (plan.deckActions.length) draft.battle.cards = cards;

  core.max_hp = plan.maxHpDelta ? Math.max(1, paid.max_hp + plan.maxHpDelta) : paid.max_hp;
  core.hp = Math.min(core.max_hp, plan.hpDelta ? Math.max(1, paid.hp + plan.hpDelta) : paid.hp);
  if (changesLust) {
    core.max_lust = Math.max(1, paid.max_lust + plan.maxLustDelta);
    core.lust = Math.min(core.max_lust, Math.max(0, paid.lust + plan.lustDelta));
  }
  if (draft.run) draft.run.gold = Math.min(999999, Math.max(0, paid.gold + plan.goldDelta));
  if (plan.cardRemovalDelta) {
    const before = core.card_removal_count ?? 0;
    if (!Number.isInteger(before) || before < 0) throw new Error('当前删牌额度无效');
    core.card_removal_count = Math.max(0, before + plan.cardRemovalDelta);
  }
  if (Object.keys(plan.costs.resources).length || Object.keys(plan.resourceDeltas).length) {
    const resources = planTowerEventResourceSettlement(plan.resourceDeltas, paid.resources);
    if (!resources.affordable) throw new Error(`资源不足：${resources.shortage?.name}`);
    core.resources = resources.resources;
  }
  if (plan.grantedCards.length) {
    execution.grant(draft, {
      cards: plan.grantedCards,
      items: [],
      limits: { cards: plan.grantedCards.length, items: 0 },
    }, { cards: plan.grantedCards.map((_, index) => index), items: [] });
  }
  if (plan.grant) {
    const selections = answers.grant ?? (
      plan.grant.limits.cards === plan.grant.cards.length && plan.grant.limits.items === plan.grant.items.length
        ? { cards: plan.grant.cards.map((_, index) => index), items: plan.grant.items.map((_, index) => index) }
        : null
    );
    if (!selections) throw new Error('请先选择获得的卡牌或道具；本次交易尚未结算');
    execution.grant(draft, plan.grant, selections);
  } else if (answers.grant) throw new Error('这次交易没有可选奖励');
  replace(stat, draft);
}
