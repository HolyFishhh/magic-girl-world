import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { BattleLog } = require(resolve('src/fish/modules/battleLog.ts'));

BattleLog.entries = Array.from({ length: 96 }, (_, index) => ({
  turn: index + 1,
  type: 'info',
  message: `事件${index + 1}`,
}));

const complete = BattleLog.buildNarrativeReport();
assert.match(complete, /第1回合 事件1/);
assert.match(complete, /第96回合 事件96/);
assert.equal(complete.split('\n').length, 96, 'post-battle prompt must keep the full battle log');

const bounded = BattleLog.buildNarrativeReport(12);
assert.doesNotMatch(bounded, /第84回合/);
assert.match(bounded, /第85回合 事件85/);
assert.equal(bounded.split('\n').length, 12);

BattleLog.entries = [
  { turn: 1, type: 'action', message: '玩家卡牌: 使用了卡牌星击', actor: 'player', actionName: '星击' },
  { turn: 1, type: 'action', message: '玩家卡牌: 使用了卡牌星击', actor: 'player', actionName: '星击' },
  { turn: 1, type: 'damage', message: '星击造成6点伤害' },
  { turn: 1, type: 'action', message: '敌人使用了挥砍', actor: 'enemy', actionName: '挥砍' },
  { turn: 1, type: 'action', message: '后排术士使用了咒击', actor: 'enemy', actorId: 'rear_mage', actorName: '后排术士', actionName: '咒击' },
  { turn: 1, type: 'action', message: '遗物触发：星环', source: { type: 'relic', name: '星环' } },
  { turn: 1, type: 'action', message: '能力触发：追击', source: { type: 'ability', name: '追击' } },
  { turn: 1, type: 'action', message: '能力触发：追击', source: { type: 'ability', name: '追击' } },
  { turn: 1, type: 'action', message: '状态触发：燃烧', source: { type: 'status', name: '燃烧' } },
  { turn: 2, type: 'action', message: '玩家卡牌: 使用了卡牌终结', actor: 'player', actionName: '终结' },
];
const turns = BattleLog.buildTurnSummaryReport();
assert.match(turns, /回合1：玩家使用：星击×2；敌人使用：挥砍、后排术士：咒击；触发：遗物“星环”、能力“追击”×2、状态“燃烧”/);
assert.match(turns, /回合2：玩家使用：终结；敌人使用：无/);
assert.doesNotMatch(turns, /6点伤害/);

console.log('Battle logs keep diagnostics while producing compact per-turn story summaries.');
