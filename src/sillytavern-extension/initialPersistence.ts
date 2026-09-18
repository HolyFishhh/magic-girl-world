import { TOWER_INITIAL_PUBLICATION_KEY, towerInitialStateKey, type TowerInitialPublication } from './towerInitialCommit';
import type { SillyTavernContext } from './types';

export interface TowerInitialPersistenceCheck {
  chatId: string;
  messageId: number;
  swipeId: number;
  message: string;
  variables: Record<string, any>;
  requireChatCache: boolean;
  publication?: TowerInitialPublication;
}

/**
 * SillyTavern saveChat catches HTTP failures rather than rejecting its promise.
 * A read-only, exact-target readback is required before claiming durable startup.
 * This never forces a save or changes chat selection to bypass integrity checks.
 */
export async function verifyTowerInitialPersistence(
  context: SillyTavernContext | null,
  expected: TowerInitialPersistenceCheck,
  request: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (!context || String(context.chatId) !== expected.chatId || context.groupId != null
    || typeof context.getRequestHeaders !== 'function') {
    throw new Error('当前宿主无法核对开局保存回执，未确认持久化成功');
  }
  const character = context.characters?.[Number(context.characterId)];
  if (typeof character?.avatar !== 'string' || !character.avatar || character.chat !== expected.chatId) {
    throw new Error('当前角色与保存目标不一致，未读取其他存档');
  }
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15_000);
  let records: unknown;
  try {
    const response = await request('/api/chats/get', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
      headers: { ...context.getRequestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_url: character.avatar, file_name: expected.chatId }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    records = await response.json();
  } catch (error) {
    const reason = abort.signal.aborted ? '读回超时' : error instanceof Error ? error.message : '读回失败';
    throw new Error(`开局已生成，但无法确认已保存（${reason}）；请重试当前开局操作以继续保存，不会重新生成卡组`);
  } finally {
    clearTimeout(timeout);
  }
  const header = Array.isArray(records) && records[0] && typeof records[0].mes !== 'string' ? records[0] : null;
  const messages = Array.isArray(records) ? (header ? records.slice(1) : records) : [];
  const message = messages[expected.messageId];
  const variables = message?.variables?.[expected.swipeId];
  if (!message || message.is_user !== false || (message.swipe_id ?? 0) !== expected.swipeId
    || message.mes !== expected.message
    || towerInitialStateKey(variables) !== towerInitialStateKey(expected.variables)
    || (expected.requireChatCache && towerInitialStateKey(header?.chat_metadata?.variables) !== towerInitialStateKey(expected.variables))
    || (expected.publication && towerInitialStateKey(header?.chat_metadata?.[TOWER_INITIAL_PUBLICATION_KEY]) !== towerInitialStateKey(expected.publication))) {
    throw new Error('开局已生成，但磁盘读回的正文或变量尚不一致；请重试当前开局操作以继续保存，不会重新生成卡组');
  }
}
