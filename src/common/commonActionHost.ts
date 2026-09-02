import { updateCurrentMessageVariablesWith, updateLatestMessageVariablesWith } from '../runtime/messageVariables';
import {
  TavernContinuationError,
  TavernContinuationHost,
  type TavernContinuationPlan,
} from '../runtime/tavernContinuation';

export type CommonVariablesUpdater = (
  variables: Record<string, any>,
) => Record<string, any> | Promise<Record<string, any>>;

export interface TavernCommonActionPorts {
  updateVariablesWith(updater: CommonVariablesUpdater): Record<string, any> | Promise<Record<string, any>>;
  createChatMessages(
    messages: Array<{ role: 'user'; message: string }>,
    options: { refresh: 'affected' },
  ): Promise<void>;
  triggerSlash(command: string): Promise<string | undefined>;
}

export interface CommonContinuationPlan<TPrepared = void> {
  prompt: TavernContinuationPlan<TPrepared>['prompt'];
  prepare?: TavernContinuationPlan<TPrepared>['prepare'];
  rollbackBeforeSend?: TavernContinuationPlan<TPrepared>['rollbackBeforeSend'];
}

export { TavernContinuationError as TavernCommonContinuationError };

/** Single Tavern host for common-view MUV writes and message continuations. */
export class TavernCommonActionHost {
  private static instance: TavernCommonActionHost;
  private readonly continuationHost: TavernContinuationHost;

  public constructor(
    private readonly ports: TavernCommonActionPorts = {
      updateVariablesWith: updater => updateCurrentMessageVariablesWith(updater),
      createChatMessages: (messages, options) => createChatMessages(messages, options),
      triggerSlash: command => triggerSlash(command),
    },
  ) {
    this.continuationHost = new TavernContinuationHost({
      createChatMessages: (messages, options) => this.ports.createChatMessages(messages, options),
      triggerGeneration: () => this.ports.triggerSlash('/trigger'),
    });
  }

  public static getInstance(): TavernCommonActionHost {
    if (!TavernCommonActionHost.instance) TavernCommonActionHost.instance = new TavernCommonActionHost();
    return TavernCommonActionHost.instance;
  }

  public updateVariablesWith(updater: CommonVariablesUpdater): Promise<Record<string, any>> {
    return Promise.resolve(this.ports.updateVariablesWith(updater));
  }

  /**
   * A deliberately narrow escape hatch for an already-rendered reward panel.
   * The caller owns the reward-pool fingerprint check; every other common UI
   * action continues to write only to its current message.
   */
  public updateLatestVariablesWith(updater: CommonVariablesUpdater): Promise<Record<string, any>> {
    return Promise.resolve(updateLatestMessageVariablesWith(updater));
  }

  public async continueWithPrompt<TPrepared = void>(plan: CommonContinuationPlan<TPrepared>): Promise<void> {
    await this.continuationHost.continueWithPrompt(plan);
  }
}
