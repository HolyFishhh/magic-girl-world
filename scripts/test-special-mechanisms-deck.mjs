import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalInitialFixtureToDraft } from './lib/initial-draft-fixture.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { compileInitialDraftToMvu } = require(resolve('src/game-core/initialDraft.ts'));
const { initialDraftAuthoringPrompt } = require(resolve('src/sillytavern-extension/initialDraftPrompt.ts'));

const fixturePath = resolve('scripts/fixtures/special-mechanisms-deck.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const pack = core.createContentPack(fixture);
const contract = core.validateContentPackContract(pack, { requireExecutable: true });
assert.equal(contract.ok, true, JSON.stringify(contract.ok ? [] : contract.issues, null, 2));

const readiness = core.assessInitialPlayerContent(pack, fixture.player);
assert.equal(readiness.ok, true, JSON.stringify(readiness.issues, null, 2));

assert.ok(fixture.cards.length >= 12 && fixture.cards.length <= 16, 'fixture must contain 12–16 root cards');
assert.equal(new Set(fixture.cards.map(card => card.id)).size, fixture.cards.length, 'root card IDs must be unique');
assert.deepEqual(
  new Set(fixture.cards.map(card => card.rarity)),
  new Set(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt']),
  'all six card rarities must be represented',
);

const card = id => fixture.cards.find(entry => entry.id === id);
const summon = card('luminary_call').effects.spawn_summon;
assert.ok(summon.actions.some(action => action.effects.damage > 0), 'summon must have authored direct action damage');
assert.equal(card('luminary_call').innate, true, 'the useful summon opener must be innate');
assert.equal(card('luminary_call').lifecycle.on_play, 'exhaust', 'the summon card is once per battle by default');
const summonStrength = card('familiar_command').effects.modify_summon_effect;
assert.deepEqual(summonStrength.selector, { owner: 'self', pick: 'left' });
assert.equal(summonStrength.stat, 'damage');

const directCardStrength = card('prism_forge').effects;
assert.deepEqual(
  directCardStrength,
  { patch_card: 'damage', add: 3, scope: 'combat', from: 'hand', pick: 'choose', card_type: 'Attack', root_only: true },
  'card strengthening must target a selected root Attack card, never a summon inner effect',
);
assert.equal(core.compileCompactEffectList(directCardStrength).ok, true);

const generator = card('star_smith');
assert.equal(generator.effects.add_card, 'star_shard');
assert.equal(generator.creates[0].lifecycle.on_play, 'exhaust');
assert.equal(card('eclipse_sigil').lifecycle.on_play, 'exhaust');
assert.equal(card('nova_vow').lifecycle.on_play, 'purge');
assert.equal(card('fading_glint').ethereal, true, 'fixture must include an ethereal card');
assert.deepEqual(
  card('tactical_release').effects,
  [{ discard: 1, from: 'hand', pick: 'choose' }, { draw: 1 }],
  'manual discard must let the player test retain + on_discard exhaust cards',
);
for (const id of ['tether_reclaim', 'void_whisper']) {
  assert.deepEqual(card(id).lifecycle, { turn_end: 'retain', on_discard: 'exhaust' });
}
assert.equal(card('void_whisper').type, 'Curse');
assert.equal(card('void_whisper').effects, undefined, 'the curse remains deliberately unplayable');

const initialFixture = {
  narrative: '月光穿过高塔的门扉。',
  player: {
    status: { time: '夜晚', location: '月庭', profession: { name: '月契使', ability: '驱使辉光使作战' } },
    core: {
      emoji: fixture.player.emoji, hp: fixture.player.hp, max_hp: fixture.player.maxHp,
      lust: fixture.player.lust, max_lust: fixture.player.maxLust,
    },
    cards: fixture.cards,
    artifacts: fixture.relics,
    items: fixture.items,
    player_lust_effect: fixture.playerDesireEffect,
    level: fixture.player.level,
    exp: fixture.player.exp,
  },
  opening: {
    title: '月庭启程', narrative: '选择一份启程馈赠。', choices: [
      { id: 'moon_gold', label: '月银', outcome: { gold: 10 } },
      { id: 'moon_hp', label: '月露', outcome: { hp: 3 } },
      { id: 'moon_remove', label: '月剪', outcome: { card_removals: 1 } },
    ],
  },
};
const lifted = canonicalInitialFixtureToDraft(initialFixture);
assert.equal(lifted.ok, true, JSON.stringify(lifted.ok ? [] : lifted.errors, null, 2));
const initialCompiled = compileInitialDraftToMvu(lifted.draft);
assert.equal(initialCompiled.ok, true, JSON.stringify(initialCompiled.ok ? [] : initialCompiled.diagnostics, null, 2));
const compiledSummonCard = initialCompiled.value.player.cards.find(entry => entry.id === 'luminary_call');
assert.equal(compiledSummonCard.lifecycle.on_play, 'exhaust', 'root lifecycle survives registry initial-draft compilation');
const compiledGenerator = initialCompiled.value.player.cards.find(entry => entry.id === 'star_smith');
assert.equal(compiledGenerator.creates[0].id, 'star_shard');
assert.equal(compiledGenerator.creates[0].lifecycle.on_play, 'exhaust', 'generated template lifecycle survives registry compilation');
const compiledPack = core.createContentPack({
  cards: initialCompiled.value.player.cards,
  relics: initialCompiled.value.player.artifacts,
  items: initialCompiled.value.player.items,
  playerDesireEffect: initialCompiled.value.player.player_lust_effect,
});
const compiledReadiness = core.assessInitialPlayerContent(compiledPack, {
  ...initialCompiled.value.player.core,
  maxHp: initialCompiled.value.player.core.max_hp,
  maxLust: initialCompiled.value.player.core.max_lust,
});
assert.equal(compiledReadiness.ok, true, JSON.stringify(compiledReadiness.issues, null, 2));

const promptInput = {
  startPrompt: '保留原始开局文本。',
  config: { card: '保留原始卡牌要求。', towerRequirements: '保留原始高塔要求。', tone: '保留原始文风。' },
  narrative: '保留原始已成立正文。',
  currentStat: { status: { time: '原始时刻' }, tower_requirements: '原始约束' },
  designGuidance: '保留原始设计指引。',
};
const authoringPrompt = initialDraftAuthoringPrompt(promptInput);
assert.match(authoringPrompt, /lifecycle\.on_play/);
assert.ok(authoringPrompt.includes(`START_REQUEST=${JSON.stringify(promptInput.startPrompt)}`));
assert.ok(authoringPrompt.includes(`ESTABLISHED_NARRATIVE=${JSON.stringify(promptInput.narrative)}`));
assert.ok(authoringPrompt.includes(`REQUESTED_CARD_DESIGN=${JSON.stringify(promptInput.config.card)}`));
assert.ok(authoringPrompt.includes(`REQUESTED_TOWER_RULES=${JSON.stringify(promptInput.config.towerRequirements)}`));
assert.ok(authoringPrompt.includes(JSON.stringify(promptInput.designGuidance)));
assert.ok(authoringPrompt.includes(JSON.stringify({ tone: promptInput.config.tone })));

console.log(JSON.stringify({
  ok: true,
  fixture: 'scripts/fixtures/special-mechanisms-deck.json',
  rootCards: fixture.cards.length,
  rarities: [...new Set(fixture.cards.map(card => card.rarity))].sort(),
  readiness: core.formatPlayerContentReadiness(readiness),
  initialDraftReadiness: core.formatPlayerContentReadiness(compiledReadiness),
  mechanisms: ['summon', 'summon_effect_strengthen', 'selected_direct_card_strengthen', 'temporary_card', 'manual_discard', 'innate', 'ethereal', 'exhaust', 'purge', 'retain_discard_exhaust', 'unplayable_curse'],
}, null, 2));
