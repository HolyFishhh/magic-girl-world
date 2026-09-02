import {
  abandonTowerContent,
  claimTowerGeneration,
  commitTowerGeneration,
  failTowerGeneration,
  queueTowerNodeContent,
  recoverInterruptedTowerContent,
  type TowerGenerationCommit,
  type TowerNodeContentEnvelope,
  type TowerNodeContentStore,
} from '../game-core/towerContentState';
import { readGameMode } from '../game-core/towerMode';
import { enterRunNode, validateRunState, type RunNodeKind, type RunState } from '../game-core/runState';
import type { RunMapNode } from '../game-core/runMap';

export interface TowerLookaheadNode {
  nodeId: string;
  kind: RunNodeKind;
  act: number;
  floor: number;
  depth: 1 | 2 | 3;
  contentSeed: number;
  rewardSeed: number;
  difficultyMultiplier: number;
}

export interface TowerGenerationRequest {
  nodeId: string;
  requestId: string;
  revision: number;
  kind: RunNodeKind;
  act: number;
  floor: number;
  contentSeed: number;
  rewardSeed: number;
  difficultyMultiplier: number;
}

export interface TowerRunMutationResult {
  previous: RunState;
  run: RunState;
  changed: boolean;
}

export interface TowerQueueResult extends TowerRunMutationResult {
  lookahead: TowerLookaheadNode[];
  queued: TowerGenerationRequest[];
  abandonedNodeIds: string[];
  expiredNodeIds: string[];
}

export interface TowerClaimResult extends TowerRunMutationResult {
  request: TowerGenerationRequest;
}

export interface TowerRetryResult extends TowerRunMutationResult {
  request: TowerGenerationRequest;
}

export interface TowerBatchClaimResult extends TowerRunMutationResult {
  requests: TowerGenerationRequest[];
}

export interface TowerRouteReconciliationResult extends TowerRunMutationResult {
  abandonedNodeIds: string[];
}

export interface TowerGenerationResponse<TContent = unknown, TReward = unknown> {
  nodeId: string;
  requestId: string;
  revision: number;
  content: TContent;
  reward?: TReward;
}

export interface TowerGenerationFailure {
  nodeId: string;
  requestId: string;
  revision: number;
  error?: string;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function requireStat(value: unknown): Record<string, any> {
  const stat = asRecord(value);
  if (!stat) throw new Error('stat_data is unavailable');
  return stat;
}

/**
 * Strict tower-only reader. It deliberately rejects story mode and migrated
 * legacy-window runs because speculative generation requires a persistent DAG.
 */
export function readTowerRunState(statValue: unknown): RunState {
  const stat = requireStat(statValue);
  if (readGameMode(stat) !== 'tower') throw new Error('tower generation is unavailable in story mode');
  const parsed = validateRunState(stat.run);
  if (!parsed.ok) throw new Error(`tower run state is unavailable: ${parsed.message}`);
  if (parsed.value.routeMode !== 'map' || !parsed.value.map) {
    throw new Error('tower generation requires a schema v3 map run; legacy-window runs are unsupported');
  }
  return parsed.value;
}

/** Build a complete adjacency view without exposing or mutating the saved map. */
export function buildTowerAdjacency(run: RunState): Readonly<Record<string, readonly string[]>> {
  if (run.routeMode !== 'map' || !run.map) throw new Error('tower map is unavailable');
  const adjacency: Record<string, string[]> = Object.fromEntries(run.map.nodes.map(node => [node.id, []]));
  for (const edge of run.map.edges) {
    const children = adjacency[edge.from];
    if (!children || !adjacency[edge.to]) throw new Error('tower map adjacency is invalid');
    if (!children.includes(edge.to)) children.push(edge.to);
  }
  return adjacency;
}

function currentActNodes(run: RunState): RunMapNode[] {
  return run.map!.nodes.filter(node => node.act === run.act);
}

function lookaheadRoots(run: RunState, adjacency: Readonly<Record<string, readonly string[]>>): string[] {
  if (run.phase === 'won' || run.phase === 'lost') return [];
  if (run.phase === 'in_node' && run.currentNode) return [...(adjacency[run.currentNode.id] || [])];
  return run.choices.map(choice => choice.id);
}

function routeRoots(run: RunState): string[] {
  if (run.phase === 'won' || run.phase === 'lost') return [];
  if (run.phase === 'in_node' && run.currentNode) return [run.currentNode.id];
  return run.choices.map(choice => choice.id);
}

function collectFromRoots(
  adjacency: Readonly<Record<string, readonly string[]>>,
  roots: readonly string[],
): Set<string> {
  const reachable = new Set<string>();
  const queue = [...new Set(roots)];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const childId of adjacency[nodeId] || []) {
      if (!reachable.has(childId)) queue.push(childId);
    }
  }
  return reachable;
}

function currentRouteReachableIds(run: RunState, adjacency = buildTowerAdjacency(run)): Set<string> {
  return collectFromRoots(adjacency, routeRoots(run));
}

/** Return at most one to three nearest nodes within the next one to three floors. */
export function collectTowerLookahead(
  run: RunState,
  maxDepth: 1 | 2 | 3 = 3,
  maxNodes: 1 | 2 | 3 = 3,
): TowerLookaheadNode[] {
  if (run.routeMode !== 'map' || !run.map) throw new Error('tower map is unavailable');
  if (![1, 2, 3].includes(maxDepth)) throw new Error('tower lookahead must be between one and three floors');
  if (![1, 2, 3].includes(maxNodes)) throw new Error('tower lookahead must contain between one and three nodes');
  const adjacency = buildTowerAdjacency(run);
  const nodes = new Map(run.map.nodes.map(node => [node.id, node]));
  const act = run.map.acts.find(entry => entry.act === run.act);
  if (!act) throw new Error(`tower map act is unavailable: ${run.act}`);

  const result: TowerLookaheadNode[] = [];
  const visited = new Set<string>();
  let frontier = [...new Set(lookaheadRoots(run, adjacency))];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      if (result.length >= maxNodes) break;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = nodes.get(nodeId);
      if (!node || node.act !== run.act) continue;
      result.push({
        nodeId: node.id,
        kind: node.kind,
        act: node.act,
        floor: node.floor,
        depth: depth as 1 | 2 | 3,
        contentSeed: node.contentSeed,
        rewardSeed: node.rewardSeed,
        difficultyMultiplier: act.difficultyMultiplier,
      });
      if (depth < maxDepth) {
        for (const childId of adjacency[nodeId] || []) {
          if (!visited.has(childId)) next.push(childId);
        }
      }
    }
    if (result.length >= maxNodes) break;
    frontier = [...new Set(next)];
  }
  return result;
}

function requestFromEnvelope(run: RunState, envelope: TowerNodeContentEnvelope): TowerGenerationRequest {
  if (!envelope.requestId) throw new Error('tower content request id is unavailable');
  const node = run.map!.nodes.find(entry => entry.id === envelope.nodeId);
  if (!node) throw new Error(`tower map node is unavailable: ${envelope.nodeId}`);
  const act = run.map!.acts.find(entry => entry.act === node.act);
  if (!act) throw new Error(`tower map act is unavailable: ${node.act}`);
  return {
    nodeId: node.id,
    requestId: envelope.requestId,
    revision: envelope.basedOnRevision,
    kind: node.kind,
    act: node.act,
    floor: node.floor,
    contentSeed: node.contentSeed,
    rewardSeed: node.rewardSeed,
    difficultyMultiplier: act.difficultyMultiplier,
  };
}

function validateReplacement(previous: RunState, nodeContent: TowerNodeContentStore): RunState {
  if (nodeContent === previous.nodeContent) return previous;
  const candidate: RunState = { ...previous, nodeContent };
  const parsed = validateRunState(candidate);
  if (!parsed.ok) throw new Error(`tower run replacement is invalid: ${parsed.message}`);
  return parsed.value;
}

function replaceRun(
  stat: Record<string, any>,
  previous: RunState,
  nodeContent: TowerNodeContentStore,
): TowerRunMutationResult {
  const run = validateReplacement(previous, nodeContent);
  const changed = run !== previous;
  if (changed) stat.run = run;
  return { previous, run, changed };
}

function replaceCandidateRun(
  stat: Record<string, any>,
  previous: RunState,
  candidate: RunState,
): TowerRunMutationResult {
  const parsed = validateRunState(candidate);
  if (!parsed.ok) throw new Error(`tower run replacement is invalid: ${parsed.message}`);
  stat.run = parsed.value;
  return { previous, run: parsed.value, changed: true };
}

function abandonedIds(previous: TowerNodeContentStore, next: TowerNodeContentStore): string[] {
  return Object.keys(next).filter(
    nodeId => previous[nodeId]?.phase !== 'abandoned' && next[nodeId]?.phase === 'abandoned',
  );
}

function abandonUnreachableCurrentAct(run: RunState): {
  store: TowerNodeContentStore;
  abandonedNodeIds: string[];
} {
  const adjacency = buildTowerAdjacency(run);
  const reachable = currentRouteReachableIds(run, adjacency);
  const protectedIds = new Set([...run.visitedNodeIds, ...(run.currentNode ? [run.currentNode.id] : [])]);
  const targets = currentActNodes(run)
    .filter(node => !reachable.has(node.id) && !protectedIds.has(node.id))
    .map(node => node.id);
  const store = abandonTowerContent(run.nodeContent, targets);
  return { store, abandonedNodeIds: abandonedIds(run.nodeContent, store) };
}

function expireQueuedOutsideWindow(
  run: RunState,
  store: TowerNodeContentStore,
  windowIds: ReadonlySet<string>,
): { store: TowerNodeContentStore; expiredNodeIds: string[] } {
  let next = store;
  const expiredNodeIds: string[] = [];
  for (const node of currentActNodes(run)) {
    if (windowIds.has(node.id)) continue;
    const envelope = next[node.id];
    if (!envelope || (envelope.phase !== 'queued' && envelope.phase !== 'generating')) continue;
    if (next === store) next = { ...store };
    next[node.id] = {
      schemaVersion: envelope.schemaVersion,
      nodeId: envelope.nodeId,
      kind: envelope.kind,
      phase: 'idle',
      requestId: null,
      basedOnRevision: run.stateRevision,
      attempts: envelope.attempts,
    };
    expiredNodeIds.push(node.id);
  }
  return { store: next, expiredNodeIds };
}

/** Mark discarded branches in the current act while leaving every future act untouched. */
export function reconcileTowerRouteInStat(statValue: unknown): TowerRouteReconciliationResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  const reconciled = abandonUnreachableCurrentAct(previous);
  return {
    ...replaceRun(stat, previous, reconciled.store),
    abandonedNodeIds: reconciled.abandonedNodeIds,
  };
}

/** Select a map branch and abandon its discarded siblings in one saved-run replacement. */
export function enterTowerRunNodeInStat(statValue: unknown, choiceId: string): TowerRouteReconciliationResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  const entered = enterRunNode(previous, choiceId);
  const reconciled = abandonUnreachableCurrentAct(entered);
  const candidate = reconciled.store === entered.nodeContent ? entered : { ...entered, nodeContent: reconciled.store };
  return {
    ...replaceCandidateRun(stat, previous, candidate),
    abandonedNodeIds: reconciled.abandonedNodeIds,
  };
}

/** Queue a stable window of at most three nearest nodes and retire oversized legacy queues atomically. */
export function queueTowerLookaheadInStat(
  statValue: unknown,
  maxDepth: 1 | 2 | 3 = 3,
  options: { retryFailed?: boolean; maxNodes?: 1 | 2 | 3 } = {},
): TowerQueueResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  const lookahead = collectTowerLookahead(previous, maxDepth, options.maxNodes ?? 3);
  const reconciled = abandonUnreachableCurrentAct(previous);
  const windowIds = new Set(lookahead.map(target => target.nodeId));
  const expired = expireQueuedOutsideWindow(previous, reconciled.store, windowIds);
  let store = expired.store;
  const queued: TowerGenerationRequest[] = [];
  for (const target of lookahead) {
    const current = store[target.nodeId];
    if (!current || current.phase === 'queued' || current.phase === 'generating') continue;
    if (current.phase === 'failed' && options.retryFailed === false) continue;
    const mutation = queueTowerNodeContent(store, target.nodeId, previous.stateRevision);
    store = mutation.store;
    if (mutation.changed) queued.push(requestFromEnvelope(previous, mutation.envelope));
  }
  return {
    ...replaceRun(stat, previous, store),
    lookahead,
    queued,
    abandonedNodeIds: reconciled.abandonedNodeIds,
    expiredNodeIds: expired.expiredNodeIds,
  };
}

/** Requeue exactly one failed node without waking unrelated idle branches. */
export function retryTowerNodeGenerationInStat(statValue: unknown, nodeId: string): TowerRetryResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  requireCurrentRouteNode(previous, nodeId);
  const envelope = previous.nodeContent[nodeId];
  if (!envelope) throw new Error(`tower content node is unavailable: ${nodeId}`);
  if (envelope.phase !== 'failed') throw new Error('tower content node has no failed generation to retry');
  const mutation = queueTowerNodeContent(previous.nodeContent, nodeId, previous.stateRevision);
  if (!mutation.changed) throw new Error('tower content retry did not create a new request');
  const replaced = replaceRun(stat, previous, mutation.store);
  return { ...replaced, request: requestFromEnvelope(replaced.run, mutation.envelope) };
}

/**
 * Requeue a previously "ready" node whose authored content no longer passes
 * the current executable contract after a version upgrade. This is narrower
 * than the normal retry path: only callers that have just failed activation
 * validation may discard the stale prepared payload.
 */
export function requeueInvalidReadyTowerNodeGenerationInStat(
  statValue: unknown,
  nodeId: string,
  error: string,
): TowerRetryResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  requireCurrentRouteNode(previous, nodeId);
  const envelope = previous.nodeContent[nodeId];
  if (!envelope || envelope.phase !== 'ready') {
    throw new Error('tower content node has no invalid ready generation to replace');
  }
  const { content: _content, reward: _reward, ...identity } = envelope;
  const failedStore = {
    ...previous.nodeContent,
    [nodeId]: {
      ...identity,
      phase: 'failed' as const,
      error: String(error || '旧版预生成内容不再符合当前执行契约').slice(0, 500),
    },
  };
  const invalidated = validateReplacement(previous, failedStore);
  const queued = queueTowerNodeContent(invalidated.nodeContent, nodeId, invalidated.stateRevision);
  if (!queued.changed) throw new Error('tower invalid ready content did not create a replacement request');
  const run = validateReplacement(invalidated, queued.store);
  stat.run = run;
  return {
    previous,
    run,
    changed: true,
    request: requestFromEnvelope(run, queued.envelope),
  };
}

function requireCurrentRouteNode(run: RunState, nodeId: string): void {
  const node = run.map!.nodes.find(entry => entry.id === nodeId);
  if (!node) throw new Error(`tower map node is unavailable: ${nodeId}`);
  if (run.visitedNodeIds.includes(nodeId)) return;
  if (node.act !== run.act || !currentRouteReachableIds(run).has(nodeId)) {
    throw new Error('tower content response belongs to an abandoned route');
  }
}

/** Claim one queued request. Reclaiming the same in-flight request is idempotent. */
export function claimTowerGenerationInStat(
  statValue: unknown,
  nodeId: string,
  expectedRequestId?: string,
): TowerClaimResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  requireCurrentRouteNode(previous, nodeId);
  const envelope = previous.nodeContent[nodeId];
  if (!envelope) throw new Error(`tower content node is unavailable: ${nodeId}`);
  if (expectedRequestId && envelope.requestId !== expectedRequestId) {
    throw new Error('tower content request is stale');
  }
  if (envelope.phase === 'generating' && envelope.requestId) {
    return { previous, run: previous, changed: false, request: requestFromEnvelope(previous, envelope) };
  }
  const mutation = claimTowerGeneration(previous.nodeContent, nodeId, expectedRequestId);
  const replaced = replaceRun(stat, previous, mutation.store);
  return { ...replaced, request: requestFromEnvelope(replaced.run, mutation.envelope) };
}

/** Atomically claim up to `limit` queued requests for a background worker. */
export function claimQueuedTowerGenerationsInStat(
  statValue: unknown,
  limit = Number.MAX_SAFE_INTEGER,
): TowerBatchClaimResult {
  if (!Number.isInteger(limit) || limit < 0) throw new Error('tower generation claim limit is invalid');
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  const lookaheadWindow = new Set(collectTowerLookahead(previous, 3, 3).map(node => node.nodeId));
  let store = previous.nodeContent;
  const claimed: TowerNodeContentEnvelope[] = [];
  for (const node of previous.map!.nodes) {
    if (claimed.length >= limit) break;
    const envelope = store[node.id];
    if (node.act !== previous.act || !lookaheadWindow.has(node.id) || envelope?.phase !== 'queued') continue;
    const mutation = claimTowerGeneration(store, node.id, envelope.requestId || undefined);
    store = mutation.store;
    claimed.push(mutation.envelope);
  }
  const replaced = replaceRun(stat, previous, store);
  return {
    ...replaced,
    requests: claimed.map(envelope => requestFromEnvelope(replaced.run, envelope)),
  };
}

function duplicateResponseEnvelope(
  run: RunState,
  nodeId: string,
  requestId: string,
  revision: number,
  acceptedPhases: ReadonlySet<string>,
): TowerNodeContentEnvelope | null {
  const envelope = run.nodeContent[nodeId];
  if (
    envelope &&
    acceptedPhases.has(envelope.phase) &&
    envelope.requestId === requestId &&
    envelope.basedOnRevision === revision
  ) {
    return envelope;
  }
  return null;
}

/** Commit opaque generated content; this adapter never copies it into battle or reward state. */
export function commitTowerGenerationInStat<TContent = unknown, TReward = unknown>(
  statValue: unknown,
  response: TowerGenerationResponse<TContent, TReward>,
): TowerRunMutationResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  requireCurrentRouteNode(previous, response.nodeId);
  const duplicate = duplicateResponseEnvelope(
    previous,
    response.nodeId,
    response.requestId,
    response.revision,
    new Set(['ready', 'consumed']),
  );
  if (duplicate) return { previous, run: previous, changed: false };
  const commit: TowerGenerationCommit<TContent, TReward> = {
    nodeId: response.nodeId,
    requestId: response.requestId,
    basedOnRevision: response.revision,
    content: response.content,
    ...(response.reward === undefined ? {} : { reward: response.reward }),
  };
  const mutation = commitTowerGeneration(previous.nodeContent, commit);
  return replaceRun(stat, previous, mutation.store);
}

/** Record a failed opaque generation. Repeating the same failure is a no-op. */
export function failTowerGenerationInStat(statValue: unknown, failure: TowerGenerationFailure): TowerRunMutationResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  requireCurrentRouteNode(previous, failure.nodeId);
  const duplicate = duplicateResponseEnvelope(
    previous,
    failure.nodeId,
    failure.requestId,
    failure.revision,
    new Set(['failed']),
  );
  if (duplicate) return { previous, run: previous, changed: false };
  const mutation = failTowerGeneration(previous.nodeContent, failure.nodeId, {
    requestId: failure.requestId,
    basedOnRevision: failure.revision,
    error: failure.error,
  });
  return replaceRun(stat, previous, mutation.store);
}

/** Recover browser-interrupted jobs without generating content or changing route revision. */
export function recoverTowerGenerationsInStat(statValue: unknown): TowerRunMutationResult {
  const stat = requireStat(statValue);
  const previous = readTowerRunState(stat);
  const store = recoverInterruptedTowerContent(previous.nodeContent);
  return replaceRun(stat, previous, store);
}
