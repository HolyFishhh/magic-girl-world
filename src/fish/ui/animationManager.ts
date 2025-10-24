import { Card, StatusEffect } from '../types';

/**
 * 动画管理模块 - 处理战斗中的各种动画效果
 */

export class AnimationManager {
  private static instance: AnimationManager;

  private constructor() {}

  public static getInstance(): AnimationManager {
    if (!AnimationManager.instance) {
      AnimationManager.instance = new AnimationManager();
    }
    return AnimationManager.instance;
  }

  // 伤害数字队列，防止同时弹出
  private damageQueue: Array<{ target: string; damage: number; type: string; timestamp: number }> = [];
  private lastDamageTime = 0;
  private readonly DAMAGE_INTERVAL = 150; // 最小间隔150ms

  /**
   * 显示伤害数字动画 - 抛物线物理效果
   */
  showDamageNumber(
    target: 'player' | 'enemy',
    damage: number,
    type: 'damage' | 'heal' | 'lust' | 'block' = 'damage',
  ): void {
    const now = Date.now();

    // 添加到队列
    this.damageQueue.push({ target, damage, type, timestamp: now });

    // 处理队列
    this.processDamageQueue();
  }

  private processDamageQueue(): void {
    if (this.damageQueue.length === 0) return;

    const now = Date.now();
    if (now - this.lastDamageTime < this.DAMAGE_INTERVAL) {
      // 延迟处理
      setTimeout(() => this.processDamageQueue(), this.DAMAGE_INTERVAL);
      return;
    }

    const damageData = this.damageQueue.shift();
    if (!damageData) return;

    this.lastDamageTime = now;
    this.createPhysicalDamageAnimation(damageData.target, damageData.damage, damageData.type);

    // 继续处理队列
    if (this.damageQueue.length > 0) {
      setTimeout(() => this.processDamageQueue(), this.DAMAGE_INTERVAL);
    }
  }

  private createPhysicalDamageAnimation(
    target: 'player' | 'enemy',
    damage: number,
    type: 'damage' | 'heal' | 'lust' | 'block',
  ): void {
    // 选择动画起点：格挡使用时从格挡图标位置弹出
    let targetSelector = target === 'player' ? '.player-card .character-stats' : '.enemy-card .character-stats';
    if (type === 'block') {
      const blockSelector = target === 'player' ? '#block-stat-container' : '#enemy-block-container';
      if ($(blockSelector).length) {
        targetSelector = blockSelector;
      }
    }
    const targetElement = $(targetSelector);

    if (targetElement.length === 0) return;

    // 确定颜色和前缀
    let color = '#ff4444';
    let prefix = '-';
    let icon = '';

    switch (type) {
      case 'damage':
        color = '#ff4444';
        prefix = '-';
        icon = '💥';
        break;
      case 'heal':
        color = '#44ff44';
        prefix = '+';
        icon = '💚';
        break;
      case 'lust':
        color = '#ff69b4';
        prefix = '+';
        icon = '💗';
        break;
      case 'block':
        color = '#4169e1';
        prefix = '-';
        icon = '🛡︎';
        break;
    }

    const offset = targetElement.offset();
    if (!offset) return;

    // 随机起始位置（在目标区域内）
    const randomX = offset.left + Math.random() * targetElement.outerWidth()!;
    const randomY = offset.top + Math.random() * targetElement.outerHeight()!;

    const damageText = $(`
      <div class="physics-damage" style="
        position: absolute;
        left: ${randomX}px;
        top: ${randomY}px;
        color: ${color};
        font-size: ${Math.min(20 + damage / 5, 36)}px;
        font-weight: bold;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
        pointer-events: none;
        z-index: 1000;
        font-family: 'ZCOOL KuaiLe', 'Noto Sans SC', 'Microsoft YaHei', sans-serif !important;
      ">
        ${icon} ${prefix}${damage}
      </div>
    `);

    $('body').append(damageText);

    // 物理动画参数
    let x = randomX;
    let y = randomY;
    let vx = (Math.random() - 0.5) * 200; // 水平初速度
    let vy = -150 - Math.random() * 100; // 垂直初速度（向上）
    const gravity = 500; // 重力加速度
    const bounce = 0.6; // 反弹系数
    const friction = 0.98; // 摩擦系数

    const startTime = Date.now();
    const duration = 3000; // 3秒后消失

    const animate = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > duration) {
        damageText.remove();
        return;
      }

      const dt = 16 / 1000; // 约60fps

      // 更新速度
      vy += gravity * dt;
      vx *= friction;

      // 更新位置
      x += vx * dt;
      y += vy * dt;

      // 边界检测和反弹
      const windowWidth = $(window).width()!;
      const windowHeight = $(window).height()!;

      if (x <= 0 || x >= windowWidth - 50) {
        vx = -vx * bounce;
        x = Math.max(0, Math.min(windowWidth - 50, x));
      }

      if (y >= windowHeight - 50) {
        vy = -vy * bounce;
        y = windowHeight - 50;

        // 如果速度太小，停止弹跳
        if (Math.abs(vy) < 50) {
          vy = 0;
        }
      }

      // 应用位置和透明度
      const opacity = Math.max(0, 1 - elapsed / duration);
      damageText.css({
        left: x + 'px',
        top: y + 'px',
        opacity: opacity,
      });

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }

  /**
   * 玩家受伤动画 - 玩家栏位闪烁
   */
  showPlayerDamageEffect(type: 'damage' | 'lust' | 'both' = 'damage'): void {
    const playerCard = $('.player-card');

    // 移除之前的动画类
    playerCard.removeClass('damage-flash lust-flash both-flash');

    // 添加对应的动画类
    switch (type) {
      case 'damage':
        playerCard.addClass('damage-flash');
        break;
      case 'lust':
        playerCard.addClass('lust-flash');
        break;
      case 'both':
        playerCard.addClass('both-flash');
        break;
    }

    // 1秒后移除动画类
    setTimeout(() => {
      playerCard.removeClass('damage-flash lust-flash both-flash');
    }, 600);
  }

  /**
   * 敌人受伤动画 - 敌人栏位闪烁
   */
  showEnemyDamageEffect(type: 'damage' | 'lust' | 'both' = 'damage'): void {
    const enemyCard = $('.enemy-card');

    // 移除之前的动画类
    enemyCard.removeClass('damage-flash lust-flash both-flash');

    // 添加对应的动画类
    switch (type) {
      case 'damage':
        enemyCard.addClass('damage-flash');
        break;
      case 'lust':
        enemyCard.addClass('lust-flash');
        break;
      case 'both':
        enemyCard.addClass('both-flash');
        break;
    }

    // 动画结束后移除类
    setTimeout(() => {
      enemyCard.removeClass('damage-flash lust-flash both-flash');
    }, 600);
  }

  /**
   * 欲望效果触发白光闪烁动画
   */
  showLustEffectFlash(): void {
    // 创建全屏白光遮罩
    const flashOverlay = $(`
      <div class="lust-flash-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.3) 50%, transparent 100%);
        z-index: 9999;
        pointer-events: none;
        opacity: 0;
      "></div>
    `);

    $('body').append(flashOverlay);

    // 快速连续闪烁两次 → 停顿 → 再闪烁 → 渐渐消失
    flashOverlay
      .animate({ opacity: 1 }, 80) // 第一次闪烁
      .animate({ opacity: 0.2 }, 60)
      .animate({ opacity: 1 }, 80) // 第二次闪烁
      .animate({ opacity: 0.2 }, 60)
      .delay(200) // 短暂停顿
      .animate({ opacity: 1 }, 100) // 再次闪烁
      .animate({ opacity: 0 }, 800, function () {
        // 渐渐消失
        $(this).remove();
      });

    // 添加屏幕震动效果
    $('body').addClass('screen-shake');
    setTimeout(() => {
      $('body').removeClass('screen-shake');
    }, 500);
  }

  /**
   * 震动效果
   */
  shakeElement(selector: string, duration: number = 300): void {
    const element = $(selector);
    if (element.length === 0) return;

    element.addClass('shake-animation');

    setTimeout(() => {
      element.removeClass('shake-animation');
    }, duration);
  }

  /**
   * 更新血条动画
   */
  updateHealthBarWithAnimation(target: 'player' | 'enemy', currentHp: number, maxHp: number): void {
    const hpPercent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0;

    let hpBarSelector: string;
    let hpTextSelector: string;

    if (target === 'player') {
      hpBarSelector = '.player-card .hp-fill';
      hpTextSelector = '.player-card #player-hp';
    } else {
      hpBarSelector = '.enemy-card .hp-fill';
      hpTextSelector = '.enemy-card #enemy-hp';
    }

    // 停止之前的动画，然后更新血条
    const hpBar = $(hpBarSelector);
    hpBar.stop(true, false).animate(
      {
        width: `${hpPercent}%`,
      },
      500,
    );

    // 更新血量文本
    $(hpTextSelector).text(`${currentHp}/${maxHp}`);

    // 根据血量百分比改变血条颜色
    hpBar.removeClass('hp-low hp-critical');
    if (hpPercent <= 25) {
      hpBar.addClass('hp-critical');
    } else if (hpPercent <= 50) {
      hpBar.addClass('hp-low');
    }
  }

  /**
   * 更新欲望条动画
   */
  updateLustBarWithAnimation(target: 'player' | 'enemy', currentLust: number, maxLust: number): void {
    const lustPercent = maxLust > 0 ? (currentLust / maxLust) * 100 : 0;

    let lustBarSelector: string;
    let lustTextSelector: string;

    if (target === 'player') {
      lustBarSelector = '.player-card .lust-fill';
      lustTextSelector = '.player-card #player-lust';
    } else {
      lustBarSelector = '.enemy-card .lust-fill';
      lustTextSelector = '.enemy-card #enemy-lust';
    }

    // 停止之前的动画，然后更新欲望条
    const lustBar = $(lustBarSelector);
    lustBar.stop(true, false).animate(
      {
        width: `${lustPercent}%`,
      },
      300,
    );

    // 更新欲望值文本
    $(lustTextSelector).text(`${currentLust}/${maxLust}`);

    // 根据欲望值改变颜色
    lustBar.removeClass('lust-high lust-critical');
    if (lustPercent >= 100) {
      lustBar.addClass('lust-critical');
    } else if (lustPercent >= 75) {
      lustBar.addClass('lust-high');
    }
  }

  /**
   * 卡牌使用动画
   */
  animateCardPlay(cardElement: JQuery): Promise<void> {
    return new Promise(resolve => {
      cardElement.addClass('card-playing');

      // 卡牌飞向目标的动画
      cardElement.animate(
        {
          opacity: 0.7,
          transform: 'scale(1.1) translateY(-20px)',
        },
        300,
        () => {
          cardElement.animate(
            {
              opacity: 0,
              transform: 'scale(0.8) translateY(-40px)',
            },
            200,
            () => {
              cardElement.removeClass('card-playing');
              resolve();
            },
          );
        },
      );
    });
  }

  /**
   * 显示卡牌无法使用的提示弹窗
   */
  showCardBlockedNotification(cardName: string, reason: string): void {
    const notification = $(`
      <div class="card-blocked-notification" style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: #ff6b6b;
        padding: 20px 30px;
        border-radius: 10px;
        border: 2px solid #ff6b6b;
        font-size: 16px;
        font-weight: bold;
        z-index: 10000;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
        font-family: 'ZCOOL KuaiLe', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
        text-align: center;
        min-width: 300px;
        opacity: 0;
      ">
        <div style="margin-bottom: 8px; font-size: 18px;">🃏 卡牌无法使用</div>
        <div style="color: #ffd700; margin-bottom: 5px;">${cardName}</div>
        <div style="color: #ffaa00; font-size: 14px;">${reason}</div>
      </div>
    `);

    $('body').append(notification);

    // 淡入动画
    notification.animate({ opacity: 1 }, 200);

    // 2秒后自动消失
    setTimeout(() => {
      notification.animate({ opacity: 0 }, 300, function () {
        $(this).remove();
      });
    }, 2000);
  }

  /**
   * 显示回合横幅
   */
  showTurnBanner(text: string, color: string = '#4299e1'): void {
    const turnBanner = $(`
      <div class="turn-banner" style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: ${color};
        color: white;
        padding: 20px 40px;
        border-radius: 10px;
        font-size: 24px;
        font-weight: bold;
        z-index: 2000;
        box-shadow: 0 8px 16px rgba(0,0,0,0.3);
        text-align: center;
      ">
        ${text}
      </div>
    `);

    $('body').append(turnBanner);

    turnBanner
      .css({ opacity: 0, transform: 'translate(-50%, -50%) scale(0.5)' })
      .animate({ opacity: 1 }, 200)
      .css({ transform: 'translate(-50%, -50%) scale(1)' });

    setTimeout(() => {
      turnBanner.fadeOut(300, function () {
        $(this).remove();
      });
    }, 1500);
  }

  /**
   * 显示行动横幅
   */
  showActionBanner(text: string, color: string = '#38a169'): void {
    const actionBanner = $(`
      <div class="action-banner" style="
        position: fixed;
        top: 40%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: ${color};
        color: white;
        padding: 15px 30px;
        border-radius: 8px;
        font-size: 18px;
        font-weight: bold;
        z-index: 1500;
        box-shadow: 0 6px 12px rgba(0,0,0,0.3);
        text-align: center;
      ">
        ${text}
      </div>
    `);

    $('body').append(actionBanner);

    // 动画效果
    actionBanner
      .css({ opacity: 0, transform: 'translate(-50%, -50%) scale(0.8)' })
      .animate({ opacity: 1 }, 300)
      .css({ transform: 'translate(-50%, -50%) scale(1)' });

    setTimeout(() => {
      actionBanner.fadeOut(400, function () {
        $(this).remove();
      });
    }, 2000);
  }

  /**
   * 显示欲望溢出效果
   */
  showLustOverflowEffect(target: 'player' | 'enemy', effectName: string): void {
    const flashOverlay = $(`
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(255, 105, 180, 0.3);
        z-index: 3000;
        pointer-events: none;
        animation: lustFlash 2s ease-out;
      "></div>
    `);

    $('body').append(flashOverlay);

    // 显示效果名称
    const effectBanner = $(`
      <div style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(45deg, #ff1493, #ff69b4);
        color: white;
        padding: 20px 30px;
        border-radius: 15px;
        font-size: 20px;
        font-weight: bold;
        text-align: center;
        z-index: 3001;
        border: 4px solid #ff69b4;
        box-shadow: 0 12px 36px rgba(0,0,0,0.8);
        animation: lustPulse 2s infinite;
      ">
        <div style="font-size: 32px; margin-bottom: 10px;">💋</div>
        <div>${effectName}</div>
      </div>
    `);

    $('body').append(effectBanner);

    // 2秒后移除
    setTimeout(() => {
      flashOverlay.remove();
      effectBanner.remove();
    }, 2000);
  }

  /**
   * 胜利动画
   */
  async playVictoryAnimation(): Promise<void> {
    this.showActionBanner('🎉 胜利！', '#38a169');
    // 可以添加更多胜利特效
  }

  /**
   * 失败动画
   */
  async playDefeatAnimation(): Promise<void> {
    this.showActionBanner('💀 失败...', '#e53e3e');
    // 可以添加更多失败特效
  }

  /**
   * 显示敌人行动动画（屏幕中央半透明弹窗）
   */
  showEnemyActionAnimation(actionName: string, description: string): void {
    // 移除已存在的动画
    $('.enemy-action-popup').remove();

    const popup = $(`
      <div class="enemy-action-popup">
        <div class="enemy-action-content">
          <div class="enemy-action-name">${actionName}</div>
          <div class="enemy-action-description">${description}</div>
        </div>
      </div>
    `);

    $('body').append(popup);

    // 动画效果
    popup
      .css({ opacity: 0, transform: 'translate(-50%, -50%) scale(0.8)' })
      .animate({ opacity: 1 }, 300)
      .css({ transform: 'translate(-50%, -50%) scale(1)' });

    // 2秒后自动消失
    setTimeout(() => {
      popup.animate({ opacity: 0 }, 300, function () {
        $(this).remove();
      });
    }, 2000);
  }
  /**
   * 播放卡牌使用动画（根据卡名选取元素，带飞行与命中闪烁）
   */
  public async playCardAnimation(card: Card, targetSelector: string): Promise<void> {
    const cardElement = $(`.card:contains("${card.name}")`).first();
    if (cardElement.length === 0) return;

    // 发光效果
    cardElement.addClass('card-casting');

    // 简易飞行轨迹：从卡牌中心飞向目标中心
    const target = $(targetSelector);
    if (target.length) {
      const start = cardElement.offset();
      const end = target.offset();
      if (start && end) {
        const temp = $('<div class="card-flight"></div>');
        temp.css({
          position: 'absolute',
          left: start.left + cardElement.width()! / 2,
          top: start.top + cardElement.height()! / 2,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.9)',
          boxShadow: '0 0 10px rgba(255,255,255,0.8)',
          zIndex: 1000,
        });
        $('body').append(temp);
        await new Promise<void>(resolve => {
          temp.animate(
            { left: end.left + target.width()! / 2, top: end.top + target.height()! / 2, opacity: 0.6 },
            400,
            'swing',
            () => {
              temp.remove();
              resolve();
            },
          );
        });
      }
    }

    // 目标命中闪烁
    await this.playTargetHitEffect(targetSelector);

    // 清理
    cardElement.removeClass('card-casting');
  }

  /**
   * 播放伤害数字动画（上浮淡出样式）
   */
  public async playDamageAnimation(
    value: number,
    targetSelector: string,
    type: 'damage' | 'heal' | 'lust' = 'damage',
  ): Promise<void> {
    const target = $(targetSelector);
    if (target.length === 0) return;

    const damageText = $(`<div class="damage-number damage-${type}">${value}</div>`);

    // 随机偏移
    const offsetX = (Math.random() - 0.5) * 60;
    const offsetY = (Math.random() - 0.5) * 40;

    const off = target.offset();
    if (!off) return;

    damageText.css({
      position: 'absolute',
      left: off.left + target.width()! / 2 + offsetX,
      top: off.top + offsetY,
      zIndex: 1000,
      fontSize: `${Math.min(24 + value / 10, 48)}px`,
      fontWeight: 'bold',
      color: type === 'damage' ? '#ff4444' : type === 'heal' ? '#44ff44' : '#ff44ff',
      textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
      pointerEvents: 'none',
    });

    $('body').append(damageText);

    await new Promise<void>(resolve => {
      damageText.animate(
        {
          top: '-=80',
          opacity: 0,
        },
        1500,
        () => {
          damageText.remove();
          resolve();
        },
      );
    });
  }

  /**
   * 播放状态效果动画（应用/移除）
   */
  public async playStatusAnimation(
    status: StatusEffect,
    targetSelector: string,
    action: 'apply' | 'remove' = 'apply',
  ): Promise<void> {
    const target = $(targetSelector);
    if (target.length === 0) return;

    if (action === 'apply') {
      const statusIcon = $(`<div class="status-apply-effect">${status.emoji}</div>`);
      const off = target.offset();
      if (!off) return;
      statusIcon.css({
        position: 'absolute',
        left: off.left + target.width()! / 2 - 15,
        top: off.top - 30,
        fontSize: '30px',
        zIndex: 1000,
        opacity: 0,
      });
      $('body').append(statusIcon);
      await new Promise<void>(resolve => {
        statusIcon
          .animate({ opacity: 1, top: '-=20' }, 300)
          .delay(500)
          .animate({ opacity: 0, top: '-=20' }, 300, () => {
            statusIcon.remove();
            resolve();
          });
      });
    } else {
      // 移除闪烁
      target.addClass('status-remove-flash');
      setTimeout(() => target.removeClass('status-remove-flash'), 600);
    }
  }

  /**
   * 生命值变化动画（平滑血条 + 伤害数字）
   */
  public async playHealthAnimation(
    targetSelector: string,
    oldValue: number,
    newValue: number,
    maxValue?: number,
  ): Promise<void> {
    const change = newValue - oldValue;
    if (maxValue !== undefined) {
      const isPlayer = targetSelector.includes('player');
      this.updateHealthBarWithAnimation(isPlayer ? 'player' : 'enemy', newValue, maxValue);
    }
    if (change !== 0) {
      await this.playDamageAnimation(Math.abs(change), targetSelector, change > 0 ? 'heal' : 'damage');
    }
  }

  /**
   * 抽牌动画（从牌堆飞向手牌区域）
   */
  public async playDrawCardAnimation(cards: Card[]): Promise<void> {
    const handContainer = $('.player-hand');
    const drawPile = $('.draw-pile');
    const drawOff = drawPile.offset();
    const handOff = handContainer.offset();
    if (!drawOff || !handOff) return;

    for (const card of cards) {
      const tempCard = $(`<div class="card-drawing">${card.emoji || '🃏'}</div>`);
      tempCard.css({
        position: 'absolute',
        left: drawOff.left,
        top: drawOff.top,
        width: '60px',
        height: '80px',
        backgroundColor: '#2a2a2a',
        border: '2px solid #555',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
        zIndex: 1000,
      });
      $('body').append(tempCard);

      await new Promise<void>(resolve => {
        tempCard.animate(
          {
            left: handOff.left + handContainer.children().length * 120,
            top: handOff.top,
          },
          600,
          () => {
            tempCard.remove();
            resolve();
          },
        );
      });
      await new Promise(r => setTimeout(r, 100));
    }
  }
  /**
   * 目标命中闪烁效果
   */
  private async playTargetHitEffect(targetSelector: string): Promise<void> {
    const targetElement = $(targetSelector);
    if (targetElement.length === 0) return;
    targetElement.addClass('hit-flash');
    await new Promise<void>(r => setTimeout(r, 200));
    targetElement.removeClass('hit-flash');
  }
}
