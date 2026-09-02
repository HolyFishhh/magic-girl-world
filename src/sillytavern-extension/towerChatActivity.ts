import { validateRunState } from '../game-core/runState';
import type { SillyTavernContext } from './types';

export interface TowerChatActivityTouchResult {
  touched: boolean;
  messageId: number | null;
  timestamp: string | null;
}

export type TowerChatContextProvider = () => SillyTavernContext | null | undefined;

export interface PersistedMessageVariablesSnapshot {
  variables: Record<string, any>;
  messageId: number;
}

export interface PersistedTowerMvuRestoreAssessment {
  action: 'restore' | 'keep-current' | 'ignore';
  reason:
    | 'persisted-tower-ready'
    | 'persisted-tower-newer'
    | 'current-tower-current'
    | 'current-story-locked'
    | 'current-nonempty-story'
    | 'persisted-not-tower'
    | 'persisted-lock-invalid'
    | 'persisted-run-invalid';
  persistedRevision?: number;
  currentRevision?: number;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unwrapMessageVariables(value: unknown, swipeId: number | null): Record<string, any> | null {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (isRecord(current) && isRecord(current.stat_data)) return current;
    if (Array.isArray(current) && current.length === 1) {
      current = current[0];
      continue;
    }
    if (isRecord(current) && swipeId !== null && Object.hasOwn(current, String(swipeId))) {
      current = current[String(swipeId)];
      continue;
    }
    if (isRecord(current) && Object.keys(current).length === 1 && Object.hasOwn(current, '0')) {
      current = current['0'];
      continue;
    }
    break;
  }
  return isRecord(current) && isRecord(current.stat_data) ? current : null;
}

/**
 * Read variables that are physically attached to one exact chat floor.
 *
 * This is intentionally narrower than the backwards-looking recovery helper
 * below. During streaming, Tavern Helper can resolve inherited variables from
 * the preceding user floor for a newly-created assistant floor. That is useful
 * for ordinary rendering, but unsafe for side effects such as automatically
 * requesting battle rewards: the assistant must first own a persisted MVU
 * snapshot of its own.
 */
export function readPersistedMessageVariableSnapshot(
  context: SillyTavernContext | null | undefined,
  messageId: number,
): PersistedMessageVariablesSnapshot | null {
  if (!context || !Array.isArray(context.chat) || !Number.isInteger(messageId)) return null;
  const message = context.chat[messageId];
  if (!isRecord(message)) return null;
  const swipeId = Number.isInteger(Number(message.swipe_id)) ? Number(message.swipe_id) : null;
  const fromMessage = unwrapMessageVariables(message.variables, swipeId);
  if (fromMessage) return { variables: fromMessage, messageId };
  if (swipeId !== null && Array.isArray(message.swipe_info)) {
    const fromSwipe = unwrapMessageVariables(message.swipe_info[swipeId]?.variables, swipeId);
    if (fromSwipe) return { variables: fromSwipe, messageId };
  }
  return null;
}

/**
 * Read the latest persisted message-variable snapshot from the current Tavern
 * chat. MVU normally provides this object, but while an old chat is restoring
 * its `latest` alias can remain unavailable even after the message iframe has
 * rendered. The raw chat message is the same persisted source and is safe as a
 * read-only recovery fallback.
 */
export function readLatestPersistedMessageVariableSnapshot(
  context: SillyTavernContext | null | undefined,
  startMessageId?: number,
): PersistedMessageVariablesSnapshot | null {
  if (!context || !Array.isArray(context.chat) || context.chat.length === 0) return null;
  const requested = Number.isInteger(startMessageId)
    ? Number(startMessageId)
    : context.chat.length - 1;
  const start = Math.min(context.chat.length - 1, Math.max(0, requested));
  for (let messageId = start; messageId >= 0; messageId -= 1) {
    const snapshot = readPersistedMessageVariableSnapshot(context, messageId);
    if (snapshot) return snapshot;
  }
  return null;
}

export function readLatestPersistedMessageVariables(
  context: SillyTavernContext | null | undefined,
  startMessageId?: number,
): Record<string, any> | null {
  return readLatestPersistedMessageVariableSnapshot(context, startMessageId)?.variables ?? null;
}

/**
 * Decide whether a persisted tower snapshot may repair MVU's transient memory
 * after a chat reload. A locked story state always wins, while the unlocked
 * empty story object from `initvar` is treated as a loading placeholder.
 */
export function assessPersistedTowerMvuRestore(
  persisted: Record<string, any>,
  current: Record<string, any> | null,
): PersistedTowerMvuRestoreAssessment {
  const persistedStat = isRecord(persisted.stat_data) ? persisted.stat_data : null;
  if (String(persistedStat?.game_mode ?? '').trim() !== 'tower') {
    return { action: 'ignore', reason: 'persisted-not-tower' };
  }
  const persistedLock = isRecord(persistedStat?.game_mode_lock) ? persistedStat.game_mode_lock : null;
  if (persistedLock?.schemaVersion !== 1 || persistedLock.mode !== 'tower') {
    return { action: 'ignore', reason: 'persisted-lock-invalid' };
  }
  const persistedRun = validateRunState(persistedStat?.run);
  if (!persistedRun.ok) {
    return { action: 'ignore', reason: 'persisted-run-invalid' };
  }
  const persistedRevision = persistedRun.value.stateRevision;
  const currentStat = isRecord(current?.stat_data) ? current.stat_data : null;
  if (!currentStat) {
    return { action: 'restore', reason: 'persisted-tower-ready', persistedRevision };
  }

  const currentMode = String(currentStat.game_mode ?? '').trim();
  const currentLock = isRecord(currentStat.game_mode_lock) ? currentStat.game_mode_lock : null;
  if (currentMode === 'tower') {
    const currentRun = validateRunState(currentStat.run);
    if (!currentRun.ok) {
      return { action: 'restore', reason: 'persisted-tower-ready', persistedRevision };
    }
    const currentRevision = currentRun.value.stateRevision;
    if (currentRevision >= persistedRevision) {
      return {
        action: 'keep-current',
        reason: 'current-tower-current',
        persistedRevision,
        currentRevision,
      };
    }
    return {
      action: 'restore',
      reason: 'persisted-tower-newer',
      persistedRevision,
      currentRevision,
    };
  }

  if (currentLock?.schemaVersion === 1 && currentLock.mode === 'story') {
    return { action: 'keep-current', reason: 'current-story-locked', persistedRevision };
  }
  if (currentMode === 'story' && currentStat.run !== null && currentStat.run !== undefined) {
    return { action: 'keep-current', reason: 'current-nonempty-story', persistedRevision };
  }
  return { action: 'restore', reason: 'persisted-tower-ready', persistedRevision };
}

function activeSwipe(message: Record<string, any>): Record<string, any> | null {
  const swipeId = Number(message.swipe_id);
  if (!Array.isArray(message.swipe_info) || !Number.isInteger(swipeId)) return null;
  const candidate = message.swipe_info[swipeId];
  return candidate && typeof candidate === 'object' ? candidate : null;
}

/**
 * Refresh the timestamp of a single-floor tower chat without creating a new
 * Tavern message. SillyTavern's recent-chat list sorts by the final message's
 * send_date, while MVU-only gameplay otherwise leaves that date frozen at the
 * opening scene for the entire run.
 */
export async function touchTowerChatActivity(
  context: SillyTavernContext | null | undefined,
  timestampMs: number,
): Promise<TowerChatActivityTouchResult> {
  if (!context || !Array.isArray(context.chat) || context.chat.length === 0) {
    return { touched: false, messageId: null, timestamp: null };
  }
  if (typeof context.saveChat !== 'function') {
    return { touched: false, messageId: null, timestamp: null };
  }
  const messageId = context.chat.length - 1;
  const message = context.chat[messageId];
  if (!message || typeof message !== 'object') {
    return { touched: false, messageId: null, timestamp: null };
  }
  const timestamp = new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()).toISOString();
  message.send_date = timestamp;
  const swipe = activeSwipe(message);
  if (swipe) swipe.send_date = timestamp;
  await context.saveChat();
  return { touched: true, messageId, timestamp };
}

/**
 * Resolve the SillyTavern context at save time instead of retaining the
 * context object captured before a chat switch. SillyTavern can replace its
 * exported `chat` array while loading a chat; mutating the older array and
 * then calling the global save path only refreshes the file mtime without
 * persisting the message timestamp.
 */
export async function touchCurrentTowerChatActivity(
  contextProvider: TowerChatContextProvider,
  expectedChatId: string,
  timestampMs: number,
): Promise<TowerChatActivityTouchResult> {
  const context = contextProvider();
  const currentChatId = String(context?.chatId ?? '').trim();
  if (!currentChatId || currentChatId !== expectedChatId) {
    return { touched: false, messageId: null, timestamp: null };
  }
  return touchTowerChatActivity(context, timestampMs);
}
