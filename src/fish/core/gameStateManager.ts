import {
  getCurrentMessageVariables,
  isCurrentMessageLatest,
  updateCurrentMessageVariablesWith,
} from '../../runtime/messageVariables';
import { refreshMvuContentDesignContext } from '../../runtime/contentDesignContextAdapter';
import { readRuntimeContentDesignSettings } from '../../runtime/contentDesignSettings';
import { maybeRequestAutomaticBalanceCalibration } from '../../runtime/automaticBalanceCalibration';
import { normalizeTowerBattleEnemyIdentifiers } from '../../runtime/towerContentActivation';
import {
  assessEnemyBudget,
  BattleStateStore,
  countCardOwnership,
  createBattleRandomState,
  isBattleRunNode,
  readGameMode,
  resolveStartingHand,
  shuffleCards,
  type BattleRequest,
  type Ability,
  BattleContentContractError,
  contentPathToBattlePath,
  summarizeBuildBudget,
  normalizeOrbContainer,
  normalizeTurnControl,
  normalizeCombatResourceStates,
  validateRunState,
  type Card,
  type Enemy,
  type GameState,
  type ContentDesignAssessment,
} from '../../game-core';
import { formatBattleContentIssues, preflightBattleContent, type BattleContentIssue } from './battleContentPreflight';
import { inspectBattleDataContract, readBattleDataContract } from './battleDataContract';
import { BattleSessionStore } from './battleSessionStore';
import {
  buildMvuStatusDisplayContext,
  convertMvuOrbContainer,
  convertMvuStance,
  convertMvuCards,
  convertMvuEnemies,
  convertMvuAbilities,
  convertMvuActiveStatuses,
  convertMvuItems,
  convertMvuRelics,
  mergeMvuCards,
  normalizeMvuArray,
} from './mvuBattleAdapter';
import { normalizeNamedEffectDefinition } from './battleContentAdapter';
import { battleRequestToRuntimeData, createBattleRequestFromMvu } from './battleContractAdapter';

type AbilitySourceCandidate = {
  trigger: string;
  programKey: string;
  name: string;
  source: string;
  emoji?: string;
  description?: string;
};

function effectProgramKey(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify((value as { steps?: unknown }).steps || []);
  } catch {
    return '';
  }
}

function collectAbilitySources(
  entries: ReadonlyArray<{ name?: string; emoji?: string; description?: string; effectProgram?: any }>,
  kind: string,
): AbilitySourceCandidate[] {
  const candidates: AbilitySourceCandidate[] = [];
  for (const entry of entries) {
    const name = String(entry?.name || '').trim();
    if (!name || !Array.isArray(entry.effectProgram?.steps)) continue;
    for (const step of entry.effectProgram.steps) {
      if (step?.op !== 'register_trigger' || !Array.isArray(step.effects)) continue;
      candidates.push({
        trigger: String(step.trigger || '').trim(),
        programKey: effectProgramKey({ spec: 'mwg.effect/v1', steps: step.effects }),
        name,
        source: `${kind}「${name}」`,
        emoji: entry.emoji,
        description: entry.description,
      });
    }
  }
  return candidates;
}

function recoverAbilities(abilities: Ability[] | undefined, candidates: AbilitySourceCandidate[]): Ability[] | undefined {
  if (!Array.isArray(abilities)) return abilities;
  return abilities.map((ability, index) => {
    if (ability.name && ability.source) return ability;
    const key = effectProgramKey(ability.effectProgram);
    const candidate = candidates.find(value => value.trigger === ability.trigger && value.programKey === key);
    return {
      ...ability,
      name: ability.name || candidate?.name || `临时能力 ${index + 1}`,
      source: ability.source || candidate?.source || '战斗中获得（旧快照未记录具体来源）',
      emoji: ability.emoji || candidate?.emoji || '⚡',
      description: ability.description || candidate?.description || '',
    };
  });
}

/** Backfill ability labels in snapshots saved before source metadata became mandatory. */
export function recoverRestoredAbilityMetadata(state: GameState): GameState {
  const playerCandidates = [
    ...collectAbilitySources(state.player.deck || [], '卡牌'),
    ...collectAbilitySources(state.player.relics || [], '遗物'),
  ];
  state.player.abilities = recoverAbilities(state.player.abilities, playerCandidates);
  const enemies = state.enemies?.length ? state.enemies : state.enemy ? [state.enemy] : [];
  for (const enemy of enemies) {
    const enemyCandidates = collectAbilitySources(enemy.actions || [], '敌方行动');
    enemy.abilities = recoverAbilities(enemy.abilities, enemyCandidates);
  }
  return state;
}

export class GameStateManager extends BattleStateStore {
  private static instance: GameStateManager;
  private readonly battleSessionStore = new BattleSessionStore();
  private lastLoadError: string | null = null;
  private lastLoadIssues: BattleContentIssue[] = [];

  private constructor() {
    super();
  }

  public static getInstance(): GameStateManager {
    if (!GameStateManager.instance) {
      GameStateManager.instance = new GameStateManager();
    }
    return GameStateManager.instance;
  }

  public getLastLoadError(): string | null {
    return this.lastLoadError;
  }

  public getLastLoadIssues(): BattleContentIssue[] {
    return this.lastLoadIssues.map(issue => ({ ...issue }));
  }

  public override getEnemy(): Enemy | null {
    const enemy = super.getEnemy();
    if (enemy || this.lastLoadError) return enemy;

    // The MVU fallback exists only to bootstrap a battle whose runtime state has
    // not been loaded yet.  Once combat has started, an empty living roster is
    // authoritative: restoring `battle.enemy` here would resurrect the original
    // definition between lethal damage, defeated triggers and battle-end UI.
    // A recorded corpse is authoritative even while a defeated passive is still
    // resolving and the replacement roster has not entered yet.
    const runtimeState = this.getGameState();
    if (
      runtimeState.phase !== 'setup' ||
      runtimeState.isGameOver ||
      (runtimeState.defeatedEnemies?.length || 0) > 0
    ) return null;

    try {
      const variables = getCurrentMessageVariables();
      const battleContract = readBattleDataContract(variables);
      const battleData = battleContract?.data;
      const mvuEnemies = Array.isArray(battleData?.enemies) && battleData.enemies.length > 0
        ? battleData.enemies
        : battleData?.enemy
          ? [battleData.enemy]
          : [];
      const statusContext = buildMvuStatusDisplayContext(battleData?.statuses);
      const restoredEnemies = convertMvuEnemies(mvuEnemies, () => this.nextRandom(), statusContext);
      if (restoredEnemies.length === 0) return null;
      this.setEnemies(restoredEnemies, restoredEnemies[0].id);
      return super.getEnemy();
    } catch (error) {
      console.error('从MVU变量恢复敌人数据失败:', error);
      return null;
    }
  }

  protected override stateDidChange(_event: string, state: GameState): void {
    this.battleSessionStore.schedule(state);
  }

  public wasBattleSessionRestored(): boolean {
    return this.battleSessionStore.wasRestored();
  }

  public async saveToSillyTavern(): Promise<void> {
    await this.battleSessionStore.flush(this.gameState);
  }

  public async clearBattleSession(): Promise<void> {
    await this.battleSessionStore.clear();
  }

  public async loadFromSillyTavern(): Promise<boolean> {
    this.lastLoadError = null;
    this.lastLoadIssues = [];
    try {
      // 首次读取：从MVU变量加载战斗数据
      let variables = getCurrentMessageVariables();

      // The fish/common bundles share one GameStateManager singleton while the
      // tower stays on the same Tavern message.  A failed node generation can
      // therefore remount the battle view after the route has already moved on.
      // Clear the old in-memory fight before inspecting the (intentionally
      // empty) canonical enemy root, otherwise the previous node can be played
      // and persisted over a newer run revision.
      const stat = variables?.stat_data;
      if (readGameMode(stat) === 'tower') {
        const runResult = validateRunState(stat?.run);
        const run = runResult.ok ? runResult.value : null;
        const hasActiveBattleNode =
          run?.phase === 'in_node' && !!run.currentNode && isBattleRunNode(run.currentNode.kind);
        if (!hasActiveBattleNode) {
          this.battleSessionStore.prepare(variables, null);
          this.resetGame();
          return false;
        }
        // Saves created before the tower boundary enforced runtime-safe enemy
        // IDs may already be inside a room with namespaced IDs such as
        // `machine:front:1`. Normalize a local view before validation so the
        // interrupted fight remains resumable; new rooms are normalized before
        // activation and therefore persist the canonical IDs directly.
        if (hasActiveBattleNode && stat?.battle) {
          variables = {
            ...variables,
            stat_data: {
              ...stat,
              battle: normalizeTowerBattleEnemyIdentifiers(stat.battle),
            },
          };
        }
      }

      const battleInspection = inspectBattleDataContract(variables);
      if (!battleInspection.ok && battleInspection.issue.code !== 'MISSING_BATTLE') {
        this.lastLoadIssues = [{ ...battleInspection.issue }];
        throw new Error(`战斗数据校验失败：${battleInspection.issue.path}: ${battleInspection.issue.message}`);
      }
      const battleData = battleInspection.ok ? battleInspection.result.data : undefined;
      if (battleData) {
        const preflight = preflightBattleContent(battleData);
        if (!preflight.ok) {
          this.lastLoadIssues = preflight.issues.map(issue => ({ ...issue }));
          throw new Error(`战斗内容校验失败：${formatBattleContentIssues(preflight.issues)}`);
        }
        if (preflight.warnings.length > 0) {
          console.warn(`战斗内容可玩性警告：${formatBattleContentIssues(preflight.warnings)}`);
        }
      }
      const battleRequest = battleData ? createBattleRequestFromMvu(variables, battleData) : undefined;
      if (battleRequest && isCurrentMessageLatest()) {
        let designDiagnostics = '';
        let designAssessment: ContentDesignAssessment | null = null;
        await Promise.resolve(
          updateCurrentMessageVariablesWith(currentVariables => {
            const design = refreshMvuContentDesignContext(currentVariables, {
              request: battleRequest,
              ...readRuntimeContentDesignSettings(),
            });
            designAssessment = design.assessment;
            designDiagnostics = design.assessment
              ? design.assessment.diagnostics
                  .filter(issue => issue.severity !== 'advice')
                  .map(issue => `${issue.code}:${issue.message}`)
                  .join('；')
              : '';
            return currentVariables;
          }),
        );
        if (designDiagnostics) console.warn(`内容设计辅助警告：${designDiagnostics}`);
        if (designAssessment && await maybeRequestAutomaticBalanceCalibration(variables, designAssessment)) {
          return this.loadFromSillyTavern();
        }
      }
      if (battleRequest) {
        const balance = assessEnemyBudget(
          battleRequest,
          summarizeBuildBudget(battleRequest.content, {
            hp: battleRequest.player.hp,
            maxHp: battleRequest.player.maxHp,
          }),
        );
        if (balance.warnings.length > 0) console.warn(`战斗平衡警告：${balance.warnings.join('；')}`);
      }

      const restoredState = this.battleSessionStore.prepare(variables, battleRequest);
      if (restoredState) {
        this.gameState = recoverRestoredAbilityMetadata(restoredState);
        this.gameState.turnControl = normalizeTurnControl(this.gameState.turnControl);
        this.gameState.player.orbs = normalizeOrbContainer(this.gameState.player.orbs);
        this.gameState.player.resources = normalizeCombatResourceStates(this.gameState.player.resources);
        if (this.gameState.enemies) {
          this.gameState.enemies = this.gameState.enemies.map(enemy => ({
            ...enemy,
            resources: normalizeCombatResourceStates(enemy.resources),
          }));
        }
        if (this.gameState.defeatedEnemies) {
          this.gameState.defeatedEnemies = this.gameState.defeatedEnemies.map(enemy => ({
            ...enemy,
            resources: normalizeCombatResourceStates(enemy.resources),
          }));
        }
        this.normalizeEnemyCollection();
        try {
          this.notifyListeners('state_loaded');
        } finally {
          this.battleSessionStore.finishRestore();
        }
        return true;
      }

      if (battleRequest) {
        // 转换MVU数据到GameState格式
        this.convertMVUToGameState(battleRequest);
        this.battleSessionStore.enable();
        this.notifyListeners('state_loaded');

        return true;
      }

      return false;
    } catch (error) {
      console.error('加载游戏状态失败:', error);
      if (error instanceof BattleContentContractError && this.lastLoadIssues.length === 0) {
        this.lastLoadIssues = error.issues.map(issue => ({
          path: contentPathToBattlePath(issue.path),
          code: issue.code,
          message: issue.message,
        }));
      }
      this.lastLoadError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * 将MVU变量数据转换为GameState格式
   */
  public syncNewCardsFromMVU(): void {
    try {
      // 从规范 MUV 根读取本轮新增的 cards。
      const variables = getCurrentMessageVariables();
      const battleData = readBattleDataContract(variables)?.data;
      const rawCards = battleData?.cards;
      const { statusNames } = buildMvuStatusDisplayContext(battleData?.statuses);
      const mvuCards = normalizeMvuArray(rawCards);
      if (!mvuCards || mvuCards.length === 0) return;

      const player = this.gameState.player;
      if (!player) return;

      const ownedCards = [...player.hand, ...player.drawPile, ...player.discardPile, ...player.exhaustPile];
      const ownedRunIds = new Set(ownedCards.map(card => card.runInstanceId).filter(Boolean));
      for (const card of mvuCards) {
        if (typeof card?.runInstanceId !== 'string' || ownedRunIds.has(card.runInstanceId)) continue;
        const converted = convertMvuCards([{ ...card, quantity: 1 }], {
          createId: sourceId => this.createRuntimeCardId(sourceId),
          existingIds: ownedCards.map(entry => entry.id),
          statusNames,
        })[0];
        if (converted) {
          this.addCardToDeck(converted);
          ownedRunIds.add(converted.runInstanceId);
        }
      }

      // 统计当前牌堆系中各 originalId 的数量（不含 player.deck，避免与初始化时的快照重复计算）
      const currentCounts = countCardOwnership(
        ownedCards,
        this.getInFlightCardCounts(),
      );

      // 统计期望数量
      const desiredCounts = new Map<string, { card: any; count: number }>();
      for (const c of mvuCards) {
        if (!c || typeof c !== 'object') continue;
        if (typeof c.runInstanceId === 'string') continue;
        const key = c.id || c.name;
        if (!key) continue;
        const qty = Math.max(1, Number(c.quantity) || 1);
        const prev = desiredCounts.get(key);
        desiredCounts.set(key, { card: c, count: (prev?.count || 0) + qty });
      }

      // 逐项补齐缺失的卡牌到抽牌堆（随机插入）
      for (const [key, { card, count }] of desiredCounts.entries()) {
        const have = currentCounts.get(key) || 0;
        if (have >= count) continue;
        const need = count - have;
        for (let i = 0; i < need; i++) {
          const one = { ...card, quantity: 1 };
          // 复用现有转换逻辑，生成带 originalId 的实例
          const converted = convertMvuCards([one], {
            createId: sourceId => this.createRuntimeCardId(sourceId),
            statusNames,
          })[0];
          if (converted) {
            this.addCardToDeck(converted);
          }
        }
      }
    } catch (e) {
      console.warn('同步MVU新增卡牌失败:', e);
    }
  }

  private convertMVUToGameState(request: BattleRequest): void {
    const battleData = battleRequestToRuntimeData(request);
    const core = battleData.core || {};
    const enemies = Array.isArray(battleData.enemies) && battleData.enemies.length > 0
      ? battleData.enemies
      : battleData.enemy
        ? [battleData.enemy]
        : [];

    // battleData 已由 readBattleDataContract 选定唯一来源。
    const cards = mergeMvuCards(battleData.cards);

    const artifacts = normalizeMvuArray(battleData.artifacts);
    const statusContext = buildMvuStatusDisplayContext(battleData.statuses);
    const { statusNames } = statusContext;
    const playerAbilities = convertMvuAbilities(battleData.player_abilities, { statusNames });
    const playerStatusEffects = convertMvuActiveStatuses(battleData.player_status_effects, statusContext);
    const items = convertMvuItems(battleData.items, { statusNames });

    // 转换卡牌数据
    const convertedCards = convertMvuCards(cards, { statusNames });
    this.gameState.random = createBattleRandomState(request.seed);
    this.gameState.battleRequest = request;

    // 更新玩家状态
    this.gameState.player = {
      ...this.gameState.player,
      emoji: typeof core['emoji'] === 'string' && core['emoji'].trim() ? core['emoji'].trim() : '✨',
      currentHp: core['hp'] ?? core['max_hp'] ?? 80,
      maxHp: core['max_hp'] ?? 100,
      currentLust: core['lust'] ?? 0,
      maxLust: core['max_lust'] ?? 100,
      energy: 3, // 战斗中计算，不从MVU读取
      maxEnergy: 3, // 固定值
      resources: normalizeCombatResourceStates(core['resources']),
      block: 0, // 战斗中计算，不从MVU读取
      drawPerTurn: 5, // 固定值，不从MVU读取
      // 设置卡牌数据
      deck: [...convertedCards],
      hand: [], // 手牌在游戏开始时为空，稍后抽取
      drawPile: [], // 先初始化为空，稍后洗牌后填充
      discardPile: [], // 弃牌堆初始为空
      exhaustPile: [], // 消耗堆初始为空
      // 转换遗物数据
      relics: convertMvuRelics(artifacts, { statusNames }),
      // 设置能力和状态效果
      abilities: playerAbilities as any,
      statusEffects: playerStatusEffects,
      // 设置道具数据
      items,
      stance: convertMvuStance(core['stance'], 1),
      orbs: convertMvuOrbContainer(core['orb_slots'], core['orbs']),
    };

    const opening = resolveStartingHand(
      convertedCards,
      this.gameState.player.drawPerTurn,
      cardsToShuffle => shuffleCards(cardsToShuffle, () => this.nextRandom()),
      10,
    );
    this.gameState.player.hand = opening.hand;
    this.gameState.player.drawPile = opening.drawPile;

    // 更新敌人状态
    const convertedEnemies = convertMvuEnemies(enemies, () => this.nextRandom(), statusContext);
    if (convertedEnemies.length > 0) {
      this.setEnemies(convertedEnemies, convertedEnemies[0].id);
    } else {
      console.error('❌ 无法读取敌人数据！battle.enemy 变量未正确设置');
      throw new Error('敌人数据未找到或无效。请确保AI已正确生成敌人信息。');
    }

    // 设置战斗数据
    const playerLustEffect = normalizeNamedEffectDefinition(battleData.player_lust_effect, {
      statusNames,
      fallbackName: '欲望满溢',
    });
    this.gameState.battle = {
      player_lust_effect: playerLustEffect || {
        name: '欲望反噬',
        description: '敌人欲望达到上限时受到伤害，你获得少量治疗',
        effectProgram: {
          spec: 'mwg.effect/v1',
          steps: [
            { op: 'damage', target: 'opponent', amount: 8 },
            { op: 'heal', target: 'self', amount: 5 },
          ],
        },
      },
    };

    // 保障玩家最大欲望值来自 MVU 核心配置，避免被其他流程意外覆盖
    if (typeof core['max_lust'] === 'number' && core['max_lust'] > 0) {
      this.gameState.player.maxLust = core['max_lust'];
    }

    // 更新游戏状态
    this.gameState.currentTurn = 1;
    this.gameState.cardsPlayedThisTurn = 0;
    this.gameState.attacksPlayedThisTurn = 0;
    this.gameState.skillsPlayedThisTurn = 0;
    this.gameState.phase = 'player_turn';

  }

  public override createSnapshot(name: string): boolean {
    const isNew = super.createSnapshot(name);
    if (isNew) this.battleSessionStore.suspend();
    return isNew;
  }

  public override deleteSnapshot(name: string): boolean {
    const deleted = super.deleteSnapshot(name);
    if (deleted) this.battleSessionStore.resume(this.gameState);
    return deleted;
  }
}
