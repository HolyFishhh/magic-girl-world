import { COMBAT_ACTION_TIMING, startCombatActionTiming } from './combatActionTiming';
import {
  roundBattleDisplayValue,
  type Card,
  type EffectNode,
  type EffectProgram,
  type ResolvedSummonAction,
  type StatusEffect,
  type SummonUnit,
} from '../../game-core';
import { escapeHtml } from '../shared/html';

export type CombatActionKind = 'attack' | 'skill' | 'power' | 'event' | 'curse' | 'relic' | 'enemy';
export type CombatAnimationTarget = 'self' | 'opponent';

function collectImmediateTargets(nodes: readonly EffectNode[], targets: Set<CombatAnimationTarget>): void {
  for (const node of nodes) {
    if ('target' in node && (node.target === 'self' || node.target === 'opponent')) targets.add(node.target);
    if (node.op === 'if') {
      collectImmediateTargets(node.then, targets);
      if (node.else) collectImmediateTargets(node.else, targets);
    }
  }
}

/** Resolve where a card/action animation should appear without duplicating effect execution rules. */
export function resolveCombatAnimationTarget(
  program: EffectProgram | null | undefined,
  kind: CombatActionKind,
): CombatAnimationTarget {
  if (kind === 'attack' || kind === 'enemy') return 'opponent';
  const targets = new Set<CombatAnimationTarget>();
  collectImmediateTargets(program?.steps || [], targets);
  return targets.has('opponent') ? 'opponent' : 'self';
}

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

  // 舞台效果共用一个短队列：先出现卡牌/行动，再依次显示实际结算。
  private damageQueue: Array<{
    target: 'player' | 'enemy';
    icon: string;
    text: string;
    tone: 'damage' | 'heal' | 'lust' | 'block' | 'energy' | 'status' | 'resource';
    magnitude: number;
    timestamp: number;
    anchor?: { x: number; y: number };
  }> = [];
  private lastDamageTime = 0;
  private lastActionStartedAt = 0;
  private damageTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DAMAGE_INTERVAL = 95;
  private readonly ACTION_LEAD_IN = 150;
  private stageActionPresentation: Promise<void> = Promise.resolve();
  // The stage is re-rendered often. Keep visual history by a stable combatant
  // identity, never by whichever enemy happens to be selected in the detail HUD.
  private readonly stageHealthSnapshots = new Map<string, { percent: number; block: number }>();
  private readonly stageHealthLosses = new Map<string, { from: number; to: number; startedAt: number }>();
  private readonly HEALTH_LOSS_DURATION = 320;

  /** Clear only cosmetic battle nodes before exchanging the scene for rewards. */
  public clearTransientEffects(): void {
    this.damageQueue.length = 0;
    if (this.damageTimer !== null) {
      clearTimeout(this.damageTimer);
      this.damageTimer = null;
    }
    this.lastDamageTime = 0;
    this.lastActionStartedAt = 0;
    this.stageActionPresentation = Promise.resolve();
    $('#battle-stage .physics-damage, #battle-stage .stage-action-token, #battle-stage .enemy-departure').remove();
    $('#battle-scene .mwg-desire-burst, #battle-scene .status-apply-effect, #battle-scene .battle-notification, #battle-scene .turn-banner, #battle-scene .action-banner').remove();
    $('.player-card, .enemy-card, .stage-emoji').removeClass('damage-flash lust-flash both-flash stage-acting stage-channeling');
  }

  private displayBattleValue(value: number): number {
    return roundBattleDisplayValue(value);
  }

  /**
   * 显示伤害数字动画 - 抛物线物理效果
   */
  showDamageNumber(
    target: 'player' | 'enemy',
    damage: number,
    type: 'damage' | 'heal' | 'lust' | 'block' = 'damage',
    enemyId?: string,
  ): void {
    const definitions = {
      damage: { icon: '💥', prefix: '-', tone: 'damage' },
      heal: { icon: '💚', prefix: '+', tone: 'heal' },
      lust: { icon: '💗', prefix: '+', tone: 'lust' },
      block: { icon: '🛡️', prefix: '+', tone: 'block' },
    } as const;
    const definition = definitions[type];
    this.enqueueStageEffect(
      target,
      definition.icon,
      `${definition.prefix}${this.displayBattleValue(Math.abs(damage))}`,
      definition.tone,
      Math.abs(damage),
      enemyId,
    );
  }

  public showStageEffect(
    target: 'player' | 'enemy',
    icon: string,
    change: number,
    tone: 'heal' | 'lust' | 'block' | 'energy' | 'status' | 'resource',
    label = '',
  ): void {
    if (!Number.isFinite(change) || change === 0) return;
    const prefix = change > 0 ? '+' : '-';
    const value = `${prefix}${this.displayBattleValue(Math.abs(change))}`;
    this.enqueueStageEffect(target, icon, label ? `${label} ${value}` : value, tone, Math.abs(change));
  }

  public showStatusEffect(
    target: 'player' | 'enemy',
    emoji: string,
    name: string,
    stacks: number,
    isApply: boolean,
    enemyId?: string,
  ): void {
    const suffix = stacks > 0 ? ` ${isApply ? '+' : '-'}${this.displayBattleValue(stacks)}` : '';
    this.enqueueStageEffect(target, emoji || '✨', `${name}${suffix}`, 'status', Math.max(1, stacks), enemyId);
  }

  private enqueueStageEffect(
    target: 'player' | 'enemy',
    icon: string,
    text: string,
    tone: 'damage' | 'heal' | 'lust' | 'block' | 'energy' | 'status' | 'resource',
    magnitude: number,
    enemyId?: string,
  ): void {
    const stage = $('#battle-stage').get(0);
    const actor = target === 'player' ? $('#stage-player-emoji').get(0) : enemyId
      ? $('#stage-enemy-party .stage-enemy-member').filter((_, e) => e.dataset.enemyId === enemyId).find('.stage-emoji').get(0)
      : $('#stage-enemy-emoji').get(0);
    const stageRect = stage?.getBoundingClientRect(), rect = actor?.getBoundingClientRect();
    const anchor = stageRect && rect ? { x: rect.left - stageRect.left + rect.width / 2, y: rect.top - stageRect.top + rect.height * .35 } : undefined;
    // HP/lust feedback is emitted by committed effect events. Never put it behind
    // cosmetic resource/status notifications: bars and numbers must agree at contact.
    if (tone === 'damage' || tone === 'heal' || tone === 'lust' || tone === 'block') {
      this.createPhysicalDamageAnimation({ target, icon, text, tone, magnitude, anchor });
      return;
    }
    this.damageQueue.push({ target, icon, text, tone, magnitude, timestamp: Date.now(), anchor });
    this.processDamageQueue();
  }

  private processDamageQueue(): void {
    if (this.damageQueue.length === 0) return;

    const now = Date.now();
    const readyAt = Math.max(this.lastDamageTime + this.DAMAGE_INTERVAL, this.lastActionStartedAt + this.ACTION_LEAD_IN);
    if (now < readyAt) {
      // One shared timer drains the queue; one timer per event grows rapidly on
      // multi-hit/status-heavy turns and was the main source of late-battle lag.
      if (this.damageTimer === null) {
        const remaining = Math.max(0, readyAt - now);
        this.damageTimer = setTimeout(() => {
          this.damageTimer = null;
          this.processDamageQueue();
        }, remaining);
      }
      return;
    }

    const damageData = this.damageQueue.shift();
    if (!damageData) return;

    this.lastDamageTime = now;
    this.createPhysicalDamageAnimation(damageData);

    // 继续处理队列
    if (this.damageQueue.length > 0 && this.damageTimer === null) {
      this.damageTimer = setTimeout(() => {
        this.damageTimer = null;
        this.processDamageQueue();
      }, this.DAMAGE_INTERVAL);
    }
  }

  private createPhysicalDamageAnimation(
    effect: {
      target: 'player' | 'enemy'; icon: string; text: string;
      tone: 'damage' | 'heal' | 'lust' | 'block' | 'energy' | 'status' | 'resource'; magnitude: number; anchor?: { x: number; y: number };
    },
  ): void {
    const stage = $('#battle-stage');
    const targetElement = effect.target === 'player' ? $('#stage-player-emoji') : $('#stage-enemy-emoji');
    if (stage.length === 0 || (!effect.anchor && targetElement.length === 0)) return;

    const stageRect = stage.get(0)!.getBoundingClientRect();
    const targetRect = targetElement.get(0)?.getBoundingClientRect();
    const anchor = effect.anchor || { x: targetRect!.left - stageRect.left + targetRect!.width / 2, y: targetRect!.top - stageRect.top + targetRect!.height * .35 };
    const randomX = anchor.x + (Math.random() - 0.5) * 18;
    const randomY = anchor.y + (Math.random() - 0.5) * 10;

    const damageText = $(`
      <div class="physics-damage stage-effect-pop tone-${effect.tone}" style="
        position: absolute;
        left: ${randomX}px;
        top: ${randomY}px;
      ">
        <span>${escapeHtml(effect.icon)}</span><b>${escapeHtml(effect.text)}</b>
      </div>
    `);

    stage.append(damageText);

    // A short compositor animation is cheaper than one requestAnimationFrame
    // loop per number and never blocks rapid card play.
    const driftX = Math.round((Math.random() - 0.5) * 36);
    damageText.css({ '--damage-drift-x': `${driftX}px` });
    damageText.addClass('physics-damage-active');
    setTimeout(() => damageText.remove(), 620);
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
  showEnemyDamageEffect(type: 'damage' | 'lust' | 'both' = 'damage', enemyId?: string): void {
    const enemyCard = enemyId ? $('#stage-enemy-party .stage-enemy-member').filter((_, e) => e.dataset.enemyId === enemyId) : $('.enemy-card, #stage-enemy-party .stage-enemy-member.is-active');

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

  /** Keep the actor at its original slot until the hit queue and fade finish. */
  async animateEnemyDefeat(enemyId: string): Promise<void> {
    const member = $('#stage-enemy-party .stage-enemy-member').filter((_, e) => e.dataset.enemyId === enemyId);
    if (!member.length) return;
    // The lethal result is authoritative. Start the departure immediately;
    // waiting on a previous action's impact queue leaves a dead enemy visible.
    $('#stage-enemy-party .stage-enemy-member').filter((_, e) => e.dataset.enemyId === enemyId)
      .addClass('enemy-departing').attr('aria-disabled', 'true');
  }

  async animateEnemyEscape(enemyId: string): Promise<void> {
    const member = $('#stage-enemy-party .stage-enemy-member').filter((_, e) => e.dataset.enemyId === enemyId);
    if (!member.length) return;
    member.addClass('enemy-escaping').attr('aria-label', '敌人正在逃跑');
    await new Promise<void>(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; window.clearTimeout(timer); member.off('animationend.mwgEscape', onEnd); member.removeClass('enemy-escaping').attr('data-escape-complete', 'true').css('visibility','hidden'); resolve(); };
      const onEnd = (event: JQuery.TriggeredEvent) => { if (event.target === member.get(0) && (event.originalEvent as AnimationEvent)?.animationName === 'mwg-enemy-escape') finish(); };
      const timer = window.setTimeout(finish, 950);
      member.on('animationend.mwgEscape', onEnd);
    });
  }

  /** Preserve a defeated actor briefly after state has removed it from the roster. */
  showEnemyDeparture(member: JQuery): void {
    const stage = $('#battle-stage');
    const source = member.get(0);
    if (!stage.length || !source || member.is('.enemy-departure') || member.attr('data-escape-complete') === 'true') return;
    const stageRect = stage.get(0)!.getBoundingClientRect();
    const rect = source.getBoundingClientRect();
    const ghost = member.clone(false)
      .removeClass('enemy-departing')
      .addClass('enemy-departure')
      .attr('aria-hidden', 'true')
      .attr('tabindex', '-1')
      .prop('disabled', true)
      .css({ left: `${rect.left - stageRect.left}px`, top: `${rect.top - stageRect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    // The overlay lives outside .stage-enemy. Freeze computed appearance so
    // ancestor-dependent intent/health/emoji styles do not turn into a bare button.
    const originals = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))];
    const copies = [ghost.get(0)!, ...Array.from(ghost.get(0)!.querySelectorAll<HTMLElement>('*'))];
    originals.forEach((element, index) => {
      const style = getComputedStyle(element);
      for (const property of Array.from(style)) copies[index].style.setProperty(property, style.getPropertyValue(property));
      copies[index].style.animation = 'none';
      copies[index].style.transition = 'none';
    });
    ghost.css({ position: 'absolute', margin: 0, transform: 'none', inset: 'auto', gridArea: 'auto', alignSelf: 'auto', justifySelf: 'auto', boxSizing: 'border-box', pointerEvents: 'none', zIndex: 30,
      left: String(rect.left - stageRect.left) + 'px', top: String(rect.top - stageRect.top) + 'px', width: String(rect.width) + 'px', height: String(rect.height) + 'px' });
    ghost.get(0)!.style.removeProperty('animation');
    ghost.removeAttr('id data-enemy-id data-stage-slot');
    ghost.find('[id]').removeAttr('id');
    stage.append(ghost);
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
      ghost.stop(true, false).remove();
    };
    const depart = () => {
      ghost.removeClass('damage-flash both-flash lust-flash');
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
      ghost.addClass('enemy-departing');
      ghost.one('animationend webkitAnimationEnd', cleanup);
      // A reduced-motion stylesheet, detached stage, or interrupted CSS
      // animation may never dispatch animationend. Never leave a corpse node.
      cleanupTimer = setTimeout(cleanup, 1700);
    };
    depart();
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
  private stageHealthKey(target: 'player' | 'enemy', stableId?: string): string {
    return `${target}:${stableId || target}`;
  }

  /** Resolves when the currently visible stage-action token has left the theater. */
  public waitForActionPresentation(): Promise<void> { return this.stageActionPresentation; }

  public syncStageHealthBar(target: 'player' | 'enemy', currentHp: number, maxHp: number, stableId?: string, block = 0): void {
    const percent = maxHp > 0 ? Math.max(0, Math.min(100, currentHp / maxHp * 100)) : 0;
    this.stageHealthSnapshots.set(this.stageHealthKey(target, stableId), { percent, block: Math.max(0, block) });
  }

  public syncSummonHealthBar(owner: 'player' | 'enemy', summonId: string, currentHp: number, maxHp: number, block = 0): void {
    const percent = maxHp > 0 ? Math.max(0, Math.min(100, currentHp / maxHp * 100)) : 0;
    this.stageHealthSnapshots.set(`summon:${owner}:${summonId}`, { percent, block: Math.max(0, block) });
  }

  private animateStageLoss(key: string, loss: JQuery<HTMLElement>, from: number, to: number, startedAt = Date.now()): void {
    const elapsed = Math.max(0, Date.now() - startedAt);
    const progress = Math.min(1, elapsed / this.HEALTH_LOSS_DURATION);
    if (progress >= 1) { this.stageHealthLosses.delete(key); loss.stop(true, true).css({ width: `${to}%`, opacity: 0 }); return; }
    const visibleFrom = from + (to - from) * progress;
    const remaining = Math.max(1, this.HEALTH_LOSS_DURATION - elapsed);
    this.stageHealthLosses.set(key, { from, to, startedAt });
    loss.stop(true, true).css({ width: `${visibleFrom}%`, opacity: .62 * (1 - progress) })
      .animate({ width: `${to}%`, opacity: 0 }, remaining, () => {
        if (this.stageHealthLosses.get(key)?.startedAt === startedAt) this.stageHealthLosses.delete(key);
        loss.css({ width: `${to}%` });
      });
  }

  /** Reattach any in-flight loss layer after BattleUI's keyed actor markup refresh. */
  public restoreStageHealthLoss(target: 'player' | 'enemy', stableId?: string): void {
    const key = this.stageHealthKey(target, stableId), pending = this.stageHealthLosses.get(key);
    if (pending) this.animateStageLoss(key, this.stageHealthElement(target, stableId).find('.stage-health-loss'), pending.from, pending.to, pending.startedAt);
  }

  public restoreSummonHealthLoss(owner: 'player' | 'enemy', summonId: string): void {
    const key = `summon:${owner}:${summonId}`, pending = this.stageHealthLosses.get(key);
    if (!pending) return;
    const loss = $(`#${owner}-summons .stage-summon-unit`).filter((_, element) => element.dataset.summonId === summonId).find('.stage-health-loss');
    this.animateStageLoss(key, loss, pending.from, pending.to, pending.startedAt);
  }

  public updateSummonHealthBar(owner: 'player' | 'enemy', summonId: string, currentHp: number, maxHp: number, block = 0): void {
    const key = `summon:${owner}:${summonId}`;
    const percent = maxHp > 0 ? Math.max(0, Math.min(100, currentHp / maxHp * 100)) : 0;
    const previous = this.stageHealthSnapshots.get(key);
    const health = $(`#${owner}-summons .stage-summon-unit`).filter((_, element) => element.dataset.summonId === summonId).find('.stage-unit-health');
    const loss = health.find('.stage-health-loss');
    if (previous && percent < previous.percent) {
      this.animateStageLoss(key, loss, previous.percent, percent);
    } else loss.stop(true, true).css({ width: `${percent}%`, opacity: 0 });
    health.find('.stage-health-current').stop(true, true).css({ width: `${percent}%` });
    health.find('b').text(`${this.displayBattleValue(currentHp)}/${this.displayBattleValue(maxHp)}`);
    this.syncSummonHealthBar(owner, summonId, currentHp, maxHp, block);
  }

  private stageHealthElement(target: 'player' | 'enemy', stableId?: string): JQuery<HTMLElement> {
    if (target === 'player') return $('#stage-player-health .stage-unit-health');
    if (!stableId) return $('#stage-enemy-emoji').closest('.stage-enemy-member').find('.stage-unit-health');
    return $('#stage-enemy-party .stage-enemy-member').filter((_, element) => element.dataset.enemyId === stableId).find('.stage-unit-health');
  }

  private detailedHealthFill(target: 'player' | 'enemy', stableId?: string): JQuery<HTMLElement> {
    if (target === 'enemy' && stableId && $('#stage-enemy-party .is-active').attr('data-enemy-id') !== stableId) return $();
    return target === 'player' ? $('.player-card .hp-fill') : $('.enemy-card .hp-fill');
  }

  updateHealthBarWithAnimation(target: 'player' | 'enemy', currentHp: number, maxHp: number, stableId?: string, block = 0, previousHp?: number): void {
    const hpPercent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0;
    const stageKey = this.stageHealthKey(target, stableId);
    const previous = this.stageHealthSnapshots.get(stageKey);
    const previousPercent = previousHp === undefined ? previous?.percent
      : maxHp > 0 ? Math.max(0, Math.min(100, previousHp / maxHp * 100)) : 0;
    const stageHealth = this.stageHealthElement(target, stableId);
    const currentStage = stageHealth.find('.stage-health-current');
    const lossStage = stageHealth.find('.stage-health-loss');
    if (previousPercent !== undefined && hpPercent < previousPercent) {
      this.animateStageLoss(stageKey, lossStage, previousPercent, Math.max(0, hpPercent));
    } else {
      lossStage.stop(true, true).css({ width: `${Math.max(0, hpPercent)}%`, opacity: 0 });
    }
    currentStage.stop(true, true).css({ width: `${Math.max(0, hpPercent)}%` });
    stageHealth.find('b').text(`${this.displayBattleValue(currentHp)}/${this.displayBattleValue(maxHp)}`);
    this.syncStageHealthBar(target, currentHp, maxHp, stableId, block);

    // The detailed HUD only represents the player and currently selected enemy.
    // Never let an off-target enemy's queued animation overwrite that detail view.
    const hpBar = this.detailedHealthFill(target, stableId);
    const detailedLoss = hpBar.parent().find('.hp-loss');
    if (hpBar.length && detailedLoss.length) {
      if (previousPercent !== undefined && hpPercent < previousPercent) {
        detailedLoss.stop(true, true).css({ width: `${previousPercent}%`, opacity: .62 })
          .animate({ width: `${Math.max(0, hpPercent)}%`, opacity: 0 }, 320, () => detailedLoss.css({ width: `${Math.max(0, hpPercent)}%` }));
      } else detailedLoss.stop(true, true).css({ width: `${Math.max(0, hpPercent)}%`, opacity: 0 });

    }
    // Current HP does not depend on the optional loss overlay being mounted.
    hpBar.stop(true, true).css({ width: `${Math.max(0, Math.min(100, hpPercent))}%` });
    const hpTextSelector = target === 'player' ? '.player-card #player-hp' : '.enemy-card #enemy-hp';
    if (hpBar.length) $(hpTextSelector).text(`${this.displayBattleValue(currentHp)}/${this.displayBattleValue(maxHp)}`);

    // 根据血量百分比改变血条颜色
    hpBar.removeClass('hp-low hp-critical');
    if (hpPercent <= 25) {
      hpBar.addClass('hp-critical');
    } else if (hpPercent <= 50) {
      hpBar.addClass('hp-low');
    }
  }

  public showShieldBreak(target: 'player' | 'enemy', stableId?: string): void {
    const row = this.stageHealthElement(target, stableId).closest('.stage-health-row');
    if (!row.length) return;
    row.removeClass('is-shield-break');
    // Reflow lets consecutive, independent shield breaks replay without
    // reusing a target selected after the original impact.
    void row.get(0)?.offsetWidth;
    row.addClass('is-shield-break');
    window.setTimeout(() => row.removeClass('is-shield-break'), 420);
    const detail = this.detailedHealthFill(target, stableId).parent();
    detail.removeClass('is-shield-break'); void detail.get(0)?.offsetWidth;
    detail.addClass('is-shield-break');
    window.setTimeout(() => detail.removeClass('is-shield-break'), 420);
  }

  public showSummonShieldBreak(owner: 'player' | 'enemy', summonId: string): void {
    const row = $(`#${owner}-summons .stage-summon-unit`).filter((_, element) => element.dataset.summonId === summonId)
      .find('.stage-health-row');
    if (!row.length) return;
    row.removeClass('is-shield-break'); void row.get(0)?.offsetWidth;
    row.addClass('is-shield-break');
    window.setTimeout(() => row.removeClass('is-shield-break'), 420);
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
    $(lustTextSelector).text(`${this.displayBattleValue(currentLust)}/${this.displayBattleValue(maxLust)}`);

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
  async animateCardPlay(cardElement: JQuery, card?: Card): Promise<void> {
    $('.card-tooltip').stop(true, true).remove();
    const resolved = card || (cardElement.data('cardData') as Card | undefined);
    const kindByType: Record<string, CombatActionKind> = {
      Attack: 'attack',
      Skill: 'skill',
      Power: 'power',
      Event: 'event',
      Curse: 'curse',
    };
    const flightInProgress = cardElement.hasClass('card-cast-flight');
    if (!flightInProgress) cardElement.addClass('card-playing').css({ opacity: 0.45, transform: 'translateY(-18px) scale(1.04)' });
    const presentation = this.playCombatAction(
      'player',
      kindByType[resolved?.type || 'Skill'] || 'skill',
      resolved?.emoji || '🃏',
      resolved?.name || '使用卡牌',
      resolveCombatAnimationTarget(
        resolved?.effectProgram,
        kindByType[resolved?.type || 'Skill'] || 'skill',
      ),
    );
    window.setTimeout(() => {
      if (flightInProgress) return;
      cardElement.removeClass('card-playing').css({ opacity: '', transform: '' });
    }, 420);
    await presentation;
  }

  /** Render one bounded action in the central stage without covering the hand or combatants. */
  public playCombatAction(
    source: 'player' | 'enemy',
    kind: CombatActionKind,
    emoji: string,
    name: string,
    animationTarget: CombatAnimationTarget = kind === 'attack' || kind === 'enemy' ? 'opponent' : 'self',
    sourceAnchor?: JQuery,
  ): Promise<void> {
    const stage = $('#battle-stage');
    const sourceElement = sourceAnchor?.length
      ? sourceAnchor
      : source === 'player' ? $('#stage-player-emoji') : $('#stage-enemy-emoji');
    const targetElement = source === 'player' ? $('#stage-enemy-emoji') : $('#stage-player-emoji');
    if (stage.length === 0 || sourceElement.length === 0 || targetElement.length === 0) return Promise.resolve();
    this.lastActionStartedAt = Date.now();

    const crossesStage = kind === 'attack' || kind === 'enemy';
    const visualTarget = crossesStage || animationTarget === 'opponent' ? targetElement : sourceElement;
    const token = $('<div class="stage-action-token"></div>')
      .addClass(
        `action-${kind} source-${source} target-${animationTarget} ${crossesStage ? 'stage-crossing' : 'stage-aura'}`,
      )
      .attr('aria-label', name || '战斗行动')
      .text(emoji || (source === 'player' ? '✨' : '👹'));
    stage.append(token);

    const stageOffset = stage.offset();
    const sourceOffset = sourceElement.offset();
    const targetOffset = targetElement.offset();
    const visualTargetOffset = visualTarget.offset();
    if (!stageOffset || !sourceOffset || !targetOffset || !visualTargetOffset) {
      token.remove();
      return Promise.resolve();
    }

    const tokenSize = 44;
    const originOffset = crossesStage ? sourceOffset : visualTargetOffset;
    const originElement = crossesStage ? sourceElement : visualTarget;
    const startX = originOffset.left - stageOffset.left + (originElement.outerWidth() || 0) / 2 - tokenSize / 2;
    const startY = originOffset.top - stageOffset.top + (originElement.outerHeight() || 0) / 2 - tokenSize / 2;
    const targetX = targetOffset.left - stageOffset.left + (targetElement.outerWidth() || 0) / 2 - tokenSize / 2;
    const targetY = targetOffset.top - stageOffset.top + (targetElement.outerHeight() || 0) / 2 - tokenSize / 2;
    const deltaX = crossesStage ? (targetX - startX) : 0;
    const deltaY = crossesStage ? (targetY - startY) : -24;
    const rotation = source === 'player' ? 10 : -10;
    token.css({
      left: startX,
      top: startY,
      opacity: 1,
      '--stage-dx': `${deltaX}px`,
      '--stage-dy': `${deltaY}px`,
      '--stage-rotation': `${rotation}deg`,
    });
    sourceElement.addClass(crossesStage ? 'stage-acting' : 'stage-channeling');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const timing = crossesStage ? COMBAT_ACTION_TIMING.crossing : COMBAT_ACTION_TIMING.aura;
    token.css('--stage-duration', `${reducedMotion ? 1 : timing.duration}ms`);
    const presentation = startCombatActionTiming({
      crossing: crossesStage, reducedMotion,
      frame: callback => document.hidden ? window.setTimeout(callback, 0) : requestAnimationFrame(callback),
      delay: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
      start: () => { token.addClass('is-running'); },
      cleanup: () => { token.remove(); sourceElement.removeClass('stage-acting stage-channeling'); },
    });
    this.stageActionPresentation = presentation.finished;
    return presentation.impact;
  }

  /** A summon acts from its own stage emoji instead of borrowing the owner's portrait. */
  public playSummonAction(unit: SummonUnit, action: ResolvedSummonAction): Promise<void> {
    const sourceAnchor = $('.stage-summon-unit').filter((_, element) =>
      String($(element).attr('data-summon-id') || '') === unit.instanceId,
    ).first();
    const animationTarget = resolveCombatAnimationTarget(action.effectProgram, 'skill');
    const kind: CombatActionKind = animationTarget === 'opponent' ? 'attack' : 'skill';
    return this.playCombatAction(
      unit.owner,
      kind,
      action.emoji || unit.emoji,
      action.name,
      animationTarget,
      sourceAnchor,
    );
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
        <div style="color: #ffd700; margin-bottom: 5px;">${escapeHtml(cardName)}</div>
        <div style="color: #ffaa00; font-size: 14px;">${escapeHtml(reason)}</div>
      </div>
    `);

    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(notification);

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
        ${escapeHtml(text)}
      </div>
    `);

    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(turnBanner);

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
        ${escapeHtml(text)}
      </div>
    `);

    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(actionBanner);

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
  showLustOverflowEffect(target: 'player' | 'enemy', _effectName: string): void {
    const overlay = $('<div class="mwg-desire-burst" aria-hidden="true"><i></i><i></i><i></i></div>');
    overlay.attr('data-owner', target);
    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(overlay);
    setTimeout(() => overlay.remove(), 2200);
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
  showEnemyActionAnimation(
    actionName: string,
    description: string,
    kind: CombatActionKind = 'enemy',
    emoji = '',
    program?: EffectProgram,
  ): Promise<void> {
    const enemyEmoji = emoji || String($('#stage-enemy-emoji').text() || '👹');
    const caption = description ? `${actionName}：${description}` : actionName;
    return this.playCombatAction('enemy', kind, enemyEmoji, caption, resolveCombatAnimationTarget(program, kind));
  }
  /**
   * 播放卡牌使用动画（根据卡名选取元素，带飞行与命中闪烁）
   */
  public async playCardAnimation(card: Card, targetSelector: string): Promise<void> {
    const cardElement = $('.card')
      .filter((_, element) => $(element).find('.card-name').text() === card.name)
      .first();
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
    const isPlayer = /player|self/i.test(targetSelector) && !/enemy|opponent/i.test(targetSelector);
    this.showDamageNumber(isPlayer ? 'player' : 'enemy', Math.abs(value), type);
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
      const statusIcon = $(`<div class="status-apply-effect">${escapeHtml(status.emoji)}</div>`);
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
      const tempCard = $(`<div class="card-drawing">${escapeHtml(card.emoji || '🃏')}</div>`);
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
