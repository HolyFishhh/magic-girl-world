const TIME_BLOCK_PATTERN = /<Time>([^<>\r\n]{1,200})<\/Time>/g;
const INITIALIZATION_MARKER = '<CHARACTER_INIT_PENDING>';
const MAX_RECOVERED_CHARACTERS = 1200;
const MAX_STORY_PARAGRAPHS = 4;
const MIN_STORY_PARAGRAPHS = 2;
const STORY_RESPONSE_PREFIX = '好的，我将进行符合需求的创作：';
const MAX_RECOVERED_STORY_CHARACTERS = 20_000;

interface OfficialChatContext {
  chat?: Array<Record<string, any>>;
  saveChat?(): Promise<void> | void;
  updateMessageBlock?(
    messageId: number,
    message: Record<string, any>,
    options?: { rerenderMessage?: boolean },
  ): void;
  eventSource?: {
    emit?(eventName: string, ...args: unknown[]): Promise<unknown> | unknown;
  };
}

export interface ReasoningRecoveryRuntime {
  getLastMessageId(): number;
  getChatMessages(range: number | string): Array<Record<string, any>>;
  setChatMessages(
    messages: Array<{ message_id: number; message: string }>,
    options?: { refresh?: 'none' | 'affected' | 'all' },
  ): Promise<void> | void;
  eventEmit(eventName: string, ...args: unknown[]): Promise<unknown> | unknown;
}

export interface ReasoningRecoveryScope {
  chatId: string;
  messageReceivedEvent?: string;
  isCurrent(): boolean;
}

/**
 * SillyTavern 1.18 exposes the active chat through its official extension
 * context. Tavern Helper normally mirrors the same data, but it can mount
 * after a persistent extension or be disabled independently. This adapter
 * keeps initialization recovery on the official host path instead of making
 * a card-scoped repair depend on a second extension's global timing.
 */
export function createOfficialReasoningRecoveryRuntime(
  context: OfficialChatContext | null | undefined,
): ReasoningRecoveryRuntime | null {
  if (!context || !Array.isArray(context.chat)) return null;
  if (typeof context.saveChat !== 'function' || typeof context.eventSource?.emit !== 'function') return null;

  const messageAt = (messageId: number): Record<string, any> | null => {
    const normalizedId = messageId < 0 ? context.chat!.length + messageId : messageId;
    if (!Number.isInteger(normalizedId) || normalizedId < 0 || normalizedId >= context.chat!.length) return null;
    const message = context.chat![normalizedId];
    return message && typeof message === 'object' ? message : null;
  };

  return {
    getLastMessageId: () => context.chat!.length - 1,
    getChatMessages: range => {
      const messageId = Number(range);
      const message = messageAt(messageId);
      if (!message) return [];
      const normalizedId = messageId < 0 ? context.chat!.length + messageId : messageId;
      return [{
        message_id: normalizedId,
        role: message.is_system === true ? 'system' : message.is_user === true ? 'user' : 'assistant',
        is_user: message.is_user === true,
        is_system: message.is_system === true,
        message: typeof message.mes === 'string' ? message.mes : '',
        extra: message.extra,
        variables: message.variables,
      }];
    },
    setChatMessages: async updates => {
      for (const update of updates) {
        const message = messageAt(Number(update.message_id));
        if (!message) continue;
        message.mes = update.message;
        const swipeId = Number(message.swipe_id);
        if (Array.isArray(message.swipes) && Number.isInteger(swipeId) && swipeId >= 0) {
          message.swipes[swipeId] = update.message;
        }
        context.updateMessageBlock?.(Number(update.message_id), message, { rerenderMessage: true });
      }
      await context.saveChat!();
    },
    eventEmit: (eventName, ...args) => context.eventSource!.emit!(eventName, ...args),
  };
}

export type ReasoningRecoveryResult =
  | { status: 'recovered'; chatId: string; messageId: number; message: string }
  | { status: 'replayed'; chatId: string; messageId: number }
  | { status: 'skipped'; reason: string; chatId: string; messageId?: number };

function normalizedParagraphs(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

function isShortMetaParagraph(paragraph: string): boolean {
  if (paragraph.length > 240) return false;
  const normalized = paragraph.replace(/[\s：:，,。.!！?？]+/g, ' ').trim();
  if (!normalized) return true;
  if (/^<\/?(?:analysis|thinking|reasoning)>$/i.test(normalized)) return true;

  const startsAsAssistant = /^(?:好的|明白|收到|以下|下面|现在|接下来|首先|我将|让我们|Here(?:'s| is)|I will)/i.test(normalized);
  const hasMetaSubject = /(?:输出|思考|推理|分析|创作|写作|正文|格式|要求|需求|指令|提示词|任务|段落|字数|output|thinking|reasoning|analysis|writing|requirement|instruction)/i.test(normalized);
  const explicitTransition = /(?:开始|进行|给出|生成|遵循|按照|根据).{0,24}(?:创作|写作|输出|正文|要求|指令|格式)/i.test(normalized);
  return (startsAsAssistant && hasMetaSubject) || explicitTransition;
}

function isUnsafeReasoningParagraph(paragraph: string): boolean {
  if (/<\/?(?:analysis|thinking|reasoning)>/i.test(paragraph)) return true;
  if (/<UpdateVariable>|_\.(?:set|assign|remove|add)\s*\(/i.test(paragraph)) return true;

  const signals = [
    /(?:用户|系统|模型|提示词|指令)/,
    /(?:我需要|我应该|我将|我要|让我们)/,
    /(?:输出|思考|推理|分析|创作|写作)/,
    /(?:正文|格式|要求|字数|段落|标记)/,
    /(?:prompt|instruction|reasoning|analysis|output)/i,
  ];
  const score = signals.reduce((total, pattern) => total + (pattern.test(paragraph) ? 1 : 0), 0);
  return score >= 2;
}

function hasNarrativeContent(paragraph: string): boolean {
  if (paragraph.length < 8) return false;
  if (!/[\p{Script=Han}A-Za-z]/u.test(paragraph)) return false;
  if (/^\[[^\]]{1,80}\]$/.test(paragraph)) return false;
  return !isUnsafeReasoningParagraph(paragraph);
}

function truncateAtSentence(value: string, limit: number): string {
  if (value.length <= limit) return value;
  if (limit < 8) return '';
  const candidate = value.slice(0, limit + 1);
  let boundary = -1;
  for (const match of candidate.matchAll(/[。！？!?…][」』”’]?/g)) {
    boundary = (match.index || 0) + match[0].length;
  }
  if (boundary < Math.min(24, Math.floor(limit * 0.35))) return '';
  return value.slice(0, boundary).trimEnd();
}

/**
 * Recover only a deliberately formatted, displayable opening that a provider
 * misplaced in `extra.reasoning`. This is intentionally not a generic
 * reasoning-to-answer fallback: both project protocol boundaries are required.
 */
export function extractDisplayableOpeningFromReasoning(reasoning: unknown): string | null {
  if (typeof reasoning !== 'string' || !reasoning.trim()) return null;
  const markerIndex = reasoning.lastIndexOf(INITIALIZATION_MARKER);
  if (markerIndex < 0) return null;
  const timeMatch = Array.from(reasoning.matchAll(TIME_BLOCK_PATTERN))
    .filter(match => match.index !== undefined && match.index + match[0].length < markerIndex)
    .at(-1);
  if (!timeMatch || timeMatch.index === undefined) return null;

  const bounded = reasoning.slice(timeMatch.index, markerIndex + INITIALIZATION_MARKER.length);
  const bodyStart = timeMatch[0].length;
  const rawBody = bounded.slice(bodyStart, bounded.length - INITIALIZATION_MARKER.length).trim();
  const paragraphs = normalizedParagraphs(rawBody);

  while (paragraphs.length > 0 && isShortMetaParagraph(paragraphs[0])) paragraphs.shift();

  const story: string[] = [];
  for (const paragraph of paragraphs) {
    if (!hasNarrativeContent(paragraph)) {
      if (story.length > 0) break;
      continue;
    }
    story.push(paragraph);
    if (story.length >= MAX_STORY_PARAGRAPHS) break;
  }
  if (story.length < MIN_STORY_PARAGRAPHS) return null;

  const prefix = timeMatch[0];
  const suffix = INITIALIZATION_MARKER;
  const separators = 4; // two blank-line separators around story and marker
  const bodyBudget = MAX_RECOVERED_CHARACTERS - prefix.length - suffix.length - separators;
  const selected: string[] = [];
  let used = 0;
  for (const paragraph of story) {
    const separatorLength = selected.length > 0 ? 2 : 0;
    const remaining = bodyBudget - used - separatorLength;
    if (remaining <= 0) break;
    const fitted = truncateAtSentence(paragraph, remaining);
    if (!fitted) break;
    selected.push(fitted);
    used += separatorLength + fitted.length;
    if (fitted.length < paragraph.length) break;
  }
  if (selected.length < MIN_STORY_PARAGRAPHS) return null;

  const recovered = `${prefix}\n\n${selected.join('\n\n')}\n\n${suffix}`;
  return recovered.length <= MAX_RECOVERED_CHARACTERS ? recovered : null;
}

/**
 * Recover a visible story only when the provider put the completed answer in
 * a final Markdown fence and left the public message empty. The exact preset
 * prefix, a leading time header and two narrative paragraphs form the trust
 * boundary; ordinary free-form reasoning never qualifies.
 */
export function extractDisplayableStoryFinalFromReasoning(reasoning: unknown): string | null {
  if (typeof reasoning !== 'string' || !reasoning.trim()) return null;

  const fencePattern = /```(?:[A-Za-z0-9_-]+)?[ \t]*\r?\n/g;
  const fences = Array.from(reasoning.matchAll(fencePattern));
  for (let index = fences.length - 1; index >= 0; index -= 1) {
    const fence = fences[index];
    if (fence.index === undefined) continue;
    const start = fence.index + fence[0].length;
    const closing = reasoning.indexOf('```', start);
    const candidate = reasoning.slice(start, closing >= 0 ? closing : reasoning.length).trim();
    if (!candidate.startsWith(STORY_RESPONSE_PREFIX)) continue;
    if (candidate.length > MAX_RECOVERED_STORY_CHARACTERS) continue;
    if (/<\/?(?:analysis|thinking|reasoning)>|<UpdateVariable>|_\.(?:set|assign|remove|add)\s*\(/i.test(candidate)) {
      continue;
    }

    const body = candidate.slice(STORY_RESPONSE_PREFIX.length).trimStart();
    const paragraphs = normalizedParagraphs(body);
    if (paragraphs.length < 3) continue;
    const hasLeadingTime = /^<Time>[^<>\r\n]{1,200}<\/Time>$/.test(paragraphs[0])
      || /^『[^\r\n]{3,200}』$/.test(paragraphs[0]);
    if (!hasLeadingTime) continue;
    if (!paragraphs.slice(1, 1 + MIN_STORY_PARAGRAPHS).every(hasNarrativeContent)) continue;
    return candidate;
  }
  return null;
}

function extractRecoverableFinal(reasoning: unknown): string | null {
  return extractDisplayableOpeningFromReasoning(reasoning)
    || extractDisplayableStoryFinalFromReasoning(reasoning);
}

function assistantMessage(messages: Array<Record<string, any>>, messageId: number): Record<string, any> | null {
  const message = messages.find(candidate => Number(candidate?.message_id) === messageId) || messages.at(-1);
  if (!message) return null;
  if (typeof message.role === 'string') return message.role === 'assistant' ? message : null;
  // Legacy/raw message shapes are accepted only when they explicitly identify
  // the floor as a non-user message. Missing role metadata is not proof that a
  // private reasoning record belongs to an assistant reply.
  if (message.is_user !== false || message.is_system === true) return null;
  return message;
}

function hasRequiredRuntime(runtime: unknown): runtime is ReasoningRecoveryRuntime {
  if (!runtime || typeof runtime !== 'object') return false;
  const candidate = runtime as Record<string, unknown>;
  return ['getLastMessageId', 'getChatMessages', 'setChatMessages', 'eventEmit']
    .every(name => typeof candidate[name] === 'function');
}

/** Persistent extension owner for final-answer recovery across iframe rebuilds. */
export class ReasoningFinalRecoveryHost {
  private readonly completed = new Set<string>();
  private readonly replayed = new Set<string>();
  private readonly inFlight = new Map<string, Promise<ReasoningRecoveryResult>>();

  auditLatest(runtime: unknown, scope: ReasoningRecoveryScope): Promise<ReasoningRecoveryResult> {
    if (!hasRequiredRuntime(runtime)) {
      return Promise.resolve({ status: 'skipped', reason: 'tavern-helper-unavailable', chatId: scope.chatId });
    }
    if (!scope.chatId || !scope.isCurrent()) {
      return Promise.resolve({ status: 'skipped', reason: 'stale-chat-scope', chatId: scope.chatId });
    }

    const messageId = Number(runtime.getLastMessageId());
    if (!Number.isInteger(messageId) || messageId < 0) {
      return Promise.resolve({ status: 'skipped', reason: 'missing-latest-message', chatId: scope.chatId });
    }
    const key = `${scope.chatId}\u0000${messageId}`;
    if (this.completed.has(key)) {
      return Promise.resolve({ status: 'skipped', reason: 'already-recovered', chatId: scope.chatId, messageId });
    }
    const duplicate = this.inFlight.get(key);
    if (duplicate) return duplicate;

    const recovery = this.recover(runtime, scope, messageId, key);
    this.inFlight.set(key, recovery);
    void recovery.then(
      () => this.inFlight.delete(key),
      () => this.inFlight.delete(key),
    );
    return recovery;
  }

  clear(): void {
    this.completed.clear();
    this.replayed.clear();
    this.inFlight.clear();
  }

  async replayLatestAfterRuntimeReady(
    runtime: unknown,
    scope: ReasoningRecoveryScope,
  ): Promise<ReasoningRecoveryResult> {
    if (!hasRequiredRuntime(runtime)) {
      return { status: 'skipped', reason: 'tavern-helper-unavailable', chatId: scope.chatId };
    }
    if (!scope.chatId || !scope.isCurrent()) {
      return { status: 'skipped', reason: 'stale-chat-scope', chatId: scope.chatId };
    }
    const messageId = Number(runtime.getLastMessageId());
    if (!Number.isInteger(messageId) || messageId < 0) {
      return { status: 'skipped', reason: 'missing-latest-message', chatId: scope.chatId };
    }
    const key = `${scope.chatId}\u0000${messageId}`;
    if (!this.completed.has(key)) {
      return { status: 'skipped', reason: 'not-recovered', chatId: scope.chatId, messageId };
    }
    if (this.replayed.has(key)) {
      return { status: 'skipped', reason: 'already-replayed', chatId: scope.chatId, messageId };
    }
    const messages = runtime.getChatMessages(messageId);
    const message = assistantMessage(Array.isArray(messages) ? messages : [], messageId);
    const recovered = message ? extractRecoverableFinal(message.extra?.reasoning) : null;
    if (!message || typeof message.message !== 'string' || !recovered || message.message.trim() !== recovered.trim()) {
      return { status: 'skipped', reason: 'recovered-message-changed', chatId: scope.chatId, messageId };
    }
    if (!scope.isCurrent() || Number(runtime.getLastMessageId()) !== messageId) {
      return { status: 'skipped', reason: 'stale-chat-scope', chatId: scope.chatId, messageId };
    }
    // Reserve before emission because message_received may synchronously
    // re-enter a runtime-ready hook. Roll the reservation back only when the
    // event itself fails so a later ready event can retry safely.
    this.replayed.add(key);
    try {
      await runtime.eventEmit(scope.messageReceivedEvent || 'message_received', messageId, 'extension');
    } catch (error) {
      this.replayed.delete(key);
      throw error;
    }
    return { status: 'replayed', chatId: scope.chatId, messageId };
  }

  private async recover(
    runtime: ReasoningRecoveryRuntime,
    scope: ReasoningRecoveryScope,
    messageId: number,
    key: string,
  ): Promise<ReasoningRecoveryResult> {
    const messages = runtime.getChatMessages(messageId);
    const message = assistantMessage(Array.isArray(messages) ? messages : [], messageId);
    if (!message) return { status: 'skipped', reason: 'not-latest-assistant', chatId: scope.chatId, messageId };
    const recovered = extractRecoverableFinal(message.extra?.reasoning);
    if (
      recovered &&
      typeof message.message === 'string' &&
      message.message.trim() === recovered.trim()
    ) {
      // The extension may restart after the safe text was already persisted
      // but before MVU consumed the floor. Reconstruct the pending state from
      // the strict protocol instead of treating the non-empty answer as an
      // unrelated message and abandoning initialization forever.
      this.completed.add(key);
      return { status: 'skipped', reason: 'already-recovered', chatId: scope.chatId, messageId };
    }
    if (typeof message.message !== 'string' || message.message.trim() !== '') {
      return { status: 'skipped', reason: 'final-answer-not-empty', chatId: scope.chatId, messageId };
    }

    if (!recovered) {
      return { status: 'skipped', reason: 'missing-display-protocol', chatId: scope.chatId, messageId };
    }
    if (!scope.isCurrent() || Number(runtime.getLastMessageId()) !== messageId) {
      return { status: 'skipped', reason: 'stale-chat-scope', chatId: scope.chatId, messageId };
    }

    await runtime.setChatMessages(
      [{ message_id: messageId, message: recovered }],
      { refresh: 'affected' },
    );
    if (!scope.isCurrent() || Number(runtime.getLastMessageId()) !== messageId) {
      return { status: 'skipped', reason: 'scope-changed-after-write', chatId: scope.chatId, messageId };
    }

    // Mark the persisted floor before emitting. SillyTavern can initialize
    // the character runtime and MVU re-entrantly inside message_received; if
    // this flag is written afterwards, the ready listener sees a false
    // "not-recovered" state and the second round is permanently missed.
    this.completed.add(key);
    await runtime.eventEmit(scope.messageReceivedEvent || 'message_received', messageId, 'extension');
    return { status: 'recovered', chatId: scope.chatId, messageId, message: recovered };
  }
}
