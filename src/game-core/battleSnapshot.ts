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

function hasBattlePrecision(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

function hasValidCombatNumbers(entity: Record<string, any>): boolean {
  const { maxHp, currentHp, maxLust, currentLust, energy, maxEnergy, block } = entity;
  return (
    hasBattlePrecision(maxHp) &&
    maxHp > 0 &&
    hasBattlePrecision(currentHp) &&
    currentHp >= 0 &&
    currentHp <= maxHp &&
    hasBattlePrecision(maxLust) &&
    maxLust > 0 &&
    hasBattlePrecision(currentLust) &&
    currentLust >= 0 &&
    currentLust <= maxLust &&
    isFiniteNumber(energy) &&
    Number.isInteger(energy) &&
    energy >= 0 &&
    isFiniteNumber(maxEnergy) &&
    Number.isInteger(maxEnergy) &&
    maxEnergy >= 0 &&
    hasBattlePrecision(block) &&
    block >= 0
  );
}

function hasValidCombatResources(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).length > 16) return false;
  return Object.entries(value).every(([id, raw]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || id === 'energy' || !isRecord(raw)) return false;
    return (
      raw.id === id &&
      typeof raw.name === 'string' && raw.name.trim().length > 0 &&
      typeof raw.emoji === 'string' && raw.emoji.trim().length > 0 &&
      Number.isInteger(raw.current) && raw.current >= 0 &&
      Number.isInteger(raw.max) && raw.max > 0 && raw.current <= raw.max &&
      (raw.refresh === 'reset' || raw.refresh === 'retain')
    );
  });
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

  const livingEnemies = Array.isArray(state.enemies) && state.enemies.length > 0
    ? state.enemies
    : state.enemy
      ? [state.enemy]
      : [];
  const enemies = [...livingEnemies, ...(Array.isArray(state.defeatedEnemies) ? state.defeatedEnemies : [])];
  for (const enemy of enemies) {
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
  if (!hasValidCombatResources(state.player.resources)) return null;
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
  if (state.battleHistory !== undefined) {
    if (!Array.isArray(state.battleHistory) || state.battleHistory.length > 600) return null;
    for (const entry of state.battleHistory) {
      if (!isRecord(entry) || !Number.isInteger(entry.turn) || entry.turn < 0 || typeof entry.message !== 'string')
        return null;
    }
  }
  if (state.random !== undefined && !isBattleRandomState(state.random)) return null;
  if (state.enemies !== undefined && !Array.isArray(state.enemies)) return null;
  if (state.defeatedEnemies !== undefined && !Array.isArray(state.defeatedEnemies)) return null;
  const enemies = Array.isArray(state.enemies) && state.enemies.length > 0
    ? state.enemies
    : state.enemy
      ? [state.enemy]
      : [];
  const enemyIds = new Set<string>();
  for (const enemy of enemies) {
    if (!isRecord(enemy) || !hasValidCombatNumbers(enemy)) return null;
    if (!hasValidCombatResources(enemy.resources)) return null;
    if (typeof enemy.id !== 'string' || typeof enemy.name !== 'string' || enemyIds.has(enemy.id)) return null;
    enemyIds.add(enemy.id);
    if (!Array.isArray(enemy.statusEffects) || !Array.isArray(enemy.actions)) return null;
    if (enemy.abilities !== undefined && !Array.isArray(enemy.abilities)) return null;
  }
  const activeEnemyIds = new Set(enemyIds);
  for (const enemy of state.defeatedEnemies || []) {
    if (!isRecord(enemy) || !hasValidCombatNumbers(enemy) || enemy.currentHp > 0) return null;
    if (!hasValidCombatResources(enemy.resources)) return null;
    if (typeof enemy.id !== 'string' || typeof enemy.name !== 'string' || enemyIds.has(enemy.id)) return null;
    enemyIds.add(enemy.id);
    if (!Array.isArray(enemy.statusEffects) || !Array.isArray(enemy.actions)) return null;
    if (enemy.abilities !== undefined && !Array.isArray(enemy.abilities)) return null;
  }
  if (state.activeEnemyId !== undefined && state.activeEnemyId !== null && !activeEnemyIds.has(state.activeEnemyId)) return null;
  if (!hasValidRuntimeContent(state)) return null;

  return value as unknown as BattleSessionSnapshot;
}

export function canRestoreBattleSession(
  snapshot: BattleSessionSnapshot | null,
  fingerprint: string,
): snapshot is BattleSessionSnapshot {
  return snapshot !== null && snapshot.fingerprint === fingerprint;
}
