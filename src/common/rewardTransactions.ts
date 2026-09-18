import { rememberTowerCardOffer, recoverTowerCardMemory, rememberRejectedTowerOffer } from '../game-core/towerCardMemory';
import { applyNonCombatSettlementInStat, type NonCombatAnswers } from './nonCombatSettlementTransactions';
import type { NonCombatGrantPlan } from '../game-core/nonCombatSettlement';
import { validateRunState } from '../game-core/runState';
import {
  readRewardCandidateQuantity,
  validateRewardCandidateAgainstLibrary,
  type RewardCandidateValidationResult,
} from '../game-core/rewardCandidateValidation';
import {
  planRewardPoolMutation,
  planRewardSelections,
  type RewardPoolMutation,
} from '../game-core/rewardSettlement';
import type { RewardCategory, RewardSelections } from '../game-core/rewardSelection';
import { readGameMode } from '../game-core/towerMode';
import { towerItemSlotsRemaining, towerRewardItemSlots } from '../game-core/towerInventory';
import { flattenMvuArray, normalizeMvuStatusDefinitions } from '../runtime/mvuArrays';
import { readRewardCardGroups, planRewardCardGroupClaim } from '../game-core/rewardCardGroups';
import { migratePersistentRunDeck } from '../game-core/cardProgression';

export type { RewardCategory, RewardSelections } from '../game-core/rewardSelection';

export interface RewardSelectionSummary {
  cards: string[];
  artifacts: string[];
  items: string[];
}

export interface CardRemovalResult {
  cardName: string;
  remainingQuantity: number;
  remainingRemovals: number;
}

export type RewardCandidateInspections = Record<RewardCategory, RewardCandidateValidationResult[]>;

export interface RewardPoolMutationResult {
  revision: number;
  rerolls: number;
  disabledCategories: RewardCategory[];
  changedCategories: RewardCategory[];
  counts: Record<RewardCategory, number>;
}

const REWARD_KEYS = {
  cards: 'card',
  artifacts: 'artifact',
  items: 'item',
} as const;
const REWARD_CATEGORIES: readonly RewardCategory[] = ['cards', 'artifacts', 'items'];

function clonePlainValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, message: string): Record<string, any> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

export function normalizeMvuList<T = any>(value: unknown): T[] {
  return flattenMvuArray<T>(value);
}

export function readRewardRoot(statRoot: unknown): Record<string, any> | null {
  if (!isRecord(statRoot) || !isRecord(statRoot.reward)) return null;
  return statRoot.reward;
}

export function hasSelectableRewards(statRoot: unknown): boolean {
  const reward = readRewardRoot(statRoot);
  const disabled = new Set(readDisabledRewardCategories(statRoot));
  const limits = readRewardEntitlements(statRoot);
  return Boolean(
    reward && (Number(reward.gold) > 0 && reward.gold_claimed !== true || REWARD_CATEGORIES.some(category =>
      !disabled.has(category)
      && limits[category] > 0
      && normalizeMvuList(reward[REWARD_KEYS[category]]).length > 0)),
  );
}

export function readDisabledRewardCategories(statRoot: unknown): RewardCategory[] {
  const reward = readRewardRoot(statRoot);
  if (!reward || reward.disabled_categories === undefined) return [];
  if (!Array.isArray(reward.disabled_categories)) throw new Error('reward.disabled_categories 必须是数组');
  const categories = reward.disabled_categories.map((value: unknown) => {
    if (!REWARD_CATEGORIES.includes(value as RewardCategory)) throw new Error(`奖励类别无效：${String(value)}`);
    return value as RewardCategory;
  });
  if (new Set(categories).size !== categories.length) throw new Error('reward.disabled_categories 不能重复');
  return REWARD_CATEGORIES.filter(category => categories.includes(category));
}

function getMutableMvuList(root: Record<string, any>, key: string): any[] {
  const value = root[key];
  if (!Array.isArray(value)) throw new Error(`奖励写入失败：battle.${key} 不是数组`);
  return value;
}

function readLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 1;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return 1;
  return numeric;
}

export function readRewardEntitlements(statRoot: unknown): Record<RewardCategory, number> {
  const reward = readRewardRoot(statRoot);
  if (!reward) return { cards: 1, artifacts: 1, items: 1 };
  const limits = isRecord(reward.limits) ? reward.limits : {};
  const disabled = new Set(readDisabledRewardCategories(statRoot));
  const result = {
    cards: disabled.has('cards') ? 0 : readLimit(limits.cards),
    artifacts: disabled.has('artifacts') ? 0 : readLimit(limits.artifacts),
    items: disabled.has('items') ? 0 : readLimit(limits.items),
  };
  return result;
}

export function readRewardLimits(statRoot: unknown): Record<RewardCategory, number> {
  const result = readRewardEntitlements(statRoot);
  if (isRecord(statRoot) && readGameMode(statRoot) === 'tower') {
    result.items = Math.min(result.items, towerItemSlotsRemaining(statRoot.battle));
  }
  return result;
}

function rewardPoolCandidates(reward: Record<string, any>): Record<RewardCategory, Record<string, any>[]> {
  return {
    cards: normalizeMvuList<Record<string, any>>(reward.card),
    artifacts: normalizeMvuList<Record<string, any>>(reward.artifact),
    items: normalizeMvuList<Record<string, any>>(reward.item),
  };
}

function validateRewardPool(stat: Record<string, any>, candidates: Record<RewardCategory, unknown[]>): void {
  const battle = requireRecord(stat.battle, '奖励池修改失败：battle 数据不存在');
  const statusDefinitions = normalizeMvuStatusDefinitions(battle.statuses);
  const knownResourceIds = normalizeMvuList<Record<string, any>>(battle.core?.resources)
    .map(resource => String(resource?.id || ''))
    .filter(Boolean);
  const libraries: Record<RewardCategory, Record<string, any>[]> = {
    cards: normalizeMvuList<Record<string, any>>(battle.cards).map(clonePlainValue),
    artifacts: normalizeMvuList<Record<string, any>>(battle.artifacts).map(clonePlainValue),
    items: normalizeMvuList<Record<string, any>>(battle.items).map(clonePlainValue),
  };
  for (const category of REWARD_CATEGORIES) {
    for (const candidate of candidates[category]) {
      if (!isRecord(candidate)) throw new Error(`奖励池 ${category} 候选必须是对象`);
      const validation = validateRewardCandidateAgainstLibrary(category, candidate, {
        playerDesireEffect: battle.player_lust_effect,
        existing: libraries[category],
        statusDefinitions,
        knownResourceIds,
      });
      if (!validation.ok) throw new Error(`奖励 ${rewardName(candidate)} 无效：${validation.message}`);
      libraries[category].push(clonePlainValue(candidate));
    }
  }
}

/** Atomically replace/reroll/disable/modify generated reward candidates. */
export function mutateRewardPoolInStat(
  statValue: unknown,
  mutation: RewardPoolMutation,
): RewardPoolMutationResult {
  const stat = requireRecord(statValue, '奖励池修改失败：stat_data 不存在');
  const reward = requireRecord(stat.reward, '奖励池修改失败：reward 数据不存在');
  const plan = planRewardPoolMutation(
    {
      candidates: rewardPoolCandidates(reward),
      disabledCategories: readDisabledRewardCategories(stat),
      revision: reward.pool_revision,
      rerolls: reward.reroll_count,
    },
    mutation,
  );
  validateRewardPool(stat, plan.candidates);

  if (reward.card_choice_groups != null && plan.changedCategories.includes('cards')) {
    let groups=readRewardCardGroups(reward,normalizeMvuList(reward.card).length);
    if(mutation.kind==='disable_category')groups=[];
    else if(mutation.kind==='modify'){
      const removed=[...(mutation.removeIndices||[])].sort((a,b)=>a-b);
      groups=groups.map(group=>{
        const indices=group.indices.filter(index=>!removed.includes(index)).map(index=>index-removed.filter(value=>value<index).length);
        return {...group,indices,pick:Math.min(group.pick,indices.length)};
      });
      const additions=mutation.add?.length||0;
      if(additions){
        const first=groups[0]||{id:'cards',indices:[],pick:0};
        if(!groups.length)groups.push(first);
        first.indices.push(...Array.from({length:additions},(_,index)=>plan.candidates.cards.length-additions+index));
      }
    } else if(mutation.kind==='reroll' && plan.candidates.cards.length!==normalizeMvuList(reward.card).length) {
      throw new Error('多组选牌奖励重投必须保留分组候选数量');
    }
    reward.card_choice_groups=groups;
    reward.limits={...reward.limits,cards:groups.reduce((sum,group)=>sum+group.pick,0)};
  }

  reward.card = plan.candidates.cards.map(clonePlainValue);
  reward.artifact = plan.candidates.artifacts.map(clonePlainValue);
  reward.item = plan.candidates.items.map(clonePlainValue);
  reward.disabled_categories = [...plan.disabledCategories];
  reward.pool_revision = plan.revision;
  reward.reroll_count = plan.rerolls;
  return {
    revision: plan.revision,
    rerolls: plan.rerolls,
    disabledCategories: [...plan.disabledCategories],
    changedCategories: [...plan.changedCategories],
    counts: {
      cards: plan.candidates.cards.length,
      artifacts: plan.candidates.artifacts.length,
      items: plan.candidates.items.length,
    },
  };
}

/** Reuse the commit validator so malformed AI candidates can be disabled before selection. */
export function inspectRewardCandidates(statRoot: unknown): RewardCandidateInspections {
  const stat = isRecord(statRoot) ? statRoot : {};
  const reward = readRewardRoot(stat) || {};
  const battle = isRecord(stat.battle) ? stat.battle : {};
  const candidates: Record<RewardCategory, Record<string, any>[]> = {
    cards: normalizeMvuList<Record<string, any>>(reward.card),
    artifacts: normalizeMvuList<Record<string, any>>(reward.artifact),
    items: normalizeMvuList<Record<string, any>>(reward.item),
  };
  const existing: Record<RewardCategory, Record<string, any>[]> = {
    cards: normalizeMvuList<Record<string, any>>(battle.cards),
    artifacts: normalizeMvuList<Record<string, any>>(battle.artifacts),
    items: normalizeMvuList<Record<string, any>>(battle.items),
  };
  const statusDefinitions = normalizeMvuStatusDefinitions(battle.statuses);
  const knownResourceIds = normalizeMvuList<Record<string, any>>(battle.core?.resources)
    .map(resource => String(resource?.id || ''))
    .filter(Boolean);

  return {
    cards: candidates.cards.map(candidate =>
      validateRewardCandidateAgainstLibrary('cards', candidate, {
        playerDesireEffect: battle.player_lust_effect,
        existing: existing.cards,
        statusDefinitions,
        knownResourceIds,
      }),
    ),
    artifacts: candidates.artifacts.map(candidate =>
      validateRewardCandidateAgainstLibrary('artifacts', candidate, {
        playerDesireEffect: battle.player_lust_effect,
        existing: existing.artifacts,
        statusDefinitions,
        knownResourceIds,
      }),
    ),
    items: candidates.items.map(candidate =>
      validateRewardCandidateAgainstLibrary('items', candidate, {
        playerDesireEffect: battle.player_lust_effect,
        existing: existing.items,
        statusDefinitions,
        knownResourceIds,
      }),
    ),
  };
}

function rewardName(value: Record<string, any>): string {
  return String(value.name || value.id || '未知');
}

function rewardQuantity(value: Record<string, any>, category: RewardCategory): number {
  const raw = category === 'items' ? (value.count ?? 1) : (value.quantity ?? 1);
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`奖励 ${rewardName(value)} 的数量无效`);
  return quantity;
}

function findByIdentity(list: any[], value: Record<string, any>): Record<string, any> | undefined {
  const identity = value.id || value.name;
  if (!identity) return undefined;
  return list.find(entry => isRecord(entry) && (entry.id || entry.name) === identity);
}

function appendReward(target: any[], value: Record<string, any>, category: RewardCategory): void {
  const copy = clonePlainValue(value);
  delete copy.status;
  delete copy.statuses;
  if (category === 'cards') {
    const quantity = readRewardCandidateQuantity(category, copy);
    if (quantity === null) throw new Error(`奖励 ${rewardName(copy)} 的数量无效`);
    const existing = findByIdentity(target, copy);
    if ((copy.unique === true && (quantity !== 1 || existing)) || existing?.unique === true) throw new Error(`唯一卡牌“${rewardName(copy)}”已持有或数量重复`);
    // A reward is a new acquisition, never another copy of an owned instance.
    // Keep legacy quantity-only decks compact, but do not merge into an instance
    // (which could also carry upgrades/attachments belonging to just that card).
    delete copy.runInstanceId;
    delete copy.runInstanceIds;
    delete copy.combatInstanceId;
    delete copy.parentRunInstanceId;
    delete copy.parentCombatInstanceId;
    copy.quantity = quantity;
    if (target.some(card => card.runInstanceId || card.runInstanceIds)) {
      const next = migratePersistentRunDeck([...target, copy]);
      target.splice(0, target.length, ...next);
      return;
    }
    if (existing) {
      existing.quantity = rewardQuantity(existing, category) + quantity;
    } else {
      copy.quantity = quantity;
      target.push(copy);
    }
    return;
  }

  if (category === 'items') {
    const count = readRewardCandidateQuantity(category, copy);
    if (count === null) throw new Error(`奖励 ${rewardName(copy)} 的数量无效`);
    const existing = findByIdentity(target, copy);
    if (existing) {
      existing.count = rewardQuantity(existing, category) + count;
    } else {
      copy.count = count;
      delete copy.quantity;
      target.push(copy);
    }
    return;
  }

  target.push(copy);
}

/** Mutates one stat_data root. Call it only from an atomic MUV updater. */
function applyRewardSelectionsDraft(
  statRoot: Record<string, any>,
  selections: RewardSelections,
  options: RewardApplicationOptions = {},
): RewardSelectionSummary {
  const stat = requireRecord(statRoot, '奖励领取失败：stat_data 不存在');
  const reward = requireRecord(stat.reward, '奖励领取失败：reward 数据不存在');
  const battle = requireRecord(stat.battle, '奖励领取失败：battle 数据不存在');
  // Item capacity is a property of the complete receipt. Keep the authored
  // entitlement for selection validation, then reject an over-capacity batch
  // below before any mutation can grant a partial receipt.
  const limits = readRewardEntitlements(stat);
  const candidates = {
    cards: normalizeMvuList<Record<string, any>>(reward.card),
    artifacts: normalizeMvuList<Record<string, any>>(reward.artifact),
    items: normalizeMvuList<Record<string, any>>(reward.item),
  };
  const cardGroups = readRewardCardGroups(reward, candidates.cards.length);
  if (options.cardGroupId !== undefined) {
    const group = cardGroups.find(group=>group.id===options.cardGroupId);
    const selected = new Set(selections.cards);
    if(!group || selected.size!==group.pick || ![...selected].every(index=>group.indices.includes(index)))throw new Error('卡牌奖励已经更新，请重新选择');
  }
  const cardClaim = planRewardCardGroupClaim(cardGroups,selections.cards);
  const statusDefinitions = normalizeMvuStatusDefinitions(battle.statuses);
  const knownResourceIds = normalizeMvuList<Record<string, any>>(battle.core?.resources)
    .map(resource => String(resource?.id || ''))
    .filter(Boolean);
  const validationLibraries: Record<RewardCategory, Record<string, any>[]> = {
    cards: normalizeMvuList<Record<string, any>>(battle.cards).map(clonePlainValue),
    artifacts: normalizeMvuList<Record<string, any>>(battle.artifacts).map(clonePlainValue),
    items: normalizeMvuList<Record<string, any>>(battle.items).map(clonePlainValue),
  };
  const plan = planRewardSelections({
    selections,
    candidates,
    existing: validationLibraries,
    statusDefinitions,
    knownResourceIds,
    playerDesireEffect: battle.player_lust_effect,
    limits,
  });
  if (readGameMode(stat) === 'tower') {
    const selectedItems = plan.entries.filter(entry => entry.category === 'items').map(entry => entry.value);
    if (towerRewardItemSlots(selectedItems) > towerItemSlotsRemaining(battle)) {
      throw new Error('战斗道具栏已满，爬塔模式最多携带三个道具');
    }
  }

  const targets = {} as Partial<Record<RewardCategory, any[]>>;
  plan.entries.forEach(entry => {
    if (!targets[entry.category]) targets[entry.category] = getMutableMvuList(battle, entry.category);
  });
  const targetStatuses = plan.statuses.length > 0 ? getMutableMvuList(battle, 'statuses') : null;

  plan.entries.forEach(entry => {
    appendReward(targets[entry.category]!, entry.value, entry.category);
  });
  plan.statuses.forEach(status => targetStatuses!.push(status));

  const run = validateRunState(stat.run);
  if (readGameMode(stat) === 'tower' && run.ok) {
    const remembered = recoverTowerCardMemory(run.value, normalizeMvuList(battle.cards));
    stat.run = rememberTowerCardOffer(remembered, candidates.cards, plan.entries
      .filter(entry => entry.category === 'cards').map(entry => String(entry.value.id)));
    if (!options.partial) {
      for (const group of cardGroups) {
        if (group.pick <= 0 || group.indices.length !== 3 || group.indices.some(index => selections.cards.includes(index))) continue;
        const cards = group.indices.map(index => candidates.cards[index]);
        const receipt = JSON.stringify([run.value.currentNode?.id || 'opening', group.id, cards.map(card => card?.id)]);
        stat.run = rememberRejectedTowerOffer(stat.run, cards, receipt);
      }
    }

  }

  const selectedCategories = new Set(plan.entries.map(entry => entry.category));
  if (options.partial) {
    const nextLimits = { ...(isRecord(reward.limits) ? reward.limits : {}) };
    for (const category of selectedCategories) {
      const selected = new Set(plan.selections[category]);
      const remaining = candidates[category].filter((_candidate, index) => !(category==='cards'?cardClaim.removed:selected).has(index));
      reward[REWARD_KEYS[category]] = remaining.map(clonePlainValue);
      // A partial claim spends only the selected allowances.  This matters for
      // multi-pick relic drops: claiming A must leave B and one relic pick.
      nextLimits[category] = Math.max(0, readRewardEntitlements(stat)[category] - selected.size);
    }
    if(selectedCategories.has('cards')) {
      reward.card_choice_groups = cardClaim.groups;
      nextLimits.cards = cardClaim.groups.reduce((sum,group)=>sum+group.pick,0);
    }
    reward.limits = nextLimits;
  } else {
    reward.card = [];
    reward.artifact = [];
    reward.item = [];
    reward.limits = {};
    if (Object.hasOwn(reward,'card_choice_groups')) reward.card_choice_groups=null;
  }
  reward.pool_revision = Math.max(0,Number(reward.pool_revision)||0)+1;
  const acquisitions = plan.entries.filter(entry => entry.category === 'artifacts' && entry.value.on_acquire !== undefined);
  if (options.acquisitionPreview) {
    options.acquisitionPreview(structuredClone(stat), acquisitions.map(entry => structuredClone(entry.value)));
    return plan.summary;
  }
  for (const entry of acquisitions) {
    applyNonCombatSettlementInStat(stat, entry.value.on_acquire, options.acquisitionAnswers?.[String(entry.value.id)] ?? {}, {
      seed: JSON.stringify([stat.run?.seed ?? 0, 'acquisition', entry.value.id]),
      grant: applyFixedRewardGrant,
    });
  }
  return plan.summary;
}

export interface RewardApplicationOptions {
  /** Pure UI preparation only. The caller must execute against a private clone. */
  acquisitionPreview?: (stat: Record<string, any>, artifacts: Record<string, any>[]) => void;
  partial?: boolean;
  cardGroupId?: string;
  acquisitionAnswers?: Record<string, NonCombatAnswers>;
}

/** An acquisition, its choices, and every other selected reward commit together. */
export function applyRewardSelectionsToStat(
  stat: Record<string, any>,
  selections: RewardSelections,
  options: RewardApplicationOptions = {},
): RewardSelectionSummary {
  const draft = clonePlainValue(stat);
  const result = applyRewardSelectionsDraft(draft, selections, options);
  for (const key of Object.keys(stat)) delete stat[key];
  Object.assign(stat, draft);
  return result;
}

/** Reuse the same candidate/slot/status validation without consuming an outer reward pool. */
export function applyFixedRewardGrant(
  stat: Record<string, any>,
  bundle: NonCombatGrantPlan,
  selections: { cards: number[]; items: number[] },
): void {
  const previous = stat.reward;
  stat.reward = {
    card: bundle.cards,
    artifact: [],
    item: bundle.items,
    limits: { ...bundle.limits, artifacts: 0 },
  };
  try {
    applyRewardSelectionsToStat(stat, { ...selections, artifacts: [] });
  } finally {
    if (previous === undefined) delete stat.reward;
    else stat.reward = previous;
  }
}

/** Claim one reward category without discarding the remaining menu. */
export function claimRewardCategoryInStat(statRoot: Record<string, any>, category: RewardCategory, indexes: number[]): RewardSelectionSummary {
  return applyRewardSelectionsToStat(statRoot, {
    cards: category === 'cards' ? indexes : [],
    artifacts: category === 'artifacts' ? indexes : [],
    items: category === 'items' ? indexes : [],
  }, { partial: true });
}

/** Removes exactly one copy and consumes exactly one allowance. */
export function removeOneCardFromBattleDeck(battleValue: unknown, cardId: string): CardRemovalResult {
  const battle = requireRecord(battleValue, '删卡失败：battle 数据不存在');
  if (!cardId) throw new Error('删卡失败：卡牌 ID 无效');
  const core = requireRecord(battle.core, '删卡失败：battle.core 数据不存在');
  const removalCount = Number(core.card_removal_count);
  if (!Number.isInteger(removalCount) || removalCount <= 0) throw new Error('删卡次数不足');

  const cards = getMutableMvuList(battle, 'cards');
  const cardIndex = cards.findIndex(entry => isRecord(entry) && entry.id === cardId);
  if (cardIndex < 0) throw new Error('删卡失败：未找到所选卡牌');

  const card = cards[cardIndex] as Record<string, any>;
  const quantity = rewardQuantity(card, 'cards');
  const remainingQuantity = quantity - 1;
  if (remainingQuantity > 0) card.quantity = remainingQuantity;
  else cards.splice(cardIndex, 1);
  core.card_removal_count = removalCount - 1;

  return {
    cardName: rewardName(card),
    remainingQuantity,
    remainingRemovals: removalCount - 1,
  };
}
