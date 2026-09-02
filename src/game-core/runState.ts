import {
  DEFAULT_RUN_MAP_ACTS,
  DEFAULT_RUN_MAP_ROUTE_FLOORS,
  generateRunMap,
  validateRunMap,
  type RunMap,
  type RunMapNode,
} from './runMap';
import {
  createTowerContentStore,
  validateTowerContentStore,
  type TowerNodeContentStore,
} from './towerContentState';
import { createTowerRunScore, validateTowerRunScore, type TowerRunScore } from './towerRunScore';

export const RUN_STATE_SCHEMA_VERSION = 3 as const;

export const RUN_NODE_KINDS = ['battle', 'elite', 'event', 'rest', 'shop', 'treasure', 'boss'] as const;
export type RunNodeKind = (typeof RUN_NODE_KINDS)[number];
export type RunPhase = 'awaiting_choice' | 'in_node' | 'won' | 'lost';
export type RunNodeOutcome = 'cleared' | 'failed' | 'escaped';
export type RunRouteMode = 'map' | 'legacy-window';
export type TowerOpeningPhase = 'pending' | 'generating' | 'ready' | 'consumed' | 'failed' | 'skipped';
export type TowerOpeningNarrativePhase = 'pending' | 'generating' | 'ready' | 'failed';

export interface RunNodeChoice {
  id: string;
  kind: RunNodeKind;
  act: number;
  floor: number;
  danger: 0 | 1 | 2 | 3;
  column?: number;
}

export type RunNodeCounts = Record<RunNodeKind, number>;

export interface TowerOpeningState {
  phase: TowerOpeningPhase;
  requestId: string | null;
  basedOnRevision: number;
  attempts: number;
  content?: unknown;
  error?: string;
  /** Current-preset prose is generated separately from the structured opening choices. */
  narrativePhase?: TowerOpeningNarrativePhase;
  narrativeRequestId?: string;
  narrativeError?: string;
}

export interface RunState {
  schemaVersion: typeof RUN_STATE_SCHEMA_VERSION;
  seed: number;
  rngCursor: number;
  phase: RunPhase;
  act: number;
  actCount: number;
  floor: number;
  floorsPerAct: number;
  currentNode: RunNodeChoice | null;
  choices: RunNodeChoice[];
  gold: number;
  nodeCounts: RunNodeCounts;
  lastNodeKind: RunNodeKind | null;
  routeMode: RunRouteMode;
  map: RunMap | null;
  visitedNodeIds: string[];
  nodeContent: TowerNodeContentStore;
  opening: TowerOpeningState;
  score: TowerRunScore;
  stateRevision: number;
}

export interface CreateRunStateOptions {
  seed: number;
  actCount?: number;
  floorsPerAct?: number;
  startingGold?: number;
  routeMode?: RunRouteMode;
}

export interface CompleteRunNodeOptions {
  outcome: RunNodeOutcome;
  goldDelta?: number;
}

export type RunStateValidationResult = { ok: true; value: RunState } | { ok: false; message: string };

const UINT32_MAX = 0xffffffff;
const MAX_GOLD = 999999;
const MAP_FLOORS_PER_ACT = DEFAULT_RUN_MAP_ROUTE_FLOORS + 1;
const NODE_DANGER: Record<RunNodeKind, 0 | 1 | 2 | 3> = {
  battle: 1,
  elite: 2,
  event: 0,
  rest: 0,
  shop: 0,
  treasure: 0,
  boss: 3,
};

export function isBattleRunNode(kind: RunNodeKind): boolean {
  return kind === 'battle' || kind === 'elite' || kind === 'boss';
}

function emptyNodeCounts(): RunNodeCounts {
  return { battle: 0, elite: 0, event: 0, rest: 0, shop: 0, treasure: 0, boss: 0 };
}

function requireInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function clampGold(value: number): number {
  if (!Number.isFinite(value)) throw new Error('gold must be finite');
  return Math.min(MAX_GOLD, Math.max(0, Math.trunc(value)));
}

function mixUint32(seed: number, cursor: number): number {
  let value = (seed + Math.imul(cursor + 1, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function drawUnit(state: RunState): { value: number; state: RunState } {
  const value = mixUint32(state.seed, state.rngCursor) / (UINT32_MAX + 1);
  return { value, state: { ...state, rngCursor: state.rngCursor + 1 } };
}

function weightedPick(
  state: RunState,
  entries: ReadonlyArray<{ kind: RunNodeKind; weight: number }>,
): { kind: RunNodeKind; state: RunState } {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) throw new Error('run route has no eligible node');
  const draw = drawUnit(state);
  let threshold = draw.value * total;
  for (const entry of entries) {
    threshold -= entry.weight;
    if (threshold < 0) return { kind: entry.kind, state: draw.state };
  }
  return { kind: entries.at(-1)!.kind, state: draw.state };
}

function legacyNodeId(state: RunState, floor: number, kind: RunNodeKind, index: number): string {
  return `a${state.act}_f${floor}_${kind}_${state.rngCursor}_${index}`;
}

function makeLegacyChoice(state: RunState, floor: number, kind: RunNodeKind, index: number): RunNodeChoice {
  return { id: legacyNodeId(state, floor, kind, index), kind, act: state.act, floor, danger: NODE_DANGER[kind] };
}

function eligibleLegacyNodes(state: RunState, nextFloor: number): Array<{ kind: RunNodeKind; weight: number }> {
  const entries: Array<{ kind: RunNodeKind; weight: number }> = [
    { kind: 'battle', weight: 6 },
    { kind: 'event', weight: 3 },
  ];
  if (nextFloor >= 3 && state.lastNodeKind !== 'rest') entries.push({ kind: 'rest', weight: 2 });
  if (nextFloor >= 3 && state.gold >= 40 && state.lastNodeKind !== 'shop') entries.push({ kind: 'shop', weight: 2 });
  if (nextFloor >= 4 && nextFloor <= state.floorsPerAct - 2) {
    entries.push({ kind: 'elite', weight: 1 + Math.min(2, state.act - 1) });
  }
  return entries;
}

function mapAct(state: RunState) {
  return state.map?.acts.find(entry => entry.act === state.act) || null;
}

function mapNodeToChoice(node: RunMapNode): RunNodeChoice {
  return {
    id: node.id,
    kind: node.kind,
    act: node.act,
    floor: node.floor,
    danger: NODE_DANGER[node.kind],
    column: node.column,
  };
}

function currentMapPositionNodeId(state: RunState): string | null {
  if (state.floor === 0) return null;
  for (let index = state.visitedNodeIds.length - 1; index >= 0; index -= 1) {
    const id = state.visitedNodeIds[index];
    const node = state.map?.nodes.find(entry => entry.id === id);
    if (node?.act === state.act && node.floor === state.floor) return id;
  }
  return null;
}

function mapChoicesAtCurrentPosition(state: RunState): RunNodeChoice[] {
  const act = mapAct(state);
  if (!act) throw new Error(`run map act is unavailable: ${state.act}`);
  const ids = state.floor === 0
    ? act.startNodeIds
    : act.edges.filter(edge => edge.from === currentMapPositionNodeId(state)).map(edge => edge.to);
  const nodes = new Map(act.nodes.map(node => [node.id, node]));
  return ids.map(id => {
    const node = nodes.get(id);
    if (!node) throw new Error(`run map choice node is unavailable: ${id}`);
    return mapNodeToChoice(node);
  });
}

/** Keep `choices` as the compatibility view of the current DAG successors. */
export function generateRunChoices(input: RunState): RunState {
  if (input.phase !== 'awaiting_choice' || input.currentNode) return input;
  if (input.choices.length > 0) return input;
  if (input.routeMode === 'map') return { ...input, choices: mapChoicesAtCurrentPosition(input) };

  const nextFloor = input.floor + 1;
  if (nextFloor > input.floorsPerAct) throw new Error('run floor exceeds the act length');
  if (nextFloor === input.floorsPerAct) {
    return { ...input, choices: [makeLegacyChoice(input, nextFloor, 'boss', 0)] };
  }
  if (nextFloor === 1) {
    return { ...input, choices: [makeLegacyChoice(input, nextFloor, 'battle', 0)] };
  }

  const desiredCount = nextFloor >= 4 ? 3 : 2;
  const selected: RunNodeKind[] = [];
  let state = input;
  while (selected.length < desiredCount) {
    const entries = eligibleLegacyNodes(state, nextFloor).filter(entry => !selected.includes(entry.kind));
    if (entries.length === 0) break;
    const picked = weightedPick(state, entries);
    selected.push(picked.kind);
    state = picked.state;
  }
  return {
    ...state,
    choices: selected.map((kind, index) => makeLegacyChoice(state, nextFloor, kind, index)),
  };
}

function shouldCreateMapRoute(options: CreateRunStateOptions): boolean {
  if (options.routeMode) return options.routeMode === 'map';
  const actsCompatible = options.actCount === undefined || options.actCount === DEFAULT_RUN_MAP_ACTS;
  const floorsCompatible = options.floorsPerAct === undefined || options.floorsPerAct === MAP_FLOORS_PER_ACT;
  return actsCompatible && floorsCompatible;
}

export function createRunState(options: CreateRunStateOptions): RunState {
  const seed = requireInteger(options.seed, 'seed', 0, UINT32_MAX) >>> 0;
  const routeMode: RunRouteMode = shouldCreateMapRoute(options) ? 'map' : 'legacy-window';
  const map = routeMode === 'map' ? generateRunMap({ seed }) : null;
  const actCount = routeMode === 'map'
    ? DEFAULT_RUN_MAP_ACTS
    : requireInteger(options.actCount ?? 3, 'actCount', 1, 9);
  const floorsPerAct = routeMode === 'map'
    ? MAP_FLOORS_PER_ACT
    : requireInteger(options.floorsPerAct ?? 10, 'floorsPerAct', 4, 99);
  const state: RunState = {
    schemaVersion: RUN_STATE_SCHEMA_VERSION,
    seed,
    rngCursor: 0,
    phase: 'awaiting_choice',
    act: 1,
    actCount,
    floor: 0,
    floorsPerAct,
    currentNode: null,
    choices: [],
    gold: clampGold(options.startingGold ?? 99),
    nodeCounts: emptyNodeCounts(),
    lastNodeKind: null,
    routeMode,
    map,
    visitedNodeIds: [],
    nodeContent: map ? createTowerContentStore(map.nodes.map(node => ({ id: node.id, kind: node.kind }))) : {},
    opening: {
      phase: map ? 'pending' : 'skipped',
      requestId: null,
      basedOnRevision: 0,
      attempts: 0,
    },
    score: createTowerRunScore(),
    stateRevision: 0,
  };
  return generateRunChoices(state);
}

export function enterRunNode(input: RunState, choiceId: string): RunState {
  if (input.phase !== 'awaiting_choice' || input.currentNode) throw new Error('run is not awaiting a route choice');
  const choice = input.choices.find(entry => entry.id === choiceId);
  if (!choice) throw new Error(`unknown run choice: ${choiceId}`);
  if (choice.act !== input.act || choice.floor !== input.floor + 1) throw new Error('run choice is stale');
  return {
    ...input,
    phase: 'in_node',
    currentNode: { ...choice },
    choices: [],
    stateRevision: input.stateRevision + 1,
  };
}

/** Return the active node or fail before a host mutates node-specific state. */
export function requireActiveRunNode(input: RunState, kind?: RunNodeKind): RunNodeChoice {
  if (input.phase !== 'in_node' || !input.currentNode) throw new Error('run has no active node');
  if (kind !== undefined && input.currentNode.kind !== kind) throw new Error(`run is not at a ${kind} node`);
  return input.currentNode;
}

function completeMapRunNode(
  input: RunState,
  current: RunNodeChoice,
  options: CompleteRunNodeOptions,
  gold: number,
): RunState {
  if (options.outcome === 'failed') {
    return { ...input, gold, phase: 'lost', choices: [], stateRevision: input.stateRevision + 1 };
  }
  if (options.outcome === 'escaped') {
    return generateRunChoices({
      ...input,
      gold,
      phase: 'awaiting_choice',
      currentNode: null,
      choices: [],
      stateRevision: input.stateRevision + 1,
    });
  }

  const nodeCounts = { ...input.nodeCounts, [current.kind]: input.nodeCounts[current.kind] + 1 };
  const visitedNodeIds = input.visitedNodeIds.includes(current.id)
    ? input.visitedNodeIds
    : [...input.visitedNodeIds, current.id];
  if (current.kind === 'boss') {
    if (input.act === input.actCount) {
      return {
        ...input,
        gold,
        floor: input.floorsPerAct,
        phase: 'won',
        currentNode: null,
        choices: [],
        nodeCounts,
        lastNodeKind: 'boss',
        visitedNodeIds,
        stateRevision: input.stateRevision + 1,
      };
    }
    return generateRunChoices({
      ...input,
      gold,
      act: input.act + 1,
      floor: 0,
      phase: 'awaiting_choice',
      currentNode: null,
      choices: [],
      nodeCounts,
      lastNodeKind: null,
      visitedNodeIds,
      stateRevision: input.stateRevision + 1,
    });
  }

  return generateRunChoices({
    ...input,
    gold,
    floor: current.floor,
    phase: 'awaiting_choice',
    currentNode: null,
    choices: [],
    nodeCounts,
    lastNodeKind: current.kind,
    visitedNodeIds,
    stateRevision: input.stateRevision + 1,
  });
}

export function completeRunNode(input: RunState, options: CompleteRunNodeOptions): RunState {
  const current = requireActiveRunNode(input);
  const gold = clampGold(input.gold + (options.goldDelta ?? 0));
  if (input.routeMode === 'map') return completeMapRunNode(input, current, options, gold);

  if (options.outcome === 'failed') {
    return { ...input, gold, phase: 'lost', choices: [], stateRevision: input.stateRevision + 1 };
  }
  if (options.outcome === 'escaped') {
    return generateRunChoices({
      ...input,
      gold,
      phase: 'awaiting_choice',
      currentNode: null,
      choices: [],
      stateRevision: input.stateRevision + 1,
    });
  }

  const nodeCounts = { ...input.nodeCounts, [current.kind]: input.nodeCounts[current.kind] + 1 };
  if (current.kind === 'boss') {
    if (input.act === input.actCount) {
      return {
        ...input,
        gold,
        floor: input.floorsPerAct,
        phase: 'won',
        currentNode: null,
        choices: [],
        nodeCounts,
        lastNodeKind: 'boss',
        stateRevision: input.stateRevision + 1,
      };
    }
    return generateRunChoices({
      ...input,
      gold,
      act: input.act + 1,
      floor: 0,
      phase: 'awaiting_choice',
      currentNode: null,
      choices: [],
      nodeCounts,
      lastNodeKind: null,
      stateRevision: input.stateRevision + 1,
    });
  }

  return generateRunChoices({
    ...input,
    gold,
    floor: current.floor,
    phase: 'awaiting_choice',
    currentNode: null,
    choices: [],
    nodeCounts,
    lastNodeKind: current.kind,
    stateRevision: input.stateRevision + 1,
  });
}

export function spendRunGold(input: RunState, amount: number): RunState {
  const cost = requireInteger(amount, 'amount', 0, MAX_GOLD);
  if (cost > input.gold) throw new Error('not enough run gold');
  return { ...input, gold: input.gold - cost, stateRevision: input.stateRevision + 1 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Migrate v1/v2 route-window saves without inventing a historical DAG. */
export function migrateRunState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  let source = value;
  if (source.schemaVersion === 1) source = { ...source, schemaVersion: 2 };
  if (source.schemaVersion === 2) {
    const oldCounts = isRecord(source.nodeCounts) ? source.nodeCounts : {};
    return {
      ...source,
      schemaVersion: RUN_STATE_SCHEMA_VERSION,
      nodeCounts: { ...emptyNodeCounts(), ...oldCounts },
      routeMode: 'legacy-window',
      map: null,
      visitedNodeIds: [],
      nodeContent: {},
      opening: { phase: 'skipped', requestId: null, basedOnRevision: 0, attempts: 0 },
      score: createTowerRunScore(),
      stateRevision: 0,
    } satisfies Partial<RunState>;
  }
  return source;
}

function isNodeChoice(value: unknown): value is RunNodeChoice {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 128
    && RUN_NODE_KINDS.includes(value.kind as RunNodeKind)
    && Number.isInteger(value.act)
    && Number.isInteger(value.floor)
    && [0, 1, 2, 3].includes(value.danger as number)
    && (value.column === undefined || (Number.isInteger(value.column) && Number(value.column) >= 0 && Number(value.column) <= 6))
  );
}

function sameChoice(left: RunNodeChoice, right: RunNodeChoice): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.act === right.act
    && left.floor === right.floor
    && left.danger === right.danger
    && left.column === right.column;
}

function validateOpening(value: unknown): value is TowerOpeningState {
  if (!isRecord(value)) return false;
  if (!['pending', 'generating', 'ready', 'consumed', 'failed', 'skipped'].includes(String(value.phase))) return false;
  if (value.requestId !== null && typeof value.requestId !== 'string') return false;
  if (!Number.isInteger(value.basedOnRevision) || Number(value.basedOnRevision) < 0) return false;
  if (!Number.isInteger(value.attempts) || Number(value.attempts) < 0) return false;
  if ((value.phase === 'generating' || value.phase === 'ready') && !value.requestId) return false;
  if ((value.phase === 'ready' || value.phase === 'consumed') && value.content === undefined) return false;
  if (
    value.narrativePhase !== undefined
    && !['pending', 'generating', 'ready', 'failed'].includes(String(value.narrativePhase))
  ) return false;
  if (value.narrativeRequestId !== undefined && typeof value.narrativeRequestId !== 'string') return false;
  if (
    (value.narrativePhase === 'pending' || value.narrativePhase === 'generating' || value.narrativePhase === 'ready')
    && !value.narrativeRequestId
  ) return false;
  if (value.narrativeError !== undefined && typeof value.narrativeError !== 'string') return false;
  return true;
}

function validateMapRouteState(value: Record<string, unknown>): string | null {
  const map = value.map as RunMap | null;
  if (!map || !Array.isArray(map.acts) || !Array.isArray(map.nodes) || !Array.isArray(map.edges)) {
    return 'run map is invalid';
  }
  try {
    const validation = validateRunMap(map);
    if (!validation.ok) return `run map is invalid: ${validation.errors[0]}`;
  } catch {
    return 'run map is invalid';
  }
  if (value.actCount !== DEFAULT_RUN_MAP_ACTS || value.floorsPerAct !== MAP_FLOORS_PER_ACT) {
    return 'run map dimensions are inconsistent';
  }
  const mapNodes = new Map(map.nodes.map(node => [node.id, node]));
  const visited = value.visitedNodeIds as string[];
  if (new Set(visited).size !== visited.length || visited.some(id => !mapNodes.has(id))) {
    return 'run visited nodes are invalid';
  }
  const choices = value.choices as RunNodeChoice[];
  const currentNode = value.currentNode as RunNodeChoice | null;
  for (const choice of currentNode ? [...choices, currentNode] : choices) {
    const node = mapNodes.get(choice.id);
    if (!node || !sameChoice(choice, mapNodeToChoice(node))) return 'run map choice is invalid';
  }

  if (value.phase === 'awaiting_choice') {
    try {
      const expected = mapChoicesAtCurrentPosition(value as unknown as RunState);
      const expectedIds = expected.map(choice => choice.id).sort();
      const actualIds = choices.map(choice => choice.id).sort();
      if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) return 'run map choices are inconsistent';
    } catch {
      return 'run map choices are inconsistent';
    }
  }
  if (value.phase === 'in_node' && currentNode) {
    const stateBeforeEntry = { ...value, phase: 'awaiting_choice', currentNode: null, choices: [] } as unknown as RunState;
    try {
      if (!mapChoicesAtCurrentPosition(stateBeforeEntry).some(choice => choice.id === currentNode.id)) {
        return 'run active map node is not reachable';
      }
    } catch {
      return 'run active map node is not reachable';
    }
  }
  if (!validateTowerContentStore(value.nodeContent)) return 'run node content is invalid';
  const contentIds = Object.keys(value.nodeContent as object).sort();
  const mapIds = [...mapNodes.keys()].sort();
  if (JSON.stringify(contentIds) !== JSON.stringify(mapIds)) return 'run node content coverage is invalid';
  return null;
}

/** Strict reader for adapters restoring RunState from MUV, a website, or a Mod save. */
export function validateRunState(value: unknown): RunStateValidationResult {
  value = migrateRunState(value);
  if (!isRecord(value)) return { ok: false, message: 'run state must be an object' };
  if (value.schemaVersion !== RUN_STATE_SCHEMA_VERSION) return { ok: false, message: 'unsupported run schema version' };
  if (!Number.isInteger(value.seed) || Number(value.seed) < 0 || Number(value.seed) > UINT32_MAX) {
    return { ok: false, message: 'run seed is invalid' };
  }
  if (!Number.isInteger(value.rngCursor) || Number(value.rngCursor) < 0 || Number(value.rngCursor) > UINT32_MAX) {
    return { ok: false, message: 'run rng cursor is invalid' };
  }
  if (!['awaiting_choice', 'in_node', 'won', 'lost'].includes(String(value.phase))) {
    return { ok: false, message: 'run phase is invalid' };
  }
  if (!['map', 'legacy-window'].includes(String(value.routeMode))) {
    return { ok: false, message: 'run route mode is invalid' };
  }
  if (!Number.isInteger(value.actCount) || Number(value.actCount) < 1 || Number(value.actCount) > 9) {
    return { ok: false, message: 'run act count is invalid' };
  }
  if (!Number.isInteger(value.act) || Number(value.act) < 1 || Number(value.act) > Number(value.actCount)) {
    return { ok: false, message: 'run act is invalid' };
  }
  if (!Number.isInteger(value.floorsPerAct) || Number(value.floorsPerAct) < 4 || Number(value.floorsPerAct) > 99) {
    return { ok: false, message: 'run floor count is invalid' };
  }
  if (!Number.isInteger(value.floor) || Number(value.floor) < 0 || Number(value.floor) > Number(value.floorsPerAct)) {
    return { ok: false, message: 'run floor is invalid' };
  }
  if (!Number.isInteger(value.gold) || Number(value.gold) < 0 || Number(value.gold) > MAX_GOLD) {
    return { ok: false, message: 'run gold is invalid' };
  }
  if (!Number.isInteger(value.stateRevision) || Number(value.stateRevision) < 0) {
    return { ok: false, message: 'run state revision is invalid' };
  }
  if (!Array.isArray(value.visitedNodeIds) || !value.visitedNodeIds.every(id => typeof id === 'string')) {
    return { ok: false, message: 'run visited nodes are invalid' };
  }
  if (!Array.isArray(value.choices) || !value.choices.every(isNodeChoice)) {
    return { ok: false, message: 'run choices are invalid' };
  }
  if (value.currentNode !== null && !isNodeChoice(value.currentNode)) {
    return { ok: false, message: 'run current node is invalid' };
  }
  if (value.lastNodeKind !== null && !RUN_NODE_KINDS.includes(value.lastNodeKind as RunNodeKind)) {
    return { ok: false, message: 'run last node kind is invalid' };
  }
  if (!isRecord(value.nodeCounts)) return { ok: false, message: 'run node counts are invalid' };
  for (const kind of RUN_NODE_KINDS) {
    if (!Number.isInteger(value.nodeCounts[kind]) || Number(value.nodeCounts[kind]) < 0) {
      return { ok: false, message: `run node count ${kind} is invalid` };
    }
  }
  if (!validateOpening(value.opening)) return { ok: false, message: 'run opening state is invalid' };
  if (!validateTowerRunScore(value.score)) return { ok: false, message: 'run score state is invalid' };

  const phase = value.phase as RunPhase;
  const choices = value.choices as RunNodeChoice[];
  const currentNode = value.currentNode as RunNodeChoice | null;
  if (new Set(choices.map(choice => choice.id)).size !== choices.length || choices.length > 7) {
    return { ok: false, message: 'run choices contain duplicate or excessive entries' };
  }
  if (phase === 'awaiting_choice') {
    if (currentNode || choices.length < 1) return { ok: false, message: 'run choice phase is inconsistent' };
    if (choices.some(choice => choice.act !== value.act || choice.floor !== Number(value.floor) + 1)) {
      return { ok: false, message: 'run choice is stale' };
    }
  }
  if (phase === 'in_node') {
    if (!currentNode || choices.length > 0) return { ok: false, message: 'run active node phase is inconsistent' };
    if (currentNode.act !== value.act || currentNode.floor !== Number(value.floor) + 1) {
      return { ok: false, message: 'run active node is stale' };
    }
  }
  if (phase === 'won') {
    if (currentNode || choices.length > 0 || value.act !== value.actCount || value.floor !== value.floorsPerAct) {
      return { ok: false, message: 'run victory state is inconsistent' };
    }
  }
  if (phase === 'lost' && (!currentNode || choices.length > 0)) {
    return { ok: false, message: 'run defeat state is inconsistent' };
  }

  if (value.routeMode === 'map') {
    const error = validateMapRouteState(value);
    if (error) return { ok: false, message: error };
  } else {
    if (value.map !== null) return { ok: false, message: 'legacy run map must be null' };
    if (!validateTowerContentStore(value.nodeContent)) return { ok: false, message: 'run node content is invalid' };
  }
  return { ok: true, value: value as unknown as RunState };
}
