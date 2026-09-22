import { EvidenceFileStore, validEvidenceReference, type EvidenceFileReference } from './evidenceFileStore';
import { redactDiagnosticText } from '../runtime/diagnosticRedaction';

export const TOWER_GENERATION_EVIDENCE_METADATA_KEY = 'mwg.tower-generation-evidence/v1';
export const TOWER_GENERATION_EVIDENCE_SPEC = 'mwg.tower-generation-evidence/v1' as const;
const INDEX_SPEC = 'mwg.tower-evidence-index/v1';
const PAGE_SPEC = 'mwg.tower-evidence-page/v1';
const INDEX_RECORDS = 64, INDEX_BYTES = 64 * 1024, EXPORT_BYTES = 64 * 1024 * 1024;
export type TowerGenerationEvidenceStage = 'request' | 'response' | 'outcome' | 'failure';
export interface TowerGenerationEvidenceRecord {
  chatId: string; nodeId: string; requestId: string; runScope?: string; parentRequestId?: string;
  stage: TowerGenerationEvidenceStage; generationId?: string;
  prompt?: string; response?: string; parsedResult?: unknown; outcome?: unknown; error?: string;
  beforeMvuData?: unknown; afterMvuData?: unknown; recordedAt: number;
}
export interface TowerGenerationEvidenceHistory {
  spec: typeof TOWER_GENERATION_EVIDENCE_SPEC; chatId: string;
  retention: { retainedRecords: number; droppedRecords: number };
  records: TowerGenerationEvidenceRecord[];
}
interface Entry {
  sequence: number; nodeId: string; requestId: string; stage: TowerGenerationEvidenceStage;
  generationId?: string; recordedAt: number; characters: number; bytes: number;
  file?: EvidenceFileReference; inline?: TowerGenerationEvidenceRecord;
}
interface Index {
  spec: typeof INDEX_SPEC; chatId: string; total: number; totalBytes: number; droppedRecords: number;
  entries: Entry[]; older?: EvidenceFileReference; revision: number; error?: string;
}
interface Session { index: Index; invalid?: unknown; failure?: string; running?: Promise<void>; retryAfter: number }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const stages = ['request', 'response', 'outcome', 'failure'];
const recordText = (record: TowerGenerationEvidenceRecord): string => record.prompt ?? record.response ?? JSON.stringify({ outcome: record.outcome, error: record.error }, null, 2);
const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
const validRecord = (value: unknown, chatId: string): value is TowerGenerationEvidenceRecord => object(value)
  && value.chatId === chatId && typeof value.nodeId === 'string' && typeof value.requestId === 'string'
  && stages.includes(value.stage) && Number.isFinite(value.recordedAt)
  && ['prompt', 'response', 'error', 'generationId'].every(key => value[key] === undefined || typeof value[key] === 'string');
const validEntry = (entry: unknown, chatId: string): entry is Entry => object(entry)
  && Number.isSafeInteger(entry.sequence) && entry.sequence > 0 && typeof entry.requestId === 'string'
  && typeof entry.nodeId === 'string' && stages.includes(entry.stage) && Number.isFinite(entry.recordedAt)
  && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && Number.isSafeInteger(entry.characters) && entry.characters >= 0
  && (entry.file ? validEvidenceReference(entry.file) && entry.inline === undefined : validRecord(entry.inline, chatId));

/** Small metadata index; immutable files own originals and older index pages.
 * An inline record is removed only after its file passes a read-back hash check.
 */
export class TowerGenerationEvidence {
  private session: Session | null = null;
  constructor(private readonly files?: EvidenceFileStore) {}
  retainChat(chatId: string | null, persisted?: unknown): void {
    if (chatId === this.session?.index.chatId) return;
    this.files?.clearCache();
    this.session = chatId ? { index: { spec: INDEX_SPEC, chatId, total: 0, totalBytes: 0, droppedRecords: 0, entries: [], revision: 0 }, retryAfter: 0 } : null;
    const session = this.session;
    if (!session || persisted == null) return;
    try {
      if (!object(persisted) || persisted.chatId !== chatId) throw Error('生成记录索引不属于当前聊天');
      if (persisted.spec === INDEX_SPEC && Array.isArray(persisted.entries)
        && persisted.entries.every((entry: unknown) => validEntry(entry, chatId!))
        && Number.isSafeInteger(persisted.total) && persisted.total >= persisted.entries.length
        && Number.isSafeInteger(persisted.totalBytes) && persisted.totalBytes >= 0
        && Number.isSafeInteger(persisted.revision) && persisted.revision >= 0
        && Number.isSafeInteger(persisted.droppedRecords) && persisted.droppedRecords >= 0
        && (!persisted.older || validEvidenceReference(persisted.older))
        && persisted.entries.every((entry: Entry, index: number) => entry.sequence === persisted.total - persisted.entries.length + index + 1)
        && (persisted.older || persisted.total === persisted.entries.length)
        && (persisted.error === undefined || typeof persisted.error === 'string')) {
        session.index = clone(persisted) as Index;
      } else if (persisted.spec === TOWER_GENERATION_EVIDENCE_SPEC && Array.isArray(persisted.records)
        && persisted.records.every((record: unknown) => validRecord(record, chatId!))) {
        // Rehome the currently installed inline format without changing it on read.
        for (const record of persisted.records) this.append(record);
        session.index.droppedRecords = Math.max(0, Number(persisted.retention?.droppedRecords) || 0);
      } else throw Error('生成记录索引损坏或版本不受支持，已保留原数据');
    } catch (error) {
      session.invalid = clone(persisted);
      session.failure = redactDiagnosticText(error instanceof Error ? error.message : error);
    }
  }
  append(record: Omit<TowerGenerationEvidenceRecord, 'recordedAt'> & { recordedAt?: number }): void {
    const session = this.session;
    if (!session || session.invalid !== undefined || record.chatId !== session.index.chatId || !record.nodeId || !record.requestId) return;
    const retained = clone({ ...record, recordedAt: record.recordedAt ?? Date.now() });
    const index = session.index, bytes = jsonBytes(retained);
    index.entries.push({ sequence: ++index.total, nodeId: record.nodeId, requestId: record.requestId,
      stage: record.stage, ...(record.generationId ? { generationId: record.generationId } : {}),
      recordedAt: retained.recordedAt, characters: recordText(retained).length, bytes, inline: retained });
    index.totalBytes += bytes; index.revision++;
  }
  metadataSnapshot(chatId: string): unknown {
    const session = this.current(chatId);
    return session ? clone(session.invalid !== undefined ? session.invalid : session.index) : null;
  }
  private current(chatId: string | null): Session | null { return chatId && this.session?.index.chatId === chatId ? this.session : null; }
  private assertSession(session: Session): void {
    if (this.session !== session) throw Error('聊天已切换，已取消旧聊天生成记录操作');
    if (session.invalid !== undefined) throw Error(session.failure || '生成记录索引不可用');
  }
  status(chatId: string | null) {
    const session = this.current(chatId), index = session?.index;
    return { total: index?.total || 0, revision: index?.revision || 0, totalBytes: index?.totalBytes || 0,
      pending: index?.entries.filter(entry => entry.inline).length || 0,
      error: session?.failure || index?.error || '', archived: !!index?.older };
  }
  async archive(chatId: string, changed: () => void, force = false): Promise<void> {
    const session = this.current(chatId);
    if (!session || !this.files || session.invalid !== undefined) return;
    if (session.running) return session.running;
    if (!force && Date.now() < session.retryAfter) return;
    const files = this.files, assertCurrent = () => this.assertSession(session);
    session.running = (async () => {
      try {
        assertCurrent();
        let entry: Entry | undefined;
        while ((entry = session.index.entries.find(value => value.inline))) {
          const file = await files.write(chatId, entry.inline, assertCurrent);
          assertCurrent(); entry.file = file; delete entry.inline;
          delete session.index.error; session.failure = undefined; session.index.revision++;
          changed(); await this.compact(session, changed);
        }
        await this.compact(session, changed);
        if (session.index.error) { delete session.index.error; session.index.revision++; changed(); }
        session.retryAfter = 0;
      } catch (error) {
        if (this.session === session) {
          session.index.error = redactDiagnosticText(error instanceof Error ? error.message : error).slice(0, 500);
          session.index.revision++; session.retryAfter = Date.now() + 30000; changed();
        }
      }
    })().finally(() => { session.running = undefined; });
    return session.running;
  }
  private async compact(session: Session, changed: () => void): Promise<void> {
    const index = session.index;
    while (index.entries.length > INDEX_RECORDS || jsonBytes(index.entries.map(({ inline: _inline, ...entry }) => entry)) > INDEX_BYTES) {
      this.assertSession(session);
      // Pagination changes physical storage, never logical retention or export.
      const pending = index.entries.findIndex(entry => !entry.file);
      const count = Math.min(INDEX_RECORDS, pending < 0 ? index.entries.length - 1 : pending);
      if (count <= 0) return;
      const older = await this.files!.write(index.chatId, { spec: PAGE_SPEC, entries: index.entries.slice(0, count), ...(index.older ? { older: index.older } : {}) }, () => this.assertSession(session));
      this.assertSession(session);
      index.entries.splice(0, count); index.older = older; index.revision++; changed();
    }
  }
  private async entries(session: Session, limit = Infinity): Promise<Entry[]> {
    this.assertSession(session);
    const total = session.index.total;
    let entries = [...session.index.entries], older = session.index.older;
    const seen = new Set<string>();
    while (entries.length < limit && older) {
      if (!this.files) throw Error('生成记录文件服务不可用');
      if (seen.has(older.sha256)) throw Error('生成记录索引循环，已停止读取');
      seen.add(older.sha256);
      const page = await this.files.read(session.index.chatId, older, () => this.assertSession(session));
      if (!object(page) || page.spec !== PAGE_SPEC || !Array.isArray(page.entries)
        || page.entries.length === 0 || page.entries.length > INDEX_RECORDS
        || !page.entries.every((entry: unknown) => validEntry(entry, session.index.chatId) && !!entry.file)
        || (page.older && !validEvidenceReference(page.older))) throw Error('生成记录归档索引损坏');
      entries = [...page.entries, ...entries]; older = page.older;
    }
    this.assertSession(session);
    for (let index = 0; index < entries.length; index++) if (entries[index].sequence !== total - entries.length + index + 1) throw Error('生成记录顺序或数量无效');
    if (!older && entries.length !== total) throw Error('生成记录归档缺失，无法完整导出');
    return Number.isFinite(limit) ? entries.slice(-limit) : entries;
  }
  private async readEntry(session: Session, entry: Entry): Promise<TowerGenerationEvidenceRecord> {
    this.assertSession(session);
    const record = entry.inline ? clone(entry.inline) : await this.files?.read(session.index.chatId, entry.file!, () => this.assertSession(session));
    if (!validRecord(record, session.index.chatId) || record.requestId !== entry.requestId || record.nodeId !== entry.nodeId || record.stage !== entry.stage || record.recordedAt !== entry.recordedAt) throw Error('生成记录文件与索引不匹配');
    if (jsonBytes(record) !== entry.bytes || recordText(record).length !== entry.characters) throw Error('生成记录长度与索引不符');
    return record;
  }
  async snapshot(chatId: string | null): Promise<TowerGenerationEvidenceHistory | null> {
    const session = this.current(chatId); if (!session) return null;
    const totalBytes = session.index.totalBytes;
    if (totalBytes > EXPORT_BYTES) throw Error('完整记录超过64MiB，请在列表中逐条下载；原文仍完整保留');
    const entries = await this.entries(session), records: TowerGenerationEvidenceRecord[] = [];
    const indexedBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (!Number.isSafeInteger(indexedBytes) || indexedBytes !== totalBytes) throw Error('生成记录总长度与索引不符，已停止导出');
    for (const entry of entries) records.push(await this.readEntry(session, entry));
    return { spec: TOWER_GENERATION_EVIDENCE_SPEC, chatId: session.index.chatId,
      retention: { retainedRecords: records.length, droppedRecords: session.index.droppedRecords }, records };
  }
  async loadRecord(chatId: string, key: string): Promise<TowerGenerationEvidenceRecord> {
    const session = this.current(chatId); if (!session) throw Error('聊天已切换');
    if (!/^tower:[1-9]\d*$/.test(key)) throw Error('生成记录标识无效');
    const sequence = Number(key.slice(6));
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > session.index.total) throw Error('生成记录标识无效');
    const entries = await this.entries(session, session.index.total - sequence + 1);
    const entry = entries.find(value => value.sequence === sequence);
    if (!entry) throw Error('生成记录索引缺失');
    return this.readEntry(session, entry);
  }
  async recent(chatId: string | null, limit: number) {
    const session = this.current(chatId); if (!session) return { total: 0, records: [] };
    const entries = await this.entries(session, Math.max(1, Math.trunc(limit) || 5));
    return { total: session.index.total, records: entries.reverse().map(entry => ({
      key: `tower:${entry.sequence}`, requestId: entry.requestId, generationId: entry.generationId,
      stage: entry.stage, recordedAt: entry.recordedAt, characters: entry.characters,
      kind: entry.nodeId === 'manual-variable-repair' ? '自然语言修改' : '爬塔生成',
    })) };
  }
}
