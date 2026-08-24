import { createContentPackFingerprint, isContentPack, type ContentPack } from './contentPack';
import { formatContentContractIssues, validateContentPackContract, type ContentContractIssue } from './contentContract';
import { stableHash32 } from './deterministicRandom';
import type { BattleEndResult } from './battleTerminal';
import { normalizeRunPacingContext, type RunPacingContext } from './runPacing';

export const BATTLE_REQUEST_SCHEMA_VERSION = 1 as const;
export const BATTLE_RESULT_SCHEMA_VERSION = 1 as const;

export interface BattleRouteContext extends RunPacingContext {
  nodeId: string;
}

export interface BattleRequest {
  schemaVersion: typeof BATTLE_REQUEST_SCHEMA_VERSION;
  content: ContentPack;
  player: {
    hp: number;
    maxHp: number;
    lust: number;
    maxLust: number;
    level: number;
  };
  route: BattleRouteContext | null;
  seed: number;
}

export interface BattleResult {
  schemaVersion: typeof BATTLE_RESULT_SCHEMA_VERSION;
  outcome: BattleEndResult;
  player: { hp: number; lust: number };
  items: Array<{ id: string; count: number }>;
  turns: number;
  route: { nodeId: string; outcome: 'cleared' | 'failed' | 'escaped' } | null;
}

export class BattleContentContractError extends Error {
  readonly issues: ContentContractIssue[];

  constructor(issues: readonly ContentContractIssue[]) {
    super(`battle content contract is invalid: ${formatContentContractIssues(issues)}`);
    this.name = 'BattleContentContractError';
    this.issues = issues.map(issue => ({ ...issue }));
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function normalizeRoute(value: unknown): BattleRouteContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const route = value as Record<string, unknown>;
  const context = normalizeRunPacingContext({ ...route, nodeId: route.nodeId ?? route.id });
  const nodeId = String(route.nodeId ?? route.id ?? '');
  if (!context || !nodeId || nodeId.length > 96) return null;
  return { ...context, nodeId };
}

export function deriveBattleSeed(content: ContentPack, route: BattleRouteContext | null, runSeed = 0): number {
  return stableHash32([runSeed >>> 0, route, createContentPackFingerprint(content)]);
}

export function createBattleRequest(input: {
  content: ContentPack;
  player: BattleRequest['player'];
  route?: unknown;
  runSeed?: number;
  seed?: number;
}): BattleRequest {
  if (!isContentPack(input.content)) throw new Error('battle content pack is invalid');
  const contentContract = validateContentPackContract(input.content, { requireEnemy: true, requireExecutable: true });
  if (!contentContract.ok) throw new BattleContentContractError(contentContract.issues);
  const maxHp = Math.max(1, finite(input.player.maxHp, 1));
  const maxLust = Math.max(1, finite(input.player.maxLust, 1));
  const route = normalizeRoute(input.route);
  const seed = input.seed === undefined ? deriveBattleSeed(input.content, route, input.runSeed) : input.seed;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('battle seed is invalid');
  return {
    schemaVersion: BATTLE_REQUEST_SCHEMA_VERSION,
    content: input.content,
    player: {
      hp: Math.min(maxHp, Math.max(0, finite(input.player.hp, maxHp))),
      maxHp,
      lust: Math.min(maxLust, Math.max(0, finite(input.player.lust, 0))),
      maxLust,
      level: positiveInteger(input.player.level, 1),
    },
    route,
    seed: seed >>> 0,
  };
}

export function createBattleResult(input: {
  request: BattleRequest;
  outcome: BattleResult['outcome'];
  player: { hp: unknown; lust: unknown };
  items?: ReadonlyArray<{ id: unknown; count: unknown }>;
  turns: unknown;
}): BattleResult {
  const outcome = input.outcome;
  if (!['victory', 'defeat', 'terminated'].includes(outcome)) throw new Error('battle outcome is invalid');
  const routeOutcome = outcome === 'victory' ? 'cleared' : outcome === 'defeat' ? 'failed' : 'escaped';
  return {
    schemaVersion: BATTLE_RESULT_SCHEMA_VERSION,
    outcome,
    player: {
      hp: Math.min(input.request.player.maxHp, Math.max(0, finite(input.player.hp, 0))),
      lust: Math.min(input.request.player.maxLust, Math.max(0, finite(input.player.lust, 0))),
    },
    items: (input.items || [])
      .filter(item => typeof item.id === 'string' && item.id.length > 0 && Number.isInteger(item.count))
      .map(item => ({ id: String(item.id), count: Math.max(0, Number(item.count)) })),
    turns: Math.max(0, Math.floor(finite(input.turns, 0))),
    route: input.request.route ? { nodeId: input.request.route.nodeId, outcome: routeOutcome } : null,
  };
}
