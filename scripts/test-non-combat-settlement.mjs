import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { parseNonCombatSettlement, planNonCombatCosts } = require(resolve('src/game-core/nonCombatSettlement.ts'));

const settlement = parseNonCombatSettlement({
  hp: -2, max_hp: 3, lust: 4, max_lust: 5, gold: 20, card_removals: 1,
  resources: { moon: 2 }, gain_cards: [{ id: 'fixed_card' }],
  cost: { hp: 3, gold: 7, resources: { moon: 2 } },
  deck_actions: [{ id: 'remove_one', kind: 'remove', count: 1, pick: 'choose' }],
  grant: { cards: [{ id: 'grant_card' }], items: [{ id: 'grant_item' }], limits: { cards: 1, items: 1 } },
});
assert.equal(settlement.maxLustDelta, 5, 'max_lust remains an upper-limit delta, not current lust');
assert.equal(settlement.lustDelta, 4);
assert.deepEqual(settlement.resourceDeltas, { moon: 2 });
assert.equal(settlement.deckActions[0].id, 'remove_one');
assert.equal(settlement.grant.items[0].id, 'grant_item');

const before = { hp: 12, max_hp: 20, lust: 3, max_lust: 10, gold: 9,
  resources: { moon: { name: '月能', current: 3, max: 5 } } };
const paid = planNonCombatCosts(settlement.costs, before);
assert.deepEqual({ hp: paid.hp, max_hp: paid.max_hp, gold: paid.gold }, { hp: 9, max_hp: 20, gold: 2 });
assert.equal(paid.resources[0].current, 1, 'resource costs use the registered resource id');
assert.equal(before.resources.moon.current, 3, 'planning never mutates the source state');

// Costs are checked before the same settlement's gain; no clamped free reward.
const insufficientGold = structuredClone(before);
insufficientGold.gold = 6;
assert.throws(() => planNonCombatCosts(settlement.costs, insufficientGold), /金币成本不可支付/);
assert.equal(insufficientGold.gold, 6, 'mixed-cost failure leaves every input value unchanged');
assert.throws(() => planNonCombatCosts({ hp: 12, maxHp: 0, gold: 0, resources: {} }, before), /生命必须至少保留 1/);
assert.equal(planNonCombatCosts({ hp: 0, maxHp: 11, gold: 0, resources: {} }, before).hp, 9, 'paying max HP also caps current HP, as for other maximum changes');
assert.throws(() => planNonCombatCosts({ hp: 0, maxHp: 20, gold: 0, resources: {} }, before), /上限必须至少保留 1/);
assert.throws(() => planNonCombatCosts({ hp: 0, maxHp: 0, gold: 0, resources: { sun: 1 } }, before), /未注册/);
assert.equal(parseNonCombatSettlement({ cost: { gold: 0 } }).costs.gold, 0);
assert.equal(parseNonCombatSettlement({grant:{cards:Array.from({length:9},(_,i)=>({id:'card_'+i})),limits:{cards:7}}}).grant.limits.cards,7,'grant supports X choose Y without a six-card cap');
assert.throws(() => parseNonCombatSettlement({ grant: { artifacts: [{}], limits: {} } }), /不支持字段/);
assert.throws(() => parseNonCombatSettlement({ reward: {} }), /不支持字段/);
assert.throws(() => parseNonCombatSettlement({ next_stage: 'later' }), /不支持字段/);

const roundTrip = JSON.parse(JSON.stringify(settlement));
assert.deepEqual(roundTrip, settlement, 'the pure plan is save/restore serializable');
console.log('Non-combat settlement planning, strict costs, grants, and serialization tests passed.');
const freeCosts=parseNonCombatSettlement({}).costs;
assert.equal(planNonCombatCosts(freeCosts,{...before,hp:20.2,max_hp:30,lust:1.5}).hp,20.2);
assert.equal(planNonCombatCosts(freeCosts,{...before,hp:0.2}).hp,0.2);
assert.equal(planNonCombatCosts({...freeCosts,hp:2},{...before,hp:20.2,max_hp:30}).hp,18.2);
assert.throws(()=>planNonCombatCosts({...freeCosts,hp:2},{...before,hp:2.2}),/至少保留/);
for(const hp of [NaN,Infinity,-1,0,'20.2']) assert.throws(()=>planNonCombatCosts(freeCosts,{...before,hp}));
assert.throws(()=>parseNonCombatSettlement({cost:{hp:1.2}}),/整数/);
