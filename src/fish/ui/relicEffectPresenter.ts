import { BattleLog } from '../modules/battleLog';
import type { Relic } from '../../game-core';
import { AnimationManager } from './animationManager';
import { EffectProgramDisplay } from './effectProgramDisplay';

/** Owns relic trigger feedback and logs inside the Tavern battle iframe. */
export class RelicEffectPresenter {
  private static instance: RelicEffectPresenter;
  private readonly animationManager = AnimationManager.getInstance();
  private readonly effectDisplay = EffectProgramDisplay.getInstance();

  public static getInstance(): RelicEffectPresenter {
    if (!RelicEffectPresenter.instance) RelicEffectPresenter.instance = new RelicEffectPresenter();
    return RelicEffectPresenter.instance;
  }

  public showTriggered(relic: Relic): void {
    const relicElement = $(`.relic-container[data-relic-id="${relic.id}"]`);
    if (relicElement.length > 0) {
      relicElement.addClass('relic-triggered');
      window.setTimeout(() => relicElement.removeClass('relic-triggered'), 1000);
    }
    void this.animationManager.playCombatAction('player', 'relic', relic.emoji || '🔮', relic.name);
  }

  public addTriggeredLog(relic: Relic, trigger: string): void {
    const details = this.effectDisplay
      .triggeredProgramToTags(trigger, relic.effectProgram)
      .map(entry => entry.text)
      .join('；');
    BattleLog.addLog(`遗物触发：${relic.name}`, 'action', {
      type: 'relic',
      name: relic.name,
      details: details || relic.description || '',
    });
  }

  public addLog(message: string, type: 'info' | 'damage' | 'heal' | 'action' | 'system' = 'info'): void {
    BattleLog.addLog(message, type);
  }
}
