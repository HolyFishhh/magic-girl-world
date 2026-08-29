/**
 * One host-neutral pass over a shallow content definition.
 *
 * Budgeting, build guidance, and enemy diagnostics must observe the same
 * numeric literals and formula-driven fields. Modern effects are evaluated
 * against a detached representative state; no host or runtime state is read.
 */

import { compileCompactEffectList } from './compactEffectDsl';
import { stableHash32, stableSerialize } from './deterministicRandom';
import { isOuterLifecycleTrigger, REGISTERABLE_EFFECT_TRIGGER_SET } from './battleTriggers';
import { resolveTriggerInput } from './triggerInput';
import { isCompactEffectList, normalizeCompactEffectEntries } from './compactEffectContract';
import {
  normalizeCardCost,
  resolveCardResourcePayment,
  type CardCost,
} from './combatResource';
import {
  EFFECT_PROGRAM_SPEC,
  executeEffectProgram,
  type CoreEffectEvent,
  type CoreEffectState,
  type EffectModifierOperator,
  type EffectNode,
  type EffectProgram,
  type EffectTarget,
  type ModifierStat,
} from './effectDsl';

export type ContentMetric = 'attack' | 'defense' | 'sustain' | 'draw' | 'energy';

/** One-time desire overflow is useful, but less frequent than a normal hand effect. */
export const CONTENT_DESIRE_EFFECT_WEIGHT = 0.5;

export interface ContentAnalysis {
  metrics: Record<ContentMetric, number>;
  dynamicMetrics: Set<ContentMetric>;
  tags: string[];
  statusIds: string[];
  modifiers: ContentModifier[];
  damage: number;
  /** Raw outgoing desire amount, kept separate so lust modifiers are not applied to HP damage. */
  lust: number;
  damageKnown: boolean;
}

/** Shared positive-or-dynamic metric predicate for budgets and diagnostics. */
export function hasContentMetric(
  analysis: Pick<ContentAnalysis, 'metrics' | 'dynamicMetrics'>,
  metric: ContentMetric,
): boolean {
  return Number(analysis.metrics[metric] ?? 0) > 0 || analysis.dynamicMetrics.has(metric);
}

export interface ContentModifier {
  target: EffectTarget;
  stat: ModifierStat;
  operator: EffectModifierOperator;
  value: number;
}

export interface ContentAnalysisOptions {
  /** Relative side that represents the enemy entity collection for source-aware analysis. */
  enemyCollectionTarget?: EffectTarget;
  statusStacks?: Readonly<Record<string, number>>;
  selfStatusStacks?: Readonly<Record<string, number>>;
  opponentStatusStacks?: Readonly<Record<string, number>>;
  currentStatusStacks?: number;
  spentEnergy?: number;
  /** Exact payment context for composite and custom-resource costs. */
  spentResources?: Readonly<Record<string, number>>;
  /** Exact X values resolved from every `all` cost component. */
  xValues?: Readonly<Record<string, number>>;
  xValue?: number;
  /** Optional detached-state overrides used by the shared scenario sampler. */
  selfHp?: number;
  selfMaxHp?: number;
  opponentHp?: number;
  opponentMaxHp?: number;
  selfEnergy?: number;
  selfMaxEnergy?: number;
  selfResources?: Readonly<Record<string, number>>;
  selfMaxResources?: Readonly<Record<string, number>>;
  opponentResources?: Readonly<Record<string, number>>;
  opponentMaxResources?: Readonly<Record<string, number>>;
  currentTurn?: number;
  cardsPlayedThisTurn?: number;
  attacksPlayedThisTurn?: number;
  skillsPlayedThisTurn?: number;
}

export interface ContentScenarioRange {
  expected: ContentAnalysis;
  min: Record<ContentMetric, number>;
  max: Record<ContentMetric, number>;
  damageMin: number;
  damageMax: number;
  lustMin: number;
  lustMax: number;
}

type Definition = Readonly<Record<string, any>>;

const METRIC_KEYS: Readonly<Record<string, ContentMetric>> = {
  damage: 'attack',
  block: 'defense',
  heal: 'sustain',
  draw: 'draw',
  energy: 'energy',
};

const TRIGGER_WEIGHTS: Readonly<Record<string, number>> = {
  battle_start: 0.25,
  ability_gain: 0.25,
  turn_start: 1,
  turn_end: 1,
  card_played: 2,
  attack_played: 1,
  skill_played: 1,
  power_played: 0.25,
  on_discard: 0.5,
  on_exhaust: 0.5,
  on_draw: 0.75,
  on_shuffle: 0.35,
  take_damage: 0.75,
  take_heal: 0.5,
  deal_damage: 0.75,
  deal_heal: 0.5,
  lust_increase: 0.5,
  lust_decrease: 0.5,
  deal_lust_increase: 0.5,
  deal_lust_decrease: 0.5,
  gain_block: 0.5,
  lose_block: 0.5,
  gain_buff: 0.35,
  gain_debuff: 0.35,
  lose_buff: 0.35,
  lose_debuff: 0.35,
  enemy_gain_buff: 0.35,
  enemy_gain_debuff: 0.35,
  enemy_lose_buff: 0.35,
  enemy_lose_debuff: 0.35,
  apply: 0.25,
  stack: 0.5,
  tick: 1,
  remove: 0.25,
  hold: 1,
  passive: 1,
};

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numericLiteral(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function addMetric(metrics: Record<ContentMetric, number>, key: ContentMetric, value: number): void {
  metrics[key] += value;
}

function representativeState(options: ContentAnalysisOptions): CoreEffectState {
  const sharedStatusStacks = { ...(options.statusStacks || {}) };
  const selfMaxHp = finiteStateNumber(options.selfMaxHp, 100, 1);
  const opponentMaxHp = finiteStateNumber(options.opponentMaxHp, 1000, 1);
  const selfMaxEnergy = finiteStateNumber(options.selfMaxEnergy, 3, 0);
  return {
    self: {
      hp: clampStateNumber(options.selfHp, selfMaxHp * 0.5, 0, selfMaxHp),
      maxHp: selfMaxHp,
      lust: 0,
      maxLust: 100,
      energy: clampStateNumber(options.selfEnergy, selfMaxEnergy, 0, selfMaxEnergy),
      maxEnergy: selfMaxEnergy,
      block: 0,
      handSize: 5,
      drawPileSize: 5,
      discardPileSize: 0,
      exhaustPileSize: 0,
      statusStacks: { ...sharedStatusStacks, ...(options.selfStatusStacks || {}) },
      resources: { ...(options.selfResources || {}) },
      maxResources: { ...(options.selfMaxResources || options.selfResources || {}) },
    },
    opponent: {
      hp: clampStateNumber(options.opponentHp, opponentMaxHp, 0, opponentMaxHp),
      maxHp: opponentMaxHp,
      lust: 0,
      maxLust: 100,
      energy: 3,
      maxEnergy: 3,
      block: 0,
      statusStacks: { ...sharedStatusStacks, ...(options.opponentStatusStacks || {}) },
      resources: { ...(options.opponentResources || {}) },
      maxResources: { ...(options.opponentMaxResources || options.opponentResources || {}) },
    },
    currentTurn: clampStateNumber(options.currentTurn, 2, 1, 999),
    cardsPlayedThisTurn: clampStateNumber(options.cardsPlayedThisTurn, 1, 0, 100),
    attacksPlayedThisTurn: clampStateNumber(options.attacksPlayedThisTurn, 1, 0, 100),
    skillsPlayedThisTurn: clampStateNumber(options.skillsPlayedThisTurn, 1, 0, 100),
  };
}

function finiteStateNumber(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function clampStateNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finiteStateNumber(value, fallback, minimum)));
}

function emptyAnalysis(): ContentAnalysis {
  return {
    metrics: { attack: 0, defense: 0, sustain: 0, draw: 0, energy: 0 },
    dynamicMetrics: new Set<ContentMetric>(),
    tags: [],
    statusIds: [],
    modifiers: [],
    damage: 0,
    lust: 0,
    damageKnown: true,
  };
}

function metricForNode(node: EffectNode): ContentMetric | null {
  if (node.op === 'damage' || node.op === 'gain_lust') return node.target === 'opponent' ? 'attack' : null;
  if (node.op === 'heal') return node.target === 'self' ? 'sustain' : null;
  if (node.op === 'gain_block') return node.target === 'self' ? 'defense' : null;
  if (node.op === 'gain_energy') return node.target === 'self' ? 'energy' : null;
  if (node.op === 'draw_cards') return 'draw';
  if (node.op === 'scry_cards') return 'draw';
  if (node.op === 'recover_cards') return 'draw';
  if (node.op === 'reduce_card_cost') return 'energy';
  return null;
}

function collectProgramDynamics(
  nodes: readonly EffectNode[],
  dynamicMetrics: Set<ContentMetric>,
  conditional = false,
): void {
  for (const node of nodes) {
    if (node.op === 'if') {
      collectProgramDynamics(node.then, dynamicMetrics, true);
      collectProgramDynamics(node.else || [], dynamicMetrics, true);
      continue;
    }
    if (node.op === 'register_trigger') {
      collectProgramDynamics(node.effects, dynamicMetrics, conditional);
      continue;
    }
    if (node.op === 'add_card' || node.op === 'ensure_card') {
      collectProgramDynamics(node.card.program.steps, dynamicMetrics, conditional);
      if (node.card.discardProgram) collectProgramDynamics(node.card.discardProgram.steps, dynamicMetrics, true);
      continue;
    }
    const metric = metricForNode(node);
    if (!metric) continue;
    const amount = 'amount' in node ? node.amount : null;
    if (conditional || typeof amount !== 'number') dynamicMetrics.add(metric);
  }
}

function hasUncertainDamage(nodes: readonly EffectNode[], indirect = false): boolean {
  for (const node of nodes) {
    if (node.op === 'damage' && node.target === 'opponent') {
      if (indirect || typeof node.amount !== 'number') return true;
      continue;
    }
    if (node.op === 'if' && hasUncertainDamage([...(node.then || []), ...(node.else || [])], true)) return true;
    if (node.op === 'register_trigger' && hasUncertainDamage(node.effects, true)) return true;
    if (node.op === 'add_card' || node.op === 'ensure_card') {
      if (hasUncertainDamage(node.card.program.steps, true)) return true;
      if (node.card.discardProgram && hasUncertainDamage(node.card.discardProgram.steps, true)) return true;
    }
  }
  return false;
}

export function analyzeEffectProgram(
  program: EffectProgram,
  options: ContentAnalysisOptions = {},
  directWeight = 1,
): ContentAnalysis | null {
  const result = executeEffectProgram(program, representativeState(options), {
    spentEnergy: options.spentEnergy ?? 3,
    spentResources: options.spentResources,
    xValues: options.xValues,
    xValue: options.xValue,
    statusStacks: options.currentStatusStacks,
  });
  if (!result.ok) return null;
  const analysis = emptyAnalysis();
  const consume = (event: CoreEffectEvent): void => {
    if (event.type === 'damage' && event.target === 'opponent') {
      analysis.metrics.attack += event.requested * directWeight;
      analysis.damage += event.requested * directWeight;
    } else if (event.type === 'heal' && event.target === 'self') {
      analysis.metrics.sustain += event.requested * directWeight;
    } else if (event.type === 'gain_block' && event.target === 'self') {
      analysis.metrics.defense += event.amount * directWeight;
    } else if (event.type === 'gain_energy' && event.target === 'self') {
      analysis.metrics.energy += event.amount * directWeight;
    } else if (event.type === 'gain_resource' && event.target === 'self') {
      analysis.metrics.energy += event.amount * directWeight;
      analysis.tags.push(`资源:${event.resource}`);
    } else if (event.type === 'gain_lust' && event.target === 'opponent') {
      analysis.metrics.attack += event.amount * CONTENT_DESIRE_EFFECT_WEIGHT * directWeight;
      analysis.lust += event.amount * directWeight;
    } else if (event.type === 'draw_cards') {
      analysis.metrics.draw += event.amount * directWeight;
    } else if (event.type === 'scry_cards') {
      analysis.metrics.draw += event.amount * 0.25 * directWeight;
    } else if (event.type === 'recover_cards') {
      analysis.metrics.draw += event.amount * (event.source === 'draw' ? 0.75 : 0.5) * directWeight;
    } else if (event.type === 'reduce_card_cost') {
      analysis.metrics.energy += event.amount * Math.max(1, event.selector.count ?? 1) * directWeight;
    } else if (event.type === 'modify') {
      analysis.modifiers.push({
        target: event.target,
        stat: event.stat,
        operator: event.operator,
        value: event.value,
      });
    } else if (event.type === 'register_trigger') {
      const nested = analyzeEffectProgram({ spec: EFFECT_PROGRAM_SPEC, steps: event.effects }, options);
      if (nested) mergeAnalysis(analysis, nested, triggerWeight(event.trigger));
    } else if (event.type === 'add_card' || event.type === 'ensure_card') {
      const nested = analyzeEffectProgram(event.card.program, options);
      const instances = event.type === 'add_card' ? event.count : event.minimum;
      if (nested) mergeAnalysis(analysis, nested, Math.max(1, instances) * 0.35 * directWeight);
    }
  };
  result.events.forEach(consume);
  collectProgramDynamics(program.steps, analysis.dynamicMetrics);
  if (hasUncertainDamage(program.steps)) analysis.damageKnown = false;
  return analysis;
}

function analyzeModernEffects(
  _effects: unknown,
  definition: Definition,
  options: ContentAnalysisOptions,
): ContentAnalysis | null {
  const resolved = resolveTriggerInput(definition);
  const definitionTrigger = typeof resolved.trigger === 'string' ? resolved.trigger : undefined;
  const compileTrigger =
    definitionTrigger && REGISTERABLE_EFFECT_TRIGGER_SET.has(definitionTrigger) ? definitionTrigger : undefined;
  const sources = resolved.structured
    ? [
        ...(resolved.immediateEffects === undefined
          ? []
          : [{ effects: resolved.immediateEffects, trigger: undefined, weight: 1 }]),
        ...(resolved.triggeredEffects === undefined
          ? []
          : [
              {
                effects: resolved.triggeredEffects,
                trigger: compileTrigger,
                weight: definitionTrigger && isOuterLifecycleTrigger(definitionTrigger) ? triggerWeight(definitionTrigger) : 1,
              },
            ]),
      ]
    : [
        {
          effects: resolved.triggeredEffects,
          trigger: compileTrigger,
          weight: definitionTrigger && isOuterLifecycleTrigger(definitionTrigger) ? triggerWeight(definitionTrigger) : 1,
        },
      ];
  let combined: ContentAnalysis | null = null;
  for (const source of sources) {
    const compiled = compileCompactEffectList(source.effects, {
      trigger: source.trigger,
      when: source.trigger ? undefined : definition.when,
      creates: definition.creates,
      enemyCollectionTarget: options.enemyCollectionTarget,
    });
    if (!compiled.ok) return null;
    const analyzed = analyzeEffectProgram(compiled.value, options, source.weight);
    if (!analyzed) return null;
    if (!combined) combined = analyzed;
    else mergeAnalysis(combined, analyzed);
  }
  return combined;
}

function optionsForDefinitionCost(
  definition: Definition,
  options: ContentAnalysisOptions,
): ContentAnalysisOptions {
  if (definition.cost === undefined) return options;
  if (options.spentResources && options.xValues) return options;
  try {
    const selfEnergy = finiteStateNumber(options.selfEnergy, 3, 0);
    const available = { energy: selfEnergy, ...(options.selfResources || {}) };
    const payment = resolveCardResourcePayment(definition.cost as CardCost, available, undefined);
    if (!payment.affordable) return options;
    return {
      ...options,
      spentEnergy: options.spentEnergy ?? payment.spentEnergy,
      spentResources: options.spentResources ?? payment.spent,
      xValues: options.xValues ?? payment.xValues,
      xValue: options.xValue ?? payment.xValue,
    };
  } catch {
    return options;
  }
}

function triggerWeight(value: unknown): number {
  return typeof value === 'string' ? (TRIGGER_WEIGHTS[value] ?? 0.5) : 1;
}

function collectStringStatusIds(value: unknown, result: Set<string>): void {
  if (typeof value !== 'string') return;
  for (const match of value.matchAll(/(?:self|opponent)\.status\.([A-Za-z0-9_]+)\.stacks/g)) {
    result.add(match[1]);
  }
}

function mergeAnalysis(target: ContentAnalysis, source: ContentAnalysis, weight = 1): void {
  (Object.keys(target.metrics) as ContentMetric[]).forEach(metric => {
    target.metrics[metric] += source.metrics[metric] * weight;
  });
  source.dynamicMetrics.forEach(metric => target.dynamicMetrics.add(metric));
  target.tags = [...new Set([...target.tags, ...source.tags])];
  target.statusIds = [...new Set([...target.statusIds, ...source.statusIds])];
  target.modifiers.push(...source.modifiers);
  target.damage += source.damage * weight;
  target.lust += source.lust * weight;
  target.damageKnown &&= source.damageKnown;
}

/** Analyze one shallow card/relic/ability/action without mutating runtime state. */
function analyzeContentDefinitionUncached(value: unknown, options: ContentAnalysisOptions = {}): ContentAnalysis {
  const metrics: Record<ContentMetric, number> = {
    attack: 0,
    defense: 0,
    sustain: 0,
    draw: 0,
    energy: 0,
  };
  const dynamicMetrics = new Set<ContentMetric>();
  const tags = new Set<string>();
  const statusIds = new Set<string>();
  const modifiers: ContentModifier[] = [];
  let damage = 0;
  let lust = 0;
  let damageKnown = true;
  const definition = isRecord(value) ? (value as Definition) : {};
  const resolvedOptions = optionsForDefinitionCost(definition, options);
  const resolvedTrigger = resolveTriggerInput(definition);
  const effects = resolvedTrigger.structured
    ? [
        ...(normalizeCompactEffectEntries(resolvedTrigger.immediateEffects) || []),
        ...(normalizeCompactEffectEntries(resolvedTrigger.triggeredEffects) || []),
      ]
    : normalizeCompactEffectEntries(definition.effects) || [];

  for (const rawEffect of effects) {
    if (!isRecord(rawEffect)) continue;
    for (const [key, metric] of Object.entries(METRIC_KEYS)) {
      if (rawEffect[key] === undefined) continue;
      if (key === 'damage' && rawEffect.to === 'self') continue;
      if (['block', 'heal', 'energy'].includes(key) && rawEffect.to === 'opponent') continue;
      const literal = numericLiteral(rawEffect[key]);
      if (literal === null) dynamicMetrics.add(metric);
      else addMetric(metrics, metric, literal);
      if (key === 'damage') {
        if (literal === null) damageKnown = false;
        else damage += literal;
      }
    }
    if (rawEffect.lust !== undefined && rawEffect.to !== 'self') {
      const literal = numericLiteral(rawEffect.lust);
      if (literal === null) dynamicMetrics.add('attack');
      else {
        addMetric(metrics, 'attack', literal * 0.5);
        lust += literal;
      }
    }
    if (rawEffect.lust_damage !== undefined && rawEffect.to !== 'self') {
      const literal = numericLiteral(rawEffect.lust_damage);
      if (literal === null) dynamicMetrics.add('attack');
      else {
        addMetric(metrics, 'attack', literal * 0.5);
        lust += literal;
      }
    }
    if (typeof rawEffect.apply_status === 'string') tags.add(`状态:${rawEffect.apply_status}`);
    if (rawEffect.discard !== undefined || isCompactEffectList(definition.discard_effects)) tags.add('弃牌');
    if (rawEffect.add_card !== undefined) tags.add('生成牌');
    if (isRecord(rawEffect.attach_card)) {
      tags.add(rawEffect.attach_card.kind === 'enchantment' ? '附魔' : '负面附着');
      const changes = Array.isArray(rawEffect.attach_card.changes) ? rawEffect.attach_card.changes : [];
      if (changes.some((change: unknown) => isRecord(change) && change.kind === 'discard_auto_play')) tags.add('弃牌');
      if (changes.some((change: unknown) => isRecord(change) && ['cost', 'dynamic_cost', 'x_value'].includes(String(change.kind)))) tags.add('能量');
    }
    if (rawEffect.reduce_cost !== undefined || rawEffect.energy !== undefined) tags.add('能量');
    if (isRecord(rawEffect.resource) && typeof rawEffect.resource.id === 'string') tags.add(`资源:${rawEffect.resource.id}`);
    if (isRecord(rawEffect.set_resource) && typeof rawEffect.set_resource.id === 'string') tags.add(`资源:${rawEffect.set_resource.id}`);
    if (rawEffect.reduce_cost !== undefined && numericLiteral(rawEffect.reduce_cost) === null)
      dynamicMetrics.add('energy');
    if (rawEffect.lust !== undefined) tags.add('欲望');
    if (rawEffect.exhaust !== undefined) tags.add('消耗');
    if (rawEffect.recover !== undefined) tags.add('取回');
    if (rawEffect.scry !== undefined) tags.add('预见');
    if (rawEffect.seek !== undefined) tags.add('检索');
    Object.values(rawEffect).forEach(entry => collectStringStatusIds(entry, statusIds));
  }

  const evaluated = analyzeModernEffects(effects, definition, resolvedOptions);
  if (evaluated) {
    (Object.keys(metrics) as ContentMetric[]).forEach(metric => {
      metrics[metric] = evaluated.metrics[metric];
    });
    evaluated.dynamicMetrics.forEach(metric => dynamicMetrics.add(metric));
    modifiers.push(...evaluated.modifiers);
    damage = evaluated.damage;
    lust = evaluated.lust;
    damageKnown &&= evaluated.damageKnown;
  }

  const encodedDefinition = JSON.stringify(definition);
  const costComponents = normalizeCardCost((definition.cost ?? 0) as CardCost);
  if (
    Object.values(costComponents).some(component => component === 'all') ||
    encodedDefinition.includes('spent_energy') ||
    encodedDefinition.includes('x_resource.')
  ) tags.add('X费');
  if (definition.type === 'Power' || resolvedTrigger.trigger !== undefined) tags.add('能力');
  if (definition.retain === true) tags.add('保留');
  if (definition.innate === true) tags.add('固有');
  if (definition.exhaust === true) tags.add('消耗');
  if (isCompactEffectList(definition.discard_effects)) tags.add('弃牌');

  if (isCompactEffectList(definition.discard_effects)) {
    // Discard effects do not inherit the payment context from the card play.
    const discarded = analyzeContentDefinition({ effects: definition.discard_effects }, options);
    const target: ContentAnalysis = {
      metrics,
      dynamicMetrics,
      tags: [...tags],
      statusIds: [...statusIds],
      modifiers,
      damage,
      lust,
      damageKnown,
    };
    mergeAnalysis(target, discarded, TRIGGER_WEIGHTS.on_discard);
    return target;
  }

  return { metrics, dynamicMetrics, tags: [...tags], statusIds: [...statusIds], modifiers, damage, lust, damageKnown };
}

const contentAnalysisCache = new Map<string, ContentAnalysis>();

function contentAnalysisCacheKey(value: unknown, options: ContentAnalysisOptions): string {
  const serialized = stableSerialize([value, options]);
  return `analysis1:${stableHash32(serialized).toString(36)}:${serialized.length}`;
}

/** Analyze one shallow definition with a bounded mechanics/state cache. */
export function analyzeContentDefinition(value: unknown, options: ContentAnalysisOptions = {}): ContentAnalysis {
  const key = contentAnalysisCacheKey(value, options);
  const cached = contentAnalysisCache.get(key);
  if (cached) return cached;
  const result = analyzeContentDefinitionUncached(value, options);
  contentAnalysisCache.set(key, result);
  while (contentAnalysisCache.size > 2048) {
    contentAnalysisCache.delete(contentAnalysisCache.keys().next().value as string);
  }
  return result;
}

export function clearContentAnalysisCache(): void {
  contentAnalysisCache.clear();
}

export interface ContentAnalysisScenario {
  weight: number;
  options: ContentAnalysisOptions;
}

/**
 * Sample dynamic content against a small, deterministic set of detached states.
 * This is an estimate for budgets only; runtime execution still uses the live
 * host state and the same EffectProgram executor exactly once per command.
 */
function analysisScenarios(options: ContentAnalysisOptions): ContentAnalysisScenario[] {
  const selfMaxHp = finiteStateNumber(options.selfMaxHp, 100, 1);
  const opponentMaxHp = finiteStateNumber(options.opponentMaxHp, 1000, 1);
  const maxEnergy = finiteStateNumber(options.selfMaxEnergy, 3, 0);
  const baseline = { ...options };
  return [
    { weight: 0.4, options: baseline },
    { weight: 0.15, options: { ...baseline, selfHp: selfMaxHp * 0.25 } },
    { weight: 0.1, options: { ...baseline, selfHp: selfMaxHp } },
    { weight: 0.15, options: { ...baseline, opponentHp: opponentMaxHp * 0.25 } },
    { weight: 0.1, options: { ...baseline, selfEnergy: Math.min(1, maxEnergy), spentEnergy: Math.min(1, maxEnergy) } },
    { weight: 0.1, options: { ...baseline, selfEnergy: maxEnergy, spentEnergy: maxEnergy } },
  ];
}

/** Return the fixed detached scenarios used by all content-budget consumers. */
export function getContentAnalysisScenarios(options: ContentAnalysisOptions = {}): ContentAnalysisScenario[] {
  return analysisScenarios(options).map(scenario => ({ ...scenario, options: { ...scenario.options } }));
}

function sampleAnalysis(
  baseline: ContentAnalysis,
  results: readonly ContentAnalysis[],
  scenarios: readonly ContentAnalysisScenario[],
): ContentAnalysis {
  if (baseline.dynamicMetrics.size === 0) return baseline;
  const sampled = emptyAnalysis();
  scenarios.forEach(({ weight }, index) => mergeAnalysis(sampled, results[index], weight));
  sampled.tags = baseline.tags;
  sampled.statusIds = baseline.statusIds;
  // Modifiers describe the definition, not six separate hypothetical copies.
  sampled.modifiers = baseline.modifiers;
  sampled.damageKnown = results.every(result => result.damageKnown);
  return sampled;
}

function metricsRange(results: readonly ContentAnalysis[]): Pick<ContentScenarioRange, 'min' | 'max' | 'damageMin' | 'damageMax' | 'lustMin' | 'lustMax'> {
  const first = results[0]?.metrics || { attack: 0, defense: 0, sustain: 0, draw: 0, energy: 0 };
  const min = { ...first };
  const max = { ...first };
  results.slice(1).forEach(result => {
    (Object.keys(min) as ContentMetric[]).forEach(metric => {
      min[metric] = Math.min(min[metric], result.metrics[metric]);
      max[metric] = Math.max(max[metric], result.metrics[metric]);
    });
  });
  return {
    min,
    max,
    damageMin: Math.min(...results.map(result => result.damage)),
    damageMax: Math.max(...results.map(result => result.damage)),
    lustMin: Math.min(...results.map(result => result.lust)),
    lustMax: Math.max(...results.map(result => result.lust)),
  };
}

function buildScenarioRange(
  baseline: ContentAnalysis,
  scenarios: readonly ContentAnalysisScenario[],
  analyze: (options: ContentAnalysisOptions) => ContentAnalysis,
): ContentScenarioRange {
  if (baseline.dynamicMetrics.size === 0) {
    return {
      expected: baseline,
      min: { ...baseline.metrics },
      max: { ...baseline.metrics },
      damageMin: baseline.damage,
      damageMax: baseline.damage,
      lustMin: baseline.lust,
      lustMax: baseline.lust,
    };
  }
  const results = scenarios.map(({ options: scenarioOptions }) => analyze(scenarioOptions));
  return { expected: sampleAnalysis(baseline, results, scenarios), ...metricsRange(results) };
}

/** Estimate a definition across common runtime states without adding AI fields. */
export function analyzeContentScenarios(
  value: unknown,
  options: ContentAnalysisOptions = {},
): ContentAnalysis {
  return analyzeContentScenarioRange(value, options).expected;
}

/**
 * Return both the expected estimate and the observed scenario range. The range
 * is for diagnostics/balance only and is never serialized into an AI prompt.
 */
export function analyzeContentScenarioRange(
  value: unknown,
  options: ContentAnalysisOptions = {},
): ContentScenarioRange {
  const baseline = analyzeContentDefinition(value, options);
  const scenarios = analysisScenarios(options);
  return buildScenarioRange(baseline, scenarios, scenarioOptions => analyzeContentDefinition(value, scenarioOptions));
}

/** Analyze status trigger maps through the same shallow-effect path. */
export function analyzeStatusDefinition(value: unknown, options: ContentAnalysisOptions = {}): ContentAnalysis {
  const result = emptyAnalysis();
  if (!isRecord(value) || !isRecord(value.triggers)) return result;
  for (const [trigger, effects] of Object.entries(value.triggers)) {
    const analysis = analyzeStatusTriggerEffects(effects, options);
    if (analysis) mergeAnalysis(result, analysis, triggerWeight(trigger));
  }
  return result;
}

/** Status counterpart of analyzeContentScenarios; it shares the same sampler. */
export function analyzeStatusScenarios(value: unknown, options: ContentAnalysisOptions = {}): ContentAnalysis {
  return analyzeStatusScenarioRange(value, options).expected;
}

export function analyzeStatusScenarioRange(
  value: unknown,
  options: ContentAnalysisOptions = {},
): ContentScenarioRange {
  const baseline = analyzeStatusDefinition(value, options);
  const scenarios = analysisScenarios(options);
  return buildScenarioRange(baseline, scenarios, scenarioOptions => analyzeStatusDefinition(value, scenarioOptions));
}

/** Analyze a modern shallow status trigger. */
function analyzeStatusTriggerEffects(effects: unknown, options: ContentAnalysisOptions): ContentAnalysis | null {
  if (!isCompactEffectList(effects)) return null;
  return analyzeContentDefinition({ effects }, options);
}
