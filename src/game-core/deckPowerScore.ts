import { analyzeContentDefinition, analyzeDesireOverflowPayload } from './contentAnalysis';
import {
  summarizeBuildBudgetScenarios,
  type BuildBudget,
  type ContentDefinition,
  type ContentPack,
} from './contentPack';
import { createContentEvaluationFingerprint, playerEvaluationState } from './contentFingerprint';
import { extractArchetypeEvidence, playerArchetypeDefinitions } from './archetypeEvidence';
import {
  extractContentMechanicFeatures,
  mergeContentMechanicFeatures,
  type ContentMechanicFeatures,
} from './contentMechanicFeatures';
import { normalizeCardCost } from './combatResource';

export const DECK_POWER_SCORE_SPEC = 'mwg.deck-power/v1' as const;

export interface DeckPowerDimensions {
  /** Sustainable pressure through HP and desire routes. */
  output: number;
  /** Block, healing and maximum-HP reserve. */
  survival: number;
  /** Draw, energy and custom-resource access. */
  economy: number;
  /** Likelihood that a useful, payable hand appears. */
  consistency: number;
  /** Delayed engines, triggers and compounding effects. */
  scaling: number;
  /** Debuffs, denial, turn control and enemy manipulation. */
  control: number;
  /** Number of meaningful routes and bridge mechanics. */
  flexibility: number;
  /** Draw/target/formula variance; higher means less reliable. */
  volatility: number;
}

export interface DeckPowerCurvePoint {
  turn: 1 | 3 | 5 | 8;
  cumulativePressure: number;
  cumulativeProtection: number;
  cumulativeHealing: number;
}

export interface DeckPowerScore {
  spec: typeof DECK_POWER_SCORE_SPEC;
  /** Ignores current HP/lust and presentation text. */
  fingerprint: string;
  totalScore: number;
  dimensions: DeckPowerDimensions;
  curves: DeckPowerCurvePoint[];
  budget: BuildBudget;
  maxHp: number;
  deckSize: number;
  confidence: 'low' | 'medium' | 'high';
  coverage: number;
  mechanicAxes: string[];
  reasons: string[];
}

const scoreCache = new Map<string, DeckPowerScore>();
const CURVE_TURNS = [1, 3, 5, 8] as const;

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantity(value: ContentDefinition): number {
  const amount = Number(value.quantity);
  return Number.isInteger(amount) && amount > 0 ? Math.min(100, amount) : 1;
}

function buildOnlyFingerprint(pack: ContentPack, maxHp: number): string {
  return [
    createContentEvaluationFingerprint(playerEvaluationState(pack)),
    `maxhp:${round(maxHp, 2)}`,
  ].join(':');
}

function cardDefinitions(pack: ContentPack): ContentDefinition[] {
  return pack.cards.flatMap(card => Array.from({ length: quantity(card) }, () => card));
}

function operationCount(features: ContentMechanicFeatures, operations: readonly string[]): number {
  return operations.filter(operation => features.operations.includes(operation)).length;
}

function playableCardRatio(cards: readonly ContentDefinition[], pack: ContentPack): number {
  if (cards.length === 0) return 0;
  const playable = cards.filter(card => {
    if (card.type === 'Curse') return false;
    const cost = normalizeCardCost(card.cost ?? 0);
    return Object.entries(cost).every(([resource, amount]) => {
      if (amount === 'all') return true;
      const supply = pack.playerResources?.find(entry => entry.id === resource);
      const available = resource === 'energy' ? 3 : supply?.refresh === 'reset'
        ? Number(supply.max) || 0 : Number(supply?.current ?? supply?.start) || 0;
      return amount <= available;
    });
  }).length;
  return playable / cards.length;
}

function numericRoutePressure(pack: ContentPack): { damage: number; lust: number; dynamic: number } {
  let damage = 0;
  let lust = 0;
  let dynamic = 0;
  let copies = 0;
  for (const card of pack.cards) {
    const count = quantity(card);
    const analysis = analyzeContentDefinition(card, {
      selfHp: 100,
      selfMaxHp: 100,
      opponentHp: 100,
      opponentMaxHp: 100,
      selfEnergy: 3,
      selfMaxEnergy: 3,
      spentEnergy: 2,
      xValue: 2,
    });
    damage += analysis.damage * count;
    lust += analysis.lust * count;
    dynamic += analysis.dynamicMetrics.size > 0 || !analysis.damageKnown ? count : 0;
    copies += count;
  }
  if (copies <= 0) return { damage: 0, lust: 0, dynamic: 0 };
  return { damage: damage / copies, lust: lust / copies, dynamic: dynamic / copies };
}

function curve(
  budget: BuildBudget,
  scaling: number,
  consistency: number,
  volatility: number,
): DeckPowerCurvePoint[] {
  const reliability = clamp((consistency + (100 - volatility)) / 200, 0.35, 1);
  const pressurePerTurn = Math.max(0, budget.attack) * (0.72 + reliability * 0.28);
  const protectionPerTurn = Math.max(0, budget.defense) * (0.75 + reliability * 0.25);
  const healingPerTurn = Math.max(0, budget.sustain) * 0.8;
  return CURVE_TURNS.map(turn => {
    const growth = 1 + (scaling / 100) * Math.max(0, turn - 1) * 0.065;
    return {
      turn,
      cumulativePressure: round(pressurePerTurn * turn * growth),
      cumulativeProtection: round(protectionPerTurn * turn * (1 + (scaling / 100) * 0.025 * (turn - 1))),
      cumulativeHealing: round(healingPerTurn * turn),
    };
  });
}

/**
 * Score persistent player power without using current HP or current lust.
 * This is a fast, deterministic baseline. Encounter simulation is a separate calibration layer.
 */
export function scoreDeckPower(input: { pack: ContentPack; maxHp: number; fullHealthBudget?: BuildBudget }): DeckPowerScore {
  const maxHp = Math.max(1, Number(input.maxHp) || 1);
  const fingerprint = `${buildOnlyFingerprint(input.pack, maxHp)}:${createContentEvaluationFingerprint(input.fullHealthBudget ?? null)}`;
  const cached = scoreCache.get(fingerprint);
  if (cached) return cached;

  // Use a full-health detached state so current HP cannot alter the persistent build score.
  const suppliedBudget = input.fullHealthBudget;
  const budget = suppliedBudget && suppliedBudget.hp === suppliedBudget.maxHp && suppliedBudget.maxHp === Math.round(maxHp)
    ? suppliedBudget
    : summarizeBuildBudgetScenarios(input.pack, { hp: maxHp, maxHp }).expected;
  const cards = cardDefinitions(input.pack);
  const allDefinitions = playerArchetypeDefinitions(input.pack);
  const featureSets = allDefinitions.map(value => extractArchetypeEvidence(value, input.pack));
  const features = mergeContentMechanicFeatures(featureSets);
  const overflowPayload = input.pack.desireEffects.player
    ? analyzeDesireOverflowPayload(input.pack.desireEffects.player, { opponentMaxHp: 100 }, input.pack.statuses)
    : null;
  const routes = numericRoutePressure(input.pack);
  const playableRatio = playableCardRatio(cards, input.pack);
  const roleCount = new Set(featureSets.flatMap(value => value.roles)).size;
  const freeCopies = cards.filter(card => !card.payment && Object.values(normalizeCardCost(card.cost ?? 0)).every(value => value === 0)).length;
  const curseCopies = cards.filter(card => card.type === 'Curse').length;
  const dynamicOperations = operationCount(features, [
    'condition', 'history_formula', 'container_formula', 'x_formula', 'x_cost', 'random', 'choose',
  ]);
  const engineOperations = operationCount(features, [
    'trigger', 'modify', 'patch_card', 'upgrade_card', 'schedule', 'replay', 'replay_current', 'auto_play', 'stance',
    'channel_orb', 'spawn_summon', 'extra_turn', 'resource', 'set_resource',
  ]);
  const controlOperations = operationCount(features, [
    'status_action', 'interception', 'card_payment',
    'apply_status', 'remove_status', 'card_rule', 'end_turn', 'discard', 'exhaust', 'modify',
  ]);
  const unsupportedComplexity = operationCount(features, [
    'status_action', 'interception', 'card_payment',
    'apply_status', 'remove_status', 'trigger', 'replay', 'replay_current', 'auto_play', 'schedule', 'extra_turn',
    'spawn_summon', 'spawn_enemy', 'channel_orb', 'evoke_orb', 'modify_orb', 'sly', 'discard_remove', 'discard_purge',
  ]);

  const consistency = clamp(
    30 + playableRatio * 35 + Math.min(20, budget.draw * 7) + Math.min(10, freeCopies * 1.5)
      - Math.max(0, budget.deck - 12) * 1.7 - curseCopies * 3.5 - routes.dynamic * 8,
  );
  const scaling = clamp(12 + engineOperations * 8 + features.triggers.length * 4 + features.resources.length * 5);
  const economy = clamp(28 + budget.draw * 11 + budget.energy * 14 + features.resources.length * 8 + freeCopies * 1.2);
  const survivalSignals = operationCount(features, ['heal', 'lifesteal', 'damage_taken_reduction', 'summon_intercept']);
  const survival = clamp(
    budget.defense * 4.4 + budget.sustain * 5.2 + Math.sqrt(maxHp) * 4.2 + survivalSignals * 2.5,
  );
  const output = clamp(
    budget.attack * 5.3 + Math.max(routes.damage, routes.lust * 0.7) * 2.2 + scaling * 0.12,
  );
  const control = clamp(8 + controlOperations * 12 + features.statuses.length * 5 + features.targets.length * 2);
  const flexibility = clamp(
    10 + features.axes.length * 7 + roleCount * 6 + Math.min(12, features.targets.length * 3),
  );
  const volatility = clamp(
    8 + routes.dynamic * 28 + dynamicOperations * 8 + Math.max(0, budget.deck - 10) * 1.6
      + features.targets.filter(target => target.startsWith('random')).length * 10
      - budget.draw * 5,
  );
  const dimensions: DeckPowerDimensions = {
    output: round(output),
    survival: round(survival),
    economy: round(economy),
    consistency: round(consistency),
    scaling: round(scaling),
    control: round(control),
    flexibility: round(flexibility),
    volatility: round(volatility),
  };

  const rawThroughput =
    budget.attack * 2.2 + budget.defense * 1.6 + budget.sustain * 1.8 + budget.draw * 3
    + budget.energy * 4 + maxHp * 0.25;
  const qualityMultiplier = 0.78 + consistency / 500 + scaling / 1000 + flexibility / 1200 - volatility / 1600;
  const totalScore = round(Math.max(1, rawThroughput * clamp(qualityMultiplier, 0.62, 1.3) + control * 0.1));
  const coverage = clamp(
    1 - unsupportedComplexity * 0.09 - (overflowPayload?.uncertain ? 0.1 : 0) - Math.max(0, features.complexity - 55) / 200,
    0.25,
    1,
  );
  const confidence: DeckPowerScore['confidence'] = coverage >= 0.82 ? 'high' : coverage >= 0.58 ? 'medium' : 'low';
  const reasons = [
    `每回合压力约 ${round(budget.attack)}，防护约 ${round(budget.defense)}，恢复约 ${round(budget.sustain)}`,
    `最大生命 ${round(maxHp)}；当前生命不参与基础分`,
    `稳定性 ${round(consistency)}，成长性 ${round(scaling)}，估算覆盖率 ${Math.round(coverage * 100)}%`,
    ...(playableRatio < 1 ? ['部分卡牌超出初始或固定刷新资源；后续产能与连招需以试打核对'] : []),
    ...(features.operations.includes('discard_remove') ? ['遗弃：弃牌会本场移除，可能精简循环，也可能失去关键牌'] : []),
    ...(features.operations.includes('discard_purge') ? ['遗忘：弃牌会永久删牌，单场估分不能代表长期收益'] : []),
    ...(survivalSignals ? [`生存识别：${Object.entries({ heal: '治疗', lifesteal: '吸血', damage_taken_reduction: '伤害减免', summon_intercept: '召唤护卫' }).filter(([operation]) => features.operations.includes(operation)).map(([, label]) => label).join('、')}`] : []),
    ...(overflowPayload?.uncertain ? ['欲望满溢含动态或未登记状态 payload，已保守降低覆盖率'] : []),
    features.axes.length ? `主要机械轴：${features.axes.slice(0, 6).join('、')}` : '尚未形成明确机械轴',
  ];
  const result: DeckPowerScore = {
    spec: DECK_POWER_SCORE_SPEC,
    fingerprint,
    totalScore,
    dimensions,
    curves: curve(budget, scaling, consistency, volatility),
    budget,
    maxHp: round(maxHp),
    deckSize: budget.deck,
    confidence,
    coverage: round(coverage, 3),
    mechanicAxes: features.axes,
    reasons,
  };
  scoreCache.set(fingerprint, result);
  while (scoreCache.size > 64) scoreCache.delete(scoreCache.keys().next().value as string);
  return result;
}

export function clearDeckPowerScoreCache(): void {
  scoreCache.clear();
}
