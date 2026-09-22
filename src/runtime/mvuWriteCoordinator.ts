import { mergeMessageVariableUpdate, messageVariableValuesEqual } from './messageVariableMerge';

// The extension and character iframe load separate bundles. Their coordinator
// must live on their common same-origin window, not in either module closure.
const key = Symbol.for('mwg.mvu-write-coordinator/v1');
function owner(): Record<PropertyKey, any> {
  const root = globalThis as any;
  return root.window?.top || root.parent || root;
}

/** Serialize only the short authoritative commit, never AI work or user input. */
export function withMvuWriteLock<T>(operation: () => Promise<T>, registry = owner()): Promise<T> {
  const previous: Promise<void> = registry[key] || Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  registry[key] = tail;
  void tail.then(() => { if (registry[key] === tail) delete registry[key]; });
  return result;
}

export async function commitMvuUpdate(input: {
  base: Record<string, any>;
  next: Record<string, any>;
  read(): Record<string, any>;
  write(value: Record<string, any>): unknown | Promise<unknown>;
  assertCurrent(): void;
}): Promise<Record<string, any>> {
  return withMvuWriteLock(async () => {
    input.assertCurrent();
    const latest = input.read();
    const runSeed = input.base.stat_data?.run?.seed;
    if (runSeed !== undefined && latest.stat_data?.run?.seed !== runSeed)
      throw new Error('当前冒险已变化，已取消旧冒险保存');
    const merged = mergeMessageVariableUpdate(input.base, input.next, latest);
    if (!merged.stat_data || typeof merged.stat_data !== 'object' || Array.isArray(merged.stat_data))
      throw new Error('拒绝保存根结构无效的 MVU 数据');
    const beforeRevision = Number(latest.stat_data?.run?.stateRevision);
    const nextRevision = Number(merged.stat_data.run?.stateRevision);
    if (Number.isFinite(beforeRevision) && Number.isFinite(nextRevision) && nextRevision < beforeRevision)
      throw new Error(`拒绝写入旧爬塔状态：${nextRevision} < ${beforeRevision}`);
    input.assertCurrent();
    await input.write(structuredClone(merged));
    input.assertCurrent();
    const written = input.read();
    // Verify our write set. Unrelated host metadata may change during a write.
    let verified = false;
    try { verified = messageVariableValuesEqual(mergeMessageVariableUpdate(input.base, input.next, written), written); }
    catch { /* A post-write conflict is not a promise that nothing was saved. */ }
    if (!verified) throw new Error('MVU 保存回读与本次修改不一致，保存结果未确认，已停止后续操作');
    return written;
  });
}
