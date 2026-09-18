import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const bleed = {
  id: 'bleed',
  name: '流血',
  emoji: '🩸',
  type: 'debuff',
  stacks_change: -1,
  maxStacks: 12,
  triggers: { tick: { damage: 'stacks', to: 'self' } },
};
assert.equal(core.validateCompactStatusDefinition(bleed).ok, true);
assert.equal(core.validateCompactStatusDefinition({ ...bleed, triggers: { tick: 'ME.hp - stacks' } }).ok, false);
assert.equal(core.validateCompactStatusDefinition({ ...bleed, max_stacks: 12 }).ok, false);
assert.equal(core.validateCompactStatusDefinition({ ...bleed, triggers: { hold: { damage: 1 } } }).ok, false);
const layeredStatusIssues = core.collectCompactStatusDefinitionIssues({
  ...bleed,
  stacks_change: '-1',
  triggers: { hold: { modify: 'actions_per_activation', add: 1 } },
});
assert.match(layeredStatusIssues.join('；'), /状态 stacks_change 无效/);
assert.match(layeredStatusIssues.join('；'), /triggers\.hold\.modify: Unsupported modifier: actions_per_activation/);
assert.match(
  core.validateCompactStatusDefinition({
    ...bleed,
    stacks_change: '-1',
    triggers: { hold: { modify: 'actions_per_activation', add: 1 } },
  }).message,
  /状态 stacks_change 无效/,
  'the compatibility validator still returns the first issue',
);

const eventState = {
  id: 'event_state',
  name: '事件状态',
  emoji: '↗️',
  type: 'buff',
  stacks_change: 'reset',
  triggers: { attack_played: { energy: 'stacks' } },
};
assert.equal(core.validateCompactStatusDefinition(eventState).ok, true);
assert.equal(
  core.validateCompactStatusDefinition({
    ...eventState,
    triggers: { hold: { on: 'attack_played', effects: { energy: 1 } } },
  }).ok,
  false,
  'event listeners are direct trigger keys and must never be wrapped inside hold',
);
assert.equal(
  core.validateCompactStatusDefinition({
    ...eventState,
    triggers: { attack_played: { modify: 'damage', add: 1 } },
  }).ok,
  false,
  'one-shot status events cannot smuggle continuous modifiers outside hold',
);
assert.match(core.describeCompactStatus(eventState), /打出攻击牌时，获得当前层数点能量/);

const echoState = {
  id: 'echo_state',
  name: '回响状态',
  emoji: '🔁',
  type: 'buff',
  stacks_change: 'keep',
  triggers: { hold: { card_rule: 'replay', limit: 'stacks', extra: 1 } },
};
assert.equal(core.validateCompactStatusDefinition(echoState).ok, true);
assert.equal(
  core.validateCompactStatusDefinition({ ...echoState, triggers: { tick: echoState.triggers.hold } }).ok,
  false,
  'card play rules are continuous hold effects, not tick effects',
);

const registry = new core.StatusDefinitionRegistry();
const loaded = registry.replace([bleed]);
assert.deepEqual(loaded.rejected, []);
assert.equal(loaded.loaded[0].maxStacks, 12);
assert.equal(registry.getTriggerEffects('bleed', 'tick')[0].spec, 'mwg.effect/v1');
const eventLoaded = registry.replace([eventState]);
assert.equal(eventLoaded.loaded.length, 1);
assert.equal(registry.getTriggerEffects('event_state', 'attack_played')[0].steps[0].op, 'gain_energy');

const mismatch = {
  id: 'code_reuse', name: '代码复用', emoji: '♻️', type: 'buff',
  description: '打出技能牌时获得资源',
  triggers: { hold: [{ modify: 'block', add: 2 }] },
};
const mismatchRuntime = core.normalizeRuntimeStatusDefinition(mismatch);
assert.ok(mismatchRuntime);
assert.match(mismatchRuntime.description, /持续生效.*格挡/);
assert.doesNotMatch(mismatchRuntime.description, /技能牌|资源/);
assert.equal(mismatchRuntime.flavorText, mismatch.description, 'flavor is retained but cannot override mechanics');
assert.equal(core.normalizeRuntimeStatusDefinition({ ...mismatch, description: '换一段完全不同的文字' }).description, mismatchRuntime.description);

const marker = { id: 'whistle_echo', name: '哨音回响', emoji: '🌬️', type: 'buff',
  description: '使风炉中更容易召集增援（本场战斗效果）。', stacks_change: 'keep', triggers: {} };
const markerBefore = structuredClone(marker);
assert.equal(core.validateCompactStatusDefinition(marker).ok, true, 'layer-only markers remain legal');
const markerRuntime = core.normalizeRuntimeStatusDefinition(marker);
assert.match(markerRuntime.description, /自身没有额外行动或数值修饰.*可供其他规则读取/);
assert.doesNotMatch(markerRuntime.description, /增援|召集/);
assert.equal(markerRuntime.flavorText, marker.description);
assert.deepEqual(markerRuntime.triggers, {}, 'presentation must not invent summon behavior');
assert.deepEqual(registry.replace([marker]).rejected, []);
const observer = core.compileCompactEffectList({ damage: 'self.status.whistle_echo.stacks' });
assert.equal(observer.ok, true);
assert.deepEqual([...core.collectEffectProgramStatusReferences(observer.value)], ['whistle_echo']);
assert.deepEqual(marker, markerBefore, 'neither registration nor display may rewrite the authored source');

console.log('Modern shallow status definitions passed.');
