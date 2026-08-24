import { REQUIRED_TAVERN_HELPER_FUNCTIONS, requireTavernHelperHost } from './tavernHost';

type MessageVariableOptions = { type: 'message'; message_id?: number | 'latest' };
type VariablesUpdater = (variables: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>;

export const TAVERN_HELPER_MIN_VERSION = '3.4.17';
export const MVU_INITIALIZATION_TIMEOUT_MS = 120000;
export const MVU_BATTLE_DATA_TIMEOUT_MS = 30000;

export interface MvuReadinessOptions {
  mvuTimeoutMs?: number;
  battleDataTimeoutMs?: number;
}

type SharedHostRuntime = Readonly<{
  spec?: string;
  version?: string;
  waitForMessageReady?: (messageId?: number | 'latest', options?: MvuReadinessOptions) => Promise<void>;
}>;

/**
 * Resolve the message variable scope for the current Tavern Helper iframe.
 *
 * Message iframes are named `TH-message--<message id>--...`; using the
 * explicit id keeps an older rendered battle from reading the newest chat
 * message.
 */
export function getCurrentMessageVariableOptions(): MessageVariableOptions {
  const runtime = requireTavernHelperHost();
  const messageId = Number(runtime.getCurrentMessageId());
  if (!Number.isInteger(messageId) || messageId < 0) throw new Error('无法确定当前酒馆消息楼层');
  return { type: 'message', message_id: messageId };
}

export function isCurrentMessageLatest(): boolean {
  const runtime = requireTavernHelperHost();
  const current = Number(runtime.getCurrentMessageId());
  const latest = Number(runtime.getLastMessageId());
  if (!Number.isInteger(current) || !Number.isInteger(latest)) throw new Error('无法确定酒馆消息历史状态');
  return current === latest;
}

export function assertCurrentMessageLatest(): void {
  if (!isCurrentMessageLatest()) {
    throw new Error('历史消息为只读状态，请在最新消息中继续操作');
  }
}

export function getCurrentMessageDepth(): number {
  const runtime = requireTavernHelperHost();
  const current = Number(runtime.getCurrentMessageId());
  const latest = Number(runtime.getLastMessageId());
  if (!Number.isInteger(current) || !Number.isInteger(latest)) throw new Error('无法确定酒馆消息深度');
  return Math.max(0, latest - current);
}

export function isCurrentMessageWithinDepth(maxDepth: number): boolean {
  return getCurrentMessageDepth() <= Math.max(0, Math.floor(maxDepth));
}

export function watchCurrentMessageDepth(
  handlers: { onHistorical?: () => void; onOutOfRange: () => void },
  maxDepth = 2,
  intervalMs = 750,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let historicalNotified = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const check = (): void => {
    const depth = getCurrentMessageDepth();
    if (depth > 0 && !historicalNotified) {
      historicalNotified = true;
      handlers.onHistorical?.();
    }
    if (depth <= maxDepth) return;
    stop();
    handlers.onOutOfRange();
  };
  check();
  if (!stopped) timer = setInterval(check, Math.max(100, intervalMs));
  return stop;
}

/** Watch one message iframe until it becomes historical, then stop automatically. */
export function watchCurrentMessageUntilHistorical(onHistorical: () => void, intervalMs = 750): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const check = (): void => {
    if (isCurrentMessageLatest()) return;
    stop();
    onHistorical();
  };
  if (!isCurrentMessageLatest()) {
    onHistorical();
    stopped = true;
    return stop;
  }
  timer = setInterval(check, Math.max(100, intervalMs));
  return stop;
}

/** Reapply Tavern regex depth rules so a newly historical view is unloaded. */
export async function rerenderHistoricalMessageForDepth(): Promise<boolean> {
  if (isCurrentMessageLatest()) return false;
  const runtime = requireTavernHelperHost();
  const messageId = getCurrentMessageVariableOptions().message_id;
  if (!Number.isInteger(messageId) || typeof runtime.refreshOneMessage !== 'function') return false;
  await runtime.refreshOneMessage(messageId);
  return true;
}

/** Read MUV/Tavern Helper variables belonging to this rendered message. */
export function getCurrentMessageVariables(): Record<string, any> {
  const runtime = requireTavernHelperHost();
  return runtime.getVariables(getCurrentMessageVariableOptions());
}

/** Read the unmodified text of the message that owns this rendered iframe. */
export function getCurrentChatMessageText(): string {
  const runtime = requireTavernHelperHost();
  const sharedHost = runtime.MagicGirlWorld as
    { getMessageText?: (messageId?: number | 'latest') => string } | undefined;
  if (typeof sharedHost?.getMessageText === 'function') {
    return sharedHost.getMessageText(getCurrentMessageVariableOptions().message_id ?? 'latest');
  }
  if (typeof runtime.getChatMessages !== 'function') return '';
  const messageId = getCurrentMessageVariableOptions().message_id;
  if (!Number.isInteger(messageId)) return '';
  const messages = runtime.getChatMessages(messageId);
  const message = Array.isArray(messages) ? messages[0] : undefined;
  return typeof message?.message === 'string' ? message.message : '';
}

/** Read a nearby chat message relative to the iframe's owning floor. */
export function getRelativeChatMessageText(offset: number): string {
  const runtime = requireTavernHelperHost();
  if (typeof runtime.getChatMessages !== 'function') return '';
  const current = getCurrentMessageVariableOptions().message_id;
  if (!Number.isInteger(current)) return '';
  const target = Number(current) + Math.trunc(offset);
  if (target < 0) return '';
  const messages = runtime.getChatMessages(target);
  const message = Array.isArray(messages) ? messages[0] : undefined;
  return typeof message?.message === 'string' ? message.message : '';
}

/** Update MUV/Tavern Helper variables belonging to this rendered message. */
export function updateCurrentMessageVariablesWith(
  updater: VariablesUpdater,
): Record<string, any> | Promise<Record<string, any>> {
  assertCurrentMessageLatest();
  const runtime = requireTavernHelperHost();
  return runtime.updateVariablesWith(updater, getCurrentMessageVariableOptions());
}

/** Replace the complete variable snapshot owned by the current message. */
export function replaceCurrentMessageVariables(variables: Record<string, any>): unknown | Promise<unknown> {
  assertCurrentMessageLatest();
  const runtime = requireTavernHelperHost();
  return runtime.replaceVariables(variables, getCurrentMessageVariableOptions());
}

/** Merge data into MUV/Tavern Helper variables belonging to this message. */
export function insertOrAssignCurrentMessageVariables(variables: Record<string, any>): unknown {
  assertCurrentMessageLatest();
  const runtime = requireTavernHelperHost();
  return runtime.insertOrAssignVariables(variables, getCurrentMessageVariableOptions());
}

function compareVersions(left: string, right: string): number {
  const normalize = (version: string) => version.split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const a = normalize(left);
  const b = normalize(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isWorldbookNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('未能找到世界书') ||
    /(?:could not|cannot|unable to) find (?:the )?(?:worldbook|lorebook)/i.test(message)
  );
}

function hasMvuApi(runtime: Record<string, any>): boolean {
  return (
    !!runtime.Mvu && typeof runtime.Mvu.getMvuData === 'function' && typeof runtime.Mvu.replaceMvuData === 'function'
  );
}

/**
 * Wait for the card's embedded MUV loader to finish after Tavern's import
 * dialog has been confirmed. `waitGlobalInitialized` is only a notification;
 * polling remains the source of truth because older Tavern Helper builds can
 * resolve it before the global is assigned (or never expose it at all).
 */
async function waitForMvuApi(runtime: Record<string, any>, timeoutMs: number): Promise<void> {
  if (hasMvuApi(runtime)) return;
  const deadline = Date.now() + timeoutMs;
  try {
    Promise.resolve(runtime.waitGlobalInitialized('Mvu')).catch(() => undefined);
  } catch {
    // Polling below remains authoritative if the notification call fails.
  }
  while (Date.now() < deadline) {
    if (hasMvuApi(runtime)) return;
    await wait(100);
  }
  if (hasMvuApi(runtime)) return;
  throw new Error('等待 MUV 初始化超时，请确认卡内脚本已启用并完成内嵌世界书导入');
}

/**
 * Validate the production dependency chain before the battle initializes.
 * Latest MVU (v0.181.0) requires Tavern Helper 3.4.17 or newer.
 */
export async function ensureMvuRuntimeReady(options: number | MvuReadinessOptions = {}): Promise<void> {
  const runtime = requireTavernHelperHost();
  const readinessOptions = typeof options === 'number' ? { mvuTimeoutMs: options } : options;
  const sharedHost = runtime.MagicGirlWorld as SharedHostRuntime | undefined;
  if (sharedHost?.spec === 'mwg.tavern-runtime/v1' && typeof sharedHost.waitForMessageReady === 'function') {
    const messageId = getCurrentMessageVariableOptions().message_id ?? 'latest';
    await sharedHost.waitForMessageReady(messageId, readinessOptions);
    return;
  }

  requireTavernHelperHost(REQUIRED_TAVERN_HELPER_FUNCTIONS);

  if (typeof runtime.getTavernHelperVersion === 'function') {
    const version = String(await runtime.getTavernHelperVersion());
    if (compareVersions(version, TAVERN_HELPER_MIN_VERSION) < 0) {
      throw new Error(`酒馆助手版本 ${version} 过低，需要 ${TAVERN_HELPER_MIN_VERSION} 或更高版本`);
    }
  }

  const mvuTimeoutMs = Math.max(1, readinessOptions.mvuTimeoutMs ?? MVU_INITIALIZATION_TIMEOUT_MS);
  const battleDataTimeoutMs = Math.max(1, readinessOptions.battleDataTimeoutMs ?? MVU_BATTLE_DATA_TIMEOUT_MS);
  await waitForMvuApi(runtime, mvuTimeoutMs);

  const startedAt = Date.now();
  let lastWorldbookError: unknown;
  while (Date.now() - startedAt < battleDataTimeoutMs) {
    let variables: Record<string, any>;
    try {
      variables = getCurrentMessageVariables();
    } catch (error) {
      if (!isWorldbookNotReadyError(error)) throw error;
      lastWorldbookError = error;
      await wait(100);
      continue;
    }
    const statData = variables?.stat_data;
    if (statData && typeof statData === 'object' && Object.prototype.hasOwnProperty.call(statData, 'battle')) {
      return;
    }
    await wait(100);
  }
  if (lastWorldbookError) {
    throw new Error('等待 MUV 世界书加载超时，请确认内嵌世界书已导入并链接', { cause: lastWorldbookError });
  }
  throw new Error('当前战斗楼层没有 MUV stat_data.battle，变量可能尚未初始化或更新失败');
}
