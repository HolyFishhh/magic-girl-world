export const RUN_STATE_SCHEMA_VERSION = 1 as const;

export const RUN_NODE_KINDS = ['battle', 'elite', 'event', 'rest', 'shop', 'boss'] as const;
export type RunNodeKind = (typeof RUN_NODE_KINDS)[number];
export type RunPhase = 'awaiting_choice' | 'in_node' | 'won' | 'lost';
export type RunNodeOutcome = 'cleared' | 'failed' | 'escaped';

export interface RunNodeChoice {
  id: string;
  kind: RunNodeKind;
  act: number;
  floor: number;
  danger: 0 | 1 | 2 | 3;
}

export type RunNodeCounts = Record<RunNodeKind, number>;

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
}

export interface CreateRunStateOptions {
  seed: number;
  actCount?: number;
  floorsPerAct?: number;
  startingGold?: number;
}

export interface CompleteRunNodeOptions {
  outcome: RunNodeOutcome;
  goldDelta?: number;
}

export type RunStateValidationResult = { ok: true; value: RunState } | { ok: false; message: string };

const UINT32_MAX = 0xffffffff;
const MAX_GOLD = 999999;
const NODE_DANGER: Record<RunNodeKind, 0 | 1 | 2 | 3> = {
  battle: 1,
  elite: 2,
  event: 0,
  rest: 0,
  shop: 0,
  boss: 3,
};

function emptyNodeCounts(): RunNodeCounts {
  return { battle: 0, elite: 0, event: 0, rest: 0, shop: 0, boss: 0 };
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

function nodeId(state: RunState, floor: number, kind: RunNodeKind, index: number): string {
  return `a${state.act}_f${floor}_${kind}_${state.rngCursor}_${index}`;
}

function makeChoice(state: RunState, floor: number, kind: RunNodeKind, index: number): RunNodeChoice {
  return { id: nodeId(state, floor, kind, index), kind, act: state.act, floor, danger: NODE_DANGER[kind] };
}

function eligibleNodes(state: RunState, nextFloor: number): Array<{ kind: RunNodeKind; weight: number }> {
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

/** Generate only the next choice set; no full map is stored in prompts or saves. */
export function generateRunChoices(input: RunState): RunState {
  if (input.phase !== 'awaiting_choice' || input.currentNode) return input;
  if (input.choices.length > 0) return input;

  const nextFloor = input.floor + 1;
  if (nextFloor > input.floorsPerAct) throw new Error('run floor exceeds the act length');
  if (nextFloor === input.floorsPerAct) {
    return { ...input, choices: [makeChoice(input, nextFloor, 'boss', 0)] };
  }
  if (nextFloor === 1) {
    return { ...input, choices: [makeChoice(input, nextFloor, 'battle', 0)] };
  }

  const desiredCount = nextFloor >= 4 ? 3 : 2;
  const selected: RunNodeKind[] = [];
  let state = input;
  while (selected.length < desiredCount) {
    const entries = eligibleNodes(state, nextFloor).filter(entry => !selected.includes(entry.kind));
    if (entries.length === 0) break;
    const picked = weightedPick(state, entries);
    selected.push(picked.kind);
    state = picked.state;
  }
  return {
    ...state,
    choices: selected.map((kind, index) => makeChoice(state, nextFloor, kind, index)),
  };
}

export function createRunState(options: CreateRunStateOptions): RunState {
  const seed = requireInteger(options.seed, 'seed', 0, UINT32_MAX) >>> 0;
  const actCount = requireInteger(options.actCount ?? 3, 'actCount', 1, 9);
  const floorsPerAct = requireInteger(options.floorsPerAct ?? 10, 'floorsPerAct', 4, 99);
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
  };
  return generateRunChoices(state);
}

export function enterRunNode(input: RunState, choiceId: string): RunState {
  if (input.phase !== 'awaiting_choice' || input.currentNode) throw new Error('run is not awaiting a route choice');
  const choice = input.choices.find(entry => entry.id === choiceId);
  if (!choice) throw new Error(`unknown run choice: ${choiceId}`);
  if (choice.act !== input.act || choice.floor !== input.floor + 1) throw new Error('run choice is stale');
  return { ...input, phase: 'in_node', currentNode: { ...choice }, choices: [] };
}

/** Return the active node or fail before a host mutates node-specific state. */
export function requireActiveRunNode(input: RunState, kind?: RunNodeKind): RunNodeChoice {
  if (input.phase !== 'in_node' || !input.currentNode) throw new Error('run has no active node');
  if (kind !== undefined && input.currentNode.kind !== kind) throw new Error(`run is not at a ${kind} node`);
  return input.currentNode;
}

export function completeRunNode(input: RunState, options: CompleteRunNodeOptions): RunState {
  const current = requireActiveRunNode(input);
  const gold = clampGold(input.gold + (options.goldDelta ?? 0));
  if (options.outcome === 'failed') return { ...input, gold, phase: 'lost', choices: [] };
  if (options.outcome === 'escaped') {
    return generateRunChoices({
      ...input,
      gold,
      phase: 'awaiting_choice',
      currentNode: null,
      choices: [],
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
  });
}

export function spendRunGold(input: RunState, amount: number): RunState {
  const cost = requireInteger(amount, 'amount', 0, MAX_GOLD);
  if (cost > input.gold) throw new Error('not enough run gold');
  return { ...input, gold: input.gold - cost };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNodeChoice(value: unknown): value is RunNodeChoice {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 96 &&
    RUN_NODE_KINDS.includes(value.kind as RunNodeKind) &&
    Number.isInteger(value.act) &&
    Number.isInteger(value.floor) &&
    [0, 1, 2, 3].includes(value.danger as number)
  );
}

/** Strict reader for adapters restoring RunState from MUV, a website, or a Mod save. */
export function validateRunState(value: unknown): RunStateValidationResult {
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

  const phase = value.phase as RunPhase;
  const choices = value.choices as RunNodeChoice[];
  const currentNode = value.currentNode as RunNodeChoice | null;
  if (new Set(choices.map(choice => choice.id)).size !== choices.length || choices.length > 3) {
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
    if (
      currentNode ||
      choices.length > 0 ||
      value.act !== value.actCount ||
      value.floor !== value.floorsPerAct
    ) {
      return { ok: false, message: 'run victory state is inconsistent' };
    }
  }
  if (phase === 'lost' && (!currentNode || choices.length > 0)) {
    return { ok: false, message: 'run defeat state is inconsistent' };
  }
  return { ok: true, value: value as unknown as RunState };
}
