// Fish RPG 战斗系统入口文件 - 纯协调器
//
// ⚠️ 重要架构说明：
// 1. 这个文件只负责模块初始化、事件绑定和模块间协调
// 2. 所有具体的业务逻辑都在专门的模块中实现
// 3. 不包含任何重复的函数实现
//
import './index.scss';
import './styles/animations.scss';

// 导入专门模块
import { BattleManager } from './combat/battleManager';
import { CardSystem } from './combat/cardSystem';
import { DynamicStatusManager } from './combat/dynamicStatusManager';
import { EffectEngine } from './combat/effectEngine';
import { GameStateManager } from './core/gameStateManager';
import { BattleLog } from './modules/battleLog';
import { RelicEffectManager } from './modules/relicEffectManager';
import { AnimationManager } from './ui/animationManager';
import { BattleUI } from './ui/battleUI';
import { Card3DEffects, CardParticleEffects } from './ui/card3DEffects';
import { CardPlayMode } from './ui/cardPlayMode';
import { LustOverflowDisplay } from './ui/lustOverflowDisplay';
import { ModifierDisplay } from './ui/modifierDisplay';
import { PileViewer } from './ui/pileViewer';
import { StatusDetailViewer } from './ui/statusDetailViewer';

declare global {
  interface Window {
    playCardWithMVU: (cardId: string) => Promise<void>;
    endTurnWithMVU: () => Promise<void>;
    exitBattleWithMVU: () => Promise<void>;
    drawCardsWithMVU: (count: number) => Promise<void>;
    refreshBattleUI: () => Promise<void>;
  }
}

/**
 * Fish RPG 战斗系统协调器
 * 负责初始化各个模块并协调它们之间的交互
 */
class FishRPGCoordinator {
  private battleManager: BattleManager;
  private cardSystem: CardSystem;
  private effectEngine: EffectEngine;
  private gameStateManager: GameStateManager;
  private animationManager: AnimationManager;
  private pileViewer: PileViewer;
  private statusDetailViewer: StatusDetailViewer;
  private lustOverflowDisplay: LustOverflowDisplay;
  private modifierDisplay: ModifierDisplay;
  private relicEffectManager: RelicEffectManager;
  private cardPlayMode: CardPlayMode;
  private refreshTimer: any = null;

  constructor() {
    // 初始化所有模块
    this.battleManager = BattleManager.getInstance();
    this.cardSystem = CardSystem.getInstance();
    this.effectEngine = EffectEngine.getInstance();
    this.gameStateManager = GameStateManager.getInstance();
    this.animationManager = AnimationManager.getInstance();
    this.pileViewer = PileViewer.getInstance();
    this.statusDetailViewer = StatusDetailViewer.getInstance();
    this.lustOverflowDisplay = LustOverflowDisplay.getInstance();
    this.modifierDisplay = new ModifierDisplay(this.gameStateManager);
    this.relicEffectManager = RelicEffectManager.getInstance();
    this.cardPlayMode = CardPlayMode.getInstance();
  }

  /**
   * 初始化战斗系统
   */
  async initialize(): Promise<void> {
    try {
      console.log('🎮 Fish RPG 战斗系统启动');

      // 初始化各个模块
      BattleLog.init();
      this.statusDetailViewer.initializeStatusDetailSystem();

      // 初始化卡牌特效
      Card3DEffects.getInstance();
      CardParticleEffects.getInstance();

      // 初始化卡牌出牌模式
      this.cardPlayMode.init();

      // 刷新动态状态管理器（确保从MVU变量加载最新状态定义）
      DynamicStatusManager.getInstance().refreshFromMVU();

      // 设置事件监听器
      this.setupEventListeners();

      // 加载战斗数据
      await this.loadBattleData();

      // 无敌人时，弹出提示对话框并覆盖战斗区域（变量注册不完全）
      const enemy = this.gameStateManager.getEnemy();
      if (!enemy || !enemy.name) {
        const guide = `无法进行战斗：敌人变量注册错误，请尝试重新生成`;
        this.showNoEnemyDialog(guide);
        return;
      }

      // 刷新UI
      await this.refreshUI();

      // 初始化欲望溢出显示系统（在UI刷新后，确保DOM元素已存在）
      this.lustOverflowDisplay.initializeLustOverflowSystem();

      // 触发战斗开始时的效果（在初始化的最后阶段）
      await this.triggerBattleStartEffects();

      // 战斗开始效果执行后，再次刷新UI以显示新的状态
      await this.refreshUI();

      console.log('✅ Fish RPG 战斗系统初始化完成');

      // 验证系统状态
      this.validateSystemState();
    } catch (error) {
      console.error('❌ 初始化失败:', error);
    }
  }

  /**
   * 验证系统状态
   */
  private showNoEnemyDialog(message: string): void {
    const dlg = document.getElementById('no-enemy-dialog') as HTMLElement | null;
    const msgEl = document.getElementById('no-enemy-message') as HTMLElement | null;
    if (msgEl) msgEl.textContent = message;
    if (dlg) dlg.style.display = 'block';
    const refreshBtn = document.getElementById('no-enemy-refresh') as HTMLButtonElement | null;
    refreshBtn?.addEventListener('click', () => location.reload());
  }

  private validateSystemState(): void {
    const gameState = this.gameStateManager.getGameState();

    // 检查敌人数据是否存在
    if (!gameState.enemy || !gameState.enemy.name) {
      console.error('❌ 系统验证失败：敌人数据缺失');

      // 显示错误提示
      const errorHtml = `
        <div class="error-banner" style="
          background: linear-gradient(135deg, #ff4444, #cc0000);
          color: white;
          padding: 20px;
          border-radius: 10px;
          margin: 20px;
          text-align: center;
          box-shadow: 0 4px 6px rgba(0,0,0,0.3);
          animation: pulse 2s infinite;
        ">
          <h2 style="margin: 0 0 10px 0;">⚠️ 战斗初始化失败</h2>
          <p style="margin: 5px 0;">无法加载敌人数据！</p>
          <p style="margin: 5px 0; font-size: 14px;">请确保AI已正确生成 battle.enemy 变量</p>
          <button onclick="location.reload()" style="
            background: white;
            color: #cc0000;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            margin-top: 10px;
          ">刷新页面</button>
        </div>
        <style>
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.02); }
            100% { transform: scale(1); }
          }
        </style>
      `;

      // 在多个位置显示错误
      const containers = [
        document.querySelector('.enemy-container'),
        document.querySelector('.battle-log-content'),
        document.querySelector('.player-container'),
      ];

      containers.forEach(container => {
        if (container) {
          container.innerHTML = errorHtml;
        }
      });

      return; // 不继续验证
    }

    console.log('🔍 系统状态验证:', {
      player: {
        hand: gameState.player?.hand?.length || 0,
        drawPile: gameState.player?.drawPile?.length || 0,
        discardPile: gameState.player?.discardPile?.length || 0,
        energy: gameState.player?.energy || 0,
        hp: `${gameState.player?.currentHp || 0}/${gameState.player?.maxHp || 0}`,
        lust: `${gameState.player?.currentLust || 0}/${gameState.player?.maxLust || 0}`,
      },
      enemy: {
        name: gameState.enemy?.name || 'None',
        hasActions: (gameState.enemy?.actions?.length || 0) > 0,
        hasNextAction: !!gameState.enemy?.nextAction,
        hasLustEffect: !!gameState.enemy?.lustEffect,
        hp: `${gameState.enemy?.currentHp || 0}/${gameState.enemy?.maxHp || 0}`,
        lust: `${gameState.enemy?.currentLust || 0}/${gameState.enemy?.maxLust || 0}`,
      },
      phase: gameState.phase,
      turn: gameState.currentTurn,
    });

    // 验证关键模块是否正常
    console.log('🔧 模块状态:', {
      battleManager: !!this.battleManager,
      cardSystem: !!this.cardSystem,
      effectEngine: !!this.effectEngine,
      animationManager: !!this.animationManager,
      pileViewer: !!this.pileViewer,
      statusDetailViewer: !!this.statusDetailViewer,
      lustOverflowDisplay: !!this.lustOverflowDisplay,
    });
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 卡牌点击事件 - 支持新的增强卡牌
    $(document).on('click', '.card.clickable:not(.disabled), .enhanced-card.clickable:not(.disabled)', async event => {
      event.preventDefault();
      event.stopPropagation();

      const cardId = $(event.currentTarget).data('card-id');
      console.log('🃏 卡牌点击事件:', cardId);

      if (cardId) {
        // 诅咒牌点击时直接提示不可打出，避免播放使用动画
        const player = this.gameStateManager.getPlayer();
        const card = player.hand.find(c => c.id === cardId);
        if (card && (card as any).type === 'Curse') {
          AnimationManager.getInstance().showCardBlockedNotification((card as any).name || '诅咒', '诅咒牌无法被打出');
          return;
        }
        await this.playCard(cardId);
      } else {
        console.warn('⚠️ 卡牌没有ID:', event.currentTarget);
      }
    });

    // 结束回合按钮
    $('.end-turn-button').on('click', async () => {
      await this.endTurn();
    });

    // 战斗日志按钮
    $(document).on('click', '#battle-log-btn', () => {
      $('#battle-log').fadeToggle(200);
    });

    // 退出战斗按钮
    $('#exit-battle-btn').on('click', async () => {
      await this.exitBattle();
    });

    // 使用道具按钮
    $('#use-item-btn').on('click', () => {
      this.showItemModal();
    });

    // 道具使用相关事件
    $(document).on('click', '.item-use-btn', async event => {
      const itemId = $(event.currentTarget).data('item-id');
      if (itemId) {
        await this.useItem(itemId);
      }
    });

    // 关闭道具模态框
    $(document).on('click', '#close-item-modal', () => {
      $('#item-use-modal').hide();
    });

    // 设置牌堆查看事件
    this.pileViewer.setupPileClickEvents();

    // 设置状态详情查看事件
    this.statusDetailViewer.setupStatusClickEvents();

    // 监听牌堆数据请求事件
    document.addEventListener('requestPileData', (event: any) => {
      const { pileType } = event.detail;
      this.pileViewer.showPileByType(pileType, this.gameStateManager);
    });

    // 监听状态详情请求事件
    document.addEventListener('requestStatusDetail', (event: any) => {
      const { statType } = event.detail;
      this.statusDetailViewer.showStatusByType(statType, this.gameStateManager);
    });

    // 牌堆查看按钮
    $('#draw-pile-btn').on('click', () => {
      // TODO: 实现牌堆查看功能
      console.log('查看抽牌堆');
    });
    $('#discard-pile-btn').on('click', () => {
      // TODO: 实现牌堆查看功能
      console.log('查看弃牌堆');
    });

    // 游戏结束对话框按钮
    $('.restart-btn').on('click', () => {
      console.log('🔄 重新开始游戏...');
      location.reload();
    });

    $('.return-setup-btn').on('click', () => {
      console.log('🔄 返回设置...');
      location.reload();
    });

    console.log('✅ 事件监听器设置完成');

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
      const loaded = await this.gameStateManager.loadFromSillyTavern();
      if (!loaded) {
        console.log('未找到保存的游戏状态，使用默认状态');
      }
    } catch (error) {
      console.error('加载战斗数据失败:', error);
    }
  }

  /**
   * 触发战斗开始时的效果
   */
  private async triggerBattleStartEffects(): Promise<void> {
    try {
      console.log('🚀 触发战斗开始时的效果...');

      // 触发战斗开始时的状态效果
      await this.effectEngine.processStatusEffectsAtBattleStart('player');
      await this.effectEngine.processStatusEffectsAtBattleStart('enemy');

      // 触发战斗开始时的能力
      await this.effectEngine.processAbilitiesAtBattleStart('player');
      await this.effectEngine.processAbilitiesAtBattleStart('enemy');

      // 处理被动能力（在战斗开始时应用）
      await this.effectEngine.processPassiveAbilities('player');
      await this.effectEngine.processPassiveAbilities('enemy');

      // 为了兼容AI生成的不确定性，战斗开始时也触发获得能力时的效果
      await this.effectEngine.processAbilitiesByTrigger('player', 'ability_gain');
      await this.effectEngine.processAbilitiesByTrigger('enemy', 'ability_gain');

      // 触发遗物的战斗开始效果
      await this.relicEffectManager.triggerOnBattleStart();

      // 被动遗物效果不需要触发，会在计算修饰符时自动读取
      // await this.relicEffectManager.triggerPassiveEffects();

      console.log('✅ 战斗开始时效果触发完成');
    } catch (error) {
      console.error('❌ 触发战斗开始时效果失败:', error);
    }
  }

  /**
   * 刷新UI
   */
  private async refreshUI(): Promise<void> {
    try {
      const gameState = this.gameStateManager.getGameState();
      console.log('🔄 刷新UI - 当前游戏状态:', {
        player: gameState?.player
          ? {
              hp: gameState.player.currentHp,
              energy: gameState.player.energy,
              handSize: gameState.player.hand?.length || 0,
              deckSize: gameState.player.drawPile?.length || 0,
              hand: gameState.player.hand?.map(c => ({ id: c.id, name: c.name })) || [],
            }
          : null,
        enemy: gameState?.enemy
          ? {
              name: gameState.enemy.name,
              hp: gameState.enemy.currentHp,
            }
          : null,
        phase: gameState?.phase,
      });

      if (gameState) {
        // 兼容本轮新增的卡牌：从MVU变量增量同步到抽牌堆
        this.gameStateManager.syncNewCardsFromMVU();
        await BattleUI.refreshBattleUI(gameState);
        // 敌人意图只在回合切换或设定下一行动时更新，避免频繁刷新引起的噪声
        // 刷新修饰符显示
        this.modifierDisplay.refresh();
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
      // 找到卡牌元素并播放动画
      const cardElement = $(`.card[data-card-id="${cardId}"], .enhanced-card[data-card-id="${cardId}"]`);
      if (cardElement.length > 0) {
        await this.animationManager.animateCardPlay(cardElement);
      }

      // 获取卡牌信息用于日志
      const card = this.cardSystem.getCardInHand(cardId);
      const cardName = card ? card.name : cardId;

      const success = await this.cardSystem.playCard(cardId);
      if (success) {
        BattleLog.logPlayerAction('卡牌', `使用了卡牌 ${cardName}`);
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
      console.log('退出战斗');

      // 统一在战斗结束流程中由效果执行器清空外部变量；此处仅刷新页面
      location.reload();
    } catch (error) {
      console.error('退出战斗失败:', error);
    }
  }

  /**
   * 显示道具模态框
   */
  private showItemModal(): void {
    try {
      const gameState = this.gameStateManager.getGameState();
      const items = (gameState.player as any)?.items || [];

      // 过滤可用道具
      const availableItems = items.filter((item: any) => item.count > 0);

      if (availableItems.length === 0) {
        console.log('没有可用道具');
        // 使用toastr显示提示
        if (typeof toastr !== 'undefined') {
          toastr.info('当前没有可用的道具', '提示');
        } else {
          // 如果toastr不可用，使用简单的alert
          alert('当前没有可用的道具');
        }
        return;
      }

      // 生成道具列表HTML
      const itemsHTML = availableItems
        .map(
          (item: any) => `
          <div class="item-entry">
            <div class="item-info">
              <div class="item-header">
                <span class="item-emoji">${item.emoji || '🧪'}</span>
                <span class="item-name">${item.name}</span>
                <span class="item-count">x${item.count}</span>
              </div>
              <div class="item-description">${item.description || '无描述'}</div>
            </div>
            <button class="item-use-btn" data-item-id="${item.id}">使用</button>
          </div>
        `,
        )
        .join('');

      // 更新模态框内容
      $('#item-use-modal .item-list').html(itemsHTML);

      // 显示模态框
      $('#item-use-modal').show();

      console.log('显示道具模态框');
    } catch (error) {
      console.error('显示道具模态框失败:', error);
    }
  }

  /**
   * 使用道具
   */
  private async useItem(itemId: string): Promise<void> {
    try {
      const gameState = this.gameStateManager.getGameState();
      const item = (gameState.player as any)?.items?.find((i: any) => i.id === itemId);

      if (!item) {
        console.error('道具未找到:', itemId);
        return;
      }

      if (item.count <= 0) {
        console.log('道具数量不足');
        return;
      }

      // 执行道具效果
      await this.effectEngine.executeEffect(item.effect, true);

      // 减少道具数量
      item.count -= 1;

      // 记录日志
      BattleLog.logPlayerAction('道具', `使用了道具 ${item.name}`);

      // 关闭模态框
      $('#item-use-modal').hide();

      // 刷新UI
      await this.refreshUI();

      console.log(`使用道具: ${item.name}`);
    } catch (error) {
      console.error('使用道具失败:', error);
    }
  }

  /**
   * 抽卡
   */
  private async drawCards(count: number): Promise<void> {
    try {
      const drawnCards = this.cardSystem.drawCards(count);
      if (drawnCards.length > 0) {
        // 播放抽牌动画
        console.log(`抽取了 ${drawnCards.length} 张卡牌`);
        await this.refreshUI();
      }
    } catch (error) {
      console.error('抽卡失败:', error);
    }
  }
}

// 全局协调器实例
let coordinator: FishRPGCoordinator;

// 暴露给全局的函数（向后兼容）
window.playCardWithMVU = async (cardId: string) => {
  if (coordinator) {
    await coordinator['playCard'](cardId);
  }
};

window.endTurnWithMVU = async () => {
  if (coordinator) {
    await coordinator['endTurn']();
  }
};

window.exitBattleWithMVU = async () => {
  if (coordinator) {
    await coordinator['exitBattle']();
  }
};

window.drawCardsWithMVU = async (count: number) => {
  if (coordinator) {
    await coordinator['drawCards'](count);
  }
};

window.refreshBattleUI = async () => {
  if (coordinator) {
    await coordinator['refreshUI']();
  }
};

// 移除getTavernHelper，直接使用全局函数

// 初始化系统
$(() => {
  coordinator = new FishRPGCoordinator();
  coordinator.initialize();
});

console.log('✅ Fish RPG战斗系统模块加载完成');
