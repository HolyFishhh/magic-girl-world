import { BattleLog } from '../modules/battleLog';

/** Owns relic trigger feedback and logs inside the Tavern battle iframe. */
export class RelicEffectPresenter {
  private static instance: RelicEffectPresenter;

  public static getInstance(): RelicEffectPresenter {
    if (!RelicEffectPresenter.instance) RelicEffectPresenter.instance = new RelicEffectPresenter();
    return RelicEffectPresenter.instance;
  }

  public showTriggered(relic: { id: string; name: string }): void {
    const relicElement = $(`.relic-item[data-relic-id="${relic.id}"]`);
    if (relicElement.length === 0) return;
    relicElement.addClass('relic-triggered');
    window.setTimeout(() => relicElement.removeClass('relic-triggered'), 1000);
  }

  public addLog(message: string, type: 'info' | 'damage' | 'heal' | 'action' | 'system' = 'info'): void {
    BattleLog.addLog(message, type);
  }
}
