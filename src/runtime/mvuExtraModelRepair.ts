import { assertCurrentMessageLatest, getCurrentMessageVariableOptions } from './messageVariables';
import { requireTavernHelperHost } from './tavernHost';

const RETRY_BUTTON_NAME = '重试额外模型解析';
const REQUEST_BEGIN = '[MWG_REPAIR_REQUEST_BEGIN]';
const REQUEST_END = '[MWG_REPAIR_REQUEST_END]';

export class ExtraModelCandidateRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtraModelCandidateRejectedError';
  }
}

export interface ExtraModelRepairOptions {
  /** Keep only the repair scope authorized by the caller before variables are written back. */
  reconcileVariables?: (
    originalVariables: Record<string, any>,
    repairedVariables: Record<string, any>,
  ) => Record<string, any>;
  /** Reject the repaired snapshot before it replaces the current message/chat variables. */
  validateVariables?: (variables: Record<string, any>) => void;
  /** Keep the owning iframe alive after rollback so a caller can perform a bounded follow-up repair. */
  refreshOnFailure?: 'none' | 'affected';
  /**
   * Initial MVU generation and the explicit retry event can overlap. In that case
   * the authoritative variables may become valid before the retry adds a second
   * UpdateVariable block. Allow the caller to join that in-flight transaction
   * instead of reporting a false failure.
   */
  acceptCurrentVariablesWhenValid?: boolean;
  /** Maximum time to wait for Tavern Helper's asynchronous retry handler. */
  resultTimeoutMs?: number;
  /** Let a newly rebuilt MVU iframe finish re-registering its button listener. */
  eventReadyGraceMs?: number;
  /** Testable upper bound for observing the MVU request lifecycle after event emission. */
  eventStartTimeoutMs?: number;
  /**
   * Optional host-owned event bridge. Tavern Helper 4.9.3 no longer exposes
   * `eventEmit` on every public runtime, while SillyTavern still exposes the
   * authoritative `eventSource.emit` to extensions.
   */
  eventEmitter?: (eventName: string, ...args: unknown[]) => Promise<unknown> | unknown;
  /** Refuse every read/write as soon as the owning SillyTavern chat changes. */
  isCurrent?: () => boolean;
}

export type PersistentMvuRepairScope =
  | 'initial-content'
  | 'cards-only'
  | 'battle-content'
  | 'battle-settlement'
  | 'generic';

export interface PersistentMvuRepairRequest {
  spec: 'mwg.mvu-repair-request/v1';
  prompt: string;
  scope: PersistentMvuRepairScope;
}

const EXTRA_MODEL_RESULT_TIMEOUT_MS = 120_000;
const EXTRA_MODEL_RESULT_POLL_MS = 100;
const EXTRA_MODEL_EVENT_READY_GRACE_MS = 650;
const EXTRA_MODEL_EVENT_START_TIMEOUT_MS = 4_000;

function isPlainRecord(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && valuesEqual(left[key], right[key]));
}

/** Apply only the changes made by MVU's retry result to the pre-retry floor snapshot. */
function applyStructuralDelta(original: unknown, baseline: unknown, updated: unknown): unknown {
  if (valuesEqual(baseline, updated)) return cloneValue(original);
  if (!isPlainRecord(baseline) || !isPlainRecord(updated)) return cloneValue(updated);

  const result: Record<string, any> = isPlainRecord(original) ? cloneValue(original) : {};
  const keys = new Set([...Object.keys(baseline), ...Object.keys(updated)]);
  keys.forEach(key => {
    const baselineHasKey = Object.prototype.hasOwnProperty.call(baseline, key);
    const updatedHasKey = Object.prototype.hasOwnProperty.call(updated, key);
    if (!updatedHasKey) {
      if (baselineHasKey) delete result[key];
      return;
    }
    if (!baselineHasKey) {
      result[key] = cloneValue(updated[key]);
      return;
    }
    result[key] = applyStructuralDelta(result[key], baseline[key], updated[key]);
  });
  return result;
}

function readPreviousMvuVariables(runtime: Record<string, any>, messageId: number): Record<string, any> {
  for (let candidate = messageId - 1; candidate >= 0; candidate -= 1) {
    try {
      const value = runtime.getVariables({ type: 'message', message_id: candidate });
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'stat_data')) {
        return cloneValue(value);
      }
    } catch {
      // Some old floors legitimately do not carry message variables; MVU also scans backwards.
    }
  }
  return {};
}

function getStringHash(value: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function flattenScripts(trees: any[]): any[] {
  return trees.flatMap(tree => (tree?.type === 'folder' && Array.isArray(tree.scripts) ? tree.scripts : [tree]));
}

function resolveExtraModelRetryEvent(runtime: Record<string, any>): string {
  const buttonMap = runtime.getAllEnabledScriptButtons?.();
  if (buttonMap && typeof buttonMap === 'object') {
    const matches = Object.values(buttonMap)
      .flatMap(value => (Array.isArray(value) ? value : []))
      .filter(button => button?.button_name === RETRY_BUTTON_NAME && typeof button?.button_id === 'string')
      .map(button => button.button_id);
    const uniqueMatches = Array.from(new Set(matches));
    if (uniqueMatches.length === 1) return uniqueMatches[0];
    if (uniqueMatches.length > 1) throw new Error('发现多个 MVU 额外模型重试事件，无法安全选择');
  }

  const scriptIds = ['global', 'preset', 'character']
    .flatMap(type => flattenScripts(runtime.getScriptTrees({ type })))
    .filter(script => script?.enabled !== false)
    .filter(script => script?.button?.enabled !== false)
    .filter(script => script?.button?.buttons?.some((button: any) => button?.name === RETRY_BUTTON_NAME))
    .map(script => script.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const uniqueScriptIds = Array.from(new Set(scriptIds));
  if (uniqueScriptIds.length === 1) return `${uniqueScriptIds[0]}_${getStringHash(RETRY_BUTTON_NAME)}`;
  if (uniqueScriptIds.length > 1) throw new Error('发现多个 MVU 额外模型脚本，无法安全选择');
  throw new Error('当前酒馆助手或 MVU 版本没有提供额外模型重试事件');
}

function readMessageText(runtime: Record<string, any>, messageId: number): string {
  const messages = runtime.getChatMessages(messageId);
  const message = Array.isArray(messages) ? messages.at(-1) : undefined;
  return typeof message?.message === 'string' ? message.message : '';
}

function assertHostMessageLatest(runtime: Record<string, any>, messageId: number): void {
  const latest = Number(runtime.getLastMessageId());
  if (!Number.isInteger(latest) || latest !== messageId) {
    throw new Error('历史消息为只读状态，请在最新消息中继续操作');
  }
}

function isRepairScopeCurrent(options: ExtraModelRepairOptions): boolean {
  try {
    return options.isCurrent?.() !== false;
  } catch {
    return false;
  }
}

function assertRepairScopeCurrent(
  runtime: Record<string, any>,
  messageId: number,
  options: ExtraModelRepairOptions,
): void {
  if (!isRepairScopeCurrent(options)) {
    throw new Error('当前聊天已切换，已取消旧存档的 MVU 修复');
  }
  assertHostMessageLatest(runtime, messageId);
}

function eventSourceEmitter(source: unknown): ExtraModelRepairOptions['eventEmitter'] | null {
  if (!source || typeof source !== 'object') return null;
  const emit = (source as Record<string, any>).emit;
  return typeof emit === 'function' ? emit.bind(source) : null;
}

function contextEventEmitter(host: unknown): ExtraModelRepairOptions['eventEmitter'] | null {
  if (!host || typeof host !== 'object') return null;
  const candidate = host as Record<string, any>;
  const direct = eventSourceEmitter(candidate.eventSource);
  if (direct) return direct;
  try {
    return eventSourceEmitter(candidate.SillyTavern?.getContext?.()?.eventSource);
  } catch {
    return null;
  }
}

function resolveExtraModelEventEmitter(
  runtime: Record<string, any>,
  options: ExtraModelRepairOptions,
): NonNullable<ExtraModelRepairOptions['eventEmitter']> {
  if (typeof options.eventEmitter === 'function') return options.eventEmitter;
  if (typeof runtime.eventEmit === 'function') return runtime.eventEmit.bind(runtime);
  const runtimeEmitter = contextEventEmitter(runtime);
  if (runtimeEmitter) return runtimeEmitter;

  const hosts: unknown[] = [globalThis];
  try {
    const root = globalThis as Record<string, any>;
    const parent = root.parent || root.window?.parent;
    if (parent && parent !== globalThis) hosts.push(parent);
  } catch {
    // Cross-origin parents are never trusted as an event source.
  }
  for (const host of hosts) {
    const emitter = contextEventEmitter(host);
    if (emitter) return emitter;
  }
  throw new Error('SillyTavern 事件接口缺失: eventSource.emit');
}

function canSafelyRestoreRepair(
  runtime: Record<string, any>,
  messageId: number,
  options: ExtraModelRepairOptions,
): boolean {
  if (!isRepairScopeCurrent(options)) return false;
  try {
    return Number(runtime.getLastMessageId()) === messageId;
  } catch {
    return false;
  }
}

function persistentRepairScope(prompt: string): PersistentMvuRepairScope {
  if (prompt.includes('[MVU_BATTLE_SETTLEMENT]')) return 'battle-settlement';
  if (prompt.includes('[战斗内容修复]')) return 'initial-content';
  if (prompt.includes('[玩家自然语言卡牌修复]')) return 'cards-only';
  if (prompt.includes('[战斗场景修复]')) return 'battle-content';
  return 'generic';
}

function persistentRepairProvider():
  | { requestMvuExtraRepair: (request: PersistentMvuRepairRequest) => Promise<unknown> | unknown | null }
  | null {
  const hosts: Array<Record<string, any>> = [globalThis as Record<string, any>];
  for (const candidate of [
    () => (globalThis as Record<string, any>).parent,
    () => (globalThis as Record<string, any>).top,
  ]) {
    try {
      const host = candidate();
      if (host && !hosts.includes(host)) hosts.push(host);
    } catch {
      // Cross-origin iframe boundaries are not expected in Tavern Helper, but
      // the local fallback remains available if a host embeds the view that way.
    }
  }

  for (const host of hosts) {
    for (const provider of [host.MagicGirlWorld, host.MagicGirlDesignAssistant]) {
      if (typeof provider?.requestMvuExtraRepair === 'function') return provider;
    }
  }
  return null;
}

function removeInjectedRequest(message: string): string {
  const start = message.lastIndexOf(REQUEST_BEGIN);
  if (start < 0) return message;
  const end = message.indexOf(REQUEST_END, start);
  if (end < 0) return message.slice(0, start).trimEnd();
  return `${message.slice(0, start).trimEnd()}${message.slice(end + REQUEST_END.length)}`.trim();
}

function readExtraModelActivity(runtime: Record<string, any>): boolean | null {
  try {
    const variables = runtime.getVariables({ type: 'global' });
    if (!variables || typeof variables !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(variables, 'extra_analysis')) return null;
    return variables.extra_analysis === true;
  } catch {
    return null;
  }
}

async function waitForExtraModelIdle(
  runtime: Record<string, any>,
  graceMs: number,
  timeoutMs: number,
): Promise<void> {
  const grace = Math.max(0, Math.floor(graceMs));
  const deadline = Date.now() + Math.max(grace, timeoutMs);
  let idleSince = 0;
  while (Date.now() <= deadline) {
    const active = readExtraModelActivity(runtime);
    if (active !== true) {
      if (!idleSince) idleSince = Date.now();
      if (Date.now() - idleSince >= grace) return;
    } else {
      idleSince = 0;
    }
    await new Promise(resolve => setTimeout(resolve, EXTRA_MODEL_RESULT_POLL_MS));
  }
  throw new Error('上一轮 MVU 额外模型请求尚未结束，无法安全开始修复');
}

function hasNewBareUpdateCommands(original: string, updated: string): boolean {
  const commands = (value: string): string[] => value.match(/_\.(?:set|assign|remove|add)\([\s\S]*?\);/g) || [];
  const previous = commands(original);
  return commands(updated).some(command => {
    const index = previous.indexOf(command);
    if (index < 0) return true;
    previous.splice(index, 1);
    return false;
  });
}

/** Keep repair-only lorebook keys active while hiding unrelated generation/settlement anchors. */
function suppressNonRepairAnchors(message: string): string {
  return message
    .replace(
      /\s*[<〈＜]\s*(?:CHARACTER_INIT_PENDING|CONTENT_PENDING|BATTLE_PENDING|BATTLE_START)\s*[>〉＞]\s*/gi,
      '\n',
    )
    .replace(/\s*\[(?:开始战斗|MVU_BATTLE_SETTLEMENT|路线节点|事件选择|营火升级|商店生成)\]\s*/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function findNewUpdateBlock(original: string, updated: string): string | null {
  const originalBlocks = original.match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi) || [];
  const remainingOriginal = [...originalBlocks];
  const candidates = (updated.match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi) || []).filter(block => {
    const originalIndex = remainingOriginal.indexOf(block);
    if (originalIndex < 0) return true;
    remainingOriginal.splice(originalIndex, 1);
    return false;
  });
  const latest = candidates.at(-1);
  return latest || null;
}

/** Replace every failed/stale update block while preserving the original prose and runtime markers. */
function replaceUpdateBlocks(original: string, replacement: string): string {
  let inserted = false;
  const cleaned = removeInjectedRequest(original).replace(
    /<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi,
    () => {
      if (inserted) return '';
      inserted = true;
      return replacement;
    },
  );
  if (inserted) return cleaned.replace(/\n{3,}/g, '\n\n').trim();

  const firstRuntimeMarker = cleaned.search(
    /[<〈＜]\s*(?:CHARACTER_INIT_PENDING|CONTENT_PENDING|BATTLE_PENDING|BATTLE_START|StatusPlaceHolderImpl\s*\/)\s*[>〉＞]/i,
  );
  if (firstRuntimeMarker < 0) return `${cleaned.trimEnd()}\n\n${replacement}`.trim();
  return `${cleaned.slice(0, firstRuntimeMarker).trimEnd()}\n\n${replacement}\n\n${cleaned.slice(firstRuntimeMarker).trimStart()}`.trim();
}

/**
 * Re-run MVU's extra-model parser from a host that survives message iframe
 * reconstruction. The SillyTavern extension uses this entry point so
 * `setChatMessages(..., { refresh: 'none' })` cannot kill the owning repair
 * transaction halfway through its request.
 */
export async function retryMessageWithExtraModelHost(
  runtime: Record<string, any>,
  messageId: number,
  repairPrompt: string,
  options: ExtraModelRepairOptions = {},
): Promise<void> {
  const prompt = repairPrompt.trim();
  if (!prompt) throw new Error('修复请求不能为空');
  const requiredFunctions = [
    'getLastMessageId',
    'getChatMessages',
    'setChatMessages',
    'getVariables',
    'replaceVariables',
    'getAllEnabledScriptButtons',
    'getScriptTrees',
  ];
  const missingFunctions = requiredFunctions.filter(name => typeof runtime?.[name] !== 'function');
  if (missingFunctions.length > 0) {
    throw new Error(`酒馆助手接口缺失: ${missingFunctions.join(', ')}`);
  }
  if (!Number.isInteger(messageId) || messageId < 0) throw new Error('无法确定需要修复的助手楼层');
  const emitEvent = resolveExtraModelEventEmitter(runtime, options);
  assertRepairScopeCurrent(runtime, messageId, options);

  // A killed/rebuilt iframe can leave a stale repair request in the visible
  // message. Never preserve it as user-authored prose or restore it on failure.
  const original = removeInjectedRequest(readMessageText(runtime, messageId));
  if (!original.trim()) throw new Error('当前助手楼层没有可供 MVU 修复的内容');
  const variableOptions = { type: 'message', message_id: messageId } as const;
  const originalVariables = cloneValue(runtime.getVariables(variableOptions));
  const baselineVariables = readPreviousMvuVariables(runtime, messageId);
  const requestBlock = `${REQUEST_BEGIN}\n${prompt}\n${REQUEST_END}`;
  const repairInput = suppressNonRepairAnchors(removeInjectedRequest(original));
  await runtime.setChatMessages(
    [{ message_id: messageId, message: `${repairInput}\n\n${requestBlock}` }],
    { refresh: 'none' },
  );

  let succeeded = false;
  let repairedUpdateBlock = '';
  try {
    const retryEvent = resolveExtraModelRetryEvent(runtime);
    const timeoutMs = Math.max(1, options.resultTimeoutMs ?? EXTRA_MODEL_RESULT_TIMEOUT_MS);
    await waitForExtraModelIdle(
      runtime,
      options.eventReadyGraceMs ?? EXTRA_MODEL_EVENT_READY_GRACE_MS,
      Math.min(timeoutMs, 30_000),
    );
    assertRepairScopeCurrent(runtime, messageId, options);

    // A concurrent first-pass MVU request can become valid while the injected
    // request waits for MVU's chat-scoped button listener to settle.
    if (options.acceptCurrentVariablesWhenValid === true) {
      const currentVariables = runtime.getVariables(variableOptions);
      const mergedVariables = applyStructuralDelta(originalVariables, baselineVariables, currentVariables);
      if (isPlainRecord(mergedVariables)) {
        const candidateVariables = options.reconcileVariables
          ? options.reconcileVariables(cloneValue(originalVariables), cloneValue(mergedVariables))
          : mergedVariables;
        if (isPlainRecord(candidateVariables)) {
          try {
            options.validateVariables?.(candidateVariables);
            await runtime.replaceVariables(candidateVariables, variableOptions);
            await runtime.replaceVariables(candidateVariables, { type: 'chat' });
            succeeded = true;
          } catch {
            // The current snapshot is still invalid; run the owned retry below.
          }
        }
      }
    }
    if (succeeded) return;

    const variablesBeforeEvent = cloneValue(runtime.getVariables(variableOptions));
    await emitEvent(retryEvent);
    let eventRetried = false;
    let eventStarted = false;
    const eventStartDeadline =
      Date.now() + Math.min(options.eventStartTimeoutMs ?? EXTRA_MODEL_EVENT_START_TIMEOUT_MS, timeoutMs);
    while (Date.now() <= eventStartDeadline) {
      assertRepairScopeCurrent(runtime, messageId, options);
      const currentText = removeInjectedRequest(readMessageText(runtime, messageId));
      const currentVariables = runtime.getVariables(variableOptions);
      if (
        readExtraModelActivity(runtime) === true ||
        findNewUpdateBlock(original, currentText) ||
        hasNewBareUpdateCommands(original, currentText) ||
        !valuesEqual(currentVariables, variablesBeforeEvent)
      ) {
        eventStarted = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, EXTRA_MODEL_RESULT_POLL_MS));
    }

    // setChatMessages can briefly rebuild MVU's chat-scoped listeners even
    // with refresh:none. Retry only when the lifecycle flag and both observable
    // outputs prove the first event was dropped.
    if (!eventStarted && readExtraModelActivity(runtime) !== true) {
      eventRetried = true;
      await waitForExtraModelIdle(
        runtime,
        options.eventReadyGraceMs ?? EXTRA_MODEL_EVENT_READY_GRACE_MS,
        10_000,
      );
      assertRepairScopeCurrent(runtime, messageId, options);
      await emitEvent(retryEvent);
    }

    const deadline = Date.now() + timeoutMs;
    let reconciledVariables: Record<string, any> | null = null;
    let sawNewUpdateBlock = false;
    let sawVariableWrite = false;
    let sawEventActivity = eventStarted;
    let lastValidationError: unknown = null;

    while (Date.now() <= deadline) {
      assertRepairScopeCurrent(runtime, messageId, options);
      const updated = readMessageText(runtime, messageId);
      const cleanedUpdated = removeInjectedRequest(updated);
      const updateBlock = findNewUpdateBlock(original, cleanedUpdated);
      if (updateBlock) {
        repairedUpdateBlock = updateBlock;
        sawNewUpdateBlock = true;
      }
      if (readExtraModelActivity(runtime) === true) sawEventActivity = true;

      const updatedVariables = runtime.getVariables(variableOptions);
      // The current floor normally differs from the previous-floor baseline
      // before the retry starts. Treating that pre-existing delta as the model
      // result makes scoped repair (especially cards-only) reject immediately,
      // before the asynchronous MVU handler has written anything. A candidate
      // exists only after this retry changed the message variables.
      const changedSinceEvent = !valuesEqual(updatedVariables, variablesBeforeEvent);
      if (changedSinceEvent && !valuesEqual(updatedVariables, baselineVariables)) {
        sawVariableWrite = true;
        const mergedVariables = applyStructuralDelta(originalVariables, baselineVariables, updatedVariables);
        if (!isPlainRecord(mergedVariables)) throw new Error('MVU 额外模型返回的变量根不是对象');
        const candidateVariables = options.reconcileVariables
          ? options.reconcileVariables(cloneValue(originalVariables), cloneValue(mergedVariables))
          : mergedVariables;
        if (!isPlainRecord(candidateVariables)) throw new Error('MVU 修复范围处理后的变量根不是对象');
        try {
          options.validateVariables?.(candidateVariables);
          lastValidationError = null;
          if (sawNewUpdateBlock || options.acceptCurrentVariablesWhenValid === true) {
            reconciledVariables = candidateVariables;
            break;
          }
        } catch (error) {
          lastValidationError = error;
          // A new block plus a settled variable write is the retry candidate.
          // Reject it immediately so the bounded caller can request a second fix.
          if (sawNewUpdateBlock) throw error;
        }
      }

      if (
        !sawNewUpdateBlock &&
        readExtraModelActivity(runtime) !== true &&
        hasNewBareUpdateCommands(original, cleanedUpdated)
      ) {
        throw new ExtraModelCandidateRejectedError(
          'MVU 额外模型返回了变量命令，但缺少完整的 <UpdateVariable> 外层标签',
        );
      }

      await new Promise(resolve => setTimeout(resolve, EXTRA_MODEL_RESULT_POLL_MS));
    }

    if (!reconciledVariables) {
      if (lastValidationError && sawVariableWrite) throw lastValidationError;
      if (!sawNewUpdateBlock && (sawEventActivity || eventRetried)) {
        throw new ExtraModelCandidateRejectedError('MVU 额外模型没有返回新的变量更新块');
      }
      if (!sawNewUpdateBlock) throw new Error('MVU 额外模型重试事件没有启动');
      if (!sawVariableWrite) throw new Error('MVU 额外模型没有写回修复后的变量');
      throw new Error('等待 MVU 额外模型写回超时');
    }

    assertRepairScopeCurrent(runtime, messageId, options);
    await runtime.replaceVariables(reconciledVariables, variableOptions);
    await runtime.replaceVariables(reconciledVariables, { type: 'chat' });
    succeeded = true;
  } catch (error) {
    // Tavern Helper's methods follow the active chat. Once the user changes
    // chats, attempting rollback would overwrite the new save instead of the
    // abandoned one. Leave that old floor untouched and reject the transaction.
    if (canSafelyRestoreRepair(runtime, messageId, options)) {
      await runtime.replaceVariables(originalVariables, variableOptions);
      await runtime.replaceVariables(originalVariables, { type: 'chat' });
      await runtime.setChatMessages(
        [{ message_id: messageId, message: original }],
        { refresh: options.refreshOnFailure ?? 'affected' },
      );
    }
    throw error;
  } finally {
    if (succeeded) {
      assertRepairScopeCurrent(runtime, messageId, options);
      const cleaned = repairedUpdateBlock ? replaceUpdateBlocks(original, repairedUpdateBlock) : original;
      await runtime.setChatMessages(
        [{ message_id: messageId, message: cleaned }],
        { refresh: 'affected' },
      );
    }
  }
}

/** Re-run MVU's extra-model parser against the current assistant floor without creating a chat message. */
export async function retryCurrentMessageWithExtraModel(
  repairPrompt: string,
  options: ExtraModelRepairOptions = {},
): Promise<void> {
  assertCurrentMessageLatest();
  const prompt = repairPrompt.trim();
  if (!prompt) throw new Error('修复请求不能为空');

  // Tower mode already requires the project extension. Let its persistent
  // controller own the whole in-place transaction; a message iframe can be
  // reconstructed by setChatMessages even when refresh:none is requested.
  const sharedRuntime = persistentRepairProvider();
  if (sharedRuntime) {
    const persistent = sharedRuntime.requestMvuExtraRepair({
      spec: 'mwg.mvu-repair-request/v1',
      prompt,
      scope: persistentRepairScope(prompt),
    });
    if (persistent !== null && persistent !== undefined) {
      await persistent;
      return;
    }
  }

  const runtime = requireTavernHelperHost([
    'getCurrentMessageId',
    'getLastMessageId',
    'getChatMessages',
    'setChatMessages',
    'getVariables',
    'replaceVariables',
    'getAllEnabledScriptButtons',
    'getScriptTrees',
  ]);
  const messageId = getCurrentMessageVariableOptions().message_id;
  if (!Number.isInteger(messageId)) throw new Error('无法确定需要修复的助手楼层');
  await retryMessageWithExtraModelHost(runtime, messageId as number, prompt, options);
}
