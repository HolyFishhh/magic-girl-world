/**
 * 修饰符显示器 - 显示玩家当前的修饰符状态
 */

import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';
import { GameStateManager } from '../core/gameStateManager';

export class ModifierDisplay {
  private isVisible: boolean = false;
  private gameStateManager: GameStateManager;
  private effectExecutor: UnifiedEffectExecutor;

  constructor(gameStateManager: GameStateManager) {
    this.gameStateManager = gameStateManager;
    this.effectExecutor = UnifiedEffectExecutor.getInstance();
    this.initializeUI();
    this.setupEventListeners();
  }

  /**
   * 初始化UI
   */
  private initializeUI(): void {
    // 创建修饰符显示面板
    const panelHTML = `
      <div id="modifier-display-panel" class="modifier-display-panel" style="display: none;">
        <div class="modifier-panel-header">
          <h3>当前修饰符</h3>
          <button id="modifier-panel-close" class="close-btn">×</button>
        </div>
        <div class="modifier-panel-content">
          <div id="modifier-list" class="modifier-list">
            <!-- 修饰符列表将在这里动态生成 -->
          </div>
        </div>
      </div>
    `;

    // 按钮改为由页面模板提供，仅附加面板
    $('body').append(panelHTML);

    // 添加样式
    this.addStyles();
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 修饰符按钮点击事件（委托，确保与battle-controls的按钮联动）
    $(document).off('click', '#modifier-display-btn');
    $(document).on('click', '#modifier-display-btn', () => {
      this.toggleDisplay();
    });

    // 关闭按钮点击事件
    $('#modifier-panel-close').on('click', () => {
      this.hideDisplay();
    });

    // 点击面板外部关闭
    $(document).on('click', event => {
      if (
        this.isVisible &&
        !$(event.target).closest('#modifier-display-panel').length &&
        !$(event.target).closest('#modifier-display-btn').length
      ) {
        this.hideDisplay();
      }
    });
  }

  /**
   * 切换显示状态
   */
  private toggleDisplay(): void {
    if (this.isVisible) {
      this.hideDisplay();
    } else {
      this.showDisplay();
    }
  }

  /**
   * 显示修饰符面板
   */
  private showDisplay(): void {
    this.updateModifierList();
    $('#modifier-display-panel').fadeIn(200);
    this.isVisible = true;
  }

  /**
   * 隐藏修饰符面板
   */
  private hideDisplay(): void {
    $('#modifier-display-panel').fadeOut(200);
    this.isVisible = false;
  }

  /**
   * 更新修饰符列表
   */
  private updateModifierList(): void {
    const player = this.gameStateManager.getPlayer();
    const enemy = this.gameStateManager.getEnemy();

    if (!player && !enemy) {
      $('#modifier-list').html('<div class="no-modifiers">暂无修饰符</div>');
      return;
    }

    let html = '';

    // 显示玩家修饰符
    if (player) {
      const playerModifiers = this.getAllEntityModifiers(player);
      const hasPlayerModifiers = Object.values(playerModifiers).some(v => v !== 0);

      if (hasPlayerModifiers) {
        html += '<div class="modifier-section"><h4>玩家修饰符</h4>';
        for (const [modifierType, value] of Object.entries(playerModifiers)) {
          if (value === 0) continue;
          const isDetail = modifierType.endsWith('__add') || modifierType.endsWith('__mul');
          const displayName = this.getModifierDisplayName(modifierType);
          const valueText = this.formatModifierValue(value, modifierType.endsWith('__mul'));
          const colorClass = value > 0 ? 'positive' : 'negative';

          html += `
            <div class="modifier-item ${colorClass}">
              <span class="modifier-name">${displayName}${isDetail ? '' : ''}</span>
              <span class="modifier-value">${valueText}</span>
            </div>
          `;
        }
        html += '</div>';
      }
    }

    // 显示敌人修饰符
    if (enemy) {
      const enemyModifiers = this.getAllEntityModifiers(enemy);
      const hasEnemyModifiers = Object.values(enemyModifiers).some(v => v !== 0);

      if (hasEnemyModifiers) {
        html += '<div class="modifier-section"><h4>敌人修饰符</h4>';
        for (const [modifierType, value] of Object.entries(enemyModifiers)) {
          if (value === 0) continue;
          const isDetail = modifierType.endsWith('__add') || modifierType.endsWith('__mul');
          const displayName = this.getModifierDisplayName(modifierType);
          const valueText = this.formatModifierValue(value, modifierType.endsWith('__mul'));
          const colorClass = value > 0 ? 'positive' : 'negative';

          html += `
            <div class="modifier-item ${colorClass}">
              <span class="modifier-name">${displayName}${isDetail ? '' : ''}</span>
              <span class="modifier-value">${valueText}</span>
            </div>
          `;
        }
        html += '</div>';
      }
    }

    if (html === '') {
      html = '<div class="no-modifiers">暂无修饰符</div>';
    }

    $('#modifier-list').html(html);
  }

  /**
   * 获取实体的所有修饰符
   */
  private getAllEntityModifiers(entity: any): { [key: string]: number } {
    const modifierTypes = [
      'damage_modifier',
      'damage_taken_modifier',
      'lust_damage_modifier',
      'lust_damage_taken_modifier',
      'block_modifier',
      'heal_modifier',
      'draw',
      'discard',
      'energy_gain',
      'card_play_limit',
    ];

    const modifiers: { [key: string]: number } = {};

    for (const modifierType of modifierTypes) {
      // 仅保留“加减/乘除”的分项，不显示聚合项
      const detail = (this.effectExecutor as any).analyzeModifierFromStatusEffects(entity, modifierType);
      modifiers[`${modifierType}__add`] = detail.add;
      modifiers[`${modifierType}__mul`] = detail.mul !== 1 ? detail.mul : 0;
    }

    return modifiers;
  }

  /**
   * 获取修饰符显示名称
   */
  private getModifierDisplayName(modifierType: string): string {
    const nameMap: { [key: string]: string } = {
      damage_modifier__add: '伤害修饰（加减）',
      damage_modifier__mul: '伤害修饰（乘除）',

      damage_taken_modifier__add: '受伤修饰（加减）',
      damage_taken_modifier__mul: '受伤修饰（乘除）',

      lust_damage_modifier__add: '欲望伤害修饰（加减）',
      lust_damage_modifier__mul: '欲望伤害修饰（乘除）',

      lust_damage_taken_modifier__add: '受欲望伤害修饰（加减）',
      lust_damage_taken_modifier__mul: '受欲望伤害修饰（乘除）',

      block_modifier: '格挡修饰',
      heal_modifier: '治疗修饰',
      draw: '抽牌修饰',
      discard: '弃牌修饰',
      energy_gain: '能量获得修饰',
      card_play_limit: '卡牌使用限制修饰',
    };

    return nameMap[modifierType] || modifierType;
  }

  /**
   * 格式化修饰符值
   */
  private formatModifierValue(value: number, isMul: boolean = false): string {
    // 保留1位小数
    const round1 = (n: number) => Math.round(n * 10) / 10;
    if (isMul) {
      if (value === 0) return '×0';
      return `×${round1(value)}`;
    }
    const v = round1(value);
    return v > 0 ? `+${v}` : `${v}`;
  }

  /**
   * 添加样式
   */
  private addStyles(): void {
    const styles = `
      <style>
        .modifier-display-btn {
          position: fixed;
          bottom: 20px; /* 挪到战斗日志按钮旁边 */
          left: 140px;
          width: 80px;
          height: 32px;
          border: 2px solid #667eea;
          border-radius: 6px;
          background: rgba(30, 30, 30, 0.9);
          color: #667eea;
          font-size: 12px;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          transition: all 0.3s ease;
          z-index: 500; /* 降低层级，避免遮挡手牌 */
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modifier-display-btn:hover {
          background: rgba(102, 126, 234, 0.1);
          border-color: #8b5cf6;
          color: #8b5cf6;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }

        .modifier-btn-text {
          font-weight: 500;
          letter-spacing: 0.5px;
        }

        .modifier-display-panel {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 400px;
          max-height: 500px;
          background: rgba(30, 30, 30, 0.95);
          border: 2px solid #667eea;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          z-index: 2000;
          backdrop-filter: blur(10px);
        }

        .modifier-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #444;
        }

        .modifier-panel-header h3 {
          margin: 0;
          color: #fff;
          font-size: 18px;
        }

        .close-btn {
          background: none;
          border: none;
          color: #ccc;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: all 0.2s ease;
        }

        .close-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .modifier-panel-content {
          padding: 20px;
          max-height: 400px;
          overflow-y: auto;
        }

        .modifier-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .modifier-section {
          border: 1px solid #444;
          border-radius: 8px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.02);
        }

        .modifier-section h4 {
          margin: 0 0 8px 0;
          color: #e5e7eb;
          font-size: 14px;
          font-weight: 600;
          border-bottom: 1px solid #555;
          padding-bottom: 4px;
        }

        .modifier-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.05);
          border-left: 4px solid;
        }

        .modifier-item.positive {
          border-left-color: #4ade80;
        }

        .modifier-item.negative {
          border-left-color: #f87171;
        }

        .modifier-name {
          color: #e5e7eb;
          font-weight: 500;
        }

        .modifier-value {
          font-weight: bold;
          font-size: 16px;
        }

        .modifier-item.positive .modifier-value {
          color: #4ade80;
        }

        .modifier-item.negative .modifier-value {
          color: #f87171;
        }

        .no-modifiers {
          text-align: center;
          color: #9ca3af;
          font-style: italic;
          padding: 20px;
        }
      </style>
    `;

    $('head').append(styles);
  }

  /**
   * 公共方法：刷新显示
   */
  public refresh(): void {
    if (this.isVisible) {
      this.updateModifierList();
    }
  }
}
