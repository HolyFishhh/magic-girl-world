import { prepareDrawnCardElement } from './pileFlowAnimation';
import { describeStatusStackChange, normalizeChinesePlayerDescription } from '../../game-core/contentDescription';
import { statusAppearanceDisplayTags } from '../../game-core/effectDisplay';
import { battleTriggerDisplayName } from '../../game-core/effectDisplay';
import { resolveCharacterEmoji } from '../../game-core/characterAppearance';
/**
 * 战斗UI管理模块
 */

import { DynamicStatusManager } from '../combat/dynamicStatusManager';
import { renderCardFace } from '../../shared/cardFace';
import { renderCardTraits } from '../../shared/cardTraits';
import { renderSupportDetails } from '../../shared/supportPresentation';
import { renderSummonPanel } from '../../shared/summonPresentation';
import { CardSystem } from '../combat/cardSystem';
import { UnifiedEffectExecutor } from '../combat/unifiedEffectExecutor';
import { GameStateManager } from '../core/gameStateManager';
import { escapeHtml, escapeHtmlAttribute } from '../shared/html';
import {
  describeCardCost,
  normalizeCardCost,
  resourcePoolFromCombatant,
  resolveActiveCardPlayRules,
  roundBattleDisplayValue,
  type Card,
  type CardResourcePayment,
  type CombatResourceState,
} from '../../game-core';
import { CardPlayMode } from './cardPlayMode';
import { stageHealthBar, stageSummonMarkup, positionStageSummonOrbits } from './stageUnitDisplay';
import { summonIntentBadges } from './summonIntentDisplay';
import { EnemyIntentPresenter } from './enemyIntentPresenter';
import { AnimationManager } from './animationManager';
import { PileStatsDisplay } from './pileViewer';
import { EffectProgramDisplay } from './effectProgramDisplay';
import { evaluateHandCardConditionHighlight } from './handCardConditionHighlight';

export class BattleUI {
  private static effectDisplay = EffectProgramDisplay.getInstance();
  private static readonly animationManager = AnimationManager.getInstance();
  private static activeCardTooltip: JQuery | null = null;
  private static activeCardTooltipAnchor: JQuery | null = null;
  private static handResizeBound = false;
  private static summonResizeObserver: ResizeObserver | null = null;
  private static handResizeFrame: number | null = null;
  private static focusedStageTargetId: string | null = null;
  private static formationResetBound = false;

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
      return escapeHtml(`${cost}⚡`);
    const pool = resourcePoolFromCombatant(player.energy || 0, player.resources);
    return Object.entries(components)
      .map(([id, amount]) => {
        const definition = player.resources?.[id];
        const emoji = id === 'energy' ? '⚡' : definition?.emoji || '◆';
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
      $('#stage-player-health').html(stageHealthBar(player?.currentHp, player?.maxHp, player?.name || '我方', player?.block));
      this.animationManager.syncStageHealthBar('player', Number(player?.currentHp) || 0, Number(player?.maxHp) || 0, undefined, Number(player?.block) || 0);
      this.animationManager.restoreStageHealthLoss('player');

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
      this.updateStageSupports('player', player?.statusEffects || [], player?.abilities || []);
    } catch (error) {
      console.error('❌ 刷新战斗UI失败:', error);
    }
  }

  /**
   * 更新敌人显示
   */
  private static updateEnemyDisplay(enemy: any): void {
    $('#enemy-name').text(enemy.name || '未知敌人');
    const description = normalizeChinesePlayerDescription(enemy.description || enemy.dialogue);
    const hints = [enemy.escapePending ? '正在准备逃跑；逃走后不会获得它的击杀收益。' : '', enemy.defeatReward ? '击败后可获得专属战利品。' : ''].filter(Boolean);
    $('#enemy-description').text([description, ...hints].filter(Boolean).join(' ')).prop('hidden', !description && !hints.length);
    $('.enemy-emoji').text(resolveCharacterEmoji(enemy, id => DynamicStatusManager.getInstance().getStatusDefinition(id), '👹'));
    $('#stage-enemy-emoji').text(resolveCharacterEmoji(enemy, id => DynamicStatusManager.getInstance().getStatusDefinition(id), '👹'));

    // 更新敌人血条
    const enemyHpPercent = enemy.maxHp > 0 ? (enemy.currentHp / enemy.maxHp) * 100 : 0;
    // A lethal hit may have an in-flight animation to zero. Stop it before
    // painting the newly selected living enemy, otherwise it overwrites this
    // value after the target has already changed.
    const enemyFill = $('.enemy-card .hp-fill');
    if (!enemyFill.parent().find('.hp-loss').length) enemyFill.before('<div class="hp-loss" aria-hidden="true"></div>');
    enemyFill.stop(true, true).css('width', `${enemyHpPercent}%`);
    $('#enemy-hp').text(`${this.displayBattleValue(enemy.currentHp)}/${this.displayBattleValue(enemy.maxHp, 1)}`);

    // 更新敌人欲望条
    const enemyLustPercent = enemy.maxLust > 0 ? (enemy.currentLust / enemy.maxLust) * 100 : 0;

    // 使用新的统一选择器
    $('.enemy-card .lust-fill').stop(true, true).css('width', `${enemyLustPercent}%`);
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
    const resources = Object.values(enemy.resources || {}) as CombatResourceState[];
    $('#enemy-combat-resources').html(resources.map(resource => `
      <span class="combat-resource-chip" data-resource-id="${escapeHtmlAttribute(resource.id)}" title="${escapeHtmlAttribute(resource.description ? `${resource.name}：${resource.description}` : resource.name)}">
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
    const renderedIds = new Set(enemies.map(enemy => String(enemy.id)));
    $('#stage-enemy-party .stage-enemy-member').each((_, element) => {
      const member = $(element);
      if (!renderedIds.has(String(member.attr('data-enemy-id') || ''))) this.animationManager.showEnemyDeparture(member);
    });
    const party = $('#stage-enemy-party');
    const multi = living.length > 1 || party.attr('data-multi-layout') === 'true';
    if (multi) party.attr('data-multi-layout', 'true');
    $('.battle-main-grid').toggleClass('multi-enemy-battle', multi);
    $('.enemy-section').toggleClass('is-multi-enemy', multi);
    this.updateEnemyStageParty(enemies, activeEnemyId);
    const roster = $('#enemy-roster');
    if (multi && roster.length) {
      const height=roster[0].getBoundingClientRect().height;
      if(height>0)roster.css('min-height', `${height}px`);
    }
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
          ...(enemy.lustEffect ? [{ emoji: enemy.lustEffect.emoji || '💗', title: `敌方欲望效果（我方欲望满时）：${enemy.lustEffect.name || '未命名'}` }] : []),
        ];
        const supportHtml = support.map(entry => `<span class="enemy-roster-support" title="${escapeHtmlAttribute(entry.title)}">${escapeHtml(entry.emoji)}</span>`).join('');
        return `<button class="enemy-roster-unit${enemy.id === activeEnemyId ? ' is-active' : ''}" data-enemy-id="${escapeHtmlAttribute(String(enemy.id))}" type="button" aria-pressed="${enemy.id === activeEnemyId ? 'true' : 'false'}" title="${escapeHtmlAttribute(intentModel.description)}">
          <span class="enemy-roster-emoji">${escapeHtml(resolveCharacterEmoji(enemy, id => DynamicStatusManager.getInstance().getStatusDefinition(id), '👹'))}</span>
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
    if (!this.formationResetBound) {
      this.formationResetBound = true;
      GameStateManager.getInstance().addEventListener('game_reset', () => {
        $('#stage-enemy-party').removeAttr('data-slot-origin data-multi-layout').css('min-height','');
        $('#enemy-roster').css('min-height','');
      });
    }
    const party = $('#stage-enemy-party');
    const stage = $('#stage-enemy');
    if (!party.length) return;
    const multi = true;
    stage.toggleClass('has-enemy-party', multi);
    party.attr('data-enemy-count', String(enemies.length));
    // Keep the authored queue order stable. Selecting a target may update the
    // detailed HUD, but the other actors must not jump around on the stage.
    const ordered = [...enemies].filter(enemy => Number.isInteger(enemy.stageSlot) && enemy.stageSlot >= 0 && enemy.stageSlot < 5).sort((a, b) => a.stageSlot - b.stageSlot);
    // Stored slots are execution identity, not authored screen coordinates.
    // Older saves start at slot 5-N. Anchor once per stage DOM so reversing
    // their order does not put those padding slots on the right; deaths keep gaps.
    const priorOrigin = party.attr('data-slot-origin');
    const origin = priorOrigin === undefined ? (ordered[0]?.stageSlot ?? 0) : Number(priorOrigin);
    if (ordered.length && priorOrigin === undefined) party.attr('data-slot-origin', String(origin));
    const previousHeight = party[0].getBoundingClientRect().height;
    if (previousHeight > 0) party.css('min-height', `${previousHeight}px`);
    party.html(Array.from({ length: 5 }, (_, position) => {
      const slot = (origin + 4 - position) % 5;
      const index = slot;
      const enemy = ordered.find(enemy => enemy.stageSlot === slot);
      if (!enemy) return `<span class="stage-enemy-empty" aria-hidden="true" data-stage-slot="${slot}" style="grid-column:${position + 1};grid-row:1"></span>`;
      const active = enemy.id === activeEnemyId || (!activeEnemyId && enemy === ordered[0]);
      const intent = EnemyIntentPresenter.getInstance().createDisplayModel(enemy);
      const badges = intent.badges.map(badge => `<span class="stage-intent-badge">${escapeHtml(badge.icon)}${badge.value ? `<b>${escapeHtml(badge.value)}</b>` : ''}</span>`).join('');
      return `<button class="stage-enemy-member${active ? ' is-active' : ''}" type="button" data-enemy-id="${escapeHtmlAttribute(String(enemy.id))}" aria-pressed="${active ? 'true' : 'false'}" aria-label="选择目标：${escapeHtmlAttribute(String(enemy.name || enemy.id))}，下一步${escapeHtmlAttribute(intent.description)}" style="grid-column:${position + 1};grid-row:1;--party-order:${index};--party-depth:${ordered.length - index}">
        <span class="stage-enemy-member-intent" role="button" tabindex="0" title="${escapeHtmlAttribute(`查看行动：${intent.description}`)}" aria-label="查看敌方行动：${escapeHtmlAttribute(intent.description)}">${badges || '❓'}</span>
        <span class="stage-emoji"${active ? ' id="stage-enemy-emoji"' : ''}>${escapeHtml(resolveCharacterEmoji(enemy, id => DynamicStatusManager.getInstance().getStatusDefinition(id), '👹'))}</span>
        ${stageHealthBar(enemy.currentHp, enemy.maxHp, String(enemy.name || '敌人'), enemy.block)}
        ${enemy.victoryOnDefeat ? '<span class="stage-victory-target">击倒即胜利</span>' : ''}
        ${this.stageSupportsMarkup('enemy', enemy.statusEffects || [], enemy.abilities || [])}
      </button>`;
    }).join(''));
    const reserves = GameStateManager.getInstance().getReserveEnemies();
    if (reserves.length) party.append(`<details class="stage-reserves"><summary aria-label="查看后备敌人，共${reserves.length}名">⋯<small>${reserves.length}</small></summary><div class="stage-reserves-list"><b>后备敌人 · 上场后参与战斗</b>${reserves.map(enemy => `<div>${escapeHtml(enemy.emoji || '👹')} ${escapeHtml(enemy.name)} <span>${this.displayBattleValue(enemy.currentHp)}/${this.displayBattleValue(enemy.maxHp)}</span>${enemy.victoryOnDefeat ? ' · 击倒即胜利' : ''}</div>`).join('')}</div></details>`);
    ordered.forEach(enemy => this.animationManager.syncStageHealthBar('enemy', Number(enemy.currentHp) || 0, Number(enemy.maxHp) || 0, String(enemy.id), Number(enemy.block) || 0));
    ordered.forEach(enemy => this.animationManager.restoreStageHealthLoss('enemy', String(enemy.id)));
    const focusedId = activeEnemyId || String(ordered.find(enemy => Number(enemy.currentHp) > 0)?.id || '');
    if (focusedId && focusedId !== this.focusedStageTargetId) {
      this.focusedStageTargetId = focusedId;
      const focused = party.find('.stage-enemy-member').filter((_index, element) => String(element.dataset.enemyId) === focusedId);
      focused.addClass('is-target-focus');
      window.setTimeout(() => focused.removeClass('is-target-focus'), 1500);
    }
    party.off('click.mwg-stage-enemy').on('click.mwg-stage-enemy', '.stage-enemy-member', event => {
      if ($(event.target).closest('.stage-support-item,.stage-enemy-member-intent').length) return;
      const enemyId = String($(event.currentTarget).attr('data-enemy-id') || '');
      if (!enemyId || !GameStateManager.getInstance().setActiveEnemy(enemyId)) return;
      void this.refreshBattleUI(GameStateManager.getInstance().getGameState());
    });
    party.off('click.mwg-stage-support').on('click.mwg-stage-support', '.stage-support-item', event => {
      event.preventDefault();
      event.stopPropagation();
      const item = $(event.currentTarget);
      const target = String(item.data('target'));
      if (item.data('status-id')) {
        const enemyId = String(item.closest('.stage-enemy-member').data('enemy-id') || '');
        const owner = target === 'enemy' ? GameStateManager.getInstance().getGameState().enemies?.find(entry => entry.id === enemyId) : undefined;
        this.showStatusDetail(String(item.data('status-id')), target, owner);
      }
      else {
        const enemyId = String(item.closest('.stage-enemy-member').data('enemy-id') || '');
        const state = GameStateManager.getInstance().getGameState();
        const owner = target === 'enemy' ? (state.enemies || []).find((entry: any) => String(entry.id) === enemyId) : state.player;
        const ability = (owner?.abilities || []).find((entry: any) => String(entry.id) === String(item.data('ability-id')));
        this.showSupportDetails(item, ability, target === 'enemy' ? '敌方被动' : '我方能力');
      }
    });
    party.off('click.mwg-stage-intent').on('click.mwg-stage-intent', '.stage-enemy-member-intent', event => {
      event.preventDefault();
      event.stopPropagation();
      const member = $(event.currentTarget).closest('.stage-enemy-member');
      const enemyId = String(member.data('enemy-id') || '');
      const enemy = (GameStateManager.getInstance().getGameState().enemies || []).find((entry: any) => String(entry.id) === enemyId);
      const action = enemy?.nextAction || (Array.isArray(enemy?.actions) ? enemy.actions[0] : null);
      if (action) this.showSupportDetails($(event.currentTarget), action, '敌方行动');
    });
    party.off('keydown.mwg-stage-intent').on('keydown.mwg-stage-intent', '.stage-enemy-member-intent', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      $(event.currentTarget).trigger('click');
    });
  }

  private static stageSupportsMarkup(target: 'player' | 'enemy', statuses: any[], abilities: any[]): string {
    $(document).off('keydown.mwg-stage-support').on('keydown.mwg-stage-support', '.stage-support-item', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation();
      $(event.currentTarget).trigger('click');
    });
    const statusItems = statuses.map(status => {
      const definition = DynamicStatusManager.getInstance().getStatusDefinition(status.id);
      const emoji = definition?.emoji || status.emoji || '◈';
      const name = definition?.name || status.name || status.id;
      const stacks = this.displayBattleValue(status.stacks, 1);
      return `<span class="stage-support-item stage-status-support" role="button" tabindex="0" data-target="${target}" data-status-id="${escapeHtmlAttribute(String(status.id))}" title="${escapeHtmlAttribute(`${name}${stacks > 1 ? ` ${stacks}层` : ''}`)}" aria-label="查看状态：${escapeHtmlAttribute(name)}">${escapeHtml(emoji)}<b>${stacks}</b></span>`;
    });
    const abilityItems = abilities.map(ability => `<span class="stage-support-item stage-ability-support" role="button" tabindex="0" data-target="${target}" data-ability-id="${escapeHtmlAttribute(String(ability.id || ''))}" title="${escapeHtmlAttribute(`能力：${ability.name || ability.id || '未命名'}`)}" aria-label="查看能力：${escapeHtmlAttribute(String(ability.name || ability.id || '未命名'))}">${escapeHtml(ability.emoji || '⚡')}</span>`);
    return `<span class="stage-unit-supports" aria-label="${target === 'enemy' ? '敌方' : '我方'}状态与能力">${statusItems.concat(abilityItems).join('')}</span>`;
  }

  private static updateStageSupports(target: 'player' | 'enemy', statuses: any[], abilities: any[]): void {
    const container = $(`#stage-${target}-supports`);
    if (!container.length) return;
    container.html(this.stageSupportsMarkup(target, statuses, abilities));
    container.off('click.mwg-stage-support').on('click.mwg-stage-support', '.stage-support-item', event => {
      event.preventDefault();
      event.stopPropagation();
      const item = $(event.currentTarget);
      if (item.data('status-id')) this.showStatusDetail(String(item.data('status-id')), target);
      else {
        const ability = abilities.find(entry => String(entry.id) === String(item.data('ability-id')));
        this.showSupportDetails(item, ability, '我方能力');
      }
    });
  }

  private static updateSummonDisplays(collection: any): void {
    const living = Array.isArray(collection?.living) ? collection.living : [];
    for (const owner of ['player', 'enemy'] as const) {
      const units = living.filter((unit: any) => unit?.owner === owner && (unit.hasHp === false || Number(unit.currentHp) > 0));
      const container = $(`#${owner}-summons`);
      if (!container.length) continue;
      const limit = GameStateManager.getInstance().getGameState().summonLimits?.[owner];
      const meterId = `${owner}-summon-capacity`;
      let meter = $(`#${meterId}`);
      if (!meter.length) { meter = $(`<span id="${meterId}" class="summon-capacity-meter"></span>`); container.after(meter); }
      meter.text(limit === undefined ? '' : `召唤 ${units.length}/${limit}`).toggle(limit !== undefined);
      const orbit = units.length > 3;
      const stage = $(`#stage-${owner}`);
      stage.toggleClass('has-orbit-summons', orbit).toggleClass('has-inline-summons', units.length > 0 && !orbit);
      container.toggleClass('is-orbit', orbit).toggleClass('is-inline', !orbit);
      const state = GameStateManager.getInstance().getGameState();
      const mainCount = owner === 'player' ? 1 : Math.max(1, (state.enemies || []).filter(enemy => enemy.currentHp > 0).length);
      document.getElementById('battle-stage')?.style.setProperty(`--${owner}-units`, `${orbit ? Math.max(3, mainCount * 2) : mainCount + units.length}fr`);
      container.html(units.map((unit: any, index: number) => stageSummonMarkup({ ...unit, emoji: resolveCharacterEmoji(unit, id => DynamicStatusManager.getInstance().getStatusDefinition(id), '◆') }, index, orbit,
        orbit ? [] : summonIntentBadges(unit, state), String(unit.name || unit.templateId || '召唤物'))).join('')).toggle(units.length > 0);
      units.filter((unit: any) => unit.hasHp !== false).forEach((unit: any) => this.animationManager.syncSummonHealthBar(owner, String(unit.instanceId || ''), Number(unit.currentHp) || 0, Number(unit.maxHp) || 0, Number(unit.block) || 0));
      units.filter((unit: any) => unit.hasHp !== false).forEach((unit: any) => this.animationManager.restoreSummonHealthLoss(owner, String(unit.instanceId || '')));
      container.find('.stage-summon-unit').each((index, element) => {
        $(element).data('summon', units[index]);
        if (!orbit) $(element).append(this.stageSupportsMarkup(owner, units[index].statusEffects || [], units[index].abilities || []));
      });
      container.off('click.mwgSummon').on('click.mwgSummon', '.stage-summon-unit', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const unit = $(this).data('summon');
        const support = $(event.target).closest('.stage-support-item');
        if (support.length) {
          if (support.data('status-id')) BattleUI.showStatusDetail(String(support.data('status-id')), owner, unit);
          else BattleUI.showSupportDetails(support, unit.abilities?.find((ability: any) => ability.id === support.data('ability-id')), '召唤物能力');
          return;
        }
        BattleUI.showSummonDetails($(this), unit);
      });
    }
    positionStageSummonOrbits();
    if (typeof ResizeObserver !== 'undefined' && !this.summonResizeObserver) {
      const stage = document.getElementById('battle-stage');
      if (stage) {
        this.summonResizeObserver = new ResizeObserver(() => positionStageSummonOrbits());
        this.summonResizeObserver.observe(stage);
      }
    }
  }

  private static showSummonDetails(anchor: JQuery, unit: any): void {
    $('.support-details-popover').remove();
    if (!unit) return;
    const state = GameStateManager.getInstance().getGameState();
    const summoner = unit.owner === 'player' ? state.player : (state.enemies || []).find(enemy => enemy.id === unit.summonerId);
    const names = (resources: any) => Object.fromEntries(Object.values(resources || {}).map((resource: any) => [resource.id, resource.name]));
    const emojis = (resources: any) => Object.fromEntries(Object.values(resources || {}).map((resource: any) => [resource.id, resource.emoji || '◆']));
    unit = { ...unit, displayResourceEmojis: { ...emojis(summoner?.resources), ...emojis(unit.resources) }, displaySummonerResourceEmojis: emojis(summoner?.resources), displayResourceNames: { ...names(summoner?.resources), ...names(unit.resources) }, displaySummonerResourceNames: names(summoner?.resources) };
    const popover = $(`
      <div class="support-details-popover summon-details-popover" role="dialog" aria-label="${escapeHtmlAttribute(String(unit.name || '召唤单位'))}">
        <button type="button" class="tooltip-close">关闭</button>${renderSummonPanel(unit)}
      </div>`);
    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(popover);
    const width = Math.min(430, ($(window).width() || 446) - 16);
    popover.css({ width });
    const rect = anchor[0]?.getBoundingClientRect();
    const height = popover.outerHeight() || 180;
    const viewportWidth = $(window).width() || width;
    const viewportHeight = $(window).height() || height;
    const left = rect
      ? Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - 8))
      : Math.max(8, (viewportWidth - width) / 2);
    const preferredTop = rect ? rect.bottom + 6 : (viewportHeight - height) / 2;
    popover.css({ left, top: Math.max(8, Math.min(preferredTop, viewportHeight - height - 8)) });
    $(document).off('click.mwgSummonPopover').on('click.mwgSummonPopover', event => {
      if ($(event.target).closest(popover).length && !$(event.target).closest('.tooltip-close').length) return;
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
    const playerEmoji = resolveCharacterEmoji(player, id => DynamicStatusManager.getInstance().getStatusDefinition(id));
    $('.player-emblem, #stage-player-emoji').text(playerEmoji);

    // 更新玩家血条
    const playerHpPercent = playerMaxHp > 0 ? (playerHp / playerMaxHp) * 100 : 0;
    const playerFill = $('.player-card .hp-fill');
    if (!playerFill.parent().find('.hp-loss').length) playerFill.before('<div class="hp-loss" aria-hidden="true"></div>');
    playerFill.css('width', `${playerHpPercent}%`);
    $('#player-hp').text(`${playerHp}/${playerMaxHp}`);

    // 更新玩家欲望条
    const playerLustPercent = playerMaxLust > 0 ? (playerLust / playerMaxLust) * 100 : 0;

    // 使用新的统一选择器
    $('.player-card .lust-fill').css('width', `${playerLustPercent}%`);
    $('#player-lust').text(`${playerLust}/${playerMaxLust}`);

    // 更新能量显示
    $('#player-energy').text(`${playerEnergy}/${this.displayBattleValue(player.maxEnergy, 3)}`);
    const resources = Object.values(player.resources || {}) as CombatResourceState[];
    $('#player-combat-resources').html(resources.map(resource => `
      <span class="combat-resource-chip" data-resource-id="${escapeHtmlAttribute(resource.id)}" title="${escapeHtmlAttribute(resource.description ? `${resource.name}：${resource.description}` : resource.name)}">
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

      if (!handCards || !Array.isArray(handCards)) {
        handContainer.empty();
        return;
      }

      const validCards = handCards;

      // 开始创建手牌元素 - 移除日志减少输出

      const kept = new Set(validCards.map(card => String(card.id)));
      handContainer.children('.mwg-card').each((_index, element) => {
        if (!kept.has(String(element.dataset.cardId))) $(element).remove();
      });
      validCards.forEach((card: any, index: number) => {
        if (document.querySelector(`.card-cast-flight[data-card-id="${CSS.escape(String(card.id))}"]`)) return;
        if (card && card.name) {
          const cardElement = this.createEnhancedCardElement(card, index);
          const existing = handContainer.children('.mwg-card').filter((_i, element) => element.dataset.cardId === String(card.id)).first();
          if (existing.length) {
            const selected = existing.hasClass('selected');
            existing.attr('class', cardElement.attr('class') || '').toggleClass('selected', selected);
            ['data-condition-highlight', 'data-condition-hint', 'title', 'aria-label'].forEach(attribute => {
              const value = cardElement.attr(attribute);
              if (value === undefined) existing.removeAttr(attribute);
              else existing.attr(attribute, value);
            });
            const face = cardElement.html();
            if (existing.data('renderedFace') !== face) {
              existing.empty().append(cardElement.children());
              existing.data('renderedFace', face);
            }
            existing.data('cardData', cardElement.data('cardData'));
            prepareDrawnCardElement(existing[0]);
          } else { cardElement.data('renderedFace', cardElement.html()); prepareDrawnCardElement(cardElement[0]); handContainer.append(cardElement); }
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
      const cardWidth = cards.first().outerWidth() || 150;
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
  private static cardTraitContext(card: Card, preview = CardSystem.getInstance().previewCardPlay(card.id)): import('../../shared/cardTraits').CardTraitContext {
    const player = GameStateManager.getInstance().getPlayer();
    const denied = !preview.ok && ['CURSE_UNPLAYABLE', 'RULE_DENIED', 'RULE_LIMIT_REACHED', 'DOMINATED_ATTACK', 'SILENCED_SKILL'].includes(preview.code);
    const allowed = preview.ok || (!preview.ok && ['INSUFFICIENT_ENERGY', 'INSUFFICIENT_RESOURCE'].includes(preview.code));
    const state = GameStateManager.getInstance().getGameState();
    const aura = resolveActiveCardPlayRules(
      UnifiedEffectExecutor.getInstance().getCardPlayRules('player'),
      state.cardRuleUsesThisTurn || 0,
      card,
    ).ethereal;
    return {
      playAccess: denied ? 'denied' : allowed ? 'allowed' : undefined,
      temporary: !!card.parentCombatInstanceId && card.origin === 'copied' ||
        !!card.runInstanceId && !player.deck.some(owned => owned.runInstanceId === card.runInstanceId),
      etherealAura: aura,
    };
  }

  private static createEnhancedCardElement(card: any, index: number): JQuery {
    // 创建卡牌元素 - 移除日志减少输出

    // 确保卡牌有必要的属性
    const cardData: Card = {
      id: card.id || card.originalId || `card_${index}`,
      origin: card.origin,
      runInstanceId: card.runInstanceId,
      parentCombatInstanceId: card.parentCombatInstanceId,
      attachments: card.attachments,
      name: card.name || '未知卡牌',
      cost: card.cost ?? 0,
      type: card.type || 'Skill',
      rarity: card.rarity || 'Common',
      emoji: card.emoji || '🃏',
      effectProgram: card.effectProgram,
      description: card.description || '',
      discardEffectProgram: card.discardEffectProgram,
      retain: card.retain || false,
      lifecycle: card.lifecycle,
      exhaust: card.exhaust || false,
      ethereal: card.ethereal || false,
      sly: card.sly || false,
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
    const isClickable = isPlayerTurn && preview.ok;
    // This reads the exact executor snapshot for each live target. It neither executes
    // the program nor predicts payment/event contexts that are only known during play.
    const executor = UnifiedEffectExecutor.getInstance();
    const targets = GameStateManager.getInstance().getEnemies({ livingOnly: true });
    const conditionHighlight = evaluateHandCardConditionHighlight({
      program: cardData.effectProgram,
      targets,
      activeTargetId: gameState.activeEnemyId || targets[0]?.id || null,
      getState: enemy => executor.getCoreEffectState(true, enemy),
    });

    // 创建完整的卡牌元素
    const cardElement = $(renderCardFace(cardData, {
      traitContext: this.cardTraitContext(cardData, preview),
      costLabel: displayCost, costHtml: displayCostHtml,
      rarityLabel: this.translateRarity(cardData.rarity), typeLabel: this.translateCardType(cardData.type),
      interactionClass: isClickable ? 'clickable' : shortage ? 'unaffordable' : 'blocked',
      compositeCost: (typeof previewCard.cost === 'object' && previewCard.cost !== null) || !!previewPayment?.waived.length,
      insufficient: !canAfford,
      rulesHtml: this.effectDisplay.createCompactEffectTagsHTML(this.effectDisplay.cardToTags(cardData, {
        damageAmountText: node => {
          // A random or group selector is not the selected opponent. Keep its
          // authored formula until a per-recipient estimate can be shown.
          if (node.targetSelector) return undefined;
          try {
            const { base, value } = executor.previewPlayerCardDamage(node.amount, node.target, node.damageKind, previewPayment);
            return Number.isFinite(value) ? `${value}${value > base ? '↑' : value < base ? '↓' : ''}` : undefined;
          } catch { return undefined; }
        },
      })) + (cardData.discardEffectProgram?.steps?.length
        ? `<section class="card-trigger-rules"><strong>主动或被效果弃置时</strong>${this.effectDisplay.createCompactEffectTagsHTML(this.effectDisplay.programToTags(cardData.discardEffectProgram))}</section>` : '')
        + this.effectDisplay.createCompactEffectTagsHTML(this.effectDisplay.attachmentToTags(cardData.attachments)),
    }));

    if (conditionHighlight.kind !== 'none') {
      cardElement
        .addClass(`hand-card-condition-${conditionHighlight.kind}`)
        .attr('data-condition-highlight', conditionHighlight.kind)
        .attr('data-condition-hint', conditionHighlight.hint || '')
        .attr('title', conditionHighlight.hint || '')
        .attr('aria-label', `${cardData.name}，${conditionHighlight.hint}`);
    }
    if (conditionHighlight.glows) cardElement.addClass('hand-card-condition-match');

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
        // Shared card preview handles the complete face on every surface.
      })
      .on('mouseleave', () => {
        cardElement.removeClass('card-hover');
      });

    // 保存原始点击处理器
    const originalClickHandler = () => {
      if (cardElement.data('suppressPlayClick')) return;
      // Preview remains pinned until explicitly closed, replaced, or the card is played.
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
    const effectTags = BattleUI.effectDisplay.cardToTags(card);
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
          <span class="tooltip-rarity">${escapeHtml(card.type === 'Curse' ? '诅咒' : this.translateRarity(card.rarity))}</span>
        </div>
        ${wrappedEffectHTML ? `<div class="tooltip-effects"><div class="tooltip-subtitle">${card.type === 'Curse' ? '回合结束时（仍在手牌）' : '打出时'}</div>${wrappedEffectHTML}</div>` : ''}
        ${wrappedDiscardHTML ? `<div class="tooltip-effects"><div class="tooltip-subtitle">此牌被战斗效果弃掉后：</div>${wrappedDiscardHTML}</div>` : ''}
        ${wrappedAttachmentHTML ? `<div class="tooltip-effects"><div class="tooltip-subtitle">卡牌附着：</div>${wrappedAttachmentHTML}</div>` : ''}
        ${card.description ? `<div class="tooltip-description">${escapeHtml(card.description)}</div>` : ''}
        <div class="card-traits">${renderCardTraits(card, this.cardTraitContext(card))}</div>
      </div>
    `);

    const close = $('<button type="button" class="tooltip-close" aria-label="关闭卡牌详情">关闭</button>');
    close.on('click', event => { event.stopPropagation(); this.dismissCardTooltip(); });
    tooltip.prepend(close);
    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(tooltip);
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
  public static dismissCardTooltip(): void {
    CardPlayMode.getInstance().clearSelection();
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
            <span aria-hidden="true">${escapeHtml(relic.emoji || '📿')}</span><span class="relic-caption">${escapeHtml(relic.name || '未知遗物')}</span>
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
        const stacks = status.stacks ?? 1;
        const statusType = ['buff', 'debuff', 'neutral'].includes(statusDef?.type || '') ? statusDef!.type : 'neutral';
        const duration = status.duration;

        const title = `${name}${stacks > 0 ? ` · ${stacks}层` : ''}${duration && duration > 0 ? ` · ${duration}回合` : ''}`;

        return `
          <button type="button" class="status-effect-item support-icon-button clickable status-kind-${statusType}"
               data-status-id="${escapeHtmlAttribute(status.id)}"
               data-target="${target}"
               aria-label="查看状态：${escapeHtmlAttribute(title)}"
               title="${escapeHtmlAttribute(title)}">
            <span class="status-effect-emoji" aria-hidden="true">${escapeHtml(emoji)}</span>
            ${stacks > 0 ? `<span class="status-stack-badge" aria-hidden="true">${escapeHtml(stacks)}</span>` : ''}
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
      ? `<div class="orb-strip" aria-label="姿态槽 ${orbs.length}/${slots}">
          <span class="orb-count">姿态槽 ${orbs.length}/${slots}</span>
          ${orbs.map((orb: any, index: number) => `
            <button type="button" class="special-container-toggle orb-toggle" data-special-kind="orb" data-orb-index="${index}"
              aria-label="查看姿态：${escapeHtmlAttribute(String(orb.name || orb.id || index))}，数值 ${escapeHtml(this.displayBattleValue(orb.value))}"
              title="${escapeHtmlAttribute(String(orb.name || orb.id || '姿态'))} · 数值 ${escapeHtmlAttribute(String(this.displayBattleValue(orb.value)))}">
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
      ? { selfLabel: '自身', opponentLabel: '对方', sourceSide: 'enemy' }
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
    const eventHtml = kind === 'stance' && Array.isArray(value.events) ? value.events.map((event: any) => {
      const tags = this.effectDisplay.triggeredProgramToTags(event.trigger,
        { spec: 'mwg.effect/v1', steps: event.effects }, context, event.eventQuery);
      return `<section class="special-details-group"><strong>仅此姿态生效期间</strong>${this.effectDisplay.createWrappedEffectTagsHTML(tags)}</section>`;
    }).join('') : '';
    const sourceName = typeof value.source?.name === 'string' ? value.source.name : '';
    const popover = $(`
      <div class="support-details-popover special-container-popover" role="dialog" aria-label="${escapeHtmlAttribute(String(value.name || kind))}">
        <div class="support-details-heading">
          <span>${escapeHtml(String(value.emoji || (kind === 'stance' ? '◈' : '◆')))}</span>
          <strong>${escapeHtml(String(value.name || (kind === 'stance' ? '当前姿态' : '姿态')))}</strong>
          <small>${kind === 'stance' ? '当前姿态' : `姿态槽 · 数值 ${escapeHtml(this.displayBattleValue(value.value))}`}</small>
        </div>
        ${value.description ? `<div class="support-details-description">${escapeHtml(String(value.description))}</div>` : ''}
        ${sourceName ? `<div class="support-details-source">来源：${escapeHtml(sourceName)}</div>` : ''}
        <div class="support-details-effects">${groupHtml + eventHtml || '<div class="status-no-effect">没有额外效果。</div>'}</div>
      </div>
    `);
    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(popover);
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
    const intent = $('.enemy-intent');
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
    const effectTags = [...BattleUI.effectDisplay.triggeredProgramToTags(ability.trigger, ability.effectProgram, {}, ability.eventQuery), ...BattleUI.effectDisplay.protectionToTags(ability)];
    const effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(effectTags);
    const description = typeof ability.description === 'string' ? ability.description.trim() : '';
    const name = typeof ability.name === 'string' ? ability.name.trim() : ability.id;
    const source = typeof ability.source === 'string' && ability.source.trim() ? ability.source.trim() : '来源未注明';

    return `
      <button type="button" class="ability-item support-icon-button"
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
    const trigger = typeof value.trigger === 'string' ? value.trigger.trim() : '';
    const ownerId = String(anchor.closest('.stage-enemy-member').data('enemy-id') || '');
    const enemy = GameStateManager.getInstance().getEnemies().find(entry => entry.id === ownerId) || GameStateManager.getInstance().getEnemy();
    const enemyActionNames = Object.fromEntries((enemy?.actions || []).filter(action => action.id).map(action => [action.id!, action.name]));
    const displayContext = ownerLabel.startsWith('敌')
      ? { selfLabel: '自身', opponentLabel: '对方', sourceSide: 'enemy', sourceEnemyId: ownerId, enemyActionNames }
      : { selfLabel: '自身', opponentLabel: '敌方' };
    const effectTags = trigger
      ? this.effectDisplay.triggeredProgramToTags(trigger, value.effectProgram, displayContext, value.eventQuery)
      : this.effectDisplay.programToTags(value.effectProgram, displayContext);
    effectTags.push(...this.effectDisplay.protectionToTags(value));
    const popover = $(`
      <div class="support-details-popover" role="dialog" aria-label="${escapeHtmlAttribute(name)}">
        ${renderSupportDetails({ ...value, description: normalizeChinesePlayerDescription(value.description) }, { kind: ownerLabel, rulesHtml: this.effectDisplay.createWrappedEffectTagsHTML(effectTags) })}
      </div>
    `);
    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(popover);
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
  public static showStatusDetail(statusId: string, target: string, owner?: any): void {
    // 获取状态定义和当前状态
    const statusDef = DynamicStatusManager.getInstance().getStatusDefinition(statusId);
    const gameState = GameStateManager.getInstance().getGameState();
    const entity = owner || (target === 'player' ? gameState.player : gameState.enemy);
    const currentStatus = entity?.statusEffects?.find((s: any) => s.id === statusId);

    if (!statusDef || !currentStatus) {
      console.warn(`未找到状态定义或当前状态: ${statusId}`);
      return;
    }

    // 生成效果解析
    let effectsHTML = '';
    const protectionTags = BattleUI.effectDisplay.protectionToTags(statusDef);
    effectsHTML += BattleUI.effectDisplay.createWrappedEffectTagsHTML(protectionTags);
    const statusRuleText: string[] = protectionTags.map(tag => tag.text);
    statusRuleText.push(...statusAppearanceDisplayTags(statusDef).map(tag => tag.text));
    if (statusDef.stun) statusRuleText.push('持有时无法行动');
    const decay = describeStatusStackChange(statusDef.stacks_change);
    if (decay) statusRuleText.push(decay);
    if (statusDef.triggers) {
      Object.entries(statusDef.triggers).forEach(([trigger, effects]) => {
        if (!effects) return;
        const resources = Object.entries(entity?.resources || {}) as [string, any][];
        const displayContext = {
          selfLabel: '自身', opponentLabel: target === 'enemy' ? '对方' : '敌方', sourceSide: target,
          resourceNames: Object.fromEntries(resources.map(([id, r]) => [id, r.name])),
          resourceEmojis: Object.fromEntries(resources.map(([id, r]) => [id, r.emoji || '◆'])),
          enemyActionNames: Object.fromEntries((entity?.actions || []).map((action: any) => [action.id, action.name])),
        };
        const programs = Array.isArray(effects) ? effects : [effects];
        const triggerTags = programs.flatMap(program =>
          BattleUI.effectDisplay.triggeredProgramToTags(trigger, program, displayContext),
        );
        statusRuleText.push(...triggerTags.map(tag => tag.text));
        if (triggerTags.length > 0) {
          const triggerNames: Record<string, string> = {
            apply: '获得时',
            stack: '叠加时',
            tick: '回合变化时',
            remove: '消失时',
            hold: '持续生效',
            turn_start: '回合开始时', turn_end: '回合结束时', battle_start: '战斗开始时',
          };
          effectsHTML += `<section class="status-trigger-group">
            <div class="status-trigger-label">${escapeHtml(triggerNames[trigger] || battleTriggerDisplayName(trigger))}</div>
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
            <div class="status-description">${escapeHtml(statusRuleText.join('；') || statusDef.description || '暂无可显示的结构化规则')}</div>
            ${statusDef.flavorText ? `<div class="status-flavor">${escapeHtml(statusDef.flavorText)}</div>` : ''}
              <div class="status-stats">
              <div>层数: ${escapeHtml(currentStatus.stacks || 1)}</div>
              <div>类型: ${statusDef.type === 'buff' ? '增益' : statusDef.type === 'debuff' ? '减益' : '中性'}</div>
              ${statusDef.maxStacks ? `<div>层数上限: ${escapeHtml(statusDef.maxStacks)}</div>` : ''}
              ${statusDef.stacks_change ? `<div>${escapeHtml(decay || '回合末层数保持不变')}</div>` : ''}
            </div>
            <div class="status-detail-effects"><h4>完整效果</h4>${effectsHTML || '<div class="status-no-effect">没有额外数值效果，仅保留层数或特殊状态规则。</div>'}</div>
          </div>
        </div>
      </div>
    `);

    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(modal);

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
      const activationLabel = target === 'enemy' ? '我方欲望满时' : '敌方欲望满时';
      const displayContext =
        target === 'enemy'
          ? { selfLabel: '自身', opponentLabel: '对方', sourceSide: 'enemy' }
          : { selfLabel: '自身', opponentLabel: '敌方' };
      const effectTagsHTML = BattleUI.effectDisplay.createEffectTagsHTML(
        BattleUI.effectDisplay.programToTags(lustEffect.effectProgram, displayContext),
      );

      const description = typeof lustEffect.description === 'string' ? lustEffect.description.trim() : '';
      const effectHTML = `
        <div class="lust-effect-container">
          <span class="lust-effect-label">${activationLabel}：</span>
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
          BattleUI.showSupportDetails($(this), lustEffect, target === 'enemy' ? '敌方欲望效果 · 我方欲望满时触发' : '我方欲望效果 · 敌方欲望满时触发');
        });
    } else {
      container.empty();
    }
  }
}
