import {
  RelicTriggerRuntime,
  runTriggerTransaction,
  type AbilityTrigger,
  type EffectProgram,
  type Relic,
  type RelicTriggerPlan,
} from '../../game-core';
import { RelicEffectPresenter } from '../ui/relicEffectPresenter';
import { BattleSessionHost } from './battleSessionHost';
import { GameStateManager } from './gameStateManager';

export type RelicTriggerExecutionContext = Record<string, unknown> & {
  isRelicEffect: true;
  relicContext: Relic;
  triggerType: AbilityTrigger;
};

export interface RelicTriggerExecutionPorts {
  executeProgram(program: EffectProgram, context: RelicTriggerExecutionContext): Promise<void>;
}

/** Single Tavern lifecycle host for modern relic effects. */
export class TavernRelicTriggerHost {
  private static instance: TavernRelicTriggerHost;
  private readonly gameStateManager = GameStateManager.getInstance();
  private readonly sessionHost = BattleSessionHost.getInstance();
  private readonly presentation = RelicEffectPresenter.getInstance();
  private readonly runtime = new RelicTriggerRuntime({
    readRelics: () => this.gameStateManager.getPlayer().relics,
    execute: (plan, context) => this.triggerRelic(plan, context),
  });
  private executionPorts?: RelicTriggerExecutionPorts;

  public static getInstance(): TavernRelicTriggerHost {
    if (!TavernRelicTriggerHost.instance) TavernRelicTriggerHost.instance = new TavernRelicTriggerHost();
    return TavernRelicTriggerHost.instance;
  }

  /** Connected once by the only effect executor; avoids a host/executor import cycle. */
  public configureExecutionPorts(ports: RelicTriggerExecutionPorts): void {
    this.executionPorts = ports;
  }

  public async triggerRelics(trigger: AbilityTrigger, context: Record<string, unknown> = {}): Promise<void> {
    await this.runtime.run(trigger, context);
  }

  private async triggerRelic(plan: RelicTriggerPlan, context: Record<string, unknown>): Promise<void> {
    const { source: relic, trigger } = plan;
    const ports = this.executionPorts;
    if (!ports) throw new Error('遗物执行端口尚未连接');

    const result = await runTriggerTransaction(
      `relic_${trigger}`,
      this.sessionHost.triggerTransactionPorts(),
      async () => {
        this.presentation.showTriggered(relic);
        const executionContext: RelicTriggerExecutionContext = {
          ...context,
          isRelicEffect: true,
          relicContext: relic,
          triggerType: trigger,
        };
        await ports.executeProgram(plan.program, executionContext);
      },
      'recover-and-continue',
    );

    if (result.status === 'rolled_back') {
      console.error(`遗物效果执行失败，已回滚: ${relic.name}`, result.cause);
      this.presentation.addLog(`${relic.name}的${trigger}效果执行失败，战斗状态已回滚。`, 'system');
    }
  }
}
