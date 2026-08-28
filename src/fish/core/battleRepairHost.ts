import { assertCurrentMessageLatest } from '../../runtime/messageVariables';
import { retryCurrentMessageWithExtraModel } from '../../runtime/mvuExtraModelRepair';
import {
  formatBattleContentIssues,
  formatBattleContentRepairPrompt,
  preflightBattleContent,
  type BattleContentIssue,
} from './battleContentPreflight';

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
      await retryCurrentMessageWithExtraModel(prompt, {
        validateVariables: variables => {
          const result = preflightBattleContent(variables?.stat_data?.battle);
          if (!result.ok) {
            throw new Error(`AI 修复结果仍未通过战斗校验：${formatBattleContentIssues(result.issues, 8)}`);
          }
        },
      });
      return 'sent';
    } finally {
      this.pending = false;
    }
  }
}
