import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');

const { EffectProgramDisplay } = require(resolve('src/fish/ui/effectProgramDisplay.ts'));
const { DynamicStatusManager } = require(resolve('src/fish/combat/dynamicStatusManager.ts'));
const { compactContentToDisplayTags } = require(resolve('src/game-core/effectDisplay.ts'));

const manager = DynamicStatusManager.getInstance();
const loaded = manager.registry.replace([
  {
    id: 'death_mark',
    name: '死印',
    emoji: '◆',
    type: 'debuff',
    stacks_change: -1,
    triggers: { tick: { damage: 'stacks', to: 'self' } },
  },
]);
assert.equal(loaded.rejected.length, 0);

const display = EffectProgramDisplay.getInstance();
const tags = display.programToTags({
  spec: 'mwg.effect/v1',
  steps: [
    {
      op: 'damage',
      target: 'opponent',
      amount: {
        op: 'multiply',
        left: { op: 'var', path: 'opponent.status.death_mark.stacks' },
        right: 10,
      },
    },
    { op: 'apply_status', target: 'opponent', status: 'death_mark', stacks: 2 },
    { op: 'set_stat', target: 'self', stat: 'energy', value: 3 },
    { op: 'recover_cards', source: 'discard', pick: 'choose', amount: 1 },
    { op: 'modify', target: 'self', stat: 'damage_taken', operator: 'multiply', value: 0.5 },
  ],
});

assert.deepEqual(
  tags.map(entry => entry.text),
  [
    '对敌方造成(敌方死印层数×10)点伤害',
    '敌方获得2层死印',
    '将自身能量设为3',
    '从弃牌堆取回1张牌',
    '自身受到的伤害×0.5',
  ],
);

const multiHitTags = compactContentToDisplayTags({ effects: { damage: 4, hits: 3 } });
assert.deepEqual(multiHitTags.map(entry => entry.text), ['对敌方造成4点伤害 ×3']);
assert.doesNotMatch(tags.map(entry => entry.text).join(' '), /death_mark|opponent\.status|damage_taken|discard/);

const structuredTags = compactContentToDisplayTags(
  {
    type: 'Power',
    effects: { block: 4 },
    trigger: { on: 'deal_damage', effects: { apply_status: 'death_mark', stacks: 1, to: 'opponent' } },
  },
  { statusNames: { death_mark: '死印' } },
);
assert.deepEqual(
  structuredTags.map(entry => entry.text),
  ['自身获得4点格挡', '造成伤害时：敌方获得1层死印'],
);

const conditionalTags = compactContentToDisplayTags({ effects: { block: 5, when: 'self.hp < self.max_hp / 2' } });
assert.deepEqual(conditionalTags.map(entry => entry.text), ['当自身生命低于自身最大生命的一半时，自身获得5点格挡']);

const discardTags = compactContentToDisplayTags({
  type: 'Skill',
  effects: { block: 1 },
  discard_effects: { block: 5 },
});
assert.deepEqual(
  discardTags.map(entry => entry.text),
  ['自身获得1点格挡', '此牌被战斗效果弃掉后：自身获得5点格挡'],
);

const coreSource = readFileSync(resolve('src/game-core/effectDisplay.ts'), 'utf8');
const battleAdapterSource = readFileSync(resolve('src/fish/ui/effectProgramDisplay.ts'), 'utf8');
const commonPageSource = readFileSync(resolve('src/common/index.ts'), 'utf8');

assert.match(coreSource, /function nodeTags\(/);
assert.match(coreSource, /switch \(node\.op\)/);
assert.match(battleAdapterSource, /effectProgramToDisplayTags/);
assert.doesNotMatch(battleAdapterSource, /switch \(node\.op\)/);
assert.match(commonPageSource, /compactContentToDisplayTags/);
assert.match(commonPageSource, /compactContentEffectTagsHtml\(card\)/);
assert.match(commonPageSource, /compactContentEffectTagsHtml\(artifact\)/);
assert.match(commonPageSource, /compactContentEffectTagsHtml\(item\)/);
assert.doesNotMatch(commonPageSource, /简化显示，不显示详细效果/);
assert.doesNotMatch(commonPageSource, /switch \(node\.op\)/);

console.log('Effect tags use one shared core for battle and common/reward pages.');
