import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const executorPath = resolve('src/fish/combat/unifiedEffectExecutor.ts');
const statePath = resolve('src/fish/core/gameStateManager.ts');
const presenterPath = resolve('src/fish/ui/battleEffectPresenter.ts');
const cardSystemPath = resolve('src/fish/combat/cardSystem.ts');
const cardPresenterPath = resolve('src/fish/ui/cardInteractionPresenter.ts');
const cardSelectionHostPath = resolve('src/fish/core/cardSelectionHost.ts');
const relicHostPath = resolve('src/fish/core/relicTriggerHost.ts');
const relicPresenterPath = resolve('src/fish/ui/relicEffectPresenter.ts');
const shellPresenterPath = resolve('src/fish/ui/battleShellPresenter.ts');
const hostPath = resolve('src/fish/core/battleEndHost.ts');
const repairHostPath = resolve('src/fish/core/battleRepairHost.ts');
const coordinatorPath = resolve('src/fish/index.ts');
const [
  executor,
  state,
  presenter,
  cardSystem,
  cardPresenter,
  cardSelectionHost,
  relicTriggerHost,
  relicPresenter,
  shellPresenter,
  host,
  repairHost,
  coordinator,
] = await Promise.all(
  [
    executorPath,
    statePath,
    presenterPath,
    cardSystemPath,
    cardPresenterPath,
    cardSelectionHostPath,
    relicHostPath,
    relicPresenterPath,
    shellPresenterPath,
    hostPath,
    repairHostPath,
    coordinatorPath,
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
assert.match(presenter, /await request\.onConfirm\(\)/);
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
assert.doesNotMatch(cardPresenter, /discard-selection-modal|selectDiscardCards/);
assert.doesNotMatch(cardPresenter, /GameStateManager|nextRandom|updatePlayer|commitCardZoneOperation/);
assert.match(cardSelectionHost, /planCardSelection/);
assert.match(cardSelectionHost, /resolveCardSelection/);
assert.doesNotMatch(cardSelectionHost, /GameStateManager|commitCardZoneOperation|moveCard/);

assert.match(relicTriggerHost, /RelicEffectPresenter\.getInstance\(\)/);
assert.match(relicTriggerHost, /presentation\.showTriggered/);
assert.doesNotMatch(relicTriggerHost, /BattleLog|document\.|\$\(/);
assert.match(relicPresenter, /BattleLog\.addLog/);
assert.match(relicPresenter, /relic-triggered/);

assert.match(shellPresenter, /class TavernBattleShellPresenter/);
assert.match(shellPresenter, /watchCurrentMessageUntilHistorical/);
assert.match(shellPresenter, /public showItems/);
assert.match(shellPresenter, /BattleLog\.logPlayerAction/);
assert.match(shellPresenter, /escapeHtml\(item\.name\)/);
assert.doesNotMatch(shellPresenter, /triggerSlash/);

assert.match(repairHost, /formatBattleContentRepairPrompt/);
assert.match(repairHost, /assertCurrentMessageLatest/);
assert.match(repairHost, /TavernContinuationHost/);
assert.match(repairHost, /continuationHost\.continueWithPrompt\(\{ prompt \}\)/);
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
