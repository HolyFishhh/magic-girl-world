export interface TavernContinuationPorts {
  createChatMessages(
    messages: Array<{ role: 'user'; message: string }>,
    options: { refresh: 'affected' },
  ): Promise<void>;
  triggerGeneration(): Promise<unknown>;
}

export interface TavernContinuationPlan<TPrepared = void> {
  prompt: string;
  prepare?: () => TPrepared | Promise<TPrepared>;
  rollbackBeforeSend?: (prepared: TPrepared) => void | Promise<void>;
}

export class TavernContinuationError extends Error {
  public constructor(
    public readonly stage: 'send' | 'trigger',
    public readonly messageSent: boolean,
    cause: unknown,
  ) {
    super(stage === 'send' ? '发送行动消息失败' : '行动消息已发送，但请求生成失败', { cause });
    this.name = 'TavernContinuationError';
  }
}

/** Single structured-message continuation protocol shared by every Tavern view. */
export class TavernContinuationHost {
  private static instance: TavernContinuationHost;
  private continuationInFlight = false;

  public constructor(
    private readonly ports: TavernContinuationPorts = {
      createChatMessages: (messages, options) => createChatMessages(messages, options),
      triggerGeneration: () => triggerSlash('/trigger'),
    },
  ) {}

  public static getInstance(): TavernContinuationHost {
    if (!TavernContinuationHost.instance) TavernContinuationHost.instance = new TavernContinuationHost();
    return TavernContinuationHost.instance;
  }

  public isBusy(): boolean {
    return this.continuationInFlight;
  }

  public async continueWithPrompt<TPrepared = void>(plan: TavernContinuationPlan<TPrepared>): Promise<void> {
    const prompt = plan.prompt.trim();
    if (!prompt) throw new Error('行动提示不能为空');
    if (this.continuationInFlight) throw new Error('已有行动正在发送，请稍候');

    this.continuationInFlight = true;
    let prepared: TPrepared | undefined;
    let didPrepare = false;
    try {
      if (plan.prepare) {
        prepared = await plan.prepare();
        didPrepare = true;
      }

      try {
        await this.ports.createChatMessages([{ role: 'user', message: prompt }], { refresh: 'affected' });
      } catch (sendError) {
        let cause: unknown = sendError;
        if (didPrepare && plan.rollbackBeforeSend) {
          try {
            await plan.rollbackBeforeSend(prepared as TPrepared);
          } catch (rollbackError) {
            cause = new AggregateError([sendError, rollbackError], '发送失败且准备状态回滚失败');
          }
        }
        throw new TavernContinuationError('send', false, cause);
      }

      try {
        await this.ports.triggerGeneration();
      } catch (triggerError) {
        // The user message already exists. Keep the prepared source-floor state
        // so a manual retry generates from the same authoritative transition.
        throw new TavernContinuationError('trigger', true, triggerError);
      }
    } finally {
      this.continuationInFlight = false;
    }
  }
}
