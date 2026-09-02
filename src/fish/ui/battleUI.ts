/**
 * 战斗UI管理模块
 */

import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { CardSystem } from '../combat/cardSystem';
import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';
import { GameStateManager } from '../core/gameStateManager';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import {
  describeCardCost,
  normalizeCardCost,
  resourcePoolFromCombatant,
  roundBattleDisplayValue,
  type Card,
  type CardResourcePayment,
} from '../../game-core';
import { CardPlayMode } from './cardPlayMode';
import { EnemyIntentPresenter } from './enemyIntentPresenter';
import { PileStatsDisplay } from './pileViewer';
import { EffectProgramDisplay } from './effectProgramDisplay';

export class BattleUI {
  private static effectDisplay = EffectProgramDisplay.getInstance();
  private static activeCardTooltip: JQuery | null = null;
  private static activeCardTooltipAnchor: JQuery | null = null;
  private static handResizeBound = false;
  private static handResizeFrame: number | null = null;

  private static displayBattleValue(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? roundBattleDisplayValue(value) : fallback;
  }

  private static renderCardCost(
    cost: Card['cost'],
    player: ReturnType<GameStateManager['getPlayer']>,
    payment?: CardResourcePayment,
  ): string {
    const components = normalizeCardCost(cost);
    if (Object.keys(components).length <= 1 && typeof cost === 'number' && (!payment || payment.waived.length === 0))
      return escapeHtml(String(cost));
    const pool = resourcePoolFromCombatant(player.energy || 0, player.resources);
    return Object.entries(components)
      .map(([id, amount]) => {
        const definition = player.resources?.[id];
        const emoji = id === 'energy' ? '💎' : definition?.emoji || '◆';
        const name = id === 'energy' ? '能量' : definition?.name || id;
        const waived = payment?.waived.includes(id) === true;
        const required = waived || amount === 'all' ? 0 : amount;
        const insufficient = required > (pool[id] || 0);
        return `<span class="card-cost-component${insufficient ? ' insufficient' : ''}${waived ? ' waived' : ''}" data-resource-id="${escapeHtmlAttribute(id)}" title="${escapeHtmlAttribute(`${name} ${pool[id] || 0}${definition ? `/${definition.max}` : ''}${waived ? '（本次免除）' : ''}`)}">${escapeHtml(waived ? '免' : amount === 'all' ? 'X' : String(amount))}${escapeHtml(emoji)}</span>`;
      })
      .join('');
  }
  /**
   * 翻译卡牌类型
   */
  static translateCardType(type: string): string {
    const typeTranslations: { [key: string]: string } = {
      Attack: '攻击',
      Skill: '技能',
      Power: '能力',
      Event: '事件',
      Curse: '诅咒',
    };
    return typeTranslations[type] || type;
  }

  /**
   * 翻译稀有度
   */
  static translateRarity(rarity: string): string {
    const rarityTranslations: { [key: string]: string } = {
      Common: '普通',
      Uncommon: '罕见',
      Rare: '稀有',
      Epic: '史诗',
      Legendary: '传说',
      Corrupt: '腐化',
    };
    return rarityTranslations[rarity] || rarity;
  }

  /**
   * 刷新战斗UI
   */
  static async refreshBattleUI(gameState: any): Promise<void> {
    try {
      // 刷新战斗UI - 移除日志减少输出

      if (!gameState) {
        console.error('无法获取游戏状态');
        return;
      }

      const enemies = Array.isArray(gameState.enemies) && gameState.enemies.length > 0
        ? gameState.enemies
        : gameState.enemy
          ? [gameState.enemy]
          : [];
      const enemy = enemies.find((entry: any) => entry.id === gameState.activeEnemyId && entry.currentHp > 0)
        || enemies.find((entry: any) => entry.currentHp > 0)
        || null;
      const player = gameState.player;

      this.updateEnemyRoster(enemies, enemy?.id || null);
      this.updateSummonDisplays(gameState.summons);

      // 更新敌人信息
      if (enemy) {
        this.updateEnemyDisplay(enemy);
        EnemyIntentPresenter.getInstance().render(enemy);
        this.bindEnemyIntentDetails(enemy);
      }

      // 更新玩家信息
      if (player) {
        this.updatePlayerDisplay(player);
      }

      // 更新其他UI元素
      this.updateOtherElements(gameState);

      // 更新手牌显示
      if (gameState.player && gameState.player.hand) {
        this.updateHandCardsDisplay(gameState.player.hand);
      }

      // 更新牌堆统计
      if (gameState.player) {
        const drawCount = gameState.player.drawPile?.length || 0;
        const discardCount = gameState.player.discardPile?.length || 0;
        const exhaustCount = gameState.player.exhaustPile?.length || 0;
        const deckCount = gameState.player.deck?.length || 0;
        PileStatsDisplay.updatePileStats(drawCount, discardCount, exhaustCount, deckCount);
      }
      this.updateDeckCounts(gameState);

      // 更新能力显示
      this.updateAbilitiesDisplay(gameState.player.abilities || [], enemy?.abilities || []);
    } catch (error) {
      console.error('❌ 刷新战斗UI失败:', error);
    }
  }

  /**
   * 更新敌人显示
   */
  private static updateEnemyDisplay(enemy: any): void {
    $('#enemy-name').text(enemy.name || '未知敌人');
    $('.enemy-emoji').text(enemy.emoji || '👹');
    $('#stage-enemy-emoji').text(enemy.emoji || '👹');

    // 更新敌人血条
    const enemyHpPercent = enemy.maxHp > 0 ? (enemy.currentHp / enemy.maxHp) * 100 : 0;
    $('.enemy-card .hp-fill').css('width', `${enemyHpPercent}%`);
    $('#enemy-hp').text(`${this.displayBattleValue(enemy.currentHp)}/${this.displayBattleValue(enemy.maxHp, 1)}`);

    // 更新敌人欲望条
    const enemyLustPercent = enemy.maxLust > 0 ? (enemy.currentLust / enemy.maxLust) * 100 : 0;

    // 使用新的统一选择器
    $('.enemy-card .lust-fill').css('width', `${enemyLustPercent}%`);
    $('#enemy-lust').text(`${this.displayBattleValue(enemy.currentLust)}/${this.displayBattleValue(enemy.maxLust, 1)}`);

    // 更新敌人格挡 - 条件显示
    const enemyBlockValue = this.displayBattleValue(enemy.block);
    $('#enemy-block').text(enemyBlockValue);

    // 格挡为0时隐藏，大于0时显示
    const enemyBlockContainer = $('#enemy-block-container');
    if (enemyBlockValue > 0) {
      enemyBlockContainer.show();
    } else {
      enemyBlockContainer.hide();
    }
    const resources = Object.values(enemy.resources || {}) as Array<{ id: string; name: string; emoji: string; current: number; max: number }>;
    $('#enemy-combat-resources').html(resources.map(resource => `
      <span class="combat-resource-chip" data-resource-id="${escapeHtmlAttribute(resource.id)}" title="${escapeHtmlAttribute(resource.name)}">
        <span>${escapeHtml(resource.emoji)}</span><span>${escapeHtml(resource.name)}</span>
        <b>${this.displayBattleValue(resource.current)}/${this.displayBattleValue(resource.max)}</b>
      </span>
    `).join('')).toggle(resources.length > 0);

    // 更新敌人状态效果
    this.updateStatusEffects('enemy', enemy.statusEffects || []);
    this.updateSpecialContainers('enemy', enemy.stance, enemy.orbs);

    // 更新敌人欲望效果显示
    this.updateLustEffectDisplay('enemy', enemy.lustEffect);
  }

  private static updateEnemyRoster(enemies: any[], activeEnemyId: string | null): void {
    const living = enemies.filter(enemy => enemy && enemy.currentHp > 0);
    const multi = living.length > 1;
    $('.battle-main-grid').toggleClass('multi-enemy-battle', multi);
    $('.enemy-section').toggleClass('is-multi-enemy', multi);
    this.updateEnemyStageParty(living, activeEnemyId);
    const roster = $('#enemy-roster');
    if (!multi) {
      roster.empty().hide();
      return;
    }
    roster
      .html(living.map(enemy => {
        const hp = this.displayBattleValue(enemy.currentHp);
        const maxHp = this.displayBattleValue(enemy.maxHp, 1);
        const lust = this.displayBattleValue(enemy.currentLust);
        const maxLust = this.displayBattleValue(enemy.maxLust, 1);
        const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
        const lustPercent = maxLust > 0 ? Math.max(0, Math.min(100, (lust / maxLust) * 100)) : 0;
        const intentModel = EnemyIntentPresenter.getInstance().createDisplayModel(enemy);
        const intentBadges = intentModel.badges.map(badge => `<span class="enemy-roster-intent-badge" title="${escapeHtmlAttribute(badge.label)}"><i>${escapeHtml(badge.icon)}</i>${badge.value ? `<b>${escapeHtml(badge.value)}</b>` : ''}</span>`).join('');
        const support = [
          ...(Array.isArray(enemy.statusEffects) ? enemy.statusEffects : []).map((status: any) => ({ emoji: status.emoji || '◈', title: `${status.name || status.id}${Number(status.stacks) > 1 ? ` ${this.displayBattleValue(status.stacks)}层` : ''}` })),
          ...(Array.isArray(enemy.abilities) ? enemy.abilities : []).map((ability: any) => ({ emoji: ability.emoji || '⚡', title: `能力：${ability.name || ability.id}` })),
          ...(enemy.lustEffect ? [{ emoji: enemy.lustEffect.emoji || '💗', title: `欲望效果：${enemy.lustEffect.name || '未命名'}` }] : []),
        ];
        const supportHtml = support.map(entry => `<span class="enemy-roster-support" title="${escapeHtmlAttribute(entry.title)}">${escapeHtml(entry.emoji)}</span>`).join('');
        return `<button class="enemy-roster-unit${enemy.id === activeEnemyId ? ' is-active' : ''}" data-enemy-id="${escapeHtmlAttribute(String(enemy.id))}" type="button" aria-pressed="${enemy.id === activeEnemyId ? 'true' : 'false'}" title="${escapeHtmlAttribute(intentModel.description)}">
          <span class="enemy-roster-emoji">${escapeHtml(String(enemy.emoji || '👹'))}</span>
          <span class="enemy-roster-copy">
            <span class="enemy-roster-heading"><b>${escapeHtml(String(enemy.name || enemy.id))}</b>${Number(enemy.block) > 0 ? `<em>🛡${this.displayBattleValue(enemy.block)}</em>` : ''}</span>
            <span class="enemy-roster-bars">
              <span class="enemy-roster-bar hp"><i style="width:${hpPercent}%"></i><b>${hp}/${maxHp}</b></span>
              <span class="enemy-roster-bar lust"><i style="width:${lustPercent}%"></i><b>${lust}/${maxLust}</b></span>
            </span>
            <span class="enemy-roster-action"><strong>${escapeHtml(intentModel.description)}</strong><span>${intentBadges}</span></span>
            ${supportHtml ? `<span class="enemy-roster-supports">${supportHtml}</span>` : ''}
          </span>
        </button>`;
      }).join(''))
      .show();
    roster.off('click.mwg-enemy-target').on('click.mwg-enemy-target', '.enemy-roster-unit', event => {
      const enemyId = String($(event.currentTarget).attr('data-enemy-id') || '');
      if (!enemyId || !GameStateManager.getInstance().setActiveEnemy(enemyId)) return;
      void this.refreshBattleUI(GameStateManager.getInstance().getGameState());
    });
  }

  private static updateEnemyStageParty(enemies: any[], activeEnemyId: string | null): void {
    const party = $('#stage-enemy-party');
    const stage = $('#stage-enemy');
    if (!party.length) return;
    const multi = enemies.length > 1;
    stage.toggleClass('has-enemy-party', multi);
    party.attr('data-enemy-count', String(enemies.length));
    // Keep the authored queue order stable. Selecting a target may update the
    // detailed HUD, but the other actors must not jump around on the stage.
    const ordered = [...enemies];
    party.html(ordered.map((enemy, index) => {
      const active = enemy.id === activeEnemyId || (!activeEnemyId && index === ordered.length - 1);
      const intent = EnemyIntentPresenter.getInstance().createDisplayModel(enemy);
      const badges = intent.badges.map(badge => `${escapeHtml(badge.icon)}${badge.value ? `<b>${escapeHtml(badge.value)}</b>` : ''}`).join('');
      return `<button class="stage-enemy-member${active ? ' is-active' : ''}" type="button" data-enemy-id="${escapeHtmlAttribute(String(enemy.id))}" aria-pressed="${active ? 'true' : 'false'}" aria-label="选择目标：${escapeHtmlAttribute(String(enemy.name || enemy.id))}，下一步${escapeHtmlAttribute(intent.description)}" style="--party-order:${index};--party-depth:${ordered.length - index}">
        <span class="stage-enemy-member-intent" title="${escapeHtmlAttribute(intent.description)}">${badges || '❓'}</span>
        <span class="stage-emoji"${active ? ' id="stage-enemy-emoji"' : ''}>${escapeHtml(String(enemy.emoji || '👹'))}</span>
      </button>`;
    }).join(''));
    party.off('click.mwg-stage-enemy').on('click.mwg-stage-enemy', '.stage-enemy-member', event => {
      const enemyId = String($(event.currentTarget).attr('data-enemy-id') || '');
      if (!enemyId || !GameStateManager.getInstance().setActiveEnemy(enemyId)) return;
      void this.refreshBattleUI(GameStateManager.getInstance().getGameState());
    });
  }

  private static updateSummonDisplays(collection: any): void {
    const living = Array.isArray(collection?.living) ? collection.living : [];
    for (const owner of ['player', 'enemy'] as const) {
      const units = living.filter((unit: any) => unit?.owner === owner && (unit.hasHp === false || Number(unit.currentHp) > 0));
      const container = $(`#${owner}-summons`);
      if (!container.length) continue;
      container.html(units.map((unit: any, index: number) => {
        const hp = unit.hasHp === false ? '' : this.displayBattleValue(unit.currentHp);
        const maxHp = unit.hasHp === false ? '' : this.displayBattleValue(unit.maxHp, 1);
        const title = `${unit.name || unit.templateId} · ${unit.hasHp === false ? '无生命，不承受攻击' : `生命 ${hp}/${maxHp}${Number(unit.block) > 0 ? ` · 格挡 ${this.displayBattleValue(unit.block)}` : ''}`}`;
        let ring = 0;
        let ringIndex = index;
        let ringCapacity = 8;
        while (ringIndex >= ringCapacity) {
          ringIndex -= ringCapacity;
          ring += 1;
          ringCapacity = 8 + ring * 4;
        }
        const ringStart = index - ringIndex;
        const ringItemCount = Math.max(1, Math.min(ringCapacity, units.length - ringStart));
        const angle = -90 + (360 * ringIndex) / ringItemCount;
        const xRadius = 35 + ring * 19;
        const yRadius = 27 + ring * 15;
        const x = Math.round(Math.cos((angle * Math.PI) / 180) * xRadius);
        const y = Math.round(Math.sin((angle * Math.PI) / 180) * yRadius);
        return `<button type="button" class="stage-summon-unit" data-summon-index="${index}" data-summon-id="${escapeHtmlAttribute(String(unit.instanceId || ''))}"
          style="--summon-x:${x}px;--summon-y:${y}px;--summon-order:${index}"
          aria-label="查看召唤单位：${escapeHtmlAttribute(title)}" title="${escapeHtmlAttribute(title)}">
          <span class="stage-summon-emoji" aria-hidden="true">${escapeHtml(String(unit.emoji || '◆'))}</span>
        </button>`;
      }).join('')).toggle(units.length > 0);
      container.find('.stage-summon-unit').each((index, element) => {
        $(element).data('summon', units[index]);
      });
      container.off('click.mwgSummon').on('click.mwgSummon', '.stage-summon-unit', function (event) {
        event.preventDefault();
        event.stopPropagation();
        BattleUI.showSummonDetails($(this), $(this).data('summon'));
      });
    }
  }

  private static showSummonDetails(anchor: JQuery, unit: any): void {
    $('.support-details-popover').remove();
    if (!unit) return;
    const context = unit.owner === 'enemy'
      ? { selfLabel: '敌方', opponentLabel: '我方' }
      : { selfLabel: '我方', opponentLabel: '敌方' };
    const actions = Array.isArray(unit.actions) && unit.actions.length
      ? unit.actions
      : unit.actionProgram
        ? [{ id: `${unit.templateId || unit.id}_action`, name: '自动行动', emoji: unit.emoji, effectProgram: unit.actionProgram }]
        : [];
    const abilities = Array.isArray(unit.abilities) ? unit.abilities : [];
    const resources = Object.values(unit.resources || {}) as Array<{ name?: string; emoji?: string; current?: number; max?: number }>;
    const statuses = Array.isArray(unit.statusEffects) ? unit.statusEffects : [];
    const details = [
      `<div class="summon-detail-stats">${unit.hasHp === false ? '<span>无生命 · 不承受攻击与援护</span>' : `<span>生命 ${escapeHtml(this.displayBattleValue(unit.currentHp))}/${escapeHtml(this.displayBattleValue(unit.maxHp, 1))}</span>${Number(unit.block) > 0 ? `<span>格挡 ${escapeHtml(this.displayBattleValue(unit.block))}</span>` : ''}`}<span>每次行动 ${escapeHtml(this.displayBattleValue(unit.actionsPerActivation, 1))} 次</span></div>`,
      resources.length ? `<div class="summon-detail-resources">${resources.map(resource => `<span>${escapeHtml(String(resource.emoji || '◆'))}${escapeHtml(String(resource.name || '资源'))} ${escapeHtml(this.displayBattleValue(resource.current))}/${escapeHtml(this.displayBattleValue(resource.max))}</span>`).join('')}</div>` : '',
      statuses.length ? `<div class="summon-detail-statuses">${statuses.map((status: any) => `<span>${escapeHtml(String(status.emoji || '◆'))}${escapeHtml(String(status.name || status.id))} ${escapeHtml(this.displayBattleValue(status.stacks, 1))}层</span>`).join('')}</div>` : '',
    ].join('');
    const actionDetails = actions.map((action: any) => {
      const tags = this.effectDisplay.programToTags(action.effectProgram, context);
      return `<section class="summon-detail-program"><div class="summon-detail-program-title"><span>${escapeHtml(String(action.emoji || unit.emoji || '◆'))}</span><strong>${escapeHtml(String(action.name || action.id || '行动'))}</strong>${action.fixed === true ? '<small class="summon-fixed-effect">固定效果</small>' : ''}${Number(action.weight) > 0 ? `<small>权重 ${escapeHtml(this.displayBattleValue(action.weight, 1))}</small>` : ''}</div>${action.description ? `<p>${escapeHtml(String(action.description))}</p>` : ''}${tags.length ? this.effectDisplay.createWrappedEffectTagsHTML(tags) : '<div class="status-no-effect">没有可执行效果。</div>'}</section>`;
    }).join('');
    const abilityDetails = abilities.map((ability: any) => {
      const tags = this.effectDisplay.triggeredProgramToTags(ability.trigger, ability.effectProgram, context);
      return `<section class="summon-detail-program summon-detail-ability"><div class="summon-detail-program-title"><span>${escapeHtml(String(ability.emoji || '⚡'))}</span><strong>${escapeHtml(String(ability.name || ability.id || '触发能力'))}</strong>${ability.fixed === true ? '<small class="summon-fixed-effect">固定效果</small>' : ''}</div>${ability.description ? `<p>${escapeHtml(String(ability.description))}</p>` : ''}${tags.length ? this.effectDisplay.createWrappedEffectTagsHTML(tags) : '<div class="status-no-effect">没有可执行效果。</div>'}</section>`;
    }).join('');
    const popover = $(`
      <div class="support-details-popover summon-details-popover" role="dialog" aria-label="${escapeHtmlAttribute(String(unit.name || '召唤单位'))}">
        <div class="support-details-heading"><span>${escapeHtml(String(unit.emoji || '◆'))}</span><strong>${escapeHtml(String(unit.name || unit.templateId || '召唤单位'))}</strong><small>${unit.owner === 'enemy' ? '敌方召唤单位' : '我方召唤单位'}</small></div>
        ${unit.description ? `<div class="support-details-description">${escapeHtml(String(unit.description))}</div>` : ''}
        ${details}
        <div class="support-details-effects">${actionDetails || '<div class="status-no-effect">该单位没有自动行动。</div>'}${abilityDetails}</div>
      </div>`);
    $('body').append(popover);
    const width = Math.min(430, ($(window).width() || 446) - 16);
    popover.css({ width });
    const offset = anchor.offset();
    const height = popover.outerHeight() || 180;
    const viewportWidth = $(window).width() || width;
    const viewportHeight = $(window).height() || height;
    const left = offset
      ? Math.max(8, Math.min(offset.left + (anchor.outerWidth() || 0) / 2 - width / 2, viewportWidth - width - 8))
      : Math.max(8, (viewportWidth - width) / 2);
    const preferredTop = offset ? offset.top + (anchor.outerHeight() || 0) + 6 : (viewportHeight - height) / 2;
    popover.css({ left, top: Math.max(8, Math.min(preferredTop, viewportHeight - height - 8)) });
    $(document).off('click.mwgSummonPopover').on('click.mwgSummonPopover', () => {
      popover.remove();
      $(document).off('click.mwgSummonPopover');
    });
  }

  /**
   * 更新玩家显示
   */
  private static updatePlayerDisplay(player: any): void {
    const playerHp = this.displayBattleValue(player.currentHp);
    const playerMaxHp = this.displayBattleValue(player.maxHp, 100);
    const playerLust = this.displayBattleValue(player.currentLust);
    const playerMaxLust = this.displayBattleValue(player.maxLust, 100);
    const playerEnergy = this.displayBattleValue(player.energy);
    const playerBlock = this.displayBattleValue(player.block);
    const playerEmoji = typeof player.emoji === 'string' && player.emoji.trim() ? player.emoji.trim() : '✨';
    $('.player-emblem, #stage-player-emoji').text(playerEmoji);

    // 更新玩家血条
    const playerHpPercent = playerMaxHp > 0 ? (playerHp / playerMaxHp) * 100 : 0;
    $('.player-card .hp-fill').css('width', `${playerHpPercent}%`);
    $('#player-hp').text(`${playerHp}/${playerMaxHp}`);

    // 更新玩家欲望条
    const playerLustPercent = playerMaxLust > 0 ? (playerLust / playerMaxLust) * 100 : 0;

    // 使用新的统一选择器
    $('.player-card .lust-fill').css('width', `${playerLustPercent}%`);
    $('#player-lust').text(`${playerLust}/${playerMaxLust}`);

    // 更新能量显示
    $('#player-energy').text(`${playerEnergy}/${this.displayBattleValue(player.maxEnergy, 3)}`);
    const resources = Object.values(player.resources || {}) as Array<{ id: string; name: string; emoji: string; current: number; max: number }>;
    $('#player-combat-resources').html(resources.map(resource => `
      <span class="combat-resource-chip" data-resource-id="${escapeHtmlAttribute(resource.id)}" title="${escapeHtmlAttribute(resource.name)}">
        <span>${escapeHtml(resource.emoji)}</span><span>${escapeHtml(resource.name)}</span>
        <b>${this.displayBattleValue(resource.current)}/${this.displayBattleValue(resource.max)}</b>
      </span>
    `).join('')).toggle(resources.length > 0);

    // 更新格挡显示 - 条件显示
    $('#player-block').text(playerBlock);

    // 格挡为0时隐藏，大于0时显示
    const blockContainer = $('#block-stat-container');
    if (playerBlock > 0) {
      blockContainer.show();
    } else {
      blockContainer.hide();
    }

    // 更新遗物显示
    this.updateRelicsDisplay(player.relics || []);

    // 更新玩家状态效果
    this.updateStatusEffects('player', player.statusEffects || []);
    this.updateSpecialContainers('player', player.stance, player.orbs);

    // 更新玩家欲望效果显示（从GameStateManager获取）
    const gameStateManager = GameStateManager.getInstance();
    const playerLustEffect = (gameStateManager as any).gameState?.battle?.player_lust_effect;
    this.updateLustEffectDisplay('player', playerLustEffect);
  }

  /**
   * 更新其他UI元素
   */
  private static updateOtherElements(gameState: any): void {
    // 显示战斗场景
    $('#battle-scene').show();
    $('#setup-scene').hide();

    // 更新回合数
    $('#turn-number').text(gameState.currentTurn || 1);

    // 更新游戏阶段显示
    const phaseText = this.getPhaseText(gameState.phase);
    $('#phase-indicator').text(phaseText);

    const battleEnded = gameState.isGameOver === true || gameState.phase === 'game_over';
    const playerCanAct = gameState.phase === 'player_turn' && !battleEnded;
    $('.end-turn-button, #use-item-btn')
      .prop('disabled', !playerCanAct)
      .attr('aria-disabled', String(!playerCanAct));
    $('#hand-cards').toggleClass('battle-ended', battleEnded);
  }

  /**
   * 获取阶段显示文本
   */
  private static getPhaseText(phase: string): string {
    switch (phase) {
      case 'setup':
        return '准备阶段';
      case 'player_turn':
        return '玩家回合';
      case 'enemy_turn':
        return '敌人回合';
      case 'game_over':
        return '游戏结束';
      default:
        return '未知阶段';
    }
  }

  /**
   * 更新手牌显示
   */
  static updateHandCardsDisplay(handCards: any[]): void {
    try {
      const handContainer = $('.player-hand');
      handContainer.empty();

      if (!handCards || !Array.isArray(handCards)) {
        return;
      }

      const validCards = handCards;

      // 开始创建手牌元素 - 移除日志减少输出

      validCards.forEach((card: any, index: number) => {
        if (card && card.name) {
          const cardElement = this.createEnhancedCardElement(card, index);
          handContainer.append(cardElement);
        }
      });

      this.layoutHandCards();
      this.bindHandResize();
    } catch (error) {
      console.error('❌ 更新手牌显示失败:', error);
    }
  }

  private static bindHandResize(): void {
    if (this.handResizeBound) return;
    this.handResizeBound = true;
    window.addEventListener('resize', () => {
      if (this.handResizeFrame !== null) cancelAnimationFrame(this.handResizeFrame);
      this.handResizeFrame = requestAnimationFrame(() => {
        this.handResizeFrame = null;
        this.layoutHandCards();
      });
    });
  }

  private static layoutHandCards(): void {
    try {
      const handContainer = $('.player-hand');
      const cards = handContainer.children('.enhanced-card, .card-drag-slot');
      const count = cards.length;
      const handContainerWidth = handContainer.width() || 0;
      const handContainerHeight = handContainer.height() || 180;
      const isFullscreen = document.documentElement.classList.contains('mwg-fullscreen-active');
      const isCompactHand = handContainerWidth > 0 && handContainerWidth <= 560;
      const maxCardWidth = isCompactHand ? (isFullscreen ? 104 : 92) : isFullscreen ? 150 : 116;
      const minCardWidth = isCompactHand ? 76 : 70;
      const cardGap = isCompactHand ? 4 : 8;
      const heightBound = Math.floor((handContainerHeight - 8) * 0.75);
      const widthBound =
        count > 0 && count <= 5
          ? Math.max(
              minCardWidth,
              Math.floor((handContainerWidth - 8 - cardGap * Math.max(0, count - 1)) / count),
            )
          : maxCardWidth;
      const cardWidth = Math.max(minCardWidth, Math.min(maxCardWidth, heightBound, widthBound));
      const normalOffset = cardWidth + cardGap;
      const fitOffset = count <= 1 ? 0 : (handContainerWidth - cardWidth - 8) / (count - 1);
      const offset = count <= 1 ? 0 : Math.max(isCompactHand ? 12 : 14, Math.min(normalOffset, fitOffset));
      const totalContentWidth = count === 0 ? 0 : cardWidth + (count - 1) * offset;
      const start = Math.max(4, (handContainerWidth - totalContentWidth) / 2);

      handContainer.attr('data-count', String(count));
      handContainer.css('--hand-card-width', `${cardWidth}px`);
      cards.each((index, element) => {
        $(element).css({ left: `${start + index * offset}px` });
      });
    } catch (error) {
      console.warn('手牌重叠布局计算失败:', error);
    }
  }

  /**
   * 创建增强的卡牌元素
   */
  private static createEnhancedCardElement(card: any, index: number): JQuery {
    // 创建卡牌元素 - 移除日志减少输出

    // 确保卡牌有必要的属性
    const cardData: Card = {
      id: card.id || card.originalId || `card_${index}`,
      name: card.name || '未知卡牌',
      cost: card.cost ?? 0,
      type: card.type || 'Skill',
      rarity: card.rarity || 'Common',
      emoji: card.emoji || '🃏',
      effectProgram: card.effectProgram,
      description: card.description || '',
      discardEffectProgram: card.discardEffectProgram,
      retain: card.retain || false,
      exhaust: card.exhaust || false,
      ethereal: card.ethereal || false,
      innate: card.innate || false,
    };

    // 不在卡面显示效果解析，仅在悬停工具提示中显示

    // 使用与真正出牌相同的动态费用、限制、免费窗口和资源检查。
    const gameState = GameStateManager.getInstance().getGameState();
    const player = gameState.player;
    const preview = CardSystem.getInstance().previewCardPlay(cardData.id);
    const previewCard = preview.ok
      ? preview.card
      : preview.effectiveCost === undefined
        ? cardData
        : { ...cardData, cost: preview.effectiveCost };
    const previewPayment = preview.payment;

    // 处理动态能量消耗
    let displayCost: string;
    let displayCostHtml: string;

    if (cardData.type === 'Curse') {
      displayCost = '—';
      displayCostHtml = '—';
    } else {
      displayCost = typeof previewCard.cost === 'number'
        ? String(previewCard.cost)
        : previewCard.cost === 'energy'
          ? 'X'
          : describeCardCost(previewCard.cost, player?.resources).replace(/能量/g, '').replace(/\s\+\s/g, '+');
      displayCostHtml = this.renderCardCost(previewCard.cost, player, previewPayment);
    }

    const shortage = !preview.ok && (preview.code === 'INSUFFICIENT_ENERGY' || preview.code === 'INSUFFICIENT_RESOURCE');
    const canAfford = !shortage;
    const isPlayerTurn = gameState.phase === 'player_turn';
    const isCurse = cardData.type === 'Curse';
    // 如果被眩晕，所有卡牌都不可点击
    const isClickable = isPlayerTurn && preview.ok && !isCurse;

    // 创建完整的卡牌元素
    const cardElement = $(`
      <div class="card enhanced-card rarity-${escapeHtmlAttribute(cardData.rarity)} card-type-${escapeHtmlAttribute(cardData.type)} ${
        isClickable ? 'clickable' : shortage ? 'unaffordable' : 'blocked'
      }"
           data-card-id="${escapeHtmlAttribute(cardData.id)}">
        <div class="card-header">
          <div class="card-cost ${typeof previewCard.cost === 'object' && previewCard.cost !== null || (previewPayment && previewPayment.waived.length > 0) ? 'composite-card-cost' : ''} ${canAfford ? '' : 'insufficient-cost'}" aria-label="${escapeHtmlAttribute(displayCost)}">${displayCostHtml}</div>
          <div class="card-rarity-badge"><span class="card-rarity-gem"></span>${escapeHtml(this.translateRarity(cardData.rarity))}</div>
        </div>
        <div class="card-artwork">
          <div class="card-emoji">${escapeHtml(cardData.emoji)}</div>
          <div class="card-keywords">
            ${cardData.innate ? '<div class="card-keyword innate">固有</div>' : ''}
            ${cardData.retain ? '<div class="card-keyword retain">保留</div>' : ''}
            ${cardData.exhaust ? '<div class="card-keyword exhaust">消耗</div>' : ''}
            ${cardData.ethereal ? '<div class="card-keyword ethereal">空灵</div>' : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="card-title-row">
            <div class="card-name">${escapeHtml(cardData.name)}</div>
            <div class="card-type-indicator">${escapeHtml(this.translateCardType(cardData.type))}</div>
          </div>
          ${cardData.description ? `<div class="card-description">${escapeHtml(cardData.description)}</div>` : ''}
        </div>
        <div class="card-glow"></div>
      </div>
    `);

    // 添加悬停效果
    cardElement
      .on('mouseenter', () => {
        // 检查是否刚结束拖动，如果是则不响应hover
        const playMode = CardPlayMode.getInstance();
        if ((playMode as any).justEndedDrag || cardElement.data('justEndedDrag')) {
          return;
        }
        // 再次确认没有dragging类
        if (cardElement.hasClass('dragging')) {
          return;
        }
        cardElement.addClass('card-hover');
        this.showCardTooltip(cardElement, cardData);
      })
      .on('mouseleave', () => {
        cardElement.removeClass('card-hover');
        this.hideCardTooltip();
      });

    // 保存原始点击处理器
    const originalClickHandler = () => {
      // 点击时也隐藏工具提示，防止工具提示卡住
      this.hideCardTooltip();
    };
    cardElement.data('originalClick', originalClickHandler);
    cardElement.on('click', originalClickHandler);

    // 存储cardData到元素，供CardPlayMode使用
    cardElement.data('cardData', cardData);

    // 绑定出牌模式事件（拖动、触摸等）
    const playMode = CardPlayMode.getInstance();
    playMode.bindCardEvents(cardElement);

    return cardElement;
  }

  /**
   * 显示卡牌工具提示
   */
  public static showCardTooltip(cardElement: JQuery, card: Card): void {
    // Hover and drag can request details in the same frame. Keep exactly one
    // tooltip instead of waiting for an older fade-out to finish.
    this.activeCardTooltip?.stop(true, true).remove();
    $('.card-tooltip').stop(true, true).remove();
    // 解析效果标签 - 工具提示内完整换行显示
    const effectTags = BattleUI.effectDisplay.programToTags(card.effectProgram);
    const wrappedEffectHTML = BattleUI.effectDisplay.createWrappedEffectTagsHTML(effectTags);

    const discardEffectTags = BattleUI.effectDisplay.programToTags(card.discardEffectProgram);
    const wrappedDiscardHTML = discardEffectTags.length
      ? BattleUI.effectDisplay.createWrappedEffectTagsHTML(discardEffectTags)
      : '';
    const wrappedAttachmentHTML = BattleUI.effectDisplay.createWrappedEffectTagsHTML(
      BattleUI.effectDisplay.attachmentToTags(card.attachments),
    );

    const tooltip = $(`
      <div class="card-tooltip" id="mwg-active-card-tooltip">
        <div class="tooltip-header">${escapeHtml(card.name)}</div>
        <div class="tooltip-meta">
          <span class="tooltip-cost">${escapeHtml(describeCardCost(card.cost, GameStateManager.getInstance().getPlayer().resources))}</span>
          <span class="tooltip-type">${escapeHtml(this.translateCardType(card.type))}</span>
          <span class="tooltip-rarity">${escapeHtml(this.translateRarity(card.rarity))}</span>
        </div>
        ${wrappedEffectHTML ? `<div class="tooltip-effects">${wrappedEffectHTML}</div>` : ''}
        ${wrappedDiscardHTML ? `<div class="tooltip-effects"><div class="tooltip-subtitle">此牌被战斗效果弃掉后：</div>${wrappedDiscardHTML}</div>` : ''}
        ${wrappedAttachmentHTML ? `<div class="tooltip-effects"><div class="tooltip-subtitle">卡牌附着：</div>${wrappedAttachmentHTML}</div>` : ''}
        ${card.description ? `<div class="tooltip-description">${escapeHtml(card.description)}</div>` : ''}
        ${
          card.innate || card.retain || card.exhaust || card.ethereal
            ? `
          <div class="tooltip-keywords">
            ${card.innate ? '<span class="keyword">固有</span>' : ''}
            ${card.retain ? '<span class="keyword">保留</span>' : ''}
            ${card.exhaust ? '<span class="keyword">消耗</span>' : ''}
            ${card.ethereal ? '<span class="keyword">空灵</span>' : ''}
          </div>
        `
            : ''
        }
      </div>
    `);

    $('body').append(tooltip);
    this.activeCardTooltip = tooltip;
    this.activeCardTooltipAnchor = cardElement;
    this.repositionCardTooltip(cardElement);

    tooltip.fadeIn(200);
    requestAnimationFrame(() => {
      $('.card-tooltip').not(tooltip).stop(true, true).remove();
    });
  }

  /** Keep the details visually attached to the actual card or drag ghost. */
  public static repositionCardTooltip(cardElement?: JQuery): void {
    const tooltip = this.activeCardTooltip;
    const anchor = cardElement || this.activeCardTooltipAnchor;
    const element = anchor?.get(0) as HTMLElement | undefined;
    if (!tooltip?.length || !element?.isConnected) return;
    this.activeCardTooltipAnchor = anchor || null;
    const rect = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableWidth = Math.max(220, viewportWidth - 16);
    const contentLength = tooltip.text().replace(/\s+/g, '').length;
    const width = Math.min(availableWidth, Math.max(Math.min(280, availableWidth), 286 + Math.min(240, contentLength * 1.35)));
    tooltip.css({
      position: 'fixed',
      width,
      minWidth: Math.min(280, availableWidth),
      maxWidth: availableWidth,
      maxHeight: 'none',
      overflow: 'visible',
      visibility: 'hidden',
      display: 'block',
      zIndex: 5000,
    });
    const height = tooltip.outerHeight() || 220;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - 8));
    const top =
      rect.top >= height + 10
        ? rect.top - height - 8
        : Math.max(8, Math.min(rect.bottom + 8, viewportHeight - height - 8));
    const isAbove = top < rect.top;
    const arrowLeft = Math.max(14, Math.min(rect.left + rect.width / 2 - left, width - 14));
    tooltip
      .toggleClass('is-above', isAbove)
      .toggleClass('is-below', !isAbove)
      .addClass('is-card-attached')
      .css({
        left,
        top,
        maxHeight: 'none',
        visibility: 'visible',
        '--tooltip-arrow-left': `${arrowLeft}px`,
      });
  }

  /**
   * 隐藏卡牌工具提示
   */
  private static hideCardTooltip(): void {
    this.activeCardTooltip = null;
    this.activeCardTooltipAnchor = null;
    $('.card-tooltip').stop(true, true).remove();
  }

  /**
   * 更新牌堆计数
   */
  static updateDeckCounts(gameState: any): void {
    if (!gameState?.player) {
      console.warn('⚠️ updateDeckCounts: 没有找到玩家数据');
      return;
    }

    const player = gameState.player;

    $('#deck-pile-count').text(player.deck?.length || 0);

    // 更新抽牌堆计数
    const drawPileCount = player.drawPile?.length || 0;
    $('#draw-pile-count').text(drawPileCount);

    // 更新弃牌堆计数
    const discardPileCount = player.discardPile?.length || 0;
    $('#discard-pile-count').text(discardPileCount);

    // 更新消耗堆计数
    const exhaustPileCount = player.exhaustPile?.length || 0;
    $('#exhaust-pile-count').text(exhaustPileCount);
  }

  /**
   * 更新遗物显示
   */
  private static updateRelicsDisplay(relics: any[]): void {
    // 使用HTML中已存在的遗物区域
    const relicsContainer = $('.relic-grid');
    if (relicsContainer.length === 0) {
      console.warn('遗物容器不存在');
      return;
    }

    if (!relics || relics.length === 0) {
      relicsContainer.empty();
      return;
    }

    const relicsHTML = relics
      .map((relic, index) => {
        return `
        <div class="relic-container"
             data-relic-id="${escapeHtmlAttribute(relic.id)}"
             data-relic-name="${escapeHtmlAttribute(relic.name || '未知遗物')}"
             data-relic-description="${escapeHtmlAttribute(relic.description || '无描述')}"
             data-relic-index="${index}">
          <button type="button" class="relic-toggle support-icon-button"
                  aria-label="查看遗物：${escapeHtmlAttribute(relic.name || '未知遗物')}"
                  title="${escapeHtmlAttribute(relic.name || '未知遗物')}">
            <span aria-hidden="true">${escapeHtml(relic.emoji || '📿')}</span>
          </button>
        </div>
      `;
      })
      .join('');

    relicsContainer.html(relicsHTML);

    // 绑定点击事件
    relicsContainer.find('.relic-toggle').on('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const container = $(this).closest('.relic-container');
      const relic = relics[Number(container.data('relic-index'))];
      BattleUI.showSupportDetails($(this), relic, '遗物');
    });
  }

  /**
   * 更新状态效果显示
   */
  private static updateStatusEffects(target: 'player' | 'enemy', statusEffects: any[]): void {
    const selector = target === 'player' ? '#player-status-effects' : '#enemy-status-effects';
    const container = $(selector);

    if (container.length === 0) {
      console.warn(`状态效果容器不存在: ${selector}`);
      return;
    }

    const statusHTML = statusEffects
      .map(status => {
        // 获取状态定义
        const statusDef = DynamicStatusManager.getInstance().getStatusDefinition(status.id);
        const emoji = statusDef?.emoji || '⚡';
        const name = statusDef?.name || status.name || status.id;
        const stacks = status.stacks || 1;
        const duration = status.duration;

        const title = `${name}${stacks > 0 ? ` · ${stacks}层` : ''}${duration && duration > 0 ? ` · ${duration}回合` : ''}`;

        return `
          <button type="button" class="status-effect-item support-icon-button clickable"
               data-status-id="${escapeHtmlAttribute(status.id)}"
               data-target="${target}"
               aria-label="查看状态：${escapeHtmlAttribute(title)}"
               title="${escapeHtmlAttribute(title)}">
            <span class="status-effect-emoji" aria-hidden="true">${escapeHtml(emoji)}</span>
            ${stacks > 1 ? `<span class="status-stack-badge">${escapeHtml(stacks)}</span>` : ''}
            ${duration && duration > 0 ? `<span class="status-duration-badge">${escapeHtml(duration)}</span>` : ''}
          </button>
        `;
      })
      .join('');

    container.html(statusHTML);

    // 绑定点击事件
    container
      .find('.status-effect-item')
      .off('click')
      .on('click', function () {
        const statusId = $(this).data('status-id');
        const target = $(this).data('target');
        const status = statusEffects.find(s => s.id === statusId);
        if (status) {
          BattleUI.showStatusDetail(statusId, target);
        }
      });
  }

  private static updateSpecialContainers(target: 'player' | 'enemy', stance: any, orbContainer: any): void {
    const container = $(`#${target}-special-containers`);
    if (!container.length) return;
    const orbs = Array.isArray(orbContainer?.orbs) ? orbContainer.orbs : [];
    const slots = Number.isInteger(orbContainer?.slots) ? Math.max(0, orbContainer.slots) : 0;
    const stanceHtml = stance?.name
      ? `<button type="button" class="special-container-toggle stance-toggle" data-special-kind="stance"
          aria-label="查看姿态：${escapeHtmlAttribute(String(stance.name))}" title="姿态：${escapeHtmlAttribute(String(stance.name))}">
          <span aria-hidden="true">${escapeHtml(String(stance.emoji || '◈'))}</span><b>${escapeHtml(String(stance.name))}</b>
        </button>`
      : '';
    const orbHtml = slots > 0
      ? `<div class="orb-strip" aria-label="Orb ${orbs.length}/${slots}">
          <span class="orb-count">Orb ${orbs.length}/${slots}</span>
          ${orbs.map((orb: any, index: number) => `
            <button type="button" class="special-container-toggle orb-toggle" data-special-kind="orb" data-orb-index="${index}"
              aria-label="查看 Orb：${escapeHtmlAttribute(String(orb.name || orb.id || index))}，数值 ${escapeHtml(this.displayBattleValue(orb.value))}"
              title="${escapeHtmlAttribute(String(orb.name || orb.id || 'Orb'))} · ${escapeHtmlAttribute(String(this.displayBattleValue(orb.value)))}">
              <span aria-hidden="true">${escapeHtml(String(orb.emoji || '◆'))}</span><b>${escapeHtml(this.displayBattleValue(orb.value))}</b>
            </button>`).join('')}
        </div>`
      : '';
    container.html(`${stanceHtml}${orbHtml}`).toggle(Boolean(stanceHtml || orbHtml));
    container.find('.stance-toggle').data('special-value', stance);
    container.find('.orb-toggle').each((index, element) => {
      $(element).data('special-value', orbs[index]);
    });
    container
      .find('.special-container-toggle')
      .off('click.mwgSpecialContainer')
      .on('click.mwgSpecialContainer', function (event) {
        event.preventDefault();
        event.stopPropagation();
        BattleUI.showSpecialContainerDetails(
          $(this),
          $(this).data('special-value'),
          String($(this).data('special-kind')) === 'orb' ? 'orb' : 'stance',
          target,
        );
      });
  }

  private static showSpecialContainerDetails(
    anchor: JQuery,
    value: any,
    kind: 'stance' | 'orb',
    target: 'player' | 'enemy',
  ): void {
    $('.support-details-popover').remove();
    if (!value) return;
    const context = target === 'enemy'
      ? { selfLabel: '敌方', opponentLabel: '我方' }
      : { selfLabel: '自身', opponentLabel: '敌方' };
    const groups = kind === 'stance'
      ? [
          ['进入时', value.enterEffects],
          ['持续生效', value.passiveEffects],
          ['退出时', value.exitEffects],
        ] as const
      : [
          ['回合被动', value.passiveEffects],
          ['激发时', value.evokeEffects],
        ] as const;
    const groupHtml = groups
      .filter(([, effects]) => Array.isArray(effects) && effects.length > 0)
      .map(([label, effects]) => {
        const tags = this.effectDisplay.programToTags({ spec: 'mwg.effect/v1', steps: effects }, context);
        return `<section class="special-details-group"><strong>${escapeHtml(label)}</strong>${this.effectDisplay.createWrappedEffectTagsHTML(tags)}</section>`;
      })
      .join('');
    const sourceName = typeof value.source?.name === 'string' ? value.source.name : '';
    const popover = $(`
      <div class="support-details-popover special-container-popover" role="dialog" aria-label="${escapeHtmlAttribute(String(value.name || kind))}">
        <div class="support-details-heading">
          <span>${escapeHtml(String(value.emoji || (kind === 'stance' ? '◈' : '◆')))}</span>
          <strong>${escapeHtml(String(value.name || (kind === 'stance' ? '姿态' : 'Orb')))}</strong>
          <small>${kind === 'stance' ? '姿态' : `Orb · 数值 ${escapeHtml(this.displayBattleValue(value.value))}`}</small>
        </div>
        ${value.description ? `<div class="support-details-description">${escapeHtml(String(value.description))}</div>` : ''}
        ${sourceName ? `<div class="support-details-source">来源：${escapeHtml(sourceName)}</div>` : ''}
        <div class="support-details-effects">${groupHtml || '<div class="status-no-effect">没有额外效果。</div>'}</div>
      </div>
    `);
    $('body').append(popover);
    const offset = anchor.offset();
    const width = Math.min(430, ($(window).width() || 446) - 16);
    popover.css({ width });
    const height = popover.outerHeight() || 160;
    const viewportWidth = $(window).width() || width;
    const viewportHeight = $(window).height() || height;
    const left = offset
      ? Math.max(8, Math.min(offset.left + (anchor.outerWidth() || 0) / 2 - width / 2, viewportWidth - width - 8))
      : Math.max(8, (viewportWidth - width) / 2);
    const preferredTop = offset ? offset.top + (anchor.outerHeight() || 0) + 6 : (viewportHeight - height) / 2;
    popover.css({ left, top: Math.max(8, Math.min(preferredTop, viewportHeight - height - 8)) });
    $(document).off('click.mwgSpecialPopover').on('click.mwgSpecialPopover', () => {
      popover.remove();
      $(document).off('click.mwgSpecialPopover');
    });
  }

  /**
   * 计算状态效果的实际数值显示
   */
  private static calculateStatusEffectValue(_status: any, statusDef: any): string | null {
    for (const program of statusDef?.triggers?.hold || []) {
      for (const node of program.steps || []) {
        if (node.op !== 'modify' || typeof node.value !== 'number') continue;
        const prefixes = { add: '+', subtract: '-', multiply: '×', divide: '÷', set: '=' } as const;
        return ` ${prefixes[node.operator as keyof typeof prefixes]}${node.value}`;
      }
    }
    return null;
  }

  /**
   * 更新能力显示
   */
  private static updateAbilitiesDisplay(playerAbilities: any[], enemyAbilities: any[]): void {
    // 更新玩家能力
    const playerAbilitiesContainer = document.getElementById('player-abilities');
    if (playerAbilitiesContainer) {
      if (playerAbilities.length > 0) {
        playerAbilitiesContainer.innerHTML = playerAbilities.map(ability => this.createAbilityHTML(ability)).join('');
        this.bindAbilityDetails($('#player-abilities'), playerAbilities, '我方能力');
      } else {
        playerAbilitiesContainer.innerHTML = '';
      }
    }

    // 更新敌人能力
    const enemyAbilitiesContainer = document.getElementById('enemy-abilities');
    if (enemyAbilitiesContainer) {
      if (enemyAbilities.length > 0) {
        enemyAbilitiesContainer.innerHTML = enemyAbilities.map(ability => this.createAbilityHTML(ability)).join('');
        this.bindAbilityDetails($('#enemy-abilities'), enemyAbilities, '敌方被动');
      } else {
        enemyAbilitiesContainer.innerHTML = '';
      }
    }
  }

  private static bindEnemyIntentDetails(enemy: any): void {
    const action = enemy?.nextAction || (Array.isArray(enemy?.actions) ? enemy.actions[0] : null);
    const intent = $('.enemy-intent, #enemy-intent-summary');
    intent.toggleClass('clickable', !!action).attr('tabindex', action ? '0' : '-1');
    intent.off('.mwgIntentDetail');
    if (!action) return;
    const open = (event: JQuery.TriggeredEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      BattleUI.showSupportDetails($(event.currentTarget), action, '敌方行动');
    };
    intent.on('click.mwgIntentDetail', open);
    intent.on('keydown.mwgIntentDetail', event => {
      if (event.key === 'Enter' || event.key === ' ') open(event);
    });
  }

  /**
   * 创建能力HTML
   */
  private static createAbilityHTML(ability: any): string {
    const effectTags = BattleUI.effectDisplay.triggeredProgramToTags(ability.trigger, ability.effectProgram);
    const effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(effectTags);
    const description = typeof ability.description === 'string' ? ability.description.trim() : '';
    const name = typeof ability.name === 'string' ? ability.name.trim() : ability.id;
    const source = typeof ability.source === 'string' && ability.source.trim() ? ability.source.trim() : '来源未注明';

    return `
      <button type="button" class="ability-item"
           data-ability-id="${escapeHtmlAttribute(ability.id)}"
           data-ability-name="${escapeHtmlAttribute(name || ability.id)}"
           data-ability-description="${escapeHtmlAttribute(description)}"
           data-ability-source="${escapeHtmlAttribute(source)}"
           aria-label="查看能力：${escapeHtmlAttribute(name || ability.id)}"
           title="${escapeHtmlAttribute(name || ability.id)}">
        <span class="ability-emoji" aria-hidden="true">${escapeHtml(ability.emoji || '⚡')}</span>
        <span class="ability-name visually-hidden">${escapeHtml(name || '未命名能力')}</span>
        <span class="ability-effect-preview" aria-hidden="true">${effectTagsHTML || '<span class="ability-error">无效能力</span>'}</span>
      </button>
    `;
  }

  private static bindAbilityDetails(container: JQuery, abilities: any[], ownerLabel: string): void {
    container
      .find('.ability-item')
      .each((index, element) => {
        $(element).data('ability', abilities[index]);
      })
      .off('click.mwgAbility')
      .on('click.mwgAbility', function (event) {
        event.preventDefault();
        event.stopPropagation();
        BattleUI.showSupportDetails($(this), $(this).data('ability'), ownerLabel);
      });
  }

  private static showSupportDetails(anchor: JQuery, value: any, ownerLabel: string): void {
    $('.support-details-popover').remove();
    if (!value) return;
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.id || ownerLabel;
    const description = typeof value.description === 'string' ? value.description.trim() : '';
    const source = typeof value.source === 'string' ? value.source.trim() : '';
    const trigger = typeof value.trigger === 'string' ? value.trigger.trim() : '';
    const displayContext = ownerLabel.startsWith('敌')
      ? { selfLabel: '敌方', opponentLabel: '我方' }
      : { selfLabel: '自身', opponentLabel: '敌方' };
    const effectTags = trigger
      ? this.effectDisplay.triggeredProgramToTags(trigger, value.effectProgram, displayContext)
      : this.effectDisplay.programToTags(value.effectProgram, displayContext);
    const popover = $(`
      <div class="support-details-popover" role="dialog" aria-label="${escapeHtmlAttribute(name)}">
        <div class="support-details-heading">
          <span>${escapeHtml(value.emoji || (ownerLabel.includes('欲望') ? '💗' : ownerLabel === '遗物' ? '🔮' : '⚡'))}</span>
          <strong>${escapeHtml(name)}</strong>
          <small>${escapeHtml(ownerLabel)}</small>
        </div>
        ${description ? `<div class="support-details-description">${escapeHtml(description)}</div>` : ''}
        ${source ? `<div class="support-details-source">来源：${escapeHtml(source)}</div>` : ''}
        <div class="support-details-effects">${this.effectDisplay.createWrappedEffectTagsHTML(effectTags)}</div>
      </div>
    `);
    $('body').append(popover);
    const offset = anchor.offset();
    const width = Math.min(430, ($(window).width() || 446) - 16);
    popover.css({ width });
    const height = popover.outerHeight() || 160;
    const viewportWidth = $(window).width() || width;
    const viewportHeight = $(window).height() || height;
    const anchorWidth = anchor.outerWidth() || 0;
    const anchorHeight = anchor.outerHeight() || 0;
    const left = offset
      ? Math.max(8, Math.min(offset.left + anchorWidth / 2 - width / 2, viewportWidth - width - 8))
      : Math.max(8, (viewportWidth - width) / 2);
    const preferredTop = offset ? offset.top + anchorHeight + 6 : (viewportHeight - height) / 2;
    const top = Math.max(8, Math.min(preferredTop, viewportHeight - height - 8));
    popover.css({ left, top });
    $(document)
      .off('click.mwgSupportPopover')
      .on('click.mwgSupportPopover', () => {
        $('.support-details-popover').remove();
        $(document).off('click.mwgSupportPopover');
      });
  }

  /**
   * 显示状态效果详情弹窗
   */
  public static showStatusDetail(statusId: string, target: string): void {
    // 获取状态定义和当前状态
    const statusDef = DynamicStatusManager.getInstance().getStatusDefinition(statusId);
    const gameState = GameStateManager.getInstance().getGameState();
    const entity = target === 'player' ? gameState.player : gameState.enemy;
    const currentStatus = entity?.statusEffects?.find((s: any) => s.id === statusId);

    if (!statusDef || !currentStatus) {
      console.warn(`未找到状态定义或当前状态: ${statusId}`);
      return;
    }

    // 生成效果解析
    let effectsHTML = '';
    if (statusDef.triggers) {
      Object.entries(statusDef.triggers).forEach(([trigger, effects]) => {
        if (!effects) return;
        const displayContext =
          target === 'enemy'
            ? { selfLabel: '敌方', opponentLabel: '我方' }
            : { selfLabel: '自身', opponentLabel: '敌方' };
        const programs = Array.isArray(effects) ? effects : [effects];
        const triggerTags = programs.flatMap(program =>
          BattleUI.effectDisplay.triggeredProgramToTags(trigger, program, displayContext),
        );
        if (triggerTags.length > 0) {
          const triggerNames: Record<string, string> = {
            apply: '获得时',
            stack: '叠加时',
            tick: '回合变化时',
            remove: '消失时',
            hold: '持续生效',
          };
          effectsHTML += `<section class="status-trigger-group">
            <div class="status-trigger-label">${escapeHtml(triggerNames[trigger] || trigger)}</div>
            ${BattleUI.effectDisplay.createWrappedEffectTagsHTML(triggerTags)}
          </section>`;
        }
      });
    }

    // 移除已存在的弹窗
    $('.status-detail-modal').remove();

    // 创建弹窗
    const modal = $(`
      <div class="status-detail-modal">
        <div class="status-detail-overlay"></div>
        <div class="status-detail-content">
          <div class="status-detail-header">
            <div class="status-detail-icon">${escapeHtml(statusDef.emoji || '⚡')}</div>
            <div class="status-detail-name">${escapeHtml(statusDef.name)}</div>
            <button class="close-status-detail">&times;</button>
          </div>
          <div class="status-detail-body">
            <div class="status-description">${escapeHtml(statusDef.description || '无额外叙事说明')}</div>
              <div class="status-stats">
              <div>层数: ${escapeHtml(currentStatus.stacks || 1)}</div>
              <div>类型: ${statusDef.type === 'buff' ? '增益' : statusDef.type === 'debuff' ? '减益' : '中性'}</div>
              ${statusDef.maxStacks ? `<div>层数上限: ${escapeHtml(statusDef.maxStacks)}</div>` : ''}
              ${statusDef.stacks_change ? `<div>回合变化: ${escapeHtml(statusDef.stacks_change)}</div>` : ''}
            </div>
            <div class="status-detail-effects"><h4>完整效果</h4>${effectsHTML || '<div class="status-no-effect">没有额外数值效果，仅保留层数或特殊状态规则。</div>'}</div>
          </div>
        </div>
      </div>
    `);

    $('body').append(modal);

    // 动画显示
    modal.css({ opacity: 0 }).animate({ opacity: 1 }, 200);

    // 绑定关闭事件
    modal.find('.close-status-detail, .status-detail-overlay').on('click', () => {
      modal.animate({ opacity: 0 }, 200, function () {
        $(this).remove();
      });
    });
  }

  /**
   * 更新欲望效果显示
   */
  private static updateLustEffectDisplay(target: 'player' | 'enemy', lustEffect: any): void {
    const containerId = target === 'enemy' ? '#enemy-lust-effect' : '#player-lust-effect';
    const container = $(containerId);

    if (lustEffect && lustEffect.name) {
      const displayContext =
        target === 'enemy'
          ? { selfLabel: '敌方', opponentLabel: '我方' }
          : { selfLabel: '自身', opponentLabel: '敌方' };
      const effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(
        BattleUI.effectDisplay.programToTags(lustEffect.effectProgram, displayContext),
      );

      const description = typeof lustEffect.description === 'string' ? lustEffect.description.trim() : '';
      const effectHTML = `
        <div class="lust-effect-container">
          <span class="lust-effect-label">欲望效果：</span>
          <button type="button" class="lust-effect-toggle" aria-label="查看欲望效果：${escapeHtmlAttribute(lustEffect.name)}" title="点击查看完整效果">${escapeHtml(lustEffect.name)}</button>
          <div class="lust-effect-details">
            <div class="lust-effect-name">${escapeHtml(lustEffect.name)}</div>
            <div class="lust-effect-description">${escapeHtml(description)}</div>
            ${effectTagsHTML ? `<div class="lust-effect-tags">${effectTagsHTML}</div>` : ''}
          </div>
        </div>
      `;
      container.html(effectHTML);

      // 欲望效果与遗物、能力共用可越过紧凑栏裁切的详情层。
      container
        .find('.lust-effect-toggle')
        .off('click.mwgLustDetail')
        .on('click.mwgLustDetail', function (event) {
          event.preventDefault();
          event.stopPropagation();
          BattleUI.showSupportDetails($(this), lustEffect, target === 'enemy' ? '敌人欲望效果' : '我方欲望效果');
        });
    } else {
      container.empty();
    }
  }
}
