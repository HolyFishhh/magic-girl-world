import assert from 'node:assert/strict';
import './test-status-reference-presentation.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { presentCompactContent, formatCompactContentPresentation } = require(resolve('src/game-core/contentPresentation.ts'));

const card = { type: 'Skill', cost: 1, effects: [{ block: 5 }], description: '每当打出技能牌时获得充能' };
const cardText = presentCompactContent(card, 'card');
assert.match(cardText.rulesText, /格挡/);
assert.match(cardText.rulesText, /5/);
assert.doesNotMatch(cardText.rulesText, /充能/);
assert.equal(cardText.flavorText, card.description);
assert.match(formatCompactContentPresentation(cardText), /^叙述：.+\n规则：/);
const status = { id: 'code_reuse', name: '代码复用', emoji: '♻️', type: 'buff', triggers: { hold: [{ modify: 'block', add: 2 }] }, description: '打出技能牌时获得资源' };
const statusText = presentCompactContent(status, 'status');
assert.equal(statusText.flavorText, status.description);
assert.match(statusText.rulesText, /持续生效/);
assert.match(statusText.rulesText, /格挡/);
assert.doesNotMatch(statusText.rulesText, /技能牌/);
// A layer-only marker is legal, but must not look like an implemented bonus.
// Do not infer mechanics from prose or claim that no future rule can read it.
const marker = { id: 'whistle_echo', name: '哨音回响', emoji: '🌬️', type: 'buff',
  triggers: {}, stacks_change: 'keep', description: '使风炉中更容易召集增援（本场战斗效果）。' };
const markerBefore = structuredClone(marker);
for (const extra of [{}, { maxStacks: 3 }, { stacks_change: 'reset' }, { stacks_change: -1 }]) {
  const text = presentCompactContent({ ...marker, ...extra }, 'status');
  assert.match(text.rulesText, /仅记录状态层数，自身没有额外行动或数值修饰/);
  assert.match(text.rulesText, /可供其他规则读取/);
  assert.doesNotMatch(text.rulesText, /增援|召集/);
  assert.equal(text.flavorText, marker.description);
}
assert.deepEqual(marker, markerBefore);
assert.doesNotMatch(presentCompactContent({ ...marker, stun: true }, 'status').rulesText, /自身没有/);
assert.doesNotMatch(statusText.rulesText, /自身没有/);
assert.match(presentCompactContent({ ...marker, triggers: { tick: { damage: 1, to: 'self' } } }, 'status').rulesText, /1点伤害/);
const triggered = { trigger: { on: 'skill_played', effects: [{ resource: { id: 'charge', amount: 1 } }] } };
const triggerText = presentCompactContent(triggered, 'content', { resourceNames: { charge: '充能' } });
assert.match(triggerText.rulesText, /技能牌/);
assert.match(triggerText.rulesText, /充能/);
const limited = presentCompactContent({ trigger: { ...triggered.trigger, ordinal: 'every_n', n: 2, scope: 'turn' } }, 'content');
assert.match(limited.rulesText, /每回合/);
assert.doesNotMatch(limited.rulesText, /计数范围/);
assert.doesNotMatch(limited.rulesText, /仅限本回合/);
assert.match(limited.rulesText, /每2次/);
assert.match(limited.rulesText, /技能牌/);
assert.doesNotMatch(limited.rulesText, /结算后/);
const { describeTriggerEventQuery } = require(resolve('src/game-core/triggerDescription.ts'));
for (const [scope, name] of Object.entries({ turn: '每回合', combat: '本场战斗', run: '本局游戏',
  card_instance: '当前卡牌实例', team: '当前阵营' })) {
  const input = { scope, ordinal: 'first' }, before = structuredClone(input);
  assert.equal(describeTriggerEventQuery(input), `（${name}首次）`);
  assert.deepEqual(input, before);
}
assert.equal(describeTriggerEventQuery({ scope: 'turn', turn: 4, ordinal: 'nth', n: 2 }),
  '（每回合第2次、第4回合）', 'explicit turn filter remains visible');
assert.equal(describeTriggerEventQuery(undefined), '');
const received = presentCompactContent({ trigger: { on: 'take_damage', ordinal: 'first', effects: { block: 2 } } }, 'content');
assert.match(received.rulesText, /首次/);
assert.doesNotMatch(received.rulesText, /结算时/);
assert.doesNotMatch(received.rulesText, /结算后/);
const inferredMetadata = { ...triggered.trigger, ordinal: 'nth', n: 2 };
const explicitMetadata = { ...inferredMetadata, event: 'card_played', phase: 'after', card_type: 'Skill' };
assert.equal(
  presentCompactContent({ trigger: inferredMetadata }, 'content').rulesText,
  presentCompactContent({ trigger: explicitMetadata }, 'content').rulesText,
  'omitting deterministic technical fields changes neither mechanics nor visible rules',
);
for (const [source, kind] of [[card, 'card'], [status, 'status'], [triggered, 'content']]) {
  const original = structuredClone(source);
  const a = presentCompactContent({ ...source, description: '星海在你的掌心燃烧' }, kind);
  const b = presentCompactContent({ ...source, description: '这一击让所有敌人消失' }, kind);
  assert.equal(a.rulesText, b.rulesText, 'rules never depend on authored prose');
  assert.deepEqual(source, original, 'presentation never alters mechanics');
}
console.log('Rules and flavor are separate; simple effects and mismatched authored descriptions cannot replace derived rules.');
