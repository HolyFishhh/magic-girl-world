import { isBattleRandomState, stableHash32, stableSerialize } from './deterministicRandom';
import { validateEffectProgram } from './effectDsl';
import type { GameState } from './battleState';

export const BATTLE_SESSION_SCHEMA_VERSION = 3 as const;

export interface BattleSessionSnapshot {
  schemaVersion: typeof BATTLE_SESSION_SCHEMA_VERSION;
  fingerprint: string;
  state: GameState;
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasValidCombatNumbers(entity: Record<string, any>): boolean {
  const { maxHp, currentHp, maxLust, currentLust, energy, maxEnergy, block } = entity;
  return (
    isFiniteNumber(maxHp) &&
    maxHp > 0 &&
    isFiniteNumber(currentHp) &&
    currentHp >= 0 &&
    currentHp <= maxHp &&
    isFiniteNumber(maxLust) &&
    maxLust > 0 &&
    isFiniteNumber(currentLust) &&
    currentLust >= 0 &&
    currentLust <= maxLust &&
    isFiniteNumber(energy) &&
    energy >= 0 &&
    isFiniteNumber(maxEnergy) &&
    maxEnergy >= 0 &&
    isFiniteNumber(block) &&
    block >= 0
  );
}

function hasValidRuntimeProgram(value: unknown, required = true): boolean {
  if (!isRecord(value)) return !required && (value === null || value === undefined);
  if (required && value.effectProgram === undefined) return false;
  if (value.effectProgram !== undefined && !validateEffectProgram(value.effectProgram).ok) return false;
  if (value.discardEffectProgram !== undefined && !validateEffectProgram(value.discardEffectProgram).ok) return false;
  return true;
}

function hasValidRuntimeContent(state: Record<string, any>): boolean {
  const player = state.player;
  const playerCollections = [
    player.deck,
    player.hand,
    player.drawPile,
    player.discardPile,
    player.exhaustPile,
    player.relics,
    player.items || [],
    player.abilities || [],
  ];
  if (playerCollections.some(collection => collection.some((value: unknown) => !hasValidRuntimeProgram(value)))) {
    return false;
  }

  const enemy = state.enemy;
  if (enemy) {
    if ([...(enemy.actions || []), ...(enemy.abilities || [])].some(value => !hasValidRuntimeProgram(value))) {
      return false;
    }
    if (!hasValidRuntimeProgram(enemy.nextAction, false)) return false;
    if (!hasValidRuntimeProgram(enemy.lustEffect)) return false;
  }
  return hasValidRuntimeProgram(state.battle?.player_lust_effect);
}

/** Create a stable identity for an AI content payload without reading host state. */
export function createBattleFingerprint(battleData: unknown): string {
  const serialized = stableSerialize(battleData);
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    second = Math.imul(second ^ serialized.charCodeAt(index), 0x85ebca6b);
  }
  return `v1:${stableHash32(serialized).toString(36)}:${(second >>> 0).toString(36)}:${serialized.length}`;
}

export function createBattleSessionSnapshot(
  fingerprint: string,
  state: GameState,
  savedAt: number,
): BattleSessionSnapshot {
  if (!Number.isFinite(savedAt) || savedAt < 0) throw new Error('battle snapshot timestamp is invalid');
  return {
    schemaVersion: BATTLE_SESSION_SCHEMA_VERSION,
    fingerprint,
    state: JSON.parse(JSON.stringify(state)) as GameState,
    savedAt,
  };
}

/** Strictly read one host-neutral snapshot value. Storage layout belongs to the host adapter. */
export function readBattleSessionSnapshot(value: unknown): BattleSessionSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== BATTLE_SESSION_SCHEMA_VERSION) return null;
  if (typeof value.fingerprint !== 'string' || typeof value.savedAt !== 'number') return null;

  const state = value.state;
  if (!isRecord(state) || !isRecord(state.player)) return null;
  if (!hasValidCombatNumbers(state.player)) return null;
  if (!isFiniteNumber(state.player.drawPerTurn) || state.player.drawPerTurn < 0) return null;
  if (!Array.isArray(state.player.deck)) return null;
  if (!Array.isArray(state.player.hand) || !Array.isArray(state.player.drawPile)) return null;
  if (!Array.isArray(state.player.discardPile) || !Array.isArray(state.player.exhaustPile)) return null;
  if (!Array.isArray(state.player.statusEffects) || !Array.isArray(state.player.relics)) return null;
  if (state.player.abilities !== undefined && !Array.isArray(state.player.abilities)) return null;
  if (state.player.items !== undefined && !Array.isArray(state.player.items)) return null;
  if (!Number.isInteger(state.currentTurn) || state.currentTurn < 0) return null;
  if (!Number.isInteger(state.cardsPlayedThisTurn) || state.cardsPlayedThisTurn < 0) return null;
  for (const counter of [state.attacksPlayedThisTurn, state.skillsPlayedThisTurn]) {
    if (!Number.isInteger(counter) || counter < 0) return null;
  }
  if (!['setup', 'player_turn', 'enemy_turn', 'game_over'].includes(state.phase)) return null;
  if (typeof state.isGameOver !== 'boolean') return null;
  if (!['ongoing', 'victory', 'defeat', 'terminated'].includes(state.battleResult)) {
    return null;
  }
  if (typeof state.battleNarrative !== 'string') return null;
  if (state.random !== undefined && !isBattleRandomState(state.random)) return null;
  if (state.enemy !== null) {
    if (!isRecord(state.enemy) || !hasValidCombatNumbers(state.enemy)) return null;
    if (typeof state.enemy.id !== 'string' || typeof state.enemy.name !== 'string') return null;
    if (!Array.isArray(state.enemy.statusEffects) || !Array.isArray(state.enemy.actions)) return null;
    if (state.enemy.abilities !== undefined && !Array.isArray(state.enemy.abilities)) return null;
  }
  if (!hasValidRuntimeContent(state)) return null;

  return value as unknown as BattleSessionSnapshot;
}

export function canRestoreBattleSession(
  snapshot: BattleSessionSnapshot | null,
  fingerprint: string,
): snapshot is BattleSessionSnapshot {
  return snapshot !== null && snapshot.fingerprint === fingerprint;
}
