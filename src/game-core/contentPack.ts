import { stableHash32, stableSerialize } from './deterministicRandom';
import {
  analyzeContentDefinition,
  analyzeStatusDefinition,
  getContentAnalysisScenarios,
  type ContentAnalysis,
  type ContentAnalysisOptions,
  type ContentMetric,
  type ContentModifier,
  CONTENT_DESIRE_EFFECT_WEIGHT,
} from './contentAnalysis';
import { applyModifierOperation, MODIFIER_SYMBOL_BY_OPERATOR } from './modifierMath';

export const CONTENT_PACK_SCHEMA_VERSION = 1 as const;

export type ContentDefinition = Readonly<Record<string, any>>;

export interface ContentPack {
  schemaVersion: typeof CONTENT_PACK_SCHEMA_VERSION;
  cards: ContentDefinition[];
  statuses: ContentDefinition[];
  relics: ContentDefinition[];
  items: ContentDefinition[];
  abilities: ContentDefinition[];
  activeStatuses: ContentDefinition[];
  enemy: ContentDefinition | null;
  desireEffects: {
    player: ContentDefinition | null;
    enemy: ContentDefinition | null;
  };
}

export interface CreateContentPackInput {
  cards?: unknown;
  statuses?: unknown;
  relics?: unknown;
  items?: unknown;
  abilities?: unknown;
  activeStatuses?: unknown;
  enemy?: unknown;
  playerDesireEffect?: unknown;
}

function cloneDefinition(value: unknown): ContentDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as ContentDefinition;
  } catch {
    return null;
  }
}

function definitionList(value: unknown): ContentDefinition[] {
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.map(entry => {
    const definition = cloneDefinition(entry);
    // Preserve malformed entries as sentinels so the shared content contract
    // can report their exact index instead of silently dropping AI output.
    return (definition || entry) as ContentDefinition;
  });
}

function normalizeEnemy(value: unknown): ContentDefinition | null {
  const enemy = cloneDefinition(value) as Record<string, any> | null;
  if (!enemy) return null;
  for (const key of ['actions', 'abilities', 'status_effects']) {
    if (enemy[key] !== undefined) enemy[key] = definitionList(enemy[key]);
  }
  if (enemy.lust_effect !== undefined) enemy.lust_effect = cloneDefinition(enemy.lust_effect) || enemy.lust_effect;
  return enemy;
}

/** Copy AI content into a host-neutral JSON package before runtime conversion. */
export function createContentPack(input: CreateContentPackInput): ContentPack {
  const enemy = normalizeEnemy(input.enemy);
  return {
    schemaVersion: CONTENT_PACK_SCHEMA_VERSION,
    cards: definitionList(input.cards),
    statuses: definitionList(input.statuses),
    relics: definitionList(input.relics),
    items: definitionList(input.items),
    abilities: definitionList(input.abilities),
    activeStatuses: definitionList(input.activeStatuses),
    enemy,
    desireEffects: {
      player: cloneDefinition(input.playerDesireEffect),
      enemy: cloneDefinition(enemy?.lust_effect),
    },
  };
}

export function isContentPack(value: unknown): value is ContentPack {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pack = value as Record<string, any>;
  return (
    pack.schemaVersion === CONTENT_PACK_SCHEMA_VERSION &&
    ['cards', 'statuses', 'relics', 'items', 'abilities', 'activeStatuses'].every(key => Array.isArray(pack[key])) &&
    (pack.enemy === null || (!!pack.enemy && typeof pack.enemy === 'object' && !Array.isArray(pack.enemy))) &&
    !!pack.desireEffects &&
    typeof pack.desireEffects === 'object'
  );
}

export function createContentPackFingerprint(pack: ContentPack): string {
  if (!isContentPack(pack)) throw new Error('content pack is invalid');
  const serialized = stableSerialize(pack);
  return `cp1:${stableHash32(serialized).toString(36)}:${serialized.length}`;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function applyModifiers(value: number, modifiers: readonly ContentModifier[]): number {
  return Math.max(
    0,
    modifiers.reduce(
      (current, modifier) =>
        applyModifierOperation(current, {
          operator: MODIFIER_SYMBOL_BY_OPERATOR[modifier.operator],
          value: modifier.value,
        }),
      value,
    ),
  );
}

function adjustedMetrics(
  analysis: ContentAnalysis,
  modifiers: readonly ContentModifier[],
): Record<ContentMetric, number> {
  const metrics = { ...analysis.metrics };
  const damageModifiers = modifiers.filter(
    modifier =>
      (modifier.target === 'self' && modifier.stat === 'damage') ||
      (modifier.target === 'opponent' && modifier.stat === 'damage_taken'),
  );
  if (analysis.damage > 0) {
    metrics.attack += applyModifiers(analysis.damage, damageModifiers) - analysis.damage;
  }
  const lustModifiers = modifiers.filter(
    modifier =>
      (modifier.target === 'self' && modifier.stat === 'lust') ||
      (modifier.target === 'opponent' && modifier.stat === 'lust_taken'),
  );
  if (analysis.lust > 0) {
    metrics.attack += (applyModifiers(analysis.lust, lustModifiers) - analysis.lust) * 0.5;
  }
  if (metrics.defense > 0) {
    metrics.defense = applyModifiers(
      metrics.defense,
      modifiers.filter(modifier => modifier.target === 'self' && modifier.stat === 'block'),
    );
  }
  if (metrics.sustain > 0) {
    metrics.sustain = applyModifiers(
      metrics.sustain,
      modifiers.filter(modifier => modifier.target === 'self' && modifier.stat === 'heal'),
    );
  }
  return metrics;
}

export interface BuildBudget {
  deck: number;
  attack: number;
  defense: number;
  sustain: number;
  draw: number;
  energy: number;
  hp: number;
  maxHp: number;
}

export interface BuildBudgetScenarioRange {
  expected: BuildBudget;
  min: BuildBudget;
  max: BuildBudget;
}

interface RawBuildBudget {
  deck: number;
  attack: number;
  defense: number;
  sustain: number;
  draw: number;
  energy: number;
  hp: number;
  maxHp: number;
}

interface BudgetCardEntry {
  quantity: number;
  cost: number | 'energy';
  metrics: Record<ContentMetric, number>;
}

const BASE_HAND_SIZE = 5;
const MAX_HAND_SIZE = 10;
const DEFAULT_TURN_ENERGY = 3;
const MAX_ESTIMATED_EXTRA_ENERGY = 3;

function estimatedCardCost(entry: BudgetCardEntry, availableEnergy: number): number {
  return entry.cost === 'energy' ? availableEnergy : entry.cost;
}

/**
 * Estimate the best useful portion of a random hand for each independent budget metric.
 * Enemy HP and pressure consume attack/defense separately, so a player may choose a
 * different set of cards for each without pretending every paid card can be played.
 */
function estimatePlayableCardMetrics(
  entries: readonly BudgetCardEntry[],
  deck: number,
  handSize: number,
  availableEnergy: number,
): Record<ContentMetric, number> {
  const result = { attack: 0, defense: 0, sustain: 0, draw: 0, energy: 0 };
  if (deck <= 0 || handSize <= 0) return result;
  const handRatio = Math.min(handSize, deck) / deck;

  for (const metric of Object.keys(result) as ContentMetric[]) {
    let freeValue = 0;
    let paidValue = 0;
    let paidDemand = 0;
    for (const entry of entries) {
      const value = Math.max(0, entry.metrics[metric] || 0);
      if (value <= 0) continue;
      const expectedCopies = entry.quantity * handRatio;
      const cost = estimatedCardCost(entry, availableEnergy);
      if (cost <= 0) freeValue += value * expectedCopies;
      else {
        paidValue += value * expectedCopies;
        paidDemand += cost * expectedCopies;
      }
    }
    const paidScale = paidDemand > availableEnergy && paidDemand > 0 ? availableEnergy / paidDemand : 1;
    result[metric] = freeValue + paidValue * paidScale;
  }
  return result;
}

function rawBuildBudgetAtScenario(
  pack: ContentPack,
  player: { hp: number; maxHp: number },
  analysisOptions: ContentAnalysisOptions,
): RawBuildBudget {
  const activeStatusStacks: Record<string, number> = {};
  for (const active of pack.activeStatuses) {
    const id = String(active.id ?? '');
    const stacks = Number(active.stacks);
    if (id && Number.isFinite(stacks) && stacks > 0) activeStatusStacks[id] = stacks;
  }
  const options: ContentAnalysisOptions = { ...analysisOptions, selfStatusStacks: activeStatusStacks };
  const supportAnalyses = [...pack.relics, ...pack.abilities].map(definition => ({
    definition,
    analysis: analyzeContentDefinition(definition, options),
  }));
  const statuses = new Map(pack.statuses.map(definition => [String(definition.id ?? ''), definition]));
  const activeStatusAnalyses = pack.activeStatuses.flatMap(active => {
    const id = String(active.id ?? '');
    const definition = statuses.get(id);
    if (!definition) return [];
    return [
      analyzeStatusDefinition(definition, {
        ...options,
        currentStatusStacks: activeStatusStacks[id] || 0,
      }),
    ];
  });
  const persistentModifiers = [
    ...supportAnalyses
      .filter(({ definition }) => definition.trigger === 'passive')
      .flatMap(({ analysis }) => analysis.modifiers),
    ...activeStatusAnalyses.flatMap(analysis => analysis.modifiers),
  ];
  const cardEntries: BudgetCardEntry[] = [];
  let deck = 0;
  for (const card of pack.cards) {
    const quantity = Number.isInteger(card.quantity) && card.quantity > 0 ? Math.min(100, card.quantity) : 1;
    deck += quantity;
    if (card.type === 'Curse') continue;
    const numericCost = Number(card.cost ?? 0);
    const cost = card.cost === 'energy' ? 'energy' : Number.isFinite(numericCost) ? Math.max(0, numericCost) : 0;
    cardEntries.push({
      quantity,
      cost,
      metrics: adjustedMetrics(analyzeContentDefinition(card, options), persistentModifiers),
    });
  }
  const support = { attack: 0, defense: 0, sustain: 0, draw: 0, energy: 0 };
  for (const { analysis } of supportAnalyses) {
    const metrics = adjustedMetrics(analysis, persistentModifiers);
    for (const key of Object.keys(support) as ContentMetric[]) support[key] += metrics[key];
  }
  for (const analysis of activeStatusAnalyses) {
    const metrics = adjustedMetrics(analysis, persistentModifiers);
    for (const key of Object.keys(support) as ContentMetric[]) support[key] += metrics[key];
  }
  if (pack.desireEffects.player) {
    const desire = adjustedMetrics(analyzeContentDefinition(pack.desireEffects.player, options), persistentModifiers);
    for (const key of Object.keys(support) as ContentMetric[]) support[key] += desire[key] * CONTENT_DESIRE_EFFECT_WEIGHT;
  }
  const baseEnergy =
    typeof analysisOptions.selfMaxEnergy === 'number' && Number.isFinite(analysisOptions.selfMaxEnergy)
      ? Math.max(0, analysisOptions.selfMaxEnergy)
      : DEFAULT_TURN_ENERGY;
  const firstPass = estimatePlayableCardMetrics(cardEntries, deck, BASE_HAND_SIZE, baseEnergy);
  const effectiveHandSize = Math.min(
    MAX_HAND_SIZE,
    BASE_HAND_SIZE + Math.max(0, firstPass.draw + support.draw),
  );
  const effectiveEnergy =
    baseEnergy +
    Math.min(MAX_ESTIMATED_EXTRA_ENERGY, Math.max(0, firstPass.energy + support.energy));
  const playable = estimatePlayableCardMetrics(cardEntries, deck, effectiveHandSize, effectiveEnergy);
  return {
    deck,
    attack: playable.attack + support.attack,
    defense: playable.defense + support.defense,
    sustain: playable.sustain + support.sustain,
    draw: playable.draw + support.draw,
    energy: playable.energy + support.energy,
    hp: Math.max(0, Math.round(finiteNumber(player.hp))),
    maxHp: Math.max(1, Math.round(finiteNumber(player.maxHp) || 1)),
  };
}

function roundBuildBudget(raw: RawBuildBudget): BuildBudget {
  return {
    deck: Math.round(raw.deck),
    attack: Math.round(raw.attack),
    defense: Math.round(raw.defense),
    sustain: Math.round(raw.sustain),
    draw: Math.round(raw.draw),
    energy: Math.round(raw.energy),
    hp: Math.max(0, Math.round(raw.hp)),
    maxHp: Math.max(1, Math.round(raw.maxHp || 1)),
  };
}

function rangeBuildBudget(
  values: readonly RawBuildBudget[],
  scenarios: readonly { weight: number }[],
): BuildBudgetScenarioRange {
  if (values.length === 0) {
    const empty = roundBuildBudget({
      deck: 0,
      attack: 0,
      defense: 0,
      sustain: 0,
      draw: 0,
      energy: 0,
      hp: 0,
      maxHp: 1,
    });
    return { expected: empty, min: empty, max: empty };
  }
  const expectedRaw = values.reduce(
    (total, value, index) => {
      const weight = scenarios[index]?.weight ?? 0;
      (Object.keys(total) as Array<keyof RawBuildBudget>).forEach(key => (total[key] += value[key] * weight));
      return total;
    },
    { deck: 0, attack: 0, defense: 0, sustain: 0, draw: 0, energy: 0, hp: 0, maxHp: 0 } as RawBuildBudget,
  );
  const minRaw = { ...values[0] };
  const maxRaw = { ...values[0] };
  (Object.keys(minRaw) as Array<keyof RawBuildBudget>).forEach(key => {
    minRaw[key] = Math.min(...values.map(value => value[key]));
    maxRaw[key] = Math.max(...values.map(value => value[key]));
  });
  return { expected: roundBuildBudget(expectedRaw), min: roundBuildBudget(minRaw), max: roundBuildBudget(maxRaw) };
}

/** Estimate one five-card hand. This is a short generation hint, not a combat simulation. */
export function summarizeBuildBudget(pack: ContentPack, player: { hp: number; maxHp: number }): BuildBudget {
  return summarizeBuildBudgetScenarios(pack, player).expected;
}

/** Evaluate the whole build against the same detached scenarios used by content analysis. */
export function summarizeBuildBudgetScenarios(
  pack: ContentPack,
  player: { hp: number; maxHp: number },
): BuildBudgetScenarioRange {
  const options: ContentAnalysisOptions = {
    selfHp: finiteNumber(player.hp),
    selfMaxHp: finiteNumber(player.maxHp) || 1,
  };
  const scenarios = getContentAnalysisScenarios(options);
  const values = scenarios.map(scenario => rawBuildBudgetAtScenario(pack, player, scenario.options));
  return rangeBuildBudget(values, scenarios);
}

export function formatBuildBudget(budget: BuildBudget): string {
  return `deck=${budget.deck} atk=${budget.attack} def=${budget.defense} heal=${budget.sustain} draw=${budget.draw} energy=${budget.energy} hp=${budget.hp}/${budget.maxHp}`;
}
