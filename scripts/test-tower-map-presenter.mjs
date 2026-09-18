import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const runState = require('../src/game-core/runState.ts');
const presenter = require('../src/tower/towerMapPresenter.ts');
const adapter = require('../src/runtime/towerStateAdapter.ts');

const initial = runState.createRunState({ seed: 0x5a17, startingGold: 123 });
const view = presenter.createTowerMapPresentation(initial, { difficultyPercent: 80, playerHp: 57, playerMaxHp: 80 });

assert.equal(view.mapError, '');
assert.equal(view.actTabs.length, 3, 'the presenter should expose all three acts');
assert.equal(view.selectedAct, 1);
assert.equal(view.chapterLabel, '第 1 幕');
assert.equal(view.goldLabel, '123');
assert.equal(view.playerHpLabel, '57/80');
assert.equal(initial.gold, 123, 'live HUD values must not mutate the saved route snapshot');
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

// The map preview follows the same complete preparation window as the queue:
// non-combat layers may extend beyond the immediately reachable frontier, while
// a combat node stops every deeper branch. Current/visited nodes never leak text.
const windowPreview = structuredClone(initial);
for (const node of windowPreview.map.nodes) if (node.act === windowPreview.act) node.kind = 'rest';
for (const act of windowPreview.map.acts) {
  if (act.act !== windowPreview.act) continue;
  for (const node of act.nodes) node.kind = 'rest';
}
const previewWindow = adapter.collectTowerPreparationWindow(windowPreview);
assert.ok(previewWindow.length > initial.choices.length, 'the fixture must exercise a non-combat extension');
for (const target of previewWindow) {
  windowPreview.nodeContent[target.nodeId] = {
    ...windowPreview.nodeContent[target.nodeId],
    phase: 'ready',
    content: { title: `地点-${target.nodeId}`, narrative: `预览剧情-${target.nodeId}` },
  };
}
const windowView = presenter.createTowerMapPresentation(windowPreview);
for (const target of previewWindow) {
  const node = windowView.nodes.find(candidate => candidate.node.id === target.nodeId);
  assert.ok(node?.inPreparationWindow, `window marker missing for ${target.nodeId}`);
  if (node.routeState !== 'reachable') assert.equal(node.narrative, '', 'locked and visited rooms do not expose prepared prose');
  else if (node.node.kind === 'event') assert.ok(node.narrative === '未知遭遇，进入后揭晓' || node.narrative.startsWith('预览剧情-'));
  else if (node.node.kind === 'rest') assert.equal(node.narrative, '', 'campfires never expose map narrative');
  else assert.equal(node.narrative, `预览剧情-${target.nodeId}`);
}
const idleNode = presenter.createTowerMapPresentation(initial).nodes.find(node => node.inPreparationWindow);
assert.equal(idleNode?.contentPhase, 'idle');
assert.equal(idleNode?.inPreparationWindow, true);

const laterPreparedTarget = previewWindow.find(target => target.depth > 1);
assert.ok(laterPreparedTarget, 'the fixture must contain a prepared node after the immediate choices');
const laterPreparedNode = windowView.nodes.find(node => node.node.id === laterPreparedTarget.nodeId);
assert.equal(laterPreparedNode?.routeState, 'locked', 'a prepared later room remains behind its route predecessor');
assert.equal(laterPreparedNode?.contentPhase, 'ready');
assert.equal(laterPreparedNode?.interactive, false, 'lookahead readiness must not permit skipping the live choices');
assert.match(laterPreparedNode?.ariaLabel || '', /当前不可达/);

const staleChoiceSnapshot = structuredClone(initial);
staleChoiceSnapshot.choices = staleChoiceSnapshot.choices.map(choice => ({ ...choice, floor: choice.floor + 1 }));
const staleChoiceView = presenter.createTowerMapPresentation(staleChoiceSnapshot);
assert.equal(
  staleChoiceView.nodes.some(node => node.routeState === 'reachable'),
  false,
  'only live next-floor map choices may be rendered as reachable',
);

const hiddenEventPreview = structuredClone(windowPreview);
const hiddenEventId = hiddenEventPreview.choices[0].id;
for (const node of hiddenEventPreview.map.nodes) if (node.id === hiddenEventId) { node.kind = 'event'; node.mystery = { kind: 'battle' }; }
for (const act of hiddenEventPreview.map.acts) for (const node of act.nodes) if (node.id === hiddenEventId) { node.kind = 'event'; node.mystery = { kind: 'battle' }; }
hiddenEventPreview.nodeContent[hiddenEventId] = { ...hiddenEventPreview.nodeContent[hiddenEventId], phase: 'ready', content: { narrative: '绝不能泄漏的真实遭遇' } };
const hiddenEventNode = presenter.createTowerMapPresentation(hiddenEventPreview).nodes.find(node => node.node.id === hiddenEventId);
assert.equal(hiddenEventNode?.narrative, '未知遭遇，进入后揭晓', 'hidden event previews must stay generic');
assert.doesNotMatch(hiddenEventNode?.narrative || '', /绝不能泄漏/);

const mixedCombat = structuredClone(initial);
const combatId = mixedCombat.choices[0].id;
for (const node of mixedCombat.map.nodes) if (node.id === combatId) node.kind = 'battle';
for (const act of mixedCombat.map.acts) for (const node of act.nodes) if (node.id === combatId) node.kind = 'battle';
const mixedWindow = adapter.collectTowerPreparationWindow(mixedCombat);
assert.ok(mixedWindow.length > 0 && mixedWindow.every(target => target.depth === 1), 'combat frontier must stop all deeper previews');

const actTwo = presenter.createTowerMapPresentation(initial, { selectedAct: 2, difficultyPercent: 80 });
assert.equal(actTwo.selectedAct, 2);
assert.equal(actTwo.difficultyLabel, '86%（基础 80%）');
assert.equal(
  actTwo.nodes.every(node => node.routeState === 'locked'),
  true,
);

const selected = initial.choices[0];
const previewState = structuredClone(initial);
previewState.nodeContent[selected.id] = { ...previewState.nodeContent[selected.id], phase: 'ready', content: { narrative: '石门后传来金属摩擦声。' } };
assert.equal(presenter.createTowerMapPresentation(previewState).nodes.find(node => node.node.id === selected.id).narrative, '石门后传来金属摩擦声。');
const previewEntered = runState.enterRunNode(previewState, selected.id);
assert.equal(presenter.createTowerMapPresentation(previewEntered).nodes.find(node => node.node.id === selected.id).narrative, '', 'past/current nodes do not retain frontier preview bubbles');
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
