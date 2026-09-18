import { stableHash32 } from './deterministicRandom';
import type { RunState } from './runState';

export interface TowerCardMemory {
  schemaVersion: 1;
  unchosen: Array<{ id: string; card: Record<string, any>; sourceNodeId: string }>;
  acquiredIds: string[];
  shopShownIds: string[];
  rejectedOffers?: Array<{ receipt: string; sourceNodeId: string; cards: Record<string, any>[] }>;
}
const record = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);

export function readTowerCardMemory(run: RunState): TowerCardMemory {
  const source = run.cardMemory;
  return source?.schemaVersion === 1 && Array.isArray(source.unchosen)
    && Array.isArray(source.acquiredIds) && Array.isArray(source.shopShownIds)
    ? {schemaVersion:1,
      unchosen:structuredClone(source.unchosen.filter(entry => record(entry) && typeof entry.id === 'string' && record(entry.card) && entry.card.id === entry.id && typeof entry.sourceNodeId === 'string')),
      rejectedOffers: Array.isArray(source.rejectedOffers) ? structuredClone(source.rejectedOffers.filter(entry => record(entry) && typeof entry.receipt === 'string' && Array.isArray(entry.cards)).slice(-8)) : [],
      acquiredIds:[...new Set(source.acquiredIds.filter(id => typeof id === 'string'))],
      shopShownIds:[...new Set(source.shopShownIds.filter(id => typeof id === 'string'))],
    } : { schemaVersion: 1, unchosen: [], acquiredIds: [], shopShownIds: [] };
}

/** Record a resolved offer, never an unseen future branch. */
export function rememberTowerCardOffer(run: RunState, candidates: readonly unknown[], selectedIds: readonly string[]): RunState {
  const memory = readTowerCardMemory(run);
  const acquired = new Set([...memory.acquiredIds, ...selectedIds]);
  const known = new Set(memory.unchosen.map(entry => entry.id));
  for (const candidate of candidates) {
    if (!record(candidate) || typeof candidate.id !== 'string' || acquired.has(candidate.id) || known.has(candidate.id)) continue;
    const card = structuredClone(candidate); delete card.price; card.quantity = 1;
    memory.unchosen.push({ id: card.id, card, sourceNodeId: run.currentNode?.id || 'opening' });
    known.add(card.id);
  }
  memory.acquiredIds = [...acquired];
  memory.unchosen = memory.unchosen.filter(entry => !acquired.has(entry.id));
  return { ...run, cardMemory: memory };
}

/** A previous save may predate the explicit archive. Recover only consumed offers. */
export function recoverTowerCardMemory(run: RunState, ownedCards: readonly unknown[]): RunState {
  let next = run;
  const owned = ownedCards.filter(record).map(card => String(card.id));
  if (!run.cardMemory) {
    const visited = new Set(run.visitedNodeIds);
    for (const [id, envelope] of Object.entries(run.nodeContent)) {
      if (!visited.has(id) || envelope.phase !== 'consumed') continue;
      const content = record(envelope.content) ? envelope.content : {};
      const reward = record(envelope.reward) ? envelope.reward : record(content.reward) ? content.reward : {};
      const candidates = reward.card ?? reward.cards;
      const choices = content.payload?.event?.choices || content.event?.choices || [];
      if (Array.isArray(choices)) for (const choice of choices) {
        const offered = choice?.outcome?.reward?.cards ?? choice?.outcome?.reward?.card;
        if (Array.isArray(offered)) next = rememberTowerCardOffer(next, offered, owned);
      }
      if (Array.isArray(candidates)) {
        next = rememberTowerCardOffer(next, candidates, owned);
        if (envelope.kind === 'shop') next = markTowerShopCardsShown(next, candidates);
      }
    }
  }
  return rememberTowerCardOffer(next, [], owned);
}

/** Seeded ordering is stable across reopening and independent of battle RNG. */
export function towerMemoryCandidates(run: RunState, nodeId: string, purpose: 'recall' | 'shop'): Record<string, any>[] {
  const memory = readTowerCardMemory(run);
  const excluded = new Set([...memory.acquiredIds, ...(purpose === 'shop' ? memory.shopShownIds : [])]);
  return memory.unchosen.filter(entry => !excluded.has(entry.id))
    .map(entry => ({ ...entry, order: stableHash32({ namespace: `tower-memory-${purpose}-v1`, seed: run.seed, nodeId, id: entry.id }) }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(entry => structuredClone(entry.card));
}

export function markTowerShopCardsShown(run: RunState, cards: readonly unknown[]): RunState {
  const memory = readTowerCardMemory(run);
  memory.shopShownIds = [...new Set([...memory.shopShownIds, ...cards.filter(record).map(card => String(card.id))])];
  return { ...run, cardMemory: memory };
}

/** Only finalized, displayed groups of three count; partial claims never signal rejection. */
export function rememberRejectedTowerOffer(run: RunState, cards: readonly unknown[], receipt: string): RunState {
  if (cards.length !== 3 || !cards.every(record)) return run;
  const memory = readTowerCardMemory(run);
  const rejected = memory.rejectedOffers || [];
  if (rejected.some(entry => entry.receipt === receipt)) return run;
  memory.rejectedOffers = [...rejected, { receipt, sourceNodeId: run.currentNode?.id || 'opening', cards: structuredClone(cards as Record<string, any>[]) }].slice(-8);
  return { ...run, cardMemory: memory };
}

export function towerRewardPreferenceContext(run: RunState): Record<string, any> | undefined {
  const rejected = readTowerCardMemory(run).rejectedOffers || [];
  if (!rejected.length) return undefined;
  return {
    instruction: '玩家曾整组三张都不选。下一次新生成卡牌奖励请尝试与这些弃选方案不同的新流派或关键机制，同时提供能衔接现有卡组、弥补当前短板的选择。不要只换名称重复旧方案；不要改写已生成内容。此为设计偏好，不是数值或质量硬门槛。',
    recentRejectedOffers: rejected.slice(-3).map(entry => ({ sourceNodeId: entry.sourceNodeId, cards: entry.cards })),
  };
}
