import { GameStateManager } from '../core/gameStateManager';
import { BattleLog } from '../modules/battleLog';
import { RelicEffectManager } from '../modules/relicEffectManager';
import { Enemy, EnemyAction } from '../types';
import { AnimationManager } from '../ui/animationManager';
import { CardSystem } from './cardSystem';
import { EffectEngine } from './effectEngine';
import { UnifiedEffectExecutor } from './unifiedEffectExecutor';

export class BattleManager {
  private static instance: BattleManager;
  private gameStateManager: GameStateManager;
  private cardSystem: CardSystem;
  private effectEngine: EffectEngine;
  private animationManager: AnimationManager;
  private relicEffectManager: RelicEffectManager;

  private constructor() {
    this.gameStateManager = GameStateManager.getInstance();
    this.cardSystem = CardSystem.getInstance();
    this.effectEngine = EffectEngine.getInstance();
    this.animationManager = AnimationManager.getInstance();
    this.relicEffectManager = RelicEffectManager.getInstance();
    this.setupEventListeners();
  }

  public static getInstance(): BattleManager {
    if (!BattleManager.instance) {
      BattleManager.instance = new BattleManager();
    }
    return BattleManager.instance;
  }

  private setupEventListeners(): void {
    // 移除阶段切换监听器，现在使用同步流程
    // this.gameStateManager.addEventListener('phase_changed', state => {
    //   this.handlePhaseChange(state.phase);
    // });
  }

  // 战斗初始化
  public async initializeBattle(enemy: Enemy): Promise<void> {
    console.log('初始化战斗:', enemy.name);

    // 设置敌人
    this.gameStateManager.setEnemy(enemy);

    // 重置玩家状态
    const player = this.gameStateManager.getPlayer();
    this.gameStateManager.updatePlayer({
      energy: player.maxEnergy,
    });
    // 初始化回合号
    this.gameStateManager.setCurrentTurn(0 as any);

    // 抽起始手牌
    this.cardSystem.drawStartingHand();

    // 设置敌人首次行动（第一回合敌人不执行，只生成意图）
    this.setEnemyNextAction();

    // 战斗开始时的效果现在由主初始化流程统一管理
    // 这里不再重复触发

    // 开始玩家回合
    this.gameStateManager.setPhase('player_turn');
  }

  // 阶段变化处理（已弃用）
  // private async handlePhaseChange(phase: string): Promise<void> {
  //   switch (phase) {
  //     case 'player_turn':
  //       await this.startPlayerTurn();
  //       break;
  //     // case 'enemy_turn':
  //     //   await this.startEnemyTurn();
  //     //   break;
  //     case 'game_over':
  //       await this.handleGameOver();
  //       break;
  //   }
  // }

  // 玩家回合开始
  private async startPlayerTurn(): Promise<void> {
    console.log('玩家回合开始');

    const player = this.gameStateManager.getPlayer();

    // 重置能量
    this.gameStateManager.updatePlayer({ energy: player.maxEnergy });

    // 处理状态效果
    this.effectEngine.processStatusEffectsAtTurnStart('player');

    // 处理玩家能力
    await this.effectEngine.processAbilitiesAtTurnStart('player');

    // 触发遗物的回合开始效果
    await this.relicEffectManager.triggerOnTurnStart();

    // 回合开始的卡牌处理
    this.cardSystem.onTurnStart();

    // 检查游戏是否结束
    if (this.gameStateManager.isGameOver()) {
      return;
    }

    console.log('等待玩家操作...');
  }

  // 玩家回合结束 - 参考旧文件的同步流程
  public async endPlayerTurn(): Promise<void> {
    console.log('玩家回合结束');

    // 1. 回合结束的卡牌处理（弃牌、清除格挡等）
    if (typeof this.cardSystem.onTurnEnd === 'function') {
      this.cardSystem.onTurnEnd();
    }

    // 不在此处清除玩家格挡；让格挡在敌人回合中生效，改为在玩家回合开始时清除

    // 玩家回合结束：触发玩家状态的 turn_end 与衰减
    await this.effectEngine.processStatusEffectsAtTurnEnd('player');

    // 2. 进入新回合计数（用于让敌人行动日志使用下一回合号）
    this.gameStateManager.incrementTurn();

    // 3. 执行敌人回合（在新回合号下执行敌人意图）
    await this.executeEnemyTurn();

    // 4. 开始玩家回合
    await this.startNewTurn();
  }

  // 执行敌人回合 - 参考旧文件的实现
  private async executeEnemyTurn(): Promise<void> {
    console.log('敌人回合开始');

    const enemy = this.gameStateManager.getEnemy();
    if (!enemy) return;

    // 敌人回合开始时清除敌人格挡（让格挡在玩家回合中生效）
    // 使用 skipAttributeTriggers 避免触发 lose_block
    this.gameStateManager.updateEnemy({ block: 0 }, { skipAttributeTriggers: true });

    // 处理敌人状态效果（敌人的tick应当在我方回合开始前生效，此处保留）
    this.effectEngine.processStatusEffectsAtTurnStart('enemy');

    // 处理敌人能力
    await this.effectEngine.processAbilitiesAtTurnStart('enemy');

    // 检查敌人是否被眩晕（无法行动）
    const executor = UnifiedEffectExecutor.getInstance();
    if (executor.isStunned('enemy')) {
      console.log('⚡ 敌人被眩晕，跳过行动');
      BattleLog.addLog(`${enemy.name}被眩晕，无法行动！`, 'system');
      this.animationManager.showEnemyActionAnimation('眩晕', `${enemy.name}无法行动！`);
      // 跳过敌人行动，设置下一次行动并开始玩家回合
      await this.effectEngine.processStatusEffectsAtTurnEnd('enemy');
      this.setEnemyNextAction();
      return; // 直接返回，后续由 endPlayerTurn 处理玩家回合开始
    }

    // 检查游戏是否结束
    if (this.gameStateManager.isGameOver()) {
      return;
    }

    // 执行敌人行动：第一回合不执行，仅从第二回合开始
    if (this.gameStateManager.getGameState().currentTurn > 1 && enemy.nextAction) {
      console.log(`🎯 执行预定行动: ${enemy.nextAction.name}`);
      await this.executeEnemyAction();
    } else if (enemy.actions && enemy.actions.length > 0) {
      // 如果没有预设行动，按统一路径选择当前行动（支持随机/概率/顺序/顺序+概率）
      try {
        const { EnemyIntentManager } = require('../modules/enemyIntent');
        EnemyIntentManager.setNextAction(enemy, enemy.actions);
      } catch (e) {
        console.warn('设置敌人当前行动失败，回退为随机:', e);
        const validActions = this.filterMetadata(enemy.actions);
        if (validActions.length > 0) {
          const randomAction = validActions[Math.floor(Math.random() * validActions.length)];
          enemy.nextAction = {
            name: randomAction.name,
            description: randomAction.description,
            effect: randomAction.effect,
            weight: (randomAction as any).weight || 1,
          } as any;
        }
      }
      await this.executeEnemyAction();
    } else {
      // 使用默认行为
      await this.executeDefaultEnemyAction();
    }

    // 设置下一个行动（为下回合准备）。显示更新由 EnemyIntentManager.setNextAction 内部完成，避免重复刷新
    this.setEnemyNextAction();

    // 检查游戏是否结束
    if (this.gameStateManager.isGameOver()) {
      return;
    }

    // 敌人回合结束：触发敌人状态的 turn_end 与衰减
    await this.effectEngine.processStatusEffectsAtTurnEnd('enemy');
  }

  // 开始新回合 - 参考旧文件的实现
  private async startNewTurn(): Promise<void> {
    // 清除临时修饰符（每回合开始时清除上回合的临时效果）
    this.gameStateManager.clearTemporaryModifiers();

    // 切换到玩家回合
    this.gameStateManager.setPhase('player_turn');

    const player = this.gameStateManager.getPlayer();

    // 回合开始时清除玩家格挡，保证格挡在敌人回合中生效
    // 使用 skipAttributeTriggers 避免触发 lose_block
    this.gameStateManager.updatePlayer({ block: 0 }, { skipAttributeTriggers: true });

    // 重置玩家能量
    this.gameStateManager.updatePlayer({
      energy: player.maxEnergy,
    });

    // 抽牌应当是回合开始的最先步骤，保证后续“手牌相关”的效果有目标
    if (typeof this.cardSystem.onTurnStart === 'function') {
      this.cardSystem.onTurnStart();
    }

    // 处理玩家状态效果（turn_start，不含 tick）
    this.effectEngine.processStatusEffectsAtTurnStart('player');

    // 处理玩家能力（turn_start）
    await this.effectEngine.processAbilitiesAtTurnStart('player');

    // 触发遗物的回合开始效果（此时已完成抽牌，手牌类效果可正确命中）
    await this.relicEffectManager.triggerOnTurnStart();

    console.log(`🔄 开始第 ${this.gameStateManager.getGameState().currentTurn} 回合`);
  }

  // 敌人行动执行
  private async executeEnemyAction(): Promise<void> {
    const enemy = this.gameStateManager.getEnemy();
    if (!enemy || !enemy.nextAction) return;

    const action = enemy.nextAction;
    console.log(`敌人执行行动: ${action.name}`);

    try {
      // 显示敌人行动动画
      this.animationManager.showEnemyActionAnimation(action.name, action.description);

      // 执行行动效果
      await this.effectEngine.executeEffect(action.effect, false, 'player');

      // 移除重复的行动描述显示，现在使用屏幕中央弹窗
      // this.showEnemyActionFeedback(action);
    } catch (error) {
      console.error('执行敌人行动时发生错误:', error);
    }

    // 移除延迟以提高出牌速度
    // await this.delay(1500);

    // 行动执行后，下一行动与意图展示统一在 enemyTurn 末尾进行，避免重复/覆盖
  }

  // 执行默认敌人行动
  private async executeDefaultEnemyAction(): Promise<void> {
    const enemy = this.gameStateManager.getEnemy();
    if (!enemy) return;

    // 默认攻击行为
    const damage = Math.floor(Math.random() * 8) + 5;
    await this.effectEngine.executeEffect(`damage:${damage}`, false, 'player');

    console.log(`${enemy.name} 执行默认攻击，造成 ${damage} 点伤害`);
  }

  // 过滤元数据（移除非行动数据）
  private filterMetadata(actions: any[]): any[] {
    return actions.filter(
      action => action && typeof action === 'object' && action.name && action.effect && !action.isMetadata,
    );
  }

  // 设置敌人下一个行动 - 统一到 EnemyIntentManager
  private setEnemyNextAction(): void {
    const enemy = this.gameStateManager.getEnemy();
    if (!enemy || !enemy.actions || enemy.actions.length === 0) return;

    try {
      const { EnemyIntentManager } = require('../modules/enemyIntent');
      EnemyIntentManager.setNextAction(enemy, enemy.actions);
    } catch (e) {
      console.warn('设置敌人下一行动失败:', e);
    }
  }

  // 显示敌人行动反馈
  private showEnemyActionFeedback(action: EnemyAction): void {
    const feedbackDiv = $(`
      <div class="enemy-action-feedback">
        <div class="action-name">${action.name}</div>
        <div class="action-description">${action.description}</div>
      </div>
    `);

    $('.card-game-container').append(feedbackDiv);

    feedbackDiv
      .fadeIn(300)
      .delay(2000)
      .fadeOut(500, () => {
        feedbackDiv.remove();
      });
  }

  // 游戏结束处理
  private async handleGameOver(): Promise<void> {
    const state = this.gameStateManager.getGameState();
    console.log('游戏结束, 胜利者:', state.winner);

    // 保存统计数据
    await this.saveGameStatistics(state.winner === 'player');

    // 清理资源
    this.cleanup();
  }

  // 保存游戏统计
  private async saveGameStatistics(playerWon: boolean): Promise<void> {
    try {
      const variables = getVariables({ type: 'character' });
      const stats = variables.fishRPG_stats || {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalTurns: 0,
        totalDamageDealt: 0,
        totalDamageTaken: 0,
      };

      const state = this.gameStateManager.getGameState();

      stats.gamesPlayed++;
      stats.totalTurns += state.currentTurn;

      if (playerWon) {
        stats.wins++;
      } else {
        stats.losses++;
      }

      await insertOrAssignVariables({ fishRPG_stats: JSON.stringify(stats) }, { type: 'character' });

      console.log('游戏统计已保存');
    } catch (error) {
      console.error('保存游戏统计失败:', error);
    }
  }

  // 战斗重置
  public resetBattle(): void {
    this.gameStateManager.resetGame();
    console.log('战斗已重置');
  }

  // 清理资源
  private cleanup(): void {
    // 清理任何需要清理的资源
    console.log('清理战斗资源');
  }

  // 工具方法
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 检查玩家是否可以行动
  public canPlayerAct(): boolean {
    const state = this.gameStateManager.getGameState();
    return state.phase === 'player_turn' && !state.isGameOver;
  }

  // 获取可打出的卡牌
  public getPlayableCards() {
    return this.cardSystem.getPlayableCards();
  }

  // 玩家使用卡牌
  public async playCard(cardId: string, targetType?: 'player' | 'enemy'): Promise<boolean> {
    if (!this.canPlayerAct()) {
      console.log('当前无法使用卡牌');
      return false;
    }

    const success = await this.cardSystem.playCard(cardId, targetType);

    // 死亡检查已由 UnifiedEffectExecutor 统一处理，这里不需要再检查

    return success;
  }

  // 强制结束回合（用于UI调用）
  public forceEndTurn(): void {
    if (this.canPlayerAct()) {
      this.endPlayerTurn();
    }
  }

  // 获取战斗状态信息
  public getBattleInfo() {
    const state = this.gameStateManager.getGameState();
    const playableCards = this.getPlayableCards();

    return {
      currentPhase: state.phase,
      currentTurn: state.currentTurn,
      isGameOver: state.isGameOver,
      winner: state.winner,
      player: state.player,
      enemy: state.enemy,
      playableCardsCount: playableCards.length,
      canPlayerAct: this.canPlayerAct(),
    };
  }

  // 敌人AI相关方法
  public updateEnemyAI(enemy: Enemy): void {
    // 可以根据战斗情况动态调整敌人行动权重
    const player = this.gameStateManager.getPlayer();

    enemy.actions.forEach(action => {
      // 根据玩家状态调整权重
      if (action.effect.includes('damage:') && player.block > 10) {
        // 玩家格挡较高时，降低攻击权重
        action.weight *= 0.7;
      } else if (action.effect.includes('block:') && player.currentHp < player.maxHp * 0.3) {
        // 玩家生命值较低时，提高防御权重
        action.weight *= 1.3;
      }
    });

    this.gameStateManager.updateEnemy({ actions: enemy.actions });
  }

  // 难度调整
  public adjustDifficulty(difficultyMultiplier: number): void {
    const enemy = this.gameStateManager.getEnemy();
    if (!enemy) return;

    // 调整敌人属性
    const adjustedEnemy = {
      ...enemy,
      maxHp: Math.floor(enemy.maxHp * difficultyMultiplier),
      currentHp: Math.floor(enemy.currentHp * difficultyMultiplier),
      actions: enemy.actions.map(action => ({
        ...action,
        effect: this.adjustActionEffect(action.effect, difficultyMultiplier),
      })),
    };

    this.gameStateManager.updateEnemy(adjustedEnemy);
    console.log(`难度已调整为 ${difficultyMultiplier}x`);
  }

  private adjustActionEffect(effect: string, multiplier: number): string {
    return effect.replace(/(\d+)/g, match => {
      const num = parseInt(match);
      return Math.floor(num * multiplier).toString();
    });
  }
}
