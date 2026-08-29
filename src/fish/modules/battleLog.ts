/**
 * 战斗日志模块
 */

import { GameStateManager } from '../core/gameStateManager';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import type { BattleHistoryEntry } from '../../game-core';

export class BattleLog {
  private static logContainer: JQuery | null = null;
  /** Only the visible dialog is bounded. The narrative report keeps the whole battle. */
  private static maxVisibleLogs = 180;
  private static entries: BattleHistoryEntry[] = [];

  private static restorePersistedEntries(): void {
    const persisted = GameStateManager.getInstance().getGameState()?.battleHistory;
    if (!Array.isArray(persisted) || persisted.length <= this.entries.length) return;
    this.entries = persisted.map(entry => ({ ...entry, source: entry.source ? { ...entry.source } : undefined }));
  }

  private static persistEntries(): void {
    GameStateManager.getInstance().setBattleHistory(this.entries);
  }

  /**
   * 初始化战斗日志
   */
  static init(): void {
    // 检查是否已存在日志容器
    if ($('#battle-log').length === 0) {
      const logHtml = `
        <div id="battle-log">
          <div class="log-header">
            <span>战斗日志</span>
            <button id="close-battle-log" type="button" aria-label="关闭战斗日志">✕</button>
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
    action?: { actor: 'player' | 'enemy'; name: string; actorId?: string; actorName?: string },
  ): void {
    if (!this.logContainer) {
      this.init();
    }

    this.restorePersistedEntries();
    // 获取当前回合数
    const gameStateManager = GameStateManager.getInstance();
    const gameState = gameStateManager.getGameState();
    const currentTurn = gameState?.currentTurn || 1;
    const turnDisplay = `[第${currentTurn}回合]`;
    this.entries.push({
      turn: currentTurn,
      type,
      message: String(message).replace(/\s+/g, ' ').trim(),
      source: source ? { ...source } : undefined,
      actor: action?.actor,
      actionName: action?.name,
      actorId: action?.actorId,
      actorName: action?.actorName,
    });
    if (this.entries.length > 600) this.entries.splice(0, this.entries.length - 600);
    this.persistEntries();

    let icon = '';

    switch (type) {
      case 'damage':
        icon = '⚔️';
        break;
      case 'heal':
        icon = '💚';
        break;
      case 'action':
        icon = '🎯';
        break;
      case 'system':
        icon = '⚙️';
        break;
      case 'info':
      default:
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
      sourceDisplay = `<span class="log-source">${sourceEmojis[source.type]}${escapeHtml(source.name)}</span>`;
    }

    const logEntry = $(`
      <div class="log-entry log-${type}" ${source?.details ? `title="${escapeHtmlAttribute(source.details)}"` : ''}>
        <span class="log-time">${turnDisplay}</span>
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
          $this.append(`<div class="log-details">${escapeHtml(source.details)}</div>`);
        } else {
          // 收起详细信息
          $this.find(detailsSelector).remove();
        }
      });
    }

    this.logContainer!.append(logEntry);

    // 限制日志数量
    const logs = this.logContainer!.find('.log-entry');
    if (logs.length > this.maxVisibleLogs) {
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
    const actionName = description.replace(/^使用了(?:卡牌|道具)[:：]?\s*/, '').trim() || description;
    this.addLog(`玩家${actionType}: ${description}`, 'action', undefined, { actor: 'player', name: actionName });
  }

  /**
   * 记录敌人行动
   */
  static logEnemyAction(
    actionName: string,
    description: string,
    enemy?: { id?: string; name?: string },
  ): void {
    const actorName = String(enemy?.name || '敌人').trim() || '敌人';
    this.addLog(`${actorName}使用了 ${actionName}: ${description}`, 'action', undefined, {
      actor: 'enemy',
      name: actionName,
      actorId: enemy?.id,
      actorName,
    });
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
    this.entries = [];
    this.persistEntries();
    if (this.logContainer) {
      this.logContainer.empty();
    }
  }

  /** Reuse the complete battle event stream for the on-screen diagnostic log. */
  static buildNarrativeReport(maxEntries?: number): string {
    this.restorePersistedEntries();
    const selected = maxEntries === undefined ? this.entries : this.entries.slice(-Math.max(1, Math.floor(maxEntries)));
    if (selected.length === 0) return '- 无可用战斗事件记录';
    return selected
      .map(entry => {
        const source = entry.source?.name ? `〔${entry.source.name}〕` : '';
        const details = entry.source?.details ? `（${entry.source.details.replace(/\s+/g, ' ').trim()}）` : '';
        return `- 第${entry.turn}回合 ${source}${entry.message}${details}`;
      })
      .join('\n');
  }

  /**
   * Build one compact line per turn. Repeated numeric events stay in the UI log;
   * the story model receives actions, triggered sources and decisive events only.
   */
  static buildTurnSummaryReport(): string {
    this.restorePersistedEntries();
    const gameState = GameStateManager.getInstance().getGameState();
    const customResources = new Map<string, string>();
    for (const [id, resource] of Object.entries(gameState.player?.resources || {})) {
      customResources.set(id, resource.name || id);
    }
    for (const enemy of [...(gameState.defeatedEnemies || []), ...(gameState.enemies || [])]) {
      for (const [id, resource] of Object.entries(enemy.resources || {})) {
        if (!customResources.has(id)) customResources.set(id, resource.name || id);
      }
    }
    const journalResourceSpends = new Map<number, string[]>();
    for (const event of gameState.eventJournal?.events || []) {
      if (event.kind !== 'resource_spent' || event.resource === 'energy' || event.spent <= 0) continue;
      const turn = Math.max(1, Math.floor(event.turn || 1));
      const entries = journalResourceSpends.get(turn) || [];
      entries.push(`消耗${event.spent}点${customResources.get(event.resource) || event.resource}`);
      journalResourceSpends.set(turn, entries);
    }
    if (this.entries.length === 0 && journalResourceSpends.size === 0) return '- 无可用战斗事件记录';

    const grouped = new Map<number, BattleHistoryEntry[]>();
    for (const entry of this.entries) {
      const turn = Math.max(1, Math.floor(entry.turn || 1));
      const current = grouped.get(turn) || [];
      current.push(entry);
      grouped.set(turn, current);
    }
    for (const turn of journalResourceSpends.keys()) {
      if (!grouped.has(turn)) grouped.set(turn, []);
    }

    const unique = (values: string[]): string[] => [...new Set(values.map(value => value.trim()).filter(Boolean))];
    const countActions = (values: string[]): string[] => {
      const order: string[] = [];
      const counts = new Map<string, number>();
      for (const rawValue of values) {
        const value = rawValue.trim();
        if (!value) continue;
        if (!counts.has(value)) order.push(value);
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      return order.map(value => `${value}${(counts.get(value) || 0) > 1 ? `×${counts.get(value)}` : ''}`);
    };
    return [...grouped.entries()]
      .sort(([left], [right]) => left - right)
      .map(([turn, entries]) => {
        const playerActions = countActions(
          entries.filter(entry => entry.actor === 'player').map(entry => entry.actionName || ''),
        );
        const enemyActions = countActions(
          entries
            .filter(entry => entry.actor === 'enemy')
            .map(entry => entry.actorName ? `${entry.actorName}：${entry.actionName || ''}` : entry.actionName || ''),
        );
        const triggers = countActions(
          entries
            .filter(entry => entry.source && ['relic', 'ability', 'status'].includes(entry.source.type))
            .map(
              entry =>
                `${entry.source!.type === 'relic' ? '遗物' : entry.source!.type === 'ability' ? '能力' : '状态'}“${entry.source!.name}”`,
            ),
        );
        const decisive = unique(
          entries
            .filter(entry => entry.type === 'system' && !/回合(?:开始|结束)|战斗胜利|战斗失败/.test(entry.message))
            .map(entry => entry.message),
        );
        const resourceChanges = unique([
          ...(journalResourceSpends.get(turn) || []),
          ...entries
            .filter(entry =>
              entry.type === 'info' &&
              [...customResources.values()].some(name => entry.message.includes(name)) &&
              /消耗|获得|设置|→/.test(entry.message),
            )
            .map(entry => entry.message),
        ]);
        const parts = [`玩家使用：${playerActions.join('、') || '无'}`, `敌人使用：${enemyActions.join('、') || '无'}`];
        if (triggers.length > 0) parts.push(`触发：${triggers.join('、')}`);
        if (resourceChanges.length > 0) parts.push(`资源：${resourceChanges.join('、')}`);
        if (decisive.length > 0) parts.push(`关键事件：${decisive.join('、')}`);
        return `- 回合${turn}：${parts.join('；')}`;
      })
      .join('\n');
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
