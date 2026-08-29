import { analyzeContentScenarios, hasContentMetric, type ContentAnalysis } from './contentAnalysis';
import {
  type BuildBudget,
  type ContentDefinition,
  type ContentPack,
} from './contentPack';
import {
  createContentMechanicsFingerprint,
  createContentStructuralFingerprint,
} from './contentFingerprint';
import {
  extractContentMechanicFeatures,
  mergeContentMechanicFeatures,
  type ContentMechanicFeatures,
} from './contentMechanicFeatures';
import { recommendEnemyBudget, type EnemyBudget } from './enemyBudget';
import { recommendBuildGuidance, type BuildGuidance } from './buildGuidance';
import { simulateEncounterShadow, type EncounterShadowSimulation } from './encounterShadowSimulation';
import { estimateCardCostWeight, normalizeCombatResourceStates } from './combatResource';
import { scoreDeckPower, type DeckPowerScore } from './deckPowerScore';
import { scoreEnemyPower, type EnemyPowerScore } from './enemyPowerScore';
import {
  calibrateEnemyPower,
  createDifficultyBudget,
  normalizeDifficultyPercent,
  type DifficultyBudget,
  type EnemyBalanceCalibration,
} from './difficultyBudget';
import { profileDeckArchetypes, type DeckArchetypeProfile } from './archetypeGraph';
import {
  createRewardArchetypePlan,
  evaluateRewardCandidateArchetype,
  profileDeckCardContributions,
  type RewardArchetypeDirection,
  type RewardArchetypePathKind,
  type RewardArchetypePlan,
} from './rewardArchetypePlanner';
import { createDeckPowerProfileFingerprint, type DeckPowerProfile } from './deckPowerProfile';
import { createEnemyBudgetEnvelope, type EnemyBudgetEnvelope } from './encounterBalance';
import {
  createEncounterLineagePromptView,
  updateEncounterLineageMemory,
  type EncounterLineageMemory,
} from './encounterLineageMemory';

export const CONTENT_DESIGN_CONTEXT_SPEC = 'mwg.content-design/v3' as const;
const LEGACY_CONTENT_DESIGN_CONTEXT_SPECS = new Set(['mwg.content-design/v1', 'mwg.content-design/v2']);

export type DesignDiagnosticSeverity = 'critical' | 'risk' | 'advice';
export type EncounterChallengeBand = 'light' | 'fair' | 'tense' | 'severe' | 'unknown';
export type WinConditionProfile = '生命' | '欲望' | '混合' | '特殊';
export type EnemyPressureDimension =
  | '爆发'
  | '消耗'
  | '成长'
  | '控制'
  | '资源'
  | '牌库污染'
  | '反应'
  | '阶段'
  | '群体'
  | '欲望';

export interface ContentDesignDiagnostic {
  code: string;
  severity: DesignDiagnosticSeverity;
  scope: 'build' | 'enemy' | 'encounter' | 'reward' | 'variety';
  message: string;
  suggestion: string;
}

export interface BuildDesignProfile {
  deckSize: number;
  winCondition: WinConditionProfile;
  engines: string[];
  tempo: '低' | '中' | '高';
  survival: '脆弱' | '有限' | '稳定' | '强韧';
  economy: '紧张' | '普通' | '充足';
  consistency: number;
  complexity: number;
  mechanicAxes: string[];
  enablers: string[];
  payoffs: string[];
  bridges: string[];
  resourceLoops: string[];
  riskHooks: string[];
  extensionHooks: string[];
}

export interface EnemyDesignProfile {
  signature: string;
  pressure: '生命' | '欲望' | '混合' | '控制' | '未知';
  dimensions: EnemyPressureDimension[];
  cadence: string;
  expectedDamage: number;
  expectedLust: number;
  expectedBlock: number;
  peakDamage: number;
  desireFinishDamage: number;
  actionDiversity: number;
  actionEntropy: number;
  maxActionProbability: number;
  complexity: number;
  counterplayWindow: boolean;
  enemyCount: number;
  roles: string[];
  synergies: string[];
  targetModes: string[];
  actionOrder: string[];
}

export interface EncounterForecast {
  challenge: EncounterChallengeBand;
  expectedVictoryTurns: number | null;
  expectedSurvivalTurns: number | null;
  targetTurns: [number, number];
  confidence: 'low' | 'medium' | 'high';
}

export interface RewardCandidateDesignProfile {
  id: string;
  fingerprint: string;
  structuralFingerprint: string;
  roles: string[];
  axes: string[];
  power: number;
  complexity: number;
  synergy: number;
  novelty: number;
  pathKind: RewardArchetypePathKind;
  deckScoreDelta: number;
  relativeDeckScoreDelta: number;
  candidatePowerScore: number;
  selectionValue: number;
  archetypes: Array<{ id: string; label: string; score: number }>;
  pathScores: Record<RewardArchetypePathKind, number>;
  dimensionGains: Record<string, number>;
}

export interface RewardChoiceDesignProfile {
  candidateCount: number;
  uniqueMechanics: number;
  uniqueStructures: number;
  distinctRoles: number;
  dominatedPairs: string[];
  candidates: RewardCandidateDesignProfile[];
}

export type RewardDesignDirection = RewardArchetypeDirection;
export type RewardDesignPlan = RewardArchetypePlan;

export interface EncounterDesignPlan {
  enemyCount: number;
  roles: string[];
  synergies: string[];
  targetModes: string[];
  actionOrder: string[];
  guidance: string[];
}

export interface BattleOutcomeFeedback {
  outcome: 'victory' | 'defeat' | 'terminated';
  turns: number;
  hpRatio: number;
  lustRatio: number;
}

export interface BattlePerformanceSummary {
  battles: number;
  ewmaWinRate: number;
  ewmaTurns: number;
  ewmaHpRatio: number;
  ewmaLustRatio: number;
  pressureFactor: number;
}

export interface ProgramEncounterCalibrationSummary {
  spec: 'mwg.encounter-calibration/v1';
  requestedRatio: number;
  effectiveRatio: number;
  appliedScale: number;
  winnableAtCurrentResources: boolean;
  confidence: number;
  changedPaths: string[];
  warnings: string[];
  enemyFingerprint: string;
}

export interface ContentDesignContext {
  spec: typeof CONTENT_DESIGN_CONTEXT_SPEC;
  fingerprint: string;
  build: BuildDesignProfile;
  brief: string;
  recentEnemySignatures: string[];
  recentRewardStructures: string[];
  rewardPlan: RewardDesignPlan;
  settings: {
    difficultyPercent: number;
    autoCalibration: boolean;
  };
  balance: {
    deck: DeckPowerScore;
    target: DifficultyBudget;
    /** Program-simulated long-term build score. Populated asynchronously and persisted. */
    deckProfile?: DeckPowerProfile;
    /** Numeric generation envelope derived from deckProfile and current resources. */
    targetEnvelope?: EnemyBudgetEnvelope;
    programCalibration?: ProgramEncounterCalibrationSummary;
    enemy?: EnemyPowerScore;
    calibration?: EnemyBalanceCalibration;
  };
  archetypes: DeckArchetypeProfile;
  lineage: EncounterLineageMemory;
  encounterPlan?: EncounterDesignPlan;
  lastBattle?: BattleOutcomeFeedback;
  performance?: BattlePerformanceSummary;
  rewardReview?: {
    candidateCount: number;
    uniqueMechanics: number;
    uniqueStructures: number;
    distinctRoles: number;
    diagnosticCodes: string[];
    candidates: Array<{
      id: string;
      pathKind: RewardArchetypePathKind;
      deckScoreDelta: number;
      selectionValue: number;
      archetypes: Array<{ id: string; label: string; score: number }>;
    }>;
  };
  lastEncounter?: {
    signature: string;
    challenge: EncounterChallengeBand;
    expectedVictoryTurns: number | null;
    diagnosticCodes: string[];
    priorityAdvice?: string;
    shadow?: {
      confidence: EncounterShadowSimulation['confidence'];
      skilledWinRate: number;
      greedyWinRate: number;
      strategySpread: number;
    };
  };
}

export interface ContentDesignAssistantInput {
  pack: ContentPack;
  budget: BuildBudget;
  player: { hp: number; maxHp: number; lust?: number; maxLust?: number };
  danger?: 0 | 1 | 2 | 3;
  act?: number;
  previous?: unknown;
  outcome?: BattleOutcomeFeedback;
  rewardCandidates?: ContentDefinition[];
  difficultyPercent?: number;
  autoCalibration?: boolean;
  deckPowerProfile?: DeckPowerProfile;
  /** Normal UI refresh uses 24; explicit deep calibration may request up to 256. */
  simulationSeeds?: number;
}

export interface ContentDesignAssessment {
  build: BuildDesignProfile;
  enemy: EnemyDesignProfile | null;
  forecast: EncounterForecast | null;
  reward: RewardChoiceDesignProfile | null;
  rewardPlan: RewardDesignPlan;
  encounterPlan: EncounterDesignPlan | null;
  budget: EnemyBudget;
  diagnostics: ContentDesignDiagnostic[];
  simulation: EncounterShadowSimulation | null;
  deckPower: DeckPowerScore;
  /** v2 program simulation; null only while the deferred profiler has not completed. */
  deckPowerProfile: DeckPowerProfile | null;
  /** v2 enemy generation budget derived from the simulated profile and current resources. */
  enemyEnvelope: EnemyBudgetEnvelope | null;
  enemyPower: EnemyPowerScore | null;
  difficulty: DifficultyBudget;
  calibration: EnemyBalanceCalibration | null;
  archetypes: DeckArchetypeProfile;
  lineage: EncounterLineageMemory;
  context: ContentDesignContext;
}

type WeightedAnalysis = {
  analysis: ContentAnalysis;
  weight: number;
  definition: ContentDefinition;
};

const TARGET_TURNS: Readonly<Record<number, [number, number]>> = {
  1: [3, 6],
  2: [5, 8],
  3: [7, 11],
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function definitionQuantity(value: ContentDefinition): number {
  const quantity = Number(value.quantity);
  return Number.isInteger(quantity) && quantity > 0 ? Math.min(100, quantity) : 1;
}

function compactUnique(values: Iterable<string>, limit: number): string[] {
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || result.includes(value)) continue;
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizePrevious(value: unknown): Partial<ContentDesignContext> {
  if (!isRecord(value)) return {};
  return value.spec === CONTENT_DESIGN_CONTEXT_SPEC || LEGACY_CONTENT_DESIGN_CONTEXT_SPECS.has(String(value.spec))
    ? (value as Partial<ContentDesignContext>)
    : {};
}

function meaningfulEnemies(pack: ContentPack): ContentDefinition[] {
  const candidates = pack.enemies?.length ? pack.enemies : pack.enemy ? [pack.enemy] : [];
  return candidates.filter(enemy => {
    const hasIdentity = Boolean(String(enemy.id || enemy.name || '').trim());
    const hasVitals = Number(enemy.max_hp) > 0 || Number(enemy.hp) > 0;
    const hasActions = Array.isArray(enemy.actions) && enemy.actions.length > 0;
    return hasIdentity && (hasVitals || hasActions);
  });
}

function complexityPoints(value: unknown, depth = 0): number {
  if (depth > 8) return 4;
  if (typeof value === 'string') {
    if (/\b(?:self|opponent|stacks|current_turn|cards_played|spent_energy)\b/.test(value)) return 2;
    return 0;
  }
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + complexityPoints(entry, depth + 1), 0);
  if (!isRecord(value)) return 0;
  let points = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (['when', 'if', 'then', 'else'].includes(key)) points += 3;
    else if (['trigger', 'discard_effects', 'creates', 'modify', 'add_card', 'transform_card'].includes(key)) points += 2;
    else if (['apply_status', 'remove_status', 'move_card', 'recover', 'seek', 'scry'].includes(key)) points += 1;
    points += complexityPoints(entry, depth + 1);
  }
  return points;
}

function definitionLabel(value: ContentDefinition, fallback: string): string {
  return String(value.name || value.id || fallback).trim() || fallback;
}

function featureSummary(label: string, features: ContentMechanicFeatures): string {
  return features.axes.length ? `${label}(${features.axes.slice(0, 2).join('+')})` : label;
}

function buildProfile(pack: ContentPack, budget: BuildBudget): BuildDesignProfile {
  let directDamage = 0;
  let desirePressure = 0;
  let playableCopies = 0;
  let nonCurseCopies = 0;
  let complexity = 0;
  const engineScores = new Map<string, number>();
  const axisScores = new Map<string, number>();
  const featureEntries: Array<{ label: string; quantity: number; features: ContentMechanicFeatures }> = [];
  const resourcePool = {
    energy: 3,
    ...Object.fromEntries(Object.entries(normalizeCombatResourceStates(pack.playerResources || [])).map(([id, resource]) => [
      id,
      resource.refresh === 'reset' ? resource.max : resource.current,
    ])),
  };
  const scoreEngine = (tag: string, value: number): void => {
    if (!tag || ['能力', '能量'].includes(tag)) return;
    engineScores.set(tag, (engineScores.get(tag) || 0) + value);
  };
  const scoreFeatures = (definition: ContentDefinition, label: string, quantity: number): ContentMechanicFeatures => {
    const features = extractContentMechanicFeatures(definition);
    featureEntries.push({ label, quantity, features });
    features.axes.forEach(axis => axisScores.set(axis, (axisScores.get(axis) || 0) + quantity));
    return features;
  };

  for (let cardIndex = 0; cardIndex < pack.cards.length; cardIndex += 1) {
    const card = pack.cards[cardIndex];
    const quantity = definitionQuantity(card);
    scoreFeatures(card, definitionLabel(card, `卡牌${cardIndex + 1}`), quantity);
    const analysis = analyzeContentScenarios(card);
    directDamage += Math.max(0, analysis.damage) * quantity;
    desirePressure += Math.max(0, analysis.lust) * quantity;
    complexity += complexityPoints(card) * Math.min(quantity, 3);
    if (card.type !== 'Curse') {
      nonCurseCopies += quantity;
      if (estimateCardCostWeight(card.cost ?? 0, resourcePool) <= 3) playableCopies += quantity;
    }
    analysis.tags.forEach(tag => scoreEngine(tag, quantity * (tag.startsWith('状态:') ? 2 : 1)));
    analysis.statusIds.forEach(id => scoreEngine(`状态:${id}`, quantity * 2));
  }
  [...pack.relics, ...pack.abilities, ...pack.activeStatuses].forEach((definition, index) => {
    scoreFeatures(definition, definitionLabel(definition, `常驻效果${index + 1}`), 1);
    const analysis = analyzeContentScenarios(definition);
    analysis.tags.forEach(tag => scoreEngine(tag, 2));
    analysis.statusIds.forEach(id => scoreEngine(`状态:${id}`, 2));
    complexity += complexityPoints(definition);
  });

  const pressureTotal = directDamage + desirePressure;
  const winCondition: WinConditionProfile =
    pressureTotal <= 0
      ? '特殊'
      : directDamage > 0 && desirePressure > 0 && Math.min(directDamage, desirePressure) / Math.max(directDamage, desirePressure) >= 0.25
        ? '混合'
        : desirePressure > directDamage
          ? '欲望'
          : '生命';
  const engineThreshold = Math.max(2, budget.deck * 0.12);
  const engines = [...engineScores.entries()]
    .filter(([name, score]) => !['固有', '保留'].includes(name) && score >= engineThreshold)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([name]) => name);
  const defenseRatio = (budget.defense + budget.sustain * 0.75) / Math.max(1, budget.maxHp * 0.12);
  const survival: BuildDesignProfile['survival'] =
    defenseRatio < 0.35 ? '脆弱' : defenseRatio < 0.8 ? '有限' : defenseRatio < 1.6 ? '稳定' : '强韧';
  const tempo: BuildDesignProfile['tempo'] =
    budget.attack < Math.max(6, budget.maxHp * 0.08) ? '低' : budget.attack > Math.max(18, budget.maxHp * 0.2) ? '高' : '中';
  const economyValue = budget.draw + budget.energy;
  const economy: BuildDesignProfile['economy'] = economyValue < 0.75 ? '紧张' : economyValue > 2.5 ? '充足' : '普通';
  const consistency = nonCurseCopies > 0 ? clamp((playableCopies / nonCurseCopies) * 100, 0, 100) : 0;
  const mechanicAxes = [...axisScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 7)
    .map(([axis]) => axis);
  const entriesWithRole = (role: ContentMechanicFeatures['roles'][number], limit: number) => compactUnique(
    featureEntries
      .filter(entry => entry.features.roles.includes(role))
      .sort((left, right) => right.quantity - left.quantity || left.label.localeCompare(right.label))
      .map(entry => featureSummary(entry.label, entry.features)),
    limit,
  );
  const resourceCounts = new Map<string, number>();
  featureEntries.forEach(entry => entry.features.resources.forEach(resource => {
    resourceCounts.set(resource, (resourceCounts.get(resource) || 0) + entry.quantity);
  }));
  const resourceLoops = compactUnique(
    [...resourceCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([resource]) => `资源:${resource}`),
    4,
  );
  const featureUnion = mergeContentMechanicFeatures(featureEntries.map(entry => entry.features));
  const extensionHooks = compactUnique(
    [
      ...featureUnion.statuses.map(status => `状态:${status}`),
      ...featureUnion.resources.map(resource => `资源:${resource}`),
      ...mechanicAxes,
    ],
    8,
  );
  return {
    deckSize: budget.deck,
    winCondition,
    engines,
    tempo,
    survival,
    economy,
    consistency: Math.round(consistency),
    complexity: Math.round(clamp((complexity / Math.max(1, budget.deck)) * 9, 0, 100)),
    mechanicAxes,
    enablers: entriesWithRole('启动', 4),
    payoffs: compactUnique([...entriesWithRole('收益', 4), ...entriesWithRole('终结', 2)], 5),
    bridges: entriesWithRole('桥接', 4),
    resourceLoops,
    riskHooks: entriesWithRole('风险', 3),
    extensionHooks,
  };
}

function rewardRoles(analysis: ContentAnalysis): string[] {
  return compactUnique(
    [
      ...(analysis.metrics.attack > 0 || analysis.dynamicMetrics.has('attack') ? ['输出'] : []),
      ...(analysis.metrics.defense > 0 || analysis.dynamicMetrics.has('defense') ? ['防护'] : []),
      ...(analysis.metrics.sustain > 0 || analysis.dynamicMetrics.has('sustain') ? ['续航'] : []),
      ...(analysis.metrics.draw > 0 || analysis.dynamicMetrics.has('draw') ? ['抽牌'] : []),
      ...(analysis.metrics.energy > 0 || analysis.dynamicMetrics.has('energy') ? ['资源'] : []),
      ...analysis.tags.filter(tag => !['固有', '保留', '能力'].includes(tag)),
    ],
    8,
  );
}

function rewardPower(analysis: ContentAnalysis): number {
  const dynamicBonus = analysis.dynamicMetrics.size * 1.5;
  return round(
    analysis.metrics.attack +
      analysis.metrics.defense * 0.85 +
      analysis.metrics.sustain +
      analysis.metrics.draw * 4 +
      analysis.metrics.energy * 5 +
      dynamicBonus,
    2,
  );
}

function rewardChoiceProfile(
  pack: ContentPack,
  build: BuildDesignProfile,
  candidates: readonly ContentDefinition[],
  maxHp: number,
): RewardChoiceDesignProfile | null {
  const normalized = candidates.filter(isRecord);
  if (normalized.length === 0) return null;
  const existingFingerprints = new Set(pack.cards.map(createContentMechanicsFingerprint));
  const existingStructures = new Set(pack.cards.map(createContentStructuralFingerprint));
  const resourcePool = {
    energy: 3,
    ...Object.fromEntries(Object.entries(normalizeCombatResourceStates(pack.playerResources || [])).map(([id, resource]) => [
      id,
      resource.refresh === 'reset' ? resource.max : resource.current,
    ])),
  };
  const profiles = normalized.map((candidate, index) => {
    const analysis = analyzeContentScenarios(candidate);
    const roles = rewardRoles(analysis);
    const fingerprint = createContentMechanicsFingerprint(candidate);
    const structuralFingerprint = createContentStructuralFingerprint(candidate);
    const features = extractContentMechanicFeatures(candidate);
    const synergyHits = roles.filter(role => build.engines.includes(role)).length;
    const evaluation = evaluateRewardCandidateArchetype({ pack, candidate, maxHp });
    return {
      id: String(candidate.id || candidate.name || `candidate_${index}`),
      fingerprint,
      structuralFingerprint,
      roles,
      axes: features.axes,
      power: rewardPower(analysis),
      complexity: complexityPoints(candidate),
      synergy: round(synergyHits / Math.max(1, build.engines.length), 2),
      novelty: round(evaluation.novelty / 100, 2),
      pathKind: evaluation.pathKind,
      deckScoreDelta: evaluation.deckScoreDelta,
      relativeDeckScoreDelta: evaluation.relativeDeckScoreDelta,
      candidatePowerScore: evaluation.candidatePowerScore,
      selectionValue: evaluation.selectionValue,
      archetypes: evaluation.affinities,
      pathScores: evaluation.pathScores,
      dimensionGains: Object.fromEntries(
        Object.entries(evaluation.dimensionGains).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
      ),
    } satisfies RewardCandidateDesignProfile;
  });
  const dominatedPairs: string[] = [];
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < normalized.length; rightIndex += 1) {
      if (leftIndex === rightIndex) continue;
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const leftProfile = profiles[leftIndex];
      const rightProfile = profiles[rightIndex];
      const leftAnalysis = analyzeContentScenarios(left);
      const rightAnalysis = analyzeContentScenarios(right);
      if (leftAnalysis.dynamicMetrics.size > 0 || rightAnalysis.dynamicMetrics.size > 0) continue;
      const leftCost = estimateCardCostWeight(left.cost ?? 0, resourcePool);
      const rightCost = estimateCardCostWeight(right.cost ?? 0, resourcePool);
      const metricKeys = ['attack', 'defense', 'sustain', 'draw', 'energy'] as const;
      const noWorse = metricKeys.every(key => leftAnalysis.metrics[key] >= rightAnalysis.metrics[key]);
      const strictlyBetter = metricKeys.some(key => leftAnalysis.metrics[key] > rightAnalysis.metrics[key]);
      const coversRoles = rightProfile.roles.every(role => leftProfile.roles.includes(role));
      if (
        noWorse &&
        strictlyBetter &&
        coversRoles &&
        leftCost <= rightCost &&
        leftProfile.complexity <= rightProfile.complexity
      ) {
        dominatedPairs.push(`${leftProfile.id}>${rightProfile.id}`);
      }
    }
  }
  return {
    candidateCount: profiles.length,
    uniqueMechanics: new Set(profiles.map(profile => profile.fingerprint)).size,
    uniqueStructures: new Set(profiles.map(profile => profile.structuralFingerprint)).size,
    distinctRoles: new Set(profiles.flatMap(profile => profile.roles)).size,
    dominatedPairs: compactUnique(dominatedPairs, 6),
    candidates: profiles,
  };
}

function rewardDiagnostics(reward: RewardChoiceDesignProfile | null): ContentDesignDiagnostic[] {
  if (!reward || reward.candidateCount < 2) return [];
  const diagnostics: ContentDesignDiagnostic[] = [];
  if (reward.uniqueStructures < reward.candidateCount) {
    diagnostics.push({
      code: 'REWARD_MECHANICAL_DUPLICATES',
      severity: 'risk',
      scope: 'reward',
      message: '奖励候选中存在机械结构相同或只调整数值、题材表现的选项。',
      suggestion: '只替换重复候选，保留其余内容，并让新候选改变实际操作、目标或成长轴。',
    });
  }
  if (reward.dominatedPairs.length > 0) {
    diagnostics.push({
      code: 'REWARD_STRICT_DOMINANCE',
      severity: 'advice',
      scope: 'reward',
      message: '奖励候选中存在费用与复杂度不高、但机械收益全面覆盖另一项的组合。',
      suggestion: '为被覆盖候选增加独特情境价值或代价交换，避免出现无需思考的唯一答案。',
    });
  }
  if (reward.candidateCount >= 3 && reward.distinctRoles < 2) {
    diagnostics.push({
      code: 'REWARD_LOW_DECISION_DIVERSITY',
      severity: 'advice',
      scope: 'reward',
      message: '多项奖励候选集中在同一种操作角色，选择差异可能不足。',
      suggestion: '不要求固定攻防配比，但至少让一项候选改变牌序、资源、目标、触发或成长方式。',
    });
  }
  return diagnostics;
}

function enemyActionWeights(enemy: ContentDefinition): WeightedAnalysis[] {
  const actions = Array.isArray(enemy.actions)
    ? enemy.actions.filter((entry): entry is ContentDefinition => isRecord(entry))
    : [];
  if (actions.length === 0) return [];
  const mode = String(enemy.action_mode || 'random');
  const root = isRecord(enemy.action_config) ? enemy.action_config : {};
  const config = isRecord(root[mode]) ? root[mode] : root;
  const sequence = Array.isArray(config.sequence) ? config.sequence.map(String) : [];
  const probability = isRecord(config.probability) ? config.probability : mode === 'probability' ? config : {};
  const rawWeights = actions.map(action => {
    const name = String(action.name || '');
    if ((mode === 'sequence' || mode === 'sequence_then_probability') && sequence.length > 0) {
      const occurrences = sequence.filter(entry => entry === name).length;
      if (occurrences > 0) return occurrences;
    }
    const configured = Number(probability[name]);
    if (configured > 0) return configured;
    const authored = Number(action.weight);
    return authored > 0 ? authored : 1;
  });
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0) || actions.length;
  return actions.map((definition, index) => ({
    definition,
    analysis: analyzeContentScenarios(definition),
    weight: rawWeights[index] / total,
  }));
}

function pressureProfile(expectedDamage: number, expectedLust: number, hasControl: boolean): EnemyDesignProfile['pressure'] {
  if (expectedDamage <= 0 && expectedLust <= 0) return hasControl ? '控制' : '未知';
  if (expectedDamage > 0 && expectedLust > 0 && Math.min(expectedDamage, expectedLust) / Math.max(expectedDamage, expectedLust) >= 0.25) return '混合';
  return expectedLust > expectedDamage ? '欲望' : '生命';
}

function enemyProfile(pack: ContentPack): EnemyDesignProfile | null {
  const enemies = meaningfulEnemies(pack);
  if (enemies.length === 0) return null;
  let expectedDamage = 0;
  let expectedLust = 0;
  let expectedBlock = 0;
  let peakDamage = 0;
  let desireFinishDamage = 0;
  let complexity = 0;
  let hasControl = false;
  let counterplayWindow = false;
  const vectors = new Set<string>();
  const modes = new Set<string>();
  const signatureParts: string[] = [];
  const dimensions = new Set<EnemyPressureDimension>();
  const actionProbabilities: number[] = [];
  const enemyRoles: string[] = [];
  const synergies = new Set<string>();
  const targetModes = new Set<string>();
  const actionOrder: string[] = [];
  const statusOwners = new Map<string, number>();

  if (enemies.length > 1) dimensions.add('群体');

  for (let enemyIndex = 0; enemyIndex < enemies.length; enemyIndex += 1) {
    const enemy = enemies[enemyIndex];
    const enemyLabel = definitionLabel(enemy, `敌人${enemyIndex + 1}`);
    const enemyFeatureValues: ContentMechanicFeatures[] = [];
    let enemyPeakDamage = 0;
    let enemyExpectedDamage = 0;
    let enemyExpectedLust = 0;
    let enemyExpectedBlock = 0;
    modes.add(String(enemy.action_mode || 'random'));
    if (['sequence', 'sequence_then_probability'].includes(String(enemy.action_mode || ''))) dimensions.add('阶段');
    const weighted = enemyActionWeights(enemy);
    for (const entry of weighted) {
      const features = extractContentMechanicFeatures(entry.definition);
      enemyFeatureValues.push(features);
      features.targets.forEach(target => targetModes.add(target));
      features.statuses.forEach(status => statusOwners.set(status, (statusOwners.get(status) || 0) + 1));
      actionProbabilities.push(entry.weight);
      expectedDamage += Math.max(0, entry.analysis.damage) * entry.weight;
      expectedLust += Math.max(0, entry.analysis.lust) * entry.weight;
      expectedBlock += Math.max(0, entry.analysis.metrics.defense) * entry.weight;
      enemyExpectedDamage += Math.max(0, entry.analysis.damage) * entry.weight;
      enemyExpectedLust += Math.max(0, entry.analysis.lust) * entry.weight;
      enemyExpectedBlock += Math.max(0, entry.analysis.metrics.defense) * entry.weight;
      enemyPeakDamage = Math.max(enemyPeakDamage, entry.analysis.damage);
      complexity += complexityPoints(entry.definition);
      const tags = compactUnique([...entry.analysis.tags, ...entry.analysis.statusIds.map(id => `状态:${id}`)], 4);
      hasControl ||= tags.some(tag => tag.startsWith('状态:') || ['弃牌', '消耗', '生成牌'].includes(tag));
      if (entry.analysis.damage > 0) dimensions.add('消耗');
      if (entry.analysis.lust > 0) dimensions.add('欲望');
      if (tags.some(tag => tag.startsWith('状态:'))) dimensions.add('控制');
      if (tags.some(tag => ['弃牌', '能量', '检索', '预见', '取回'].includes(tag))) dimensions.add('资源');
      if (tags.includes('生成牌')) dimensions.add('牌库污染');
      if (complexityPoints(entry.definition) > 0 && /(?:current_turn|stacks|cards_played|spent_energy)/.test(JSON.stringify(entry.definition))) {
        dimensions.add('成长');
      }
      if (entry.definition.trigger !== undefined || entry.definition.when !== undefined) dimensions.add('反应');
      const isSetup = entry.analysis.damage <= 0 && entry.analysis.lust <= 0;
      counterplayWindow ||= isSetup || entry.analysis.metrics.defense > 0;
      vectors.add(
        [
          entry.analysis.damage > 0 ? '伤' : '',
          entry.analysis.lust > 0 ? '欲' : '',
          entry.analysis.metrics.defense > 0 ? '防' : '',
          tags.some(tag => tag.startsWith('状态:')) ? '控' : '',
        ]
          .filter(Boolean)
          .join('+') || '准备',
      );
      signatureParts.push(...tags);
    }
    const desire = isRecord(enemy.lust_effect) ? analyzeContentScenarios(enemy.lust_effect) : null;
    if (desire) {
      enemyPeakDamage = Math.max(enemyPeakDamage, desire.damage);
      desireFinishDamage = Math.max(desireFinishDamage, desire.damage);
      complexity += complexityPoints(enemy.lust_effect);
      signatureParts.push(...desire.tags);
      enemyFeatureValues.push(extractContentMechanicFeatures(enemy.lust_effect));
    }
    const abilityDefinitions = Array.isArray(enemy.abilities) ? enemy.abilities.filter(isRecord) : [];
    abilityDefinitions.forEach(ability => enemyFeatureValues.push(extractContentMechanicFeatures(ability)));
    const enemyFeatures = mergeContentMechanicFeatures(enemyFeatureValues);
    enemyFeatures.targets.forEach(target => targetModes.add(target));
    enemyFeatures.statuses.forEach(status => statusOwners.set(status, (statusOwners.get(status) || 0) + 1));
    const roles = compactUnique([
      ...(enemyExpectedDamage > 0 || enemyExpectedLust > 0 ? ['压制'] : []),
      ...(enemyExpectedBlock > 0 || enemyFeatures.operations.includes('heal') ? ['支援'] : []),
      ...(enemyFeatures.axes.includes('状态') ? ['控制'] : []),
      ...(enemyFeatures.axes.includes('召唤') ? ['召唤'] : []),
      ...(enemyFeatures.axes.includes('牌库污染') || enemyFeatures.operations.some(op => ['add_card', 'ensure_card', 'attach_card'].includes(op)) ? ['牌库干扰'] : []),
      ...(['sequence', 'sequence_then_probability'].includes(String(enemy.action_mode || '')) ? ['阶段'] : []),
      ...(abilityDefinitions.length > 0 ? ['反应'] : []),
    ], 4);
    enemyRoles.push(`${enemyLabel}:${roles.join('+') || '准备'}`);
    peakDamage += Math.max(0, enemyPeakDamage);
    const priority = Number.isFinite(enemy.action_priority) ? Number(enemy.action_priority) : 0;
    const speed = Number.isFinite(enemy.speed) ? Number(enemy.speed) : 0;
    actionOrder.push(`${enemyLabel}(优先${priority}/速度${speed})`);
    if (enemyFeatures.axes.includes('召唤')) synergies.add('召唤或增援改变场上数量');
    if (abilityDefinitions.length > 1) synergies.add('同一敌人具有多个独立被动');
  }
  if (enemies.length > 1 && enemyRoles.some(role => /支援/.test(role))) synergies.add('支援者保护或强化其他敌人');
  if ([...statusOwners.values()].some(count => count > 1)) synergies.add('多个单位围绕共享状态形成联动');
  if (enemies.length > 1 && actionOrder.some(entry => !/优先0\/速度0/.test(entry))) synergies.add('行动优先级与速度形成稳定组合');
  if (peakDamage >= Math.max(10, expectedDamage * 1.75)) dimensions.add('爆发');
  const pressure = pressureProfile(expectedDamage, expectedLust, hasControl);
  const cadence = [...modes].sort().join('+') || 'random';
  const mechanics = compactUnique(signatureParts, 2);
  const pressureDimensions = [...dimensions];
  const signatureMechanics = compactUnique([...pressureDimensions, ...mechanics], 3);
  const structuralSignature = createContentStructuralFingerprint({ enemies }).split(':')[1] || 'unknown';
  const signature = `${pressure}/${cadence}/${signatureMechanics.length ? signatureMechanics.join('+') : [...vectors].sort().join('+') || '直接行动'}#${structuralSignature}`;
  const actionEntropy = actionProbabilities.reduce(
    (sum, probability) => sum - (probability > 0 ? probability * Math.log2(probability) : 0),
    0,
  ) / Math.max(1, enemies.length);
  return {
    signature,
    pressure,
    dimensions: pressureDimensions,
    cadence,
    expectedDamage: round(expectedDamage),
    expectedLust: round(expectedLust),
    expectedBlock: round(expectedBlock),
    peakDamage: round(peakDamage),
    desireFinishDamage: round(desireFinishDamage),
    actionDiversity: vectors.size,
    actionEntropy: round(actionEntropy, 2),
    maxActionProbability: round(actionProbabilities.length ? Math.max(...actionProbabilities) : 0, 2),
    complexity: Math.round(clamp((complexity / Math.max(1, [...vectors].length)) * 5, 0, 100)),
    counterplayWindow,
    enemyCount: enemies.length,
    roles: enemyRoles,
    synergies: [...synergies],
    targetModes: [...targetModes],
    actionOrder,
  };
}

function createEncounterDesignPlan(enemy: EnemyDesignProfile | null): EncounterDesignPlan | null {
  if (!enemy) return null;
  const guidance = compactUnique([
    ...(enemy.enemyCount > 1 ? ['让多个敌人的职责、目标和击杀顺序可读，避免所有单位只做同类数值攻击'] : []),
    ...(enemy.synergies.length ? ['协同必须能从行动、被动或状态效果中直接看出，并保留拆解顺序'] : []),
    ...(enemy.targetModes.some(mode => mode !== 'self' && mode !== 'opponent') ? ['多目标与随机目标规则必须明确，不能依赖叙事猜测指向'] : []),
    ...(!enemy.counterplayWindow ? ['补充可观察的准备、守势、阶段切换或其他反制窗口'] : []),
  ], 4);
  return {
    enemyCount: enemy.enemyCount,
    roles: enemy.roles,
    synergies: enemy.synergies,
    targetModes: enemy.targetModes,
    actionOrder: enemy.actionOrder,
    guidance,
  };
}

function forecastEncounter(
  pack: ContentPack,
  budget: BuildBudget,
  enemy: EnemyDesignProfile | null,
  player: ContentDesignAssistantInput['player'],
  danger: number,
): EncounterForecast | null {
  if (!enemy) return null;
  const enemies = meaningfulEnemies(pack);
  const totalHp = enemies.reduce((sum, entry) => {
    const hp = Number(entry.hp ?? entry.max_hp);
    return sum + (Number.isFinite(hp) ? Math.max(0, hp) : 0);
  }, 0);
  const targetTurns = TARGET_TURNS[Math.max(1, Math.min(3, danger))] || TARGET_TURNS[1];
  const effectiveAttack = Math.max(0, budget.attack - Math.min(enemy.expectedBlock, budget.attack * 0.65));
  const expectedVictoryTurns = effectiveAttack > 0 ? totalHp / effectiveAttack : null;
  const hpNetPressure = Math.max(0, enemy.expectedDamage - budget.defense - budget.sustain * 0.5);
  const currentHp = clamp(Number(player.hp), 0, Math.max(1, Number(player.maxHp) || 1));
  const hpSurvival = hpNetPressure > 0 ? currentHp / hpNetPressure : Number.POSITIVE_INFINITY;
  const maxLust = Math.max(1, Number(player.maxLust) || 100);
  const currentLust = clamp(Number(player.lust) || 0, 0, maxLust);
  const lustSurvival = enemy.expectedLust > 0 ? Math.max(0, maxLust - currentLust) / enemy.expectedLust : Number.POSITIVE_INFINITY;
  const survival = Math.min(hpSurvival, lustSurvival);
  const expectedSurvivalTurns = Number.isFinite(survival) ? survival : null;
  let challenge: EncounterChallengeBand = 'unknown';
  if (expectedVictoryTurns !== null) {
    const survivalRatio = expectedSurvivalTurns === null ? Number.POSITIVE_INFINITY : expectedSurvivalTurns / Math.max(0.5, expectedVictoryTurns);
    if (survivalRatio < 0.8 || enemy.peakDamage >= currentHp * 0.9) challenge = 'severe';
    else if (survivalRatio < 1.5 || expectedVictoryTurns > targetTurns[1] * 1.35) challenge = 'tense';
    else if (expectedVictoryTurns < targetTurns[0] * 0.65 || survivalRatio > 4) challenge = 'light';
    else challenge = 'fair';
  }
  const dynamic = [...pack.cards, ...enemies.flatMap(entry => (Array.isArray(entry.actions) ? entry.actions : []))]
    .map(entry => analyzeContentScenarios(entry))
    .some(analysis => analysis.dynamicMetrics.size > 0);
  return {
    challenge,
    expectedVictoryTurns: expectedVictoryTurns === null ? null : round(expectedVictoryTurns),
    expectedSurvivalTurns: expectedSurvivalTurns === null ? null : round(expectedSurvivalTurns),
    targetTurns,
    confidence: dynamic ? 'low' : pack.statuses.length > 0 ? 'medium' : 'high',
  };
}

function strongStatusForDesire(pack: ContentPack, statusId: string): boolean {
  const definition = pack.statuses.find(status => String(status.id || '') === statusId);
  if (!definition) return false;
  const analysis = analyzeContentScenarios(definition);
  const features = extractContentMechanicFeatures(definition);
  const decisiveOperation = features.operations.some(operation =>
    ['kill', 'execute', 'spawn_summon', 'spawn_enemy', 'extra_turn'].includes(operation),
  );
  const strongModifier = analysis.modifiers.some(modifier =>
    (modifier.operator === 'multiply' && Math.abs(modifier.value) >= 1.5) ||
    ((modifier.operator === 'add' || modifier.operator === 'subtract') && Math.abs(modifier.value) >= 4) ||
    modifier.operator === 'set',
  );
  return decisiveOperation || strongModifier || analysis.dynamicMetrics.size > 0 ||
    analysis.damage >= 8 || analysis.metrics.defense >= 10 || analysis.metrics.sustain >= 10;
}

function desireEffectIsDecisive(
  effect: ContentDefinition | null,
  pack: ContentPack,
  targetMaxHp: number,
): boolean {
  if (!effect) return false;
  const analysis = analyzeContentScenarios(effect);
  const features = extractContentMechanicFeatures(effect);
  const operations = new Set(features.operations);
  const threshold = Math.max(14, targetMaxHp * 0.18);
  if (analysis.damage >= threshold) return true;
  if (analysis.dynamicMetrics.has('attack') && operations.has('damage')) return true;
  if (['kill', 'execute', 'spawn_summon', 'spawn_enemy', 'extra_turn'].some(operation => operations.has(operation))) return true;
  if (analysis.metrics.defense + analysis.metrics.sustain >= Math.max(16, targetMaxHp * 0.2)) return true;
  if (analysis.metrics.energy >= 2 && analysis.metrics.draw >= 2) return true;
  return analysis.statusIds.some(statusId => strongStatusForDesire(pack, statusId));
}

function assessDiagnostics(
  pack: ContentPack,
  build: BuildDesignProfile,
  enemy: EnemyDesignProfile | null,
  forecast: EncounterForecast | null,
  budget: BuildBudget,
  player: ContentDesignAssistantInput['player'],
  recentSignatures: readonly string[],
  simulation: EncounterShadowSimulation | null,
): ContentDesignDiagnostic[] {
  const diagnostics: ContentDesignDiagnostic[] = [];
  const hasPressure = pack.cards.some(card => hasContentMetric(analyzeContentScenarios(card), 'attack'));
  if (!hasPressure) {
    diagnostics.push({
      code: 'BUILD_ENDGAME_UNCERTAIN',
      severity: 'risk',
      scope: 'build',
      message: '当前构筑未识别到可持续的生命或欲望胜利手段。',
      suggestion: '后续成长优先提供与现有主题相连的终局手段，不要求改成传统攻击牌。',
    });
  }
  if (build.consistency < 45) {
    diagnostics.push({
      code: 'BUILD_LOW_CONSISTENCY',
      severity: 'advice',
      scope: 'build',
      message: '基础三能量下的稳定可用牌占比较低。',
      suggestion: '奖励可补牌序、费用或检索桥接，不必强行增加防御或治疗。',
    });
  }
  if (!enemy || !forecast) return diagnostics;
  const currentHp = Math.max(0, Number(player.hp) || 0);
  if (enemy.peakDamage >= currentHp * 0.9 && currentHp > 0) {
    diagnostics.push({
      code: 'ENCOUNTER_OPENING_LETHAL',
      severity: 'critical',
      scope: 'encounter',
      message: '敌方单次峰值接近玩家当前生命，存在无准备秒杀风险。',
      suggestion: '降低首轮峰值或给出明确预兆与可执行的反制窗口。',
    });
  }
  if (forecast.challenge === 'severe') {
    diagnostics.push({
      code: 'ENCOUNTER_OVERPRESSURED',
      severity: 'risk',
      scope: 'encounter',
      message: '按当前构筑估算，玩家通常会在完成主要胜利循环前被压垮。',
      suggestion: '优先调整首轮压力、成长速度或防御覆盖，不重写敌人的剧情主题。',
    });
  } else if (forecast.challenge === 'light') {
    diagnostics.push({
      code: 'ENCOUNTER_LOW_PRESSURE',
      severity: 'advice',
      scope: 'encounter',
      message: '本场可能过快结束或几乎无法威胁当前构筑。',
      suggestion: '增加与构筑相关的副机制、阶段变化或有限反制，而非只堆生命。',
    });
  }
  if (enemy.actionDiversity <= 1) {
    diagnostics.push({
      code: 'ENEMY_REPETITIVE_ACTIONS',
      severity: 'advice',
      scope: 'enemy',
      message: '敌方行动在功能上高度重复。',
      suggestion: '保留主压力，并增加一种能改变决策的副机制或节奏变化。',
    });
  }
  if (!enemy.counterplayWindow && (enemy.expectedDamage > budget.defense || enemy.expectedLust > 0)) {
    diagnostics.push({
      code: 'ENEMY_NO_COUNTERPLAY_WINDOW',
      severity: 'risk',
      scope: 'enemy',
      message: '敌方每次行动都在持续施压，未识别到观察或反制窗口。',
      suggestion: '加入可读的准备、守势、阶段切换或其他可利用窗口。',
    });
  }
  if (enemy.expectedDamage <= 0 && enemy.expectedLust > 0 && enemy.desireFinishDamage <= 0) {
    diagnostics.push({
      code: 'ENEMY_NO_DEFEAT_PRESSURE',
      severity: 'risk',
      scope: 'enemy',
      message: '敌方能积累欲望压力，但欲望满溢效果没有发现可结束战斗的机械后果。',
      suggestion: '保留欲望主题，为满溢效果或少量行动加入可持续的生命伤害、升级压力或其他实际终结渠道。',
    });
  }
  const enemies = meaningfulEnemies(pack);
  enemies.forEach((definition, index) => {
    const desireEffect = isRecord(definition.lust_effect) ? definition.lust_effect : null;
    if (desireEffectIsDecisive(desireEffect, pack, Math.max(1, Number(player.maxHp) || 100))) return;
    diagnostics.push({
      code: 'ENEMY_LUST_EFFECT_UNDERPOWERED',
      severity: 'risk',
      scope: 'enemy',
      message: `${definitionLabel(definition, `敌人${index + 1}`)}的欲望满溢效果不足以形成决定战局的收益。`,
      suggestion: '把欲望满溢效果提升为可执行的终极效果：高额伤害、强力状态、强力召唤、额外回合、处决或明确终局之一；不能只给少量普通数值。',
    });
  });
  const enemyTargetHp = enemies.length
    ? enemies.reduce((sum, definition) => sum + Math.max(1, Number(definition.max_hp) || 1), 0) / enemies.length
    : 60;
  if (pack.desireEffects.player && !desireEffectIsDecisive(pack.desireEffects.player, pack, enemyTargetHp)) {
    diagnostics.push({
      code: 'PLAYER_LUST_EFFECT_UNDERPOWERED',
      severity: 'risk',
      scope: 'build',
      message: '玩家欲望满溢效果相对其高触发门槛过弱。',
      suggestion: '保持现有构筑主题，把玩家欲望满溢效果提升为足以逆转或结束战局的终极收益。',
    });
  }
  if (enemy.maxActionProbability > 0.75 && enemy.actionEntropy < 1 && enemy.actionDiversity >= 3) {
    diagnostics.push({
      code: 'ENEMY_LOW_ACTION_ENTROPY',
      severity: 'advice',
      scope: 'enemy',
      message: '敌方虽然有多种行动，但概率过度集中，实战中可能仍像重复单一动作。',
      suggestion: '保留招牌行动，适度提高副机制出现频率或改用可读的阶段节奏。',
    });
  }
  const repeats = recentSignatures.filter(signature => signature === enemy.signature).length;
  if (repeats >= 1) {
    diagnostics.push({
      code: 'ENEMY_RECENTLY_REPEATED',
      severity: 'advice',
      scope: 'variety',
      message: '本场的主要压力、行动节奏与近期遭遇重复。',
      suggestion: '下场至少改变主要压力、行动逻辑、场上目标、状态节奏或胜负条件中的两项。',
    });
  }
  if (enemy.complexity > 78) {
    diagnostics.push({
      code: 'ENEMY_COMPLEXITY_OVERLOAD',
      severity: 'risk',
      scope: 'enemy',
      message: '单场同时承载的条件、触发与状态较多，可能削弱可读性。',
      suggestion: '围绕一个主机制和一个副机制收束，其余复杂度留给后续阶段。',
    });
  }
  if (simulation && simulation.confidence !== 'low') {
    const noPlayableRate = Math.max(...simulation.strategies.map(result => result.noPlayableTurnRate));
    if (simulation.skilledWinRate < 0.35) {
      diagnostics.push({
        code: 'SHADOW_LOW_WIN_RATE',
        severity: 'risk',
        scope: 'encounter',
        message: `确定性影子测试中，构筑感知策略胜率约为${Math.round(simulation.skilledWinRate * 100)}%。`,
        suggestion: '降低前期压力或增强可观察反制；不要用重建玩家牌组来修正。',
      });
    } else if (simulation.strategies.every(result => result.winRate > 0.96)) {
      diagnostics.push({
        code: 'SHADOW_TRIVIAL_ACROSS_STRATEGIES',
        severity: 'advice',
        scope: 'encounter',
        message: '多种简单策略都几乎必胜，当前战斗可能缺少真实取舍。',
        suggestion: '增加机制压力或阶段变化，避免只给敌人加生命。',
      });
    }
    if (noPlayableRate > 0.25) {
      diagnostics.push({
        code: 'SHADOW_FREQUENT_DEAD_TURNS',
        severity: 'risk',
        scope: 'build',
        message: '影子测试出现较多无牌可打回合。',
        suggestion: '后续成长优先提供费用、牌序或检索桥接，同时保留当前构筑身份。',
      });
    }
    if (simulation.strategySpread < 0.04 && simulation.skilledWinRate > 0.35 && simulation.skilledWinRate < 0.95) {
      diagnostics.push({
        code: 'SHADOW_LOW_STRATEGY_SPREAD',
        severity: 'advice',
        scope: 'encounter',
        message: '不同出牌倾向的结果非常接近，技巧空间可能有限。',
        suggestion: '增加一个读取意图后会改变出牌优先级的决策点。',
      });
    }
  }
  return diagnostics;
}

function outcomeDirection(outcome: BattleOutcomeFeedback | undefined): string {
  if (!outcome) return '';
  if (outcome.outcome === 'defeat' && outcome.turns <= 3) return '上局过早战败：降低首轮爆发并强化预兆。';
  if (outcome.outcome === 'defeat') return '上局战败：保留挑战，但给现有构筑更清楚的反制窗口。';
  if (outcome.outcome === 'victory' && outcome.turns <= 4 && outcome.hpRatio >= 0.65)
    return '上局轻松速胜：可提升一档机制压力，避免只增加生命。';
  if (outcome.outcome === 'victory' && outcome.hpRatio <= 0.25)
    return '上局险胜：维持强度，奖励优先提供与现有主题相连的稳定性。';
  return '沿用当前挑战带，并优先制造新的决策。';
}

function sameOutcome(left: BattleOutcomeFeedback | undefined, right: BattleOutcomeFeedback | undefined): boolean {
  return Boolean(
    left &&
      right &&
      left.outcome === right.outcome &&
      left.turns === right.turns &&
      left.hpRatio === right.hpRatio &&
      left.lustRatio === right.lustRatio,
  );
}

function updatePerformance(
  previous: BattlePerformanceSummary | undefined,
  outcome: BattleOutcomeFeedback | undefined,
  previousOutcome: BattleOutcomeFeedback | undefined,
): BattlePerformanceSummary | undefined {
  if (!outcome || sameOutcome(outcome, previousOutcome)) return previous;
  const battles = Math.min(999, Math.max(0, Math.floor(Number(previous?.battles) || 0)) + 1);
  const alpha = battles <= 3 ? 1 / battles : 0.3;
  const blend = (prior: number | undefined, current: number): number =>
    round(battles === 1 || prior === undefined ? current : prior * (1 - alpha) + current * alpha, 3);
  const ewmaWinRate = blend(previous?.ewmaWinRate, outcome.outcome === 'victory' ? 1 : 0);
  const ewmaTurns = blend(previous?.ewmaTurns, Math.max(0, outcome.turns));
  const ewmaHpRatio = blend(previous?.ewmaHpRatio, clamp(outcome.hpRatio, 0, 1));
  const ewmaLustRatio = blend(previous?.ewmaLustRatio, clamp(outcome.lustRatio, 0, 1));
  const pressureFactor =
    battles < 3
      ? 1
      : round(clamp(1 + (ewmaWinRate - 0.68) * 0.18 + (ewmaHpRatio - 0.4) * 0.08, 0.92, 1.08), 3);
  return { battles, ewmaWinRate, ewmaTurns, ewmaHpRatio, ewmaLustRatio, pressureFactor };
}

function adaptEnemyBudget(
  budget: EnemyBudget,
  outcome: BattleOutcomeFeedback | undefined,
  performance: BattlePerformanceSummary | undefined,
): EnemyBudget {
  const recentFactor =
    outcome?.outcome === 'defeat' && outcome.turns <= 3
      ? 0.9
      : outcome?.outcome === 'defeat'
        ? 0.95
        : outcome?.outcome === 'victory' && outcome.turns <= 4 && outcome.hpRatio >= 0.65
          ? 1.08
          : 1;
  const factor = clamp(recentFactor * (performance?.pressureFactor || 1), 0.85, 1.15);
  const scale = (value: number, minimum: number): number => Math.max(minimum, Math.round(value * factor));
  const hpMin = scale(budget.hpMin, 1);
  const hpMax = Math.max(hpMin + 3, scale(budget.hpMax, hpMin + 3));
  const hitMin = scale(budget.hitMin, 1);
  const hitMax = Math.max(hitMin + 2, scale(budget.hitMax, hitMin + 2));
  return { hpMin, hpMax, hitMin, hitMax };
}

function formatBrief(
  build: BuildDesignProfile,
  budget: EnemyBudget,
  diagnostics: readonly ContentDesignDiagnostic[],
  recentSignatures: readonly string[],
  outcome: BattleOutcomeFeedback | undefined,
  guidance: BuildGuidance,
  simulation: EncounterShadowSimulation | null,
  rewardPlan: RewardDesignPlan,
  encounterPlan: EncounterDesignPlan | null,
  previousAdvice = '',
  performance?: BattlePerformanceSummary,
): string {
  const engine = build.engines.length ? build.engines.join('+') : '尚未成形';
  const priority = diagnostics.find(entry => entry.severity === 'critical') || diagnostics.find(entry => entry.severity === 'risk');
  const history = recentSignatures.length ? `近期敌人：${recentSignatures.slice(-3).join('；')}。` : '';
  return [
    `构筑：${build.winCondition}取胜，主轴${engine}，机械${build.mechanicAxes.slice(0, 4).join('+') || '尚未成形'}，节奏${build.tempo}，生存${build.survival}，资源${build.economy}。`,
    `普通遭遇软参考：总生命${budget.hpMin}~${budget.hpMax}，常规单次生命伤害${budget.hitMin}~${budget.hitMax}；数值须服从剧情中的先手伤势与当前状态。`,
    outcomeDirection(outcome),
    performance && performance.battles >= 3
      ? `近${performance.battles}战校准：平滑胜率${Math.round(performance.ewmaWinRate * 100)}%，下一战压力系数${performance.pressureFactor}。`
      : '',
    simulation && simulation.confidence !== 'low'
      ? `影子测试${simulation.seeds}种子：构筑策略胜率${Math.round(simulation.skilledWinRate * 100)}%，直接进攻胜率${Math.round(simulation.greedyWinRate * 100)}%，只作软校准。`
      : '',
    `成长候选保持不同作用：${guidance.roles.join('、')}；这是选择空间，不是硬配比。`,
    `奖励软方向：${rewardPlan.directions.map(entry => entry.direction).join('；')}。`,
    encounterPlan && encounterPlan.enemyCount > 1
      ? `多敌：${encounterPlan.roles.join('；')}${encounterPlan.synergies.length ? `；协同${encounterPlan.synergies.join('、')}` : ''}。`
      : '',
    '双方欲望满溢都是高门槛终极节点，收益必须足以逆转或决定胜负，并由可执行效果落实。',
    priority
      ? `优先修正：${priority.suggestion}`
      : previousAdvice
        ? `延续校准：${previousAdvice}`
        : '敌人围绕一个主压力、一个副机制和至少一个可读反制窗口展开。',
    history,
    '这些是程序估算的软建议；不得据此重建玩家构筑、覆盖剧情事实或限制题材表现。',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Host-neutral design director. It estimates rather than simulates and never mutates content.
 * Contract validity remains the hard gate; these diagnostics guide generation and bounded repair.
 */
export function assessContentDesign(input: ContentDesignAssistantInput): ContentDesignAssessment {
  const danger = Math.max(1, Math.min(3, Number(input.danger) || 1));
  const act = Math.max(1, Math.floor(Number(input.act) || 1));
  const previous = normalizePrevious(input.previous);
  const difficultyPercent = normalizeDifficultyPercent(
    input.difficultyPercent ?? previous.settings?.difficultyPercent ?? 80,
  );
  const autoCalibration = input.autoCalibration ?? previous.settings?.autoCalibration ?? false;
  const previousSignatures = Array.isArray(previous.recentEnemySignatures)
    ? compactUnique(previous.recentEnemySignatures.map(String), 3)
    : [];
  const previousRewardStructures = Array.isArray(previous.recentRewardStructures)
    ? compactUnique(previous.recentRewardStructures.map(String), 8)
    : [];
  const fingerprint = createContentMechanicsFingerprint(input.pack);
  const deckPower = scoreDeckPower({
    pack: input.pack,
    maxHp: input.player.maxHp,
    fullHealthBudget: input.budget,
  });
  const difficulty = createDifficultyBudget({
    deck: deckPower,
    difficultyPercent,
    currentHp: input.player.hp,
    currentLust: input.player.lust,
    maxLust: input.player.maxLust,
  });
  const previousDeckProfile = previous.balance?.deckProfile;
  const previousDeckProfileIsCurrent = Boolean(
    previousDeckProfile
      && previousDeckProfile.fingerprint === createDeckPowerProfileFingerprint({
        pack: input.pack,
        maxHp: input.player.maxHp,
        maxLust: input.player.maxLust,
        seeds: previousDeckProfile.seeds || 8,
      }),
  );
  const deckPowerProfile = input.deckPowerProfile
    || (previousDeckProfileIsCurrent ? previousDeckProfile : undefined);
  const targetEnvelope = deckPowerProfile
    ? createEnemyBudgetEnvelope({
        profile: deckPowerProfile,
        requestedRatio: difficultyPercent,
        currentHp: input.player.hp,
        currentLust: input.player.lust,
        maxLust: input.player.maxLust,
        inheritedMechanics: previous.lineage?.recentEnemies?.at(-1)?.themeAxes,
      })
    : undefined;
  const enemyPower = scoreEnemyPower(input.pack);
  const previousProgramCalibration = previous.balance?.programCalibration;
  const programCalibration = previousProgramCalibration && enemyPower
    && previousProgramCalibration.enemyFingerprint === enemyPower.fingerprint
    && previousProgramCalibration.requestedRatio === difficultyPercent
    ? previousProgramCalibration
    : undefined;
  const calibration = enemyPower ? calibrateEnemyPower(deckPower, enemyPower, difficultyPercent) : null;
  const baseArchetypes = profileDeckArchetypes(input.pack);
  const contributionById = new Map(
    profileDeckCardContributions({ pack: input.pack, maxHp: input.player.maxHp })
      .map(entry => [entry.id, entry]),
  );
  const archetypes: DeckArchetypeProfile = {
    ...baseArchetypes,
    cards: baseArchetypes.cards.map(card => {
      const contribution = contributionById.get(card.id);
      return contribution
        ? {
            ...card,
            scoreContribution: contribution.scoreContribution,
            scoreContributionRatio: contribution.scoreContributionRatio,
          }
        : card;
    }),
  };
  const lineage = updateEncounterLineageMemory(previous.lineage, input.pack);
  const build = buildProfile(input.pack, input.budget);
  const reward = rewardChoiceProfile(input.pack, build, input.rewardCandidates || [], input.player.maxHp);
  const rewardPlan = createRewardArchetypePlan({
    pack: input.pack,
    maxHp: input.player.maxHp,
    recentStructures: previousRewardStructures,
  });
  const enemy = enemyProfile(input.pack);
  const encounterPlan = createEncounterDesignPlan(enemy);
  const forecast = forecastEncounter(input.pack, input.budget, enemy, input.player, danger);
  const simulation = enemy
    ? simulateEncounterShadow({ pack: input.pack, player: input.player, seeds: input.simulationSeeds ?? 24 })
    : null;
  const outcome = input.outcome || previous.lastBattle;
  const performance = updatePerformance(previous.performance, input.outcome, previous.lastBattle);
  const budget = adaptEnemyBudget(
    recommendEnemyBudget(input.budget, danger as 1 | 2 | 3, act),
    outcome,
    performance,
  );
  const guidance = recommendBuildGuidance(input.pack, input.budget);
  const comparisonSignatures =
    previous.fingerprint === fingerprint && enemy?.signature && previous.lastEncounter?.signature === enemy.signature
      ? previousSignatures.slice(0, -1)
      : previousSignatures;
  const diagnostics = [
    ...assessDiagnostics(
    input.pack,
    build,
    enemy,
    forecast,
    input.budget,
    input.player,
    comparisonSignatures,
    simulation,
    ),
    ...rewardDiagnostics(reward),
  ];
  const recentEnemySignatures = [...previousSignatures];
  if (enemy?.signature && recentEnemySignatures.at(-1) !== enemy.signature) recentEnemySignatures.push(enemy.signature);
  while (recentEnemySignatures.length > 3) recentEnemySignatures.shift();
  const recentRewardStructures = [...previousRewardStructures];
  for (const candidate of reward?.candidates || []) {
    if (!recentRewardStructures.includes(candidate.structuralFingerprint)) {
      recentRewardStructures.push(candidate.structuralFingerprint);
    }
  }
  while (recentRewardStructures.length > 8) recentRewardStructures.shift();
  const context: ContentDesignContext = {
    spec: CONTENT_DESIGN_CONTEXT_SPEC,
    fingerprint,
    build,
    brief: [
      formatBrief(
        build,
        budget,
        diagnostics,
        recentEnemySignatures,
        outcome,
        guidance,
        simulation,
        rewardPlan,
        encounterPlan,
        previous.lastEncounter?.priorityAdvice,
        performance,
      ),
      targetEnvelope
        ? `程序模拟评分：玩家${deckPowerProfile?.totalScore}分，目标${targetEnvelope.effectiveRatio}%=${targetEnvelope.targetScore}分；敌人有效耐久建议${targetEnvelope.durability.hp.min}~${targetEnvelope.durability.hp.max}，预计${targetEnvelope.targetTurns[0]}~${targetEnvelope.targetTurns[1]}回合。`
        : `程序快速评分：玩家${deckPower.totalScore}分，目标${difficultyPercent}%=${difficulty.targetEnemyScore}分；敌人总生命建议${difficulty.enemyHp.min}~${difficulty.enemyHp.max}，常规行动生命伤害${difficulty.expectedActionDamage.min}~${difficulty.expectedActionDamage.max}。`,
      archetypes.affinities.length
        ? `构筑倾向：${archetypes.affinities.slice(0, 4).map(entry => `${entry.label}${entry.share}%`).join('、')}；散卡${archetypes.scatterShare}%。`
        : '构筑尚未形成稳定流派，允许通用散卡与渐进桥接。',
    ].join(' '),
    recentEnemySignatures,
    recentRewardStructures,
    rewardPlan,
    settings: { difficultyPercent, autoCalibration },
    balance: {
      deck: deckPower,
      target: difficulty,
      ...(deckPowerProfile ? { deckProfile: deckPowerProfile } : {}),
      ...(targetEnvelope ? { targetEnvelope } : {}),
      ...(programCalibration ? { programCalibration } : {}),
      ...(enemyPower ? { enemy: enemyPower } : {}),
      ...(calibration ? { calibration } : {}),
    },
    archetypes,
    lineage: createEncounterLineagePromptView(lineage, input.pack),
    ...(encounterPlan ? { encounterPlan } : {}),
    ...(outcome ? { lastBattle: outcome } : {}),
    ...(performance ? { performance } : {}),
    ...(reward
      ? {
          rewardReview: {
            candidateCount: reward.candidateCount,
            uniqueMechanics: reward.uniqueMechanics,
            uniqueStructures: reward.uniqueStructures,
            distinctRoles: reward.distinctRoles,
            diagnosticCodes: diagnostics.filter(entry => entry.scope === 'reward').map(entry => entry.code),
            candidates: reward.candidates.map(candidate => ({
              id: candidate.id,
              pathKind: candidate.pathKind,
              deckScoreDelta: candidate.deckScoreDelta,
              selectionValue: candidate.selectionValue,
              archetypes: candidate.archetypes,
            })),
          },
        }
      : {}),
    ...(enemy && forecast
      ? {
          lastEncounter: {
            signature: enemy.signature,
            challenge: forecast.challenge,
            expectedVictoryTurns: forecast.expectedVictoryTurns,
            diagnosticCodes: diagnostics.map(entry => entry.code).slice(0, 8),
            ...(diagnostics.find(entry => entry.severity === 'critical' || entry.severity === 'risk')?.suggestion
              ? {
                  priorityAdvice: diagnostics.find(
                    entry => entry.severity === 'critical' || entry.severity === 'risk',
                  )?.suggestion,
                }
              : {}),
            ...(simulation
              ? {
                  shadow: {
                    confidence: simulation.confidence,
                    skilledWinRate: simulation.skilledWinRate,
                    greedyWinRate: simulation.greedyWinRate,
                    strategySpread: simulation.strategySpread,
                  },
                }
              : {}),
          },
        }
      : previous.lastEncounter
        ? { lastEncounter: previous.lastEncounter }
        : {}),
  };
  return {
    build,
    enemy,
    forecast,
    reward,
    rewardPlan,
    encounterPlan,
    budget,
    diagnostics,
    simulation,
    deckPower,
    deckPowerProfile: deckPowerProfile || null,
    enemyEnvelope: targetEnvelope || null,
    enemyPower,
    difficulty,
    calibration,
    archetypes,
    lineage,
    context,
  };
}

export function formatContentDesignDiagnostics(
  diagnostics: readonly ContentDesignDiagnostic[],
  limit = 4,
): string {
  return diagnostics
    .slice(0, Math.max(0, limit))
    .map(entry => `${entry.severity}:${entry.code} ${entry.message}`)
    .join('；');
}
