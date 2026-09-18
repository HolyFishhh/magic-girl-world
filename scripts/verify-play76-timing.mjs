import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Historical live UI evidence for installed142a, not generation-rate acceptance.
const read = label => JSON.parse(readFileSync(`tmp/play76-${label}.json`, 'utf8'));
const labels = ['battle-start', 'borrowed-played', 'ward-played', 'turn2-start', 'echo-played', 'first-skill', 'second-skill', 'turn3-start', 'turn3-first-skill'];
const captures = labels.map(read);
for (const capture of captures) {
  assert.equal(capture.chatId, captures[0].chatId);
  assert.equal(capture.swipeId, captures[0].swipeId);
  assert.equal(capture.message, captures[0].message);
}
const states = captures.map(c => c.root.__magic_girl_world.battle_session.state);
const [start, borrowed, ward, turn2, echo, first, second, turn3, reset] = states;
assert.equal(start.currentTurn, 1);
assert.equal(start.player.block, 0);
assert.equal(borrowed.player.block, 5);
assert.deepEqual(borrowed.effectScheduler.queue.map(q => [q.dueTurn, q.phase]), [[2, 'turn_end']]);
assert.deepEqual(ward.effectScheduler.queue.map(q => [q.dueTurn, q.phase]), [[2, 'turn_start'], [2, 'turn_end']]);
assert.equal(turn2.currentTurn, 2);
assert.equal(turn2.player.block, 8);
assert.deepEqual(turn2.effectScheduler.queue.map(q => [q.dueTurn, q.phase]), [[2, 'turn_end']]);
assert.equal(echo.player.block, 8, 'playing the Power is not playing a Skill');
assert.equal(echo.player.abilities[0].eventQuery.ordinal, 'first');
assert.equal(echo.player.abilities[0].eventQuery.scope, 'turn');
assert.equal(first.player.block, 17, '8 + borrowed5 + firstSkill4');
assert.equal(second.player.block, 17, 'second Skill must not repeat benefit');
const echoTriggers = s => s.battleHistory.filter(h => h.message === '能力触发：时序回响').length;
assert.equal(echoTriggers(second), 1);
assert.ok(turn3.battleHistory.some(h => h.turn === 2 && h.message === '借时-玩家的格挡增加5点，当前22'));
assert.equal(turn3.currentTurn, 3);
assert.equal(turn3.player.block, 8);
assert.equal(reset.player.block, 17);
assert.equal(echoTriggers(reset), 2, 'first-Skill eligibility resets next turn');
console.log('PASS sample76 live UI: both delayed phases execute; first Skill once per turn and resets. Not full battle, reload, or overall acceptance.');
