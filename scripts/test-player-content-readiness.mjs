import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const readyPack = core.createContentPack({
  cards: [
    { id: 'strike', name: '斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
    { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
  ],
  statuses: [],
  relics: [{ id: 'stone', name: '生命之石', rarity: 'Common', trigger: 'battle_start', effects: { block: 2 } }],
  items: [{ id: 'tonic', name: '微光药剂', count: 1, effects: { heal: 8 } }],
  abilities: [],
  activeStatuses: [],
  playerDesireEffect: { name: '星蚀', effects: { damage: 6 } },
});

const ready = core.assessInitialPlayerContent(readyPack, {
  emoji: '🧙',
  hp: 80,
  maxHp: 80,
  lust: 0,
  maxLust: 100,
  level: 1,
  exp: 0,
});
assert.equal(ready.ok, true);
assert.equal(ready.deck.deckQuantity, 10);
assert.equal(core.formatPlayerContentReadiness(ready), '初始战斗内容已就绪');
assert.equal(core.formatPlayerContentRepairPrompt(ready), '');

const expandedDeck = core.assessInitialPlayerContent(
  {
    ...readyPack,
    cards: readyPack.cards.map(card => ({ ...card, quantity: 7 })),
  },
);
assert.equal(expandedDeck.deck.deckQuantity, 14);
assert.equal(expandedDeck.ok, true, '合法卡组不应因总 quantity 超过 13 被拒绝');
assert.ok(!expandedDeck.issues.some(issue => issue.code === 'DECK_TOO_LARGE'));

const brokenPack = core.createContentPack({
  ...readyPack,
  cards: [
    { id: 'same', name: '昂贵攻击', type: 'Attack', rarity: 'Common', cost: 4, quantity: 2, effects: { damage: 7 } },
    {
      id: 'same',
      name: '错误关键词',
      type: 'Skill',
      rarity: 'Common',
      cost: 4,
      quantity: 1,
      effects: { draw: 1 },
      innate: 'true',
    },
  ],
  relics: [{ id: 'root', name: '生命之根', rarity: 'Common', effects: { block: 2 } }],
});
const broken = core.assessInitialPlayerContent(brokenPack);
assert.equal(broken.ok, false);
assert.ok(broken.issues.some(issue => issue.path === 'battle.cards[1].id' && issue.code === 'DUPLICATE_ID'));
assert.ok(broken.issues.some(issue => issue.path === 'battle.cards[1].innate' && issue.code === 'INVALID_BOOLEAN'));
assert.ok(
  broken.issues.some(issue => issue.path === 'battle.artifacts[0].trigger' && issue.code === 'MISSING_TRIGGER'),
);
assert.ok(broken.issues.some(issue => issue.code === 'DECK_TOO_SMALL'));
assert.ok(broken.issues.some(issue => issue.code === 'NO_PLAYABLE_CARD'));
assert.ok(!broken.issues.some(issue => issue.code === 'NO_DEFENSE_OR_RECOVERY'));

const attackOnly = core.assessInitialPlayerContent(
  core.createContentPack({
    cards: [
      {
        id: 'fast_strike',
        name: '速攻',
        type: 'Attack',
        rarity: 'Common',
        cost: 0,
        quantity: 5,
        effects: { damage: 4 },
      },
      {
        id: 'heavy_strike',
        name: '重击',
        type: 'Attack',
        rarity: 'Common',
        cost: 2,
        quantity: 5,
        effects: { damage: 11 },
      },
    ],
    statuses: [],
    relics: [{ id: 'blade', name: '进攻徽记', rarity: 'Common', trigger: 'battle_start', effects: { energy: 1 } }],
    items: [{ id: 'bomb', name: '投掷炸弹', count: 1, effects: { damage: 8 } }],
    playerDesireEffect: { name: '追击', effects: { damage: 6 } },
  }),
  { emoji: '⚔️', hp: 80, maxHp: 80, lust: 0, maxLust: 100, level: 1, exp: 0 },
);
assert.equal(attackOnly.ok, true, '纯攻击等有明确胜利路径的自由构筑不应被防御偏好阻断');

const display = core.formatPlayerContentReadiness(broken, 2);
assert.match(display, /^battle\.cards\[1\]\.id：ID 重复；/);
assert.match(display, /另有 \d+ 处$/);

const repair = core.formatPlayerContentRepairPrompt(broken, 3);
assert.match(repair, /^\[战斗内容修复\]\n问题=battle\.cards\[1\]\.id\(DUPLICATE_ID\)/);
assert.match(repair, /一次补齐并修正上列全部初始内容/);
assert.match(repair, /不得清空卡组、遗物、道具或欲望效果/);
assert.match(repair, /仅输出世界书规定的一个完整变量更新块/);
assert.match(repair, /约束=.*遗物或独立能力需要合法 trigger/);
assert.doesNotMatch(repair, /昂贵攻击|错误关键词|生命之根/);
assert.ok(repair.length < 900, 'repair request must stay bounded');

const structuralRepair = core.formatPlayerContentRepairPrompt({
  ...broken,
  issues: [
    { path: 'battle.cards[0].effects[1]', code: 'INVALID_EFFECT', message: 'ignored' },
    { path: 'battle.cards[1].effects[0].copy', code: 'INVALID_CARD_COUNT', message: 'ignored' },
    { path: 'battle.cards[2].effects[0].add_card', code: 'INVALID_CARD_ID', message: 'ignored' },
    { path: 'battle.statuses[0].triggers.tick[0]', code: 'INVALID_STATUS', message: 'ignored' },
  ],
});
assert.match(structuralRepair, /hits 只能与 damage 位于同一项/);
assert.match(structuralRepair, /copy\/double 的值直接写数量或 all/);
assert.match(structuralRepair, /creates 中已登记的模板 ID 字符串/);
assert.match(structuralRepair, /持续数值修饰只能写在 hold/);

const modifierRepair = core.formatPlayerContentRepairPrompt({
  ...broken,
  issues: [
    {
      path: 'battle.cards[1].effects[0].damage_modifier',
      code: 'UNKNOWN_EFFECT',
      message: 'ignored',
    },
    {
      path: 'battle.statuses[1].triggers.apply[0]',
      code: 'INVALID_STATUS',
      message: 'ignored',
    },
  ],
});
assert.match(modifierRepair, /damage_modifier 等不是卡牌 effects 操作/);
assert.match(modifierRepair, /持续修饰改为状态 triggers\.hold/);
assert.match(modifierRepair, /apply\/stack\/tick\/remove 只执行瞬时浅层效果/);
assert.ok(modifierRepair.length < 900, 'modifier repair request must stay bounded');

const fullRepair = core.formatPlayerContentRepairPrompt({
  ...broken,
  issues: Array.from({ length: 9 }, (_, index) => ({
    path: `battle.cards[${index}].effects`,
    code: 'INVALID_EFFECT_SOURCE',
    message: 'ignored',
  })),
});
assert.match(
  fullRepair,
  /battle\.cards\[7\]\.effects\(INVALID_EFFECT_SOURCE\),\+1\n任务=一次补齐并修正上列全部初始内容/,
);

const missingResources = core.assessInitialPlayerContent(
  core.createContentPack({ cards: readyPack.cards, statuses: [] }),
  { emoji: '', hp: 120, maxHp: 80, lust: 0, maxLust: 0, level: 0, exp: -1 },
);
for (const code of [
  'MISSING_RELIC',
  'MISSING_ITEM',
  'MISSING_DESIRE_EFFECT',
  'MISSING_PLAYER_EMOJI',
  'INVALID_HP',
  'INVALID_MAX_LUST',
  'INVALID_LEVEL',
  'INVALID_EXP',
]) {
  assert.ok(
    missingResources.issues.some(issue => issue.code === code),
    `missing readiness issue ${code}`,
  );
}

const removedFormat = core.assessInitialPlayerContent(
  core.createContentPack({
    cards: [
      { id: 'old_strike', name: '旧斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effect: 'OP.hp - 6' },
      {
        id: 'old_guard',
        name: '旧防御',
        type: 'Skill',
        rarity: 'Common',
        cost: 1,
        quantity: 5,
        effect: 'ME.block + 5',
      },
    ],
    statuses: [],
    relics: [{ id: 'old_stone', name: '旧护石', rarity: 'Common', effect: 'battle_start(ME.block + 2)' }],
    items: [{ id: 'old_tonic', name: '旧补剂', count: 1, effect: 'ME.hp + 8' }],
    playerDesireEffect: { name: '旧满溢', effect: 'OP.hp - 6' },
  }),
  { emoji: '🧙', hp: 50, maxHp: 50, lust: 0, maxLust: 100, level: 1, exp: 0 },
);
assert.equal(removedFormat.ok, false, 'removed effect strings must be rejected');
assert.ok(removedFormat.issues.some(issue => issue.code === 'REMOVED_EFFECT_FIELD'));

const malformedDsl = core.assessInitialPlayerContent(
  core.createContentPack({
    cards: [
      {
        id: 'bad_amount', name: '错误数值字段', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5,
        effects: [{ damage: 7 }, { block: 4, amount: 4 }],
      },
      {
        id: 'valid_attack', name: '正常攻击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5,
        effects: { damage: 7 },
      },
    ],
    statuses: [{
      id: 'bad_tick', name: '错误状态', emoji: '⚠️', type: 'buff',
      triggers: { tick: { effects: { block: 2 } } },
    }],
    relics: readyPack.relics,
    items: readyPack.items,
    playerDesireEffect: readyPack.desireEffects.player,
  }),
  { emoji: '🧙', hp: 50, maxHp: 50, lust: 0, maxLust: 100, level: 1, exp: 0 },
);
const malformedSummary = core.formatPlayerContentReadiness(malformedDsl, 8);
assert.match(malformedSummary, /battle\.statuses\[0\]\.triggers\.tick：状态定义不合法（具体原因：/);
assert.match(malformedSummary, /battle\.cards\[0\]\.effects\[1\]/);
assert.doesNotMatch(malformedSummary, /battle\.statuses\[0\]：状态定义不合法；/);

console.log('Initial player content is gated by one portable contract and a bounded AI repair request.');
