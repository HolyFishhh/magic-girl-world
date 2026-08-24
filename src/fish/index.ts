// Fish RPG 战斗系统入口文件 - 纯协调器
//
// ⚠️ 重要架构说明：
// 1. 这个文件只负责模块初始化、事件绑定和模块间协调
// 2. 所有具体的业务逻辑都在专门的模块中实现
// 3. 不包含任何重复的函数实现
//
import '../runtime/bootstrap';
import { ensureMvuRuntimeReady } from '../runtime/messageVariables';
import {
  formatBoundedContentIssueSummary,
  runBattleSessionAtomicAction,
  startBattleSession,
  type BattleStartFlowStep,
} from '../game-core';
import './index.scss';
import './styles/animations.scss';

// 导入专门模块
import { BattleManager } from './combat/battleManager';
import { CardSystem } from './combat/cardSystem';
import { DynamicStatusManager } from './combat/dynamicStatusManager';
import { UnifiedEffectExecutor } from './combat/unifiedEffectExecutor';
import { TavernBattleEndHost } from './core/battleEndHost';
import { TavernRelicTriggerHost } from './core/relicTriggerHost';
import { GameStateManager } from './core/gameStateManager';
import type { BattleContentIssue } from './core/battleContentPreflight';
import { TavernBattleRepairHost } from './core/battleRepairHost';
import { BattleSessionHost } from './core/battleSessionHost';
import { TavernBattleShellPresenter } from './ui/battleShellPresenter';

/**
 * Fish RPG 战斗系统协调器
 * 负责初始化各个模块并协调它们之间的交互
 */
class FishRPGCoordinator {
  private battleManager: BattleManager;
  private cardSystem: CardSystem;
  private effectExecutor: UnifiedEffectExecutor;
  private gameStateManager: GameStateManager;
  private relicTriggerHost: TavernRelicTriggerHost;
  private sessionHost: BattleSessionHost;
  private battleEndHost: TavernBattleEndHost;
  private battleRepairHost: TavernBattleRepairHost;
  private shellPresenter: TavernBattleShellPresenter;
  private refreshTimer: any = null;

  constructor() {
    // 初始化所有模块
    this.battleManager = BattleManager.getInstance();
    this.cardSystem = CardSystem.getInstance();
    this.effectExecutor = UnifiedEffectExecutor.getInstance();
    this.gameStateManager = GameStateManager.getInstance();
    this.relicTriggerHost = TavernRelicTriggerHost.getInstance();
    this.sessionHost = BattleSessionHost.getInstance();
    this.battleEndHost = TavernBattleEndHost.getInstance();
    this.battleRepairHost = TavernBattleRepairHost.getInstance();
    this.shellPresenter = TavernBattleShellPresenter.getInstance();
  }

  /**
   * 初始化战斗系统
   */
  async initialize(): Promise<void> {
    try {
      // Wait for the real MVU/Tavern Helper bridge before reading the battle floor.
      await ensureMvuRuntimeReady();

      this.shellPresenter.initialize({
        onPlayCard: cardId => this.playCard(cardId),
        onEndTurn: () => this.endTurn(),
        onExitBattle: () => this.exitBattle(),
        onShowItems: () => this.showItemModal(),
        onUseItem: itemId => this.useItem(itemId),
        onResetBattle: () => this.exitBattle(),
      });

      // 刷新动态状态管理器（确保从MVU变量加载最新状态定义）
      DynamicStatusManager.getInstance().refreshFromMVU();

      this.setupStateRefreshListeners();

      // 加载战斗数据
      await this.loadBattleData();

      const loadError = this.gameStateManager.getLastLoadError();
      if (loadError) {
        const loadIssues = this.gameStateManager.getLastLoadIssues();
        const safeMessage =
          loadIssues.length > 0 ? `战斗内容校验失败：${formatBoundedContentIssueSummary(loadIssues)}` : loadError;
        this.shellPresenter.showBattleUnavailable(safeMessage, loadIssues, () =>
          this.requestBattleContentRepair(loadIssues),
        );
        return;
      }

      // 无敌人时，弹出提示对话框并覆盖战斗区域（变量注册不完全）
      const enemy = this.gameStateManager.getEnemy();
      if (!enemy || !enemy.name) {
        const guide = `无法进行战斗：敌人变量注册错误，请尝试重新生成`;
        const issues: BattleContentIssue[] = [
          { path: 'battle.enemy.name', code: 'MISSING_VALUE', message: '名称不能为空' },
        ];
        this.shellPresenter.showBattleUnavailable(guide, issues, () => this.requestBattleContentRepair(issues));
        return;
      }

      // 刷新UI
      await this.refreshUI();

      // 初始化欲望溢出显示系统（在UI刷新后，确保DOM元素已存在）
      this.shellPresenter.initializeAfterFirstRender();

      // The portable session coordinator skips one-shot triggers when this iframe restored a snapshot.
      await this.triggerBattleStartEffects();

      // 战斗开始效果执行后，再次刷新UI以显示新的状态
      await this.refreshUI();
      await this.gameStateManager.saveToSillyTavern();

      if (this.gameStateManager.wasBattleSessionRestored() && this.gameStateManager.isGameOver()) {
        this.battleEndHost.resumeBattleEndDialog();
      }

      // 验证系统状态
      this.validateSystemState();
    } catch (error) {
      console.error('❌ 初始化失败:', error);
      const message = error instanceof Error ? error.message : String(error);
      this.shellPresenter.showBattleUnavailable(`酒馆运行环境未就绪：${message}`);
    }
  }

  /**
   * 验证系统状态
   */
  private async requestBattleContentRepair(issues: readonly BattleContentIssue[]): Promise<void> {
    if (!this.canMutateCurrentMessage()) return;
    this.shellPresenter.setRepairPending(true);
    try {
      await this.battleRepairHost.requestRepair(issues);
    } catch (error) {
      this.shellPresenter.showRepairFailure(error);
    } finally {
      this.shellPresenter.setRepairPending(false);
    }
  }

  private validateSystemState(): void {
    const gameState = this.gameStateManager.getGameState();

    // 检查敌人数据是否存在
    if (!gameState.enemy || !gameState.enemy.name) {
      console.error('❌ 系统验证失败：敌人数据缺失');
      const issues: BattleContentIssue[] = [
        { path: 'battle.enemy.name', code: 'MISSING_VALUE', message: '名称不能为空' },
      ];
      this.shellPresenter.showBattleUnavailable('敌人数据未注册或不完整，请请求 AI 修复当前战斗场景。', issues, () =>
        this.requestBattleContentRepair(issues),
      );
      return;
    }

  }

  /**
   * 设置事件监听器
   */
  private setupStateRefreshListeners(): void {
    // 监听 GameStateManager 的关键事件以自动刷新UI
    // 确保抽牌/加牌/弃牌/洗牌等由效果或遗物触发时，UI能即时更新
    const gsm = this.gameStateManager;
    const scheduleRefresh = () => {
      // 合并短时间内的多次事件，减少重复刷新与日志噪声
      if (this.refreshTimer) {
        return;
      }
      this.refreshTimer = setTimeout(async () => {
        this.refreshTimer = null;
        try {
          await this.refreshUI();
        } catch (e) {
          console.error('自动刷新UI失败:', e);
        }
      }, 30);
    };

    const eventsToRefresh = [
      'cards_drawn',
      'hand_updated',
      'card_added_to_hand',
      'card_added_to_deck',
      'discard_updated',
      'deck_shuffled',
      'player_updated',
      'enemy_updated',
      'player_status_added',
      'player_status_updated',
      'player_status_removed',
      'enemy_status_added',
      'enemy_status_updated',
      'enemy_status_removed',
      'state_loaded',
      'turn_incremented',
      'phase_changed',
    ];

    eventsToRefresh.forEach(evt => {
      gsm.addEventListener(evt, () => {
        scheduleRefresh();
      });
    });
  }

  /**
   * 加载战斗数据
   */
  private async loadBattleData(): Promise<void> {
    try {
      await this.gameStateManager.loadFromSillyTavern();
    } catch (error) {
      console.error('加载战斗数据失败:', error);
    }
  }

  /**
   * 触发战斗开始时的效果
   */
  private async triggerBattleStartEffects(): Promise<void> {
    try {
      const result = await startBattleSession({
        gate: this.sessionHost.gate,
        beginTransaction: action => this.sessionHost.beginTransaction(action),
        commitTransaction: token => this.sessionHost.commitTransaction(token),
        rollbackTransaction: token => this.sessionHost.rollbackTransaction(token),
        restored: this.gameStateManager.wasBattleSessionRestored(),
        isTerminal: () => this.gameStateManager.isGameOver(),
        executeStartStep: step => this.executeBattleStartFlowStep(step),
      });

      if (result.status === 'busy') throw new Error('战斗会话正在处理另一项操作');

    } catch (error) {
      console.error('❌ 触发战斗开始时效果失败，已回滚初始化状态:', error);
      throw error;
    }
  }

  private async executeBattleStartFlowStep(step: BattleStartFlowStep): Promise<void> {
    switch (step) {
      case 'player_abilities_battle_start':
        await this.effectExecutor.processAbilitiesByTrigger('player', 'battle_start');
        return;
      case 'enemy_abilities_battle_start':
        await this.effectExecutor.processAbilitiesByTrigger('enemy', 'battle_start');
        return;
      case 'player_abilities_gain_initial':
        await this.effectExecutor.processAbilitiesByTrigger('player', 'ability_gain');
        return;
      case 'enemy_abilities_gain_initial':
        await this.effectExecutor.processAbilitiesByTrigger('enemy', 'ability_gain');
        return;
      case 'player_relics_ability_gain_initial':
        await this.relicTriggerHost.triggerRelics('ability_gain', { initial: true });
        return;
      case 'player_relics_battle_start':
        await this.relicTriggerHost.triggerRelics('battle_start');
        return;
      default: {
        const exhaustive: never = step;
        throw new Error(`未知战斗开始步骤: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * 刷新UI
   */
  private async refreshUI(): Promise<void> {
    try {
      const gameState = this.gameStateManager.getGameState();
      if (gameState) {
        // 将本轮新增的 MUV 卡牌增量同步到抽牌堆。
        this.gameStateManager.syncNewCardsFromMVU();
        await this.shellPresenter.refresh(gameState);
      } else {
        console.warn('⚠️ 没有游戏状态数据');
      }
    } catch (error) {
      console.error('刷新UI失败:', error);
    }
  }

  /**
   * 使用卡牌
   */
  private async playCard(cardId: string): Promise<void> {
    try {
      if (!this.canMutateCurrentMessage()) return;
      if (!this.battleManager.canPlayerAct()) return;

      // 获取卡牌信息用于日志
      const card = this.cardSystem.getCardInHand(cardId);
      const cardName = card ? card.name : cardId;

      const success = await this.cardSystem.playCard(cardId);
      if (success) {
        this.shellPresenter.logPlayerAction('卡牌', `使用了卡牌 ${cardName}`);
        await this.refreshUI();
      } else {
        // 卡牌使用失败时，确保UI状态正确
        await this.refreshUI();
      }
    } catch (error) {
      console.error('使用卡牌失败:', error);
    }
  }

  /**
   * 结束回合
   */
  private async endTurn(): Promise<void> {
    try {
      if (!this.canMutateCurrentMessage()) return;
      await this.battleManager.endPlayerTurn();
      await this.refreshUI();
    } catch (error) {
      console.error('结束回合失败:', error);
    }
  }

  /**
   * 退出战斗
   */
  private async exitBattle(): Promise<void> {
    try {
      if (!this.canMutateCurrentMessage()) return;
      await this.battleEndHost.restartBattle();
    } catch (error) {
      console.error('退出战斗失败:', error);
    }
  }

  /**
   * 显示道具模态框
   */
  private showItemModal(): void {
    try {
      if (!this.canMutateCurrentMessage()) return;
      if (!this.battleManager.canPlayerAct()) return;
      this.shellPresenter.showItems(this.gameStateManager.getPlayer().items || []);
    } catch (error) {
      console.error('显示道具模态框失败:', error);
    }
  }

  /**
   * 使用道具
   */
  private async useItem(itemId: string): Promise<void> {
    try {
      if (!this.canMutateCurrentMessage()) return;
      const result = await runBattleSessionAtomicAction(
        'use_item',
        {
          gate: this.sessionHost.gate,
          beginTransaction: action => this.sessionHost.beginTransaction(action),
          commitTransaction: token => this.sessionHost.commitTransaction(token),
          rollbackTransaction: token => this.sessionHost.rollbackTransaction(token),
          canRun: () => this.battleManager.canPlayerAct(),
          isTerminal: () => this.gameStateManager.isGameOver(),
        },
        async () => {
          const item = this.gameStateManager.getPlayer().items?.find(entry => entry.id === itemId);
          if (!item || item.count <= 0) {
            throw new Error(!item ? `道具未找到: ${itemId}` : `道具数量不足: ${item.name}`);
          }

          await UnifiedEffectExecutor.getInstance().executeEffectProgram(item.effectProgram, true);

          const nextItems = (this.gameStateManager.getPlayer().items || []).map(current =>
            current.id === itemId ? { ...current, count: Math.max(0, current.count - 1) } : current,
          );
          this.gameStateManager.updatePlayer({ items: nextItems });
          return item.name;
        },
      );

      if (result.status !== 'completed') return;
      this.shellPresenter.logPlayerAction('道具', `使用了道具 ${result.value}`);
      this.shellPresenter.hideItems();
      await this.refreshUI();
    } catch (error) {
      console.error('使用道具失败:', error);
    }
  }

  private canMutateCurrentMessage(): boolean {
    return this.shellPresenter.canMutateCurrentMessage();
  }
}

const coordinator = new FishRPGCoordinator();
void coordinator.initialize();
