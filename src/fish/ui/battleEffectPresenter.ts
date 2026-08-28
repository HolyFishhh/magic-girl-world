import type { BattleEndResult } from '../../game-core';
import { BattleLog } from '../modules/battleLog';
import type { Player } from '../../game-core';
import { AnimationManager } from './animationManager';
import { LustOverflowDisplay, type LustOverflowEffect } from './lustOverflowDisplay';

export interface BattleEndDialogRequest {
  result: BattleEndResult;
  battleSummary: string;
  narrativeText?: string;
  onConfirm(playerContinuation: string): Promise<void>;
  onRestart(): Promise<void>;
}

export type BattleEffectLogType = 'info' | 'damage' | 'heal' | 'action' | 'system';
export type BattleEffectLogSource = {
  type: 'card' | 'relic' | 'ability' | 'status';
  name: string;
  details?: string;
};

/** Owns every direct battle-effect presentation side effect inside the Tavern iframe. */
export class TavernBattleEffectPresenter {
  private static instance: TavernBattleEffectPresenter;
  private readonly animationManager = AnimationManager.getInstance();
  private readonly lustOverflowDisplay = LustOverflowDisplay.getInstance();

  public static getInstance(): TavernBattleEffectPresenter {
    if (!TavernBattleEffectPresenter.instance) {
      TavernBattleEffectPresenter.instance = new TavernBattleEffectPresenter();
    }
    return TavernBattleEffectPresenter.instance;
  }

  public addLog(message: string, type: BattleEffectLogType = 'info', source?: BattleEffectLogSource): void {
    BattleLog.addLog(message, type, source);
  }

  public logStatusEffect(target: string, statusName: string, stacks: number, duration: number, isApply = true): void {
    BattleLog.logStatusEffect(target, statusName, stacks, duration, isApply);
  }

  public logLustOverflow(target: string, effectName: string): void {
    BattleLog.logLustOverflow(target, effectName);
  }

  public showBlockAbsorption(target: 'player' | 'enemy', amount: number): void {
    try {
      this.animationManager.showDamageNumber(target, amount, 'block');
    } catch (error) {
      console.warn('显示格挡抵消动画失败:', error);
    }
  }

  public showHealthChange(target: 'player' | 'enemy', change: number, currentHp: number, maxHp: number): void {
    try {
      this.animationManager.showDamageNumber(target, Math.abs(change), change < 0 ? 'damage' : 'heal');
      this.animationManager.updateHealthBarWithAnimation(target, currentHp, maxHp);
      if (change < 0) {
        if (target === 'player') this.animationManager.showPlayerDamageEffect('damage');
        else this.animationManager.showEnemyDamageEffect('damage');
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

  public refreshPlayerEnergy(player: Player): void {
    window.setTimeout(() => {
      try {
        $('#player-energy').text(`${player.energy || 0}/${player.maxEnergy || 3}`);
        for (const card of player.hand || []) {
          const cardElement = $('.card').filter((_, element) => String($(element).data('card-id')) === card.id);
          if (cardElement.length === 0) continue;
          const canAfford = card.cost === 'energy' || player.energy >= (card.cost || 0);
          cardElement.toggleClass('clickable', canAfford).toggleClass('unaffordable', !canAfford);
          cardElement.find('.card-cost').toggleClass('insufficient-energy', !canAfford);
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
    const dialog = $(`
      <div class="battle-end-dialog result-${request.result}" style="--result-color:${presentation.color}" role="dialog" aria-modal="true" aria-label="战斗结束">
        <div class="battle-end-backdrop"></div>
        <section class="battle-end-panel">
          <header class="battle-end-header">
            <span class="battle-end-emblem" aria-hidden="true">${presentation.emoji}</span>
            <div>
              <h2>战斗结束</h2>
              <div class="battle-end-result">结果：${presentation.text}</div>
            </div>
          </header>
          <div class="battle-end-body">
            ${request.narrativeText ? '<p class="battle-end-narrative"></p>' : ''}
            <p class="battle-end-guide">确认后会把回合摘要、最终状态和你的补充一起交给剧情模型。</p>
            <label class="battle-end-choice-label" for="battle-end-choice">你希望战斗后做什么？<span>可选</span></label>
            <textarea id="battle-end-choice" class="battle-end-choice" maxlength="500" rows="3" placeholder="例如：先检查战场，再与同伴讨论刚才发现的线索。"></textarea>
            <div class="battle-end-choice-meta"><span>留空则由剧情自然发展</span><span class="battle-end-choice-count">0/500</span></div>
          </div>
          <footer class="battle-end-actions">
            <button class="battle-end-confirm">继续剧情</button>
            <button class="battle-end-restart">重新开始</button>
          </footer>
        </section>
      </div>
    `);

    if (request.narrativeText) dialog.find('.battle-end-narrative').text(request.narrativeText);
    $('body').append(dialog).css('overflow', 'hidden');
    $('#gameContainer, .game-interface').css('pointer-events', 'none');

    const choice = dialog.find<HTMLTextAreaElement>('.battle-end-choice');
    choice.on('input', () => {
      dialog.find('.battle-end-choice-count').text(`${choice.val()?.toString().length || 0}/500`);
    });

    dialog.find('.battle-end-confirm').on('click', async event => {
      const button = $(event.currentTarget);
      const originalText = button.text();
      const playerContinuation = choice.val()?.toString().trim() || '';
      button.prop('disabled', true).text('正在继续剧情...');
      choice.prop('disabled', true);
      try {
        await request.onConfirm(playerContinuation);
        dialog.remove();
        $('body').css('overflow', '');
        $('#gameContainer, .game-interface').css('pointer-events', '');
      } catch (error) {
        console.error('触发战斗结束叙事失败:', error);
        choice.prop('disabled', false);
        button.prop('disabled', false).text(originalText);
      }
    });

    dialog.find('.battle-end-restart').on('click', async () => {
      try {
        await request.onRestart();
      } catch (error) {
        console.error('重新开始战斗失败:', error);
      }
    });
  }
}
