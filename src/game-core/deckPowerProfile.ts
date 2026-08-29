import { profileDeckArchetypes, type ArchetypeAffinity, type DeckArchetypeProfile } from './archetypeGraph';
import { analyzeContentScenarios } from './contentAnalysis';
import { normalizeCardCost } from './combatResource';
import { createContentMechanicsFingerprint } from './contentFingerprint';
import { createContentPack, type ContentDefinition, type ContentPack } from './contentPack';
import { scoreDeckPower } from './deckPowerScore';
import {
  simulateEncounterShadow,
  type EncounterShadowSimulation,
  type ShadowDistribution,
  type ShadowHorizonSummary,
  type ShadowHorizonTurn,
} from './encounterShadowSimulation';

export const DECK_POWER_PROFILE_SPEC = 'mwg.deck-power/v2' as const;

export interface DeckPowerHorizon {
  hpDamage: ShadowDistribution;
  lustPressure: ShadowDistribution;
  mitigation: ShadowDistribution;
  healing: ShadowDistribution;
  cardsSeen: ShadowDistribution;
  energySurplus: ShadowDistribution;
  deadDrawRate: number;
}

export interface DeckPowerDimensionsV2 {
  burst: number;
  sustainedOutput: number;
  survival: number;
  economy: number;
  consistency: number;
  scaling: number;
  control: number;
  combo: number;
  flexibility: number;
}

export type DeckVictoryAxis = 'hp' | 'lust' | 'special';

export interface DeckVictoryFrontier {
  axis: DeckVictoryAxis;
  score: number;
  confidence: number;
}

export interface DeckProbeFrontier {
  id: StandardProbeId;
  label: string;
  scale: number;
  score: number;
  confidence: number;
  skilledWinRate: number;
  medianHpRatio: number;
}

export interface DeckPowerProfile {
  spec: typeof DECK_POWER_PROFILE_SPEC;
  fingerprint: string;
  seeds: number;
  maxHp: number;
  horizons: Record<ShadowHorizonTurn, DeckPowerHorizon>;
  dimensions: DeckPowerDimensionsV2;
  probeFrontiers: DeckProbeFrontier[];
  victoryFrontiers: DeckVictoryFrontier[];
  totalScore: number;
  confidence: number;
  unsupportedFeatures: string[];
  archetypes: ArchetypeAffinity[];
  scatterShare: number;
  deckQuality: DeckQualityProfile;
  reasons: string[];
}

export interface DeckQualityProfile {
  /** Multiplier applied after simulation so dead or inefficient draws cannot add power. */
  multiplier: number;
  totalCopies: number;
  deadCopies: number;
  hardToPlayCopies: number;
  inefficientCopies: number;
  offPlanCopies: number;
}

export type StandardProbeId =
  | 'steady-pressure'
  | 'telegraphed-burst'
  | 'late-scaling'
  | 'control-tax'
  | 'desire-pressure'
  | 'multi-target';

interface StandardProbe {
  id: StandardProbeId;
  label: string;
  weight: number;
  enemy(scale: number): ContentDefinition | ContentDefinition[];
}

const PROFILE_HORIZONS = [1, 2, 3, 5, 8] as const;
const profileCache = new Map<string, DeckPowerProfile>();

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function cardQuantity(value: ContentDefinition): number {
  const amount = Number(value.quantity);
  return Number.isInteger(amount) && amount > 0 ? Math.min(100, amount) : 1;
}

function assessDeckQuality(
  pack: ContentPack,
  archetypes: DeckArchetypeProfile,
  energyGain: number,
): DeckQualityProfile {
  const totalCopies = pack.cards.reduce((sum, card) => sum + cardQuantity(card), 0);
  if (totalCopies <= 0) {
    return { multiplier: 0.55, totalCopies: 0, deadCopies: 0, hardToPlayCopies: 0, inefficientCopies: 0, offPlanCopies: 0 };
  }
  const available: Record<string, number> = {
    energy: 3 + Math.min(3, Math.max(0, Math.floor(energyGain))),
    ...Object.fromEntries((pack.playerResources || []).map(resource => [
      String(resource.id || ''),
      Math.max(Number(resource.current) || 0, Number(resource.max) || 0),
    ])),
  };
  const dominant = new Set(archetypes.affinities.slice(0, 3).filter(value => value.share >= 10).map(value => value.id));
  const cardAffinities = new Map(archetypes.cards.map(card => [card.id, new Set(card.affinities.map(value => value.id))]));
  let deadCopies = 0;
  let hardToPlayCopies = 0;
  let inefficientCopies = 0;
  let offPlanCopies = 0;

  for (const card of pack.cards) {
    const copies = cardQuantity(card);
    const automaticCurseValue = card.type === 'Curse' && Boolean(card.discard_effects || card.trigger || card.ethereal);
    if (card.type === 'Curse') deadCopies += copies * (automaticCurseValue ? 0.5 : 1);
    const components = normalizeCardCost(card.cost ?? 0);
    const hardToPlay = Object.entries(components).some(([resource, amount]) =>
      typeof amount === 'number' && amount > Math.max(0, available[resource] || 0),
    );
    if (hardToPlay) hardToPlayCopies += copies;

    const analysis = analyzeContentScenarios(card);
    const costWeight = Object.values(components).reduce<number>(
      (sum, amount) => sum + (typeof amount === 'number' ? Math.max(0, amount) : 3),
      0,
    );
    const utility =
      Math.max(0, analysis.damage) + Math.max(0, analysis.lust) * 0.65
      + Math.max(0, analysis.metrics.defense) * 0.9 + Math.max(0, analysis.metrics.sustain) * 1.1
      + Math.max(0, analysis.metrics.draw) * 3.2 + Math.max(0, analysis.metrics.energy) * 4;
    const hasUnpricedRules = analysis.dynamicMetrics.size > 0 || !analysis.damageKnown || Boolean(card.trigger);
    const inefficient = card.type !== 'Curse'
      && !hasUnpricedRules
      && utility < (costWeight > 0 ? costWeight * 2.5 : 1);
    if (inefficient) inefficientCopies += copies;

    const affinities = cardAffinities.get(String(card.id || '')) || new Set<string>();
    const offPlan = dominant.size > 0
      && affinities.size > 0
      && ![...affinities].some(id => dominant.has(id));
    if (offPlan && (inefficient || hardToPlay)) offPlanCopies += copies;
  }

  const deadShare = deadCopies / totalCopies;
  const hardShare = hardToPlayCopies / totalCopies;
  const inefficientShare = inefficientCopies / totalCopies;
  const offPlanShare = offPlanCopies / totalCopies;
  const multiplier = clamp(
    1 - deadShare * 0.65 - hardShare * 0.4 - inefficientShare * 0.22 - offPlanShare * 0.12,
    0.55,
    1,
  );
  return {
    multiplier: round(multiplier, 3),
    totalCopies,
    deadCopies: round(deadCopies, 1),
    hardToPlayCopies,
    inefficientCopies,
    offPlanCopies,
  };
}

function scaled(value: number, scale: number, minimum = 0): number {
  return round(Math.max(minimum, value * scale), 1);
}

function probeEnemy(input: {
  id: string;
  hp: number;
  actions: ContentDefinition[];
  lustEffect?: ContentDefinition;
  actionMode?: string;
  actionConfig?: Record<string, unknown>;
}): ContentDefinition {
  const actions = input.actions.map((action, index) => ({
    ...action,
    name: String(action.name || action.id || `探针行动${index + 1}`),
  }));
  return {
    id: input.id,
    name: input.id,
    hp: input.hp,
    max_hp: input.hp,
    lust: 0,
    max_lust: 100,
    actions,
    lust_effect: input.lustEffect || { id: `${input.id}_overflow`, effects: { damage: 8 } },
    action_mode: input.actionMode || 'sequence_loop',
    action_config: input.actionConfig || {},
  };
}

const STANDARD_PROBES: readonly StandardProbe[] = [
  {
    id: 'steady-pressure', label: '稳定持续压力', weight: 1.2,
    enemy: scale => probeEnemy({
      id: 'probe_steady', hp: scaled(46, scale, 8),
      actions: [
        { id: 'steady_hit', name: '稳定施压', weight: 3, effects: { damage: scaled(7, scale) } },
        { id: 'steady_guard', name: '短暂防守', weight: 1, effects: { block: scaled(5, scale) } },
      ],
      actionMode: 'probability',
      actionConfig: { probability: { 稳定施压: 3, 短暂防守: 1 } },
    }),
  },
  {
    id: 'telegraphed-burst', label: '可预告爆发', weight: 1.1,
    enemy: scale => probeEnemy({
      id: 'probe_burst', hp: scaled(50, scale, 8),
      actions: [
        { id: 'prepare', name: '蓄势', effects: { block: scaled(4, scale) } },
        { id: 'burst', name: '爆发', effects: { damage: scaled(16, scale) } },
        { id: 'recover', name: '回气', effects: { damage: scaled(4, scale) } },
      ],
      actionMode: 'sequence_loop',
    }),
  },
  {
    id: 'late-scaling', label: '后期成长', weight: 1,
    enemy: scale => probeEnemy({
      id: 'probe_scaling', hp: scaled(56, scale, 8),
      actions: [
        { id: 'scale_1', name: '成长一', effects: { damage: scaled(4, scale) } },
        { id: 'scale_2', name: '成长二', effects: { damage: scaled(7, scale) } },
        { id: 'scale_3', name: '成长三', effects: { damage: scaled(10, scale) } },
        { id: 'scale_4', name: '成长四', effects: { damage: scaled(14, scale) } },
      ],
      actionMode: 'sequence_loop',
    }),
  },
  {
    id: 'control-tax', label: '牌序与控制税', weight: 0.8,
    enemy: scale => probeEnemy({
      id: 'probe_control', hp: scaled(44, scale, 8),
      actions: [
        { id: 'control_hit', name: '压迫', effects: { damage: scaled(6, scale) } },
        {
          id: 'control_tax', name: '干扰',
          effects: [
            { damage: scaled(3, scale) },
            { apply_status: 'probe_tax', stacks: Math.max(1, Math.round(scale)), to: 'opponent' },
          ],
        },
      ],
      actionMode: 'sequence_loop',
    }),
  },
  {
    id: 'desire-pressure', label: '欲望压力', weight: 0.9,
    enemy: scale => probeEnemy({
      id: 'probe_desire', hp: scaled(44, scale, 8),
      actions: [
        { id: 'desire', name: '欲望侵蚀', effects: { lust: scaled(11, scale) } },
        { id: 'desire_mix', name: '混合侵蚀', effects: { damage: scaled(3, scale), lust: scaled(7, scale) } },
      ],
      lustEffect: { id: 'desire_overflow', effects: { damage: scaled(12, scale), lust: scaled(4, scale) } },
      actionMode: 'sequence_loop',
    }),
  },
  {
    id: 'multi-target', label: '多目标压力', weight: 0.8,
    enemy: scale => [
      probeEnemy({ id: 'probe_swarm_left', hp: scaled(24, scale, 5), actions: [{ id: 'left_hit', effects: { damage: scaled(4, scale) } }] }),
      probeEnemy({ id: 'probe_swarm_right', hp: scaled(24, scale, 5), actions: [{ id: 'right_hit', effects: { damage: scaled(4, scale) } }] }),
    ],
  },
];

function withProbe(pack: ContentPack, probe: StandardProbe, scale: number): ContentPack {
  const generated = probe.enemy(scale);
  const enemies = Array.isArray(generated) ? generated : [generated];
  return createContentPack({
    cards: pack.cards,
    statuses: pack.statuses,
    relics: pack.relics,
    items: pack.items,
    abilities: pack.abilities,
    activeStatuses: pack.activeStatuses,
    playerResources: pack.playerResources,
    enemies,
    playerDesireEffect: pack.desireEffects.player,
  });
}

function engineResult(simulation: EncounterShadowSimulation | null) {
  return simulation?.strategies.find(strategy => strategy.strategy === 'engine') || null;
}

function frontierPass(simulation: EncounterShadowSimulation | null): boolean {
  const engine = engineResult(simulation);
  if (!engine) return false;
  // 100% means the median reference line can be clean when played near optimally;
  // it deliberately does not promise a clean win for every random seed.
  return engine.winRateLow >= 0.42 && engine.winRate >= 0.58 && engine.medianHpRatio >= 0.985;
}

function probeFrontier(
  pack: ContentPack,
  probe: StandardProbe,
  maxHp: number,
  maxLust: number,
  seeds: number,
): { frontier: DeckProbeFrontier; unsupportedFeatures: string[] } {
  let low = 0.12;
  let high = 3.2;
  let bestSimulation: EncounterShadowSimulation | null = null;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const middle = (low + high) / 2;
    const simulation = simulateEncounterShadow({
      pack: withProbe(pack, probe, middle),
      player: { hp: maxHp, maxHp, lust: 0, maxLust },
      seeds,
      strategies: ['engine'],
    });
    if (frontierPass(simulation)) {
      low = middle;
      bestSimulation = simulation;
    } else {
      high = middle;
    }
  }
  const simulation = bestSimulation || simulateEncounterShadow({
    pack: withProbe(pack, probe, low),
    player: { hp: maxHp, maxHp, lust: 0, maxLust },
    seeds,
    strategies: ['engine'],
  });
  const engine = engineResult(simulation);
  const confidence = simulation
    ? clamp(simulation.coverage.coverageRatio * (simulation.confidence === 'high' ? 1 : simulation.confidence === 'medium' ? 0.75 : 0.45))
    : 0;
  return {
    frontier: {
      id: probe.id,
      label: probe.label,
      scale: round(low, 3),
      score: 0,
      confidence: round(confidence, 3),
      skilledWinRate: engine?.winRate || 0,
      medianHpRatio: engine?.medianHpRatio || 0,
    },
    unsupportedFeatures: simulation?.coverage.unsupportedFeatures || [],
  };
}

function harmonicMean(values: readonly { value: number; weight: number }[]): number {
  const valid = values.filter(entry => entry.value > 0 && entry.weight > 0);
  if (valid.length === 0) return 0;
  const weight = valid.reduce((sum, entry) => sum + entry.weight, 0);
  return weight / valid.reduce((sum, entry) => sum + entry.weight / entry.value, 0);
}

function referencePack(): ContentPack {
  return createContentPack({
    cards: [
      { id: 'reference_strike', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 6 } },
      { id: 'reference_guard', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 5 } },
    ],
    playerDesireEffect: { id: 'reference_desire', effects: { damage: 6 } },
  });
}

let referenceFrontier: number | null = null;

function normalizeFrontiers(frontiers: DeckProbeFrontier[], maxHp: number, maxLust: number, seeds: number): number {
  if (referenceFrontier === null) {
    const reference = STANDARD_PROBES.map(
      probe => probeFrontier(referencePack(), probe, 80, 100, Math.max(8, Math.min(12, seeds))).frontier,
    );
    referenceFrontier = harmonicMean(reference.map((frontier, index) => ({ value: frontier.scale, weight: STANDARD_PROBES[index].weight })));
  }
  const raw = harmonicMean(frontiers.map((frontier, index) => ({ value: frontier.scale, weight: STANDARD_PROBES[index].weight })));
  const hpReserveAdjustment = Math.pow(Math.max(0.25, maxHp / 80), 0.16);
  const lustReserveAdjustment = Math.pow(Math.max(0.5, maxLust / 100), 0.06);
  return round(100 * raw / Math.max(0.01, referenceFrontier) * hpReserveAdjustment * lustReserveAdjustment, 1);
}

function benchmarkHorizons(pack: ContentPack, maxHp: number, maxLust: number, seeds: number): Record<ShadowHorizonTurn, DeckPowerHorizon> {
  const outputDummy = probeEnemy({
    id: 'probe_output_dummy', hp: 999999,
    actions: [{ id: 'wait', name: '等待', effects: { block: 0 } }],
  });
  const pressureDummy = probeEnemy({
    id: 'probe_survival_dummy', hp: 999999,
    actions: [{ id: 'pressure', name: '压力', effects: { damage: 12 } }],
  });
  const output = engineResult(simulateEncounterShadow({
    pack: createContentPack({
      cards: pack.cards, statuses: pack.statuses, relics: pack.relics, items: pack.items,
      abilities: pack.abilities, activeStatuses: pack.activeStatuses, playerResources: pack.playerResources,
      enemy: outputDummy, playerDesireEffect: pack.desireEffects.player,
    }),
    player: { hp: maxHp, maxHp, lust: 0, maxLust }, seeds,
    strategies: ['engine'],
  }));
  const pressure = engineResult(simulateEncounterShadow({
    pack: createContentPack({
      cards: pack.cards, statuses: pack.statuses, relics: pack.relics, items: pack.items,
      abilities: pack.abilities, activeStatuses: pack.activeStatuses, playerResources: pack.playerResources,
      enemy: pressureDummy, playerDesireEffect: pack.desireEffects.player,
    }),
    player: { hp: maxHp, maxHp, lust: 0, maxLust }, seeds,
    strategies: ['engine'],
  }));
  const zero: ShadowDistribution = { mean: 0, p10: 0, p50: 0, p90: 0 };
  return Object.fromEntries(PROFILE_HORIZONS.map(turn => {
    const offense = output?.horizons[turn];
    const defense = pressure?.horizons[turn];
    return [turn, {
      hpDamage: offense?.hpDamage || zero,
      lustPressure: offense?.lustPressure || zero,
      mitigation: defense?.mitigation || zero,
      healing: defense?.healing || zero,
      cardsSeen: offense?.cardsSeen || zero,
      energySurplus: offense?.energySurplus || zero,
      deadDrawRate: round(Math.max(offense?.deadDrawRate || 0, defense?.deadDrawRate || 0), 3),
    } satisfies DeckPowerHorizon];
  })) as Record<ShadowHorizonTurn, DeckPowerHorizon>;
}

function dimensions(
  horizons: Record<ShadowHorizonTurn, DeckPowerHorizon>,
  maxHp: number,
  staticControl: number,
  archetypes: ReturnType<typeof profileDeckArchetypes>,
): DeckPowerDimensionsV2 {
  const turn1 = horizons[1];
  const turn3 = horizons[3];
  const turn5 = horizons[5];
  const turn8 = horizons[8];
  const output1 = turn1.hpDamage.p90 + turn1.lustPressure.p90 * 0.7;
  const output3 = turn3.hpDamage.p50 + turn3.lustPressure.p50 * 0.7;
  const output8 = turn8.hpDamage.p50 + turn8.lustPressure.p50 * 0.7;
  const p10 = turn5.hpDamage.p10 + turn5.lustPressure.p10 * 0.7;
  const p50 = turn5.hpDamage.p50 + turn5.lustPressure.p50 * 0.7;
  const topShares = archetypes.affinities.slice(0, 5);
  return {
    burst: round(clamp(output1 / 24, 0, 1) * 100, 1),
    sustainedOutput: round(clamp((output8 / 8) / 14, 0, 1) * 100, 1),
    survival: round(clamp((turn5.mitigation.p50 + turn5.healing.p50 + maxHp * 0.2) / 85, 0, 1) * 100, 1),
    economy: round(clamp((turn3.cardsSeen.p50 - 15) / 9 + Math.max(0, turn3.energySurplus.p50) / 9, 0, 1) * 100, 1),
    consistency: round(clamp((p50 > 0 ? p10 / p50 : 0) * (1 - turn5.deadDrawRate), 0, 1) * 100, 1),
    scaling: round(clamp((output8 / 8) / Math.max(1, output3 / 3) - 0.75, 0, 1) * 100, 1),
    control: round(clamp(staticControl / 100, 0, 1) * 100, 1),
    combo: round(clamp(topShares.filter(value => value.score >= 18).length / 4 + archetypes.bridges.length / 12, 0, 1) * 100, 1),
    flexibility: round(clamp(topShares.length / 5 * 0.7 + archetypes.scatterShare / 100 * 0.3, 0, 1) * 100, 1),
  };
}

function confidenceFrom(frontiers: readonly DeckProbeFrontier[], unsupported: readonly string[]): number {
  const probeConfidence = frontiers.length
    ? frontiers.reduce((sum, frontier) => sum + frontier.confidence, 0) / frontiers.length
    : 0;
  return round(clamp(probeConfidence * Math.max(0.25, 1 - unsupported.length * 0.045)), 3);
}

/**
 * Score a persistent build with full resources. Current HP/lust are deliberately absent.
 * The score is the risk-averse frontier of standard probe enemies, normalized so a
 * five-strike/five-guard reference build at 80 max HP is approximately 100.
 */
export function createDeckPowerProfileFingerprint(input: {
  pack: ContentPack;
  maxHp: number;
  maxLust?: number;
  seeds?: number;
}): string {
  const maxHp = Math.max(1, Number(input.maxHp) || 1);
  const maxLust = Math.max(1, Number(input.maxLust) || 100);
  const seeds = Math.max(8, Math.min(64, Math.floor(input.seeds ?? 16)));
  return `${createContentMechanicsFingerprint({
    cards: input.pack.cards,
    statuses: input.pack.statuses,
    relics: input.pack.relics,
    abilities: input.pack.abilities,
    activeStatuses: input.pack.activeStatuses,
    playerResources: input.pack.playerResources || [],
    playerDesireEffect: input.pack.desireEffects.player,
  })}:hp${round(maxHp)}:lust${round(maxLust)}:s${seeds}`;
}

export function profileDeckPower(input: {
  pack: ContentPack;
  maxHp: number;
  maxLust?: number;
  seeds?: number;
}): DeckPowerProfile {
  const maxHp = Math.max(1, Number(input.maxHp) || 1);
  const maxLust = Math.max(1, Number(input.maxLust) || 100);
  const seeds = Math.max(8, Math.min(64, Math.floor(input.seeds ?? 16)));
  const fingerprint = createDeckPowerProfileFingerprint({ pack: input.pack, maxHp, maxLust, seeds });
  const cached = profileCache.get(fingerprint);
  if (cached) return cached;

  const staticScore = scoreDeckPower({ pack: input.pack, maxHp });
  const archetypeProfile = profileDeckArchetypes(input.pack);
  const horizons = benchmarkHorizons(input.pack, maxHp, maxLust, seeds);
  const frontierResults = STANDARD_PROBES.map(probe => probeFrontier(input.pack, probe, maxHp, maxLust, seeds));
  const frontiers = frontierResults.map(result => result.frontier);
  const simulatedScore = normalizeFrontiers(frontiers, maxHp, maxLust, seeds);
  const deckQuality = assessDeckQuality(input.pack, archetypeProfile, staticScore.budget.energy);
  const totalScore = round(simulatedScore * deckQuality.multiplier, 1);
  frontiers.forEach(frontier => { frontier.score = round(totalScore * frontier.scale / Math.max(0.01, harmonicMean(frontiers.map((entry, index) => ({ value: entry.scale, weight: STANDARD_PROBES[index].weight })))), 1); });
  const unsupportedFeatures = [...new Set(frontierResults.flatMap(result => result.unsupportedFeatures))].sort();
  const confidence = confidenceFrom(frontiers, unsupportedFeatures);
  const hpOutput = horizons[5].hpDamage.p50;
  const lustOutput = horizons[5].lustPressure.p50;
  const axisTotal = Math.max(1, hpOutput + lustOutput * 0.7);
  const victoryFrontiers: DeckVictoryFrontier[] = [
    { axis: 'hp', score: round(totalScore * hpOutput / axisTotal, 1), confidence },
    { axis: 'lust', score: round(totalScore * lustOutput * 0.7 / axisTotal, 1), confidence },
    { axis: 'special', score: round(totalScore * clamp(staticScore.dimensions.control / 250, 0, 0.4), 1), confidence: round(confidence * 0.55, 3) },
  ];
  const result: DeckPowerProfile = {
    spec: DECK_POWER_PROFILE_SPEC,
    fingerprint,
    seeds,
    maxHp: round(maxHp, 1),
    horizons,
    dimensions: (() => {
      const result = dimensions(horizons, maxHp, staticScore.dimensions.control, archetypeProfile);
      result.consistency = round(result.consistency * deckQuality.multiplier, 1);
      return result;
    })(),
    probeFrontiers: frontiers,
    victoryFrontiers,
    totalScore,
    confidence,
    unsupportedFeatures,
    archetypes: archetypeProfile.affinities,
    scatterShare: archetypeProfile.scatterShare,
    deckQuality,
    reasons: [
      `标准探针模拟 ${simulatedScore} 分，牌库质量系数 ${round(deckQuality.multiplier * 100, 1)}%，综合强度 ${totalScore}；最大生命 ${round(maxHp, 1)} 已计入，当前生命未计入。`,
      `牌库污染：不可主动使用 ${deckQuality.deadCopies} 张、常规资源难以打出 ${deckQuality.hardToPlayCopies} 张、低费用效率 ${deckQuality.inefficientCopies} 张、偏离主构筑且低效 ${deckQuality.offPlanCopies} 张。`,
      `5回合中位生命输出 ${round(horizons[5].hpDamage.p50, 1)}，欲望压力 ${round(horizons[5].lustPressure.p50, 1)}。`,
      `估算置信度 ${Math.round(confidence * 100)}%；未完整覆盖机制 ${unsupportedFeatures.length} 项。`,
    ],
  };
  profileCache.set(fingerprint, result);
  while (profileCache.size > 24) profileCache.delete(profileCache.keys().next().value as string);
  return result;
}

export function clearDeckPowerProfileCache(): void {
  profileCache.clear();
  referenceFrontier = null;
}
