import {
  ARCHETYPE_GRAPH,
  calibrateEncounterUntilWinnable,
  createEncounterLineagePromptView,
  createContentMechanicsFingerprint,
  createDeckPowerProfileFingerprint,
  createEnemyBudgetEnvelope,
  extractContentMechanicFeatures,
  profileDeckPower,
  scoreEnemyPower,
  updateEncounterLineageMemory,
  type ContentPack,
  type ArchetypeFeaturePredicate,
  type DeckPowerProfile,
  type EncounterLineageMemory,
} from '../game-core';
import { createContentPackFromMvuBattle } from '../runtime/contentPackAdapter';
import { initialDeckAuthoringGuidance } from '../game-core/initialDeckAuthoringGuidance';
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
    firstAuthoringSchemaTransport: source.firstAuthoringSchemaTransport === 'compact-context'
      ? 'compact-context' : 'provider-outline',
    initialAuthoringProtocol: source.initialAuthoringProtocol === 'registry-draft' ? 'registry-draft' : 'canonical',
    initialMechanismThinking: source.initialMechanismThinking === 'disabled' ? 'disabled' : 'inherit',
  };
}

function emptyLineage(): EncounterLineageMemory {
  return { spec: 'mwg.encounter-lineage/v1', families: [], recentEnemies: [] };
}

function normalizeProgramCalibrationMemory(value: unknown): ProgramCalibrationMemory | undefined {
  if (!isRecord(value)) return undefined;
  const memory = clone(value) as ProgramCalibrationMemory;
  if (value.mode === 'applied' || value.mode === 'verified' || value.mode === 'advisory') {
    memory.mode = value.mode;
  } else {
    memory.mode = Array.isArray(value.changedPaths) && value.changedPaths.length > 0
      ? 'applied'
      : 'verified';
  }
  return memory;
}

export function normalizeDesignAssistantChatState(value: unknown): DesignAssistantChatState {
  const source = isRecord(value) && value.spec === DESIGN_ASSISTANT_STATE_SPEC ? value : {};
  const lineage = isRecord(source.lineage) && source.lineage.spec === 'mwg.encounter-lineage/v1'
    ? clone(source.lineage) as EncounterLineageMemory
    : emptyLineage();
  const lastCalibration = normalizeProgramCalibrationMemory(source.lastCalibration);
  return {
    spec: DESIGN_ASSISTANT_STATE_SPEC,
    lineage,
    calibratedEnemyFingerprints: Array.isArray(source.calibratedEnemyFingerprints)
      ? source.calibratedEnemyFingerprints.map(String).slice(-16)
      : [],
    ...(typeof source.lastDeckFingerprint === 'string' ? { lastDeckFingerprint: source.lastDeckFingerprint } : {}),
    ...(typeof source.lastEnemyFingerprint === 'string' ? { lastEnemyFingerprint: source.lastEnemyFingerprint } : {}),
    ...(Number.isFinite(source.lastInjectionAt) ? { lastInjectionAt: Number(source.lastInjectionAt) } : {}),
    ...(source.lastInjectionSource === 'official'
      || source.lastInjectionSource === 'tavern-helper'
      || source.lastInjectionSource === 'mvu-lifecycle'
      ? { lastInjectionSource: source.lastInjectionSource }
      : {}),
    ...(source.lastInjectionMessageId === 'latest' || Number.isInteger(Number(source.lastInjectionMessageId))
      ? { lastInjectionMessageId: source.lastInjectionMessageId === 'latest' ? 'latest' : Number(source.lastInjectionMessageId) }
      : {}),
    ...(Number.isInteger(Number(source.lastInjectionCount)) && Number(source.lastInjectionCount) >= 0
      ? { lastInjectionCount: Number(source.lastInjectionCount) }
      : {}),
    ...(lastCalibration ? { lastCalibration } : {}),
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

function archetypeLines(profile: DeckPowerProfile): string[] {
  return profile.archetypes.slice(0, 4).map(entry => {
    const cards = entry.supportingCards.slice(0, 4).join('、');
    return `${entry.label}${entry.share}%：${entry.description}${cards ? `；支持卡：${cards}` : ''}${entry.missingPayoffs.length ? '；尚缺可兑现收益端' : ''}`;
  });
}

function horizonSummary(profile: DeckPowerProfile): string {
  return ([1, 3, 5, 8] as const).map(turn => {
    const point = profile.horizons[turn];
    return `${turn}回合:输出${point.hpDamage.p50}/${point.lustPressure.p50},防护${point.mitigation.p50},治疗${point.healing.p50}`;
  }).join('；');
}

function evolutionLines(graph: KnowledgeGraphView): string[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  return graph.evolutionPaths.slice(0, 3).map(path => {
    const target = nodes.get(path.to);
    const description = typeof target?.data.description === 'string' ? target.data.description : '';
    return `${path.fromLabel}→${path.toLabel}${description ? `：${description}` : ''}`;
  });
}

function lineageContextLines(lineage: EncounterLineageMemory): string[] {
  const view = createEncounterLineagePromptView(lineage);
  const familyLines = view.families.map(family => {
    const actions = family.canonicalActions.slice(-2).map(action => {
      const definition = JSON.stringify(action.definition);
      return `${action.name}=${definition}`;
    });
    return [
      `family_id=${family.key}（${family.label}）`,
      `主题=${family.themeAxes.join('、') || '未定'}`,
      actions.length ? `可继承行动结构=${actions.join('；')}` : '',
    ].filter(Boolean).join('；');
  });
  const recentLines = view.recentEnemies.slice(-3).map(enemy =>
    `${enemy.name}${enemy.familyKey ? `（family_id=${enemy.familyKey}）` : ''}：${enemy.themeAxes.join('、') || '未定'}；行动=${enemy.actions.map(action => action.name).join('、') || '无'}`,
  );
  return [...familyLines, ...recentLines];
}

export function createInitializationDesignPrompt(variables: unknown): string | null {
  const battle = battleFromVariables(variables);
  if (!battle || Array.isArray(battle.cards) && battle.cards.length > 0) return null;
  return [
    DESIGN_ASSISTANT_PROMPT_MARKER,
    '程序确认当前最新MVU变量尚未建立玩家卡组；这是初始化辅助，不是固定题材、职业或剧情预设。',
    '仅依据当前剧情已经成立的身份、能力与环境，初始化可直接游玩的玩家战斗内容：战斗形象、核心上限与非空卡组；遗物、道具、独立能力、状态和欲望满溢效果按构筑需要自由选择。',
    '先读取用户的卡牌方向：若明确指定流派或机制，必须从世界书“流派体系与设计方法”取得其启动、运转与收益结构，并落实到真实 effects、trigger、状态、资源、牌区或召唤字段；名称、emoji 与 description 不计为实现。',
    '初始牌组要让核心启动端在正常抽牌中可用，并至少包含一个可兑现收益端；用户没有指定流派时才按剧情自由选择核心循环，也允许不绑定流派的通用散卡。',
    '只要把召唤作为核心，就必须实际产生 spawn_summon，并让召唤实例通过行动、触发、援护、资源、强化、选择或离场关系参与循环；普通伤害或格挡的召唤措辞不算召唤机制。',
    '自定义状态、资源和引用对象必须先定义再使用；触发器只能选择公开时机，不存在自定义注册触发器。效果使用当前角色卡支持的通用DSL，不得把自然语言描述当作可执行效果。',
    initialDeckAuthoringGuidance(),
    '缺少防御、治疗、传统输出或程序偏好的循环都只能形成软建议，不得触发结构修复或拒绝初始化。',
    '初始化完成后，后续轮次只能增量新增、修改或删除剧情实际变化的内容，禁止再次整表重建玩家卡组。',
  ].join('\n');
}

export function calibrationAdvisoryReasons(profile: DeckPowerProfile, pack?: ContentPack): string[] {
  const reasons: string[] = [];
  if (profile.confidence < 0.65) reasons.push(`卡组模拟置信度仅${Math.round(profile.confidence * 100)}%`);
  const authoredOperations = pack
    ? new Set(extractContentMechanicFeatures(pack).operations)
    : null;
  const unsupportedAuthoredFeatures = authoredOperations
    ? profile.unsupportedFeatures.filter(feature => authoredOperations.has(feature))
    : profile.unsupportedFeatures;
  if (unsupportedAuthoredFeatures.length > 0) {
    reasons.push(`完整战斗模拟尚未覆盖：${unsupportedAuthoredFeatures.slice(0, 6).join('、')}`);
  }
  return reasons;
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
  const lineageLines = lineageContextLines(lineage);
  return [
    DESIGN_ASSISTANT_PROMPT_MARKER,
    '以下内容由程序从本轮最新MVU变量计算，只是变量设计与平衡辅助；剧情事实和玩家现有构筑优先，禁止重新初始化或整表覆盖玩家内容。',
    profile.assessmentKind === 'partial-shadow-estimate'
      ? '卡组评分未提供：影子模型缺失机制，不输出总分、维度分或将缺项记零的回合曲线。召唤物援护等生存收益需由正式执行器验证。'
      : `卡组评分=${profile.totalScore}（${profile.scoreLabel}）；${horizonSummary(profile)}。`,
    profile.assessmentKind === 'partial-shadow-estimate'
      ? `评分使用限制：${profile.assessmentReason} 不得把此分数当作玩家实战强度、最优策略结果，或与其他支持度不同构筑的横向标尺；敌人数值仅按保守设计预算处理。`
      : `评分使用限制：${profile.assessmentReason}`,
    `牌库抽样诊断：不可主动使用${profile.deckQuality.deadCopies}张，常规资源难以打出${profile.deckQuality.hardToPlayCopies}张，低即时收益${profile.deckQuality.inefficientCopies}张，偏离主构筑且低效${profile.deckQuality.offPlanCopies}张。实体卡已在影子抽牌与支付中结算，流派标签只作说明，不会再从总分重复扣除。`,
    profile.assessmentKind === 'partial-shadow-estimate' ? '能力维度：待正式评估，未知不等于零。' : `能力维度：爆发${profile.dimensions.burst}、持续${profile.dimensions.sustainedOutput}、生存${profile.dimensions.survival}、经济${profile.dimensions.economy}、稳定${profile.dimensions.consistency}、成长${profile.dimensions.scaling}、控制${profile.dimensions.control}、组合${profile.dimensions.combo}。`,
    profile.unsupportedFeatures.length
      ? `评分边界：${profile.unsupportedFeatures.join('、')}尚未被完整影子模拟；这些机制应由模型按实际DSL保守估值，程序不会在低置信时强行改写敌人数值。`
      : '评分边界：本构筑已由当前影子模拟完整覆盖。',
    profile.assessmentKind === 'partial-shadow-estimate' ? `难度=${envelope.requestedRatio}%；评分不完整，以下旧影子预算不作玩家实力或敌人数值依据。` : `难度=${envelope.requestedRatio}%；按当前生命与欲望资源后的有效难度=${envelope.effectiveRatio}%，目标敌人=${envelope.targetScore}分，预期${envelope.targetTurns[0]}~${envelope.targetTurns[1]}回合。`,
    '最大生命参与卡组长期评分；当前生命和当前欲望只用于判断这场战斗的可打性与安全封顶，不改变卡组总分。',
    profile.assessmentKind === 'partial-shadow-estimate' ? '敌人数值预算未提供：机制覆盖不足，使用公开内容设计建议或正式引擎证据，不因缺少格挡/治疗判定生存弱。' : `敌人数值预算：有效生命${formatRange(envelope.durability.hp)}；单次生命压力上限${envelope.burstCap}；反制窗口至少${envelope.requiredCounterplayWindows}个。生命、欲望、控制、格挡和成长共享预算，不得各自同时取上限。`,
    archetypes.length ? `当前流派：${archetypes.join('；')}` : '当前没有稳定流派；允许通用散卡并自然形成构筑方向。',
    evolutions.length ? `知识图谱邻接路径：${evolutions.join('；')}。奖励可以强化、桥接或提供通用散卡，不得强迫转型。` : '',
    lineageLines.length ? `敌人谱系记忆：${lineageLines.join('；')}。仅当剧情确有亲缘、同族或上下位关系时复用对应family_id，并至少保留一个可继承行动结构；无关敌人不得强行归族。` : '',
    enemyPower ? `变量中现有敌人程序评分=${enemyPower.currentEncounterScore}；若本轮剧情没有更换敌人，应增量更新而非重建。` : '',
    '若剧情本轮确实触发新战斗：先把剧情身份转成可执行动作，再选择一个主压力与零到两个有因果协同的副机制；按铺垫、施压、兑现、保护或调整这些功能组织行动，并保留可观察反制。简单表示核心规则容易读懂，不表示无成长、无节奏的重复攻击；单敌也要有成长、周期爆发或状态压力，已参战的多敌要有职责分工和可拆解的联动。这些是设计建议，不据此改写或拒绝合法敌人。当前hp应承接先手攻击、伤势与状态，不必等于max_hp。',
    '敌人的名称、描述和题材不算机制；核心行为删去描述后仍须能从 effects、trigger、状态、资源、召唤、增援、牌区干扰或规则字段中成立。召唤主题同样必须真实使用 spawn_summon 或需要进入正式敌人集合时使用 spawn_enemy。',
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

  createInitializationPrompt(variables: unknown): string | null {
    return createInitializationDesignPrompt(variables);
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
    const currentEnemyPower = scoreEnemyPower(pack, { maxHp, maxLust });
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
    const calibrationKey = `${snapshot.enemyFingerprint}|deck=${snapshot.deckFingerprint}|difficulty=${settings.difficultyPercent}|seeds=${settings.simulationSeeds}`;
    if (!settings.autoCalibration || state.calibratedEnemyFingerprints.includes(calibrationKey)) {
      return { changed: false, state, snapshot };
    }
    const pack = createContentPackFromMvuBattle(battle);
    const core = isRecord(battle.core) ? battle.core : {};
    const calibration = calibrateEncounterUntilWinnable({
      pack,
      profile: snapshot.deckProfile,
      requestedRatio: settings.difficultyPercent,
      currentHp: Math.max(0, finite(core.hp, snapshot.deckProfile.maxHp)),
      currentLust: Math.max(0, finite(core.lust, 0)),
      maxLust: Math.max(1, finite(core.max_lust, 100)),
      seeds: settings.simulationSeeds,
    });
    const advisoryReasons = calibrationAdvisoryReasons(snapshot.deckProfile, pack);
    state.calibratedEnemyFingerprints.push(calibrationKey);
    state.calibratedEnemyFingerprints = state.calibratedEnemyFingerprints.slice(-16);
    state.lastCalibration = {
      enemyFingerprint: snapshot.enemyFingerprint,
      requestedRatio: calibration.requestedRatio,
      effectiveRatio: calibration.effectiveRatio,
      appliedScale: calibration.appliedScale,
      mode: calibration.changedPaths.length > 0 || advisoryReasons.length > 0 ? 'advisory' : 'verified',
      // This is a counterfactual simulation result after the suggested scale,
      // not permission to mutate the authored encounter.
      winnableAtCurrentResources: calibration.winnableAtCurrentResources,
      changedPaths: calibration.changedPaths.slice(0, 80),
      warnings: [
        ...advisoryReasons,
        ...(calibration.changedPaths.length > 0
          ? [`建议数值倍率 ×${calibration.appliedScale}；仅供后续生成参考，未改写当前敌人。`]
          : []),
        ...calibration.warnings,
      ],
      calibratedAt: Date.now(),
    };
    return { changed: false, state, snapshot };
  }
}
