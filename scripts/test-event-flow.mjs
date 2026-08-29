import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

function readClassMethod(source, fileName, className, methodName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let method;

  function visit(node) {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      method = node.members.find(
        member => ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === methodName,
      );
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  assert.ok(method, `${className}.${methodName} must exist`);
  return method.getText(file);
}

const executorPath = resolve('src/fish/combat/unifiedEffectExecutor.ts');
const statePath = resolve('src/game-core/battleState.ts');
const coordinatorPath = resolve('src/fish/index.ts');
const presenterPath = resolve('src/fish/ui/battleEffectPresenter.ts');
const shellPresenterPath = resolve('src/fish/ui/battleShellPresenter.ts');
const battleEndHostPath = resolve('src/fish/core/battleEndHost.ts');
const [executorSource, stateSource, coordinatorSource, presenterSource, shellPresenterSource, battleEndHostSource] =
  await Promise.all([
    readFile(executorPath, 'utf8'),
    readFile(statePath, 'utf8'),
    readFile(coordinatorPath, 'utf8'),
    readFile(presenterPath, 'utf8'),
    readFile(shellPresenterPath, 'utf8'),
    readFile(battleEndHostPath, 'utf8'),
  ]);

const triggerNarrative = readClassMethod(executorSource, executorPath, 'UnifiedEffectExecutor', 'triggerNarrative');
assert.match(triggerNarrative, /completeBattleEnd\('terminated', text\)/);
assert.doesNotMatch(executorSource, /saveBattleResultToMVU|insertOrAssignVariables\(\{ battle_result/);

const completeBattleEnd = readClassMethod(executorSource, executorPath, 'UnifiedEffectExecutor', 'completeBattleEnd');
assert.match(completeBattleEnd, /setBattleOutcome\(result, narrativeText\)/);
assert.ok(
  completeBattleEnd.indexOf('setBattleOutcome(result, narrativeText)') <
    completeBattleEnd.indexOf('battleEndHost.presentBattleEnd(result'),
  'an event must enter its terminal state before its end dialog is created',
);

const presentBattleEnd = readClassMethod(
  battleEndHostSource,
  battleEndHostPath,
  'TavernBattleEndHost',
  'presentBattleEnd',
);
assert.match(presentBattleEnd, /formatBattleEndPrompt\(\{/);
assert.match(presentBattleEnd, /\[MVU_BATTLE_SETTLEMENT\]/);
assert.match(presentBattleEnd, /const rewardRequest/);
assert.doesNotMatch(presentBattleEnd, /\[奖励预算\]|\[构筑建议\]|\[剧情模型要求\]/);
assert.match(presentBattleEnd, /recommendBattleRewardBudget/);
assert.match(presentBattleEnd, /assessContentDesign/);
assert.match(presentBattleEnd, /outcome: outcomeFeedback/);
assert.match(presentBattleEnd, /presentation\.showBattleEndDialog\(\{/);
assert.match(presentBattleEnd, /battleSummary: prompt\.promptedBattleSummary/);
assert.match(presentBattleEnd, /formatBattleEndPrompt\(\{ \.\.\.promptInput, playerContinuation \}\)/);
assert.match(battleEndHostSource, /effectProgramToDisplayTags/);
assert.match(battleEndHostSource, /triggeredEffectProgramToDisplayTags/);
assert.match(
  presentBattleEnd,
  /this\.confirmBattleEnd\(result, continuationPrompt\.promptedBattleSummary, rewardRequest\)/,
);
assert.doesNotMatch(
  presentBattleEnd,
  /await presentation\.showBattleEndDialog/,
  'the end dialog must not suspend the card/effect execution chain until user input',
);
const executeEffectProgram = readClassMethod(
  executorSource,
  executorPath,
  'UnifiedEffectExecutor',
  'executeEffectProgram',
);
assert.match(executeEffectProgram, /effectCommandHost\.executeProgram\(program, sourceIsPlayer, context\)/);
assert.match(executeEffectProgram, /catch \(error\)[\s\S]*throw error/);
assert.doesNotMatch(executorSource, /executeExpression|calculateDynamicValue/);
assert.match(presentBattleEnd, /prompt\.resultText/);

const handleLustOverflow = readClassMethod(
  executorSource,
  executorPath,
  'UnifiedEffectExecutor',
  'handleLustOverflow',
);
assert.match(executorSource, /activeLustOverflows = new Set<'player' \| 'enemy'>\(\)/);
assert.match(handleLustOverflow, /activeLustOverflows\.has\(target\)/);
assert.match(handleLustOverflow, /activeLustOverflows\.add\(target\)/);
assert.match(handleLustOverflow, /finally[\s\S]*currentLust: 0[\s\S]*activeLustOverflows\.delete\(target\)/);

const showBattleEndDialog = readClassMethod(
  presenterSource,
  presenterPath,
  'TavernBattleEffectPresenter',
  'showBattleEndDialog',
);
assert.match(showBattleEndDialog, /battle-end-narrative/);
assert.match(
  showBattleEndDialog,
  /\.text\(request\.narrativeText\)/,
  'narrative text must be rendered as text, not HTML',
);
assert.match(showBattleEndDialog, /await request\.onConfirm\(playerContinuation\)/);
assert.match(showBattleEndDialog, /battle-end-choice/);
assert.match(showBattleEndDialog, /await request\.onRestart\(\)/);

assert.doesNotMatch(
  completeBattleEnd,
  /confirmBattleEnd|settleCurrentMessageBattle|setTimeout/,
  'a completed battle must remain restorable until the user confirms leaving it',
);

const confirmBattleEnd = readClassMethod(
  battleEndHostSource,
  battleEndHostPath,
  'TavernBattleEndHost',
  'confirmBattleEnd',
);
assert.match(confirmBattleEnd, /await this\.ports\.clearBattleSession\(\)/);
assert.match(confirmBattleEnd, /await this\.ports\.settleBattle\(settlement\)/);
assert.match(confirmBattleEnd, /await this\.continuationHost\.continueWithPrompt\(\{/);
assert.match(confirmBattleEnd, /rollbackBeforeSend/);
assert.ok(
  confirmBattleEnd.indexOf('clearBattleSession()') < confirmBattleEnd.indexOf('settleBattle(settlement)'),
  'confirmation clears the private snapshot before creating a new message',
);
assert.doesNotMatch(executorSource, /updateCurrentMessageVariablesWith|settleBattleRunInStat/);

const setBattleOutcome = readClassMethod(stateSource, statePath, 'BattleStateStore', 'setBattleOutcome');
assert.match(setBattleOutcome, /transitionToBattleEnd\(this\.gameState, result, narrativeText\)/);

const resumeBattleEndDialog = readClassMethod(
  battleEndHostSource,
  battleEndHostPath,
  'TavernBattleEndHost',
  'resumeBattleEndDialog',
);
assert.match(resumeBattleEndDialog, /readBattleEndResult\(state\)/);
assert.match(resumeBattleEndDialog, /state\.battleNarrative/);
assert.match(resumeBattleEndDialog, /presentBattleEnd/);
assert.match(resumeBattleEndDialog, /presentation\.hasBattleEndDialog\(\)/);

const initializeCoordinator = readClassMethod(coordinatorSource, coordinatorPath, 'FishRPGCoordinator', 'initialize');
assert.match(initializeCoordinator, /wasBattleSessionRestored\(\)/);
assert.match(initializeCoordinator, /battleEndHost\.resumeBattleEndDialog\(\)/);

const battleUiPath = resolve('src/fish/ui/battleUI.ts');
const battleManagerPath = resolve('src/fish/combat/battleManager.ts');
const battleUiSource = await readFile(battleUiPath, 'utf8');
const battleManagerSource = await readFile(battleManagerPath, 'utf8');
const updateOtherElements = readClassMethod(battleUiSource, battleUiPath, 'BattleUI', 'updateOtherElements');
assert.match(updateOtherElements, /\$\('#phase-indicator'\)\.text\(phaseText\)/);
assert.match(updateOtherElements, /const playerCanAct = gameState\.phase === 'player_turn' && !battleEnded/);
assert.match(updateOtherElements, /#use-item-btn/);
assert.match(updateOtherElements, /\.prop\('disabled', !playerCanAct\)/);
assert.doesNotMatch(updateOtherElements, /#game-phase/);

const endPlayerTurn = readClassMethod(battleManagerSource, battleManagerPath, 'BattleManager', 'endPlayerTurn');
assert.match(endPlayerTurn, /await advanceBattleSessionTurn\(\{/);
assert.match(endPlayerTurn, /gate: this\.sessionHost\.gate/);

const cardSystemPath = resolve('src/fish/combat/cardSystem.ts');
const cardSystemSource = await readFile(cardSystemPath, 'utf8');
const playCard = readClassMethod(cardSystemSource, cardSystemPath, 'CardSystem', 'playCard');
assert.match(playCard, /await playBattleSessionCard\(cardId, \{/);
assert.match(playCard, /isTerminal: \(\) => this\.gameStateManager\.isGameOver\(\)/);
assert.match(playCard, /triggerPostCardPlay: card => this\.triggerPostCardPlayEffects\(card\)/);
assert.match(playCard, /beginTransaction: action => this\.sessionHost\.beginTransaction\(action\)/);
assert.match(playCard, /rollbackTransaction: token => this\.sessionHost\.rollbackTransaction\(token\)/);
assert.doesNotMatch(playCard, /createSnapshot|restoreSnapshot|deleteSnapshot|discardCardsForRequirement/);
assert.doesNotMatch(
  playCard,
  /回滚状态 - 恢复手牌和能量/,
  'rollback must restore the complete game state rather than only hand and energy',
);

assert.doesNotMatch(coordinatorSource, /EffectEngine|effectEngine/);
assert.doesNotMatch(battleManagerSource, /EffectEngine|effectEngine/);
assert.doesNotMatch(cardSystemSource, /EffectEngine|effectEngine/);
assert.match(endPlayerTurn, /await advanceBattleSessionTurn\(\{/);
assert.match(endPlayerTurn, /isTerminal: \(\) => this\.gameStateManager\.isGameOver\(\)/);
const executeTurnFlowStep = readClassMethod(
  battleManagerSource,
  battleManagerPath,
  'BattleManager',
  'executeTurnFlowStep',
);
assert.match(executeTurnFlowStep, /case 'enemy_action':[\s\S]*executeEnemyTurnAction\(\)/);
assert.match(executeTurnFlowStep, /case 'player_begin':[\s\S]*beginPlayerTurn\(\)/);
assert.doesNotMatch(battleManagerSource, /private async (?:executeEnemyTurn|startNewTurn|startPlayerTurn)\(/);

for (const methodName of ['playCard', 'showItemModal']) {
  const method = readClassMethod(coordinatorSource, coordinatorPath, 'FishRPGCoordinator', methodName);
  assert.match(method, /if \(!this\.battleManager\.canPlayerAct\(\)\) return/);
}
assert.doesNotMatch(coordinatorSource, /private async drawCards\(/, 'effect-owned draws must stay in CardSystem');
assert.match(cardSystemSource, /public async drawCards\(count: number\)/);
assert.match(coordinatorSource, /shellPresenter\.showItems/);
assert.match(coordinatorSource, /shellPresenter\.logPlayerAction/);
assert.match(shellPresenterSource, /root\.on\('click\.mwgBattleShell', '\.end-turn-button'/);
assert.doesNotMatch(coordinatorSource, /document\.|\$\(|location\.|triggerSlash|BattleLog|AnimationManager/);
const useItem = readClassMethod(coordinatorSource, coordinatorPath, 'FishRPGCoordinator', 'useItem');
assert.match(useItem, /await runBattleSessionAtomicAction\(/);
assert.match(useItem, /'use_item'/);
assert.match(useItem, /gate: this\.sessionHost\.gate/);
assert.match(useItem, /canRun: \(\) => this\.battleManager\.canPlayerAct\(\)/);
assert.match(useItem, /rollbackTransaction: token => this\.sessionHost\.rollbackTransaction\(token\)/);
assert.ok(
  useItem.indexOf('runBattleSessionAtomicAction(') < useItem.indexOf('executeEffectProgram(item.effectProgram'),
  'item effects must execute inside the shared session transaction',
);
assert.doesNotMatch(useItem, /createSnapshot|restoreSnapshot|deleteSnapshot/);

console.log('Event narration renders safely and persists a terminal battle state.');
