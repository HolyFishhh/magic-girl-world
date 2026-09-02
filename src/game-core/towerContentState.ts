export const TOWER_CONTENT_SCHEMA_VERSION = 1 as const;

export const TOWER_CONTENT_PHASES = [
  'idle',
  'queued',
  'generating',
  'ready',
  'failed',
  'consumed',
  'abandoned',
] as const;

export type TowerContentPhase = (typeof TOWER_CONTENT_PHASES)[number];

export interface TowerNodeContentEnvelope<TContent = unknown, TReward = unknown> {
  schemaVersion: typeof TOWER_CONTENT_SCHEMA_VERSION;
  nodeId: string;
  kind: string;
  phase: TowerContentPhase;
  requestId: string | null;
  basedOnRevision: number;
  attempts: number;
  content?: TContent;
  reward?: TReward;
  error?: string;
}

export type TowerNodeContentStore<TContent = unknown, TReward = unknown> = Record<
  string,
  TowerNodeContentEnvelope<TContent, TReward>
>;

export interface TowerGenerationCommit<TContent = unknown, TReward = unknown> {
  nodeId: string;
  requestId: string;
  basedOnRevision: number;
  content: TContent;
  reward?: TReward;
}

export interface TowerContentMutation<TContent = unknown, TReward = unknown> {
  store: TowerNodeContentStore<TContent, TReward>;
  envelope: TowerNodeContentEnvelope<TContent, TReward>;
  changed: boolean;
}

function cloneStore<TContent, TReward>(
  store: TowerNodeContentStore<TContent, TReward>,
): TowerNodeContentStore<TContent, TReward> {
  return { ...store };
}

function requireEnvelope<TContent, TReward>(
  store: TowerNodeContentStore<TContent, TReward>,
  nodeId: string,
): TowerNodeContentEnvelope<TContent, TReward> {
  const envelope = store[nodeId];
  if (!envelope) throw new Error(`tower content node is unavailable: ${nodeId}`);
  return envelope;
}

function requireRevision(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error('tower state revision is invalid');
  return value;
}

function requestId(nodeId: string, basedOnRevision: number, attempt: number): string {
  let hash = 0x811c9dc5;
  const source = `${nodeId}:${basedOnRevision}:${attempt}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `tower_${basedOnRevision}_${attempt}_${(hash >>> 0).toString(36)}`;
}

export function createTowerNodeContent<TContent = unknown, TReward = unknown>(
  nodeId: string,
  kind: string,
): TowerNodeContentEnvelope<TContent, TReward> {
  if (!nodeId.trim() || nodeId.length > 128) throw new Error('tower content nodeId is invalid');
  if (!kind.trim() || kind.length > 32) throw new Error('tower content kind is invalid');
  return {
    schemaVersion: TOWER_CONTENT_SCHEMA_VERSION,
    nodeId,
    kind,
    phase: 'idle',
    requestId: null,
    basedOnRevision: 0,
    attempts: 0,
  };
}

export function createTowerContentStore<TContent = unknown, TReward = unknown>(
  nodes: ReadonlyArray<{ id: string; kind: string }>,
): TowerNodeContentStore<TContent, TReward> {
  const store: TowerNodeContentStore<TContent, TReward> = {};
  for (const node of nodes) {
    if (store[node.id]) throw new Error(`duplicate tower content node: ${node.id}`);
    store[node.id] = createTowerNodeContent<TContent, TReward>(node.id, node.kind);
  }
  return store;
}

export function queueTowerNodeContent<TContent = unknown, TReward = unknown>(
  store: TowerNodeContentStore<TContent, TReward>,
  nodeId: string,
  basedOnRevision: number,
): TowerContentMutation<TContent, TReward> {
  requireRevision(basedOnRevision);
  const previous = requireEnvelope(store, nodeId);
  if (previous.phase === 'ready' || previous.phase === 'consumed' || previous.phase === 'abandoned') {
    return { store, envelope: previous, changed: false };
  }
  if (
    (previous.phase === 'queued' || previous.phase === 'generating')
    && previous.basedOnRevision === basedOnRevision
  ) {
    return { store, envelope: previous, changed: false };
  }
  const attempts = previous.attempts + 1;
  const envelope: TowerNodeContentEnvelope<TContent, TReward> = {
    schemaVersion: TOWER_CONTENT_SCHEMA_VERSION,
    nodeId: previous.nodeId,
    kind: previous.kind,
    phase: 'queued',
    requestId: requestId(previous.nodeId, basedOnRevision, attempts),
    basedOnRevision,
    attempts,
  };
  const next = cloneStore(store);
  next[nodeId] = envelope;
  return { store: next, envelope, changed: true };
}

export function claimTowerGeneration<TContent = unknown, TReward = unknown>(
  store: TowerNodeContentStore<TContent, TReward>,
  nodeId: string,
  expectedRequestId?: string,
): TowerContentMutation<TContent, TReward> {
  const previous = requireEnvelope(store, nodeId);
  if (previous.phase !== 'queued' || !previous.requestId) throw new Error('tower content node is not queued');
  if (expectedRequestId && previous.requestId !== expectedRequestId) throw new Error('tower content request is stale');
  const envelope = { ...previous, phase: 'generating' as const };
  const next = cloneStore(store);
  next[nodeId] = envelope;
  return { store: next, envelope, changed: true };
}

export function commitTowerGeneration<TContent = unknown, TReward = unknown>(
  store: TowerNodeContentStore<TContent, TReward>,
  commit: TowerGenerationCommit<TContent, TReward>,
): TowerContentMutation<TContent, TReward> {
  const previous = requireEnvelope(store, commit.nodeId);
  if (
    previous.phase === 'ready'
    && previous.requestId === commit.requestId
    && previous.basedOnRevision === commit.basedOnRevision
  ) {
    return { store, envelope: previous, changed: false };
  }
  if (previous.phase !== 'generating') throw new Error('tower content node is not generating');
  if (previous.requestId !== commit.requestId || previous.basedOnRevision !== commit.basedOnRevision) {
    throw new Error('tower content generation result is stale');
  }
  const envelope: TowerNodeContentEnvelope<TContent, TReward> = {
    ...previous,
    phase: 'ready',
    content: structuredClone(commit.content),
    ...(commit.reward === undefined ? {} : { reward: structuredClone(commit.reward) }),
  };
  const next = cloneStore(store);
  next[commit.nodeId] = envelope;
  return { store: next, envelope, changed: true };
}

export function failTowerGeneration<TContent = unknown, TReward = unknown>(
  store: TowerNodeContentStore<TContent, TReward>,
  nodeId: string,
  request: { requestId: string; basedOnRevision: number; error?: string },
): TowerContentMutation<TContent, TReward> {
  const previous = requireEnvelope(store, nodeId);
  if (previous.phase !== 'generating') throw new Error('tower content node is not generating');
  if (previous.requestId !== request.requestId || previous.basedOnRevision !== request.basedOnRevision) {
    throw new Error('tower content generation failure is stale');
  }
  const envelope: TowerNodeContentEnvelope<TContent, TReward> = {
    ...previous,
    phase: 'failed',
    error: String(request.error || '生成失败').slice(0, 500),
  };
  const next = cloneStore(store);
  next[nodeId] = envelope;
  return { store: next, envelope, changed: true };
}

export function consumeTowerNodeContent<TContent = unknown, TReward = unknown>(
  store: TowerNodeContentStore<TContent, TReward>,
  nodeId: string,
): TowerContentMutation<TContent, TReward> {
  const previous = requireEnvelope(store, nodeId);
  if (previous.phase === 'consumed') return { store, envelope: previous, changed: false };
  if (previous.phase !== 'ready') throw new Error('tower content node is not ready');
  const envelope = { ...previous, phase: 'consumed' as const };
  const next = cloneStore(store);
  next[nodeId] = envelope;
  return { store: next, envelope, changed: true };
}

export function abandonTowerContent<TContent = unknown, TReward = unknown>(
  store: TowerNodeContentStore<TContent, TReward>,
  nodeIds: readonly string[],
): TowerNodeContentStore<TContent, TReward> {
  let next = store;
  for (const nodeId of nodeIds) {
    const previous = store[nodeId];
    if (!previous || previous.phase === 'consumed' || previous.phase === 'abandoned') continue;
    if (next === store) next = cloneStore(store);
    next[nodeId] = { ...previous, phase: 'abandoned', error: undefined };
  }
  return next;
}

/** Turn browser-interrupted jobs into retryable failures after a page reload. */
export function recoverInterruptedTowerContent<TContent = unknown, TReward = unknown>(
  store: TowerNodeContentStore<TContent, TReward>,
): TowerNodeContentStore<TContent, TReward> {
  let next = store;
  for (const [nodeId, previous] of Object.entries(store)) {
    if (previous.phase !== 'generating') continue;
    if (next === store) next = cloneStore(store);
    next[nodeId] = { ...previous, phase: 'failed', error: '页面刷新中断了后台生成，可安全重试' };
  }
  return next;
}

export function isTowerNodeContentReady(
  envelope: TowerNodeContentEnvelope,
  options: { rewardRequired?: boolean } = {},
): boolean {
  return envelope.phase === 'ready'
    && envelope.content !== undefined
    && (!options.rewardRequired || envelope.reward !== undefined);
}

/** Breadth-first node lookahead used by the queue; it never explores beyond maxDepth. */
export function collectReachableTowerNodeIds(
  adjacency: Readonly<Record<string, readonly string[]>>,
  startNodeIds: readonly string[],
  maxDepth = 3,
): string[] {
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 16) throw new Error('tower lookahead depth is invalid');
  const visited = new Set<string>();
  let frontier = [...new Set(startNodeIds.filter(Boolean))];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      if (depth === maxDepth) continue;
      for (const childId of adjacency[nodeId] || []) {
        if (!visited.has(childId)) next.push(childId);
      }
    }
    frontier = [...new Set(next)];
  }
  return [...visited];
}

export function validateTowerContentStore(value: unknown): value is TowerNodeContentStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [nodeId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const envelope = raw as Partial<TowerNodeContentEnvelope>;
    if (envelope.schemaVersion !== TOWER_CONTENT_SCHEMA_VERSION || envelope.nodeId !== nodeId) return false;
    if (typeof envelope.kind !== 'string' || !envelope.kind) return false;
    if (!TOWER_CONTENT_PHASES.includes(envelope.phase as TowerContentPhase)) return false;
    if (envelope.requestId !== null && typeof envelope.requestId !== 'string') return false;
    if (!Number.isInteger(envelope.basedOnRevision) || Number(envelope.basedOnRevision) < 0) return false;
    if (!Number.isInteger(envelope.attempts) || Number(envelope.attempts) < 0) return false;
    if ((envelope.phase === 'queued' || envelope.phase === 'generating') && !envelope.requestId) return false;
    if ((envelope.phase === 'ready' || envelope.phase === 'consumed') && envelope.content === undefined) return false;
  }
  return true;
}
