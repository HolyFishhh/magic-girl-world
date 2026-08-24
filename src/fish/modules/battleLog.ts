/**
 * 战斗日志模块
 */

import { GameStateManager } from '../core/gameStateManager';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';

export class BattleLog {
  private static logContainer: JQuery | null = null;
  private static maxLogs = 50; // 最大日志条数

  /**
   * 初始化战斗日志
   */
  static init(): void {
    // 检查是否已存在日志容器
    if ($('#battle-log').length === 0) {
      // 创建日志容器
      const logHtml = `
        <div id="battle-log" style="
          position: fixed;
          top: 20px;
          left: 20px;
          width: 300px;
          max-height: 200px;
          background: rgba(0, 0, 0, 0.9);
          border: 2px solid #444;
          border-radius: 8px;
          padding: 10px;
          overflow-y: auto;
          z-index: 1000;
          font-size: 12px;
          color: white;
          display: none;
        ">
          <div class="log-header" style="
            font-weight: bold;
            margin-bottom: 5px;
            padding-bottom: 5px;
            border-bottom: 1px solid #666;
            color: #aaa;
            display: flex;
            justify-content: space-between;
            align-items: center;
          ">
            <span>战斗日志</span>
            <button id="close-battle-log" style="
              background: none;
              border: none;
              color: #aaa;
              cursor: pointer;
              font-size: 14px;
              padding: 0;
              margin: 0;
            ">✕</button>
          </div>
          <div class="log-content"></div>
        </div>
      `;
      $('body').append(logHtml);

      // 添加关闭按钮事件
      $('#close-battle-log').on('click', () => {
        $('#battle-log').fadeOut(200);
      });
    }

    this.logContainer = $('#battle-log .log-content');
  }

  /**
   * 添加日志条目
   */
  static addLog(
    message: string,
    type: 'info' | 'damage' | 'heal' | 'action' | 'system' = 'info',
    source?: { type: 'card' | 'relic' | 'ability' | 'status'; name: string; details?: string },
  ): void {
    if (!this.logContainer) {
      this.init();
    }

    // 获取当前回合数
    const gameStateManager = GameStateManager.getInstance();
    const gameState = gameStateManager.getGameState();
    const currentTurn = gameState?.currentTurn || 1;
    const turnDisplay = `[第${currentTurn}回合]`;

    let color = '#ffffff';
    let icon = '';

    switch (type) {
      case 'damage':
        color = '#ff6666';
        icon = '⚔️';
        break;
      case 'heal':
        color = '#66ff66';
        icon = '💚';
        break;
      case 'action':
        color = '#66aaff';
        icon = '🎯';
        break;
      case 'system':
        color = '#ffaa66';
        icon = '⚙️';
        break;
      case 'info':
      default:
        color = '#ffffff';
        icon = 'ℹ️';
        break;
    }

    // 创建源信息
    let sourceDisplay = '';
    if (source) {
      const sourceEmojis = {
        card: '🃏',
        relic: '🔮',
        ability: '⚡',
        status: '✨',
      };
      sourceDisplay = `<span class="log-source" style="color: #aaa; font-size: 9px; margin-right: 4px;">${
        sourceEmojis[source.type]
      }${escapeHtml(source.name)}</span>`;
    }

    const logEntry = $(`
      <div class="log-entry" style="
        margin-bottom: 3px;
        padding: 2px 0;
        color: ${color};
        line-height: 1.3;
        border-left: 2px solid ${color};
        padding-left: 5px;
        margin-left: 3px;
        cursor: pointer;
      " ${source?.details ? `title="${escapeHtmlAttribute(source.details)}"` : ''}>
        <span class="log-time" style="color: #888; font-size: 10px;">${turnDisplay}</span>
        ${sourceDisplay}
        <span class="log-icon">${icon}</span>
        <span class="log-message">${escapeHtml(message)}</span>
      </div>
    `);

    // 如果有详细信息，添加点击展开功能
    if (source?.details) {
      logEntry.on('click', function () {
        const $this = $(this);
        const detailsSelector = '.log-details';

        if ($this.find(detailsSelector).length === 0) {
          // 展开详细信息
          $this.append(`
            <div class="log-details" style="
              margin-top: 5px;
              padding: 5px;
              background: rgba(255,255,255,0.1);
              border-radius: 4px;
              font-size: 10px;
              color: #ccc;
            ">${escapeHtml(source.details)}</div>
          `);
        } else {
          // 收起详细信息
          $this.find(detailsSelector).remove();
        }
      });
    }

    this.logContainer!.append(logEntry);

    // 限制日志数量
    const logs = this.logContainer!.find('.log-entry');
    if (logs.length > this.maxLogs) {
      logs.first().remove();
    }

    // 自动滚动到底部
    const logContainer = $('#battle-log');
    logContainer.scrollTop(logContainer[0].scrollHeight);

    // 添加淡入动画
    logEntry.css({ opacity: 0 }).animate({ opacity: 1 }, 300);
  }

  /**
   * 记录玩家行动
   */
  static logPlayerAction(actionType: string, description: string): void {
    this.addLog(`玩家${actionType}: ${description}`, 'action');
  }

  /**
   * 记录敌人行动
   */
  static logEnemyAction(actionName: string, description: string): void {
    this.addLog(`敌人使用了 ${actionName}: ${description}`, 'action');
  }

  /**
   * 记录伤害
   */
  static logDamage(source: string, target: string, damage: number, actualDamage: number): void {
    if (damage !== actualDamage) {
      this.addLog(`${source} 对 ${target} 造成 ${actualDamage} 点伤害 (原始伤害: ${damage})`, 'damage');
    } else {
      this.addLog(`${source} 对 ${target} 造成 ${damage} 点伤害`, 'damage');
    }
  }

  /**
   * 记录治疗
   */
  static logHeal(target: string, amount: number): void {
    this.addLog(`${target} 恢复了 ${amount} 点生命值`, 'heal');
  }

  /**
   * 记录格挡
   */
  static logBlock(target: string, amount: number): void {
    this.addLog(`${target} 获得了 ${amount} 点格挡`, 'info');
  }

  /**
   * 记录回合结束
   */
  static logTurnEnd(): void {
    this.addLog(`回合结束`, 'system');
  }

  /**
   * 记录具体弃牌
   */
  static logDiscardCardDetail(cardName: string, cost: string | number, description?: string): void {
    const costText = String(cost);
    const details = `名称: ${cardName} | 费用: ${costText}${description ? `\n描述: ${description}` : ''}`;
    this.addLog(`弃置了卡牌：${cardName}`, 'action', { type: 'card', name: cardName, details });
  }

  /**
   * 清空日志
   */
  static clear(): void {
    if (this.logContainer) {
      this.logContainer.empty();
    }
  }

  /**
   * 切换日志显示/隐藏
   */
  static toggle(): void {
    const logElement = $('#battle-log');
    if (logElement.is(':visible')) {
      logElement.fadeOut(200);
    } else {
      logElement.fadeIn(200);
    }
  }

  /**
   * 记录能量变化
   */
  static logEnergyChange(amount: number, isGain: boolean = true): void {
    const action = isGain ? '获得' : '消耗';
    this.addLog(`${action}了 ${amount} 点能量`, 'info');
  }

  /**
   * 记录欲望伤害
   */
  static logLustDamage(source: string, target: string, damage: number): void {
    this.addLog(`${source} 对 ${target} 造成 ${damage} 点欲望伤害 💗`, 'damage');
  }

  /**
   * 记录状态效果
   */
  static logStatusEffect(
    target: string,
    statusName: string,
    stacks: number,
    duration: number,
    isApply: boolean = true,
  ): void {
    const action = isApply ? '获得' : '失去';
    const stackText = stacks > 1 ? ` (${stacks}层)` : '';
    this.addLog(`${target} ${action}了 ${statusName}${stackText}`, 'info');
  }

  /**
   * 记录欲望溢出
   */
  static logLustOverflow(target: string, effectName: string): void {
    this.addLog(`${target} 欲望溢出！触发 ${effectName} 💋`, 'system');
  }

  /**
   * 记录回合开始
   */
  static logTurnStart(turnNumber: number, isPlayerTurn: boolean = true): void {
    const turnOwner = isPlayerTurn ? '玩家' : '敌人';
    this.addLog(`第 ${turnNumber} 回合开始 - ${turnOwner}回合`, 'system');
  }

  /**
   * 记录抽牌
   */
  static logDrawCards(count: number): void {
    this.addLog(`抽取了 ${count} 张卡牌 🃏`, 'info');
  }

  /**
   * 记录弃牌
   */
  static logDiscardCards(count: number): void {
    this.addLog(`弃置了 ${count} 张卡牌`, 'info');
  }

  /**
   * 记录战斗结果
   */
  static logBattleResult(result: boolean | 'victory' | 'defeat'): void {
    const isVictory = result === true || result === 'victory';
    if (isVictory) {
      this.addLog('🎉 战斗胜利！', 'system');
    } else {
      this.addLog('💀 战斗失败...', 'system');
    }
  }

  /**
   * 记录卡牌效果
   */
  static logCardEffect(cardName: string, effectDescription: string): void {
    this.addLog(`${cardName} 效果: ${effectDescription}`, 'action');
  }

  /**
   * 记录格挡失效
   */
  static logBlockExpired(amount: number): void {
    this.addLog(`格挡失效，失去 ${amount} 点格挡`, 'info');
  }

  /**
   * 记录死亡
   */
  static logDeath(target: string): void {
    this.addLog(`${target} 被击败了！`, 'system');
  }
}
