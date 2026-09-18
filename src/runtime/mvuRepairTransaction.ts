type RepairApi = Record<string, any>;

function equal(left: any, right: any): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

export function captureMvuRepairScope(api: RepairApi, messageId: number, isCurrent?: () => boolean) {
  const swipeId = api.getChatMessages(messageId)?.at(-1)?.swipe_id;
  if (!Number.isInteger(swipeId) || swipeId < 0) throw new Error('无法确定待修复楼层的当前回复，已停止修复');
  let invalidated = false;
  const current = (): boolean => {
    try {
      if (invalidated || isCurrent?.() === false || Number(api.getLastMessageId()) !== messageId
        || api.getChatMessages(messageId)?.at(-1)?.swipe_id !== swipeId) invalidated = true;
    } catch { invalidated = true; }
    return !invalidated;
  };
  const assertCurrent = (): void => {
    if (!current()) throw new Error('当前聊天已切换或回复已变化，已取消旧存档的 MVU 修复');
  };
  assertCurrent();
  return { swipeId, current, assertCurrent };
}

export function readMvuRepairSnapshot(api: RepairApi, messageId: number) {
  return {
    message: String(api.getChatMessages(messageId)?.at(-1)?.message ?? ''),
    variables: structuredClone(api.getVariables({ type: 'message', message_id: messageId })),
  };
}

/** Helper applies message+data synchronously before its asynchronous refresh.
 * This is an in-memory paired write, not a claim of disk acknowledgement.
 */
export async function commitMvuRepairSnapshot(
  api: RepairApi,
  messageId: number,
  before: ReturnType<typeof readMvuRepairSnapshot>,
  after: ReturnType<typeof readMvuRepairSnapshot>,
  assertCurrent: () => void,
): Promise<void> {
  const matches = (snapshot: typeof before): boolean => equal(readMvuRepairSnapshot(api, messageId), snapshot);
  assertCurrent();
  if (!matches(before)) throw new Error('修复期间正文或变量已变化，已保留新数据并停止旧结果提交');
  const write = (snapshot: typeof before) => api.setChatMessages(
    [{ message_id: messageId, message: snapshot.message, data: structuredClone(snapshot.variables) }],
    { refresh: 'affected' },
  );
  try {
    await write(after);
    assertCurrent();
    if (!matches(after)) throw new Error('修复刷新期间正文或变量已变化，已保留新数据');
  } catch (error) {
    let ownsWrittenPair = false;
    try { assertCurrent(); ownsWrittenPair = matches(after); } catch { /* No writes into another owner. */ }
    if (ownsWrittenPair) await write(before);
    throw error;
  }
}
