import { getCurrentMessageVariables } from '../../runtime/messageVariables';
import {
  assessEnemyBudget,
  BattleStateStore,
  countCardOwnership,
  createBattleRandomState,
  resolveStartingHand,
  shuffleCards,
  type BattleRequest,
  BattleContentContractError,
  contentPathToBattlePath,
  summarizeBuildBudget,
  type Card,
  type Enemy,
  type GameState,
} from '../../game-core';
import { formatBattleContentIssues, preflightBattleContent, type BattleContentIssue } from './battleContentPreflight';
import { inspectBattleDataContract, readBattleDataContract } from './battleDataContract';
import { BattleSessionStore } from './battleSessionStore';
import {
  buildMvuStatusDisplayContext,
  convertMvuCards,
  convertMvuEnemy,
  convertMvuAbilities,
  convertMvuActiveStatuses,
  convertMvuItems,
  convertMvuRelics,
  mergeMvuCards,
  normalizeMvuArray,
} from './mvuBattleAdapter';
import { normalizeNamedEffectDefinition } from './battleContentAdapter';
import { battleRequestToRuntimeData, createBattleRequestFromMvu } from './battleContractAdapter';

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

    try {
      const variables = getCurrentMessageVariables();
      const battleContract = readBattleDataContract(variables);
      const battleData = battleContract?.data;
      const mvuEnemy = battleData?.enemy || null;
      const statusContext = buildMvuStatusDisplayContext(battleData?.statuses);
      const restoredEnemy = convertMvuEnemy(mvuEnemy, () => this.nextRandom(), statusContext);
      if (!restoredEnemy) return null;
      this.gameState.enemy = restoredEnemy;
      return { ...restoredEnemy };
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
      const variables = getCurrentMessageVariables();

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
        this.gameState = restoredState;
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

      // 统计当前牌堆系中各 originalId 的数量（不含 player.deck，避免与初始化时的快照重复计算）
      const currentCounts = countCardOwnership(
        [...player.hand, ...player.drawPile, ...player.discardPile, ...player.exhaustPile],
        this.getInFlightCardCounts(),
      );

      // 统计期望数量
      const desiredCounts = new Map<string, { card: any; count: number }>();
      for (const c of mvuCards) {
        if (!c || typeof c !== 'object') continue;
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
    const enemy = battleData.enemy || null;

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
      currentHp: core['hp'] ?? core['max_hp'] ?? 80,
      maxHp: core['max_hp'] ?? 100,
      currentLust: core['lust'] ?? 0,
      maxLust: core['max_lust'] ?? 100,
      energy: 3, // 战斗中计算，不从MVU读取
      maxEnergy: 3, // 固定值
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
    const convertedEnemy = convertMvuEnemy(enemy, () => this.nextRandom(), statusContext);
    if (convertedEnemy) {
      this.gameState.enemy = convertedEnemy;
    } else {
      console.error('❌ 无法读取敌人数据！battle.enemy 变量未正确设置');
      throw new Error('敌人数据未找到或无效。请确保AI已正确生成敌人信息。');
    }

    // 设置战斗数据
    const playerLustEffect = normalizeNamedEffectDefinition(battleData.player_lust_effect, { statusNames });
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
