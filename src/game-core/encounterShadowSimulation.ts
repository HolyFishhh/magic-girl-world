import { analyzeContentScenarios, type ContentAnalysis } from './contentAnalysis';
import { type ContentDefinition, type ContentPack } from './contentPack';
import { createContentMechanicsFingerprint } from './contentFingerprint';
import { extractContentMechanicFeatures, mergeContentMechanicFeatures } from './contentMechanicFeatures';
import { createBattleRandomState, drawBattleRandom, stableHash32, type BattleRandomState } from './deterministicRandom';
import { selectEnemyAction } from './enemyActionSelector';
import {
  applyCardResourcePayment,
  applyResourcePoolToStates,
  estimateCardCostWeight,
  normalizeCombatResourceStates,
  refreshCombatResourceStates,
  resolveCardResourcePayment,
  resourcePoolFromCombatant,
  validateCardCost,
  type CardCost,
  type CardResourcePayment,
  type CombatResourceState,
} from './combatResource';

export type ShadowStrategy = 'aggressive' | 'survival' | 'engine' | 'random';

export interface ShadowStrategyResult {
  strategy: ShadowStrategy;
  runs: number;
  wins: number;
  winRate: number;
  winRateLow: number;
  winRateHigh: number;
  medianTurns: number;
  p90Turns: number;
  medianHpRatio: number;
  noPlayableTurnRate: number;
  horizons: Record<ShadowHorizonTurn, ShadowHorizonSummary>;
}

export type ShadowHorizonTurn = 1 | 2 | 3 | 5 | 8;

export interface ShadowDistribution {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface ShadowHorizonSummary {
  hpDamage: ShadowDistribution;
  lustPressure: ShadowDistribution;
  mitigation: ShadowDistribution;
  healing: ShadowDistribution;
  cardsSeen: ShadowDistribution;
  energySurplus: ShadowDistribution;
  deadDrawRate: number;
}

export interface EncounterShadowSimulation {
  spec: 'mwg.encounter-shadow/v1';
  confidence: 'low' | 'medium' | 'high';
  seeds: number;
  strategies: ShadowStrategyResult[];
  skilledWinRate: number;
  greedyWinRate: number;
  strategySpread: number;
  coverage: ShadowSimulationCoverage;
}

export interface ShadowSimulationCoverage {
  supportedFeatures: string[];
  approximatedFeatures: string[];
  unsupportedFeatures: string[];
  coverageRatio: number;
}

type SimCard = {
  id: string;
  shuffleKey: string;
  cost: CardCost;
  playable: boolean;
  raw: ContentDefinition;
  analysis: ContentAnalysis;
  engineScore: number;
  exhaust: boolean;
};

type SimEnemy = {
  hp: number;
  maxHp: number;
  lust: number;
  maxLust: number;
  block: number;
  raw: Record<string, any>;
  compiled: CompiledEnemy;
};

type RunResult = {
  win: boolean;
  turns: number;
  hpRatio: number;
  noPlayableTurns: number;
  horizons: Record<ShadowHorizonTurn, ShadowRunHorizon>;
};

type ShadowRunHorizon = {
  hpDamage: number;
  lustPressure: number;
  mitigation: number;
  healing: number;
  cardsSeen: number;
  energySurplus: number;
  deadDrawTurns: number;
  observedTurns: number;
};

type CompiledEnemy = {
  definition: ContentDefinition;
  actionAnalyses: Map<ContentDefinition, ContentAnalysis>;
  desire: ContentAnalysis | null;
};

type CompiledEncounter = {
  cards: SimCard[];
  enemies: CompiledEnemy[];
  playerDesire: ContentAnalysis | null;
  playerResources: Record<string, CombatResourceState>;
};

const STRATEGIES: readonly ShadowStrategy[] = ['aggressive', 'survival', 'engine', 'random'];
const SHADOW_HORIZONS = [1, 2, 3, 5, 8] as const;
const MAX_TURNS = 16;
const MAX_CARD_PLAYS_PER_TURN = 24;
const simulationCache = new Map<string, EncounterShadowSimulation>();

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(Math.ceil(probability * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[index];
}

function distribution(values: readonly number[]): ShadowDistribution {
  return {
    mean: round(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0),
    p10: round(quantile(values, 0.1)),
    p50: round(quantile(values, 0.5)),
    p90: round(quantile(values, 0.9)),
  };
}

function summarizeHorizons(runs: readonly RunResult[]): Record<ShadowHorizonTurn, ShadowHorizonSummary> {
  return Object.fromEntries(SHADOW_HORIZONS.map(turn => {
    const values = runs.map(run => run.horizons[turn]);
    const observedTurns = values.reduce((sum, value) => sum + value.observedTurns, 0);
    return [turn, {
      hpDamage: distribution(values.map(value => value.hpDamage)),
      lustPressure: distribution(values.map(value => value.lustPressure)),
      mitigation: distribution(values.map(value => value.mitigation)),
      healing: distribution(values.map(value => value.healing)),
      cardsSeen: distribution(values.map(value => value.cardsSeen)),
      energySurplus: distribution(values.map(value => value.energySurplus)),
      deadDrawRate: round(
        observedTurns > 0
          ? values.reduce((sum, value) => sum + value.deadDrawTurns, 0) / observedTurns
          : 0,
      ),
    } satisfies ShadowHorizonSummary];
  })) as Record<ShadowHorizonTurn, ShadowHorizonSummary>;
}

function wilson(wins: number, runs: number): [number, number] {
  if (runs <= 0) return [0, 1];
  const z = 1.96;
  const rate = wins / runs;
  const denominator = 1 + (z * z) / runs;
  const center = (rate + (z * z) / (2 * runs)) / denominator;
  const margin =
    (z / denominator) * Math.sqrt((rate * (1 - rate)) / runs + (z * z) / (4 * runs * runs));
  return [clamp(center - margin, 0, 1), clamp(center + margin, 0, 1)];
}

function randomReader(seed: number): { random: () => number; state: () => BattleRandomState } {
  let current = createBattleRandomState(seed >>> 0);
  return {
    random: () => {
      const draw = drawBattleRandom(current);
      current = draw.state;
      return draw.value;
    },
    state: () => current,
  };
}

function shuffleCards(values: readonly SimCard[], seed: number, generation: number): SimCard[] {
  const occurrences = new Map<string, number>();
  return values
    .map(card => {
      const occurrence = occurrences.get(card.shuffleKey) || 0;
      occurrences.set(card.shuffleKey, occurrence + 1);
      return {
        card,
        occurrence,
        key: stableHash32(['mwg.shadow.card-order/v1', seed, generation, card.shuffleKey, occurrence]),
      };
    })
    .sort((left, right) => left.key - right.key || left.card.id.localeCompare(right.card.id) || left.occurrence - right.occurrence)
    .map(entry => entry.card);
}

function resourceAnalysisOptions(
  states: Readonly<Record<string, CombatResourceState>>,
  pool?: Readonly<Record<string, number>>,
  payment?: CardResourcePayment,
) {
  const current = Object.fromEntries(Object.entries(states).map(([id, resource]) => [
    id,
    pool?.[id] ?? resource.current,
  ]));
  return {
    selfEnergy: pool?.energy ?? 3,
    selfMaxEnergy: 3,
    selfResources: current,
    selfMaxResources: Object.fromEntries(Object.entries(states).map(([id, resource]) => [id, resource.max])),
    ...(payment
      ? {
          spentEnergy: payment.spentEnergy,
          spentResources: payment.spent,
          xValues: payment.xValues,
          xValue: payment.xValue,
        }
      : {}),
  };
}

function simCards(pack: ContentPack, playerResources: Readonly<Record<string, CombatResourceState>>): SimCard[] {
  const cards: SimCard[] = [];
  for (const definition of pack.cards) {
    const quantity = Number.isInteger(definition.quantity) && Number(definition.quantity) > 0
      ? Math.min(40, Number(definition.quantity))
      : 1;
    const analysis = analyzeContentScenarios(definition, resourceAnalysisOptions(playerResources));
    const rawCost = definition.cost ?? 0;
    const costError = validateCardCost(rawCost);
    const cost = (costError ? 0 : rawCost) as CardCost;
    const engineScore =
      analysis.metrics.draw * 2 +
      analysis.metrics.energy * 2 +
      analysis.tags.filter(tag => tag.startsWith('状态:') || ['弃牌', '生成牌', '取回', '预见', '检索', '能力'].includes(tag)).length * 2;
    for (let index = 0; index < quantity; index += 1) {
      cards.push({
        id: String(definition.id || definition.name || `card_${cards.length}`),
        // Presentation names and author IDs must not change the sampled draw
        // sequence of a mechanically identical deck.
        shuffleKey: createContentMechanicsFingerprint(definition),
        cost,
        // Curses and malformed cards still occupy draw slots. Excluding them
        // made deck pollution look stronger by silently thinning the deck.
        playable: definition.type !== 'Curse' && !costError,
        raw: definition,
        analysis,
        engineScore,
        exhaust: definition.exhaust === true,
      });
    }
  }
  return cards;
}

function meaningfulEnemies(pack: ContentPack): ContentDefinition[] {
  const candidates = pack.enemies?.length ? pack.enemies : pack.enemy ? [pack.enemy] : [];
  return candidates.filter(enemy =>
    Boolean(String(enemy.id || enemy.name || '').trim()) &&
    (Number(enemy.max_hp) > 0 || (Array.isArray(enemy.actions) && enemy.actions.length > 0)),
  );
}

function compileEncounter(pack: ContentPack): CompiledEncounter | null {
  const enemyDefinitions = meaningfulEnemies(pack);
  const playerResources = normalizeCombatResourceStates(pack.playerResources || []);
  const cards = simCards(pack, playerResources);
  if (enemyDefinitions.length === 0 || cards.length === 0) return null;
  const enemies = enemyDefinitions.map(definition => {
    const actions = Array.isArray(definition.actions)
      ? definition.actions.filter((entry): entry is ContentDefinition => isRecord(entry))
      : [];
    return {
      definition,
      actionAnalyses: new Map(actions.map(action => [action, analyzeContentScenarios(action)])),
      desire: isRecord(definition.lust_effect) ? analyzeContentScenarios(definition.lust_effect) : null,
    } satisfies CompiledEnemy;
  });
  return {
    cards,
    enemies,
    playerDesire: pack.desireEffects.player ? analyzeContentScenarios(pack.desireEffects.player) : null,
    playerResources,
  };
}

function createEnemy(compiled: CompiledEnemy): SimEnemy {
  const definition = compiled.definition;
  const maxHp = Math.max(1, Number(definition.max_hp) || Number(definition.hp) || 1);
  const maxLust = Math.max(1, Number(definition.max_lust) || 100);
  return {
    hp: clamp(Number(definition.hp ?? maxHp), 0, maxHp),
    maxHp,
    lust: clamp(Number(definition.lust) || 0, 0, maxLust),
    maxLust,
    block: 0,
    compiled,
    raw: {
      ...definition,
      actions: Array.isArray(definition.actions) ? definition.actions : [],
      actionMode: String(definition.action_mode || 'random'),
      actionConfig: isRecord(definition.action_config) ? definition.action_config : {},
      _sequenceIndex: 0,
      _sequenceDoneOnce: false,
    },
  };
}

function payCost(card: SimCard, resources: Readonly<Record<string, number>>): CardResourcePayment | null {
  if (!card.playable) return null;
  const payment = resolveCardResourcePayment(card.cost, resources, undefined);
  return payment.affordable ? payment : null;
}

function analyzePaidCard(
  card: SimCard,
  resourceStates: Readonly<Record<string, CombatResourceState>>,
  resources: Readonly<Record<string, number>>,
  payment: CardResourcePayment,
): ContentAnalysis {
  return analyzeContentScenarios(card.raw, resourceAnalysisOptions(resourceStates, resources, payment));
}

function combineAnalyses(values: readonly ContentAnalysis[]): ContentAnalysis {
  const metrics = { attack: 0, defense: 0, sustain: 0, draw: 0, energy: 0 };
  const dynamicMetrics = new Set<keyof typeof metrics>();
  let damage = 0;
  let lust = 0;
  let damageKnown = true;
  for (const value of values) {
    (Object.keys(metrics) as (keyof typeof metrics)[]).forEach(key => {
      metrics[key] += value.metrics[key];
    });
    value.dynamicMetrics.forEach(metric => dynamicMetrics.add(metric));
    damage += value.damage;
    lust += value.lust;
    damageKnown &&= value.damageKnown;
  }
  return {
    metrics,
    dynamicMetrics,
    tags: [...new Set(values.flatMap(value => value.tags))],
    statusIds: [...new Set(values.flatMap(value => value.statusIds))],
    modifiers: values.flatMap(value => value.modifiers),
    damage,
    lust,
    damageKnown,
  };
}

function scoreCard(
  card: SimCard,
  analysis: ContentAnalysis,
  strategy: ShadowStrategy,
  expectedIncoming: ContentAnalysis,
  playerHp: number,
  playerMaxHp: number,
  resources: Readonly<Record<string, number>>,
  random: () => number,
): number {
  const cost = Math.max(0.25, estimateCardCostWeight(card.cost, resources));
  if (strategy === 'random') return random();
  if (strategy === 'aggressive') {
    return (analysis.damage * 3 + analysis.lust + analysis.metrics.draw + analysis.metrics.energy) / cost;
  }
  if (strategy === 'survival') {
    const threatened = expectedIncoming.damage >= playerHp * 0.2 || playerHp / Math.max(1, playerMaxHp) < 0.4;
    return (
      (analysis.metrics.defense * (threatened ? 4 : 1.2) +
        analysis.metrics.sustain * (threatened ? 4 : 1) +
        analysis.damage * (threatened ? 0.8 : 2) +
        analysis.lust * 0.5 +
        analysis.metrics.draw +
        analysis.metrics.energy) /
      cost
    );
  }
  return (
    (analysis.damage * 1.8 +
      analysis.lust * 0.7 +
      analysis.metrics.defense +
      analysis.metrics.sustain +
      analysis.metrics.draw * 2 +
      analysis.metrics.energy * 2 +
      card.engineScore * 1.5) /
    cost
  );
}

function applyDamage(amount: number, block: number): { hpLoss: number; block: number } {
  const normalized = Math.max(0, amount);
  const absorbed = Math.min(block, normalized);
  return { hpLoss: normalized - absorbed, block: Math.max(0, block - absorbed) };
}

type ShadowTargetSelector = { mode: string; count?: number; id?: string };

function findOperationTargetSelectors(value: unknown, operation: 'damage' | 'lust', result: ShadowTargetSelector[] = []): ShadowTargetSelector[] {
  if (Array.isArray(value)) {
    value.forEach(entry => findOperationTargetSelectors(entry, operation, result));
    return result;
  }
  if (!isRecord(value)) return result;
  if (value[operation] !== undefined && isRecord(value.targets) && typeof value.targets.mode === 'string') {
    result.push({
      mode: value.targets.mode,
      ...(Number.isInteger(value.targets.count) ? { count: value.targets.count } : {}),
      ...(typeof value.targets.id === 'string' ? { id: value.targets.id } : {}),
    });
  }
  Object.values(value).forEach(entry => findOperationTargetSelectors(entry, operation, result));
  return result;
}

function selectShadowTargets(
  enemies: readonly SimEnemy[],
  selector: ShadowTargetSelector | undefined,
  random: () => number,
): SimEnemy[] {
  const living = enemies.filter(enemy => enemy.hp > 0);
  if (!living.length) return [];
  if (!selector || selector.mode === 'active') return [living[0]];
  if (selector.mode === 'all') return living;
  if (selector.mode === 'by_id') {
    const selected = living.find(enemy => String(enemy.raw.id || '') === selector.id);
    return selected ? [selected] : [];
  }
  if (selector.mode === 'lowest_hp') return [[...living].sort((left, right) => left.hp - right.hp)[0]];
  if (selector.mode === 'highest_hp') return [[...living].sort((left, right) => right.hp - left.hp)[0]];
  if (selector.mode === 'random' || selector.mode === 'random_n') {
    const pool = [...living];
    const selected: SimEnemy[] = [];
    const count = selector.mode === 'random_n' ? Math.max(1, Math.floor(selector.count || 1)) : 1;
    while (pool.length && selected.length < count) {
      selected.push(pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0]);
    }
    return selected;
  }
  return [living[0]];
}

function drawCards(
  count: number,
  hand: SimCard[],
  drawPile: SimCard[],
  discardPile: SimCard[],
  reshuffle: (cards: readonly SimCard[]) => SimCard[],
): number {
  let drawn = 0;
  for (let index = 0; index < count && hand.length < 10; index += 1) {
    if (drawPile.length === 0 && discardPile.length > 0) {
      drawPile.push(...reshuffle(discardPile.splice(0)));
    }
    const card = drawPile.pop();
    if (!card) break;
    hand.push(card);
    drawn += 1;
  }
  return drawn;
}

function runOne(
  compiled: CompiledEncounter,
  strategy: ShadowStrategy,
  seed: number,
  playerInput: { hp: number; maxHp: number; lust?: number; maxLust?: number },
): RunResult {
  const rng = randomReader(stableHash32(['mwg.shadow.action-order/v1', seed]));
  const random = rng.random;
  const enemies = compiled.enemies.map(createEnemy);
  const playerMaxHp = Math.max(1, Number(playerInput.maxHp) || 1);
  const playerMaxLust = Math.max(1, Number(playerInput.maxLust) || 100);
  let playerHp = clamp(Number(playerInput.hp), 0, playerMaxHp);
  let playerLust = clamp(Number(playerInput.lust) || 0, 0, playerMaxLust);
  let playerBlock = 0;
  let shuffleGeneration = 0;
  const reshuffle = (cards: readonly SimCard[]): SimCard[] =>
    shuffleCards(cards, seed, shuffleGeneration++);
  const drawPile = reshuffle(compiled.cards);
  const discardPile: SimCard[] = [];
  const hand: SimCard[] = [];
  let customResources = structuredClone(compiled.playerResources);
  let noPlayableTurns = 0;
  let hpDamage = 0;
  let lustPressure = 0;
  let mitigation = 0;
  let healing = 0;
  let cardsSeen = 0;
  let lastEnergySurplus = 0;
  const timeline = new Map<number, ShadowRunHorizon>();
  const snapshot = (turn: number, energySurplus: number): void => {
    lastEnergySurplus = Math.max(0, energySurplus);
    timeline.set(turn, {
      hpDamage: round(hpDamage),
      lustPressure: round(lustPressure),
      mitigation: round(mitigation),
      healing: round(healing),
      cardsSeen,
      energySurplus: round(lastEnergySurplus),
      deadDrawTurns: noPlayableTurns,
      observedTurns: turn,
    });
  };
  const finish = (win: boolean, turns: number): RunResult => {
    if (!timeline.has(turns)) snapshot(turns, lastEnergySurplus);
    const terminal = timeline.get(turns)!;
    const horizons = Object.fromEntries(SHADOW_HORIZONS.map(horizon => {
      const observed = Math.min(horizon, turns);
      const exact = timeline.get(observed) || terminal;
      return [horizon, { ...exact, observedTurns: observed }];
    })) as Record<ShadowHorizonTurn, ShadowRunHorizon>;
    return { win, turns, hpRatio: playerHp / playerMaxHp, noPlayableTurns, horizons };
  };

  for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
    playerBlock = 0;
    discardPile.push(...hand.splice(0));
    cardsSeen += drawCards(5, hand, drawPile, discardPile, reshuffle);
    customResources = refreshCombatResourceStates(customResources);
    let resourcePool = resourcePoolFromCombatant(3, customResources);
    const selectedEnemyActions = enemies.filter(enemy => enemy.hp > 0).map((enemy, stableOrder) => {
      const selected = selectEnemyAction(enemy.raw, random);
      enemy.raw._sequenceIndex = selected.state.sequenceIndex;
      enemy.raw._sequenceDoneOnce = selected.state.sequenceDoneOnce;
      return {
        enemy,
        stableOrder,
        analysis: selected.action
          ? enemy.compiled.actionAnalyses.get(selected.action) || analyzeContentScenarios(selected.action)
          : analyzeContentScenarios({}),
      };
    }).sort((left, right) =>
      (Number(right.enemy.compiled.definition.action_priority) || 0) - (Number(left.enemy.compiled.definition.action_priority) || 0) ||
      (Number(right.enemy.compiled.definition.speed) || 0) - (Number(left.enemy.compiled.definition.speed) || 0) ||
      left.stableOrder - right.stableOrder,
    );
    const expectedIncoming = combineAnalyses(selectedEnemyActions.map(entry => entry.analysis));
    let played = 0;
    let hadPlayable = false;

    while (hand.length > 0 && played < MAX_CARD_PLAYS_PER_TURN) {
      const playable = hand
        .map((card, index) => {
          const payment = payCost(card, resourcePool);
          return payment
            ? { card, index, payment, analysis: analyzePaidCard(card, customResources, resourcePool, payment) }
            : null;
        })
        .filter((entry): entry is { card: SimCard; index: number; payment: CardResourcePayment; analysis: ContentAnalysis } => entry !== null);
      if (playable.length === 0) break;
      hadPlayable = true;
      playable.sort((left, right) => {
        const difference =
          scoreCard(right.card, right.analysis, strategy, expectedIncoming, playerHp, playerMaxHp, resourcePool, random) -
          scoreCard(left.card, left.analysis, strategy, expectedIncoming, playerHp, playerMaxHp, resourcePool, random);
        return difference || left.card.id.localeCompare(right.card.id);
      });
      const chosen = playable[0];
      const card = hand.splice(chosen.index, 1)[0];
      resourcePool = applyCardResourcePayment(resourcePool, chosen.payment);
      customResources = applyResourcePoolToStates(customResources, resourcePool);
      const analysis = chosen.analysis;
      const damageSelector = findOperationTargetSelectors(chosen.card.raw, 'damage')[0];
      const lustSelector = findOperationTargetSelectors(chosen.card.raw, 'lust')[0] || damageSelector;
      const damageTargets = selectShadowTargets(enemies, damageSelector, random);
      const lustTargets = selectShadowTargets(enemies, lustSelector, random);
      if (damageTargets.length === 0 && lustTargets.length === 0) return finish(true, turn);
      for (const target of damageTargets) {
        const dealt = applyDamage(analysis.damage, target.block);
        target.block = dealt.block;
        target.hp = Math.max(0, target.hp - dealt.hpLoss);
        hpDamage += dealt.hpLoss;
      }
      for (const target of lustTargets) {
        const previous = target.lust;
        target.lust = clamp(previous + Math.max(0, analysis.lust), 0, target.maxLust);
        lustPressure += target.lust - previous;
      }
      playerBlock += Math.max(0, analysis.metrics.defense);
      const previousHp = playerHp;
      playerHp = clamp(previousHp + Math.max(0, analysis.metrics.sustain), 0, playerMaxHp);
      healing += playerHp - previousHp;
      resourcePool.energy = Math.min(9, (resourcePool.energy || 0) + Math.max(0, Math.floor(analysis.metrics.energy)));
      cardsSeen += drawCards(Math.max(0, Math.floor(analysis.metrics.draw)), hand, drawPile, discardPile, reshuffle);
      if (!card.exhaust) discardPile.push(card);
      played += 1;

      for (const target of lustTargets) {
        if (target.lust >= target.maxLust) {
          target.lust = 0;
          if (compiled.playerDesire) {
            const overflowDamage = applyDamage(compiled.playerDesire.damage, target.block);
            target.block = overflowDamage.block;
            target.hp = Math.max(0, target.hp - overflowDamage.hpLoss);
            hpDamage += overflowDamage.hpLoss;
            playerBlock += Math.max(0, compiled.playerDesire.metrics.defense);
            const previousOverflowHp = playerHp;
            playerHp = clamp(playerHp + Math.max(0, compiled.playerDesire.metrics.sustain), 0, playerMaxHp);
            healing += playerHp - previousOverflowHp;
          }
        }
      }
      lastEnergySurplus = resourcePool.energy || 0;
      if (enemies.every(entry => entry.hp <= 0)) return finish(true, turn);
      if (!hand.some(entry => payCost(entry, resourcePool) !== null)) break;
    }

    if (!hadPlayable) noPlayableTurns += 1;
    for (const { enemy, analysis } of selectedEnemyActions) {
      if (enemy.hp <= 0) continue;
      enemy.block = Math.max(0, analysis.metrics.defense);
      enemy.hp = clamp(enemy.hp + Math.max(0, analysis.metrics.sustain), 0, enemy.maxHp);
      const incoming = applyDamage(analysis.damage, playerBlock);
      mitigation += Math.max(0, playerBlock - incoming.block);
      playerBlock = incoming.block;
      playerHp = Math.max(0, playerHp - incoming.hpLoss);
      playerLust = clamp(playerLust + Math.max(0, analysis.lust), 0, playerMaxLust);
      if (playerLust >= playerMaxLust) {
        playerLust = 0;
        if (enemy.compiled.desire) {
          const overflow = applyDamage(enemy.compiled.desire.damage, playerBlock);
          mitigation += Math.max(0, playerBlock - overflow.block);
          playerBlock = overflow.block;
          playerHp = Math.max(0, playerHp - overflow.hpLoss);
        }
      }
      if (playerHp <= 0) return finish(false, turn);
    }
    snapshot(turn, resourcePool.energy || 0);
  }
  return finish(enemies.every(enemy => enemy.hp <= 0), MAX_TURNS);
}

function simulationCoverage(pack: ContentPack): ShadowSimulationCoverage {
  const enemies = meaningfulEnemies(pack);
  const definitions = [
    ...pack.cards,
    ...pack.statuses,
    ...pack.relics,
    ...pack.items,
    ...pack.abilities,
    ...pack.activeStatuses,
    ...(pack.desireEffects.player ? [pack.desireEffects.player] : []),
    ...enemies.flatMap(enemy => [
      ...(Array.isArray(enemy.actions) ? enemy.actions : []),
      ...(Array.isArray(enemy.abilities) ? enemy.abilities : []),
      ...(enemy.lust_effect && typeof enemy.lust_effect === 'object' ? [enemy.lust_effect] : []),
    ]),
  ];
  const features = mergeContentMechanicFeatures(definitions.map(extractContentMechanicFeatures));
  const supported = new Set([
    'damage', 'heal', 'block', 'energy', 'lust', 'resource', 'set_resource', 'draw',
    'x_cost', 'x_formula',
  ]);
  const approximated = new Set([
    'scry', 'seek', 'recover', 'reduce_cost', 'discard', 'exhaust', 'condition', 'history_formula',
  ]);
  const ignored = new Set(['narrate']);
  const unsupported = new Set([
    'apply_status', 'remove_status', 'trigger', 'modify', 'modify_card', 'patch_card', 'attach_card',
    'upgrade_card', 'copy', 'double', 'auto_play', 'card_destination', 'move_card', 'remove_card',
    'transform_card', 'add_card', 'ensure_card', 'card_rule', 'schedule', 'execute', 'kill', 'stance',
    'channel_orb', 'evoke_orb', 'orb_slots', 'modify_orb', 'extra_turn', 'end_turn', 'spawn_summon', 'spawn_enemy',
    'damage_summon', 'heal_summon', 'modify_summon', 'modify_summon_effect', 'summon_resource', 'set_summon_resource',
    'apply_summon_status', 'remove_summon_status', 'activate_summon', 'dismiss_summon', 'copy_summon',
    'enchantment', 'affliction', 'curse', 'container_formula',
  ]);
  const observed = features.operations.filter(operation => !ignored.has(operation));
  const supportedFeatures = observed.filter(operation => supported.has(operation));
  const approximatedFeatures = observed.filter(operation => approximated.has(operation));
  const unsupportedFeatures = observed.filter(operation => unsupported.has(operation) || (!supported.has(operation) && !approximated.has(operation)));
  if (enemies.length > 1) supportedFeatures.push('multi_enemy_order');
  if (features.targets.some(target => ['all', 'random', 'random_n', 'lowest_hp', 'highest_hp', 'by_id'].includes(target))) {
    supportedFeatures.push('enemy_target_selector');
  }
  const total = supportedFeatures.length + approximatedFeatures.length + unsupportedFeatures.length;
  return {
    supportedFeatures: [...new Set(supportedFeatures)].sort(),
    approximatedFeatures: [...new Set(approximatedFeatures)].sort(),
    unsupportedFeatures: [...new Set(unsupportedFeatures)].sort(),
    coverageRatio: round(total ? (supportedFeatures.length + approximatedFeatures.length * 0.5) / total : 1),
  };
}

function simulationConfidence(coverage: ShadowSimulationCoverage): EncounterShadowSimulation['confidence'] {
  if (coverage.unsupportedFeatures.length === 0 && coverage.coverageRatio >= 0.85) return 'high';
  if (coverage.coverageRatio >= 0.55) return 'medium';
  return 'low';
}

/**
 * Deterministic shadow estimate using the shared effect analyzer and enemy selector.
 * It is deliberately advisory: complex triggers/statuses lower confidence instead of being guessed as exact runtime behavior.
 */
export function simulateEncounterShadow(input: {
  pack: ContentPack;
  player: { hp: number; maxHp: number; lust?: number; maxLust?: number };
  seeds?: number;
  strategies?: readonly ShadowStrategy[];
}): EncounterShadowSimulation | null {
  const compiled = compileEncounter(input.pack);
  if (!compiled) return null;
  const seeds = Math.max(8, Math.min(256, Math.floor(input.seeds ?? 64)));
  const mechanicsFingerprint = createContentMechanicsFingerprint(input.pack);
  const requestedStrategies = [...new Set(input.strategies?.filter(value => STRATEGIES.includes(value)) || STRATEGIES)];
  const activeStrategies = requestedStrategies.length ? requestedStrategies : [...STRATEGIES];
  const cacheKey = [
    mechanicsFingerprint,
    Number(input.player.hp) || 0,
    Number(input.player.maxHp) || 0,
    Number(input.player.lust) || 0,
    Number(input.player.maxLust) || 0,
    seeds,
    activeStrategies.join(','),
  ].join(':');
  const cached = simulationCache.get(cacheKey);
  if (cached) return cached;
  // Use common random numbers across different decks. The mechanics
  // fingerprint still scopes the cache, but it must not choose a completely
  // different shuffle sample for every card added or removed; otherwise
  // random-seed drift can be mistaken for marginal deck power.
  const baseSeed = stableHash32('mwg.encounter-shadow/common-random-v1');
  const strategies = activeStrategies.map(strategy => {
    const runs: RunResult[] = [];
    for (let index = 0; index < seeds; index += 1) {
      runs.push(runOne(compiled, strategy, stableHash32([baseSeed, strategy, index]), input.player));
    }
    const wins = runs.filter(run => run.win).length;
    const interval = wilson(wins, seeds);
    return {
      strategy,
      runs: seeds,
      wins,
      winRate: round(wins / seeds),
      winRateLow: round(interval[0]),
      winRateHigh: round(interval[1]),
      medianTurns: quantile(runs.map(run => run.turns), 0.5),
      p90Turns: quantile(runs.map(run => run.turns), 0.9),
      medianHpRatio: round(quantile(runs.map(run => run.hpRatio), 0.5)),
      noPlayableTurnRate: round(
        runs.reduce((sum, run) => sum + run.noPlayableTurns / Math.max(1, run.turns), 0) / seeds,
      ),
      horizons: summarizeHorizons(runs),
    } satisfies ShadowStrategyResult;
  });
  const byStrategy = new Map(strategies.map(result => [result.strategy, result]));
  const skilledWinRate = byStrategy.get('engine')?.winRate ?? Math.max(0, ...strategies.map(result => result.winRate));
  const greedyWinRate = byStrategy.get('aggressive')?.winRate ?? strategies[0]?.winRate ?? 0;
  const rates = strategies.map(result => result.winRate);
  const coverage = simulationCoverage(input.pack);
  const result: EncounterShadowSimulation = {
    spec: 'mwg.encounter-shadow/v1',
    confidence: simulationConfidence(coverage),
    seeds,
    strategies,
    skilledWinRate,
    greedyWinRate,
    strategySpread: round(Math.max(...rates) - Math.min(...rates)),
    coverage,
  };
  simulationCache.set(cacheKey, result);
  while (simulationCache.size > 32) simulationCache.delete(simulationCache.keys().next().value as string);
  return result;
}
