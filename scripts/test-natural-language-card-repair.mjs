import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const {
  formatNaturalLanguageCardRepairPrompt,
  reconcileNaturalLanguageCardRepair,
  requestNaturalLanguageCardRepair,
} = require(resolve('src/runtime/naturalLanguageCardRepair.ts'));

const prompt = formatNaturalLanguageCardRepairPrompt('把“星火”改成两段攻击，并降低一点伤害');
assert.match(prompt, /^\[玩家自然语言卡牌修复\]/);
assert.match(prompt, /用户要求="把“星火”改成两段攻击，并降低一点伤害"/);
assert.match(prompt, /只按用户要求增量修改相关卡牌/);
assert.match(prompt, /所有非卡牌变量保持不变/);
assert.match(prompt, /只输出一个 <UpdateVariable>/);
assert.match(prompt, /不续写剧情、不输出选项/);
assert.throws(() => formatNaturalLanguageCardRepairPrompt('   '), /请输入希望怎样修复卡牌/);

const original = {
  stat_data: {
    status: { time: '保持不变' },
    battle: {
      cards: [
        { id: 'spark', name: '星火', effects: { damage: 8 } },
        { id: 'guard', name: '守势', effects: { block: 6 } },
      ],
      enemy: { id: 'enemy', hp: 37 },
      artifacts: [{ id: 'keepsake' }],
    },
  },
};
const modelResult = structuredClone(original);
modelResult.stat_data.battle.cards[0] = { id: 'spark', name: '星火', effects: { damage: 4, hits: 2 } };
modelResult.stat_data.battle.enemy.hp = 999;
modelResult.stat_data.status.time = '不应写入';

const reconciled = reconcileNaturalLanguageCardRepair(original, modelResult);
assert.deepEqual(reconciled.stat_data.battle.cards, modelResult.stat_data.battle.cards);
assert.deepEqual(reconciled.stat_data.battle.enemy, original.stat_data.battle.enemy);
assert.deepEqual(reconciled.stat_data.battle.artifacts, original.stat_data.battle.artifacts);
assert.deepEqual(reconciled.stat_data.status, original.stat_data.status);
assert.notEqual(reconciled, original);
assert.throws(() => reconcileNaturalLanguageCardRepair(original, original), /没有按要求修改卡牌/);

let message = '玩家完成了一段剧情。';
let variables = structuredClone(original);
let chatVariables = { preset: { mode: 'story' }, user_owned: { counter: 17 } };
let emitted = '';
let createdMessages = 0;
Object.assign(globalThis, {
  getCurrentMessageId: () => 1,
  getLastMessageId: () => 1,
  getChatMessages: () => [{ message, swipe_id: 0 }],
  getVariables: options => structuredClone(options?.type === 'chat'
    ? chatVariables : options?.type === 'message' && options?.message_id === 0 ? original : variables),
  updateVariablesWith: updater => {
    variables = updater(structuredClone(variables));
  },
  insertOrAssignVariables: value => Object.assign(variables, value),
  replaceVariables: (value, options) => {
    if (options?.type === 'chat') chatVariables = structuredClone(value);
    else variables = structuredClone(value);
  },
  setChatMessages: async updates => {
    message = updates[0].message;
  },
  getAllEnabledScriptButtons: () => ({
    mvu: [{ button_id: 'mvu-extra-retry', button_name: '重试额外模型解析' }],
  }),
  getScriptTrees: () => [],
  eventEmit: async event => {
    emitted = event;
    assert.match(message, /\[玩家自然语言卡牌修复\]/);
    assert.match(message, /用户要求="把星火改成两段攻击"/);
    chatVariables.user_owned.counter = 18;
    variables = structuredClone(original);
    variables.stat_data.battle.cards[0] = { id: 'spark', name: '星火', effects: { damage: 4, hits: 2 } };
    variables.stat_data.battle.enemy.hp = 999;
    message += '\n\n<UpdateVariable><Analysis>Update.</Analysis>\n_.set(\'battle.cards\', []);\n</UpdateVariable>';
  },
  createChatMessages: () => {
    createdMessages += 1;
  },
});

await requestNaturalLanguageCardRepair('把星火改成两段攻击');
assert.equal(emitted, 'mvu-extra-retry');
assert.equal(createdMessages, 0, 'card repair must never create a new chat floor');
assert.equal(variables.stat_data.battle.cards[0].effects.hits, 2);
assert.equal(variables.stat_data.battle.enemy.hp, original.stat_data.battle.enemy.hp);
assert.deepEqual(chatVariables, { preset: { mode: 'story' }, user_owned: { counter: 18 } });
assert.doesNotMatch(message, /MWG_REPAIR_REQUEST|玩家自然语言卡牌修复/);

console.log('Natural-language card repair stays on the MVU card scope and preserves all unrelated variables.');

const {formatNaturalLanguageVariableRepairPrompt,reconcileNaturalLanguageVariableRepair,requestNaturalLanguageVariableRepair}=require(resolve('src/runtime/naturalLanguageCardRepair.ts'));
assert.match(formatNaturalLanguageVariableRepairPrompt('修改buff和剧情'),/剧情模式/);
const semantic=structuredClone(original);semantic.stat_data.status.time='次日';semantic.runtime_metadata='should not persist';
const semResult=reconcileNaturalLanguageVariableRepair(original,semantic);assert.equal(semResult.stat_data.status.time,'次日');assert.equal(semResult.runtime_metadata,undefined);assert.throws(()=>reconcileNaturalLanguageVariableRepair(original,{stat_data:[]}),/有效/);
variables=structuredClone(original);message='原始剧情';
globalThis.eventEmit=async()=>{variables=structuredClone(original);variables.stat_data.status.time='次日';message+='\n<UpdateVariable><Analysis>修改剧情时间</Analysis>_.set("status.time","次日");</UpdateVariable>';};
await assert.rejects(requestNaturalLanguageVariableRepair('将时间改为次日'), /需要持久化结构化修复端点/);
assert.equal(variables.stat_data.status.time,'保持不变');assert.equal(createdMessages,0);assert.deepEqual(variables.stat_data.battle.cards,original.stat_data.battle.cards);
console.log('PASS semantic variable edit refuses unattributable native MVU writes without a persistent endpoint');
