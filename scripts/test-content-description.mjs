import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const {
  canGenerateCompactStatusDescription,
  describeCompactCard,
  describeCompactCardWhenNeeded,
  describeCompactContent,
  describeCompactEffectList,
  describeCompactStatus,
  normalizeChinesePlayerDescription,
  isMechanicalDescriptionRestatement,
  compileCompactEffectList,
} = require(resolve('src/game-core/index.ts'));

assert.equal(normalizeChinesePlayerDescription('疾风般的连续攻势。'), '疾风般的连续攻势。');
assert.equal(normalizeChinesePlayerDescription('造成 opponent.status.death_mark.stacks * 10 点伤害。'), '');
assert.equal(normalizeChinesePlayerDescription('Apply death_mark to opponent.'), '');
assert.equal(isMechanicalDescriptionRestatement('造成8点伤害，并向对方施加2层印记。'), true);
assert.equal(isMechanicalDescriptionRestatement('疾风般的连续攻势，在目标身上留下战斗痕迹。'), false);

assert.equal(
  describeCompactCard({
    type: 'Attack',
    innate: true,
    effects: [{ damage: 8 }, { block: 3 }],
  }),
  '固有。对敌方造成8点伤害；获得3点格挡。',
);

assert.equal(
  describeCompactCard({ type: 'Attack', effects: { block: 3, damage: 8 } }),
  '对敌方造成8点伤害，并获得3点格挡。',
  'single-object bundles use the same canonical order as the compiler',
);

assert.equal(
  describeCompactCard({ type: 'Attack', effects: { damage: 4, hits: 3 } }),
  '对敌方造成3次4点伤害。',
  'multi-hit damage stays one shallow AI object but has per-hit player-facing semantics',
);

assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 'self.exhaust_pile_size * 2' } }),
  '获得消耗堆数量 * 2点格挡。',
);

assert.equal(
  describeCompactCard({ type: 'Attack', effects: { damage: 'turn_number + attacks_played_this_turn * 2' } }),
  '对敌方造成当前回合数 + 本回合攻击牌数 * 2点伤害。',
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
  describeCompactContent(
    { effects: { damage: 5, apply_status: 'weak', stacks: 2, when: 'opponent.hp > 0' } },
    { statusNames: { weak: '虚弱' } },
  ),
  '当敌方生命高于0时，对敌方造成5点伤害，并向敌方施加2层虚弱。',
  'shared bundle conditions are described once',
);

assert.equal(
  describeCompactCard({
    type: 'Power',
    trigger: 'turn_start',
    effects: [{ block: 4 }, { draw: 1, when: 'self.hp < self.max_hp / 2' }],
  }),
  '消耗。回合开始时，获得4点格挡；当自身生命低于自身最大生命的一半时，抽1张牌。',
);

assert.equal(
  describeCompactCard({
    type: 'Power',
    trigger: 'turn_start',
    effects: [{ block: 4 }, { damage: 2, on: 'take_damage' }],
  }),
  '消耗。回合开始时，获得4点格挡；受到伤害时，对敌方造成2点伤害。',
);

assert.equal(
  describeCompactCard(
    {
      type: 'Attack',
      effects: [{ damage: 'self.status.focus.stacks * 2' }],
    },
    { statusNames: { focus: '专注' } },
  ),
  '对敌方造成自身专注层数 * 2点伤害。',
  'status IDs inside formulas are rendered with their registered Chinese names',
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
  '将2张火花加入手牌。此牌被战斗效果弃掉后，抽1张牌。',
);

assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 1 }, discard_effects: { block: 5 } }),
  '获得1点格挡。此牌被战斗效果弃掉后，获得5点格挡。',
  'discard payoff states the card, timing, and exact result',
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
  '向敌方施加2层余烬印记；移除自身的虚弱。',
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
  '持续生效，自身造成的伤害增加2。',
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
  '持续生效，自身造成的伤害增加当前层数；回合结束时，对自身造成当前层数点伤害；回合结束后减少1层；最多叠加12层。',
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
assert.equal(generated.value.steps[0].card.description, '');

const generatedStatusCard = compileCompactEffectList([{ add_card: 'ember' }], {
  creates: [{ id: 'ember', name: '余烬牌', type: 'Skill', effects: [{ apply_status: 'ember_mark' }] }],
  statusNames: { ember_mark: '余烬印记' },
});
assert.equal(generatedStatusCard.ok, true);
assert.equal(generatedStatusCard.value.steps[0].card.description, '');

assert.equal(
  describeCompactCardWhenNeeded({ type: 'Attack', effects: { damage: 6 } }),
  '',
  'literal effects rely on the authoritative UI tags instead of duplicating them',
);
assert.equal(
  describeCompactCardWhenNeeded({ type: 'Skill', effects: { block: 1 }, discard_effects: { block: 5 } }),
  '此牌被战斗效果弃掉后，获得5点格挡。',
  'literal discard effects still require an explicit rule description',
);
assert.equal(
  describeCompactCardWhenNeeded(
    { type: 'Attack', effects: { damage: 'opponent.status.death_mark.stacks * 10' } },
    { statusNames: { death_mark: '死印' } },
  ),
  '对敌方造成敌方死印层数 * 10点伤害。',
  'formula-heavy cards receive a fully Chinese rules fallback',
);

console.log('Compact card rules generate deterministic player-facing descriptions without AI prose.');
