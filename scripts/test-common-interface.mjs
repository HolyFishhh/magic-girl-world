import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'parse5';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const requireRules = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
requireRules('ts-node/register/transpile-only');
const { collectStanceNames } = requireRules(resolve('src/game-core/stanceIdentityDisplay.ts'));

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
const towerNodePanelSource = await readFile(resolve('src/common/towerNodePanel.ts'), 'utf8');
const rewardSelectionSource = await readFile(resolve('src/shared/rewardSelectionInteraction.ts'), 'utf8');
const battleRewardsMenuSource = await readFile(resolve('src/common/battleRewardsMenu.ts'), 'utf8');
const document = parse(htmlSource);
const nodes = [];
const visit = node => {
  nodes.push(node);
  node.childNodes?.forEach(visit);
};
visit(document);

assert.match(rewardSelectionSource, /createRewardPreviewPill/);
assert.match(rewardSelectionSource, /summary\.textContent = options\.previewLabel \?\? options\.label/);
assert.match(towerNodePanelSource, /append\('relic', value\.artifacts \?\? value\.artifact\)/);
const { rewardPreviewLabel } = requireRules(resolve('src/shared/rewardSelectionInteraction.ts'));
assert.equal(rewardPreviewLabel('relic', { emoji: '⚡', name: '雷符' }), '遗物：⚡');
assert.equal(rewardPreviewLabel('card', { emoji: '🗡️', name: '打击' }), '卡牌：打击 ×1');
assert.match(towerNodePanelSource, /append\('item', value\.items \?\? value\.item\)/);
assert.doesNotMatch(towerNodePanelSource, /查看馈赠内容|查看馈赠详情|点击展开详情/);

const classes = node =>
  (node.attrs?.find(attribute => attribute.name === 'class')?.value || '').split(/\s+/).filter(Boolean);
const ids = nodes
  .flatMap(node => node.attrs || [])
  .filter(attribute => attribute.name === 'id')
  .map(attribute => attribute.value);
const requiredIds = [
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
  'tower-start-difficulty',
  'status-time',
  'status-location',
  'status-job-name',
  'deck-archetype-profile',
  'deck-archetype-share-bar',
  'deck-archetype-legend',
  'deck-archetype-evolution',
  'battle-deck',
  'battle-artifacts',
  'battle-items',
  'npc-relations',
  'faction-relations',
];

assert.equal(new Set(ids).size, ids.length, 'common interface element IDs must be unique');
for (const id of requiredIds) assert.ok(ids.includes(id), `common status bar must preserve #${id}`);
assert.match(htmlSource, /id="tower-start-difficulty"/);
assert.match(scriptSource, /readRuntimeContentDesignSettings\(\)\.difficultyPercent/);
assert.match(scriptSource, /mwg:settings-center:v2/);
assert.match(scriptSource, /MagicGirlDesignAssistant\?\.updateSettings\?\.\(\{ difficultyPercent \}\)/);
assert.equal((htmlSource.match(/\$1/g) || []).length, 0, 'story capture must not enter the common iframe');
assert.equal((htmlSource.match(/\$2/g) || []).length, 0, 'options must not be transported through the iframe shell');
assert.ok(nodes.some(node => classes(node).includes('mwg-statusbar')));
assert.doesNotMatch(scriptSource, /THEME_STORAGE_KEY|data-theme|prefers-color-scheme/);
assert.doesNotMatch(htmlSource, /custom-battle-send|按当前行动进入战斗/);
assert.doesNotMatch(htmlSource, /notify-section|changes-section|本次变化|状态更新/);
assert.doesNotMatch(scriptSource, /handleBattleAction|battle:\s*true/);
assert.match(styleSource, /\.mwg-section-fold\s*\{\s*color-scheme:\s*dark/);
assert.match(styleSource, /--surface:\s*#fffaf7/);
assert.match(styleSource, /background-image:[\s\S]*repeating-linear-gradient/);
assert.match(styleSource, /--bookmark-pink:\s*#ffd9e2/);
assert.match(scriptSource, /compactContentToDisplayTags/);
const battleBook = scriptSource.match(/function renderBattleBookContent\(\)[\s\S]*?(?=\n(?:async )?function )/)?.[0] || '';
assert.match(battleBook, /description: generated/, 'status definitions use structural rules');
assert.match(battleBook, /const description = definition\?\.description \|\|/, 'active-status prose cannot replace definition rules');
assert.doesNotMatch(battleBook, /const description = status\.description/);
assert.match(battleBook, /\$\{escapeHtml\(description\)\}/);
assert.match(battleBook, /\$\{escapeHtml\(/, 'flavor is labeled and HTML escaped');
assert.match(battleBook, /escapeHtml\(definition\.flavorText\)/, 'active-status flavor is HTML escaped');
assert.match(battleBook, /\$\{escapeHtml\(status\.description\)\}/, 'status-book flavor is HTML escaped');
const escapeSource = scriptSource.match(/function escapeHtml\(value: unknown\): string \{[\s\S]*?\n\}/)?.[0];
assert.ok(escapeSource);
const hostileFlavor = '<img src=x onerror="window.__mwgInjected=1">';
const statusContainer = { innerHTML: '' };
runInNewContext(ts.transpileModule(`${escapeSource}\n${battleBook}\nrenderBattleBookContent();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, {
  document: { getElementById: () => statusContainer },
  __BATTLE_BOOK_DATA: {
    playerStatusEffects: [{ id: 'test', name: '状态', stacks: 1, description: '旧实例说明' }],
    statuses: [{ id: 'test', name: '状态', type: 'buff', description: hostileFlavor, triggers: {} }],
  },
  flattenMvuArray: value => value,
  normalizeMvuStatusDefinitions: value => value,
  canGenerateCompactStatusDescription: () => true,
  contentDescriptionEnemyNames: () => ({ guard: '守护者' }),
  describeCompactStatus: (_status, options) => { assert.equal(options.enemyNames.guard, '守护者'); return '实际机械规则'; },
  compactStatusEffectTagsHtml: () => '',
});
assert.equal((statusContainer.innerHTML.match(/&lt;img src=x onerror=&quot;window\.__mwgInjected=1&quot;&gt;/g) || []).length, 2, 'both real status renderer branches escape hostile authored flavor');
assert.doesNotMatch(statusContainer.innerHTML, /<img|旧实例说明/);
const ruleSource = scriptSource.match(/function contentRuleDescription\([\s\S]*?(?=\n\/\*\*|\nfunction )/)?.[0];
const flavorSource = 'function contentFlavorHtml(content) { return supportRenderer(content, { kind: "详情", rulesHtml: "" }); }';
assert.ok(ruleSource && flavorSource);
assert.doesNotMatch(ruleSource, /resolveCompact|content\.description/, 'rules never come from authored prose');
const presentationProbe = {rules:'',flavor:''};
runInNewContext(ts.transpileModule(`${escapeSource}\n${ruleSource}\n${flavorSource}\npresentationProbe.rules=contentRuleDescription(probe);presentationProbe.flavor=contentFlavorHtml(probe);`, {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText, {
  presentationProbe,probe:{type:'Skill',effects:{block:5},description:hostileFlavor},
  supportRenderer: requireRules(resolve('src/shared/supportPresentation.ts')).renderSupportDetails,
  contentDescriptionStatusNames:()=>({}),contentDescriptionStatusDefinitions:()=>({}),contentDescriptionResourceNames:()=>({}),
  collectStanceNames, collectStanceDefinitions:()=>({}), collectCardDisplayNames:()=>({}), collectSummonDisplayNames:()=>({}), contentDescriptionResourceDefinitions:()=>({}),__STAT__:{},
  describeCompactCard:card=>`获得${card.effects.block}点格挡。`,describeCompactContent:()=>'',
  normalizeChinesePlayerDescription:value=>value,
});
assert.equal(presentationProbe.rules,'获得5点格挡。');
assert.match(presentationProbe.flavor,/&lt;img/); assert.doesNotMatch(presentationProbe.flavor,/<img/);
// Actual shared formatter + actual common renderer: reward and inventory cards
// have no separate keyword badges, so their rules must not hide lifecycle flags.
const cardRules = requireRules(resolve('src/game-core/contentDescription.ts'));
const statusDefinitionsSource = scriptSource.match(/function contentDescriptionStatusDefinitions\([\s\S]*?(?=\nfunction )/)?.[0];
const statusNamesSource = scriptSource.match(/function contentDescriptionStatusNames\([\s\S]*?(?=\nfunction )/)?.[0];
assert.ok(statusDefinitionsSource && statusNamesSource);
const referenceProbe = {};
runInNewContext(ts.transpileModule(`${statusDefinitionsSource}\n${statusNamesSource}\n${ruleSource}\nreferenceProbe.rules=contentRuleDescription(probe);referenceProbe.builtin=contentRuleDescription({type:'Skill',effects:{apply_status:'sts_ritual',stacks:1,to:'self'}});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, {
  referenceProbe,
  probe: { type:'Skill', effects:{apply_status:'delayed',to:'opponent'}, description:'本回合结束伤害' },
  __STAT__: {battle:{statuses:[{id:'delayed',name:'延迟',triggers:{turn_start:{damage:6,to:'self'}}}]}},
  contentDescriptionResourceNames:()=>({}),collectStanceNames, collectStanceDefinitions:()=>({}), collectCardDisplayNames:()=>({}), collectSummonDisplayNames:()=>({}), contentDescriptionResourceDefinitions:()=>({}),
  expandBuiltinStatusDefinitions: requireRules(resolve('src/game-core/builtinStatusCatalog.ts')).expandBuiltinStatusDefinitions,
  describeCompactCard:cardRules.describeCompactCard,describeCompactContent:cardRules.describeCompactContent,
});
assert.match(referenceProbe.rules,/回合开始时/,'actual common renderer supplies exact status definitions');
assert.doesNotMatch(referenceProbe.rules,/本回合结束伤害/);
assert.match(referenceProbe.builtin,/仪式/,'a wrapper-free built-in reward preview uses its Chinese status name before selection');
assert.doesNotMatch(referenceProbe.builtin,/sts_ritual/);
for (const [extra, keyword] of [
  [{ exhaust: true }, '消耗'], [{ retain: true }, '保留'],
  [{ innate: true }, '固有'], [{ ethereal: true }, '虚无'],
  [{ type: 'Power', trigger: { on: 'turn_start', effects: { block: 1 } } }, '消耗'],
  [{ type: 'Power', trigger: { on: 'passive', effects: { modify: 'summon_capacity', add: 1 } } }, '自身的召唤容量增加1'],
]) {
  const observed = {};
  runInNewContext(ts.transpileModule(`${ruleSource}\nobserved.rules=contentRuleDescription(probe);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    observed, probe: { type: 'Attack', effects: { damage: 7 }, description: '没有写任何关键词', ...extra },
    contentDescriptionStatusNames: () => ({}), contentDescriptionStatusDefinitions: () => ({}), contentDescriptionResourceNames: () => ({}),
    collectStanceNames, collectStanceDefinitions:()=>({}), collectCardDisplayNames:()=>({}), collectSummonDisplayNames:()=>({}), contentDescriptionResourceDefinitions:()=>({}), __STAT__: {},
    describeCompactCard: cardRules.describeCompactCard, describeCompactContent: cardRules.describeCompactContent,
  });
  assert.match(observed.rules, new RegExp(keyword), `actual common rules preserve ${keyword}`);
  assert.match(observed.rules, /7点伤害/);
  assert.doesNotMatch(observed.rules, /没有写任何关键词/);
}
// Execute the actual tower card renderer with the real shared cost formatter.
const resourceSource = await readFile(resolve('src/game-core/combatResource.ts'), 'utf8');
const resourceModule = ts.transpileModule(resourceSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { describeCardCost } = await import(`data:text/javascript;base64,${Buffer.from(resourceModule).toString('base64')}`);
const costLabelSource = scriptSource.match(/function contentCardCostLabel\([\s\S]*?(?=\nfunction )/)?.[0];
const towerPlayerSource = scriptSource.match(/function renderTowerPlayerSummary\([\s\S]*?(?=\nfunction )/)?.[0];
const collectionCardSource = scriptSource.match(/function renderCollectionCard\([\s\S]*?(?=\nfunction )/)?.[0];
const collectionSupportSource = scriptSource.match(/function renderCollectionSupport\([\s\S]*?(?=\nfunction )/)?.[0];
const { renderCardFace } = requireRules(resolve('src/shared/cardFace.ts'));
const { renderSupportDetails } = requireRules(resolve('src/shared/supportPresentation.ts'));
assert.ok(costLabelSource && towerPlayerSource);
const costDeck = { innerHTML: '' };
const lifetimeEffects = { innerHTML: '' };
const lifetimeArtifacts = { innerHTML: '' };
const lifetimeAbilities = [{ id: 'temporary', name: '<临时能力>' }];
const costCards = [
  { id: 'multi', type: 'Skill', name: '复合费用', cost: { energy: 1, prism: 2 } },
  { id: 'all', type: 'Skill', name: '全部折光', cost: { prism: 'all' } },
  { id: 'energy', type: 'Attack', name: '全部能量', cost: 'energy' },
  { id: 'free', type: 'Skill', name: '免费', cost: 0 },
  { id: 'curse', type: 'Curse', name: '诅咒', cost: 1 },
];
const beforeCosts = structuredClone(costCards);
runInNewContext(ts.transpileModule(`${escapeSource}\n${costLabelSource}\n${collectionCardSource}\n${collectionSupportSource}\n${towerPlayerSource}\nrenderTowerPlayerSummary({battle:{cards:costCards,core:{resources:[{id:'prism',name:'折光'}]},artifacts:[{id:'permanent',name:'遗物'}],player_abilities:lifetimeAbilities,player_status_effects:[{id:'temporary_status'}]}},true);`, {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
}).outputText, {
  costCards, lifetimeAbilities, describeCardCost, renderCardFace, renderSupportDetails, CARD_RARITY_LABELS: { Common: '普通' },
  contentDescriptionResourceDefinitions: () => ({ prism: { name: '<折光>', emoji: '🔷' } }),
  document: { querySelector: () => null, getElementById: id => id === 'tower-player-panel' ? {style:{}} : id === 'tower-player-deck' ? costDeck : id === 'tower-player-effects' ? lifetimeEffects : id === 'tower-player-artifacts' ? lifetimeArtifacts : null },
  readStatusProfession: () => ({}), migratePersistentRunDeck: value => value,
  normalizeOptionsList: value => value || [], towerItemSlotsUsed: () => 0, MAX_TOWER_ITEM_SLOTS: 3,
  towerRarity: () => 'Common', contentRulesHtml: () => '测试规则', contentRuleDescription: () => '测试规则', contentFlavorHtml: () => '',
  translateCardType: value => value,
});
assert.match(costDeck.innerHTML, /1⚡能量 \+ 2🔷&lt;折光&gt;/);
assert.match(costDeck.innerHTML, /X🔷&lt;折光&gt;/);
assert.match(costDeck.innerHTML, /aria-label="X⚡能量">X⚡能量<\/div>/);
assert.match(costDeck.innerHTML, /aria-label="0⚡能量">0⚡能量<\/div>/);
assert.match(costDeck.innerHTML, /aria-label="—">—<\/div>/);
assert.doesNotMatch(costDeck.innerHTML, /\[object Object\]|<折光>/);
assert.deepEqual(costCards, beforeCosts);
assert.equal((lifetimeEffects.innerHTML.match(/本场 · 战斗结算后移除/g) || []).length, 2, 'only encounter abilities and active statuses receive the cleanup label');
assert.match(lifetimeEffects.innerHTML, /&lt;临时能力&gt;/);
assert.doesNotMatch(lifetimeEffects.innerHTML, /<临时能力>/);
assert.doesNotMatch(lifetimeArtifacts.innerHTML, /战斗结算后移除/);
assert.deepEqual(lifetimeAbilities, [{ id: 'temporary', name: '<临时能力>' }], 'lifetime presentation cannot mutate authored content');
assert.match(collectionCardSource, /contentCardCostLabel\(card\)/, 'all collection cards use the real resource cost formatter');
assert.doesNotMatch(scriptSource,/normalizeChinesePlayerDescription\(card.description\)\s*\|\|/,'reward prose cannot replace structural rules');
assert.doesNotMatch(scriptSource,/contentRuleDescription\([^\n]+\.description/,'caller cannot smuggle authored prose into the rules fallback');
assert.match(scriptSource, /reward-effect-summary/);
assert.match(scriptSource, /function renderDeckArchetypeProfile/);
assert.match(scriptSource, /design_context\?\.archetypes/);
assert.match(styleSource, /\.archetype-share-bar/);
assert.match(scriptSource, /CARD_RARITY_LABELS/);
assert.match(scriptSource, /renderCollectionCard\(card\)/);
assert.match(collectionCardSource, /renderCardFace/);
for (const rarity of ['Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt']) {
  assert.match(styleSource, new RegExp(`\\.battle-deck \\.card\\.rarity-${rarity}`));
}
assert.match(styleSource, /--card-rarity:/);
assert.doesNotMatch(towerNodePanelSource, /tower-node-narrative-archive/, 'story archive belongs to shared story panel');
assert.match(await readFile(resolve('src/runtime/storyPanel.ts'),'utf8'), /预览过去剧情/);
assert.match(styleSource, /\.tower-node-narrative-archive/);
assert.ok(
  htmlSource.indexOf('id="run-opt-in"') < htmlSource.indexOf('id="battle-hp"'),
  'the optional expedition entry must be the first card/resource control',
);
assert.equal(
  nodes.filter(node => node.nodeName === 'details' && classes(node).includes('status-panel')).length,
  4,
  'story status details must keep four stable panels beside the tower-only summaries',
);
assert.ok(!nodes.some(node => classes(node).includes('story-text')));
assert.ok(!nodes.some(node => classes(node).includes('tab-navigation')));
assert.ok(!htmlSource.includes('当前剧情'));
assert.ok(!scriptSource.includes('setupTabSwitching'));
assert.ok(!scriptSource.includes('applyTextHighlight'));
assert.match(scriptSource, /choiceOverlay\.style\.display = 'flex'/);
assert.match(scriptSource, /function renderBattleRewardMenu/);
assert.match(scriptSource, /isOrdinaryBattleReward/);
assert.match(scriptSource, /import \{ renderBattleRewardsMenu \} from '\.\/battleRewardsMenu';/);
assert.match(scriptSource, /claimGold: request\.kind === 'gold'/);
assert.match(scriptSource, /discardGold: request\.kind === 'discard'/);
assert.match(battleRewardsMenuSource, /export function renderBattleRewardsMenu/);
assert.match(battleRewardsMenuSource, /readRewardCardGroups/);
assert.match(battleRewardsMenuSource, /battle-reward-card-flip/);
assert.match(runActionHostSource, /gold: `\$\{Number\(stat\.reward\.gold\) \|\| 0\}:\$\{stat\.reward\.gold_claimed === true\}`/);
assert.match(battleRewardsMenuSource, /alert\.className='reward-error'/);
assert.match(scriptSource, /inspectRewardCandidates\(stat\)/);
assert.match(scriptSource, /option-invalid/);
assert.match(scriptSource, /不可领取：/);
assert.match(scriptSource, /TavernRunActionHost/);
assert.match(
  scriptSource,
  /async function retryTowerMapNode[\s\S]{0,900}finally \{\s*setSendingState\(false\);\s*setRunButtonsDisabled\(false\);\s*\}/,
  'a completed tower-node retry must release the map busy overlay',
);
assert.match(scriptSource, /MAX_AUTOMATIC_INITIAL_TOWER_REPAIRS = 2/);
assert.match(scriptSource, /mwg:tower-initial-repair:/);
assert.match(scriptSource, /selectedGameMode\(__STAT__\) !== 'tower'/);
assert.match(scriptSource, /scheduleAutomaticInitialTowerRepair\(readiness\)/);
assert.match(runActionHostSource, /ensureRunStateInStat/);
assert.match(runActionHostSource, /public async startRun\(\)/);
assert.doesNotMatch(
  runActionHostSource.match(/public async syncPendingRunState[\s\S]*?public async startRun/)?.[0] || '',
  /ensureRunStateInStat/,
  'ordinary common sync must not auto-create an expedition',
);
assert.match(runActionHostSource, /enterRunNodeInStat/);
assert.match(runPromptSource, /danger=\$\{node\.danger\}/);
assert.match(runActionHostSource, /executeUnifiedRunTransactionInStat/);
assert.match(runActionHostSource, /rest_upgrade_card/);
assert.match(runActionHostSource, /rest_transform_card/);
assert.match(runActionHostSource, /rest_duplicate_card/);
assert.match(runActionHostSource, /rest_remove_card/);
assert.doesNotMatch(runActionHostSource, /requestRewardReroll|retryRewardReroll/);
assert.match(runActionHostSource, /pendingEventRewards/);
assert.match(runActionHostSource, /stat\.run_result != null && !pendingEventRewards/);
assert.doesNotMatch(
  scriptSource,
  /ensureRunStateInStat|enterRunNodeInStat|settleRestUpgradeInStat|settleShopSelectionsInStat|settleEventRewardSelectionsInStat/,
);
assert.match(scriptSource, /'事件奖励'/);
assert.match(scriptSource, /已跳过本次奖励/);
assert.match(scriptSource, /离开了商店/);
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
assert.match(
  scriptSource,
  /const needsInitialContentGate =\s*run\.act === 1 && run\.floor === 0 && run\.phase === 'awaiting_choice' && !hasRewards;/,
  'initial content readiness must gate only the untouched Act 1 entrance, not later-act floor-zero choices',
);
assert.match(scriptSource, /currentEl\.textContent = readiness\.deck\.deckQuantity === 0/);
assert.match(
  scriptSource,
  /formatPlayerContentRepairPrompt\(readiness\)/,
);
assert.match(scriptSource, /retryCurrentMessageWithExtraModel\(prompt,\s*\{/);
assert.match(scriptSource, /validateVariables:\s*variables\s*=>/);
assert.match(scriptSource, /initialContentReadinessFromStat\(variables\?\.stat_data\)/);
assert.doesNotMatch(scriptSource, /AutomaticRepairCandidateIssues|candidate-issues/);
assert.match(scriptSource, /refreshOnFailure: 'none'/);
assert.match(scriptSource, /requestInitialContentRepair\(current\)/);
assert.match(scriptSource, /reportMvuValidationFailure/);
assert.match(
  scriptSource,
  /if \(isMvuGenerationBusy\(\)\)[\s\S]{0,900}await loadGameData\(\);[\s\S]{0,500}scheduleAutomaticInitialTowerRepair\(current\)/,
);
assert.match(scriptSource, /getMvuMonitorSnapshot/);
assert.match(scriptSource, /snapshot\?\.phase === 'generating'/);
assert.match(scriptSource, /if \(repaired\) await loadGameData\(\);/);
assert.doesNotMatch(scriptSource, /requestInitialContentRepair[\s\S]{0,500}commonActionHost\.continueWithPrompt/);
assert.match(scriptSource, /请求 AI 修复/);
assert.match(scriptSource, /function contentDescriptionStatusNames/);
assert.match(scriptSource, /let __REWARD_SELECTION_MEMORY: RewardSelectionMemory \| null = null/);
assert.match(scriptSource, /selections: RewardSelections/);
assert.match(scriptSource, /const selections = __REWARD_SELECTION_MEMORY\.selections/);
assert.match(scriptSource, /poolRevision: Number\(reward\.pool_revision \|\| 0\)/);
assert.match(scriptSource, /input\.checked = restored\.includes\(index\)/);
assert.match(scriptSource, /function contentDescriptionResourceNames/);
assert.match(ruleSource, /statusNames: contentDescriptionStatusNames\(content\)/);
assert.match(ruleSource, /resourceNames: contentDescriptionResourceNames\(\)/);
assert.match(scriptSource, /function contentRuleDescription/);
assert.match(scriptSource, /canGenerateCompactStatusDescription\(status\)/);
assert.match(scriptSource, /describeCompactStatus\(status, \{ statusNames, enemyNames: contentDescriptionEnemyNames\(\) \}\)/);
assert.match(scriptSource, /statusDefinitions\.get\(status\.id\)/);
assert.match(ruleSource, /describeCompactCard\(content/);
assert.match(ruleSource, /describeCompactContent\(content, options\)/);
assert.match(scriptSource, /renderCollectionSupport\(artifact, '遗物'\)/);
assert.match(scriptSource, /renderCollectionSupport\(item, '道具'\)/);
assert.match(collectionSupportSource, /contentRulesHtml\(value\)/);
assert.match(scriptSource, /value\.name \?\? value\.title \?\? value\.id/);
assert.match(scriptSource, /name && description \? `\$\{name\}：\$\{description\}`/);
assert.doesNotMatch(scriptSource, /let items: string\[\] = status/);
assert.doesNotMatch(scriptSource, /diagnoseMechanicalDuplicates/);
assert.doesNotMatch(scriptSource, /reward-diversity-warning/);
assert.match(scriptSource, /\[构筑建议\]/);
assert.equal(
  (scriptSource.match(/createContentPackFromMvuBattle\s*\(/g) || []).length,
  2,
  'one complete content-pack boundary serves live build guidance and one independently validates repaired snapshots',
);
assert.doesNotMatch(scriptSource, /relics:\s*battle\.artifacts|activeStatuses:\s*battle\.player_status_effects/);
assert.doesNotMatch(
  scriptSource,
  /console\.log\(|debugData|checkSendingState|resetSendingState|testVariableOperations|refreshData/,
);
assert.match(scriptSource, /buildGuidance: node\.kind === 'shop' \? buildGuidancePrompt\(buildContext\) : null/);
assert.match(scriptSource, /isCurrentMessageLatest/);
assert.match(scriptSource, /历史记录/);
assert.match(scriptSource, /applyHistoricalReadOnlyMode/);
assert.match(scriptSource, /function startLatestMessageGuard/);
assert.match(scriptSource, /watchCurrentMessageDepth/);
assert.match(scriptSource, /rerenderHistoricalMessageForDepth/);
assert.match(scriptSource, /runActions\.replaceChildren\(\)/);
assert.match(scriptSource, /TavernCommonActionHost/);
const singleFloorStart = scriptSource.match(/async function startTowerFromPanel\(\)[\s\S]*?(?=\n(?:async )?function )/)?.[0] || '';
assert.ok(singleFloorStart, 'common UI has a single-floor tower start handler');
assert.match(scriptSource, /tower-start-button['"]\)\?\.addEventListener\('click', \(\) => void startTowerFromPanel\(\)/);
assert.match(singleFloorStart, /await ensureMvuRuntimeReady\(/);
assert.match(singleFloorStart, /await persistTowerMode\(config\)/);
assert.match(singleFloorStart, /await runtime\.startTowerSingleFloor\(\{/);
assert.match(singleFloorStart, /spec: 'mwg\.tower-single-floor-start\/v1'/);
assert.ok(singleFloorStart.indexOf('await ensureMvuRuntimeReady(') < singleFloorStart.indexOf('await persistTowerMode(config)'));
assert.ok(singleFloorStart.indexOf('await persistTowerMode(config)') < singleFloorStart.indexOf('await runtime.startTowerSingleFloor('));
assert.doesNotMatch(scriptSource, /runActionHost\.startRun\(\)/, 'tower UI must not bypass single-floor initialization');
assert.doesNotMatch(scriptSource, /target\.closest\('#run-start-btn'\)|startOptionalRun/);
assert.match(scriptSource, /if \(typeof window !== 'undefined'\) \{\s*initializeCommonView\(\);\s*\}/);
const loadGameData = scriptSource.match(/async function loadGameData\(\)[\s\S]*?(?=\n(?:async )?function )/)?.[0] || '';
assert.ok(loadGameData.includes('await ensureMvuRuntimeReady('), 'restored view waits for MVU');
assert.ok(loadGameData.indexOf('await ensureMvuRuntimeReady(') < loadGameData.indexOf('variables = getCurrentMessageVariables();'), 'MVU is ready before the first variable read');
assert.doesNotMatch(scriptSource, /\$jq\(\(\) =>/);
assert.match(scriptSource, /if \(readGameMode\(__STAT__\) === 'tower' && readRunState\(__STAT__\)\) \{/);
assert.doesNotMatch(scriptSource, /\btriggerSlash\b/);
const persistTowerMode = scriptSource.match(/async function persistTowerMode\([\s\S]*?(?=\n(?:async )?function )/)?.[0] || '';
assert.match(persistTowerMode, /await updateCurrentMessageVariablesWith\(update\)/);
assert.doesNotMatch(persistTowerMode, /updateCurrentChatVariablesWith/,
  'single-floor start must not create a chat-scope MVU mirror that disabled MVU compatibility removes on reload');
assert.match(messageVariablesSource, /export function updateCurrentMessageVariablesWith\([\s\S]{0,250}assertCurrentMessageLatest\(\)/, 'mode persistence uses the guarded message writer');
assert.equal((scriptSource.match(/updateCurrentMessageVariablesWith\(/g) || []).length, 1, 'direct message writes are confined to explicit mode persistence');
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
assert.doesNotMatch(scriptSource, /formatActionPrompt\(/);
assert.doesNotMatch(htmlSource, /custom-action-input|custom-action-send/);
assert.doesNotMatch(scriptSource, /renderOptions|parseOptionTags|handleBattleOption|handleOption/);
assert.doesNotMatch(scriptSource, /\[路线节点\]|\[事件选择\]|非战斗结局写 run_result/);
assert.match(runPromptSource, /\[事件选择\]/);
assert.match(runPromptSource, /gold\/hp 用实际 JSON 整数变化量/);
assert.match(scriptSource, /return readGameMode\(stat\)/);
assert.match(scriptSource, /synchronizeGameModeInStat\(stat\)/);
assert.doesNotMatch(scriptSource, /context\.includes\('\[远征模式\]'\)/);
assert.doesNotMatch(exportSource, /findRegex:[\s\S]*?<Options>/);
assert.doesNotMatch(exportSource, /<Story>/);
assert.match(
  exportSource,
  /StatusPlaceHolderImpl/,
  'Tavern regex exports must tolerate the status placeholder appended by MUV',
);

console.log('Common view content, rewards and interactions passed; story presentation is covered by test-story-panel.');
