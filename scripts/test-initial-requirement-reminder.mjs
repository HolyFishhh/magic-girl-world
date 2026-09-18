import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { initialDraftAuthoringPrompt } = require('../src/sillytavern-extension/initialDraftPrompt.ts');
const input = {
  startPrompt: '开始', config: { card: '状态触发生成临时牌\n保留“自选”收益', towerRequirements: '奖励不要提前生效' },
  narrative: '已经成立的剧情', currentStat: {}, designGuidance: null,
};
const before = JSON.stringify(input);
const prompt = initialDraftAuthoringPrompt(input);
const marker = prompt.lastIndexOf('[提交前核对实际玩法');
assert.ok(marker > prompt.indexOf('[完整玩法语义与执行契约'));
for (const [key,value] of [['REQUESTED_CARD_DESIGN',input.config.card],['REQUESTED_TOWER_RULES',input.config.towerRequirements]]) {
  const encoded=`${key}=${JSON.stringify(value)}`;
  assert.equal(prompt.split(encoded).length,2,'verbatim task data occurs once');
  assert.ok(prompt.indexOf(encoded)>prompt.indexOf('[完整玩法语义与执行契约'),'concrete task follows long reference');
  assert.ok(prompt.indexOf(encoded)<marker,'task precedes final submission checks');
}
assert.ok(prompt.slice(marker).includes('语义等价'));
assert.ok(prompt.slice(marker).includes('不新增输出字段'));
assert.equal(JSON.stringify(input), before);
const empty = initialDraftAuthoringPrompt({ ...input, config: {} });
assert.ok(empty.includes('REQUESTED_CARD_DESIGN=""'));
assert.ok(empty.slice(empty.lastIndexOf('[提交前核对实际玩法')).includes('不照抄未要求的示例机制'));
console.log('PASS verbatim task data once after reference, final semantic reminder, escaping and input immutability; no claim of model compliance.');
