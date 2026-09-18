import { showBattleDialogue } from './battleDialogue';
import { isolatedPresenter } from '../core/isolatedBattlePresentation';
import {
  normalizeCardCost,
  resourcePoolFromCombatant,
  resolveCardResourcePayment,
  type BattleEndResult,
  type CardCost,
  type CardResourcePayment,
  type ResolvedSummonAction,
  type SummonUnit,
} from '../../game-core';
import { BattleLog } from '../modules/battleLog';
import type { Player } from '../../game-core';
import { AnimationManager } from './animationManager';
import { LustOverflowDisplay, type LustOverflowEffect } from './lustOverflowDisplay';

export interface BattleEndDialogRequest {
  result: BattleEndResult;
  battleSummary: string;
  narrativeText?: string;
  mode?: 'story' | 'tower';
  onConfirm(playerContinuation: string): Promise<void>;
  onRestart?: () => Promise<void>;
}
export function shouldAutoConfirmTowerVictory(request: Pick<BattleEndDialogRequest, 'mode' | 'result'>): boolean {
  return request.mode === 'tower' && request.result === 'victory';
}

export type BattleEffectLogType = 'info' | 'damage' | 'heal' | 'action' | 'system';
export type BattleEffectLogSource = {
  type: 'card' | 'relic' | 'ability' | 'status';
  name: string;
  details?: string;
};

export interface CardPaymentPreview {
  ok: boolean;
  effectiveCost?: CardCost;
  payment?: CardResourcePayment;
}

/** Owns every direct battle-effect presentation side effect inside the Tavern iframe. */
export class TavernBattleEffectPresenter {
  private static instance: TavernBattleEffectPresenter;
  private readonly animationManager = AnimationManager.getInstance();
  private readonly lustOverflowDisplay = LustOverflowDisplay.getInstance();

  public static getInstance(): TavernBattleEffectPresenter {
    const isolated = isolatedPresenter<TavernBattleEffectPresenter>('effects');
    if (isolated) return isolated;
    if (!TavernBattleEffectPresenter.instance) {
      TavernBattleEffectPresenter.instance = new TavernBattleEffectPresenter();
    }
    return TavernBattleEffectPresenter.instance;
  }

  public showDialogue(text: string, speaker?: string): void { showBattleDialogue(text, speaker); }

  public addLog(message: string, type: BattleEffectLogType = 'info', source?: BattleEffectLogSource): void {
    BattleLog.addLog(message, type, source);
  }

  public logStatusEffect(target: string, statusName: string, stacks: number, duration: number, isApply = true, emoji = '✨', enemyId?: string): void {
    BattleLog.logStatusEffect(target, statusName, stacks, duration, isApply);
    if (target === '玩家' || target === '敌人') {
      this.animationManager.showStatusEffect(target === '玩家' ? 'player' : 'enemy', emoji, statusName, stacks, isApply, enemyId);
    }
  }

  public logLustOverflow(target: string, effectName: string): void {
    BattleLog.logLustOverflow(target, effectName);
  }

  public showBlockAbsorption(target: 'player' | 'enemy', amount: number): void {
    try {
      this.animationManager.showStageEffect(target, '🛡️', -Math.abs(amount), 'block');
    } catch (error) {
      console.warn('显示格挡抵消动画失败:', error);
    }
  }

  public showBlockChange(target: 'player' | 'enemy', change: number, previousValue?: number, nextValue?: number, enemyId?: string): void {
    this.animationManager.showStageEffect(target, '🛡️', change, 'block');
    if (change < 0 && (previousValue || 0) > 0 && (nextValue || 0) <= 0) this.animationManager.showShieldBreak(target, enemyId);
  }

  public showEnergyChange(target: 'player' | 'enemy', change: number): void {
    this.animationManager.showStageEffect(target, '⚡', change, 'energy');
  }

  public showResourceChange(target: 'player' | 'enemy', emoji: string, change: number): void {
    this.animationManager.showStageEffect(target, emoji || '◆', change, 'resource');
  }

  public showSummonAction(unit: SummonUnit, action: ResolvedSummonAction): Promise<void> {
    if (action.dialogue) {
      this.addLog(`${unit.name}：${action.dialogue}`, 'action');
      showBattleDialogue(action.dialogue, { actor: 'summon', id: unit.instanceId, name: unit.name });
    }
    return this.animationManager.playSummonAction(unit, action);
  }

  /** Live theater waits for the started token; isolated evaluation has no DOM and returns immediately. */
  public async waitForActionPresentation(): Promise<void> {
    if (typeof document === 'undefined' || !document.querySelector('#battle-stage')) return;
    await this.animationManager.waitForActionPresentation();
  }

  public async showEnemyDefeat(enemyId: string): Promise<void> { await this.animationManager.animateEnemyDefeat(enemyId); }

  public showHealthChange(target: 'player' | 'enemy', change: number, currentHp: number, maxHp: number, enemyId?: string, previousHp?: number, block?: number): void {
    try {
      this.animationManager.showDamageNumber(target, Math.abs(change), change < 0 ? 'damage' : 'heal', enemyId);
      this.animationManager.updateHealthBarWithAnimation(target, currentHp, maxHp, enemyId, block || 0, previousHp);
      if (change < 0) {
        if (target === 'player') this.animationManager.showPlayerDamageEffect('damage');
        else this.animationManager.showEnemyDamageEffect('damage', enemyId);
      }
    } catch (error) {
      console.warn('显示生命变化动画失败:', error);
    }
  }

  public showLustChange(target: 'player' | 'enemy', change: number, currentLust: number, maxLust: number): void {
    try {
      this.animationManager.showDamageNumber(target, Math.abs(change), change > 0 ? 'lust' : 'heal');
      this.animationManager.updateLustBarWithAnimation(target, currentLust, maxLust);
    } catch (error) {
      console.warn('显示欲望变化动画失败:', error);
    }
  }

  public showLustOverflow(target: 'player' | 'enemy', effect: LustOverflowEffect): void {
    try {
      this.animationManager.showLustEffectFlash();
      if (target === 'player') this.lustOverflowDisplay.showPlayerLustOverflow(effect);
      else this.lustOverflowDisplay.showEnemyLustOverflow(effect);
    } catch (error) {
      console.warn('显示欲望溢出动画失败:', error);
    }
  }

  public refreshPlayerEnergy(player: Player, previewCard?: (cardId: string) => CardPaymentPreview): void {
    window.setTimeout(() => {
      try {
        $('#player-energy').text(`${player.energy || 0}/${player.maxEnergy || 3}`);
        for (const resource of Object.values(player.resources || {})) {
          const chip = $(`#player-combat-resources .combat-resource-chip[data-resource-id="${resource.id}"]`);
          chip.find('b').text(`${resource.current}/${resource.max}`);
        }
        const pool = resourcePoolFromCombatant(player.energy, player.resources);
        for (const card of player.hand || []) {
          const cardElement = $('.card').filter((_, element) => String($(element).data('card-id')) === card.id);
          if (cardElement.length === 0) continue;
          const preview = previewCard?.(card.id);
          const payment = preview?.payment || resolveCardResourcePayment(
            preview?.effectiveCost ?? card.cost,
            pool,
            undefined,
            card.xValueBonus,
          );
          const canAfford = preview ? preview.ok : payment.affordable;
          cardElement.toggleClass('clickable', canAfford).toggleClass('unaffordable', !canAfford);
          cardElement.find('.card-cost').toggleClass('insufficient-cost', !canAfford);
          const components = normalizeCardCost(preview?.effectiveCost ?? card.cost);
          cardElement.find('.card-cost-component').each((_, element) => {
            const resourceId = String($(element).attr('data-resource-id') || '');
            const amount = components[resourceId];
            const waived = payment.waived.includes(resourceId);
            $(element).toggleClass('waived', waived);
            if (waived) $(element).text(`免${resourceId === 'energy' ? '💎' : player.resources?.[resourceId]?.emoji || '◆'}`);
            $(element).toggleClass(
              'insufficient',
              !waived && typeof amount === 'number' && amount > (pool[resourceId] || 0),
            );
          });
        }
      } catch (error) {
        console.warn('刷新能量界面失败:', error);
      }
    }, 10);
  }

  public hasBattleEndDialog(): boolean {
    return $('.battle-end-dialog').length > 0;
  }

  public showBattleEndDialog(request: BattleEndDialogRequest): void {
    if (this.hasBattleEndDialog()) return;
    const presentation =
      request.result === 'terminated'
        ? { text: '战斗终止', emoji: '🕊️', color: '#546e7a' }
        : request.result === 'victory'
          ? { text: '胜利', emoji: '🎉', color: '#4CAF50' }
          : { text: '失败', emoji: '💀', color: '#f44336' };
    const towerMode = request.mode === 'tower', autoReward = shouldAutoConfirmTowerVictory(request);
    const dialog = $(`
      <div class="battle-end-dialog result-${request.result}${autoReward ? ' is-victory-transition' : ''}" style="--result-color:${presentation.color}" role="dialog" aria-modal="true" aria-label="战斗结束">
        <div class="battle-end-backdrop"></div>
        <section class="battle-end-panel">
          <header class="battle-end-header">
            <span class="battle-end-emblem" aria-hidden="true">${presentation.emoji}</span>
            <div>
              <h2>${autoReward ? '胜 利' : '战斗结束'}</h2>
              <div class="battle-end-result">结果：${presentation.text}</div>
            </div>
          </header>
          <div class="battle-end-body">
            ${request.narrativeText ? '<p class="battle-end-narrative"></p>' : ''}
            <p class="battle-end-guide">${autoReward ? '正在准备战利品…' : towerMode ? '结算当前状态后返回本次冒险结果。' : '确认后会把回合摘要、最终状态和你的补充一起交给剧情模型。'}</p>
            ${towerMode ? '' : `
              <label class="battle-end-choice-label" for="battle-end-choice">你希望战斗后做什么？<span>可选</span></label>
              <textarea id="battle-end-choice" class="battle-end-choice" maxlength="500" rows="3" placeholder="例如：先检查战场，再与同伴讨论刚才发现的线索。"></textarea>
              <div class="battle-end-choice-meta"><span>留空则由剧情自然发展</span><span class="battle-end-choice-count">0/500</span></div>
            `}
          </div>
          <footer class="battle-end-actions">
            <button class="battle-end-confirm">${towerMode ? '查看冒险结果' : '继续剧情'}</button>
            ${!towerMode && request.onRestart ? '<button class="battle-end-restart">重新开始</button>' : ''}
          </footer>
          <p class="battle-end-error" role="alert" style="display:none;padding:0 20px 16px;color:#ffb4b4;white-space:pre-wrap"></p>
        </section>
      </div>
    `);

    if (request.narrativeText) dialog.find('.battle-end-narrative').text(request.narrativeText);
    const host = $('#battle-scene');
    (host.length ? host : $('body')).append(dialog);
    $('body').css('overflow', 'hidden');
    $('#gameContainer, .game-interface').css('pointer-events', 'none');

    const choice = dialog.find<HTMLTextAreaElement>('.battle-end-choice');
    choice.on('input', () => {
      dialog.find('.battle-end-choice-count').text(`${choice.val()?.toString().length || 0}/500`);
    });

    let confirming = false;
    const confirm = async (button = dialog.find<HTMLButtonElement>('.battle-end-confirm')) => {
      if (confirming) return;
      confirming = true;
      const originalText = button.text();
      const playerContinuation = towerMode ? '' : choice.val()?.toString().trim() || '';
      button.prop('disabled', true).text(autoReward ? '正在准备战利品...' : towerMode ? '正在结算...' : '正在继续剧情...');
      choice.prop('disabled', true);
      dialog.find('.battle-end-error').hide().text('');
      try {
        // Terminal state may race a queued status/resource visual. Keep actor
        // appearance emojis, but remove transient tokens before capturing rewards.
        this.animationManager.clearTransientEffects();
        dialog.addClass('is-settling');
        // Hold a readable victory banner while the defeated battlefield stays
        // visible. Never fade to nothing before the reward view is ready.
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        await new Promise<void>(resolve => window.setTimeout(resolve, reduced ? 16 : autoReward ? 650 : 160));
        await request.onConfirm(playerContinuation);
        dialog.remove();
        $('body').css('overflow', '');
        $('#gameContainer, .game-interface').css('pointer-events', '');
      } catch (error) {
        console.error('触发战斗结束叙事失败:', error);
        dialog.removeClass('is-settling is-victory-transition');
        dialog.find('.battle-end-error').text(`结算未完成，请重试。${error instanceof Error ? error.message : String(error)}`).show();
        choice.prop('disabled', false);
        button.prop('disabled', false).text(autoReward ? '重试准备战利品' : originalText);
        confirming = false;
      }
    };
    dialog.find('.battle-end-confirm').on('click', event => { void confirm($(event.currentTarget as HTMLButtonElement)); });
    if (autoReward) void confirm();

    dialog.find('.battle-end-restart').on('click', async () => {
      try {
        if (request.onRestart) await request.onRestart();
      } catch (error) {
        console.error('重新开始战斗失败:', error);
      }
    });
  }
}
