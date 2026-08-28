/**
 * 修饰符显示器 - 显示玩家当前的修饰符状态
 */

import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';
import { getAttributeDefinition } from '../combat/effectDefinitions';
import { GameStateManager } from '../core/gameStateManager';
import { escapeHtml } from '../shared/html';

export function getModifierDisplayName(modifierType: string): string {
  const detailMatch = modifierType.match(/^(.*)__(add|mul)$/);
  const attribute = detailMatch?.[1] ?? modifierType;
  const detail = detailMatch?.[2];
  const baseName = getAttributeDefinition(attribute)?.displayName ?? attribute;
  if (detail === 'add') return `${baseName}（加减）`;
  if (detail === 'mul') return `${baseName}（乘除）`;
  return baseName;
}

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
    $('#modifier-display-panel').remove();
    // 创建修饰符显示面板
    const panelHTML = `
      <div id="modifier-display-panel" class="modifier-display-panel" style="display: none;">
        <div class="modifier-panel-backdrop"></div>
        <section class="modifier-panel-shell" role="dialog" aria-modal="true" aria-labelledby="modifier-panel-title">
          <div class="modifier-panel-header">
            <div class="modifier-panel-heading">
              <span class="modifier-panel-emblem" aria-hidden="true">✦</span>
              <div>
                <small>实时结算预览</small>
                <h3 id="modifier-panel-title">战斗修饰</h3>
              </div>
            </div>
            <button id="modifier-panel-close" class="close-btn" type="button" aria-label="关闭">×</button>
          </div>
          <div class="modifier-panel-content">
            <div id="modifier-list" class="modifier-list"></div>
          </div>
        </section>
      </div>
    `;

    // 按钮改为由页面模板提供，仅附加面板
    $('body').append(panelHTML);
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
    $('.modifier-panel-backdrop').on('click', () => this.hideDisplay());

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

    const playerMetrics = player ? this.getModifierMetrics('player') : [];
    const enemyMetrics = enemy ? this.getModifierMetrics('enemy') : [];
    const attributes = [...new Set([...playerMetrics, ...enemyMetrics].map(metric => metric.attribute))];
    if (attributes.length === 0) {
      $('#modifier-list').html('<div class="no-modifiers modifier-empty"><span>✧</span><strong>当前没有数值修饰</strong><small>状态、能力与遗物产生的加算和倍率会显示在这里</small></div>');
      return;
    }

    const playerMap = new Map(playerMetrics.map(metric => [metric.attribute, metric]));
    const enemyMap = new Map(enemyMetrics.map(metric => [metric.attribute, metric]));
    const rows = attributes.map(attribute => {
      const playerMetric = playerMap.get(attribute);
      const enemyMetric = enemyMap.get(attribute);
      const reference = playerMetric || enemyMetric!;
      return `<div class="modifier-compare-row">
        <div class="modifier-compare-value modifier-compare-player">${this.renderMetricValues(playerMetric)}</div>
        <div class="modifier-compare-label"><span>${reference.icon}</span><strong>${escapeHtml(reference.label)}</strong></div>
        <div class="modifier-compare-value modifier-compare-enemy">${this.renderMetricValues(enemyMetric)}</div>
      </div>`;
    }).join('');

    $('#modifier-list').html(`<div class="modifier-compare">
      <div class="modifier-compare-head">
        <div><span>${escapeHtml(player?.emoji || '✨')}</span><strong>我方</strong></div>
        <small>加算 / 倍率</small>
        <div><strong>敌方</strong><span>${escapeHtml(enemy?.emoji || '👹')}</span></div>
      </div>
      <div class="modifier-compare-rows">${rows}</div>
      <footer><span><i class="modifier-legend-add"></i>加算会直接增加或减少数值</span><span><i class="modifier-legend-mul"></i>倍率在加算后生效</span></footer>
    </div>`);
  }

  private renderMetricValues(metric: ReturnType<ModifierDisplay['getModifierMetrics']>[number] | undefined): string {
    if (!metric) return '<span class="modifier-none">—</span>';
    return [
      metric.add !== 0
        ? `<span class="modifier-chip modifier-add"><small>加</small>${this.formatModifierValue(metric.add)}</span>`
        : '',
      metric.mul !== 1
        ? `<span class="modifier-chip modifier-mul"><small>倍</small>${this.formatModifierValue(metric.mul, true)}</span>`
        : '',
    ].filter(Boolean).join('');
  }

  /**
   * 获取实体的所有修饰符
   */
  private getAllEntityModifiers(target: 'player' | 'enemy'): { [key: string]: number } {
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
      const detail = this.effectExecutor.analyzeModifierFromStatusEffects(target, modifierType);
      modifiers[`${modifierType}__add`] = detail.add;
      modifiers[`${modifierType}__mul`] = detail.mul !== 1 ? detail.mul : 0;
    }

    return modifiers;
  }

  private getModifierMetrics(target: 'player' | 'enemy'): Array<{
    attribute: string;
    label: string;
    icon: string;
    add: number;
    mul: number;
  }> {
    const icons: Record<string, string> = {
      damage_modifier: '⚔️', damage_taken_modifier: '💥', lust_damage_modifier: '💗',
      lust_damage_taken_modifier: '💞', block_modifier: '🛡️', heal_modifier: '💚',
      draw: '🃏', discard: '🗑️', energy_gain: '⚡', card_play_limit: '✋',
    };
    const flat = this.getAllEntityModifiers(target);
    const attributes = new Set(Object.keys(flat).map(key => key.replace(/__(?:add|mul)$/, '')));
    return [...attributes]
      .map(attribute => ({
        attribute,
        label: getAttributeDefinition(attribute)?.displayName?.replace('修饰符', '') || attribute,
        icon: icons[attribute] || '✦',
        add: flat[`${attribute}__add`] || 0,
        mul: flat[`${attribute}__mul`] || 1,
      }))
      .filter(metric => metric.add !== 0 || metric.mul !== 1);
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
   * 公共方法：刷新显示
   */
  public refresh(): void {
    if (this.isVisible) {
      this.updateModifierList();
    }
  }
}
