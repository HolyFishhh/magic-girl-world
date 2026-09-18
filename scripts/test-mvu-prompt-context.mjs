import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  buildSecondStageSemanticMvuContext,
  composeSecondStageMvuPrompt,
} = require(resolve('src/sillytavern-extension/mvuPromptContext.ts'));
const { injectDesignContext } = require(resolve('src/sillytavern-extension/promptInjection.ts'));

const recentLog = Array.from({ length: 30 }, (_, index) => ({ index }));
const storyVariables = {
  stat_data: {
    game_mode: 'story',
    status: {
      time: '122年04月17日 21:40',
      location: '灰烬熔炉工坊',
      profession: { name: '冒险者', ability: '弃牌加护' },
      inventory: ['委托书'],
    },
    npcs: { bai_ya: { name: '白鸦', relation: '锻刀委托' } },
    factions: { smiths: { name: '铁匠协会' } },
    battle: {
      cards: [{ id: 'light_blade', name: '光刃', quantity: 4, effects: { damage: 6 } }],
      enemy: { id: 'vine', name: '魔藤花', hp: 55 },
      statuses: [{ id: 'focus', name: '专注', stacks: 2 }],
      design_context: { duplicated: true },
      lineage_memory: { duplicated: true },
    },
    run_transaction_log: recentLog,
  },
};

const storyContext = buildSecondStageSemanticMvuContext(storyVariables);
assert.equal(storyContext.spec, 'mwg.second-stage-semantic-mvu/v1');
assert.equal(storyContext.stat_data.status.location, '灰烬熔炉工坊');
assert.equal(storyContext.stat_data.npcs.bai_ya.name, '白鸦');
assert.equal(storyContext.stat_data.factions.smiths.name, '铁匠协会');
assert.equal(storyContext.stat_data.battle.cards[0].id, 'light_blade');
assert.equal(storyContext.stat_data.battle.enemy.name, '魔藤花');
assert.equal(storyContext.stat_data.battle.statuses[0].stacks, 2);
assert.equal('design_context' in storyContext.stat_data.battle, false);
assert.equal('lineage_memory' in storyContext.stat_data.battle, false);
assert.deepEqual(storyContext.stat_data.run_transaction_log.map(entry => entry.index), recentLog.slice(-24).map(entry => entry.index));
assert.equal(storyVariables.stat_data.battle.design_context.duplicated, true, 'semantic projection must not mutate MVU');

const storyPrompt = composeSecondStageMvuPrompt(storyVariables, '卡组评分仅供设计参考');
assert.match(storyPrompt, /当前 MVU 游戏事实/);
assert.match(storyPrompt, /灰烬熔炉工坊/);
assert.match(storyPrompt, /白鸦/);
assert.match(storyPrompt, /light_blade/);
assert.match(storyPrompt, /程序辅助建议/);
assert.match(storyPrompt, /正常推理能力/);
assert.match(storyPrompt, /同时读取本轮剧情与这些事实/);

const requestWithCurrentStory = {
  messages: [
    { role: 'system', content: 'MVU 原始变量输出契约' },
    { role: 'user', content: '本轮剧情片段：白鸦把锻好的刀递给玩家，玩家接过了刀。' },
  ],
};
assert.equal(injectDesignContext(requestWithCurrentStory, storyPrompt), true);
assert.equal(requestWithCurrentStory.messages.length, 3);
assert.equal(requestWithCurrentStory.messages[1].role, 'system');
assert.match(requestWithCurrentStory.messages[1].content, /当前 MVU 游戏事实/);
assert.deepEqual(
  requestWithCurrentStory.messages[2],
  { role: 'user', content: '本轮剧情片段：白鸦把锻好的刀递给玩家，玩家接过了刀。' },
  'semantic MVU injection must preserve the current story fragment byte-for-byte as the final task',
);

const nodeContent = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [
  `node-${index + 1}`,
  { nodeId: `node-${index + 1}`, title: `节点${index + 1}` },
]));
const towerVariables = {
  stat_data: {
    game_mode: 'tower',
    game_mode_lock: { mode: 'tower' },
    status: {
      time: '第一幕',
      location: '星塔',
      profession: { name: '唤灵师' },
      appearance: { ignoredInTowerPrompt: true },
    },
    npcs: { transient: { name: '不会进入爬塔提示' } },
    factions: { transient: { name: '不会进入爬塔提示' } },
    reward: { request: { id: 'runtime-only' } },
    battle: {
      cards: [{ id: 'summon_sprite', name: '召唤星灵', quantity: 2, effects: { spawn_summon: { id: 'sprite' } } }],
      statuses: [{ id: 'echo', name: '回响', stacks: 1 }],
    },
    run: {
      schemaVersion: 'mwg.run-state/v1',
      phase: 'map',
      act: 1,
      actCount: 3,
      floor: 5,
      floorsPerAct: 15,
      currentNode: { id: 'node-5', kind: 'enemy' },
      choices: ['node-6'],
      gold: 88,
      nodeCounts: { enemy: 3 },
      lastNodeKind: 'enemy',
      visitedNodeIds: ['node-1', 'node-2', 'node-3', 'node-4'],
      nodeContent,
      stateRevision: 9,
    },
  },
};

const towerContext = buildSecondStageSemanticMvuContext(towerVariables);
assert.equal(towerContext.spec, 'mwg.tower-semantic-mvu/v1');
assert.equal(towerContext.stat_data.status.location, '星塔');
assert.equal('appearance' in towerContext.stat_data.status, false);
assert.equal('npcs' in towerContext.stat_data, false);
assert.equal('factions' in towerContext.stat_data, false);
assert.equal('reward' in towerContext.stat_data, false);
assert.equal(towerContext.stat_data.battle.cards[0].id, 'summon_sprite');
assert.deepEqual(Object.keys(towerContext.stat_data.run.recentNodeContent).sort(), ['node-2', 'node-3', 'node-4', 'node-5']);
assert.equal('nodeContent' in towerContext.stat_data.run, false);

assert.equal(composeSecondStageMvuPrompt({}, 'unused'), null);
console.log('MVU second-stage prompts preserve semantic story/tower facts and optional design advice.');
