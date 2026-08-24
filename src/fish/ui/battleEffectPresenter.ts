import type { BattleEndResult } from '../../game-core';
import { BattleLog } from '../modules/battleLog';
import type { Player } from '../../game-core';
import { AnimationManager } from './animationManager';
import { LustOverflowDisplay, type LustOverflowEffect } from './lustOverflowDisplay';

export interface BattleEndDialogRequest {
  result: BattleEndResult;
  battleSummary: string;
  narrativeText?: string;
  onConfirm(): Promise<void>;
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

  public addLog(
    message: string,
    type: BattleEffectLogType = 'info',
    source?: BattleEffectLogSource,
  ): void {
    BattleLog.addLog(message, type, source);
  }

  public logStatusEffect(
    target: string,
    statusName: string,
    stacks: number,
    duration: number,
    isApply = true,
  ): void {
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

  public showHealthChange(
    target: 'player' | 'enemy',
    change: number,
    currentHp: number,
    maxHp: number,
  ): void {
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

  public showLustChange(
    target: 'player' | 'enemy',
    change: number,
    currentLust: number,
    maxLust: number,
  ): void {
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
      <div class="battle-end-dialog" style="position:fixed!important;inset:0!important;background:rgba(0,0,0,.8)!important;display:flex!important;justify-content:center!important;align-items:center!important;z-index:99999!important">
        <div style="background:white;border-radius:12px;max-width:500px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.3)">
          <div style="text-align:center;padding:20px">
            <h2 style="margin-bottom:15px">${presentation.emoji} 战斗结束！</h2>
            <h3 style="color:${presentation.color};margin-bottom:20px">结果：${presentation.text}</h3>
            ${request.narrativeText ? '<p class="battle-end-narrative" style="margin:0 auto 20px;padding:10px 12px;max-width:420px;color:#333;background:#f5f5f5;border-left:3px solid #4CAF50;text-align:left;white-space:pre-wrap"></p>' : ''}
            <p style="margin-bottom:20px;font-size:14px;color:#666">点击确定将发起新的对话来描述后续剧情</p>
            <p style="margin-bottom:10px;font-size:14px;color:#999">或者点击重新开始按钮重新游戏</p>
          </div>
          <div style="text-align:center;padding:20px;border-top:1px solid #eee">
            <button class="battle-end-confirm" style="background:#4CAF50;color:white;border:0;padding:12px 24px;border-radius:6px;font-size:16px;cursor:pointer;margin-right:10px">确定</button>
            <button class="battle-end-restart" style="background:#2196F3;color:white;border:0;padding:12px 24px;border-radius:6px;font-size:16px;cursor:pointer">🔄 重新开始</button>
          </div>
        </div>
      </div>
    `);

    if (request.narrativeText) dialog.find('.battle-end-narrative').text(request.narrativeText);
    $('body').append(dialog).css('overflow', 'hidden');
    $('#gameContainer, .game-interface').css('pointer-events', 'none');

    dialog.find('.battle-end-confirm').on('click', async event => {
      const button = $(event.currentTarget);
      const originalText = button.text();
      button.prop('disabled', true).text('正在生成对话...').css({ background: '#999', cursor: 'not-allowed' });
      try {
        await request.onConfirm();
        dialog.remove();
        $('body').css('overflow', '');
        $('#gameContainer, .game-interface').css('pointer-events', '');
      } catch (error) {
        console.error('触发战斗结束叙事失败:', error);
        button.prop('disabled', false).text(originalText).css({ background: '#4CAF50', cursor: 'pointer' });
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
