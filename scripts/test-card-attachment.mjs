import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

const base = {
  id: 'strike__combat__1',
  originalId: 'strike',
  templateId: 'strike',
  runInstanceId: 'strike__run__1',
  combatInstanceId: 'strike__combat__1',
  origin: 'deck',
  name: '测试攻击',
  type: 'Attack',
  rarity: 'Common',
  cost: 2,
  effectProgram: { spec: 'mwg.effect/v1', steps: [{ op: 'damage', target: 'opponent', amount: 6 }] },
};

const enchantment = {
  id: 'keen_edge',
  kind: 'enchantment',
  name: '锋锐附着',
  description: '一项持久的正面卡牌改造。',
  source: { kind: 'card', id: 'forge_source', name: '改造来源' },
  scope: 'run',
  appliedTurn: 1,
  removeOn: 'run_end',
  changes: [
    { kind: 'numeric', stat: 'damage', operator: 'add', value: 3 },
    { kind: 'keyword', keyword: 'retain', enabled: true },
  ],
};

let card = core.applyCardAttachment(base, enchantment);
assert.equal(card.effectProgram.steps[0].amount, 9);
assert.equal(card.retain, true);
assert.equal(card.attachments.length, 1);
assert.equal(card.patches.length, 2);
assert.throws(
  () => core.applyCardAttachment(card, { ...enchantment, id: 'second_enchantment' }),
  /more than one enchantment/,
);

card = core.applyCardAttachment(card, {
  id: 'binding_fault',
  kind: 'affliction',
  name: '束缚故障',
  source: { kind: 'enemy_action', id: 'bind', ownerId: 'enemy_a' },
  scope: 'combat',
  appliedTurn: 2,
  priority: 5,
  removeOn: 'discarded',
  remaining: 2,
  discardReasons: ['player_choice', 'random_effect'],
  changes: [
    { kind: 'cost', operator: 'add', value: 1 },
    { kind: 'play_access', mode: 'deny' },
    {
      kind: 'discard_auto_play',
      reasons: ['player_choice', 'random_effect'],
      failureDestination: 'discard',
      onlyPlayerTurn: true,
    },
  ],
});
assert.equal(card.cost, 3);
assert.deepEqual(core.resolveCardAttachmentPlayAccess(card), {
  denied: true,
  explicitlyAllowed: false,
  sources: [card.attachments[1]],
});
assert.equal(core.resolveDiscardAutoPlay(card, 'player_choice', 'player_turn')?.attachment.id, 'binding_fault');
assert.equal(core.resolveDiscardAutoPlay(card, 'turn_cleanup', 'player_turn'), null);
assert.equal(core.resolveDiscardAutoPlay(card, 'player_choice', 'enemy_turn'), null);

for (const reason of ['player_choice', 'random_effect', 'effect']) {
  const resolution = core.resolveCardDiscardLifecycle(card, reason, 'hand', 'player_turn');
  assert.equal(resolution.triggersDiscardLifecycle, true, `${reason} is a true hand discard`);
  assert.equal(
    resolution.autoPlay?.attachment.id,
    reason === 'effect' ? undefined : 'binding_fault',
    `${reason} respects the attachment's explicit reason filter`,
  );
}
for (const [reason, source, phase] of [
  ['turn_cleanup', 'hand', 'player_turn'],
  ['scry', 'hand', 'player_turn'],
  ['player_choice', 'drawPile', 'player_turn'],
  ['player_choice', 'hand', 'enemy_turn'],
]) {
  const resolution = core.resolveCardDiscardLifecycle(card, reason, source, phase);
  assert.equal(
    resolution.triggersDiscardLifecycle,
    reason === 'player_choice' && source === 'hand',
    `${reason}/${source} discard lifecycle classification is stable`,
  );
  assert.equal(resolution.autoPlay, null, `${reason}/${source}/${phase} cannot accidentally auto-play`);
}

card = core.advanceCardAttachments(card, 'discarded', 'scry');
assert.equal(card.attachments.find(entry => entry.id === 'binding_fault').remaining, 2, 'scry is not a matching discard');
card = core.advanceCardAttachments(card, 'discarded', 'player_choice');
assert.equal(card.attachments.find(entry => entry.id === 'binding_fault').remaining, 1);
assert.equal(card.cost, 3);
card = core.advanceCardAttachments(card, 'discarded', 'random_effect');
assert.equal(card.attachments.some(entry => entry.id === 'binding_fault'), false);
assert.equal(card.cost, 2, 'the whole affliction package is removed without leaving a cost patch');
assert.equal(card.effectProgram.steps[0].amount, 9, 'the independent enchantment remains');

const persistentCopy = {
  ...card,
  patches: core.inheritedCardPatches(card, core.PERSISTENT_COPY_PATCH_POLICY),
  attachments: core.inheritedCardAttachments(card, core.PERSISTENT_COPY_PATCH_POLICY),
};
assert.deepEqual(persistentCopy.attachments.map(entry => entry.id), ['keen_edge']);
assert.deepEqual(persistentCopy.patches.map(entry => entry.source.kind), ['enchantment', 'enchantment']);

const restored = structuredClone(card);
assert.equal(core.describeCardAttachmentRemaining(restored.attachments[0]), '本次流程');
restored.effectProgram.steps[0].amount = 999;
assert.equal(card.effectProgram.steps[0].amount, 9, 'save clones cannot mutate the live attachment result');

assert.throws(
  () => core.applyCardAttachment(base, {
    ...enchantment,
    id: 'bad_divide',
    changes: [{ kind: 'numeric', stat: 'damage', operator: 'divide', value: 0 }],
  }),
  /divide by zero/,
);

console.log('Named enchantment and affliction bundles preserve sources, rules, duration, copying, and atomic cleanup.');
