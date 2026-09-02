import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const runState = require('../src/game-core/runState.ts');
const presenter = require('../src/tower/towerMapPresenter.ts');

const initial = runState.createRunState({ seed: 0x5a17, startingGold: 123 });
const view = presenter.createTowerMapPresentation(initial, { difficultyPercent: 80 });

assert.equal(view.mapError, '');
assert.equal(view.actTabs.length, 3, 'the presenter should expose all three acts');
assert.equal(view.selectedAct, 1);
assert.equal(view.chapterLabel, '第 1 幕');
assert.equal(view.goldLabel, '123');
assert.equal(view.difficultyLabel, '80%（基础 80%）');
assert.equal(view.nodes.length, initial.map.acts[0].nodes.length);
assert.equal(view.nodes.filter(node => node.node.floor === 16).length, 1);
assert.ok(view.nodes.filter(node => node.routeState === 'reachable').length > 0);
assert.deepEqual(
  view.nodes
    .filter(node => node.routeState === 'reachable')
    .map(node => node.node.id)
    .sort(),
  initial.choices.map(choice => choice.id).sort(),
);
assert.ok(view.nodes.every(node => node.ariaLabel.includes(`第${node.node.floor}层`)));

const actTwo = presenter.createTowerMapPresentation(initial, { selectedAct: 2, difficultyPercent: 80 });
assert.equal(actTwo.selectedAct, 2);
assert.equal(actTwo.difficultyLabel, '86%（基础 80%）');
assert.equal(
  actTwo.nodes.every(node => node.routeState === 'locked'),
  true,
);

const selected = initial.choices[0];
const entered = runState.enterRunNode(initial, selected.id);
const activeView = presenter.createTowerMapPresentation(entered);
assert.equal(activeView.currentNodeId, selected.id);
assert.equal(activeView.nodes.find(node => node.node.id === selected.id).routeState, 'current');

const completed = runState.completeRunNode(entered, { outcome: 'cleared', goldDelta: 7 });
const completedView = presenter.createTowerMapPresentation(completed);
assert.equal(completedView.currentNodeId, selected.id, 'the last cleared node remains the map position');
assert.equal(completedView.nodes.find(node => node.node.id === selected.id).routeState, 'current');
assert.equal(completedView.goldLabel, '130');
assert.ok(completedView.nodes.some(node => node.routeState === 'reachable'));

const failedChoice = completed.choices[0];
const failedSnapshot = structuredClone(completed);
failedSnapshot.nodeContent[failedChoice.id].phase = 'failed';
failedSnapshot.nodeContent[failedChoice.id].error = '测试生成失败';
const failedView = presenter.createTowerMapPresentation(failedSnapshot);
const failedNode = failedView.nodes.find(node => node.node.id === failedChoice.id);
assert.equal(failedNode.contentPhase, 'failed');
assert.equal(failedNode.interactive, false);
assert.equal(failedNode.error, '测试生成失败');
assert.equal(failedView.failedNodes.length, 1);

const legacy = runState.createRunState({ seed: 4, routeMode: 'legacy-window', floorsPerAct: 10 });
const legacyView = presenter.createTowerMapPresentation(legacy);
assert.match(legacyView.mapError, /尚未生成完整/);
assert.equal(legacyView.nodes.length, 0);

console.log('tower map presenter tests passed');
