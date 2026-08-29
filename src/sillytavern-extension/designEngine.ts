import {
  calibrateEncounterNumbers,
  createContentMechanicsFingerprint,
  createDeckPowerProfileFingerprint,
  createEnemyBudgetEnvelope,
  formatEncounterLineageForModel,
  profileDeckPower,
  scoreEnemyPower,
  updateEncounterLineageMemory,
  type ContentPack,
  type DeckPowerProfile,
  type EncounterCalibrationResult,
  type EncounterLineageMemory,
} from '../game-core';
import { createContentPackFromMvuBattle } from '../runtime/contentPackAdapter';
import { DesignKnowledgeGraph, type KnowledgeGraphView } from './knowledgeGraph';
import {
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
  DESIGN_ASSISTANT_PROMPT_MARKER,
  DESIGN_ASSISTANT_STATE_SPEC,
  type DesignAssistantChatState,
  type DesignAssistantSettings,
  type MvuDesignSnapshot,
  type ProgramCalibrationMemory,
} from './types';

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(finite(value, fallback))));
}

export function normalizeDesignAssistantSettings(value: unknown): DesignAssistantSettings {
  const source = isRecord(value) ? value : {};
  return {
    enabled: source.enabled !== false,
    difficultyPercent: boundedInteger(
      source.difficultyPercent,
      DEFAULT_DESIGN_ASSISTANT_SETTINGS.difficultyPercent,
      10,
      110,
    ),
    autoCalibration: source.autoCalibration !== false,
    simulationSeeds: boundedInteger(source.simulationSeeds, DEFAULT_DESIGN_ASSISTANT_SETTINGS.simulationSeeds, 8, 32),
    showNotifications: source.showNotifications !== false,
    debug: source.debug === true,
  };
}

function emptyLineage(): EncounterLineageMemory {
  return { spec: 'mwg.encounter-lineage/v1', families: [], recentEnemies: [] };
}

export function normalizeDesignAssistantChatState(value: unknown): DesignAssistantChatState {
  const source = isRecord(value) && value.spec === DESIGN_ASSISTANT_STATE_SPEC ? value : {};
  const lineage = isRecord(source.lineage) && source.lineage.spec === 'mwg.encounter-lineage/v1'
    ? clone(source.lineage) as EncounterLineageMemory
    : emptyLineage();
  return {
    spec: DESIGN_ASSISTANT_STATE_SPEC,
    lineage,
    calibratedEnemyFingerprints: Array.isArray(source.calibratedEnemyFingerprints)
      ? source.calibratedEnemyFingerprints.map(String).slice(-16)
      : [],
    ...(typeof source.lastDeckFingerprint === 'string' ? { lastDeckFingerprint: source.lastDeckFingerprint } : {}),
    ...(typeof source.lastEnemyFingerprint === 'string' ? { lastEnemyFingerprint: source.lastEnemyFingerprint } : {}),
    ...(Number.isFinite(source.lastInjectionAt) ? { lastInjectionAt: Number(source.lastInjectionAt) } : {}),
    ...(isRecord(source.lastCalibration) ? { lastCalibration: clone(source.lastCalibration) as ProgramCalibrationMemory } : {}),
  };
}

function battleFromVariables(variables: unknown): Record<string, any> | null {
  if (!isRecord(variables) || !isRecord(variables.stat_data) || !isRecord(variables.stat_data.battle)) return null;
  return variables.stat_data.battle;
}

function enemyGenerationFingerprint(pack: ContentPack): string | null {
  const enemies = pack.enemies?.length ? pack.enemies : pack.enemy ? [pack.enemy] : [];
  if (enemies.length === 0) return null;
  const stableEnemies = enemies.map(enemy => {
    const stable = clone(enemy) as Record<string, any>;
    delete stable.hp;
    delete stable.lust;
    delete stable.block;
    delete stable.energy;
    delete stable.status_effects;
    return stable;
  });
  const identities = stableEnemies.map((enemy, index) => String(enemy.id || enemy.name || `enemy_${index + 1}`));
  return `${identities.join('|')}:${createContentMechanicsFingerprint({ enemies: stableEnemies })}`;
}

export function enemyGenerationFingerprintFromVariables(variables: unknown): string | null {
  const battle = battleFromVariables(variables);
  if (!battle) return null;
  try {
    const pack = createContentPackFromMvuBattle(battle);
    return enemyGenerationFingerprint(pack);
  } catch {
    return null;
  }
}

function formatRange(value: { min: number; max: number }): string {
  return `${value.min}~${value.max}`;
}

function calibrateUntilWinnable(input: Parameters<typeof calibrateEncounterNumbers>[0]): EncounterCalibrationResult {
  let result = calibrateEncounterNumbers(input);
  let appliedScale = result.appliedScale;
  const changedPaths = new Set(result.changedPaths);
  const warnings = new Set(result.warnings);
  // Low-confidence decks intentionally cap one correction pass. A wildly
  // overstated model enemy may therefore need several bounded passes. Each pass
  // keeps authored identity and cadence intact while re-running the real shadow
  // simulation against current resources.
  for (let pass = 0; !result.winnableAtCurrentResources && pass < 4; pass += 1) {
    const next = calibrateEncounterNumbers({
      ...input,
      pack: result.calibratedPack,
      requestedRatio: Math.min(input.requestedRatio, result.effectiveRatio),
    });
    if (next.changedPaths.length === 0 || Math.abs(next.appliedScale - 1) < 0.01) break;
    appliedScale *= next.appliedScale;
    next.changedPaths.forEach(path => changedPaths.add(path));
    next.warnings.forEach(warning => warnings.add(warning));
    result = {
      ...next,
      requestedRatio: Number(input.requestedRatio),
      appliedScale: Math.round(appliedScale * 1000) / 1000,
      changedPaths: [...changedPaths],
      warnings: [...warnings],
    };
  }
  return result;
}

function archetypeLines(profile: DeckPowerProfile): string[] {
  return profile.archetypes.slice(0, 4).map(entry => {
    const missing = entry.missingPayoffs.slice(0, 2).join('、');
    return `${entry.label}${entry.share}%：${entry.description}${missing ? `；尚缺${missing}` : ''}`;
  });
}

function horizonSummary(profile: DeckPowerProfile): string {
  return ([1, 3, 5, 8] as const).map(turn => {
    const point = profile.horizons[turn];
    return `${turn}回合:输出${point.hpDamage.p50}/${point.lustPressure.p50},防护${point.mitigation.p50},治疗${point.healing.p50}`;
  }).join('；');
}

function evolutionLines(graph: KnowledgeGraphView): string[] {
  return graph.evolutionPaths.slice(0, 3).map(path => {
    const bridge = path.bridgeFeatures.slice(0, 3).join('、');
    return `${path.fromLabel}→${path.toLabel}${bridge ? `（桥接条件：${bridge}）` : ''}`;
  });
}

function formatPrompt(input: {
  profile: DeckPowerProfile;
  envelope: ReturnType<typeof createEnemyBudgetEnvelope>;
  lineage: EncounterLineageMemory;
  enemyPower: ReturnType<typeof scoreEnemyPower>;
  knowledgeGraph: KnowledgeGraphView;
}): string {
  const { profile, envelope, lineage, enemyPower, knowledgeGraph } = input;
  const archetypes = archetypeLines(profile);
  const evolutions = evolutionLines(knowledgeGraph);
  const lineageLines = formatEncounterLineageForModel(lineage).slice(-5);
  return [
    DESIGN_ASSISTANT_PROMPT_MARKER,
    '以下内容由程序从本轮最新MVU变量计算，只是变量设计与平衡辅助；剧情事实和玩家现有构筑优先，禁止重新初始化或整表覆盖玩家内容。',
    `卡组强度=${profile.totalScore}，置信度=${Math.round(profile.confidence * 100)}%；${horizonSummary(profile)}。`,
    `牌库质量=${Math.round(profile.deckQuality.multiplier * 100)}%；不可主动使用${profile.deckQuality.deadCopies}张，常规资源难以打出${profile.deckQuality.hardToPlayCopies}张，低费用效率${profile.deckQuality.inefficientCopies}张，偏离主构筑且低效${profile.deckQuality.offPlanCopies}张。低质量卡和不相容卡会污染抽牌，已经从总分中扣除，不能把牌数增加误判为强度增加。`,
    `能力维度：爆发${profile.dimensions.burst}、持续${profile.dimensions.sustainedOutput}、生存${profile.dimensions.survival}、经济${profile.dimensions.economy}、稳定${profile.dimensions.consistency}、成长${profile.dimensions.scaling}、控制${profile.dimensions.control}、组合${profile.dimensions.combo}。`,
    `难度=${envelope.requestedRatio}%；按当前生命与欲望资源后的有效难度=${envelope.effectiveRatio}%，目标敌人=${envelope.targetScore}分，预期${envelope.targetTurns[0]}~${envelope.targetTurns[1]}回合。`,
    '最大生命参与卡组长期评分；当前生命和当前欲望只用于判断这场战斗的可打性与安全封顶，不改变卡组总分。',
    `敌人数值预算：有效生命${formatRange(envelope.durability.hp)}；单次生命压力上限${envelope.burstCap}；反制窗口至少${envelope.requiredCounterplayWindows}个。生命、欲望、控制、格挡和成长共享预算，不得各自同时取上限。`,
    archetypes.length ? `当前流派：${archetypes.join('；')}` : '当前没有稳定流派；允许通用散卡并自然形成构筑方向。',
    evolutions.length ? `知识图谱邻接路径：${evolutions.join('；')}。奖励可以强化、桥接或提供通用散卡，不得强迫转型。` : '',
    lineageLines.length ? `敌人谱系记忆：${lineageLines.join('；')}。仅当剧情确有亲缘、同族或上下位关系时复用family_id与招牌行动。` : '',
    enemyPower ? `变量中现有敌人程序评分=${enemyPower.currentEncounterScore}；若本轮剧情没有更换敌人，应增量更新而非重建。` : '',
    '若剧情本轮确实触发新战斗：围绕剧情身份设计一个主机制、一个可协同的副机制和可观察反制；当前hp应承接先手攻击、伤势与状态，不必等于max_hp。',
    '目标视角：每个effects中的self恒指该效果的拥有者，opponent恒指其对手；敌方行动的self是敌方，玩家卡牌的self是玩家。需要作用到另一方时显式写to，避免只靠自然语言判断。',
    '欲望型只是剧情允许时的一种敌人结构，不要默认生成；若使用欲望压力，仍须有可结束战斗的生命伤害、状态结算或明确叙事终局，优先使用可执行状态、能力与行动节奏而非纯数值堆叠。',
  ].filter(Boolean).join('\n');
}

export class DesignAssistantEngine {
  private readonly profileCache = new Map<string, DeckPowerProfile>();

  constructor(private readonly knowledgeGraph = new DesignKnowledgeGraph()) {}

  initializeKnowledgeGraph(): Promise<void> {
    return this.knowledgeGraph.initialize();
  }

  queryKnowledgeGraph(ids: string[] = [], lineage?: EncounterLineageMemory, depth = 1): KnowledgeGraphView {
    return this.knowledgeGraph.query(ids, lineage, depth);
  }

  knowledgeGraphStats(lineage?: EncounterLineageMemory) {
    return this.knowledgeGraph.stats(lineage);
  }

  private profile(pack: ContentPack, maxHp: number, maxLust: number, seeds: number): DeckPowerProfile {
    const fingerprint = createDeckPowerProfileFingerprint({ pack, maxHp, maxLust, seeds });
    const cached = this.profileCache.get(fingerprint);
    if (cached) return cached;
    const profile = profileDeckPower({ pack, maxHp, maxLust, seeds });
    this.profileCache.set(fingerprint, profile);
    while (this.profileCache.size > 12) this.profileCache.delete(this.profileCache.keys().next().value as string);
    return profile;
  }

  createSnapshot(
    variables: unknown,
    stateValue: unknown,
    settingsValue: unknown,
  ): MvuDesignSnapshot | null {
    const battle = battleFromVariables(variables);
    if (!battle) return null;
    const settings = normalizeDesignAssistantSettings(settingsValue);
    const state = normalizeDesignAssistantChatState(stateValue);
    const pack = createContentPackFromMvuBattle(battle);
    if (pack.cards.length === 0) return null;
    const core = isRecord(battle.core) ? battle.core : {};
    const maxHp = Math.max(1, finite(core.max_hp, 1));
    const maxLust = Math.max(1, finite(core.max_lust, 100));
    const currentHp = Math.max(0, finite(core.hp, maxHp));
    const currentLust = Math.max(0, finite(core.lust, 0));
    const deckProfile = this.profile(pack, maxHp, maxLust, settings.simulationSeeds);
    const currentEnemyFingerprint = enemyGenerationFingerprint(pack);
    const lineage = currentEnemyFingerprint && currentEnemyFingerprint === state.lastEnemyFingerprint
      ? clone(state.lineage)
      : updateEncounterLineageMemory(state.lineage, pack);
    const knowledgeGraph = this.knowledgeGraph.query(
      deckProfile.archetypes.slice(0, 5).map(entry => entry.id),
      lineage,
      1,
      36,
    );
    const enemyEnvelope = createEnemyBudgetEnvelope({
      profile: deckProfile,
      requestedRatio: settings.difficultyPercent,
      currentHp,
      currentLust,
      maxLust,
      inheritedMechanics: lineage.recentEnemies.at(-1)?.themeAxes,
    });
    const currentEnemyPower = scoreEnemyPower(pack);
    return {
      prompt: formatPrompt({ profile: deckProfile, envelope: enemyEnvelope, lineage, enemyPower: currentEnemyPower, knowledgeGraph }),
      deckProfile,
      enemyEnvelope,
      enemyPower: currentEnemyPower,
      lineage,
      deckFingerprint: deckProfile.fingerprint,
      enemyFingerprint: currentEnemyFingerprint,
      knowledgeGraph,
    };
  }

  calibrateGeneratedEnemy(
    variables: unknown,
    stateValue: unknown,
    settingsValue: unknown,
  ): { changed: boolean; state: DesignAssistantChatState; snapshot: MvuDesignSnapshot | null } {
    const battle = battleFromVariables(variables);
    const settings = normalizeDesignAssistantSettings(settingsValue);
    const state = normalizeDesignAssistantChatState(stateValue);
    if (!battle) return { changed: false, state, snapshot: null };
    const snapshot = this.createSnapshot(variables, state, settings);
    if (!snapshot || !snapshot.enemyFingerprint) return { changed: false, state, snapshot };
    state.lineage = snapshot.lineage;
    state.lastDeckFingerprint = snapshot.deckFingerprint;
    state.lastEnemyFingerprint = snapshot.enemyFingerprint;
    if (!settings.autoCalibration || state.calibratedEnemyFingerprints.includes(snapshot.enemyFingerprint)) {
      return { changed: false, state, snapshot };
    }
    const pack = createContentPackFromMvuBattle(battle);
    const core = isRecord(battle.core) ? battle.core : {};
    const calibration = calibrateUntilWinnable({
      pack,
      profile: snapshot.deckProfile,
      requestedRatio: settings.difficultyPercent,
      currentHp: Math.max(0, finite(core.hp, snapshot.deckProfile.maxHp)),
      currentLust: Math.max(0, finite(core.lust, 0)),
      maxLust: Math.max(1, finite(core.max_lust, 100)),
      seeds: settings.simulationSeeds,
    });
    state.calibratedEnemyFingerprints.push(snapshot.enemyFingerprint);
    state.calibratedEnemyFingerprints = state.calibratedEnemyFingerprints.slice(-16);
    state.lastCalibration = {
      enemyFingerprint: snapshot.enemyFingerprint,
      requestedRatio: calibration.requestedRatio,
      effectiveRatio: calibration.effectiveRatio,
      appliedScale: calibration.appliedScale,
      winnableAtCurrentResources: calibration.winnableAtCurrentResources,
      changedPaths: calibration.changedPaths.slice(0, 80),
      warnings: calibration.warnings,
      calibratedAt: Date.now(),
    };
    if (calibration.changedPaths.length === 0 || Math.abs(calibration.appliedScale - 1) < 0.02) {
      return { changed: false, state, snapshot };
    }
    const calibratedEnemies = calibration.calibratedPack.enemies || [];
    if (Array.isArray(battle.enemies) && battle.enemies.length > 0) {
      battle.enemies = clone(calibratedEnemies);
      battle.enemy = null;
    } else {
      battle.enemy = clone(calibratedEnemies[0] || calibration.calibratedPack.enemy);
      if (Array.isArray(battle.enemies)) battle.enemies = [];
    }
    const calibratedPack = createContentPackFromMvuBattle(battle);
    state.lastEnemyFingerprint = enemyGenerationFingerprint(calibratedPack) || snapshot.enemyFingerprint;
    return { changed: true, state, snapshot: this.createSnapshot(variables, state, settings) };
  }
}
