import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { installIsolatedBattlePresentation } = require('../src/fish/core/isolatedBattlePresentation.ts');
let menus = 0,
  targets = 0,
  store;
const rolls = [];
const noops = new Proxy({ then: undefined }, { get: (o, k) => (k in o ? o[k] : () => {}) });
const cards = Object.assign(Object.create(noops), {
  selectCards: async (c, r) => {
    targets++;
    assert.equal(r.allowCancel, true);
    rolls.push(store.nextRandom());
    return targets === 1 ? null : [c[0].id];
  },
});
installIsolatedBattlePresentation({
  terminal: () => {},
  presenters: {
    effects: noops,
    cards,
    relics: noops,
    intent: noops,
    effect_choice: {
      choose: async () => {
        menus++;
        return 'enhance';
      },
    },
    summon_choice: noops,
  },
});
const { GameStateManager } = require('../src/fish/core/gameStateManager.ts');
const { UnifiedEffectExecutor } = require('../src/fish/combat/unifiedEffectExecutor.ts');
store = GameStateManager.getInstance();
store.updatePlayer({
  currentHp: 40,
  maxHp: 40,
  energy: 3,
  block: 0,
  hand: [
    {
      id: 'target',
      name: '测试卡',
      type: 'Attack',
      rarity: 'Common',
      emoji: '⚔',
      cost: 1,
      effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 6 }] },
    },
  ],
});
store.setEnemy({ id: 'enemy', name: '敌人', currentHp: 40, maxHp: 40, block: 0, statusEffects: [], abilities: [] });
const before = structuredClone(store.getGameState());
await UnifiedEffectExecutor.getInstance().executeEffectProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [
      {
        op: 'choose_one',
        choiceId: 'upgrade',
        options: [
          {
            id: 'enhance',
            label: '强化',
            effects: [
              { op: 'gain_block', target: 'self', amount: 5 },
              { op: 'reduce_card_cost', selector: { zone: 'hand', pick: 'choose', count: 1 }, amount: 1 },
            ],
          },
          { id: 'other', label: '其他', effects: [{ op: 'gain_block', target: 'self', amount: 2 }] },
        ],
      },
    ],
  },
  true,
);
assert.equal(menus, 2);
assert.equal(targets, 2);
assert.equal(store.getPlayer().block, 5);
assert.deepEqual(rolls, [rolls[0], rolls[0]], 'return rewinds RNG');
assert.equal(store.getPlayer().hand[0].cost, 0);
assert.equal(store.getPlayer().energy, before.player.energy);
const { TavernCardSelectionHost } = require('../src/fish/core/cardSelectionHost.ts');
let rootMandatory = false;
cards.selectCards = async (c, r) => {
  rootMandatory = !r.allowCancel;
  return [c[0].id];
};
await TavernCardSelectionHost.getInstance().select(store.getPlayer().hand, {
  mode: 'choose',
  minimum: 1,
  maximum: 1,
  title: '必选',
});
assert.equal(rootMandatory, true);
console.log(
  'PASS real battle engine: cancelled target reopens parent, rolls back block/RNG, commits chosen upgrade once; root manual selector remains mandatory.',
);
// Nested navigation returns to the closest choice, preserving the committed outer prefix.
store.replaceState(structuredClone(before));
const visited = [];
let nestedTargets = 0;
const { isolatedPresenter } = require('../src/fish/core/isolatedBattlePresentation.ts');
isolatedPresenter('effect_choice').choose = async choice => {
  visited.push(choice.choiceId);
  return choice.options[0].id;
};
cards.selectCards = async (c, r) => {
  assert.equal(r.allowCancel, true);
  return ++nestedTargets === 1 ? null : [c[0].id];
};
const nestedProgram = {
  spec: 'mwg.effect/v1',
  steps: [
    {
      op: 'choose_one',
      choiceId: 'outer',
      options: [
        {
          id: 'outer_a',
          label: '外层',
          effects: [
            { op: 'gain_block', target: 'self', amount: 2 },
            {
              op: 'choose_one',
              choiceId: 'inner',
              options: [
                {
                  id: 'inner_a',
                  label: '内层',
                  effects: [
                    { op: 'gain_block', target: 'self', amount: 3 },
                    { op: 'reduce_card_cost', selector: { zone: 'hand', pick: 'choose', count: 1 }, amount: 1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
nestedProgram.steps[0].options.push({
  id: 'outer_b',
  label: '其他',
  effects: [{ op: 'gain_block', target: 'self', amount: 1 }],
});
nestedProgram.steps[0].options[0].effects[1].options.push({
  id: 'inner_b',
  label: '其他',
  effects: [{ op: 'gain_block', target: 'self', amount: 1 }],
});
await UnifiedEffectExecutor.getInstance().executeEffectProgram(JSON.parse(JSON.stringify(nestedProgram)), true);
assert.deepEqual(visited, ['outer', 'inner', 'inner']);
assert.equal(store.getPlayer().block, 5);
assert.equal(store.getPlayer().hand[0].cost, 0);
const saved = JSON.parse(JSON.stringify(store.getGameState()));
store.replaceState(saved);
assert.equal(store.getPlayer().block, 5);
assert.equal(store.getPlayer().hand[0].cost, 0);
let emptyOpened = false;
cards.selectCards = async () => {
  emptyOpened = true;
  return [];
};
await TavernCardSelectionHost.getInstance().select([], { mode: 'choose', minimum: 0, maximum: 0, title: '空目标' });
assert.equal(emptyOpened, false);
console.log(
  'PASS nested navigation returns to nearest parent; JSON round-trip preserves completed state; empty selection does not open a blocking modal.',
);
// Transformation choices expose and execute the replacement card, not just its name.
store.replaceState(structuredClone(before));
const replacement={id:'transformed_blade',name:'变形锋刃',emoji:'🗡️',type:'Attack',rarity:'Common',cost:1,description:'',program:{spec:'mwg.effect/v1',steps:[{op:'damage',target:'opponent',amount:9}]}};
const transform={op:'transform_cards',selector:{zone:'hand',pick:'choose',count:1},replacement};
const {effectProgramToDisplayTags}=require('../src/game-core/effectDisplay.ts');
const tag=effectProgramToDisplayTags({spec:'mwg.effect/v1',steps:[transform]})[0];assert.equal(tag.reference.card.name,'变形锋刃');assert.match(tag.reference.rules,/9点伤害/);
let transformPrompts=0,transformMenus=0;cards.selectCards=async(c,r)=>{assert.equal(r.allowCancel,true);return ++transformPrompts===1?null:[c[0].id]};isolatedPresenter('effect_choice').choose=async c=>{transformMenus++;return c.options[0].id};
await UnifiedEffectExecutor.getInstance().executeEffectProgram({spec:'mwg.effect/v1',steps:[{op:'choose_one',choiceId:'transform',options:[{id:'blade',label:'变形锋刃',effects:[transform]},{id:'block',label:'防御',effects:[{op:'gain_block',target:'self',amount:3}]}]}]},true);
assert.equal(transformMenus,2);assert.equal(store.getPlayer().hand[0].name,'变形锋刃');assert.equal(store.getPlayer().hand.length,1);const transformedSaved=JSON.parse(JSON.stringify(store.getGameState()));store.replaceState(transformedSaved);assert.equal(store.getPlayer().hand[0].effectProgram.steps[0].amount,9);
console.log('PASS transformation replacement has readable full rules; back/reselect transforms once; save preserves replacement program.');
// Multi-choice is one rollback boundary: returning from the second selected
// branch must undo the first selected branch too, then resolve both only once.
store.replaceState(structuredClone(before));
let multiMenus=0,multiTargets=0;
isolatedPresenter('effect_choice').choose=async()=>{multiMenus++;return ['target','prefix']};
cards.selectCards=async(c,r)=>{assert.equal(r.allowCancel,true);return ++multiTargets===1?null:[c[0].id]};
await UnifiedEffectExecutor.getInstance().executeEffectProgram({spec:'mwg.effect/v1',steps:[{op:'choose_one',choiceId:'multi',count:2,options:[{id:'prefix',label:'防御',effects:[{op:'gain_block',target:'self',amount:2}]},{id:'target',label:'变形',effects:[{op:'gain_block',target:'self',amount:3},transform]}]}]},true);
assert.equal(multiMenus,2);assert.equal(multiTargets,2);assert.equal(store.getPlayer().block,5);assert.equal(store.getPlayer().hand[0].name,'变形锋刃');
console.log('PASS X=Y multi-choice second-branch return rolls back the entire selection and applies both effects only once.');
