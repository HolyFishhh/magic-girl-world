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

const guardedCard = { type: 'Skill', description: '获得999点生命。', effects: {
  guard: 'self.resource.pressure.current >= 2', effects: [
    { resource: { id: 'pressure', amount: -2 }, to: 'self' }, { draw: 1 },
  ],
} };
const guardedBefore = structuredClone(guardedCard);
const guardedRules = describeCompactCardWhenNeeded(guardedCard, { resourceNames: { pressure: '压力' } });
assert.match(guardedRules, /组条件仅判断一次/);
assert.match(guardedRules, /压力/);
assert.match(guardedRules, /抽.*1/);
assert.doesNotMatch(guardedRules, /999/);
assert.deepEqual(guardedCard, guardedBefore, 'generated rule text never rewrites authored prose or effects');

for (const amount of [2, -2, 0]) {
  const effect = { resource: { id: 'charge', amount } };
  const original = structuredClone(effect);
  const change = amount < 0 ? '减少2点充能' : `获得${amount}点充能`;
  assert.equal(describeCompactEffectList(effect, undefined, {resourceNames:{charge:'充能'}}), change);
  assert.equal(describeCompactEffectList({...effect,to:'opponent'}, undefined, {resourceNames:{charge:'充能'}}), `使敌方${change}`);
  assert.match(describeCompactEffectList({summon_resource:{selector:{owner:'self',pick:'all'},id:'charge',amount}},
    undefined,{resourceNames:{charge:'充能'}}), new RegExp(change));
  assert.deepEqual(effect, original, 'display never changes the resource sign or turns a delta into a cost');
}

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
  '获得消耗堆数量 × 2点格挡。',
);

assert.equal(
  describeCompactCard({ type: 'Attack', effects: { damage: 'turn_number + attacks_played_this_turn * 2' } }),
  '对敌方造成当前回合数 + 本回合使用攻击牌的次数 × 2点伤害。',
);

assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 'self.summon_count * 2' } }),
  '获得自身召唤物数量 × 2点格挡。',
);
assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 6, when: 'self.has_summon' } }),
  '当自身存在召唤物时，获得6点格挡。',
);
assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 6, when: '!self.has_summon' } }),
  '当自身不存在召唤物时，获得6点格挡。',
  'negated summon predicates are rendered as a Chinese absence condition',
);
assert.equal(
  describeCompactCard({ type: 'Attack', effects: { damage: 'opponent.lust >= 8 ? 11 : 7' } }),
  '对敌方造成7点伤害；如果敌方欲望达到8，则造成11点伤害。',
  'ternary damage is rendered from its fallback and condition instead of leaking CEL syntax',
);
assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 'min(opponent.lust, 9)' } }),
  '获得等同于敌方欲望的格挡，最多9点。',
  'capped variable block preserves both the source and maximum in Chinese',
);
assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 'self.ally_count * 2' } }),
  '获得自身存活队友数量 × 2点格挡。',
);
assert.equal(
  describeCompactCard({ type: 'Attack', effects: { damage: 6, when: 'opponent.has_ally' } }),
  '当敌方仍有存活队友时，对敌方造成6点伤害。',
);
assert.equal(
  describeCompactCard({ type: 'Skill', effects: { block: 5, when: "event.damage_type == 'attack'" } }),
  '当本次伤害类型等于\'attack\'时，获得5点格挡。',
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
  '当敌方生命高于0时，对敌方造成5点伤害，并为敌方赋予2层虚弱。',
  'shared bundle conditions are described once',
);

assert.equal(
  describeCompactCard({
    type: 'Power',
    trigger: 'turn_start',
    effects: [{ block: 4 }, { draw: 1, when: 'self.hp < self.max_hp / 2' }],
  }),
  '消耗·本场。回合开始时，获得4点格挡；当自身生命低于自身最大生命的一半时，抽1张牌。',
);

assert.equal(
  describeCompactCard({
    type: 'Power',
    trigger: 'turn_start',
    effects: [{ block: 4 }, { damage: 2, on: 'take_damage' }],
  }),
  '消耗·本场。回合开始时，获得4点格挡；受到伤害时，对敌方造成2点伤害。',
);

assert.equal(
  describeCompactCard(
    {
      type: 'Attack',
      effects: [{ damage: 'self.status.focus.stacks * 2' }],
    },
    { statusNames: { focus: '专注' } },
  ),
  '对敌方造成自身专注层数 × 2点伤害。',
  'status IDs inside formulas are rendered with their registered Chinese names',
);

assert.equal(
  describeCompactCard({
    type: 'Curse',
    effects: [{ damage: 1, to: 'self' }],
  }),
  '保留。回合结束时，对自身造成1点伤害。',
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
  '为敌方赋予2层余烬印记；移除自身的虚弱。',
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

assert.equal(
  describeCompactEffectList([{
    choose: 'cut_emotion',
    options: [
      { id: 'irritation', label: '剪出烦躁', effects: { add_card: 'irritation_shard' } },
      { id: 'shame', label: '剪出羞耻', effects: { add_card: 'shame_shard' } },
      { id: 'curiosity', label: '剪出好奇', effects: { add_card: 'curiosity_shard' } },
    ],
  }], [
    { id: 'irritation_shard', name: '烦躁碎片' }, { id: 'shame_shard', name: '羞耻碎片' }, { id: 'curiosity_shard', name: '好奇碎片' },
  ]),
  '选择一项：\n“剪出烦躁”：将1张烦躁碎片加入手牌\n“剪出羞耻”：将1张羞耻碎片加入手牌\n“剪出好奇”：将1张好奇碎片加入手牌',
  'choice prompt precedes its independently rendered options',
);

assert.equal(
  describeCompactEffectList([{
    choose: 'two_routes', count: 2,
    options: [
      { id: 'guard', label: '稳守', effects: { block: 2 } },
      { id: 'strike', label: '强攻', effects: { damage: 3 } },
    ],
  }]),
  '选择2项：\n“稳守”：获得2点格挡\n“强攻”：对敌方造成3点伤害',
  'choice display exposes the selected branch count',
);

assert.equal(
  describeCompactEffectList([{
    modify_summon: { selector: { owner: 'self', pick: 'left', template_id: 'persona_doll' }, stat: 'max_hp', add: 6 },
  }], undefined, { summonNames: { persona_doll: '心象人偶' } }),
  '使我方最早的类型为“心象人偶”的召唤物的最大生命增加6',
  'summon left selector describes creation order without a redundant unit count',
);
assert.equal(
  describeCompactEffectList([{
    modify_summon: { selector: { owner: 'self', pick: 'left', count: 2, template_id: 'persona_doll', slot: 'core', tags: ['guardian', 'metal'] }, stat: 'max_hp', add: 6 },
  }], undefined, { summonNames: { persona_doll: '心象人偶' } }),
  '使我方最早的2个类型为“心象人偶”且位于“core”唯一槽且同时带有“guardian、metal”标签的召唤物的最大生命增加6',
  'summon selector preserves count, template, slot and all required tags',
);
assert.equal(
  describeCompactEffectList([{ damage_summon: { selector: { owner: 'opponent', pick: 'by_id', id: 'enemy_unit_1' }, amount: 3 } }]),
  '对敌方实例“enemy_unit_1”的召唤物造成3点伤害',
  'a stable instance id remains an instance identity rather than a summon type',
);

assert.equal(describeCompactContent({ trigger: 'battle_start', effects: [{ block: 3 }] }), '战斗开始时，获得3点格挡。');
assert.equal(
  describeCompactContent({ trigger: 'passive', effects: [{ modify: 'damage', add: 2 }] }),
  '持续生效，自身造成的伤害增加2。',
);
// Every executable modifier must have a truthful rule label, including the
// summon-capacity Power returned by real independent opening sample 21.
const { MODIFIER_ATTRIBUTE_BY_STAT } = require(resolve('src/game-core/modifierMath.ts'));
const modifierSubjects = {
  damage: '造成的伤害', damage_taken: '受到的伤害',
  lust: '造成的欲望伤害', lust_taken: '受到的欲望伤害',
  heal: '的治疗量', block: '获得的格挡', summon_capacity: '的召唤容量', draw_per_turn: '的回合基础抽牌数',
};
assert.deepEqual(Object.keys(modifierSubjects).sort(), Object.keys(MODIFIER_ATTRIBUTE_BY_STAT).sort());
for (const [stat, subject] of Object.entries(modifierSubjects)) {
  for (const [operator, verb] of Object.entries({add:'增加',subtract:'减少',multiply:'乘以',divide:'除以',set:'设为'})) {
    for (const [to, owner] of [['self','自身'],['opponent','敌方']]) {
      const effect = {modify:stat,[operator]:2,to};
      const original = structuredClone(effect);
      assert.equal(describeCompactEffectList(effect), `${owner}${subject}${verb}2`);
      assert.deepEqual(effect, original, 'rule rendering must not change the authored modifier');
    }
  }
}
assert.equal(describeCompactCard({type:'Power',trigger:{on:'passive',effects:{modify:'summon_capacity',add:1}}}),
  '消耗·本场。持续生效，自身的召唤容量增加1。');
assert.equal(
  describeCompactContent({
    trigger: 'passive',
    effects: [{ card_rule: 'replay', limit: 2, extra: 1, card_type: 'Attack' }],
  }),
  '持续生效，每回合前2张符合“攻击牌”的牌额外结算1次。',
  'filtered replay descriptions expose both the filter and the matching-card window',
);
assert.equal(
  describeCompactContent(
    { effects: [{ apply_status: 'focus', stacks: 2, to: 'self' }] },
    { statusNames: { focus: '聚焦' } },
  ),
  '为自身赋予2层聚焦。',
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
  '持续生效，自身造成的伤害增加当前层数；持有者行动前，对自身造成当前层数点伤害；回合结束后减少1层；最多叠加12层。',
);
assert.equal(
  describeCompactStatus({ stun: true, stacks_change: 'reset', triggers: {} }),
  '持有时无法行动；回合结束后移除。',
);
const defenseStatusText = describeCompactStatus({ defense: { retaliate_attack: 'stacks' }, triggers: {} });
assert.match(defenseStatusText, /受到攻击伤害包时反击自身层数点伤害/);
assert.doesNotMatch(defenseStatusText, /仅记录状态层数/);
const protectionStatusText = describeCompactStatus({ protection: { mode: 'intercept', scope: 'all_allies' }, triggers: {} });
assert.doesNotMatch(protectionStatusText, /仅记录状态层数/);
assert.equal(canGenerateCompactStatusDescription({ triggers: { tick: 'removed string format' } }), false);
assert.equal(canGenerateCompactStatusDescription({ triggers: { tick: [{ damage: 'stacks', to: 'self' }] } }), true);
assert.equal(canGenerateCompactStatusDescription({ triggers: { tick: { damage: 'stacks', to: 'self' } } }), true);

const generated = compileCompactEffectList([{ add_card: 'spark' }], {
  creates: [{ id: 'spark', name: '火花', type: 'Attack', cost: 0, effects: [{ damage: 3 }], exhaust: true }],
});
assert.equal(generated.ok, true);
assert.equal(generated.value.steps[0].card.description, '');
assert.equal(
  describeCompactEffectList(
    [{ add_card: 'burden', to: 'discard', count: 2 }],
    [{ id: 'burden', name: '负担' }],
  ),
  '将2张负担加入弃牌堆',
);

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
  '对敌方造成敌方死印层数 × 10点伤害。',
  'formula-heavy cards receive a fully Chinese rules fallback',
);

assert.equal(
  describeCompactEffectList([{
    attach_card: {
      id: 'named_bundle',
      kind: 'affliction',
      name: '迟滞附着',
      scope: 'combat',
      remove_on: 'discarded',
      remaining: 2,
      discard_reasons: ['player_choice'],
      changes: [
        { kind: 'cost', operator: 'add', value: 1 },
        {
          kind: 'discard_auto_play',
          reasons: ['player_choice', 'random_effect'],
          failure_destination: 'exhaust',
          only_player_turn: true,
        },
      ],
    },
    from: 'hand',
    pick: 'choose',
    count: 1,
  }]),
  '使选择1张手牌获得负面附着“迟滞附着”（符合弃牌原因后移除，剩余2次）：费用增加1，因主动选择弃牌、随机效果弃牌从手牌弃掉时免费自动打出，失败后移至消耗堆',
  'named attachment bundles expose their actual rules and lifetime in Chinese',
);

const advancedDescription = describeCompactEffectList([
  {
    patch_card: 'damage', add: 2, scope: 'combat', from: 'hand', pick: 'choose', count: 1,
  },
  {
    upgrade_card: 1, from: 'hand', pick: 'choose', scope: 'run', levels: 2,
    changes: [{ kind: 'numeric', stat: 'block', operator: 'add', value: 3 }],
  },
  { move_card: 1, from: 'discard', pick: 'top', destination: 'draw', position: 'bottom' },
  { remove_card: 1, from: 'hand', pick: 'choose' },
  { transform_card: 'spark', from: 'hand', pick: 'choose', count: 1 },
], [{ id: 'spark', name: '火花' }]);
for (const fragment of ['伤害增加2（本场战斗）', '格挡增加3（本局游戏）', '格挡增加3', '移至抽牌堆底部', '从本场战斗移除', '变形为火花']) {
  assert.match(advancedDescription, new RegExp(fragment));
}

const specialContainerDescription = describeCompactEffectList([
  {
    stance: {
      id: 'flow', name: '流转姿态', enter: { block: 2 },
      passive: { modify: 'damage', add: 1 }, exit: { energy: 1 },
    },
  },
  {
    channel_orb: {
      id: 'echo', name: '回声姿态', value: 3,
      passive: { block: 1 }, evoke: { damage: 4 },
    },
  },
  { evoke_orb: 1, pick: 'first' },
  { orb_slots: 4 },
  { modify_orb: 'value', pick: 'last', multiply: 2 },
  { schedule: 2, phase: 'after_draw', effects: { draw: 1 }, repeat_every: 1, repeats: 2 },
  { extra_turn: 1 },
  { end_turn: true, to: 'opponent' },
]);
for (const fragment of ['流转姿态', '回声姿态', '向姿态槽充能姿态', '被动：获得1点格挡', '激发：对敌方造成4点伤害', '末尾姿态的数值乘以2', '2回合后的抽牌后', '每1回合重复', '获得1个额外回合', '强制结束敌方']) {
  assert.match(specialContainerDescription, new RegExp(fragment));
}
assert.doesNotMatch(specialContainerDescription, /进入时：|持续：自身造成的伤害/, '卡面姿态规则应通过引用详情展开');
assert.doesNotMatch(specialContainerDescription, /\bOrb\b/, 'natural-language card rules use the player-facing stance terminology');

const summonDescription = describeCompactEffectList([
  {
    spawn_summon: {
      id: 'guard', name: '护卫机', emoji: '◇', max_hp: 8,
      actions: [{ id: 'cover', name: '掩护', effects: { summoner_effects: { block: 2 } } }],
    },
  },
  { damage_summon: { selector: { owner: 'self', pick: 'left' }, amount: 2 } },
  { modify_summon_effect: { selector: { owner: 'self', pick: 'all' }, stat: 'damage', add: 1 } },
  { summon_resource: { selector: { owner: 'self', pick: 'all' }, id: 'charge', amount: 1 } },
  { apply_summon_status: { selector: { owner: 'self', pick: 'all' }, id: 'focus', stacks: 2 } },
  { activate_summon: { selector: { owner: 'self', pick: 'right' } } },
  { dismiss_summon: { selector: { owner: 'self', pick: 'left' }, retain_corpse: true } },
  { copy_summon: { selector: { owner: 'self', pick: 'all' }, to: 'same' } },
], undefined, { statusNames: { focus: '专注' }, resourceNames: { charge: '充能' } });
for (const fragment of ['召唤1个“护卫机”', '行动“掩护”', '作用于召唤者：获得2点格挡', '造成2点伤害', '行动与能力伤害增加1', '获得1点充能', '赋予2层专注', '立即激活', '保留倒下记录', '复制我方全部召唤物到原阵营']) {
  assert.match(summonDescription, new RegExp(fragment));
}

const interceptOutline = { id:'wisp', name:'星屑精灵', emoji:'🌟', max_hp:8,
  actions:[{id:'spark',name:'微光冲击',effects:{damage:4}}],
  intercept:{mode:'unblocked_attack',max_per_turn:1} };
const interceptRule = describeCompactEffectList([{spawn_summon:interceptOutline}]);
for (const text of ['8点生命','承接计入召唤者易伤的攻击','每回合最多拦截1次','我方默认3，敌方默认无上限','替换最早召唤物','4点伤害']) {
  assert.ok(interceptRule.includes(text), text);
}
const unboundedIntercept = {...interceptOutline}; delete unboundedIntercept.intercept;
assert.match(describeCompactEffectList([{spawn_summon:unboundedIntercept}]), /承接计入召唤者易伤/);
assert.doesNotMatch(describeCompactEffectList([{spawn_summon:unboundedIntercept}]), /每回合最多/);
for (const patch of [{has_hp:false}, {capabilities:{intercepts:false}}]) {
  const description = describeCompactEffectList([{spawn_summon:{...interceptOutline,...patch,capacity:2,overflow:'reject'}}]);
  assert.match(description,/不拦截攻击/); assert.doesNotMatch(description,/承接计入召唤者易伤/);
  assert.match(description,/容量2.*不再新增/);
}

console.log('Compact card rules generate deterministic player-facing descriptions without AI prose.');
