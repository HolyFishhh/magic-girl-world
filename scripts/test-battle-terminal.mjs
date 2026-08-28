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
    maxEnergy: 5,
    drawPerTurn: 3,
    statuses: [{ name: '祝福', stacks: 2, duration: 2, description: '提高下一次攻击的威力。' }],
    handCount: 1,
    drawPileCount: 2,
    discardPileCount: 3,
    cards: [{ name: '星击', count: 2, description: '造成6点伤害。' }],
    relics: [{ name: '星环', description: '首次出牌时获得格挡。' }],
  },
  enemy: { name: '校验体', hp: 0, maxHp: 10, lust: 0, maxLust: 100, energy: 1, maxEnergy: 3, statuses: [] },
  turns: 2,
  playerContinuation: '先检查敌人遗留的法杖，再询问同伴是否受伤。',
  narrativeCards: [{ name: '破门', description: '改变了战场。' }],
  rewardBudget: '[奖励预算] cards=3',
  buildGuidance: '[构筑建议] 防御',
  battleLog: '- 第1回合 〔星击〕玩家造成6点伤害\n- 第2回合 敌人被击败',
});
assert.equal(prompt.resultText, '胜利');
assert.match(prompt.battleSummary, /祝福2层/);
assert.match(prompt.battleSummary, /祝福2层（剩余2回合；提高下一次攻击的威力。）/);
assert.match(prompt.battleSummary, /剩余能量：4\/5/);
assert.match(prompt.battleSummary, /每回合抽牌：3张/);
assert.match(prompt.battleSummary, /能量1\/3/);
assert.match(prompt.battleSummary, /【叙事卡牌使用】[\s\S]*破门：改变了战场。/);
assert.match(prompt.battleSummary, /【按回合战斗摘要】/);
assert.match(prompt.battleSummary, /〔星击〕玩家造成6点伤害/);
assert.match(prompt.battleSummary, /卡牌：星击×2（造成6点伤害。）/);
assert.match(prompt.battleSummary, /遗物：星环（首次出牌时获得格挡。）/);
assert.match(prompt.battleSummary, /【玩家指定的战后行动】先检查敌人遗留的法杖，再询问同伴是否受伤。/);
assert.equal(prompt.promptedBattleSummary, prompt.battleSummary);
assert.doesNotMatch(prompt.promptedBattleSummary, /\[战斗后续\]|\[战斗结算\]|\[奖励预算\]|\[剧情模型要求\]/);
assert.doesNotMatch(prompt.promptedBattleSummary, /随后运行的 MVU|另一个奖励模型|第三个奖励模型/);
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
assert.equal(runPrompt.promptedBattleSummary, runPrompt.battleSummary);
assert.doesNotMatch(runPrompt.promptedBattleSummary, /\[战斗后续\]|\[战败惩罚\]|\[剧情模型要求\]/);
assert.doesNotMatch(prompt.promptedBattleSummary, /\[战败惩罚\]/);

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
assert.equal(terminatedOrdinaryPrompt.promptedBattleSummary, terminatedOrdinaryPrompt.battleSummary);
assert.doesNotMatch(
  terminatedOrdinaryPrompt.promptedBattleSummary,
  /\[战斗后续\]|\[战斗结算\]|\[奖励预算\]|\[剧情模型要求\]/,
);

const stateSource = await readFile(resolve('src/game-core/battleState.ts'), 'utf8');
assert.match(stateSource, /setBattleOutcome\(result: BattleEndResult/);
assert.match(stateSource, /transitionToBattleEnd\(this\.gameState, result, narrativeText\)/);
assert.doesNotMatch(stateSource, /setGameOver\(|setBattleTerminated\(/);
const executorSource = await readFile(resolve('src/fish/combat/unifiedEffectExecutor.ts'), 'utf8');
assert.match(
  executorSource,
  /processPendingDeaths[\s\S]*this\.gameStateManager\.isGameOver\(\)[\s\S]*this\.pendingDeaths\.clear\(\)/,
);

console.log('One portable terminal state machine owns death priority, recovery, and end-prompt formatting.');
