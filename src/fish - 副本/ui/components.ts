import { Card, Relic, StatusEffect } from '../types';
import { AnimationManager } from './animationManager';

/**
 * 高级UI组件管理器
 */
export class UIComponentManager {
  private static instance: UIComponentManager;
  private animationManager: AnimationManager;
  private tooltipContainer: JQuery<HTMLElement> = $('<div />');

  private constructor() {
    this.animationManager = AnimationManager.getInstance();
    this.initializeTooltipContainer();
  }

  public static getInstance(): UIComponentManager {
    if (!UIComponentManager.instance) {
      UIComponentManager.instance = new UIComponentManager();
    }
    return UIComponentManager.instance;
  }

  /**
   * 创建增强的卡牌组件
   */
  public createEnhancedCard(
    card: Card,
    options: {
      draggable?: boolean;
      clickable?: boolean;
      showTooltip?: boolean;
      size?: 'small' | 'normal' | 'large';
    } = {},
  ): JQuery<HTMLElement> {
    const { draggable = false, clickable = true, showTooltip = true, size = 'normal' } = options;

    const cardElement = $(`
            <div class="enhanced-card card-${size} rarity-${card.rarity} card-type-${card.type}"
                 data-card-id="${card.name}">
                <div class="card-header">
                    <div class="card-cost">${card.cost}</div>
                    <div class="card-rarity-gem"></div>
                    <div class="card-type-indicator">${this.translateCardType(card.type)}</div>
                </div>
                <div class="card-artwork">
                    <div class="card-emoji">${card.emoji}</div>
                    ${card.retain ? '<div class="card-keyword retain">保留</div>' : ''}
                    ${card.exhaust ? '<div class="card-keyword exhaust">消耗</div>' : ''}
                </div>
                <div class="card-body">
                    <div class="card-name">${card.name}</div>
                    <div class="card-description">${card.description}</div>
                </div>
                <div class="card-glow"></div>
            </div>
        `);

    // 添加交互功能
    if (clickable) {
      cardElement.addClass('clickable');
      cardElement.on('click', () => this.handleCardClick(card, cardElement));
    }

    if (draggable) {
      this.makeDraggable(cardElement, card);
    }

    if (showTooltip) {
      this.addTooltip(cardElement, this.generateCardTooltip(card));
    }

    // 添加悬停效果
    cardElement
      .on('mouseenter', () => {
        cardElement.addClass('card-hover');
        if (!cardElement.hasClass('card-disabled')) {
          this.animationManager.playCardAnimation(card, '#enemy-area');
        }
      })
      .on('mouseleave', () => {
        cardElement.removeClass('card-hover');
      });

    return cardElement;
  }

  /**
   * 创建状态效果图标
   */
  public createStatusIcon(
    status: StatusEffect,
    options: {
      showValue?: boolean;
      showDuration?: boolean;
      size?: 'small' | 'normal' | 'large';
    } = {},
  ): JQuery<HTMLElement> {
    const { showValue = true, showDuration = true, size = 'normal' } = options;

    const statusElement = $(`
            <div class="status-icon status-${size} status-type-${status.type}" 
                 data-status-id="${status.id}">
                <div class="status-emoji">${status.emoji}</div>
                 ${showValue ? `<div class="status-value">${status.stacks}</div>` : ''}
                <div class="status-border"></div>
            </div>
        `);

    // 添加工具提示
    this.addTooltip(statusElement, this.generateStatusTooltip(status));

    // 添加脉动效果
    if (status.type === 'ens') {
      statusElement.addClass('status-pulsing');
    }

    return statusElement;
  }

  /**
   * 创建遗物组件
   */
  public createRelicComponent(
    relic: Relic,
    options: {
      showTooltip?: boolean;
      size?: 'small' | 'normal' | 'large';
    } = {},
  ): JQuery<HTMLElement> {
    const { showTooltip = true, size = 'normal' } = options;

    const relicElement = $(`
            <div class="relic-component relic-${size} rarity-${relic.rarity}" 
                 data-relic-name="${relic.name}">
                <div class="relic-frame">
                    <div class="relic-emoji">${relic.emoji}</div>
                    <div class="relic-shine"></div>
                </div>
                <div class="relic-name">${relic.name}</div>
            </div>
        `);

    if (showTooltip) {
      this.addTooltip(relicElement, this.generateRelicTooltip(relic));
    }

    // 添加悬停效果
    relicElement
      .on('mouseenter', () => {
        relicElement.addClass('relic-hover');
      })
      .on('mouseleave', () => {
        relicElement.removeClass('relic-hover');
      });

    return relicElement;
  }

  /**
   * 创建战斗日志组件
   */
  public createBattleLog(): JQuery<HTMLElement> {
    const logContainer = $(`
            <div class="battle-log">
                <div class="battle-log-header">
                    <h3>战斗日志</h3>
                    <div class="battle-log-controls">
                        <button class="log-filter" data-filter="all">全部</button>
                        <button class="log-filter" data-filter="damage">伤害</button>
                        <button class="log-filter" data-filter="status">状态</button>
                        <button class="log-clear">清空</button>
                    </div>
                </div>
                <div class="battle-log-content">
                    <div class="log-entries"></div>
                </div>
            </div>
        `);

    // 添加过滤功能
    logContainer.find('.log-filter').on('click', e => {
      const filter = $(e.target).data('filter');
      this.filterBattleLog(filter);
      logContainer.find('.log-filter').removeClass('active');
      $(e.target).addClass('active');
    });

    // 添加清空功能
    logContainer.find('.log-clear').on('click', () => {
      logContainer.find('.log-entries').empty();
    });

    return logContainer;
  }

  /**
   * 创建设置面板
   */
  public createSettingsPanel(): JQuery<HTMLElement> {
    const settingsPanel = $(`
            <div class="settings-panel">
                <div class="settings-header">
                    <h2>游戏设置</h2>
                    <button class="settings-close">×</button>
                </div>
                <div class="settings-content">
                    <div class="settings-section">
                        <h3>显示设置</h3>
                        <label class="setting-item">
                            <input type="checkbox" id="show-damage-numbers" checked>
                            <span>显示伤害数字</span>
                        </label>
                        <label class="setting-item">
                            <input type="checkbox" id="enable-animations" checked>
                            <span>启用动画效果</span>
                        </label>
                        <label class="setting-item">
                            <input type="checkbox" id="show-tooltips" checked>
                            <span>显示工具提示</span>
                        </label>
                    </div>
                    <div class="settings-section">
                        <h3>内容设置</h3>
                        <label class="setting-item">
                            <input type="checkbox" id="enable-ens-content" checked>
                            <span>启用ENS内容</span>
                        </label>
                        <label class="setting-item">
                            <input type="range" id="content-intensity" min="1" max="5" value="3">
                            <span>内容强度: <span id="intensity-value">3</span></span>
                        </label>
                    </div>
                    <div class="settings-section">
                        <h3>游戏设置</h3>
                        <label class="setting-item">
                            <input type="checkbox" id="auto-end-turn">
                            <span>自动结束回合</span>
                        </label>
                        <label class="setting-item">
                            <input type="checkbox" id="confirm-actions" checked>
                            <span>确认重要操作</span>
                        </label>
                    </div>
                </div>
            </div>
        `);

    // 添加设置交互
    this.setupSettingsInteractions(settingsPanel);

    return settingsPanel;
  }

  /**
   * 创建进度条组件
   */
  public createProgressBar(options: {
    current: number;
    max: number;
    type: 'hp' | 'lust' | 'energy' | 'block';
    showText?: boolean;
    animated?: boolean;
  }): JQuery<HTMLElement> {
    const { current, max, type, showText = true, animated = true } = options;
    const percentage = Math.max(0, Math.min(100, (current / max) * 100));

    const progressBar = $(`
            <div class="progress-bar progress-${type} ${animated ? 'animated' : ''}">
                <div class="progress-background">
                    <div class="progress-fill" style="width: ${percentage}%"></div>
                    <div class="progress-shine"></div>
                </div>
                ${showText ? `<div class="progress-text">${current}/${max}</div>` : ''}
            </div>
        `);

    return progressBar;
  }

  /**
   * 添加战斗日志条目
   */
  public addBattleLogEntry(message: string, type: 'info' | 'damage' | 'heal' | 'status' | 'action' = 'info'): void {
    const logContainer = $('.battle-log .log-entries');
    if (logContainer.length === 0) return;

    const timestamp = new Date().toLocaleTimeString();
    const entry = $(`
            <div class="log-entry log-${type}" data-type="${type}">
                <span class="log-time">${timestamp}</span>
                <span class="log-message">${message}</span>
            </div>
        `);

    logContainer.append(entry);

    // 自动滚动到底部
    logContainer.scrollTop(logContainer[0].scrollHeight);

    // 限制日志条目数量
    const entries = logContainer.children();
    if (entries.length > 100) {
      entries.first().remove();
    }
  }

  /**
   * 更新进度条
   */
  public updateProgressBar(selector: string, current: number, max: number, animated: boolean = true): void {
    const progressBar = $(selector);
    if (progressBar.length === 0) return;

    const percentage = Math.max(0, Math.min(100, (current / max) * 100));
    const fill = progressBar.find('.progress-fill');
    const text = progressBar.find('.progress-text');

    if (animated) {
      fill.animate({ width: `${percentage}%` }, 300);
    } else {
      fill.css('width', `${percentage}%`);
    }

    if (text.length > 0) {
      text.text(`${current}/${max}`);
    }
  }

  // 私有方法

  private initializeTooltipContainer(): void {
    this.tooltipContainer = $('<div id="tooltip-container"></div>');
    $('body').append(this.tooltipContainer);
  }

  private handleCardClick(card: Card, cardElement: JQuery<HTMLElement>): void {
    if (cardElement.hasClass('card-disabled')) return;

    // 触发卡牌使用事件
    $(document).trigger('card:play', [card, cardElement]);
  }

  private makeDraggable(cardElement: JQuery<HTMLElement>, card: Card): void {
    cardElement.draggable({
      helper: 'clone',
      revert: 'invalid',
      zIndex: 1000,
      start: () => {
        cardElement.addClass('card-dragging');
      },
      stop: () => {
        cardElement.removeClass('card-dragging');
      },
    });
  }

  private addTooltip(element: JQuery<HTMLElement>, content: string): void {
    element
      .on('mouseenter', (e: JQuery.MouseEnterEvent) => {
        const tooltip = $(`<div class="tooltip">${content}</div>`);
        this.tooltipContainer.append(tooltip);

        const updatePosition = (event: JQuery.MouseEventBase) => {
          tooltip.css({
            left: event.pageX + 10,
            top: event.pageY - tooltip.outerHeight()! - 10,
          });
        };

        updatePosition(e as unknown as JQuery.MouseEventBase);
        element.on('mousemove', updatePosition);

        tooltip.fadeIn(200);
      })
      .on('mouseleave', () => {
        this.tooltipContainer.find('.tooltip').fadeOut(200, function () {
          $(this).remove();
        });
        element.off('mousemove');
      });
  }

  private generateCardTooltip(card: Card): string {
    let tooltip = `<div class="card-tooltip">`;
    tooltip += `<div class="tooltip-header">${card.name}</div>`;
    tooltip += `<div class="tooltip-cost">消耗: ${card.cost} 能量</div>`;
    tooltip += `<div class="tooltip-type">类型: ${card.type}</div>`;
    tooltip += `<div class="tooltip-rarity">稀有度: ${card.rarity}</div>`;
    tooltip += `<div class="tooltip-description">${card.description}</div>`;

    // 渲染弃牌效果（与 effect 同解析方式，外层包裹并加上“被弃掉时：”标题）
    try {
      if ((card as any).discard_effect) {
        const { UnifiedEffectDisplay } = await import('./unifiedEffectDisplay');
        const display = UnifiedEffectDisplay.getInstance();
        const tags = display.parseEffectToTags((card as any).discard_effect, { isPlayerCard: true });
        const wrapped = display.createWrappedEffectTagsHTML(tags);
        if (wrapped) {
          tooltip += `<div class="tooltip-effects"><div class="tooltip-subtitle">被弃掉时：</div>${wrapped}</div>`;
        }
      }
    } catch (e) {
      // 忽略渲染失败，避免影响其他 tooltip 内容
    }

    if (card.retain || card.exhaust) {
      tooltip += `<div class="tooltip-keywords">`;
      if (card.retain) tooltip += `<span class="keyword">保留</span>`;
      if (card.exhaust) tooltip += `<span class="keyword">消耗</span>`;
      tooltip += `</div>`;
    }

    tooltip += `</div>`;
    return tooltip;
  }

  private generateStatusTooltip(status: StatusEffect): string {
    let tooltip = `<div class="status-tooltip">`;
    tooltip += `<div class="tooltip-header">${status.name}</div>`;
    tooltip += `<div class="tooltip-type">类型: ${status.type}</div>`;
    tooltip += `<div class="tooltip-stacks">层数: ${status.stacks}</div>`;
    // 移除持续回合显示，统一由衰减机制管理
    tooltip += `<div class="tooltip-description">${status.description}</div>`;
    tooltip += `</div>`;
    return tooltip;
  }

  private generateRelicTooltip(relic: Relic): string {
    let tooltip = `<div class="relic-tooltip">`;
    tooltip += `<div class="tooltip-header">${relic.name}</div>`;
    tooltip += `<div class="tooltip-rarity">稀有度: ${relic.rarity}</div>`;
    tooltip += `<div class="tooltip-description">${relic.description}</div>`;
    tooltip += `</div>`;
    return tooltip;
  }

  private filterBattleLog(filter: string): void {
    const entries = $('.battle-log .log-entry');

    if (filter === 'all') {
      entries.show();
    } else {
      entries.hide();
      entries.filter(`[data-type="${filter}"]`).show();
    }
  }

  private setupSettingsInteractions(panel: JQuery<HTMLElement>): void {
    // 关闭按钮
    panel.find('.settings-close').on('click', () => {
      panel.fadeOut(300);
    });

    // 强度滑块
    panel.find('#content-intensity').on('input', e => {
      const value = String($(e.target).val() ?? '');
      panel.find('#intensity-value').text(value);
    });

    // 保存设置到localStorage
    panel.find('input').on('change', () => {
      this.saveSettings(panel);
    });

    // 加载设置
    this.loadSettings(panel);
  }

  private saveSettings(panel: JQuery<HTMLElement>): void {
    const settings: Record<string, any> = {};

    panel.find('input[type="checkbox"]').each((_, element) => {
      const $element = $(element);
      settings[$element.attr('id')!] = $element.is(':checked');
    });

    panel.find('input[type="range"]').each((_, element) => {
      const $element = $(element);
      settings[$element.attr('id')!] = $element.val();
    });

    localStorage.setItem('fishRPG_settings', JSON.stringify(settings));
  }

  private loadSettings(panel: JQuery<HTMLElement>): void {
    const savedSettings = localStorage.getItem('fishRPG_settings');
    if (!savedSettings) return;

    try {
      const settings: Record<string, any> = JSON.parse(savedSettings);

      Object.entries(settings).forEach(([key, value]) => {
        const element = panel.find(`#${key}`);
        const typeAttr = element.attr('type');
        if (typeAttr === 'checkbox') {
          element.prop('checked', Boolean(value));
        } else if (typeAttr === 'range') {
          element.val(String(value));
          panel.find('#intensity-value').text(String(value));
        }
      });
    } catch (error) {
      console.warn('Failed to load settings:', error);
    }
  }

  /**
   * 翻译卡牌类型
   */
  private translateCardType(type: string): string {
    const typeTranslations: { [key: string]: string } = {
      Attack: '攻击',
      Skill: '技能',
      Power: '能力',
      Event: '事件',
    };
    return typeTranslations[type] || type;
  }
}
