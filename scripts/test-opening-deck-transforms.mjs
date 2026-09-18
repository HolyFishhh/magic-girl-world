import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { createRunState } = require('../src/game-core/runState.ts');
const { settleTowerOpeningChoiceInStat } = require('../src/common/runTransactions.ts');
const { validateTowerOpeningRewardCandidates } = require('../src/game-core/towerOpeningOutcome.ts');
const { compileInitialDraftToMvu, INITIAL_DRAFT_SPEC } = require('../src/game-core/initialDraft.ts');
const { createInitialDraftJsonSchema } = require('../src/game-core/initialDraftSchema.ts');
const {
  createTowerInitialContentJsonSchema,
  createTowerInitialRootRepairJsonSchema,
  createTowerOpeningJsonSchema,
} = require('../src/game-core/towerRequest.ts');
const { describeOpeningDeckTransforms } = require('../src/game-core/contentDescription.ts');
const display = require('../src/game-core/effectDisplay.ts');
const { initialDraftSourcePath, applyInitialDraftPreviewEdits } = require('../src/game-core/initialDraftSourcePath.ts');
const { migratePersistentRunDeck } = require('../src/game-core/cardProgression.ts');
const { createContentPack } = require('../src/game-core/contentPack.ts');
const { validateContentPackContract } = require('../src/game-core/contentContract.ts');
const card = (id, name, quantity = 1) => ({
  id,
  name,
  emoji: '🃏',
  type: 'Attack',
  rarity: 'Common',
  cost: 1,
  quantity,
  effects: [{ damage: 7 }],
});
const replacement = card('new_strike', '强化打击');
const action = { filter: { names: ['打击', '防御'] }, replacement };
const sourceCards = [
  card('strike', '打击', 3),
  { ...card('defend', '防御', 2), type: 'Skill', effects: [{ block: 5 }] },
  card('other', '寒冰斩'),
];
const outcome = { gold: 11, deck_transforms: [action] };
function fixture(value = outcome) {
  const run = createRunState({ seed: 174 });
  run.opening = {
    phase: 'ready',
    requestId: 'gift',
    basedOnRevision: 0,
    attempts: 1,
    content: {
      title: '转化馈赠',
      narrative: '选择馈赠',
      choices: [{ id: 'accept', label: '转化全部打击和防御', outcome: structuredClone(value) }],
    },
  };
  return {
    run,
    battle: {
      core: { hp: 60, max_hp: 60, lust: 0, max_lust: 100, card_removal_count: 0, resources: [] },
      cards: structuredClone(sourceCards),
      statuses: [],
      artifacts: [],
      items: [],
    },
    reward: { card: [], artifact: [], item: [], limits: {}, disabled_categories: [] },
  };
}
const stat = fixture();
const before = structuredClone(stat);
validateTowerOpeningRewardCandidates(stat.run.opening.content.choices, stat.battle);
assert.deepEqual(stat, before, 'preview/validation must not mutate a deck or claim gift');
assert.throws(() => settleTowerOpeningChoiceInStat(stat, 'cancelled'), /不存在/);
assert.deepEqual(stat, before);
const ids = migratePersistentRunDeck(stat.battle.cards).map(c => c.runInstanceId);
settleTowerOpeningChoiceInStat(stat, 'accept');
assert.equal(stat.battle.cards.filter(c => c.id === 'new_strike').length, 5);
assert.equal(stat.battle.cards.filter(c => c.id === 'other').length, 1);
assert.deepEqual(
  stat.battle.cards.map(c => c.runInstanceId),
  ids,
  'each transformed copy retains identity',
);
assert.ok(stat.battle.cards.every(c => c.quantity === 1));
const reloaded = JSON.parse(JSON.stringify(stat));
assert.deepEqual(migratePersistentRunDeck(reloaded.battle.cards), stat.battle.cards);
assert.throws(() => settleTowerOpeningChoiceInStat(reloaded, 'accept'), /没有可结算/);
const contract = validateContentPackContract(createContentPack({ cards: reloaded.battle.cards, statuses: [] }), {
  requireExecutable: true,
});
assert.equal(contract.ok, true, JSON.stringify(contract.issues));
const { convertMvuCards } = require('../src/fish/core/mvuBattleAdapter.ts');
const { runEffectCommandProgram } = require('../src/game-core/index.ts');
const playable = convertMvuCards(reloaded.battle.cards);
assert.equal(playable.length, 6);
const combat = {
  self: { hp: 60, maxHp: 60, block: 0, energy: 10, maxEnergy: 10, lust: 0, maxLust: 100 },
  opponent: { hp: 60, maxHp: 60, block: 0, lust: 0, maxLust: 100 },
  currentTurn: 1,
  cardsPlayedThisTurn: 0,
};
for (const c of playable.filter(c => c.originalId === 'new_strike')) {
  const execution = await runEffectCommandProgram(
    c.effectProgram,
    { spentEnergy: 1 },
    {
      readState: () => structuredClone(combat),
      execute: command => {
        assert.equal(command.type, 'damage');
        combat[command.target].hp -= command.amount;
      },
    },
  );
  assert.equal(execution.completed, true);
}
assert.equal(combat.opponent.hp, 25, 'five restored replacements each execute 7 actual damage');

// A transformed owned copy keeps permanent numeric growth through compact MVU storage.
{
  const core = require('../src/game-core/index.ts');
  const adapter = require('../src/fish/core/mvuBattleAdapter.ts');
  const grown = fixture({ deck_transforms: [{ filter: { ids: ['strike'] }, replacement }] });
  const owned = adapter.convertMvuCards(grown.battle.cards);
  const upgraded = core.applyCardUpgradeBundle(owned[0], {
    source: { kind: 'card', id: 'permanent_training' }, scope: 'permanent', createdTurn: 1,
    changes: [{ kind: 'numeric', stat: 'damage', operator: 'add', value: 4 }],
  });
  grown.battle.cards = adapter.writeBackMvuCardProgression(grown.battle.cards, owned, [upgraded, ...owned.slice(1)]).cards;
  const grownId = grown.battle.cards[0].runInstanceId;
  settleTowerOpeningChoiceInStat(grown, 'accept');
  const saved = JSON.parse(JSON.stringify(grown.battle.cards));
  const restored = adapter.convertMvuCards(saved).find(c => c.runInstanceId === grownId);
  assert.equal(restored.originalId, 'new_strike');
  assert.equal(restored.effectProgram.steps[0].amount, 11, 'permanent +4 is preserved exactly once on the new base 7');
  assert.ok(saved.find(c => c.runInstanceId === grownId).$meta.mwg_card_progression);
}

for (const filter of [{ ids: ['strike'] }, { name_contains: ['打'] }, { types: ['Attack'], name_contains: ['打'] }]) {
  const s = fixture({ deck_transforms: [{ filter, replacement }] });
  settleTowerOpeningChoiceInStat(s, 'accept');
  assert.equal(s.battle.cards.filter(c => c.id === 'new_strike').length, 3);
}
const noCascade = fixture({
  deck_transforms: [action, { filter: { names: ['强化打击'] }, replacement: card('third', '不会连锁获得') }],
});
settleTowerOpeningChoiceInStat(noCascade, 'accept');
assert.equal(noCascade.battle.cards.filter(c => c.id === 'new_strike').length, 5);
assert.equal(
  noCascade.battle.cards.some(c => c.id === 'third'),
  false,
);
const zero = fixture({ deck_transforms: [{ filter: { names: ['不存在'] }, replacement }] });
settleTowerOpeningChoiceInStat(zero, 'accept');
assert.equal(zero.battle.cards.filter(c => c.id === 'new_strike').length, 0);
for (const bad of [
  { deck_transforms: [{ ...action, replacement: { ...replacement, unique: true } }], gold: 99 },
  { deck_transforms: [action, action], gold: 99 },
  { deck_transforms: [{ ...action, replacement: { ...replacement, quantity: 2 } }] },
  { deck_transforms: [{ filter: { names: ['不存在'] }, replacement: { id: 'broken' } }] },
  { deck_transforms: [{ filter: { name_contains: [] }, replacement }] },
  { deck_transforms: [{ filter: { text: ['打'] }, replacement }] },
]) {
  const s = fixture(bad),
    copy = structuredClone(s);
  assert.throws(() => settleTowerOpeningChoiceInStat(s, 'accept'));
  assert.deepEqual(s, copy, 'entire gift rolls back');
}
const support = {
  id: 'new_guard',
  name: '祝福护体',
  emoji: '🛡',
  type: 'buff',
  stacks_change: 'keep',
  triggers: { turn_end: [{ block: 2 }] },
};
const supported = {
  ...replacement,
  effects: [{ apply_status: 'new_guard', stacks: 1, to: 'self' }],
  statuses: [support],
};
const supporting = fixture({ deck_transforms: [{ ...action, replacement: supported }] });
settleTowerOpeningChoiceInStat(supporting, 'accept');
assert.equal(supporting.battle.statuses.length, 1);
const text = describeOpeningDeckTransforms([action], sourceCards).join('');
assert.match(text, /当前5张/);
assert.match(text, /打击/);
assert.match(text, /防御/);
assert.match(text, /永久转化/);
assert.match(text, /未来副本/);
assert.deepEqual(display.describeOpeningDeckTransforms([action], sourceCards), [text]);
const draft = {
  spec: INITIAL_DRAFT_SPEC,
  narrative: '启程',
  player: {
    status: { time: '午夜', location: '高塔', profession: { name: '战士', ability: '战斗' } },
    core: { emoji: '🧙', hp: 60, max_hp: 60, lust: 0, max_lust: 100 },
    cards: structuredClone(sourceCards),
  },
  opening: {
    title: '馈赠',
    narrative: '启程馈赠',
    choices: ['one', 'two', 'three'].map(id => ({
      id,
      label: id,
      outcome: {
        deck_transforms: [
          {
            ...action,
            replacement: { ...replacement, effects: [{ apply_status: 'new_guard', stacks: 1, to: 'self' }] },
          },
        ],
      },
    })),
  },
  registry: { statuses: [support], resources: [], templates: [] },
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
const schema = createInitialDraftJsonSchema();
const check = ajv.compile(schema.value);
assert.equal(check(draft), true, JSON.stringify(check.errors));
const compiled = compileInitialDraftToMvu(draft);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
assert.equal(compiled.value.opening.choices[0].outcome.deck_transforms[0].replacement.statuses[0].id, 'new_guard');
assert.equal(compiled.value.player.statuses.length, 0, 'unselected replacement status not globally granted');
const finalCheck = ajv.compile(createTowerInitialContentJsonSchema().value);
assert.equal(finalCheck(compiled.value), true, JSON.stringify(finalCheck.errors));
const leaf = ['opening', 'choices', 0, 'outcome', 'deck_transforms', 0, 'replacement', 'effects', 0, 'stacks'];
assert.deepEqual(
  initialDraftSourcePath(draft, compiled.value, leaf),
  leaf,
  'finite repair retains authored transform leaf',
);
const modified = structuredClone(compiled.value);
modified.opening.choices[0].outcome.deck_transforms[0].replacement.effects[0].stacks = 2;
// source projection only transports the already-approved exact changed leaf
const projected = applyInitialDraftPreviewEdits(draft, compiled.value, modified);
assert.equal(projected.opening.choices[0].outcome.deck_transforms[0].replacement.effects[0].stacks, 2);
const malformed = structuredClone(draft);
malformed.opening.choices[0].outcome.deck_transforms[0].replacement = { card_ref: 'strike', quantity: 1 };
assert.equal(check(malformed), false, 'replacement cannot use reward-only card_ref shorthand');
const canonical = fixture();
canonical.battle = { ...canonical.battle, ...compiled.value.player };
validateTowerOpeningRewardCandidates(compiled.value.opening.choices, canonical.battle);
const repair = createTowerInitialRootRepairJsonSchema([{ token: 'gift', kind: 'opening_choice', preserveId: 'one' }]);
assert.match(JSON.stringify(repair), /deck_transforms/);
const repairCheck = ajv.compile(repair.value);
assert.equal(
  repairCheck({
    spec: 'mwg.tower-initial-root-repair/v1',
    roots: { gift: compiled.value.opening.choices[0] },
    support_statuses: [],
    support_resources: [],
  }),
  true,
  JSON.stringify(repairCheck.errors),
);
const { OPENING_OUTCOME_FIELDS } = require('../src/game-core/towerOpeningTransforms.ts');
assert.deepEqual(
  Object.keys(createTowerOpeningJsonSchema().value.properties.choices.items.properties.outcome.properties).sort(),
  [...OPENING_OUTCOME_FIELDS].sort(),
);
assert.match(JSON.stringify(createTowerOpeningJsonSchema()), /deck_transforms/);
console.log(
  'PASS opening transforms: schema, registry compilation, bounded projection, all-copy settlement, rollback, save/reload, identity, no cascade, Chinese display.',
);
