import { validateRunState } from '../game-core/runState';
import { sha256 } from '../shared/sha256';

/** Program-owned recovery data, committed alongside MVU, never authored by AI. */
export const TOWER_INITIAL_COMMIT_KEY = 'mwg_tower_initial_commit';
export const TOWER_INITIAL_PUBLICATION_KEY = 'mwg_tower_initial_publication';
export interface TowerInitialCommitReceipt {
  spec: 'mwg.tower-initial-commit/v1';
  chatId: string;
  messageId: number;
  generationId: string;
  narrative: string;
  openingRequestId: string;
  runSeed: number;
  revision: number;
  cardQuantity: number;
  stateDigest: string;
}

/** Saved in chat metadata, in the SAME save as the story and variable root.
 * It is not AI-authored MVU state and is not a second inventory transaction. */
export interface TowerInitialPublication {
  spec: 'mwg.tower-initial-publication/v1';
  chatId: string;
  messageId: number;
  swipeId: number;
  generationId: string;
  stateDigest: string;
}

export function initialPublicationFor(receipt: TowerInitialCommitReceipt, swipeId: number): TowerInitialPublication {
  return { spec: 'mwg.tower-initial-publication/v1', chatId: receipt.chatId, messageId: receipt.messageId,
    swipeId, generationId: receipt.generationId, stateDigest: receipt.stateDigest };
}

export function hasInitialPublication(metadata: unknown, receipt: TowerInitialCommitReceipt, swipeId: number): boolean {
  const value = metadata && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>)[TOWER_INITIAL_PUBLICATION_KEY] : undefined;
  return towerInitialStateKey(value) === towerInitialStateKey(initialPublicationFor(receipt, swipeId));
}

/** Exact JSON comparison, without a lossy hash or object-key ordering dependency. */
export function towerInitialStateKey(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
}

export async function towerInitialStateDigest(stat: unknown): Promise<string> {
  return sha256(towerInitialStateKey(stat));
}

export function readTowerInitialCommitReceipt(
  root: Record<string, any>, chatId: string, messageId: number,
): TowerInitialCommitReceipt | null {
  if (!Object.hasOwn(root, TOWER_INITIAL_COMMIT_KEY)) return null;
  const receipt = root[TOWER_INITIAL_COMMIT_KEY] as TowerInitialCommitReceipt | null;
  const run = root.stat_data?.run;
  // Keep diagnostics non-sensitive: never embed chat names, narrative, or state.
  // The marker also distinguishes a freshly loaded extension from an older tab.
  const fail = (reason: string): never => {
    throw new Error(`开局提交凭据损坏或与当前存档不一致，已停止重新生成以保护现有进度（act-receipt-v2：${reason}）`);
  };
  if (!receipt || receipt.spec !== 'mwg.tower-initial-commit/v1') return fail('凭据格式');
  if (receipt.chatId !== chatId) fail('聊天绑定');
  if (receipt.messageId !== messageId) fail('楼层绑定');
  if (typeof receipt.generationId !== 'string' || !receipt.generationId
    || typeof receipt.narrative !== 'string' || !receipt.narrative.trim()
    || typeof receipt.openingRequestId !== 'string' || !receipt.openingRequestId
    || !Number.isInteger(receipt.runSeed) || !Number.isInteger(receipt.revision) || receipt.revision < 0
    || !Number.isInteger(receipt.cardQuantity) || receipt.cardQuantity < 1
    || typeof receipt.stateDigest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.stateDigest)) fail('凭据字段');
  if (!run || run.seed !== receipt.runSeed) fail('旅程绑定');
  if (!Number.isInteger(run.stateRevision) || run.stateRevision < receipt.revision) fail('进度版本');
  // The receipt identifies the initial transaction, not each act's opening.
  // A boss settlement resets opening.requestId; the next act queues a new ID.
  // Only a valid, strictly advanced later act may leave the original ID behind.
  if (run.opening?.requestId !== receipt.openingRequestId
    && !(Number.isInteger(run.act) && run.act > 1 && run.stateRevision > receipt.revision
      && validateRunState(run).ok)) fail('幕间开局绑定');
  return structuredClone(receipt);
}

export function canRestoreInitialPresentation(root: Record<string, any>, receipt: TowerInitialCommitReceipt): boolean {
  const run = root.stat_data?.run;
  return run?.stateRevision === receipt.revision && run.floor === 0 && run.act === 1
    && run.currentNode === null && run.opening?.phase === 'ready';
}

/** Older successful saves have no receipt: never treat them as an empty greeting. */
export function hasEstablishedTowerOpening(root: Record<string, any>): boolean {
  const run = root.stat_data?.run;
  return Boolean(run && (run.floor > 0 || run.act > 1 || run.currentNode
    || ['ready', 'consumed', 'skipped'].includes(run.opening?.phase)));
}

