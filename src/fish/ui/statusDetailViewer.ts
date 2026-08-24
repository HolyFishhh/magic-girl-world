/**
 * 状态详情查看器 - 显示玩家状态的详细信息
 */

import { EffectProgramDisplay } from './effectProgramDisplay';
import { escapeHtml } from '../shared/html';

export class StatusDetailViewer {
  private static instance: StatusDetailViewer;
  private static effectDisplay = EffectProgramDisplay.getInstance();

  private constructor() {}

  public static getInstance(): StatusDetailViewer {
    if (!StatusDetailViewer.instance) {
      StatusDetailViewer.instance = new StatusDetailViewer();
    }
    return StatusDetailViewer.instance;
  }

  /**
   * 显示状态详情
   */
  showStatusDetail(statType: string, gameStateManager: any): void {
    const player = gameStateManager.getPlayer();
    const enemy = gameStateManager.getEnemy();

    if (!player) {
      console.warn('无法获取玩家数据');
      return;
    }

    let title = '';
    let content = '';
    let currentValue = 0;
    let maxValue = 0;

    switch (statType) {
      case 'health':
        title = '❤️ 生命值';
        currentValue = player.currentHp || 0;
        maxValue = player.maxHp || 100;
        content = `
          <div class="stat-detail-item">
            <strong>当前生命值：</strong> ${currentValue} / ${maxValue}
          </div>
          <div class="stat-detail-description">
            生命值降到0时战斗失败。可以通过治疗效果恢复生命值。
          </div>
        `;
        break;

      case 'lust':
        title = '💗 欲望值';
        currentValue = player.currentLust || 0;
        maxValue = player.maxLust || 100;

        // 获取欲望溢出效果
        const lustEffect = enemy?.lustEffect;
        let lustEffectHTML = '';

        if (lustEffect) {
          const effectTags = StatusDetailViewer.effectDisplay.programToTags(lustEffect.effectProgram);
          const effectTagsHTML = StatusDetailViewer.effectDisplay.createEffectTagsHTML(effectTags);
          lustEffectHTML = `
            <div class="lust-overflow-info">
              <h4>💋 欲望溢出效果</h4>
              <div class="overflow-effect-name">${escapeHtml(lustEffect.name || '欲望爆发')}</div>
              <div class="overflow-effect-description">${escapeHtml(lustEffect.description || '欲望达到上限时触发的效果')}</div>
              ${effectTagsHTML}
            </div>
          `;
        }

        content = `
          <div class="stat-detail-item">
            <strong>当前欲望值：</strong> ${currentValue} / ${maxValue}
          </div>
          <div class="stat-detail-description">
            欲望值达到上限时会触发特殊效果。某些攻击会造成欲望伤害。
          </div>
          ${lustEffectHTML}
        `;
        break;

      case 'energy':
        title = '⚡ 能量';
        currentValue = player.energy || 0;
        maxValue = player.maxEnergy || 3;
        content = `
          <div class="stat-detail-item">
            <strong>当前能量：</strong> ${currentValue} / ${maxValue}
          </div>
          <div class="stat-detail-description">
            使用卡牌需要消耗能量。每回合开始时恢复到最大值。
          </div>
        `;
        break;

      case 'block':
        title = '🛡️ 格挡';
        currentValue = player.block || 0;
        content = `
          <div class="stat-detail-item">
            <strong>当前格挡：</strong> ${currentValue}
          </div>
          <div class="stat-detail-description">
            格挡可以减少受到的伤害。每回合结束时格挡值清零。
          </div>
        `;
        break;

      case 'cards':
        title = '🃏 卡牌信息';
        const handCount = player.hand?.length || 0;
        const drawCount = player.drawPile?.length || 0;
        const discardCount = player.discardPile?.length || 0;
        const exhaustCount = player.exhaustPile?.length || 0;

        content = `
          <div class="stat-detail-item">
            <strong>手牌：</strong> ${handCount} 张
          </div>
          <div class="stat-detail-item">
            <strong>抽牌堆：</strong> ${drawCount} 张
          </div>
          <div class="stat-detail-item">
            <strong>弃牌堆：</strong> ${discardCount} 张
          </div>
          <div class="stat-detail-item">
            <strong>消耗堆：</strong> ${exhaustCount} 张
          </div>
          <div class="stat-detail-description">
            点击抽牌堆或弃牌堆可以查看其中的卡牌。
          </div>
        `;
        break;

      case 'relics':
        title = '📿 遗物';
        const relics = player.relics || [];

        if (relics.length === 0) {
          content = `
            <div class="stat-detail-description">
              当前没有遗物。
            </div>
          `;
        } else {
          const relicsHTML = relics
            .map((relic: any) => {
              const effectTags = StatusDetailViewer.effectDisplay.triggeredProgramToTags(
                relic.trigger,
                relic.effectProgram,
              );
              const effectTagsHTML = StatusDetailViewer.effectDisplay.createEffectTagsHTML(effectTags);

              return `
              <div class="relic-item">
                <div class="relic-header">
                  <span class="relic-emoji">${escapeHtml(relic.emoji || '📿')}</span>
                  <span class="relic-name">${escapeHtml(relic.name)}</span>
                </div>
                <div class="relic-description">${escapeHtml(relic.description)}</div>
                ${effectTagsHTML}
              </div>
            `;
            })
            .join('');

          content = `
            <div class="relics-list">
              ${relicsHTML}
            </div>
          `;
        }
        break;

      default:
        title = '❓ 未知状态';
        content = `
          <div class="stat-detail-description">
            无法识别的状态类型：${escapeHtml(statType)}
          </div>
        `;
    }

    this.showModal(title, content);
  }

  /**
   * 显示状态详情弹窗
   */
  private showModal(title: string, content: string): void {
    // 移除已存在的弹窗
    this.closeStatusDetail();

    const modal = $(`
      <div class="status-detail-modal">
        <div class="status-detail-overlay"></div>
        <div class="status-detail-content">
          <div class="status-detail-header">
            <h3>${escapeHtml(title)}</h3>
            <button class="close-status-detail-btn">✕</button>
          </div>
          <div class="status-detail-body">
            ${content}
          </div>
        </div>
      </div>
    `);

    $('body').append(modal);

    // 添加动画效果
    modal.css({ opacity: 0 }).animate({ opacity: 1 }, 300);

    // 绑定关闭事件
    modal.find('.close-status-detail-btn, .status-detail-overlay').on('click', () => {
      this.closeStatusDetail();
    });

    // 阻止内容区域点击事件冒泡
    modal.find('.status-detail-content').on('click', e => {
      e.stopPropagation();
    });
  }

  /**
   * 关闭状态详情弹窗
   */
  closeStatusDetail(): void {
    const modal = $('.status-detail-modal');
    if (modal.length > 0) {
      modal.animate({ opacity: 0 }, 200, function () {
        $(this).remove();
      });
    }
  }

  /**
   * 设置状态栏点击事件
   */
  setupStatusClickEvents(): void {
    // 生命值点击事件
    $(document).on('click', '.player-card .hp-stat, .player-stats .hp-stat, .health-indicator', e => {
      e.preventDefault();
      this.handleStatusClick('health');
    });

    // 欲望值点击事件
    $(document).on('click', '.player-card .lust-stat, .player-stats .lust-stat, .lust-indicator', e => {
      e.preventDefault();
      this.handleStatusClick('lust');
    });

    // 能量点击事件
    $(document).on('click', '.energy-display, .player-stats .energy-stat, .energy-indicator', e => {
      e.preventDefault();
      this.handleStatusClick('energy');
    });

    // 格挡点击事件
    $(document).on('click', '.player-card .block-stat, .player-stats .block-stat, .block-indicator', e => {
      e.preventDefault();
      this.handleStatusClick('block');
    });

    // 卡牌信息点击事件
    $(document).on('click', '.player-stats .cards-stat, .cards-indicator', e => {
      e.preventDefault();
      this.handleStatusClick('cards');
    });

    // 遗物点击事件
    $(document).on('click', '.player-card .relic-section, .player-stats .relics-stat, .relics-indicator', e => {
      e.preventDefault();
      this.handleStatusClick('relics');
    });

  }

  /**
   * 处理状态点击
   */
  private handleStatusClick(statType: string): void {
    // 通过事件系统获取数据，避免循环依赖
    const event = new CustomEvent('requestStatusDetail', {
      detail: { statType },
    });

    document.dispatchEvent(event);
  }

  /**
   * 显示指定的状态详情（由外部调用）
   */
  showStatusByType(statType: string, gameStateManager: any): void {
    this.showStatusDetail(statType, gameStateManager);
  }

  /**
   * 初始化状态详情系统
   */
  initializeStatusDetailSystem(): void {
    // 添加样式
    this.addStatusDetailStyles();

  }

  /**
   * 添加状态详情相关样式
   */
  private addStatusDetailStyles(): void {
    if ($('#status-detail-styles').length > 0) return;

    const styles = `
      <style id="status-detail-styles">
        .status-detail-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 3000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .status-detail-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          cursor: pointer;
        }

        .status-detail-content {
          position: relative;
          background: linear-gradient(135deg, #2a1810, #3d2817);
          border: 2px solid #4a5568;
          border-radius: 12px;
          width: 90%;
          max-width: 600px;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.8);
        }

        .status-detail-header {
          padding: 20px;
          background: linear-gradient(135deg, #4a5568, #2d3748);
          color: white;
          position: relative;
          border-radius: 10px 10px 0 0;
        }

        .status-detail-header h3 {
          margin: 0;
          font-size: 1.4em;
          text-align: center;
        }

        .close-status-detail-btn {
          position: absolute;
          top: 15px;
          right: 20px;
          background: none;
          border: none;
          color: white;
          font-size: 18px;
          cursor: pointer;
          padding: 5px;
          border-radius: 50%;
          transition: background 0.3s ease;
        }

        .close-status-detail-btn:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .status-detail-body {
          padding: 20px;
          color: white;
        }

        .stat-detail-item {
          margin-bottom: 12px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          border-left: 3px solid #4299e1;
        }

        .stat-detail-description {
          margin-top: 15px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          font-size: 0.9em;
          color: #a0aec0;
          line-height: 1.5;
        }

        .lust-overflow-info {
          margin-top: 20px;
          padding: 15px;
          background: rgba(255, 105, 180, 0.1);
          border: 1px solid rgba(255, 105, 180, 0.3);
          border-radius: 8px;
        }

        .lust-overflow-info h4 {
          margin: 0 0 10px 0;
          color: #ff69b4;
        }

        .overflow-effect-name {
          font-weight: bold;
          color: #ff69b4;
          margin-bottom: 8px;
        }

        .overflow-effect-description {
          margin-bottom: 10px;
          color: #e2e8f0;
          font-size: 0.9em;
        }

        .relics-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .relic-item {
          padding: 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .relic-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }

        .relic-emoji {
          font-size: 1.5em;
        }

        .relic-name {
          font-weight: bold;
          color: #e2e8f0;
          font-size: 1.1em;
        }

        .relic-description {
          color: #a0aec0;
          font-size: 0.9em;
          line-height: 1.4;
          margin-bottom: 10px;
        }
      </style>
    `;

    $('head').append(styles);
  }
}
