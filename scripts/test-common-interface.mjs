import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'parse5';

const htmlSource = await readFile(resolve('src/common/index.html'), 'utf8');
const scriptSource = await readFile(resolve('src/common/index.ts'), 'utf8');
const styleSource = await readFile(resolve('src/common/index.scss'), 'utf8');
const battleScriptSource = await readFile(resolve('src/fish/index.ts'), 'utf8');
const battleShellSource = await readFile(resolve('src/fish/ui/battleShellPresenter.ts'), 'utf8');
const messageVariablesSource = await readFile(resolve('src/runtime/messageVariables.ts'), 'utf8');
const exportSource = await readFile(resolve('scripts/export-tavern-interface.mjs'), 'utf8');
const runPromptSource = await readFile(resolve('src/game-core/runPrompt.ts'), 'utf8');
const commonActionHostSource = await readFile(resolve('src/common/commonActionHost.ts'), 'utf8');
const runActionHostSource = await readFile(resolve('src/common/runActionHost.ts'), 'utf8');
const document = parse(htmlSource);
const nodes = [];
const visit = node => {
  nodes.push(node);
  node.childNodes?.forEach(visit);
};
visit(document);

const classes = node =>
  (node.attrs?.find(attribute => attribute.name === 'class')?.value || '').split(/\s+/).filter(Boolean);
const ids = nodes
  .flatMap(node => node.attrs || [])
  .filter(attribute => attribute.name === 'id')
  .map(attribute => attribute.value);
const requiredIds = [
  'custom-action-input',
  'custom-action-send',
  'choice-container',
  'choice-title',
  'run-section',
  'run-current',
  'run-actions',
  'run-error',
  'run-act',
  'run-floor',
  'run-gold',
  'run-opt-in',
  'run-repair-btn',
  'run-opt-in-error',
  'status-time',
  'status-location',
  'status-job-name',
  'battle-level',
  'battle-exp',
  'battle-deck',
  'battle-artifacts',
  'battle-items',
  'npc-relations',
  'faction-relations',
];

assert.equal(new Set(ids).size, ids.length, 'common interface element IDs must be unique');
for (const id of requiredIds) assert.ok(ids.includes(id), `common status bar must preserve #${id}`);
assert.equal((htmlSource.match(/\$1/g) || []).length, 0, 'story capture must not enter the common iframe');
assert.equal((htmlSource.match(/\$2/g) || []).length, 0, 'options must not be transported through the iframe shell');
assert.ok(nodes.some(node => classes(node).includes('mwg-statusbar')));
assert.doesNotMatch(scriptSource, /THEME_STORAGE_KEY|data-theme|prefers-color-scheme/);
assert.doesNotMatch(htmlSource, /custom-battle-send|按当前行动进入战斗/);
assert.doesNotMatch(scriptSource, /handleBattleAction|battle:\s*true/);
assert.doesNotMatch(styleSource, /\[data-theme='dark'\]|color-scheme:\s*dark/);
assert.match(styleSource, /--surface:\s*#fffaf7/);
assert.match(styleSource, /background-image:\s*repeating-linear-gradient/);
assert.ok(
  htmlSource.indexOf('id="run-opt-in"') < htmlSource.indexOf('id="battle-hp"'),
  'the optional expedition entry must be the first card/resource control',
);
assert.equal(nodes.filter(node => node.nodeName === 'details').length, 4, 'status details must use four stable panels');
assert.ok(!nodes.some(node => classes(node).includes('story-text')));
assert.ok(!nodes.some(node => classes(node).includes('tab-navigation')));
assert.ok(!htmlSource.includes('当前剧情'));
assert.ok(!scriptSource.includes('setupTabSwitching'));
assert.ok(!scriptSource.includes('applyTextHighlight'));
assert.match(scriptSource, /choiceOverlay\.style\.display = 'flex'/);
assert.match(scriptSource, /error\.id = 'reward-error'/);
assert.match(scriptSource, /inspectRewardCandidates\(stat\)/);
assert.match(scriptSource, /option-invalid/);
assert.match(scriptSource, /不可领取：/);
assert.match(scriptSource, /TavernRunActionHost/);
assert.match(runActionHostSource, /ensureRunStateInStat/);
assert.match(runActionHostSource, /public async startRun\(\)/);
assert.doesNotMatch(
  runActionHostSource.match(/public async syncPendingRunState[\s\S]*?public async startRun/)?.[0] || '',
  /ensureRunStateInStat/,
  'ordinary common sync must not auto-create an expedition',
);
assert.match(runActionHostSource, /enterRunNodeInStat/);
assert.match(runPromptSource, /danger=\$\{node\.danger\}/);
assert.match(runActionHostSource, /settleRestUpgradeInStat/);
assert.match(runActionHostSource, /settleShopSelectionsInStat/);
assert.match(runActionHostSource, /settleEventRewardSelectionsInStat/);
assert.match(runActionHostSource, /pendingEventRewards/);
assert.match(runActionHostSource, /stat\.run_result != null && !pendingEventRewards/);
assert.doesNotMatch(
  scriptSource,
  /ensureRunStateInStat|enterRunNodeInStat|settleRestUpgradeInStat|settleShopSelectionsInStat|settleEventRewardSelectionsInStat/,
);
assert.match(scriptSource, /'事件奖励'/);
assert.match(scriptSource, /已跳过本次奖励/);
assert.match(scriptSource, /已离开商店/);
assert.match(scriptSource, /奖励已成功领取/);
assert.match(scriptSource, /recommendShopPrice/);
assert.match(runPromptSource, /formatRunNodeDirection/);
assert.match(scriptSource, /function buildGuidancePrompt/);
assert.match(scriptSource, /const needsBuildContext = isBattleRunNode\(node\.kind\) \|\| node\.kind === 'shop';/);
assert.match(scriptSource, /const buildContext = needsBuildContext \? currentBuildContext\(\) : null;/);
assert.match(scriptSource, /worldContinuity: node\.kind === 'event' \? formatWorldContinuityHint\(__STAT__\) : null/);
assert.match(scriptSource, /buildBudgetPrompt\(buildContext\)/);
assert.match(scriptSource, /buildEnemyBudgetPrompt\(node, buildContext\)/);
assert.match(scriptSource, /assessInitialPlayerContent\(pack, \{/);
assert.match(scriptSource, /const needsInitialContentGate = run\.floor === 0/);
assert.match(scriptSource, /currentEl\.textContent = readiness\.deck\.deckQuantity === 0/);
assert.match(scriptSource, /formatPlayerContentRepairPrompt\(readiness\)/);
assert.match(scriptSource, /请求 AI 修复/);
assert.match(scriptSource, /function contentDescriptionStatusNames/);
assert.match(scriptSource, /describeCompactCard\(card, \{ statusNames: contentDescriptionStatusNames\(card\) \}\)/);
assert.match(scriptSource, /function contentRuleDescription/);
assert.match(scriptSource, /canGenerateCompactStatusDescription\(status\)/);
assert.match(scriptSource, /describeCompactStatus\(status, \{ statusNames \}\)/);
assert.match(scriptSource, /statusDefinitions\.get\(status\.id\)/);
assert.match(
  scriptSource,
  /describeCompactContent\(content, \{ statusNames: contentDescriptionStatusNames\(content\) \}\)/,
);
assert.match(scriptSource, /contentRuleDescription\(artifact, '效果见规则'\)/);
assert.match(scriptSource, /contentRuleDescription\(item, '效果见规则'\)/);
assert.doesNotMatch(scriptSource, /diagnoseMechanicalDuplicates/);
assert.doesNotMatch(scriptSource, /reward-diversity-warning/);
assert.match(scriptSource, /\[构筑建议\]/);
assert.equal(
  (scriptSource.match(/createContentPackFromMvuBattle\s*\(/g) || []).length,
  1,
  'common build summary, enemy budget, and guidance must share one complete content-pack boundary',
);
assert.doesNotMatch(scriptSource, /relics:\s*battle\.artifacts|activeStatuses:\s*battle\.player_status_effects/);
assert.doesNotMatch(scriptSource, /console\.log\(|debugData|checkSendingState|resetSendingState|testVariableOperations|refreshData/);
assert.match(scriptSource, /buildGuidance: node\.kind === 'shop' \? buildGuidancePrompt\(buildContext\) : null/);
assert.match(scriptSource, /isCurrentMessageLatest/);
assert.match(scriptSource, /历史记录/);
assert.match(scriptSource, /applyHistoricalReadOnlyMode/);
assert.match(scriptSource, /function startLatestMessageGuard/);
assert.match(scriptSource, /watchCurrentMessageDepth/);
assert.match(scriptSource, /rerenderHistoricalMessageForDepth/);
assert.match(scriptSource, /runActions\.replaceChildren\(\)/);
assert.match(scriptSource, /TavernCommonActionHost/);
assert.match(scriptSource, /runActionHost\.startRun\(\)/);
assert.doesNotMatch(scriptSource, /target\.closest\('#run-start-btn'\)|startOptionalRun/);
assert.match(scriptSource, /document\.addEventListener\('DOMContentLoaded', initializeCommonView/);
assert.doesNotMatch(scriptSource, /\$jq\(\(\) =>/);
assert.match(scriptSource, /if \(readRunState\(__STAT__\)\) \{/);
assert.doesNotMatch(scriptSource, /\btriggerSlash\b|updateCurrentMessageVariablesWith/);
assert.doesNotMatch(scriptSource, /\bgenerateRaw?\b/);
assert.match(commonActionHostSource, /createChatMessages\(/);
assert.match(commonActionHostSource, /triggerSlash\('\/trigger'\)/);
assert.doesNotMatch(commonActionHostSource, /triggerSlash\(`\/send|triggerSlash\('\/send/);
assert.match(messageVariablesSource, /export function watchCurrentMessageUntilHistorical/);
assert.match(messageVariablesSource, /export function getCurrentChatMessageText/);
assert.match(messageVariablesSource, /timer = setInterval/);
assert.match(battleShellSource, /watchCurrentMessageUntilHistorical/);
assert.match(battleShellSource, /rerenderHistoricalMessageForDepth/);
assert.match(battleShellSource, /public applyMessageScope/);
assert.match(battleShellSource, /history-battle-label/);
assert.match(battleScriptSource, /canMutateCurrentMessage/);
assert.doesNotMatch(battleScriptSource, /document\.|\$\(|location\.|triggerSlash|BattleLog/);
assert.match(scriptSource, /function showRunError/);
assert.match(scriptSource, /if \(!isCurrentMessageLatest\(\)\) return null/);
assert.match(scriptSource, /formatRoutePrompt\(/);
assert.match(scriptSource, /formatActionPrompt\(/);
assert.doesNotMatch(scriptSource, /renderOptions|parseOptionTags|handleBattleOption|handleOption/);
assert.doesNotMatch(scriptSource, /\[路线节点\]|\[事件选择\]|非战斗结局写 run_result/);
assert.match(runPromptSource, /\[事件选择\]/);
assert.match(runPromptSource, /gold\/hp 用实际 JSON 整数变化量/);
assert.match(scriptSource, /getCurrentChatMessageText/);
assert.doesNotMatch(exportSource, /findRegex:[\s\S]*?<Options>/);
assert.doesNotMatch(exportSource, /<Story>/);
assert.match(
  exportSource,
  /StatusPlaceHolderImpl/,
  'Tavern regex exports must tolerate the status placeholder appended by MUV',
);

console.log('Common messages keep native story text and append one user-driven interactive status bar.');
