/**
 * 欲望溢出效果显示模块
 */

import { AnimationManager } from './animationManager';
import { UnifiedEffectDisplay } from './unifiedEffectDisplay';

export interface LustOverflowEffect {
  name: string;
  description: string;
  effect: string;
}

export class LustOverflowDisplay {
  private static instance: LustOverflowDisplay;
  private animationManager: AnimationManager;
  private effectDisplay: UnifiedEffectDisplay;

  private constructor() {
    this.animationManager = AnimationManager.getInstance();
    this.effectDisplay = UnifiedEffectDisplay.getInstance();
  }

  public static getInstance(): LustOverflowDisplay {
    if (!LustOverflowDisplay.instance) {
      LustOverflowDisplay.instance = new LustOverflowDisplay();
    }
    return LustOverflowDisplay.instance;
  }

  /**
   * 显示玩家欲望溢出效果
   */
  showPlayerLustOverflow(playerLustEffect: LustOverflowEffect): void {
    console.log('💗 玩家欲望溢出:', playerLustEffect);

    // 播放溢出动画
    this.animationManager.showLustOverflowEffect('player', playerLustEffect.name);

    // 显示自动消失的效果弹窗
    this.showAutoLustOverflowPopup('player', playerLustEffect);
  }

  /**
   * 显示敌人欲望溢出效果
   */
  showEnemyLustOverflow(enemyLustEffect: LustOverflowEffect): void {
    console.log('💔 敌人欲望溢出:', enemyLustEffect);

    // 播放溢出动画
    this.animationManager.showLustOverflowEffect('enemy', enemyLustEffect.name);

    // 显示自动消失的效果弹窗
    this.showAutoLustOverflowPopup('enemy', enemyLustEffect);
  }

  /**
   * 显示欲望溢出效果弹窗
   */
  private showLustOverflowModal(target: 'player' | 'enemy', effect: LustOverflowEffect): void {
    // 移除已存在的弹窗
    $('.lust-overflow-modal').remove();

    const effectTags = this.effectDisplay.parseEffectToTags(effect.effect, { isPlayerCard: false });
    const effectTagsHTML = this.effectDisplay.createEffectTagsHTML(effectTags);

    const targetText = target === 'player' ? '你' : '敌人';
    const titleColor = target === 'player' ? '#ff69b4' : '#dc143c';
    const borderColor = target === 'player' ? '#ff1493' : '#b71c1c';

    const modal = $(`
      <div class="lust-overflow-modal">
        <div class="lust-overflow-overlay"></div>
        <div class="lust-overflow-content" style="border-color: ${borderColor};">
          <div class="lust-overflow-header" style="background: ${titleColor};">
            <div class="overflow-icon">💋</div>
            <h3>${targetText}的欲望溢出！</h3>
            <button class="close-overflow-btn">✕</button>
          </div>
          <div class="lust-overflow-body">
            <div class="overflow-effect-name">${effect.name}</div>
            <div class="overflow-effect-description">${effect.description}</div>
            ${effectTagsHTML ? `<div class="overflow-effect-tags">${effectTagsHTML}</div>` : ''}
          </div>
          <div class="lust-overflow-footer">
            <button class="confirm-overflow-btn">确认</button>
          </div>
        </div>
      </div>
    `);

    $('body').append(modal);

    // 添加动画效果
    modal.css({ opacity: 0 }).animate({ opacity: 1 }, 300);

    // 绑定关闭事件（保留点击关闭功能）
    modal.find('.close-overflow-btn, .confirm-overflow-btn, .lust-overflow-overlay').on('click', () => {
      this.closeLustOverflowModal();
    });

    // 阻止内容区域点击事件冒泡
    modal.find('.lust-overflow-content').on('click', e => {
      e.stopPropagation();
    });

    // 3秒后自动消失
    setTimeout(() => {
      this.closeLustOverflowModal();
    }, 3000);
  }

  /**
   * 显示自动消失的欲望溢出弹窗
   */
  private showAutoLustOverflowPopup(target: 'player' | 'enemy', effect: LustOverflowEffect): void {
    // 移除已存在的弹窗
    $('.auto-lust-overflow-popup').remove();

    const targetName = target === 'player' ? '玩家' : '敌人';
    const popup = $(`
      <div class="auto-lust-overflow-popup">
        <div class="auto-lust-content">
          <div class="auto-lust-header">
            <div class="auto-lust-icon">💗</div>
            <div class="auto-lust-title">${targetName}欲望溢出！</div>
          </div>
          <div class="auto-lust-effect-name">${effect.name}</div>
          <div class="auto-lust-description">${effect.description}</div>
        </div>
      </div>
    `);

    $('body').append(popup);

    // 动画显示
    popup
      .css({ opacity: 0, transform: 'translate(-50%, -50%) scale(0.8)' })
      .animate({ opacity: 1 }, 300)
      .css({ transform: 'translate(-50%, -50%) scale(1)' });

    // 3秒后自动消失
    setTimeout(() => {
      popup.animate({ opacity: 0 }, 300, function () {
        $(this).remove();
      });
    }, 3000);

    console.log(`💗 显示${targetName}欲望溢出弹窗: ${effect.name}`);
  }

  /**
   * 关闭欲望溢出弹窗
   */
  private closeLustOverflowModal(): void {
    const modal = $('.lust-overflow-modal');
    if (modal.length > 0) {
      modal.animate({ opacity: 0 }, 200, function () {
        $(this).remove();
      });
    }
  }

  /**
   * 更新欲望溢出效果显示区域
   */
  updateLustOverflowDisplay(target: 'player' | 'enemy', lustEffect: LustOverflowEffect | null): void {
    const selector = target === 'player' ? '.player-lust-overflow' : '.enemy-lust-overflow';
    const container = $(selector);

    if (!container.length) {
      // 如果容器不存在，创建一个
      this.createLustOverflowContainer(target);
      return;
    }

    if (!lustEffect) {
      container.hide();
      return;
    }

    const effectTags = this.effectDisplay.parseEffectToTags(lustEffect.effect, { isPlayerCard: false });
    const compactTagsHTML = effectTags
      .slice(0, 2)
      .map(
        tag =>
          `<span class="mini-effect-tag" style="background: ${tag.color}20; color: ${tag.color}; border: 1px solid ${tag.color};">
        ${tag.icon}
      </span>`,
      )
      .join('');

    container
      .html(
        `
      <div class="lust-overflow-indicator" title="${lustEffect.description}">
        <div class="overflow-icon">💋</div>
        <div class="overflow-name">${lustEffect.name}</div>
        <div class="overflow-mini-tags">${compactTagsHTML}</div>
      </div>
    `,
      )
      .show();

    // 添加点击事件查看详情
    container.off('click').on('click', () => {
      this.showLustOverflowModal(target, lustEffect);
    });
  }

  /**
   * 创建欲望溢出效果容器
   */
  private createLustOverflowContainer(target: 'player' | 'enemy'): void {
    const targetSelector = target === 'player' ? '.player-stats' : '.enemy-stats';
    const targetContainer = $(targetSelector);

    if (targetContainer.length === 0) {
      // 静默处理，不显示警告，因为这是正常的初始化时序问题
      console.log(`${target}状态容器暂未准备好，跳过欲望溢出容器创建`);
      return;
    }

    const containerClass = target === 'player' ? 'player-lust-overflow' : 'enemy-lust-overflow';
    const overflowContainer = $(`
      <div class="${containerClass} lust-overflow-container" style="display: none;">
        <!-- 欲望溢出效果将在这里显示 -->
      </div>
    `);

    targetContainer.append(overflowContainer);
  }

  /**
   * 检查并触发欲望溢出效果
   */
  checkLustOverflow(
    target: 'player' | 'enemy',
    currentLust: number,
    maxLust: number,
    lustEffect?: LustOverflowEffect,
  ): void {
    if (currentLust >= maxLust && lustEffect) {
      if (target === 'player') {
        this.showPlayerLustOverflow(lustEffect);
      } else {
        this.showEnemyLustOverflow(lustEffect);
      }
    }
  }

  /**
   * 重置欲望溢出显示
   */
  resetLustOverflowDisplay(target: 'player' | 'enemy'): void {
    const selector = target === 'player' ? '.player-lust-overflow' : '.enemy-lust-overflow';
    $(selector).hide().empty();
  }

  /**
   * 初始化欲望溢出显示系统
   */
  initializeLustOverflowSystem(): void {
    // 创建必要的容器
    this.createLustOverflowContainer('player');
    this.createLustOverflowContainer('enemy');

    // 添加样式
    this.addLustOverflowStyles();

    console.log('✅ 欲望溢出显示系统初始化完成');
  }

  /**
   * 添加欲望溢出相关样式
   */
  private addLustOverflowStyles(): void {
    if ($('#lust-overflow-styles').length > 0) return;

    const styles = `
      <style id="lust-overflow-styles">
        .lust-overflow-container {
          margin-top: 8px;
          padding: 6px;
          background: rgba(255, 105, 180, 0.1);
          border: 1px solid rgba(255, 105, 180, 0.3);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .lust-overflow-container:hover {
          background: rgba(255, 105, 180, 0.2);
          border-color: rgba(255, 105, 180, 0.5);
        }

        .lust-overflow-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.8em;
        }

        .overflow-icon {
          font-size: 1.2em;
          filter: drop-shadow(0 0 4px rgba(255, 105, 180, 0.8));
        }

        .overflow-name {
          font-weight: bold;
          color: #ff69b4;
          flex: 1;
        }

        .overflow-mini-tags {
          display: flex;
          gap: 2px;
        }

        .mini-effect-tag {
          padding: 1px 3px;
          border-radius: 4px;
          font-size: 0.7em;
          font-weight: bold;
        }

        .lust-overflow-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 4000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .lust-overflow-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.8);
          cursor: pointer;
        }

        .lust-overflow-content {
          position: relative;
          background: linear-gradient(135deg, #2a1810, #3d2817);
          border: 3px solid #ff69b4;
          border-radius: 15px;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.8);
          overflow: hidden;
        }

        .lust-overflow-header {
          padding: 20px;
          text-align: center;
          color: white;
          position: relative;
        }

        .lust-overflow-header h3 {
          margin: 10px 0 0 0;
          font-size: 1.5em;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
        }

        .close-overflow-btn {
          position: absolute;
          top: 10px;
          right: 15px;
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 5px;
          border-radius: 50%;
          transition: background 0.3s ease;
        }

        .close-overflow-btn:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .lust-overflow-body {
          padding: 20px;
          color: white;
        }

        .overflow-effect-name {
          font-size: 1.3em;
          font-weight: bold;
          color: #ff69b4;
          margin-bottom: 10px;
          text-align: center;
        }

        .overflow-effect-description {
          font-size: 1em;
          line-height: 1.5;
          margin-bottom: 15px;
          text-align: center;
          opacity: 0.9;
        }

        .overflow-effect-tags {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid rgba(255, 105, 180, 0.3);
        }

        .lust-overflow-footer {
          padding: 15px 20px;
          text-align: center;
          border-top: 1px solid rgba(255, 105, 180, 0.3);
        }

        .confirm-overflow-btn {
          background: linear-gradient(135deg, #ff69b4, #ff1493);
          color: white;
          border: none;
          padding: 12px 30px;
          border-radius: 8px;
          font-size: 1em;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .confirm-overflow-btn:hover {
          background: linear-gradient(135deg, #ff1493, #dc143c);
          transform: scale(1.05);
        }
      </style>
    `;

    $('head').append(styles);
  }
}
