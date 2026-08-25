import { assertCurrentMessageLatest } from '../../runtime/messageVariables';
import { retryCurrentMessageWithExtraModel } from '../../runtime/mvuExtraModelRepair';
import { formatBattleContentRepairPrompt, type BattleContentIssue } from './battleContentPreflight';

export type BattleRepairRequestResult = 'sent' | 'busy' | 'empty';

/** Tavern-only continuation boundary for asking the AI to repair one battle floor. */
export class TavernBattleRepairHost {
  private static instance: TavernBattleRepairHost;
  private pending = false;

  public static getInstance(): TavernBattleRepairHost {
    if (!TavernBattleRepairHost.instance) TavernBattleRepairHost.instance = new TavernBattleRepairHost();
    return TavernBattleRepairHost.instance;
  }

  public async requestRepair(issues: readonly BattleContentIssue[]): Promise<BattleRepairRequestResult> {
    if (this.pending) return 'busy';
    assertCurrentMessageLatest();
    const prompt = formatBattleContentRepairPrompt(issues);
    if (!prompt) return 'empty';

    this.pending = true;
    try {
      await retryCurrentMessageWithExtraModel(prompt);
      return 'sent';
    } finally {
      this.pending = false;
    }
  }
}
