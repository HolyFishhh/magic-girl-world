/** Durable final-output-only evidence. No prompts, headers, keys or reasoning. */
export const INITIAL_GENERATION_EVIDENCE_METADATA_KEY = 'mwg.initial-generation-evidence/v2';
export const INITIAL_GENERATION_EVIDENCE_SPEC = 'mwg.initial-generation-evidence/v2' as const;
export type InitialEvidenceStage = 'provider-final' | 'repair-final' | 'repair-slot-plan' | 'merged-draft' | 'normalized-draft' | 'compiled-result' | 'semantic-observation' | 'validation-errors';
export interface InitialEvidenceRecord { stage: InitialEvidenceStage; text: string; characters: number; truncated: false; capturedAt: number; }
export interface InitialEvidenceValidationError { code: string; path: string; message: string; }
export interface InitialEvidenceRun { generationId: string; startedAt: number; updatedAt: number; outcome: 'recording' | 'completed' | 'failed'; records: InitialEvidenceRecord[]; validationErrors: InitialEvidenceValidationError[]; archive?: { status: 'pending' | 'saved' | 'failed'; path?: string; error?: string }; }
export interface InitialEvidenceHistory {
  spec: typeof INITIAL_GENERATION_EVIDENCE_SPEC; chatId: string;
  retention: { maxRuns: number; retainedRuns: number; droppedRuns: number; policy: 'whole-run' };
  runs: InitialEvidenceRun[];
}
const MAX_RUNS = 8;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const copyRun = (run: InitialEvidenceRun): InitialEvidenceRun => ({ ...run, ...(run.archive ? { archive: { ...run.archive } } : {}), records: run.records.map(record => ({ ...record })), validationErrors: run.validationErrors.map(error => ({ ...error })) });

/**
 * Eviction happens only at a completed-run boundary. A retained record is
 * never sliced and labelled as complete; metadata/file writers own persistence.
 */
export class InitialGenerationEvidence {
  private chatId: string | null = null;
  private runs: InitialEvidenceRun[] = [];
  private droppedRuns = 0;
  constructor(private readonly now: () => number = () => Date.now()) {}

  retainChat(chatId: string | null, persisted?: unknown): void {
    if (chatId === this.chatId) return;
    this.chatId = chatId; this.runs = []; this.droppedRuns = 0;
    if (chatId) this.restore(chatId, persisted);
  }

  capture(chatId: string, generationId: string, stage: InitialEvidenceStage, value: string): void {
    const run = this.run(chatId, generationId); if (!run) return;
    run.records.push({ stage, text: value, characters: value.length, truncated: false, capturedAt: this.now() });
    run.updatedAt = this.now(); this.enforceCapacity();
  }

  captureValidationErrors(chatId: string, generationId: string, errors: readonly InitialEvidenceValidationError[]): void {
    const run = this.run(chatId, generationId); if (!run) return;
    // Keep every validation observation for this run (including errors later
    // repaired), while avoiding duplicate emissions from repeated checks.
    for (const error of errors) {
      const next = { code: String(error.code || ''), path: String(error.path || ''), message: String(error.message || '') };
      if (!run.validationErrors.some(previous => previous.code === next.code && previous.path === next.path && previous.message === next.message)) run.validationErrors.push(next);
    }
    run.records.push({ stage: 'validation-errors', text: JSON.stringify(errors), characters: JSON.stringify(errors).length, truncated: false, capturedAt: this.now() });
    run.updatedAt = this.now(); this.enforceCapacity();
  }

  setArchive(chatId: string, generationId: string, archive: InitialEvidenceRun['archive']): void {
    const run = this.run(chatId, generationId); if (!run) return;
    run.archive = archive; run.updatedAt = this.now();
  }
  finish(chatId: string, generationId: string, outcome: 'completed' | 'failed'): void {
    const run = this.run(chatId, generationId); if (!run) return;
    run.outcome = outcome; run.updatedAt = this.now();
  }

  recent(chatId: string | null, limit: number, excludedGenerations: ReadonlySet<string>) {
    const records = chatId === this.chatId ? this.runs.filter(run => !excludedGenerations.has(run.generationId)).flatMap(run => run.records.map((record, index) => ({
      key: `initial:${run.generationId}:${index}`, requestId: run.generationId, stage: record.stage,
      recordedAt: record.capturedAt, kind: run.generationId.startsWith('mwg-stat-data-repair-') ? '自然语言修改' : '开局生成', text: record.text,
    }))) : [];
    return { total: records.length, records: records.sort((a,b) => b.recordedAt - a.recordedAt).slice(0,limit) };
  }

  snapshot(chatId: string | null): InitialEvidenceHistory | null {
    if (!chatId || chatId !== this.chatId) return null;
    return { spec: INITIAL_GENERATION_EVIDENCE_SPEC, chatId,
      retention: { maxRuns: MAX_RUNS, retainedRuns: this.runs.length, droppedRuns: this.droppedRuns, policy: 'whole-run' }, runs: this.runs.map(copyRun) };
  }

  private run(chatId: string, generationId: string): InitialEvidenceRun | null {
    if (chatId !== this.chatId || !generationId) return null;
    let run = this.runs.find(entry => entry.generationId === generationId);
    if (!run) { const now = this.now(); run = { generationId, startedAt: now, updatedAt: now, outcome: 'recording', records: [], validationErrors: [], archive: { status: 'pending' } }; this.runs.push(run); }
    return run;
  }
  private enforceCapacity(): void { while (this.runs.length > MAX_RUNS) { this.runs.shift(); this.droppedRuns += 1; } }
  private restore(chatId: string, persisted: unknown): void {
    if (!isRecord(persisted) || persisted.spec !== INITIAL_GENERATION_EVIDENCE_SPEC || persisted.chatId !== chatId || !Array.isArray(persisted.runs)) return;
    this.runs = persisted.runs.flatMap(candidate => {
      if (!isRecord(candidate) || typeof candidate.generationId !== 'string' || !Array.isArray(candidate.records)) return [];
      const records = candidate.records.flatMap(record => isRecord(record) && typeof record.stage === 'string' && typeof record.text === 'string' ? [{ stage: record.stage as InitialEvidenceStage, text: record.text, characters: record.text.length, truncated: false as const, capturedAt: Number(record.capturedAt) || 0 }] : []);
      const validationErrors = Array.isArray(candidate.validationErrors) ? candidate.validationErrors.flatMap(error => isRecord(error) ? [{ code: String(error.code || ''), path: String(error.path || ''), message: String(error.message || '') }] : []) : [];
      const archive = isRecord(candidate.archive) && (candidate.archive.status === 'pending' || candidate.archive.status === 'saved' || candidate.archive.status === 'failed')
        ? { status: candidate.archive.status, ...(typeof candidate.archive.path === 'string' ? { path: candidate.archive.path } : {}), ...(typeof candidate.archive.error === 'string' ? { error: candidate.archive.error } : {}) } as InitialEvidenceRun['archive'] : undefined;
      const outcome = candidate.outcome === 'completed' || candidate.outcome === 'failed' ? candidate.outcome : 'recording';
      return [{ generationId: candidate.generationId, startedAt: Number(candidate.startedAt) || 0, updatedAt: Number(candidate.updatedAt) || 0, outcome, records, validationErrors, archive }];
    });
    this.droppedRuns = Math.max(0, Number(isRecord(persisted.retention) ? persisted.retention.droppedRuns : 0) || 0); this.enforceCapacity();
  }
}
