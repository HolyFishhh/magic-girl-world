import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

const path = resolve('src/game-core/turnState.ts');
const source = await readFile(path, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const turns = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const player = {
  currentTurn: 1,
  cardsPlayedThisTurn: 3,
  attacksPlayedThisTurn: 2,
  skillsPlayedThisTurn: 1,
  phase: 'player_turn',
  isGameOver: false,
  marker: 'keep',
};
const enemy = turns.beginEnemyTurn(player);
assert.deepEqual(enemy, { ...player, phase: 'enemy_turn' });
assert.deepEqual(turns.advanceTurnCounter(enemy), { ...enemy, currentTurn: 2 });
assert.deepEqual(turns.beginPlayerTurn(turns.advanceTurnCounter(enemy)), {
  ...player,
  currentTurn: 2,
  cardsPlayedThisTurn: 0,
  attacksPlayedThisTurn: 0,
  skillsPlayedThisTurn: 0,
  phase: 'player_turn',
});
assert.equal(turns.beginEnemyTurn(enemy), enemy, 'enemy turn cannot be entered twice');

const terminal = { ...player, phase: 'game_over', isGameOver: true };
assert.equal(turns.beginPlayerTurn(terminal), terminal);
assert.equal(turns.advanceTurnCounter(terminal), terminal);

console.log('Portable turn-state transitions preserve phase guards and per-turn counters.');
