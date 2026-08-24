import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const {
  canGenerateCompactStatusDescription,
  describeCompactCard,
  describeCompactContent,
  describeCompactEffectList,
  describeCompactStatus,
  compileCompactEffectList,
} = require(resolve('src/game-core/index.ts'));

assert.equal(
  describeCompactCard({
    type: 'Attack',
    innate: true,
    effects: [{ damage: 8 }, { block: 3 }],
  }),
  '固有。造成8点伤害；获得3点格挡。',
);

assert.equal(
  describeCompactCard({ type: 'Attack', effects: { block: 3, damage: 8 } }),
  '造成8点伤害，并获得3点格挡。',
  'single-object bundles use the same canonical order as the compiler',
);

assert.equal(
  describeCompactCard({ type: 'Attack', effects: { damage: 4, hits: 3 } }),
  '造成3次4点伤害。',
  'multi-hit damage stays one shallow AI object but has per-hit player-facing semantics',
);

assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 'self.exhaust_pile_size * 2' } }),
  '获得消耗堆数量 * 2点格挡。',
);

assert.equal(
  describeCompactCard({ type: 'Attack', effects: { damage: 'turn_number + attacks_played_this_turn * 2' } }),
  '造成当前回合数 + 本回合攻击牌数 * 2点伤害。',
);

assert.equal(
  describeCompactContent({ trigger: 'on_exhaust', effects: { block: 2 } }),
  '消耗牌时，获得2点格挡。',
);

assert.equal(
  describeCompactContent({ trigger: 'attack_played', effects: { block: 2 } }),
  '打出攻击牌时，获得2点格挡。',
);

assert.equal(
  describeCompactContent({ trigger: 'skill_played', effects: { draw: 1 } }),
  '打出技能牌时，抽1张牌。',
);

assert.equal(
  describeCompactContent({ trigger: 'power_played', effects: { energy: 1 } }),
  '打出能力牌时，获得1点能量。',
);

assert.equal(describeCompactContent({ trigger: 'on_draw', effects: { block: 1 } }), '抽牌时，获得1点格挡。');
assert.equal(describeCompactContent({ trigger: 'on_shuffle', effects: { energy: 1 } }), '洗牌时，获得1点能量。');

assert.equal(
  describeCompactContent({ effects: { damage: 5, apply_status: 'weak', stacks: 2, when: 'opponent.hp > 0' } }),
  '若对方生命 > 0，造成5点伤害，并向对方施加2层weak。',
  'shared bundle conditions are described once',
);

assert.equal(
  describeCompactCard({
    type: 'Power',
    trigger: 'turn_start',
    effects: [{ block: 4 }, { draw: 1, when: 'self.hp < self.max_hp / 2' }],
  }),
  '消耗。回合开始时，获得4点格挡；若自身生命 < 自身最大生命 / 2，抽1张牌。',
);

assert.equal(
  describeCompactCard({
    type: 'Power',
    trigger: 'turn_start',
    effects: [{ block: 4 }, { damage: 2, on: 'take_damage' }],
  }),
  '消耗。回合开始时，获得4点格挡；受到伤害时，造成2点伤害。',
);

assert.equal(
  describeCompactCard({
    type: 'Attack',
    effects: [{ damage: 'self.status.focus.stacks * 2' }],
  }),
  '造成自身focus层数 * 2点伤害。',
);

assert.equal(
  describeCompactCard({
    type: 'Curse',
    effects: [{ damage: 1, to: 'self' }],
  }),
  '回合结束时，对自身造成1点伤害。',
);

assert.equal(
  describeCompactCard({
    type: 'Skill',
    effects: [{ add_card: 'spark', count: 2 }],
    discard_effects: [{ draw: 1 }],
    creates: [{ id: 'spark', name: '火花', effects: [{ damage: 3 }] }],
  }),
  '将2张火花加入手牌。被效果弃掉时，抽1张牌。',
);

assert.equal(
  describeCompactCard(
    {
      type: 'Skill',
      effects: [
        { apply_status: 'ember_mark', stacks: 2 },
        { remove_status: 'weak', to: 'self' },
      ],
    },
    { statusNames: { ember_mark: '余烬印记', weak: '虚弱' } },
  ),
  '向对方施加2层余烬印记；移除自身的虚弱。',
);

assert.equal(
  describeCompactEffectList([
    { seek: 1 },
    { scry: 3 },
    { discard: 2 },
    { exhaust: 'all', from: 'discard' },
    { recover: 1, from: 'exhaust', pick: 'choose' },
    { reduce_cost: 1, count: 2, pick: 'choose' },
  ]),
  '从抽牌堆选择1张牌加入手牌；查看抽牌堆顶3张牌，可将任意张置入弃牌堆；弃掉随机2张手牌；消耗弃牌堆中的所有牌；从消耗堆选择1张牌取回手牌；使选择2张手牌费用降低1',
);

assert.equal(describeCompactContent({ trigger: 'battle_start', effects: [{ block: 3 }] }), '战斗开始时，获得3点格挡。');
assert.equal(
  describeCompactContent({ trigger: 'passive', effects: [{ modify: 'damage', add: 2 }] }),
  '持续生效，自身的伤害增加2。',
);
assert.equal(
  describeCompactContent(
    { effects: [{ apply_status: 'focus', stacks: 2, to: 'self' }] },
    { statusNames: { focus: '聚焦' } },
  ),
  '向自身施加2层聚焦。',
);
assert.equal(
  describeCompactStatus(
    {
      triggers: {
        hold: [{ modify: 'damage', add: 'stacks' }],
        tick: [{ damage: 'stacks', to: 'self' }],
      },
      stacks_change: -1,
      maxStacks: 12,
    },
    { statusNames: { focus: '聚焦' } },
  ),
  '持续生效，自身的伤害增加当前层数；回合结束时，对自身造成当前层数点伤害；回合结束后减少1层；最多叠加12层。',
);
assert.equal(
  describeCompactStatus({ stun: true, stacks_change: 'reset', triggers: {} }),
  '持有时无法行动；回合结束后移除。',
);
assert.equal(canGenerateCompactStatusDescription({ triggers: { tick: 'removed string format' } }), false);
assert.equal(canGenerateCompactStatusDescription({ triggers: { tick: [{ damage: 'stacks', to: 'self' }] } }), true);
assert.equal(canGenerateCompactStatusDescription({ triggers: { tick: { damage: 'stacks', to: 'self' } } }), true);

const generated = compileCompactEffectList([{ add_card: 'spark' }], {
  creates: [{ id: 'spark', name: '火花', type: 'Attack', cost: 0, effects: [{ damage: 3 }], exhaust: true }],
});
assert.equal(generated.ok, true);
assert.equal(generated.value.steps[0].card.description, '造成3点伤害。');

const generatedStatusCard = compileCompactEffectList([{ add_card: 'ember' }], {
  creates: [{ id: 'ember', name: '余烬牌', type: 'Skill', effects: [{ apply_status: 'ember_mark' }] }],
  statusNames: { ember_mark: '余烬印记' },
});
assert.equal(generatedStatusCard.ok, true);
assert.equal(generatedStatusCard.value.steps[0].card.description, '向对方施加1层余烬印记。');

console.log('Compact card rules generate deterministic player-facing descriptions without AI prose.');
