import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

assert.equal(core.resolvePendingBattleEnd([]), null);
assert.equal(core.resolvePendingBattleEnd(['player']), 'defeat');
assert.equal(core.resolvePendingBattleEnd(['enemy']), 'victory');
assert.equal(core.resolvePendingBattleEnd(['player', 'enemy']), 'victory');

const ongoing = {
  phase: 'player_turn',
  isGameOver: false,
  battleResult: 'ongoing',
  battleNarrative: '',
  preserved: 7,
};
assert.deepEqual(core.transitionToBattleEnd(ongoing, 'defeat'), {
  ...ongoing,
  phase: 'game_over',
  isGameOver: true,
  battleResult: 'defeat',
});
const terminated = core.transitionToBattleEnd(ongoing, 'terminated', '安全撤离');
assert.equal(terminated.battleNarrative, '安全撤离');
assert.equal(core.readBattleEndResult(terminated), 'terminated');
assert.equal(core.readBattleEndResult({ ...terminated, battleResult: 'ongoing' }), null);
assert.equal(core.readBattleEndResult(ongoing), null);

const prompt = core.formatBattleEndPrompt({
  result: 'victory',
  continuation: 'ordinary',
  player: {
    hp: 12,
    maxHp: 20,
    lust: 3,
    maxLust: 100,
    energy: 4,
    statuses: [{ name: '祝福', stacks: 2 }],
    handCount: 1,
    drawPileCount: 2,
    discardPileCount: 3,
  },
  enemy: { name: '校验体', hp: 0, maxHp: 10, lust: 0, maxLust: 100, statuses: [] },
  turns: 2,
  narrativeCards: [{ name: '破门', description: '改变了战场。' }],
  rewardBudget: '[奖励预算] cards=3',
  buildGuidance: '[构筑建议] 防御',
  battleLog: '- 第1回合 〔星击〕玩家造成6点伤害\n- 第2回合 敌人被击败',
});
assert.equal(prompt.resultText, '胜利');
assert.match(prompt.battleSummary, /祝福2层/);
assert.match(prompt.battleSummary, /使用了叙事卡牌：破门 - 改变了战场。/);
assert.match(prompt.battleSummary, /【战斗过程】/);
assert.match(prompt.battleSummary, /〔星击〕玩家造成6点伤害/);
assert.match(
  prompt.promptedBattleSummary,
  /\[战斗后续\] ordinary\n\[战斗结算\]\n\[奖励预算\] cards=3\n\[构筑建议\] 防御\n\[剧情模型要求\] 只输出战后剧情正文，不输出选项、JSON、<UpdateVariable> 或更新命令。奖励和经验由随后运行的 MVU 额外模型按预算登记。玩家会通过自定义行动继续剧情。$/,
);
const runPrompt = core.formatBattleEndPrompt({
  ...{
    result: 'defeat',
    continuation: 'run',
    player: {
      hp: 0,
      maxHp: 20,
      lust: 3,
      maxLust: 100,
      energy: 0,
      statuses: [],
      handCount: 0,
      drawPileCount: 0,
      discardPileCount: 10,
    },
    turns: 3,
  },
});
assert.match(
  runPrompt.promptedBattleSummary,
  /\[战斗后续\] run\n\[战斗结算\]\n\[剧情模型要求\] 只输出战后剧情正文，不输出选项、JSON、<UpdateVariable> 或更新命令。不得叙述尚未发生的胜利奖励。远征路线由程序继续。$/,
);

const terminatedOrdinaryPrompt = core.formatBattleEndPrompt({
  result: 'terminated',
  continuation: 'ordinary',
  player: {
    hp: 10,
    maxHp: 20,
    lust: 3,
    maxLust: 100,
    energy: 0,
    statuses: [],
    handCount: 0,
    drawPileCount: 0,
    discardPileCount: 0,
  },
  turns: 1,
});
assert.match(
  terminatedOrdinaryPrompt.promptedBattleSummary,
  /\[剧情模型要求\].*只输出战后剧情正文.*玩家会通过自定义行动继续剧情。$/,
);

const stateSource = await readFile(resolve('src/game-core/battleState.ts'), 'utf8');
assert.match(stateSource, /setBattleOutcome\(result: BattleEndResult/);
assert.match(stateSource, /transitionToBattleEnd\(this\.gameState, result, narrativeText\)/);
assert.doesNotMatch(stateSource, /setGameOver\(|setBattleTerminated\(/);
const executorSource = await readFile(resolve('src/fish/combat/unifiedEffectExecutor.ts'), 'utf8');
assert.match(executorSource, /processPendingDeaths[\s\S]*this\.gameStateManager\.isGameOver\(\)[\s\S]*this\.pendingDeaths\.clear\(\)/);

console.log('One portable terminal state machine owns death priority, recovery, and end-prompt formatting.');
