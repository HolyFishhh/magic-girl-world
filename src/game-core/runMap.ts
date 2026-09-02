import { createBattleRandomState, drawBattleRandom, stableHash32 } from './deterministicRandom';

export const RUN_MAP_SCHEMA_VERSION = 1 as const;
export const DEFAULT_RUN_MAP_ACTS = 3 as const;
export const DEFAULT_RUN_MAP_COLUMNS = 7 as const;
export const DEFAULT_RUN_MAP_ROUTE_FLOORS = 15 as const;
export const DEFAULT_RUN_MAP_PATHS = 6 as const;
export const RUN_MAP_ROOM_ASSIGNMENT_ATTEMPTS = 256 as const;

export type RunMapSeed = number | string;
export type RunMapNodeKind = 'battle' | 'elite' | 'event' | 'rest' | 'shop' | 'treasure' | 'boss';
export type RunMapRandomNodeKind = Exclude<RunMapNodeKind, 'treasure' | 'boss'>;

export interface RunMapStreamSeeds {
  topology: number;
  room: number;
  content: number;
  reward: number;
}

export interface RunMapNode {
  id: string;
  act: number;
  floor: number;
  column: number;
  kind: RunMapNodeKind;
  contentSeed: number;
  rewardSeed: number;
}

export interface RunMapEdge {
  from: string;
  to: string;
}

export interface RunMapAct {
  act: number;
  difficultyMultiplier: number;
  seeds: RunMapStreamSeeds;
  roomAssignmentAttempt: number;
  roomAssignmentSeed: number;
  nodes: RunMapNode[];
  edges: RunMapEdge[];
  /** Six independently generated routes. Shared ids represent route merges. */
  paths: string[][];
  startNodeIds: string[];
  bossNodeId: string;
}

export interface RunMapConfig {
  acts: number;
  columns: number;
  routeFloors: number;
  pathsPerAct: number;
  actDifficultyStep: number;
}

export interface RunMapActValidationStats {
  act: number;
  nodeCount: number;
  edgeCount: number;
  randomRoomCounts: Record<RunMapRandomNodeKind, number>;
  randomRoomRatios: Record<RunMapRandomNodeKind, number>;
  routeEliteCounts: number[];
  minimumRouteElites: number;
  maximumRouteElites: number;
}

export interface RunMapValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  acts: RunMapActValidationStats[];
}

export interface RunMap {
  schemaVersion: typeof RUN_MAP_SCHEMA_VERSION;
  seed: RunMapSeed;
  normalizedSeed: number;
  seeds: RunMapStreamSeeds;
  config: RunMapConfig;
  acts: RunMapAct[];
  /** Flattened views for renderers and persistence adapters. */
  nodes: RunMapNode[];
  edges: RunMapEdge[];
  startNodeIds: Record<number, string[]>;
  bossNodeIds: Record<number, string>;
  validation: RunMapValidation;
}

export interface GenerateRunMapOptions {
  seed: RunMapSeed;
  actDifficultyStep?: number;
}

interface TopologyNode {
  id: string;
  act: number;
  floor: number;
  column: number;
}

interface GeneratedTopology {
  nodes: TopologyNode[];
  edges: RunMapEdge[];
  paths: string[][];
  startNodeIds: string[];
  bossNodeId: string;
}

interface RandomSource {
  next(): number;
  integer(maxExclusive: number): number;
  shuffled<T>(values: readonly T[]): T[];
}

const RANDOM_ROOM_KINDS: readonly RunMapRandomNodeKind[] = ['battle', 'event', 'rest', 'elite', 'shop'];
const SPECIAL_NO_REPEAT_KINDS = new Set<RunMapNodeKind>(['elite', 'rest', 'shop', 'treasure']);
const RANDOM_ROOM_WEIGHTS: Readonly<Record<RunMapRandomNodeKind, number>> = {
  battle: 0.53,
  event: 0.22,
  rest: 0.12,
  elite: 0.08,
  shop: 0.05,
};

function normalizeSeed(seed: RunMapSeed): number {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) throw new Error('run map seed must be finite');
    return Math.trunc(seed) >>> 0;
  }
  if (!seed.length) throw new Error('run map seed must not be empty');
  return stableHash32(seed);
}

function deriveSeed(seed: number, stream: string | number): number {
  return stableHash32({ namespace: 'magic-girl-run-map-v1', seed, stream });
}

function deriveStreams(seed: number): RunMapStreamSeeds {
  return {
    topology: deriveSeed(seed, 'topology'),
    room: deriveSeed(seed, 'room'),
    content: deriveSeed(seed, 'content'),
    reward: deriveSeed(seed, 'reward'),
  };
}

function createRandomSource(seed: number): RandomSource {
  let state = createBattleRandomState(seed);
  return {
    next(): number {
      const drawn = drawBattleRandom(state);
      state = drawn.state;
      return drawn.value;
    },
    integer(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('random integer upper bound must be a positive integer');
      }
      return Math.floor(this.next() * maxExclusive);
    },
    shuffled<T>(values: readonly T[]): T[] {
      const result = [...values];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const target = this.integer(index + 1);
        [result[index], result[target]] = [result[target], result[index]];
      }
      return result;
    },
  };
}

function nodeId(act: number, floor: number, column: number): string {
  return floor === DEFAULT_RUN_MAP_ROUTE_FLOORS + 1 ? `act-${act}-boss` : `act-${act}-floor-${floor}-col-${column}`;
}

function edgeKey(from: string, to: string): string {
  return `${from}>${to}`;
}

function chooseNextColumns(current: readonly number[], targetFloor: number, random: RandomSource): number[] {
  // These forced floors share one room kind, so merged paths may not split into same-kind siblings here.
  if (targetFloor === 9 || targetFloor === 15) return [...current];

  let fallback: number[] | undefined;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const proposed = current
      .map(column => Math.max(0, Math.min(DEFAULT_RUN_MAP_COLUMNS - 1, column + random.integer(3) - 1)))
      .sort((left, right) => left - right);
    fallback ??= proposed;
    if (new Set(proposed).size >= 4) return proposed;
    if (new Set(proposed).size > new Set(fallback).size) fallback = proposed;
  }
  return fallback ?? [...current];
}

function generateActTopology(act: number, topologySeed: number): GeneratedTopology {
  const random = createRandomSource(topologySeed);
  const omittedStartColumn = random.integer(DEFAULT_RUN_MAP_COLUMNS);
  const positions = Array.from({ length: DEFAULT_RUN_MAP_COLUMNS }, (_, column) => column).filter(
    column => column !== omittedStartColumn,
  );
  const pathColumns = positions.map(column => [column]);
  let current = positions;

  for (let floor = 2; floor <= DEFAULT_RUN_MAP_ROUTE_FLOORS; floor += 1) {
    const next = chooseNextColumns(current, floor, random);
    next.forEach((column, index) => pathColumns[index].push(column));
    current = next;
  }

  const topologyNodes = new Map<string, TopologyNode>();
  const topologyEdges = new Map<string, RunMapEdge>();
  const bossFloor = DEFAULT_RUN_MAP_ROUTE_FLOORS + 1;
  const bossColumn = Math.floor(DEFAULT_RUN_MAP_COLUMNS / 2);
  const bossNodeId = nodeId(act, bossFloor, bossColumn);
  topologyNodes.set(bossNodeId, { id: bossNodeId, act, floor: bossFloor, column: bossColumn });

  const paths = pathColumns.map(columns => {
    const path = columns.map((column, index) => {
      const floor = index + 1;
      const id = nodeId(act, floor, column);
      topologyNodes.set(id, { id, act, floor, column });
      return id;
    });
    path.push(bossNodeId);
    for (let index = 0; index < path.length - 1; index += 1) {
      const edge = { from: path[index], to: path[index + 1] };
      topologyEdges.set(edgeKey(edge.from, edge.to), edge);
    }
    return path;
  });

  const nodes = [...topologyNodes.values()].sort(
    (left, right) => left.floor - right.floor || left.column - right.column || left.id.localeCompare(right.id),
  );
  const edges = [...topologyEdges.values()].sort((left, right) => {
    const leftFrom = topologyNodes.get(left.from)!;
    const rightFrom = topologyNodes.get(right.from)!;
    const leftTo = topologyNodes.get(left.to)!;
    const rightTo = topologyNodes.get(right.to)!;
    return (
      leftFrom.floor - rightFrom.floor ||
      leftFrom.column - rightFrom.column ||
      leftTo.column - rightTo.column ||
      left.to.localeCompare(right.to)
    );
  });
  return {
    nodes,
    edges,
    paths,
    startNodeIds: [...new Set(paths.map(path => path[0]))],
    bossNodeId,
  };
}

function forcedKind(floor: number): RunMapNodeKind | undefined {
  if (floor === 1) return 'battle';
  if (floor === 9) return 'treasure';
  if (floor === 15) return 'rest';
  if (floor === 16) return 'boss';
  return undefined;
}

function allowedKinds(floor: number): RunMapRandomNodeKind[] {
  return RANDOM_ROOM_KINDS.filter(kind => {
    if (floor <= 5 && (kind === 'elite' || kind === 'rest')) return false;
    if (floor === 14 && kind === 'rest') return false;
    return true;
  });
}

function calculateQuotaTargets(total: number): Record<RunMapRandomNodeKind, number> {
  const targets = Object.fromEntries(RANDOM_ROOM_KINDS.map(kind => [kind, 0])) as Record<RunMapRandomNodeKind, number>;
  const remainders = RANDOM_ROOM_KINDS.map(kind => {
    const exact = total * RANDOM_ROOM_WEIGHTS[kind];
    targets[kind] = Math.floor(exact);
    return { kind, remainder: exact - Math.floor(exact) };
  }).sort((left, right) => right.remainder - left.remainder || left.kind.localeCompare(right.kind));
  let remaining = total - Object.values(targets).reduce((sum, count) => sum + count, 0);
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    targets[remainders[index % remainders.length].kind] += 1;
  }
  return targets;
}

function assignRoomKinds(topology: GeneratedTopology, roomSeed: number): Map<string, RunMapNodeKind> {
  const parentIds = new Map<string, string[]>();
  const childIds = new Map<string, string[]>();
  topology.edges.forEach(edge => {
    parentIds.set(edge.to, [...(parentIds.get(edge.to) ?? []), edge.from]);
    childIds.set(edge.from, [...(childIds.get(edge.from) ?? []), edge.to]);
  });

  const kinds = new Map<string, RunMapNodeKind>();
  const randomNodes = topology.nodes.filter(node => !forcedKind(node.floor));
  const targets = calculateQuotaTargets(randomNodes.length);
  const counts = Object.fromEntries(RANDOM_ROOM_KINDS.map(kind => [kind, 0])) as Record<RunMapRandomNodeKind, number>;
  const random = createRandomSource(roomSeed);
  const noise = new Map<string, Record<RunMapRandomNodeKind, number>>();
  topology.nodes.forEach(node => {
    noise.set(
      node.id,
      Object.fromEntries(RANDOM_ROOM_KINDS.map(kind => [kind, random.next()])) as Record<RunMapRandomNodeKind, number>,
    );
  });

  for (let floor = 1; floor <= DEFAULT_RUN_MAP_ROUTE_FLOORS + 1; floor += 1) {
    const floorNodes = topology.nodes.filter(node => node.floor === floor);
    const requiredKind = forcedKind(floor);
    if (requiredKind) {
      floorNodes.forEach(node => kinds.set(node.id, requiredKind));
      continue;
    }

    const orderedNodes = [...floorNodes].sort((left, right) => {
      const leftConstraint = (parentIds.get(left.id) ?? []).reduce(
        (sum, parentId) => sum + (childIds.get(parentId)?.length ?? 0),
        0,
      );
      const rightConstraint = (parentIds.get(right.id) ?? []).reduce(
        (sum, parentId) => sum + (childIds.get(parentId)?.length ?? 0),
        0,
      );
      return rightConstraint - leftConstraint || left.column - right.column;
    });

    const assignAt = (index: number): boolean => {
      if (index >= orderedNodes.length) return true;
      const node = orderedNodes[index];
      const parents = parentIds.get(node.id) ?? [];
      const candidates = allowedKinds(floor)
        .filter(kind => {
          for (const parentId of parents) {
            const parentKind = kinds.get(parentId);
            if (parentKind === kind && SPECIAL_NO_REPEAT_KINDS.has(kind)) return false;
            const siblings = childIds.get(parentId) ?? [];
            if (siblings.some(siblingId => siblingId !== node.id && kinds.get(siblingId) === kind)) return false;
          }
          return true;
        })
        .sort((left, right) => {
          const leftDeficit = targets[left] - counts[left];
          const rightDeficit = targets[right] - counts[right];
          return rightDeficit - leftDeficit || noise.get(node.id)![right] - noise.get(node.id)![left];
        });

      for (const candidate of candidates) {
        kinds.set(node.id, candidate);
        counts[candidate] += 1;
        if (assignAt(index + 1)) return true;
        counts[candidate] -= 1;
        kinds.delete(node.id);
      }
      return false;
    };

    if (!assignAt(0)) throw new Error(`unable to assign valid room kinds on act floor ${floor}`);
  }
  return kinds;
}

function countRouteElites(paths: readonly (readonly string[])[], kinds: ReadonlyMap<string, RunMapNodeKind>): number[] {
  return paths.map(path => path.reduce((count, id) => count + (kinds.get(id) === 'elite' ? 1 : 0), 0));
}

function hasRequiredRouteRiskSpread(routeEliteCounts: readonly number[]): boolean {
  if (!routeEliteCounts.length) return false;
  const minimum = Math.min(...routeEliteCounts);
  const maximum = Math.max(...routeEliteCounts);
  return minimum <= 1 && maximum >= 2 && maximum - minimum >= 1;
}

function generateAct(act: number, rootSeeds: RunMapStreamSeeds, difficultyStep: number): RunMapAct {
  const seeds: RunMapStreamSeeds = {
    topology: deriveSeed(rootSeeds.topology, act),
    room: deriveSeed(rootSeeds.room, act),
    content: deriveSeed(rootSeeds.content, act),
    reward: deriveSeed(rootSeeds.reward, act),
  };
  const topology = generateActTopology(act, seeds.topology);
  let kinds: Map<string, RunMapNodeKind> | undefined;
  let roomAssignmentAttempt = -1;
  let roomAssignmentSeed = seeds.room;
  for (let attempt = 0; attempt < RUN_MAP_ROOM_ASSIGNMENT_ATTEMPTS; attempt += 1) {
    const assignmentSeed = deriveSeed(seeds.room, `assignment-${attempt}`);
    const candidate = assignRoomKinds(topology, assignmentSeed);
    if (!hasRequiredRouteRiskSpread(countRouteElites(topology.paths, candidate))) continue;
    kinds = candidate;
    roomAssignmentAttempt = attempt;
    roomAssignmentSeed = assignmentSeed;
    break;
  }
  if (!kinds) {
    throw new Error(
      `unable to produce safe and high-risk routes for act ${act} after ${RUN_MAP_ROOM_ASSIGNMENT_ATTEMPTS} attempts`,
    );
  }
  const nodes = topology.nodes.map(node => ({
    ...node,
    kind: kinds.get(node.id)!,
    contentSeed: deriveSeed(seeds.content, node.id),
    rewardSeed: deriveSeed(seeds.reward, node.id),
  }));
  return {
    act,
    difficultyMultiplier: Number((1 + (act - 1) * difficultyStep).toFixed(4)),
    seeds,
    roomAssignmentAttempt,
    roomAssignmentSeed,
    nodes,
    edges: topology.edges,
    paths: topology.paths,
    startNodeIds: topology.startNodeIds,
    bossNodeId: topology.bossNodeId,
  };
}

function recordError(errors: string[], condition: boolean, message: string): void {
  if (!condition) errors.push(message);
}

function ratioRecord(counts: Record<RunMapRandomNodeKind, number>): Record<RunMapRandomNodeKind, number> {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return Object.fromEntries(
    RANDOM_ROOM_KINDS.map(kind => [kind, total > 0 ? Number((counts[kind] / total).toFixed(4)) : 0]),
  ) as Record<RunMapRandomNodeKind, number>;
}

export function validateRunMap(map: Omit<RunMap, 'validation'> | RunMap): RunMapValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats: RunMapActValidationStats[] = [];
  const globalNodeIds = new Set<string>();

  recordError(errors, map.schemaVersion === RUN_MAP_SCHEMA_VERSION, 'run map schema version is invalid');
  recordError(errors, map.acts.length === DEFAULT_RUN_MAP_ACTS, 'run map must contain three acts');

  for (const act of map.acts) {
    const nodesById = new Map(act.nodes.map(node => [node.id, node]));
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    act.nodes.forEach(node => {
      recordError(errors, !globalNodeIds.has(node.id), `duplicate node id: ${node.id}`);
      globalNodeIds.add(node.id);
      recordError(errors, node.act === act.act, `node ${node.id} belongs to the wrong act`);
      recordError(
        errors,
        node.column >= 0 && node.column < DEFAULT_RUN_MAP_COLUMNS,
        `node ${node.id} has an invalid column`,
      );
      const required = forcedKind(node.floor);
      if (required)
        recordError(errors, node.kind === required, `node ${node.id} violates forced floor kind ${required}`);
      if (node.floor <= 5) {
        recordError(
          errors,
          node.kind !== 'elite' && node.kind !== 'rest',
          `node ${node.id} is forbidden before floor 6`,
        );
      }
      if (node.floor === 14) recordError(errors, node.kind !== 'rest', `node ${node.id} cannot be a floor 14 rest`);
    });

    for (const edge of act.edges) {
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      recordError(errors, Boolean(from), `edge source is missing: ${edge.from}`);
      recordError(errors, Boolean(to), `edge target is missing: ${edge.to}`);
      if (!from || !to) continue;
      recordError(errors, to.floor === from.floor + 1, `edge ${edgeKey(edge.from, edge.to)} skips a floor`);
      if (to.kind !== 'boss') {
        recordError(
          errors,
          Math.abs(to.column - from.column) <= 1,
          `non-boss edge ${edgeKey(edge.from, edge.to)} moves more than one column`,
        );
      }
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
      if (from.kind === to.kind && SPECIAL_NO_REPEAT_KINDS.has(from.kind)) {
        errors.push(`special room repeats along edge ${edgeKey(edge.from, edge.to)}`);
      }
    }

    const edgesByFloor = new Map<number, RunMapEdge[]>();
    act.edges.forEach(edge => {
      const from = nodesById.get(edge.from);
      if (from) edgesByFloor.set(from.floor, [...(edgesByFloor.get(from.floor) ?? []), edge]);
    });
    for (const [floor, edges] of edgesByFloor) {
      for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
          const leftFrom = nodesById.get(edges[leftIndex].from)!;
          const leftTo = nodesById.get(edges[leftIndex].to)!;
          const rightFrom = nodesById.get(edges[rightIndex].from)!;
          const rightTo = nodesById.get(edges[rightIndex].to)!;
          const crosses =
            (leftFrom.column < rightFrom.column && leftTo.column > rightTo.column) ||
            (leftFrom.column > rightFrom.column && leftTo.column < rightTo.column);
          recordError(errors, !crosses, `edges cross in act ${act.act} after floor ${floor}`);
        }
      }
    }

    for (const [parentId, children] of outgoing) {
      const childKinds = children.map(childId => nodesById.get(childId)!.kind);
      recordError(
        errors,
        new Set(childKinds).size === childKinds.length,
        `siblings from ${parentId} must use distinct room kinds`,
      );
    }

    const reachable = new Set(act.startNodeIds);
    const queue = [...act.startNodeIds];
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of outgoing.get(current) ?? []) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
    const reachesBoss = new Set([act.bossNodeId]);
    const reverseQueue = [act.bossNodeId];
    while (reverseQueue.length) {
      const current = reverseQueue.shift()!;
      for (const previous of incoming.get(current) ?? []) {
        if (reachesBoss.has(previous)) continue;
        reachesBoss.add(previous);
        reverseQueue.push(previous);
      }
    }
    act.nodes.forEach(node => {
      recordError(errors, reachable.has(node.id), `node ${node.id} is unreachable from an act start`);
      recordError(errors, reachesBoss.has(node.id), `node ${node.id} cannot reach the boss`);
      if (node.id !== act.bossNodeId)
        recordError(errors, (outgoing.get(node.id)?.length ?? 0) > 0, `node ${node.id} is a dead end`);
      if (node.floor > 1)
        recordError(errors, (incoming.get(node.id)?.length ?? 0) > 0, `node ${node.id} has no parent`);
    });

    recordError(errors, act.paths.length === DEFAULT_RUN_MAP_PATHS, `act ${act.act} must contain six routes`);
    act.paths.forEach((path, index) => {
      recordError(
        errors,
        path.length === DEFAULT_RUN_MAP_ROUTE_FLOORS + 1,
        `act ${act.act} route ${index + 1} has an invalid length`,
      );
      recordError(
        errors,
        path[path.length - 1] === act.bossNodeId,
        `act ${act.act} route ${index + 1} misses the boss`,
      );
      for (let edgeIndex = 0; edgeIndex < path.length - 1; edgeIndex += 1) {
        recordError(
          errors,
          act.edges.some(edge => edge.from === path[edgeIndex] && edge.to === path[edgeIndex + 1]),
          `act ${act.act} route ${index + 1} contains a missing edge`,
        );
      }
    });

    const randomRoomCounts = Object.fromEntries(RANDOM_ROOM_KINDS.map(kind => [kind, 0])) as Record<
      RunMapRandomNodeKind,
      number
    >;
    act.nodes.forEach(node => {
      if (!forcedKind(node.floor)) randomRoomCounts[node.kind as RunMapRandomNodeKind] += 1;
    });
    const randomRoomRatios = ratioRecord(randomRoomCounts);
    const routeEliteCounts = act.paths.map(path =>
      path.reduce((count, id) => count + (nodesById.get(id)?.kind === 'elite' ? 1 : 0), 0),
    );
    const minimumRouteElites = routeEliteCounts.length ? Math.min(...routeEliteCounts) : 0;
    const maximumRouteElites = routeEliteCounts.length ? Math.max(...routeEliteCounts) : 0;
    recordError(
      errors,
      routeEliteCounts.length > 0 && minimumRouteElites <= 1,
      `act ${act.act} must provide a safe route with at most one elite`,
    );
    recordError(
      errors,
      routeEliteCounts.length > 0 && maximumRouteElites >= 2,
      `act ${act.act} must provide a high-risk route with at least two elites`,
    );
    recordError(
      errors,
      routeEliteCounts.length > 0 && maximumRouteElites - minimumRouteElites >= 1,
      `act ${act.act} elite route spread must be at least one`,
    );
    RANDOM_ROOM_KINDS.forEach(kind => {
      if (Math.abs(randomRoomRatios[kind] - RANDOM_ROOM_WEIGHTS[kind]) > 0.1) {
        warnings.push(
          `act ${act.act} ${kind} ratio ${randomRoomRatios[kind]} differs from target ${RANDOM_ROOM_WEIGHTS[kind]}`,
        );
      }
    });
    stats.push({
      act: act.act,
      nodeCount: act.nodes.length,
      edgeCount: act.edges.length,
      randomRoomCounts,
      randomRoomRatios,
      routeEliteCounts,
      minimumRouteElites,
      maximumRouteElites,
    });
  }
  return { ok: errors.length === 0, errors, warnings, acts: stats };
}

export function generateRunMap(options: GenerateRunMapOptions | RunMapSeed): RunMap {
  const normalizedOptions: GenerateRunMapOptions =
    typeof options === 'number' || typeof options === 'string' ? { seed: options } : options;
  const normalizedSeed = normalizeSeed(normalizedOptions.seed);
  const actDifficultyStep = normalizedOptions.actDifficultyStep ?? 0.07;
  if (!Number.isFinite(actDifficultyStep) || actDifficultyStep < 0) {
    throw new Error('act difficulty step must be a non-negative finite number');
  }
  const seeds = deriveStreams(normalizedSeed);
  const acts = Array.from({ length: DEFAULT_RUN_MAP_ACTS }, (_, index) =>
    generateAct(index + 1, seeds, actDifficultyStep),
  );
  const partial: Omit<RunMap, 'validation'> = {
    schemaVersion: RUN_MAP_SCHEMA_VERSION,
    seed: normalizedOptions.seed,
    normalizedSeed,
    seeds,
    config: {
      acts: DEFAULT_RUN_MAP_ACTS,
      columns: DEFAULT_RUN_MAP_COLUMNS,
      routeFloors: DEFAULT_RUN_MAP_ROUTE_FLOORS,
      pathsPerAct: DEFAULT_RUN_MAP_PATHS,
      actDifficultyStep,
    },
    acts,
    nodes: acts.flatMap(act => act.nodes),
    edges: acts.flatMap(act => act.edges),
    startNodeIds: Object.fromEntries(acts.map(act => [act.act, act.startNodeIds])),
    bossNodeIds: Object.fromEntries(acts.map(act => [act.act, act.bossNodeId])),
  };
  const validation = validateRunMap(partial);
  if (!validation.ok) throw new Error(`generated invalid run map: ${validation.errors.join('; ')}`);
  return { ...partial, validation };
}

export const createRunMap = generateRunMap;
