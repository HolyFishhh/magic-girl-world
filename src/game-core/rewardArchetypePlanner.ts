import { ARCHETYPE_GRAPH, profileDeckArchetypes, scoreContentArchetypes } from './archetypeGraph';
import { scoreDeckPower, type DeckPowerDimensions, type DeckPowerScore } from './deckPowerScore';
import {
  createContentMechanicsFingerprint,
  createContentStructuralFingerprint,
} from './contentFingerprint';
import type { ContentDefinition, ContentPack } from './contentPack';

export const REWARD_ARCHETYPE_PLAN_SPEC = 'mwg.reward-archetype-plan/v1' as const;

export type RewardArchetypePathKind = 'reinforce' | 'bridge' | 'pivot' | 'universal';
export type RewardPowerDimension = Exclude<keyof DeckPowerDimensions, 'volatility'>;

export interface RewardArchetypeTarget {
  id: string;
  label: string;
  description: string;
}

export interface RewardArchetypeDirection {
  kind: RewardArchetypePathKind;
  direction: string;
  targets: RewardArchetypeTarget[];
  priorityDimensions: RewardPowerDimension[];
}

export interface RewardArchetypePlan {
  spec: typeof REWARD_ARCHETYPE_PLAN_SPEC;
  baseDeckScore: number;
  primaryArchetypes: RewardArchetypeTarget[];
  weakestDimensions: Array<{ id: RewardPowerDimension; score: number }>;
  directions: RewardArchetypeDirection[];
  avoidRecentStructures: string[];
  constraints: string[];
}

export interface RewardCandidateArchetypeEvaluation {
  candidateId: string;
  pathKind: RewardArchetypePathKind;
  deckScoreDelta: number;
  relativeDeckScoreDelta: number;
  candidatePowerScore: number;
  selectionValue: number;
  dimensionGains: Partial<Record<keyof DeckPowerDimensions, number>>;
  affinities: Array<{ id: string; label: string; score: number }>;
  pathScores: Record<RewardArchetypePathKind, number>;
  novelty: number;
  structuralDuplicate: boolean;
  mechanicalDuplicate: boolean;
}

export interface DeckCardContribution {
  id: string;
  name: string;
  scoreContribution: number;
  scoreContributionRatio: number;
}

const POWER_DIMENSIONS: RewardPowerDimension[] = [
  'output',
  'survival',
  'economy',
  'consistency',
  'scaling',
  'control',
  'flexibility',
];

const DIMENSION_LABELS: Record<RewardPowerDimension, string> = {
  output: '输出',
  survival: '生存',
  economy: '资源',
  consistency: '稳定',
  scaling: '成长',
  control: '控制',
  flexibility: '灵活',
};

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantity(definition: ContentDefinition): number {
  const value = Number(definition.quantity);
  return Number.isInteger(value) && value > 0 ? Math.min(100, value) : 1;
}

function target(id: string): RewardArchetypeTarget | null {
  const node = ARCHETYPE_GRAPH.find(entry => entry.id === id);
  return node ? { id: node.id, label: node.label, description: node.description } : null;
}

function targetList(ids: readonly string[], limit = 3): RewardArchetypeTarget[] {
  const seen = new Set<string>();
  return ids.flatMap(id => {
    if (seen.has(id)) return [];
    seen.add(id);
    const value = target(id);
    return value ? [value] : [];
  }).slice(0, limit);
}

function appendRewardCard(pack: ContentPack, candidate: ContentDefinition): ContentPack {
  return {
    ...pack,
    cards: [...pack.cards, { ...candidate, quantity: 1 }],
  };
}

function removeOneCard(pack: ContentPack, index: number): ContentPack {
  const cards = pack.cards.flatMap((card, cardIndex) => {
    if (cardIndex !== index) return [card];
    const copies = quantity(card);
    return copies > 1 ? [{ ...card, quantity: copies - 1 }] : [];
  });
  return { ...pack, cards };
}

function dimensionGains(before: DeckPowerScore, after: DeckPowerScore): Partial<Record<keyof DeckPowerDimensions, number>> {
  return {
    ...Object.fromEntries(POWER_DIMENSIONS.map(id => [id, round(after.dimensions[id] - before.dimensions[id])])),
    volatility: round(before.dimensions.volatility - after.dimensions.volatility),
  };
}

function weakestDimensions(score: DeckPowerScore): RewardArchetypePlan['weakestDimensions'] {
  return POWER_DIMENSIONS
    .map(id => ({ id, score: score.dimensions[id] }))
    .sort((left, right) => left.score - right.score || left.id.localeCompare(right.id))
    .slice(0, 3);
}

/**
 * Produce a compact pre-generation plan. It describes meaningful choices without
 * dictating card names, narrative skins, status names, or a fixed card recipe.
 */
export function createRewardArchetypePlan(input: {
  pack: ContentPack;
  maxHp: number;
  recentStructures?: readonly string[];
}): RewardArchetypePlan {
  const deck = profileDeckArchetypes(input.pack);
  const power = scoreDeckPower({ pack: input.pack, maxHp: input.maxHp });
  const weak = weakestDimensions(power);
  const primaryIds = deck.primary.slice(0, 3);
  const evolutionIds = deck.evolutionSuggestions.map(entry => entry.to);
  const bridgeIds = deck.evolutionSuggestions
    .filter(entry => entry.transitionCost <= 0.62)
    .map(entry => entry.to);
  const pivotIds = deck.evolutionSuggestions
    .filter(entry => entry.transitionCost > 0.35)
    .map(entry => entry.to);
  const weakLabels = weak.map(entry => DIMENSION_LABELS[entry.id]).join('、') || '现有短板';
  const primaryLabels = targetList(primaryIds).map(entry => entry.label).join('、') || '尚未成形的核心机制';
  const bridgeLabels = targetList(bridgeIds.length ? bridgeIds : evolutionIds).map(entry => entry.label).join('、');
  const pivotLabels = targetList(pivotIds.length ? pivotIds : evolutionIds.slice(1)).map(entry => entry.label).join('、');
  return {
    spec: REWARD_ARCHETYPE_PLAN_SPEC,
    baseDeckScore: power.totalScore,
    primaryArchetypes: targetList(primaryIds, 4),
    weakestDimensions: weak,
    directions: [
      {
        kind: 'reinforce',
        direction: `深化${primaryLabels}，补充已有链条缺少的启动、收益或循环环节`,
        targets: targetList(primaryIds, 3),
        priorityDimensions: weak.slice(0, 2).map(entry => entry.id),
      },
      {
        kind: 'bridge',
        direction: bridgeLabels
          ? `用一张同时服务现有核心与${bridgeLabels}的牌建立相邻机制桥梁`
          : `连接已有启动器与收益端，让两种现有机制在同一张牌上产生实际互动`,
        targets: targetList(bridgeIds.length ? bridgeIds : evolutionIds, 3),
        priorityDimensions: weak.slice(0, 2).map(entry => entry.id),
      },
      {
        kind: 'pivot',
        direction: pivotLabels
          ? `复用现有资源或触发入口，向${pivotLabels}渐进转向，不突然抛弃当前构筑`
          : `复用已有入口提供操作方式不同的渐进转向，不跨越多个无关机制`,
        targets: targetList(pivotIds.length ? pivotIds : evolutionIds.slice(1), 3),
        priorityDimensions: weak.slice(0, 2).map(entry => entry.id),
      },
      {
        kind: 'universal',
        direction: `提供不强绑定流派、但能补足${weakLabels}或改善操作容错的通用散卡`,
        targets: [],
        priorityDimensions: weak.map(entry => entry.id),
      },
    ],
    avoidRecentStructures: [...new Set(input.recentStructures || [])].slice(-8),
    constraints: [
      '候选应形成不同决策，不得只改数值或叙事换皮。',
      '允许强化、桥接、渐进转向和通用散卡，不要求每张牌都属于主流派。',
      '避免一张候选在费用、适用面和收益上完全支配另一张候选。',
      '卡牌效果必须可由现有 DSL 执行，流派标签只描述结构，不代替效果定义。',
    ],
  };
}

/** Evaluate the real marginal change of adding one candidate to the current deck. */
export function evaluateRewardCandidateArchetype(input: {
  pack: ContentPack;
  candidate: ContentDefinition;
  maxHp: number;
}): RewardCandidateArchetypeEvaluation {
  const basePower = scoreDeckPower({ pack: input.pack, maxHp: input.maxHp });
  const deck = profileDeckArchetypes(input.pack);
  const augmented = appendRewardCard(input.pack, input.candidate);
  const afterPower = scoreDeckPower({ pack: augmented, maxHp: input.maxHp });
  const gains = dimensionGains(basePower, afterPower);
  const affinities = scoreContentArchetypes(input.candidate, augmented)
    .slice(0, 6)
    .map(entry => ({ id: entry.id, label: entry.label, score: entry.score }));
  const affinityScores = new Map(affinities.map(entry => [entry.id, entry.score]));
  const primaryShares = new Map(deck.affinities.map(entry => [entry.id, entry.share]));
  const primaryTotal = Math.max(1, [...primaryShares.values()].reduce((sum, value) => sum + value, 0));
  const reinforce = clamp([...affinityScores.entries()].reduce(
    (sum, [id, score]) => sum + score * (primaryShares.get(id) || 0) / primaryTotal,
    0,
  ) * 2.2);
  const evolutionScores = deck.evolutionSuggestions.flatMap(entry => {
    const score = affinityScores.get(entry.to);
    return score === undefined ? [] : [score * (1 - entry.transitionCost * 0.55)];
  });
  const hasPrimary = deck.primary.some(id => affinityScores.has(id));
  const bridge = clamp((Math.max(0, ...evolutionScores) || 0) * (hasPrimary ? 1.15 : 0.78));
  const pivot = clamp((Math.max(0, ...evolutionScores) || 0) * (hasPrimary ? 0.65 : 1.05));
  const weak = weakestDimensions(basePower);
  const gap = clamp(weak.reduce((sum, entry) => sum + Math.max(0, Number(gains[entry.id]) || 0), 0) * 12 / Math.max(1, weak.length));
  const structuralFingerprint = createContentStructuralFingerprint(input.candidate);
  const mechanicsFingerprint = createContentMechanicsFingerprint(input.candidate);
  const structuralDuplicate = input.pack.cards.some(card => createContentStructuralFingerprint(card) === structuralFingerprint);
  const mechanicalDuplicate = input.pack.cards.some(card => createContentMechanicsFingerprint(card) === mechanicsFingerprint);
  const novelty = structuralDuplicate ? (mechanicalDuplicate ? 0 : 25) : mechanicalDuplicate ? 55 : 100;
  const universal = clamp((affinities.length === 0 ? 55 : 15) + gap * 0.55 + novelty * 0.2);
  const pathScores: Record<RewardArchetypePathKind, number> = {
    reinforce: round(reinforce),
    bridge: round(bridge),
    pivot: round(pivot),
    universal: round(universal),
  };
  const pathKind = (Object.entries(pathScores) as Array<[RewardArchetypePathKind, number]>)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
  const deckScoreDelta = round(afterPower.totalScore - basePower.totalScore);
  const relativeDeckScoreDelta = round(deckScoreDelta / Math.max(1, basePower.totalScore) * 100, 2);
  const candidatePowerScore = round(clamp(50 + relativeDeckScoreDelta * 8));
  const selectionValue = round(clamp(
    candidatePowerScore * 0.35
      + pathScores[pathKind] * 0.3
      + gap * 0.2
      + novelty * 0.15
      - (structuralDuplicate ? 12 : 0),
  ));
  return {
    candidateId: String(input.candidate.id || input.candidate.name || 'candidate'),
    pathKind,
    deckScoreDelta,
    relativeDeckScoreDelta,
    candidatePowerScore,
    selectionValue,
    dimensionGains: gains,
    affinities,
    pathScores,
    novelty,
    structuralDuplicate,
    mechanicalDuplicate,
  };
}

/**
 * Estimate how much one current copy contributes by removing only that copy.
 * Negative values are valid: a curse or severe clog may reduce total deck power.
 */
export function profileDeckCardContributions(input: {
  pack: ContentPack;
  maxHp: number;
}): DeckCardContribution[] {
  const base = scoreDeckPower({ pack: input.pack, maxHp: input.maxHp });
  return input.pack.cards.map((card, index) => {
    const without = scoreDeckPower({ pack: removeOneCard(input.pack, index), maxHp: input.maxHp });
    const contribution = round(base.totalScore - without.totalScore);
    return {
      id: String(card.id || `card_${index + 1}`),
      name: String(card.name || card.id || `卡牌${index + 1}`),
      scoreContribution: contribution,
      scoreContributionRatio: round(contribution / Math.max(1, base.totalScore) * 100, 2),
    };
  });
}
