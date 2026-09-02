import type { TowerGenerationArchiveRecord } from './towerGenerationHost';

export const TOWER_ARCHIVE_STORE_SPEC = 'mwg.tower-archive-store/v1' as const;

export interface TowerArchiveStore {
  spec: typeof TOWER_ARCHIVE_STORE_SPEC;
  chatId: string;
  records: TowerGenerationArchiveRecord[];
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedRecord(value: unknown, chatId: string): TowerGenerationArchiveRecord | null {
  if (!isRecord(value) || value.spec !== 'mwg.tower-archive-record/v1' || value.chatId !== chatId) return null;
  const required = ['nodeId', 'requestId', 'prompt', 'response', 'generationId'] as const;
  if (required.some(key => typeof value[key] !== 'string' || !value[key].trim())) return null;
  return {
    spec: 'mwg.tower-archive-record/v1',
    chatId,
    nodeId: value.nodeId,
    requestId: value.requestId,
    prompt: value.prompt,
    response: value.response,
    generationId: value.generationId,
    ...(isRecord(value.userExtra) ? { userExtra: structuredClone(value.userExtra) } : {}),
    ...(isRecord(value.assistantExtra) ? { assistantExtra: structuredClone(value.assistantExtra) } : {}),
  };
}

/** Read only the active chat's bounded, serializable archive queue. */
export function readTowerArchiveStore(value: unknown, chatId: string): TowerGenerationArchiveRecord[] {
  if (!isRecord(value) || value.spec !== TOWER_ARCHIVE_STORE_SPEC || value.chatId !== chatId) return [];
  if (!Array.isArray(value.records)) return [];
  const deduplicated = new Map<string, TowerGenerationArchiveRecord>();
  for (const candidate of value.records.slice(-256)) {
    const record = normalizedRecord(candidate, chatId);
    if (!record) continue;
    deduplicated.set(`${record.chatId}\u0000${record.nodeId}\u0000${record.requestId}`, record);
  }
  return [...deduplicated.values()];
}

/** Create a metadata-safe snapshot without promises, abort signals, or MVU copies. */
export function createTowerArchiveStore(
  chatId: string,
  records: readonly TowerGenerationArchiveRecord[],
): TowerArchiveStore {
  const normalized = readTowerArchiveStore({
    spec: TOWER_ARCHIVE_STORE_SPEC,
    chatId,
    records: structuredClone(records),
  }, chatId);
  return { spec: TOWER_ARCHIVE_STORE_SPEC, chatId, records: normalized };
}
