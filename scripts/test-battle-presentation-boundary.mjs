import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { stageHealthBar, stageSummonMarkup, summonOrbitOffset } = require('../src/fish/ui/stageUnitDisplay.ts');

const executorPath = resolve('src/fish/combat/unifiedEffectExecutor.ts');
const statePath = resolve('src/fish/core/gameStateManager.ts');
const presenterPath = resolve('src/fish/ui/battleEffectPresenter.ts');
const cardSystemPath = resolve('src/fish/combat/cardSystem.ts');
const cardPresenterPath = resolve('src/fish/ui/cardInteractionPresenter.ts');
const cardPlayModePath = resolve('src/fish/ui/cardPlayMode.ts');
const battleUiPath = resolve('src/fish/ui/battleUI.ts');
const summonChoicePath = resolve('src/fish/ui/summonChoicePresenter.ts');
const enemyIntentPresenterPath = resolve('src/fish/ui/enemyIntentPresenter.ts');
const cardSelectionHostPath = resolve('src/fish/core/cardSelectionHost.ts');
const relicHostPath = resolve('src/fish/core/relicTriggerHost.ts');
const relicPresenterPath = resolve('src/fish/ui/relicEffectPresenter.ts');
const shellPresenterPath = resolve('src/fish/ui/battleShellPresenter.ts');
const hostPath = resolve('src/fish/core/battleEndHost.ts');
const repairHostPath = resolve('src/fish/core/battleRepairHost.ts');
const coordinatorPath = resolve('src/fish/index.ts');
const animationPath = resolve('src/fish/ui/animationManager.ts');
const battleHtmlPath = resolve('src/fish/index.html');
const battleStylesPath = resolve('src/fish/index.scss');
const fullscreenPath = resolve('src/fish/ui/battleFullscreenController.ts');
const fullscreenFallbackPath = resolve('src/fish/ui/battleFullscreenFallback.ts');
const [
  executor,
  state,
  presenter,
  cardSystem,
  cardPresenter,
  cardPlayMode,
  battleUi,
  summonChoice,
  enemyIntentPresenter,
  cardSelectionHost,
  relicTriggerHost,
  relicPresenter,
  shellPresenter,
  host,
  repairHost,
  coordinator,
  animation,
  battleHtml,
  battleStyles,
  fullscreen,
  fullscreenFallback,
] = await Promise.all(
  [
    executorPath,
    statePath,
    presenterPath,
    cardSystemPath,
    cardPresenterPath,
    cardPlayModePath,
    battleUiPath,
    summonChoicePath,
    enemyIntentPresenterPath,
    cardSelectionHostPath,
    relicHostPath,
    relicPresenterPath,
    shellPresenterPath,
    hostPath,
    repairHostPath,
    coordinatorPath,
    animationPath,
    battleHtmlPath,
    battleStylesPath,
    fullscreenPath,
    fullscreenFallbackPath,
  ].map(path => readFile(path, 'utf8')),
);

assert.match(executor, /TavernBattleEffectPresenter\.getInstance\(\)/);
assert.match(executor, /TavernBattleEndHost\.getInstance\(\)/);
assert.match(executor, /presentation\.showHealthChange/);
assert.match(executor, /presentation\.showLustChange/);
assert.match(executor, /presentation\.refreshPlayerEnergy/);
assert.doesNotMatch(executor, /presentation\.showBattleEndDialog|formatBattleEndPrompt|recommendBuildGuidance/);
assert.doesNotMatch(
  executor,
  /from ['"]\.\.\/modules\/battleLog['"]/,
  'effect executor must not own Tavern log storage',
);
assert.match(executor, /presentation\.addLog\(/);
assert.match(
  executor,
  /addLog: \(message, type = 'info', source\) => this\.presentation\.addLog\(message, type, source\)/,
);

for (const forbidden of [
  /AnimationManager/,
  /LustOverflowDisplay/,
  /settleCurrentMessageBattle/,
  /triggerSlash/,
  /location\./,
  /document\./,
  /\$\(/,
]) {
  assert.doesNotMatch(executor, forbidden, `effect executor must not own presentation/host primitive ${forbidden}`);
}
assert.doesNotMatch(state, /document\.|\$\(/, 'state storage must not render DOM errors');
assert.doesNotMatch(state, /require\(/, 'state conversion must not dynamically load UI/intent modules');

assert.match(presenter, /AnimationManager\.getInstance\(\)/);
assert.match(presenter, /LustOverflowDisplay\.getInstance\(\)/);
assert.match(presenter, /from ['"]\.\.\/modules\/battleLog['"]/);
assert.match(presenter, /public addLog\(/);
assert.match(presenter, /battle-end-dialog/);
assert.match(presenter, /await request\.onConfirm\(playerContinuation\)/);
assert.doesNotMatch(presenter, /settleCurrentMessageBattle|triggerSlash/);

assert.match(cardSystem, /TavernCardInteractionPresenter\.getInstance\(\)/);
assert.match(cardSystem, /TavernCardSelectionHost\.getInstance\(\)/);
assert.match(cardSystem, /cardSelectionHost\.select/);
assert.doesNotMatch(cardSystem, /presentation\.selectDiscardCards|presentation\.selectCards/);
assert.match(cardSystem, /presentation\.animateCardPlay/);
for (const forbidden of [/AnimationManager/, /BattleLog/, /escapeHtml/, /document\./, /\$\(/, /selection-modal/]) {
  assert.doesNotMatch(cardSystem, forbidden, `card system must not own Tavern card UI primitive ${forbidden}`);
}
assert.match(cardPresenter, /AnimationManager\.getInstance\(\)/);
assert.match(cardPresenter, /card-selection-modal/);
assert.match(cardPresenter, /EffectProgramDisplay\.getInstance\(\)/);
assert.match(cardPresenter, /createWrappedEffectTagsHTML/);
assert.doesNotMatch(cardPresenter, /discard-selection-modal|selectDiscardCards/);
assert.doesNotMatch(cardPresenter, /GameStateManager|nextRandom|updatePlayer|commitCardZoneOperation/);
assert.match(cardPlayMode, /pointerdown\.mwgCardPlay/);
assert.match(cardPlayMode, /pointermove\.mwgPointerCardPlay/);
assert.match(cardPlayMode, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
assert.match(cardPlayMode, /card\.trigger\('mwg:play-card'\)/);
assert.match(cardPlayMode, /document\.body\.appendChild\(element\)/);
assert.match(cardPlayMode, /requestAnimationFrame\(\(\) =>/);
assert.match(cardPlayMode, /translate3d/);
assert.doesNotMatch(cardPlayMode, /clone\(|cardGhost|card-ghost|createCardGhost/);
assert.match(cardPlayMode, /placeholder\.className = 'card-drag-slot'/);
assert.match(cardPlayMode, /restoreDraggedElementToSlot\(element, slot\)/);
assert.match(cardPlayMode, /resolveCardClickAction\(this\.selectedCard\?\.get\(0\), card\.get\(0\)\)/);
assert.match(cardPlayMode, /resolveCardDropAction\(\{/);
assert.doesNotMatch(cardPlayMode, /playMode|STORAGE_KEY|toggleMode|animateCardReturn/);
assert.doesNotMatch(cardPlayMode, /dragstart\.mwgCardPlay|touchstart\.mwgCardPlay/);
assert.match(battleUi, /window\.addEventListener\('resize'/);
assert.match(battleUi, /requestAnimationFrame\(\(\) =>/);
assert.match(battleUi, /\.card-tooltip'\)\.stop\(true, true\)\.remove\(\)/);
assert.match(battleUi, /public static repositionCardTooltip/);
assert.match(battleUi, /createWrappedEffectTagsHTML\(triggerTags\)/);
assert.match(battleUi, /previewPayment\?\.waived\.length/);
assert.match(battleUi, /card-cost-component\$\{insufficient/);
assert.match(presenter, /previewCard\?\.\(card\.id\)/);
assert.match(presenter, /toggleClass\('waived', waived\)/);
assert.match(battleUi, /class="status-trigger-group"/);
assert.match(battleUi, /class="status-detail-effects"/);
assert.match(battleUi, /showSupportDetails/);
assert.match(battleUi, /renderCardFace/);
assert.match(battleUi, /bindEnemyIntentDetails/);
assert.doesNotMatch(enemyIntentPresenter, /#enemy-intent-summary/, 'the presenter must not paint a second global stage intent');
assert.doesNotMatch(enemyIntentPresenter, /class="intent-badge"/, 'each enemy owns its stage intent badge');
assert.match(enemyIntentPresenter, /DynamicStatusManager\.getInstance\(\)\.getStatusDefinition/);
assert.match(enemyIntentPresenter, /public createDisplayModel/);
assert.doesNotMatch(enemyIntentPresenter, /class="intent-effects"|createEffectTagsHTML/);
assert.match(cardSelectionHost, /planCardSelection/);
assert.match(cardSelectionHost, /resolveCardSelection/);
assert.doesNotMatch(cardSelectionHost, /GameStateManager|commitCardZoneOperation|moveCard/);

assert.match(relicTriggerHost, /RelicEffectPresenter\.getInstance\(\)/);
assert.match(relicTriggerHost, /presentation\.showTriggered/);
assert.match(relicTriggerHost, /presentation\.addTriggeredLog\(relic, trigger\)/);
assert.doesNotMatch(relicTriggerHost, /BattleLog|document\.|\$\(/);
assert.match(relicPresenter, /BattleLog\.addLog/);
assert.match(relicPresenter, /relic-triggered/);
assert.match(relicPresenter, /type: 'relic'/);
assert.match(await readFile(resolve('src/fish/core/battleTriggerHost.ts'), 'utf8'), /type: 'ability'/);
assert.match(await readFile(resolve('src/fish/core/battleTriggerHost.ts'), 'utf8'), /type: 'status'/);

assert.match(battleHtml, /id="battle-stage"/);
assert.match(battleHtml, /id="battle-fullscreen-toggle"/);
assert.match(battleHtml, /<span class="fullscreen-text">全屏游玩<\/span>/);
assert.match(battleHtml, /aria-label="全屏游玩：让战斗界面占满当前窗口"/);
assert.doesNotMatch(battleStyles, /\.phase-indicator,\s*\n\s*\.fullscreen-text\s*\{\s*display:\s*none/);
assert.doesNotMatch(battleHtml, /id="modeToggle"|点击出牌|拖动出牌/);
assert.match(battleHtml, /id="stage-player-emoji"/);
assert.match(battleHtml, /id="stage-enemy-emoji"/);
assert.match(battleHtml, /id="stage-enemy-party"/);
assert.match(battleHtml, /class="stage-enemy-member is-active"/);
assert.match(battleHtml, /class="enemy-avatar-stack"/);
const stageEnemyStart = battleHtml.indexOf('class="stage-combatant stage-enemy"');
const stageEnemyEmoji = battleHtml.indexOf('id="stage-enemy-emoji"');
assert.ok(
  stageEnemyStart >= 0 && stageEnemyEmoji > stageEnemyStart,
  'the selected enemy remains a member of the central battle stage',
);
assert.doesNotMatch(battleHtml, /id="enemy-intent-summary"/, 'the selected enemy must not receive a second stage summary');
assert.doesNotMatch(battleHtml, /class="intent-icon"|class="intent-effects"/);
assert.doesNotMatch(battleHtml, /stage-action-caption|stage-enemy-name|class="stage-name"/);
assert.match(battleHtml, /class="compact-support-row" aria-label="我方附加效果"/);
assert.match(battleHtml, /id="player-status-effects"/);
assert.match(battleStyles, /\.battle-stage\s*\{/);
assert.match(battleStyles, /\.top-info-bar\s*\{[^}]*grid-template-columns:\s*auto auto minmax\(0, 1fr\)/s);
assert.doesNotMatch(battleStyles, /\.enemy-intent-summary\s*\{/, 'the removed global stage summary has no styling');
assert.doesNotMatch(battleStyles, /\.intent-badge\s*\{/, 'the removed global stage badge has no styling');
assert.doesNotMatch(battleStyles, /\.stage-intent-summary\s*\{/, 'only per-enemy stage intents are styled');
assert.match(battleStyles, /\.stage-action-token\s*\{/);
assert.match(battleStyles, /\.stage-enemy-party\s*\{/);
assert.match(battleStyles, /\.stage-enemy-member\s*\{/);
assert.match(battleStyles, /\.enemy-roster-bars\s*\{/);
assert.match(battleStyles, /\.enemy-roster-action\s*\{/);
assert.match(battleUi, /updateEnemyStageParty\(enemies, activeEnemyId\)/, 'the stage retains defeated members until the state removes them after their departure animation');
assert.match(battleUi, /EnemyIntentPresenter\.getInstance\(\)\.createDisplayModel\(enemy\)/);
assert.match(battleUi, /class="enemy-roster-intent-badge"/);
assert.match(battleUi, /class="stage-enemy-member\$\{active/);
assert.match(battleUi, /class="stage-enemy-member-intent"/, 'every enemy retains its own stage intent');
assert.match(enemyIntentPresenter, /escapePending/, 'escape intent stays in the per-enemy display model');
assert.doesNotMatch(battleUi, /\.enemy-intent, #enemy-intent-summary/, 'only the detailed-header action opens its details');
assert.match(battleUi, /姿态槽 \$\{orbs\.length\}\/\$\{slots\}/, 'the independent ordered container has a player-facing label');
assert.doesNotMatch(battleUi, /aria-label="Orb|查看 Orb|Orb · 数值/, 'battle UI does not expose the legacy English container name');
assert.match(
  battleStyles,
  /\.compact-support-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(68px, 10\.8em\) auto auto/s,
  'status icons keep the flexible space while the lust-effect name stays compact',
);
assert.doesNotMatch(
  battleStyles,
  /\.enemy-action-popup,[\s\S]{0,100}position:\s*fixed/,
  'enemy actions must stay in the bounded battle stage rather than create a full-screen overlay',
);
assert.doesNotMatch(
  battleStyles,
  /\.relic-section\s*\{\s*display:\s*none/,
  'relics must remain visible at narrow Tavern iframe widths',
);
assert.doesNotMatch(
  battleStyles,
  /\.lust-section\s*\{\s*display:\s*none/,
  "both sides' lust overflow effects must remain visible at narrow Tavern iframe widths",
);
assert.match(battleUi, /aria-label="查看欲望效果：\$\{escapeHtmlAttribute\(lustEffect\.name\)\}"/);
assert.match(battleUi, /class="lust-effect-label">\$\{activationLabel\}：<\/span>/);
assert.doesNotMatch(battleUi, /class="lust-effect-toggle support-icon-button"/);
assert.match(battleUi, /class="status-effect-item support-icon-button clickable status-kind-/);
assert.match(battleUi, /showSupportDetails\(\$\(this\), lustEffect/);
assert.doesNotMatch(battleUi, /\.slice\(0,\s*10\)/, 'the stage must not impose an old ten-summon render cap');
assert.doesNotMatch(battleUi, /let ringCapacity = 8/);
assert.match(battleUi, /from ['"]\.\/stageUnitDisplay['"]/);
assert.match(battleUi, /stageSummonMarkup\(\{ \.\.\.unit, emoji: resolveCharacterEmoji\(unit,[^\n]+\}, index, orbit/);
assert.match(battleUi, /const orbit = units\.length > 3/);
assert.match(battleStyles, /\.battle-stage \.stage-unit-health\s*\{/);
assert.match(battleStyles, /\.battle-stage \.stage-summons\.is-orbit\s*\{/);
const health = stageHealthBar(5.26, 10.04, '<镜像>');
assert.match(health, /aria-label="&lt;镜像&gt;生命"/);
assert.match(health, /aria-valuenow="5.3"/);
assert.match(health, /aria-valuemax="10"/);
assert.match(health, /aria-valuetext="5.3\/10"/);
assert.match(health, /class="stage-health-loss"[^>]*width:53%/, 'every detailed stage health bar provides a translucent loss layer');
assert.match(health, /class="stage-health-current"[^>]*width:53%/, 'the actual value remains a separate foreground layer');
assert.match(stageHealthBar(-1, Number.NaN), /aria-valuemax="0"[^>]*aria-valuenow="0"/);
const badges = [{ icon: '🛡', value: '5', label: '获得 5 点格挡' }];
const inlineSummon = stageSummonMarkup({ name: '<人偶>', emoji: '◇', instanceId: 'id"&', summonerId: 'caster', currentHp: 8, maxHp: 10, block: 4 }, 1, false, badges, '查看详情');
assert.match(inlineSummon, /data-summon-index="1"/);
assert.match(inlineSummon, /data-summon-id="id&quot;&amp;"/);
assert.match(inlineSummon, /&lt;人偶&gt;生命/);
assert.match(inlineSummon, /stage-intent-badge[\s\S]*🛡<b>5<\/b>/);
assert.match(inlineSummon, /8\/10/);
assert.match(inlineSummon, /🛡4/);
const orbitSummon = stageSummonMarkup({ name: '群体', currentHp: 8, maxHp: 10, block: 4 }, 4, true, badges, '查看详情');
assert.doesNotMatch(orbitSummon, /stage-summon-intent|stage-unit-health|stage-summon-block/, 'orbit markers stay compact and expose detail on click');
assert.match(stageSummonMarkup({ name: '无生命单位', hasHp: false }, 0, false, [], ''), /无生命/);
assert.deepEqual(summonOrbitOffset(0, 3), { x: 0, y: -42 });
assert.notDeepEqual(summonOrbitOffset(0, 3), summonOrbitOffset(1, 3), 'inline orbit positions distribute group members');
assert.deepEqual(summonOrbitOffset(8, 9), { x: 0, y: -68 }, 'the ninth summon expands to a second ring instead of a capped first ring');
assert.match(summonChoice, /data-summon-id/);
assert.match(summonChoice, /aria-pressed="false"/);
assert.match(summonChoice, /selected\.size !== amount/);
assert.doesNotMatch(summonChoice, /\.first\(\)\.trigger\(['"]click/, 'manual summon selection must not auto-pick the first candidate');
assert.match(battleUi, /renderSummonPanel\(unit\)/);
assert.match(battleUi, /triggeredProgramToTags\(ability\.trigger, ability\.effectProgram/);
assert.match(battleUi, /const contentLength = tooltip\.text\(\)\.replace/);
assert.match(battleUi, /maxHeight: 'none'/);
assert.match(battleUi, /overflow: 'visible'/);
assert.match(animation, /playCombatAction\(/);
assert.match(animation, /#stage-player-emoji/);
assert.match(animation, /#stage-enemy-emoji/);
assert.match(animation, /stage\.append\(damageText\)/);
assert.doesNotMatch(animation, /\$\('body'\)\.append\(damageText\)/);
assert.match(animation, /stageActionPresentation/, 'automatic unit turns await the active stage token instead of racing the next actor');
assert.match(animation, /const presentation = startCombatActionTiming/, 'the stage token exposes actual completion rather than a guessed delay');
assert.match(animation, /resolveCombatAnimationTarget/);
assert.match(animation, /stage-aura/);
assert.match(animation, /damageTimer/);
assert.match(animation, /DAMAGE_INTERVAL = 95/);
assert.match(animation, /ACTION_LEAD_IN = 150/);
assert.match(animation, /showStageEffect\(/);
assert.match(animation, /tone: 'damage' \| 'heal' \| 'lust' \| 'block' \| 'energy' \| 'status' \| 'resource'/);
assert.match(animation, /showStatusEffect\(/);
assert.match(presenter, /showBlockChange\(/);
assert.match(presenter, /showEnergyChange\(/);
assert.match(presenter, /showResourceChange\(/);
assert.match(presenter, /showSummonAction\(/);
assert.doesNotMatch(animation, /const duration = 3000|requestAnimationFrame\(animate\)/);
assert.match(battleStyles, /\.card-game-container\s*\{[^}]*height:\s*640px;[^}]*min-height:\s*640px/s);
assert.match(battleStyles, /\.battle-main-grid\s*\{[^}]*grid-template-rows:\s*96px minmax\(0, 1fr\) 96px/s);
assert.match(
  battleStyles,
  /\.center-battle-area\s*\{[^}]*grid-template-rows:\s*minmax\(72px, 1fr\) 190px/s,
  'wide battle layouts reserve a fixed hand row so surplus height expands the stage instead of a blank card gutter',
);
assert.match(
  battleStyles,
  /@media \(max-width: 760px\)[\s\S]*?\.card-game-container\s*\{[^}]*height:\s*clamp\(660px, 165vw, 760px\)[^}]*min-height:\s*clamp\(660px, 165vw, 760px\)[^}]*\}[\s\S]*?#battle-scene\s*\{[^}]*grid-template-rows:\s*36px minmax\(0, 1fr\) 38px/s,
  'phone layout owns one bounded battle viewport and keeps the top pile/fullscreen bar separate from combat rows',
);
assert.match(
  battleStyles,
  /@media \(max-width: 760px\)[\s\S]*?\.center-battle-area\s*\{[^}]*grid-template-rows:\s*minmax\(72px, 1fr\) 155px/s,
  'phone layout keeps the hand readable without pushing actors outside the viewport',
);
assert.match(
  battleStyles,
  /@media \(max-width: 390px\)[\s\S]*?\.top-info-bar\s*\{[^}]*grid-template-columns:\s*auto auto minmax\(0, 1fr\)/s,
  'narrow phones keep turn, fullscreen, and pile controls in distinct top-bar columns',
);
assert.match(
  battleStyles,
  /\.enemy-card,\s*\.player-card\s*\{[^}]*grid-template-columns:\s*minmax\(228px, 1\.45fr\) minmax\(0, 1fr\)/s,
);
assert.doesNotMatch(battleStyles, /height:\s*1040px|height:\s*940px|height:\s*920px/);
assert.match(battleStyles, /@keyframes moveStars/);
assert.match(battleStyles, /linear-gradient\(to right, #24243e, #302b63, #0f0c29\)/);
const sharedCardStyles = await readFile(resolve('src/shared/_cardFace.scss'), 'utf8');
for (const rarity of ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt']) {
  assert.ok(sharedCardStyles.includes(rarity));
}
assert.match(battleStyles, /@include card-face\.theme/);
assert.match(battleStyles, /\.stage-action-token[\s\S]*?border:\s*0/);
assert.match(battleStyles, /\.status-detail-body\s*\{[^}]*overflow:\s*auto/);
assert.match(battleStyles, /\.status-detail-effects\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/);
assert.match(battleStyles, /\.modifier-compare-row\s*\{/);
assert.match(battleStyles, /\.modifier-display-panel\s*\{[^}]*background:\s*transparent\s*!important/);
assert.match(battleStyles, /\.card-tooltip\.is-card-attached::after/);
assert.match(
  battleStyles,
  /\.card-tooltip\s*\{[^}]*min-height:\s*118px;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*pointer-events:\s*none/s,
  'card details grow with content, avoid a side scrollbar, and never block card input',
);
assert.match(battleStyles, /html\.mwg-fullscreen-active \.card-game-container/);
assert.match(battleStyles, /\.card-drag-slot\s*\{/);
assert.match(battleStyles, /\.enhanced-card\.selected:not\(\.dragging\)/);
assert.doesNotMatch(animation, /<div class="enemy-action-popup">/);

assert.match(fullscreen, /requestFullscreen/);
assert.match(fullscreen, /exitFullscreen/);
assert.match(fullscreen, /active \? '退出全屏' : '全屏游玩'/);
assert.match(fullscreen, /全屏游玩：让战斗界面占满当前窗口/);
assert.match(fullscreen, /enterBattleFullscreenFallback\(this\.frame, this\.parentDocument\)/);
assert.match(fullscreen, /exitBattleFullscreenFallback\(this\.frame, this\.parentDocument, this\.fallbackSnapshot\)/);
assert.match(fullscreen, /event\.key === 'Escape'/);
assert.match(fullscreenFallback, /frame\.style\.setProperty\(property, value, 'important'\)/);
assert.match(fullscreenFallback, /parentDocument\.body\.style\.overflow = 'hidden'/);
assert.match(fullscreenFallback, /frame\.setAttribute\('style', snapshot\.frameStyle\)/);

assert.match(shellPresenter, /class TavernBattleShellPresenter/);
assert.match(shellPresenter, /watchCurrentMessageUntilHistorical/);
assert.match(shellPresenter, /public showItems/);
assert.match(shellPresenter, /BattleLog\.logPlayerAction/);
assert.match(shellPresenter, /mwg:play-card\.mwgBattleShell/);
assert.match(shellPresenter, /#close-battle-log'[\s\S]*?fadeOut\(200\)/);
assert.match(shellPresenter, /renderSupportDetails/);
assert.doesNotMatch(shellPresenter, /triggerSlash/);

assert.match(repairHost, /formatBattleContentRepairPrompt/);
assert.match(repairHost, /assertCurrentMessageLatest/);
assert.match(repairHost, /retryCurrentMessageWithExtraModel/);
assert.match(repairHost, /await retryCurrentMessageWithExtraModel\(prompt,\s*\{/);
assert.match(repairHost, /validateVariables:/);
assert.match(repairHost, /preflightBattleContent\(variables\?\.stat_data\?\.battle\)/);
assert.doesNotMatch(repairHost, /TavernContinuationHost|continueWithPrompt/);
assert.doesNotMatch(repairHost, /triggerSlash\(`\/send|triggerSlash\('\/send/);
assert.doesNotMatch(repairHost, /document\.|\$\(|location\./);
assert.match(coordinator, /TavernBattleShellPresenter\.getInstance\(\)/);
assert.match(coordinator, /TavernBattleRepairHost\.getInstance\(\)/);
assert.doesNotMatch(coordinator, /document\.|\$\(|location\.|triggerSlash|BattleLog|escapeHtml/);

assert.match(host, /settleBattle: input => settleCurrentMessageBattle\(input\)/);
assert.match(host, /TavernContinuationHost/);
assert.match(host, /TavernBattleEffectPresenter/);
assert.match(host, /public async presentBattleEnd/);
assert.match(host, /presentation\.showBattleEndDialog/);
assert.match(host, /public resumeBattleEndDialog/);
assert.match(host, /continuationHost\.continueWithPrompt\(\{/);
assert.match(host, /rollbackBeforeSend/);
assert.match(host, /replaceCurrentMessageVariables/);
assert.doesNotMatch(host, /triggerSlash\(`\/send|triggerSlash\('\/send/);
assert.doesNotMatch(host, /document\.|\$\(/);

console.log('Battle rules delegate DOM presentation and Tavern continuation to explicit adapters.');
