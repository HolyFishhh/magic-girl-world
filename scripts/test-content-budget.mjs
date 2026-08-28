import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const route = (kind, act = 1) => ({
  act,
  floor: 1,
  kind,
  danger: kind === 'boss' ? 3 : kind === 'elite' ? 2 : 1,
  nodeId: `${kind}_${act}`,
});

assert.deepEqual(core.recommendBattleRewardBudget(route('battle', 1)), {
  cards: { candidates: 3, pick: 1, rarities: ['Common', 'Uncommon'] },
  artifacts: null,
  items: { candidates: 1, pick: 1 },
  experience: 25,
});
assert.equal(
  core.formatBattleRewardBudget(core.recommendBattleRewardBudget(route('elite', 2))),
  'cards=3/1 rarity=Uncommon,Rare artifacts=1/1 exp=60',
);
assert.equal(
  core.formatBattleRewardBudget(core.recommendBattleRewardBudget(route('boss', 3))),
  'cards=3/1 rarity=Rare,Epic artifacts=3/1 exp=115',
);
assert.equal(
  core.formatBattleRewardBudget(core.recommendBattleRewardBudget(null)),
  'cards=3/1 rarity=Common,Uncommon items=1/1 exp=25',
);
assert.equal(
  core.formatBattleRewardBudget(core.recommendBattleRewardBudget(null), { includeExperience: false }),
  'cards=3/1 rarity=Common,Uncommon items=1/1',
);
assert.equal(
  core.formatBattleRewardChecklist(core.recommendBattleRewardBudget(null)),
  'reward.card=3项；reward.artifact=[]；reward.item=1项；reward.limits={"cards":1,"items":1}（整对象一次写入，不得添加其他键）；每张 reward.card 固定 quantity=1；经验已由程序结算，禁止修改 battle.exp',
);

const standardShop = { act: 2, floor: 4, kind: 'shop', danger: 0, floorsPerAct: 10, actCount: 3 };
assert.deepEqual(core.recommendShopBudget(standardShop), {
  cards: 3,
  artifacts: 1,
  items: 1,
});
assert.equal(core.formatShopBudget(core.recommendShopBudget(standardShop)), 'cards=3 artifacts=1 items=1');
const earlyShop = { act: 1, floor: 2, kind: 'shop', danger: 0, floorsPerAct: 10 };
const lateShop = { act: 3, floor: 8, kind: 'shop', danger: 0, floorsPerAct: 10 };
assert.deepEqual(core.recommendShopBudget(earlyShop), { cards: 2, artifacts: 1, items: 1 });
assert.deepEqual(core.recommendShopBudget(lateShop), { cards: 3, artifacts: 2, items: 1 });
assert.equal(core.recommendRunNodePacing(earlyShop).shopTier, 'basic');
assert.equal(core.recommendRunNodePacing(lateShop).shopTier, 'premium');
assert.equal(core.normalizeRunAct('2', 3), 2);
assert.equal(core.normalizeRunAct(99, 3), 3);
assert.equal(core.normalizeRunAct('invalid', 3), 1);
assert.equal(core.recommendShopPrice('cards', { rarity: 'Common', quantity: 1, price: 999 }, 1), 45);
assert.equal(core.recommendShopPrice('cards', { rarity: 'Rare', quantity: 2 }, 2), 170);
assert.equal(core.recommendShopPrice('artifacts', { rarity: 'Boss' }, 3), 210);
assert.equal(core.recommendShopPrice('items', { count: 2 }, 1), 70);
assert.equal(core.recommendShopPrice('items', {}, Number.NaN), 35);

console.log('Battle reward and shop budgets are deterministic, shallow, and bounded for Acts 1-3.');
