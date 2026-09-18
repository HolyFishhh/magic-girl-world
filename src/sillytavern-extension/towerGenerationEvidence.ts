export const TOWER_GENERATION_EVIDENCE_METADATA_KEY = 'mwg.tower-generation-evidence/v1';
export const TOWER_GENERATION_EVIDENCE_SPEC = 'mwg.tower-generation-evidence/v1' as const;

export type TowerGenerationEvidenceStage = 'request' | 'response' | 'outcome' | 'failure';

export interface TowerGenerationEvidenceRecord {
  chatId: string;
  nodeId: string;
  requestId: string;
  runScope?: string;
  parentRequestId?: string;
  stage: TowerGenerationEvidenceStage;
  generationId?: string;
  prompt?: string;
  response?: string;
  parsedResult?: unknown;
  outcome?: unknown;
  error?: string;
  beforeMvuData?: unknown;
  afterMvuData?: unknown;
  recordedAt: number;
}

export interface TowerGenerationEvidenceHistory {
  spec: typeof TOWER_GENERATION_EVIDENCE_SPEC;
  chatId: string;
  retention: { maxRecords: number; retainedRecords: number; droppedRecords: number };
  records: TowerGenerationEvidenceRecord[];
}

const MAX_RECORDS = 128;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);

function normalizeRecord(value: unknown, chatId: string): TowerGenerationEvidenceRecord | null {
  if (!isRecord(value) || value.chatId !== chatId || typeof value.nodeId !== 'string' || typeof value.requestId !== 'string') return null;
  if (!['request', 'response', 'outcome', 'failure'].includes(String(value.stage))) return null;
  return clone({
    chatId,
    nodeId: value.nodeId,
    requestId: value.requestId,
    ...(typeof value.runScope === 'string' ? { runScope: value.runScope } : {}),
    ...(typeof value.parentRequestId === 'string' ? { parentRequestId: value.parentRequestId } : {}),
    stage: value.stage as TowerGenerationEvidenceStage,
    ...(typeof value.generationId === 'string' ? { generationId: value.generationId } : {}),
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof value.response === 'string' ? { response: value.response } : {}),
    ...('parsedResult' in value ? { parsedResult: clone(value.parsedResult) } : {}),
    ...('outcome' in value ? { outcome: clone(value.outcome) } : {}),
    ...(typeof value.error === 'string' ? { error: value.error.slice(0, 1000) } : {}),
    ...('beforeMvuData' in value ? { beforeMvuData: clone(value.beforeMvuData) } : {}),
    ...('afterMvuData' in value ? { afterMvuData: clone(value.afterMvuData) } : {}),
    recordedAt: Number(value.recordedAt) || 0,
  });
}

/** Metadata-backed tower request/response history; never creates chat messages. */
export class TowerGenerationEvidence {
  private chatId: string | null = null;
  private records: TowerGenerationEvidenceRecord[] = [];
  private droppedRecords = 0;

  retainChat(chatId: string | null, persisted?: unknown): void {
    if (chatId === this.chatId) return;
    this.chatId = chatId;
    this.records = [];
    this.droppedRecords = 0;
    if (chatId && isRecord(persisted) && persisted.spec === TOWER_GENERATION_EVIDENCE_SPEC && persisted.chatId === chatId && Array.isArray(persisted.records)) {
      this.records = persisted.records.map(record => normalizeRecord(record, chatId)).filter((record): record is TowerGenerationEvidenceRecord => record !== null);
      this.droppedRecords = Math.max(0, Number(isRecord(persisted.retention) ? persisted.retention.droppedRecords : 0) || 0);
      this.trimCompleteRequestGroups();
    }
  }

  append(record: Omit<TowerGenerationEvidenceRecord, 'recordedAt'> & { recordedAt?: number }): void {
    // A late completion from a previous chat must not contaminate the active
    // in-memory history. Persistence checks alone are too late for UI/export.
    if (!this.chatId || record.chatId !== this.chatId || record.nodeId.length === 0 || record.requestId.length === 0) return;
    this.records.push(clone({ ...record, recordedAt: record.recordedAt ?? Date.now() }));
    this.trimCompleteRequestGroups();
  }

  private trimCompleteRequestGroups(): void {
    if (this.records.length <= MAX_RECORDS) return;
    const groups = new Map<string, TowerGenerationEvidenceRecord[]>();
    for (const record of this.records) groups.set(record.requestId, [...(groups.get(record.requestId) || []), record]);
    const ordered = [...groups.values()];
    const kept: TowerGenerationEvidenceRecord[][] = [];
    let count = 0;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const group = ordered[index];
      // Keep the newest complete request group even if one oversized batch
      // exceeds the soft record cap; never split its original prompt/response.
      if (kept.length === 0 || count + group.length <= MAX_RECORDS) {
        kept.unshift(group);
        count += group.length;
      } else {
        this.droppedRecords += group.length;
      }
    }
    this.records = kept.flat();
  }

  snapshot(chatId: string | null): TowerGenerationEvidenceHistory | null {
    if (!chatId || chatId !== this.chatId) return null;
    return {
      spec: TOWER_GENERATION_EVIDENCE_SPEC,
      chatId,
      retention: { maxRecords: MAX_RECORDS, retainedRecords: this.records.length, droppedRecords: this.droppedRecords },
      records: this.records.map(clone),
    };
  }

  manualGenerationIds(chatId: string | null): Set<string> {
    return new Set(chatId === this.chatId ? this.records.filter(r => r.nodeId === 'manual-variable-repair').map(r => r.generationId || r.requestId) : []);
  }

  /** UI projection: do not clone whole MVU snapshots merely to open a list. */
  recent(chatId: string | null, limit: number) {
    if (!chatId || chatId !== this.chatId) return { total: 0, records: [] };
    return { total: this.records.length, records: this.records.slice(-limit).reverse().map((record, index) => ({
      key: `tower:${this.records.length - index - 1}:${record.requestId}:${record.stage}`,
      requestId: record.requestId, stage: record.stage, recordedAt: record.recordedAt,
      kind: record.nodeId === 'manual-variable-repair' ? '自然语言修改' : '爬塔生成',
      text: record.prompt ?? record.response ?? JSON.stringify({ outcome: record.outcome, error: record.error }, null, 2),
    })) };
  }
}
