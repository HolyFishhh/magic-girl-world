import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from 'parse5';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { createRunState } = require('../src/game-core/runState.ts');
const { isLockedTowerMapRun } = require('../src/common/towerMapMode.ts');

const mapRun = createRunState({ seed: 20260830 });
const tower = {
  game_mode: 'tower',
  game_mode_lock: { schemaVersion: 1, mode: 'tower' },
  run: mapRun,
};
assert.equal(isLockedTowerMapRun(tower, mapRun), true);

const story = {
  game_mode: 'story',
  game_mode_lock: { schemaVersion: 1, mode: 'story' },
  run: mapRun,
};
assert.equal(isLockedTowerMapRun(story, mapRun), false, 'story mode must retain its established common UI');
assert.equal(
  isLockedTowerMapRun({ game_mode: 'tower', run: mapRun }, mapRun),
  false,
  'an unlocked save must not silently switch to the tower map',
);

const legacyRun = createRunState({ seed: 91, routeMode: 'legacy-window', floorsPerAct: 8 });
assert.equal(
  isLockedTowerMapRun({ game_mode_lock: { schemaVersion: 1, mode: 'tower' }, run: legacyRun }, legacyRun),
  false,
  'legacy-window routes must retain the old route buttons',
);

const html = readFileSync('src/common/index.html', 'utf8');
const tree = parse(html);
const nodes = [];
const visit = node => {
  nodes.push(node);
  for (const child of node.childNodes ?? []) visit(child);
};
visit(tree);
const towerRoot = nodes.find(
  node =>
    node.tagName === 'div' &&
    node.attrs?.some(attribute => attribute.name === 'id' && attribute.value === 'tower-map-root'),
);
assert.ok(towerRoot, 'common HTML should reserve one tower map mount point');
const towerPanelRoot = nodes.find(
  node =>
    node.tagName === 'div' &&
    node.attrs?.some(attribute => attribute.name === 'id' && attribute.value === 'tower-node-panel-root'),
);
assert.ok(towerPanelRoot, 'common HTML should reserve one tower node panel mount point');

const commonSource = readFileSync('src/common/index.ts', 'utf8');
const hostSource = readFileSync('src/common/runActionHost.ts', 'utf8');
const styleSource = readFileSync('src/common/index.scss', 'utf8');
assert.match(commonSource, /mountTowerApp/);
assert.match(commonSource, /renderTowerNodePanel/);
assert.match(commonSource, /isLockedTowerMapRun\(stat, run\)/);
assert.match(commonSource, /classList\.toggle\('has-tower-rewards', lockedTowerMap && hasRewards\)/);
assert.match(commonSource, /runActionHost\.activateTowerRunNode\(node\.id\)/);
assert.doesNotMatch(commonSource, /enterTowerRunNode\(node, routePrompt\(node\)\)/);
assert.match(commonSource, /runActionHost\.retryTowerNodeGeneration\(nodeId\)/);
assert.match(
  commonSource,
  /run\.act === 1 && run\.floor === 0 && run\.phase === 'awaiting_choice'/,
  'initial content readiness must only gate the beginning of Act 1, not later-act floor zero maps',
);
assert.doesNotMatch(
  commonSource,
  /openingResolved\s*&&[\s\S]{0,180}!__IS_SENDING_ACTION/,
  'a busy root may block pointer input, but the freshly rendered map must retain its callbacks for unlock',
);
assert.match(
  commonSource,
  /async function activateTowerNode[\s\S]*?finally\s*\{[\s\S]*?setSendingState\(false\);[\s\S]*?setRunButtonsDisabled\(false\);/,
  'successful map activation must always release its visible interaction lock',
);
assert.match(
  commonSource,
  /await runActionHost\.requestRestUpgrade\(node, card\);[\s\S]*?await loadGameData\(\);/,
  'AI-generated campfire upgrades must settle immediately in the owning iframe',
);
assert.match(
  commonSource,
  /await runActionHost\.requestRestTransform\(node, card\);[\s\S]*?await loadGameData\(\);/,
  'AI-generated campfire transforms must settle immediately in the owning iframe',
);
assert.match(hostSource, /enterTowerRunNodeInStat/);
assert.match(hostSource, /activateTowerNodeInStat/);
assert.match(hostSource, /retryTowerNodeGenerationInStat/);
assert.match(styleSource, /\.run-section\.has-tower-map/);
assert.match(
  styleSource,
  /\.run-section\.has-tower-map\.has-tower-rewards \.tower-map-common-host\s*\{[\s\S]*display:\s*none\s*!important/,
  'tower rewards must temporarily collapse the long route map so every reward remains reachable in Tavern Helper',
);
assert.match(styleSource, /\.tower-map-common-host\.is-busy/);
assert.match(styleSource, /\.tower-node-panel/);

console.log('common tower map mode boundary and source integration tests passed');
