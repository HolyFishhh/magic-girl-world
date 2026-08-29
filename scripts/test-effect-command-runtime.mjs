import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const { TavernEffectCommandHost } = require(resolve('src/fish/core/effectCommandHost.ts'));

const state = {
  self: { hp: 5, maxHp: 10, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 },
  opponent: { hp: 10, maxHp: 10, lust: 0, maxLust: 100, energy: 0, maxEnergy: 0, block: 1 },
  currentTurn: 4,
  cardsPlayedThisTurn: 1,
};
const program = {
  spec: 'mwg.effect/v1',
  steps: [
    { op: 'gain_block', target: 'self', amount: 2 },
    {
      op: 'if',
      condition: { op: 'compare', relation: 'gte', left: { op: 'var', path: 'self.block' }, right: 2 },
      then: [{ op: 'damage', target: 'opponent', amount: { op: 'var', path: 'self.block' } }],
      else: [{ op: 'heal', target: 'self', amount: 9 }],
    },
    { op: 'gain_energy', target: 'self', amount: 2 },
  ],
};

const executed = [];
const result = await core.runEffectCommandProgram(
  program,
  { spentEnergy: 0 },
  {
    readState: () => structuredClone(state),
    execute: command => {
      executed.push(command);
      if (command.type === 'gain_block') state[command.target].block += command.amount;
      if (command.type === 'damage') {
        const target = state[command.target];
        const blocked = Math.min(target.block, command.amount);
        target.block -= blocked;
        target.hp -= command.amount - blocked;
      }
      if (command.type === 'gain_energy') state[command.target].energy += command.amount;
    },
  },
);

assert.equal(result.completed, true);
assert.deepEqual(
  executed.map(command => command.type),
  ['gain_block', 'damage', 'gain_energy'],
);
assert.equal(executed[1].amount, 2, 'the formula must read block changed by the previous host command');
assert.equal(state.opponent.hp, 9);
assert.equal(state.self.energy, 5, 'temporary energy can exceed maxEnergy, matching the Tavern runtime');
assert.equal(core.isBattleEffectCommand(executed[1]), true);

const fractional = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [{ op: 'damage', target: 'opponent', amount: { op: 'divide', left: 5, right: 2 } }],
  },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => fractional.push(command) },
);
assert.equal(fractional[0].amount, 2.5, 'numeric battle formulas keep up to two decimal places');

const typedDamageCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [{
      op: 'damage', target: 'opponent', amount: 7, damageKind: 'hp_loss',
      bypassBlock: true, lifesteal: { op: 'divide', left: 1, right: 2 },
    }],
  },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => typedDamageCommands.push(command) },
);
assert.deepEqual(typedDamageCommands, [{
  type: 'damage', target: 'opponent', amount: 7, damageKind: 'hp_loss', bypassBlock: true, lifesteal: 0.5,
}]);

const defeatCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [
      { op: 'execute', target: 'opponent', threshold: 25, thresholdMode: 'hp_percent', excludeTags: ['boss'] },
      { op: 'kill', target: 'opponent', triggerFatal: false },
    ],
  },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => defeatCommands.push(command) },
);
assert.deepEqual(defeatCommands, [
  { type: 'execute', target: 'opponent', threshold: 25, thresholdMode: 'hp_percent', excludeTags: ['boss'], triggerFatal: true },
  { type: 'kill', target: 'opponent', triggerFatal: false },
]);

const discreteCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [{ op: 'draw_cards', amount: { op: 'divide', left: 5, right: 2 } }],
  },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => discreteCommands.push(command) },
);
assert.equal(discreteCommands[0].amount, 2, 'card counts remain discrete even when a formula is used');

const signedDeltaCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [
      { op: 'gain_lust', target: 'self', amount: -7.5 },
      { op: 'gain_energy', target: 'self', amount: -1 },
      { op: 'gain_resource', target: 'self', resource: 'charge', amount: -2 },
      { op: 'set_stat', target: 'self', stat: 'lust', value: -20 },
    ],
  },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => signedDeltaCommands.push(command) },
);
assert.deepEqual(signedDeltaCommands.map(command => command.type), [
  'gain_lust', 'gain_energy', 'gain_resource', 'set_stat',
]);
assert.deepEqual(signedDeltaCommands.slice(0, 3).map(command => command.amount), [-7.5, -1, -2]);
assert.equal(signedDeltaCommands[3].value, -20, 'set operations may cross zero; the state boundary performs clamping');

for (const step of [
  { op: 'damage', target: 'opponent', amount: -1 },
  { op: 'gain_block', target: 'self', amount: -1 },
  { op: 'apply_status', target: 'self', status: 'focus', stacks: -1 },
  { op: 'draw_cards', amount: -1 },
  { op: 'set_orb_slots', target: 'self', amount: -1 },
]) {
  await assert.rejects(
    core.runEffectCommandProgram(
      { spec: 'mwg.effect/v1', steps: [step] },
      { spentEnergy: 0 },
      { readState: () => structuredClone(state), execute: () => undefined },
    ),
    /不能为负数/,
  );
}

const choiceCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [{
      op: 'choose_one', choiceId: 'route', options: [
        { id: 'guard', label: '稳守', effects: [{ op: 'gain_block', target: 'self', amount: 6 }] },
        { id: 'strike', label: '强攻', effects: [{ op: 'damage', target: 'opponent', amount: 7 }] },
      ],
    }],
  },
  { spentEnergy: 0 },
  {
    readState: () => structuredClone(state),
    chooseEffectOption: choice => choice.options[1].id,
    execute: command => choiceCommands.push(command),
  },
);
assert.deepEqual(choiceCommands.map(command => command.type), ['choice_selected', 'damage']);
assert.equal(choiceCommands[0].optionId, 'strike');
await assert.rejects(core.runEffectCommandProgram(
  { spec: 'mwg.effect/v1', steps: [{ op: 'choose_one', choiceId: 'missing_host', options: [
    { id: 'a', label: '甲', effects: [{ op: 'draw_cards', amount: 1 }] },
    { id: 'b', label: '乙', effects: [{ op: 'draw_cards', amount: 2 }] },
  ] }] },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: () => undefined },
), /当前宿主不支持效果选择/);

const recoveryCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [{ op: 'recover_cards', source: 'exhaust', pick: 'random', amount: 2 }],
  },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => recoveryCommands.push(command) },
);
assert.deepEqual(recoveryCommands, [{ type: 'recover_cards', source: 'exhaust', pick: 'random', amount: 2 }]);

const seekCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [{ op: 'recover_cards', source: 'draw', pick: 'choose', amount: 1 }],
  },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => seekCommands.push(command) },
);
assert.deepEqual(seekCommands, [{ type: 'recover_cards', source: 'draw', pick: 'choose', amount: 1 }]);

const scryCommands = [];
await core.runEffectCommandProgram(
  { spec: 'mwg.effect/v1', steps: [{ op: 'scry_cards', amount: 3 }] },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => scryCommands.push(command) },
);
assert.deepEqual(scryCommands, [{ type: 'scry_cards', amount: 3 }]);

const specialCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [
      { op: 'set_stance', target: 'self', stance: { id: 'calm', name: '静心' } },
      {
        op: 'channel_orb', target: 'self',
        orb: { id: 'spark', name: '火花', value: { op: 'var', path: 'context.orb_value' } },
      },
      { op: 'evoke_orbs', target: 'self', selector: { pick: 'first', count: 1 } },
      { op: 'set_orb_slots', target: 'self', amount: 3 },
      { op: 'modify_orbs', target: 'self', selector: { pick: 'all' }, operator: 'add', value: 2 },
      { op: 'grant_extra_turn', target: 'self', amount: 1 },
      { op: 'force_end_turn', target: 'opponent' },
    ],
  },
  { spentEnergy: 0, orbValue: 4.5 },
  { readState: () => structuredClone(state), execute: command => specialCommands.push(command) },
);
assert.deepEqual(specialCommands, [
  { type: 'set_stance', target: 'self', stance: { id: 'calm', name: '静心' } },
  { type: 'channel_orb', target: 'self', orb: { id: 'spark', name: '火花', value: 4.5 } },
  { type: 'evoke_orbs', target: 'self', selector: { pick: 'first', count: 1 } },
  { type: 'set_orb_slots', target: 'self', amount: 3 },
  { type: 'modify_orbs', target: 'self', selector: { pick: 'all' }, operator: 'add', value: 2 },
  { type: 'grant_extra_turn', target: 'self', amount: 1 },
  { type: 'force_end_turn', target: 'opponent' },
]);

const attachmentCommands = [];
await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [{
      op: 'apply_card_attachment',
      selector: { zone: 'hand', pick: 'left', count: 1 },
      attachment: {
        id: 'command_enchantment', kind: 'enchantment', name: '命令附魔', scope: 'run',
        changes: [{ kind: 'cost', operator: 'subtract', value: { op: 'var', path: 'battle.turn_number' } }],
      },
    }],
  },
  { spentEnergy: 0 },
  { readState: () => structuredClone(state), execute: command => attachmentCommands.push(command) },
);
assert.equal(attachmentCommands[0].type, 'apply_card_attachment');
assert.equal(attachmentCommands[0].attachment.changes[0].value, state.currentTurn);

let terminal = false;
const terminalCommands = [];
const stopped = await core.runEffectCommandProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [
      { op: 'narrate', text: '离开战斗' },
      { op: 'gain_block', target: 'self', amount: 99 },
    ],
  },
  { spentEnergy: 0 },
  {
    readState: () => structuredClone(state),
    isTerminal: () => terminal,
    execute: command => {
      terminalCommands.push(command);
      if (command.type === 'narration') terminal = true;
    },
  },
);
assert.equal(stopped.completed, false);
assert.equal(stopped.stoppedAfter, '$.steps[0]');
assert.deepEqual(
  terminalCommands.map(command => command.type),
  ['narration'],
);

let touched = false;
await assert.rejects(
  core.runEffectCommandProgram(
    {
      spec: 'mwg.effect/v1',
      steps: [{ op: 'damage', target: 'opponent', amount: { op: 'divide', left: 1, right: 0 } }],
    },
    { spentEnergy: 0 },
    { readState: () => structuredClone(state), execute: () => (touched = true) },
  ),
  /不能除以 0/,
);
assert.equal(touched, false);

const hosted = [];
const commandHost = new TavernEffectCommandHost({
  readState: () => structuredClone(state),
  isTerminal: () => false,
  executeCardCommand: command => hosted.push(['card', command.type]),
  presentCommand: command => hosted.push(['present', command.type]),
  executeBattleCommand: (command, sourceIsPlayer) => hosted.push(['battle', command.type, sourceIsPlayer]),
  executeSpecialCommand: (command, sourceIsPlayer) => hosted.push(['special', command.type, sourceIsPlayer]),
  executeSummonCommand: (command, sourceIsPlayer) => hosted.push(['summon', command.type, sourceIsPlayer]),
  applyStatus: (target, status, stacks) => hosted.push(['apply_status', target, status, stacks]),
  removeStatuses: (target, selection) => hosted.push(['remove_status', target, selection]),
  registerAbility: (target, definition) => hosted.push(['ability', target, definition.trigger, definition.effectProgram]),
  narrate: text => hosted.push(['narrate', text]),
  chooseEffectOption: choice => Promise.resolve(choice.options[0].id),
  scheduleEffect: () => Promise.resolve(),
  setCardDestination: () => Promise.resolve(),
  forEachEnemyTarget: async (_selector, execute) => execute(),
});
await commandHost.executeProgram(
  {
    spec: 'mwg.effect/v1',
    steps: [
      { op: 'scry_cards', amount: 2 },
      {
        op: 'register_trigger',
        target: 'opponent',
        trigger: 'turn_start',
        effects: [{ op: 'gain_block', target: 'self', amount: 1 }],
      },
      { op: 'gain_energy', target: 'self', amount: 1 },
      { op: 'apply_status', target: 'opponent', status: 'weak', stacks: 2 },
      { op: 'remove_status', target: 'self', status: 'all' },
      { op: 'set_orb_slots', target: 'self', amount: 2 },
      {
        op: 'spawn_summon', target: 'self', count: 1,
        summon: { id: 'helper', name: '助手', emoji: '🧚', maxHp: 10 },
      },
      { op: 'activate_summons', selector: { owner: 'self', pick: 'all' } },
      { op: 'narrate', text: '离开战斗' },
    ],
  },
  false,
);
assert.deepEqual(hosted, [
  ['card', 'scry_cards'],
  ['ability', 'player', 'turn_start', { spec: 'mwg.effect/v1', steps: [{ op: 'gain_block', target: 'self', amount: 1 }] }],
  ['present', 'gain_energy'],
  ['battle', 'gain_energy', false],
  ['present', 'apply_status'],
  ['apply_status', 'player', 'weak', 2],
  ['present', 'remove_status'],
  ['remove_status', 'enemy', 'all_buffs'],
  ['present', 'set_orb_slots'],
  ['special', 'set_orb_slots', false],
  ['present', 'spawn_summon'],
  ['summon', 'spawn_summon', false],
  ['present', 'activate_summons'],
  ['summon', 'activate_summons', false],
  ['present', 'narration'],
  ['narrate', '离开战斗'],
]);

const executorSource = readFileSync(resolve('src/fish/combat/unifiedEffectExecutor.ts'), 'utf8');
const commandHostSource = readFileSync(resolve('src/fish/core/effectCommandHost.ts'), 'utf8');
assert.match(commandHostSource, /runEffectCommandProgram\(/);
assert.match(commandHostSource, /isCardEffectCommand\(command\)/);
assert.match(commandHostSource, /ports\.executeCardCommand\(command\)/);
assert.match(commandHostSource, /isBattleEffectCommand\(command\)/);
assert.match(commandHostSource, /ports\.executeBattleCommand\(command, sourceIsPlayer, resolvedEnemyId\)/);
assert.match(commandHostSource, /ports\.applyStatus\(/);
assert.match(commandHostSource, /ports\.removeStatuses\(/);
assert.match(commandHostSource, /ports\.executeSummonCommand\(command, sourceIsPlayer\)/);
assert.match(commandHostSource, /ports\.narrate\(command\.text\)/);
assert.doesNotMatch(executorSource, /runEffectCommandProgram|adaptBattleEffectCommandForTavern/);
assert.doesNotMatch(executorSource, /compileEffectCommandForTavern/);
assert.doesNotMatch(executorSource, /compileEffectProgramForTavern\(program\)/);
assert.match(commandHostSource, /command\.type === 'register_trigger'/);
assert.match(commandHostSource, /effectProgram,/);
assert.match(executorSource, /const previousPendingDeaths = this\.pendingDeaths/);
assert.match(executorSource, /effectCommandHost\.executeProgram\(program, sourceIsPlayer, context\)/);
assert.match(executorSource, /new BattleEffectRuntime\(this\.gameStateManager/);
assert.match(executorSource, /battleEffectRuntime\.execute\(effectiveCommand/);
assert.doesNotMatch(commandHostSource, /EffectExpression|executeExpression|effectCommandAdapter/);

console.log('Modern effect programs route cards, numeric battle effects, statuses, triggers, and narration.');
