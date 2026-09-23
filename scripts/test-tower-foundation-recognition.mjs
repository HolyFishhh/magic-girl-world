import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));
const catalog = require(resolve('src/game-core/towerArchetypeCatalog.ts'));
const { createContentPackFromMvuBattle } = require(resolve('src/runtime/contentPackAdapter.ts'));
const read = pack => new Map(core.recognizeTowerFoundations(core.createContentPack(pack)).map(entry => [entry.id, entry]));
assert.deepEqual(new Set(core.towerFoundationRecognitionRuleIds()), new Set(catalog.TOWER_ARCHETYPE_PRESETS.map(entry => entry.id)), 'explicit rules must cover the complete picker catalog');

function compiled(effects, options = {}) {
  const result = core.compileCompactEffectList(effects, options);
  assert.equal(result.ok, true, `fixture must compile: ${JSON.stringify(result.issues)}`);
  return result.value;
}
function both(label, effects, expected, card = {}, options = {}) {
  const program = compiled(effects, options);
  const compact = { id: `${label}_compact`, name: label, type: 'Skill', effects, ...card };
  const compiledCard = { id: `${label}_compiled`, name: label, type: 'Skill', effectProgram: program, ...card };
  for (const result of [read({ cards: [compact] }), read({ cards: [compiledCard] })]) {
    for (const id of expected) assert.equal(result.get(id)?.detected, true, `${label} must detect ${id} in compact and compiled forms`);
  }
}

both('packet', { damage: 3, hits: 2, bypass_block: true, lifesteal: 1 }, ['direct-damage', 'multi-hit', 'piercing', 'lifesteal']);

for (const [mode, id] of [['copy', 'status-copy'], ['transfer', 'status-transfer']]) {
  const effect = { status_action: { mode, from: 'opponent', to: 'self', pick: 'first', filter: { type: 'buff' }, stacks: 1 } };
  both(`status_${mode}`, effect, [id]);
  const other = mode === 'copy' ? 'status-transfer' : 'status-copy';
  assert.equal(read({ cards: [{ id: mode, type: 'Skill', effects: effect }] }).get(other)?.detected, false, `${mode} must not impersonate ${other}`);
  assert.equal(read({ cards: [{ id: mode, type: 'Skill', effects: effect }] }).get('status-cleanse')?.detected, false, `${mode} must not impersonate cleansing`);
}
for (const [payment, id, other] of [
  [{ additional: { hp: 2 } }, 'additional-payment', 'alternative-payment'],
  [{ alternatives: [{ id: 'blood', name: '血誓', cost: 0, hp: 2 }] }, 'alternative-payment', 'additional-payment'],
]) {
  const card = { id, name: id, type: 'Skill', cost: 1, payment, effects: { block: 8 } };
  const result = read({ cards: [card] });
  assert.equal(result.get(id)?.detected, true, `${id} must recognize executable payment structure`);
  assert.equal(result.get(other)?.detected, false, `${id} must not imply ${other}`);
}
for (const [window, id, other] of [
  ['before_damage', 'damage-interception', 'card-play-interception'],
  ['before_card_play', 'card-play-interception', 'damage-interception'],
]) {
  const status = { id, type: 'buff', intercepts: [{ id: 'rule', window, cancel: true }] };
  const result = read({ activeStatuses: [status] });
  assert.equal(result.get(id)?.detected, true, `${id} must recognize a held interception rule`);
  assert.equal(result.get(other)?.detected, false, `${window} must not imply ${other}`);
  assert.equal(read({ statuses: [status] }).get(id)?.detected, false, 'an unused status definition is not evidence of a build');
}
assert.equal(read({ cards: [{ id: 'named_only', name: '状态复制、血誓和伤害拦截', type: 'Skill', effects: { block: 8 } }] }).get('status-copy')?.detected, false, 'a flavor-only name is never structural evidence');

for (const compiledForm of [false, true]) {
  const effects = { damage: 6 };
  const card = { id: `starter_${compiledForm}`, type: 'Attack', ...(compiledForm ? { effectProgram: compiled(effects) } : { effects }) };
  assert.equal(read({ cards: [card] }).get('direct-damage')?.detected, false, `plain 6 damage starter is not a foundation (${compiledForm ? 'compiled' : 'compact'})`);
}
for (const [kind, value, expected] of [['damage', 6, false], ['damage', 7, false], ['block', 6, false], ['block', 7, false]]) {
  for (const compiledForm of [false, true]) {
    const effects = { [kind]: value };
    const card = { id: `${kind}_${value}_${compiledForm}`, type: kind === 'damage' ? 'Attack' : 'Skill', ...(compiledForm ? { effectProgram: compiled(effects) } : { effects }) };
    const foundation = kind === 'damage' ? 'direct-damage' : 'block-gain';
    assert.equal(read({ cards: [card] }).get(foundation)?.detected, expected, `${kind} ${value} must have symmetric compact/compiled starter boundary`);
  }
}
assert.equal(read({ cards: [{ id: 'curse_low', type: 'Curse', effects: { damage: 6 } }] }).get('direct-damage')?.detected, true, 'a Curse is never discarded as a starter');
const ordinaryEnergy = { id: 'energy_default', type: 'Attack', cost: { energy: 1 }, flavor: '只是展示', metadata: { ui: 'ignored' }, retain: false, exhaust: false, effects: [{ damage: 6 }] };
for (const kind of ['damage','block']) for (const compiledForm of [false,true]) for (const unique of [false,true]) {
  const effects = {[kind]:6};
  const card = {id:`unique_${kind}_${compiledForm}_${unique}`,type:kind==='damage'?'Attack':'Skill',unique,...(compiledForm?{effectProgram:compiled(effects)}:{effects})};
  assert.equal(read({cards:[card]}).get(kind==='damage'?'direct-damage':'block-gain')?.detected,unique,'unique:false is neutral while unique:true remains a special card');
}
assert.equal(read({ cards: [ordinaryEnergy] }).get('direct-damage')?.detected, false, 'ordinary energy cost, presentation metadata and false defaults do not make a starter a foundation');
const adaptedRuntimeStarter = createContentPackFromMvuBattle({
  core: { emoji: '◇', hp: 20, max_hp: 20, lust: 0, max_lust: 100 },
  cards: [{ id: 'runtime_strike', templateId: 'strike_template', runInstanceId: 'strike_template__run__1', origin: 'deck', upgrade_level: 2, quantity: 1, type: 'Attack', cost: { energy: 1 }, effects: [{ damage: 6 }] }],
  artifacts: [], items: [], statuses: [], player_abilities: [], player_status_effects: [], enemies: [],
});
assert.equal(adaptedRuntimeStarter.cards[0].runInstanceId, 'strike_template__run__1', 'adapter fixture must retain actual runtime identity fields');
assert.equal(new Map(core.recognizeTowerFoundations(adaptedRuntimeStarter).map(entry => [entry.id, entry])).get('direct-damage')?.detected, false, 'adapter-produced runtime starter is not foundation evidence');
const migratedRuntimeStarter = core.migratePersistentRunDeck([{ id: 'migrated_strike', type: 'Attack', quantity: 1, cost: 1, effects: [{ damage: 6 }] }]);
const migratedAdapterPack = createContentPackFromMvuBattle({ core: { emoji: '◇', hp: 20, max_hp: 20, lust: 0, max_lust: 100 }, cards: migratedRuntimeStarter, artifacts: [], items: [], statuses: [], player_abilities: [], player_status_effects: [], enemies: [] });
assert.ok(migratedAdapterPack.cards[0].templateId && migratedAdapterPack.cards[0].runInstanceId, 'persistent migration must supply runtime card identity before adapter projection');
assert.equal(new Map(core.recognizeTowerFoundations(migratedAdapterPack).map(entry => [entry.id, entry])).get('direct-damage')?.detected, false, 'migrated runtime starter remains excluded after adapter projection');
for (const compiledForm of [false, true]) {
  const effects = { damage: 6, hits: 1, bypass_block: false, lifesteal: 0 };
  const card = { id: `semantic_defaults_${compiledForm}`, type: 'Attack', ...(compiledForm ? { effectProgram: compiled(effects) } : { effects }) };
  assert.equal(read({ cards: [card] }).get('direct-damage')?.detected, false, `semantic default combat fields remain a starter (${compiledForm ? 'compiled' : 'compact'})`);
}
for (const effects of [{ damage: 6, hits: 2 }, { damage: 6, bypass_block: true }, { damage: 6, lifesteal: 1 }]) {
  assert.equal(read({ cards: [{ id: `special_${Object.keys(effects)[1]}`, type: 'Attack', effects }] }).get('direct-damage')?.detected, true, 'non-default combat distinction remains foundation evidence');
}
const compiledSpecial = { id: 'compiled_special', type: 'Attack', effects: { damage: 6 }, effectProgram: compiled({ damage: 6, hits: 2 }) };
assert.equal(read({ cards: [compiledSpecial] }).get('direct-damage')?.detected, true, 'a retained special compiled program overrides an ordinary compact shadow');
assert.equal(read({ cards: [{ id: 'seven', type: 'Attack', effects: { damage: 7 } }] }).get('direct-damage')?.detected, false, 'numeric-only upgrades preserve starter classification');
for (const compiledForm of [false, true]) {
  const effects = { damage: 7 };
  const card = { id: `seven_single_hit_${compiledForm}`, type: 'Attack', ...(compiledForm ? { effectProgram: compiled(effects) } : { effects }) };
  assert.equal(read({ cards: [card] }).get('multi-hit')?.detected, false, `one compiled provenance group is not multi-hit (${compiledForm ? 'compiled' : 'compact'})`);
}
assert.equal(read({ cards: [{ id: 'small_special', type: 'Attack', effects: { damage: 6, hits: 2 } }] }).get('direct-damage')?.detected, true, 'special low-value attack remains evidence');
both('seek', { seek: 1 }, ['seek']);
both('recover', { recover: 1, from: 'discard', pick: 'choose' }, ['discard-recovery']);
both('stance', { stance: { id: 'flow', name: '流', passive: { modify: 'damage', add: 1 }, enter: { block: 2 } } }, ['stance-switch', 'stance-passive', 'stance-entry']);
both('schedule', { schedule: 1, phase: 'turn_end', repeat_every: 1, repeats: 2, effects: { damage: 1 } }, ['schedule', 'repeating-schedule']);
both('first_n', { damage: 1 }, ['first-n'], { type: 'Power', trigger: { on: 'attack_played', scope: 'turn', ordinal: 'first_n', n: 2, effects: { damage: 1 } } }, { trigger: 'attack_played', triggerQuery: { scope: 'turn', ordinal: 'first_n', n: 2 } });
both('resource_pay', { damage: 2 }, ['resource-spend'], { cost: { charge: 2 } });

const statusEffects = { apply_status: 'weak', to: 'opponent' };
const statusProgram = compiled(statusEffects);
for (const result of [
  read({ cards: [{ id: 'apply_compact', name: '施加', type: 'Skill', effects: statusEffects }], statuses: [{ id: 'weak', name: '虚弱', type: 'debuff', duration: 2 }] }),
  read({ cards: [{ id: 'apply_compiled', name: '施加', type: 'Skill', effectProgram: statusProgram }], statuses: [{ id: 'weak', name: '虚弱', type: 'debuff', duration: 2 }] }),
]) assert.equal(result.get('negative-control')?.detected, true, 'reachable debuff status must be recognized in both forms');

both('summon_passive', { spawn_summon: { id: 'core', name: '核心', emoji: '◈', slot: 'core', max_hp: 8, abilities: [{ id: 'ward', trigger: 'turn_end', effects: { block: 1 } }] } }, ['summon-single-core', 'summon-passive']);
both('summon_hp', { spawn_summon: { id: 'heart', name: '心核', emoji: '♥', max_hp: 8, actions: [{ id: 'pulse', name: '脉冲', effects: { damage: 'self.hp' } }] } }, ['summon-hp-scaling']);
both('summon_order', { activate_summon: { selector: { owner: 'self', template_id: 'core' }, action: { id: 'burst', name: '爆发', effects: { damage: 2 } } } }, ['summon-command', 'summon-ordered-action']);
both('summon_gate', { block: 1 }, ['summon-required-card'], { requires_summon: 'core' });

const plain = read({ cards: [{ id: 'plain', name: '普通', type: 'Attack', effects: { damage: 4 } }] });
for (const id of ['multi-hit', 'piercing', 'lifesteal', 'summon-swarm']) assert.equal(plain.get(id)?.detected, false, `plain damage cannot impersonate ${id}`);
assert.equal(read({ cards: [{ id: 'zero', name: '零吸血', type: 'Attack', effects: { damage: 4, lifesteal: 0 } }] }).get('lifesteal')?.detected, false, 'zero lifesteal is not a lifesteal mechanism');
assert.equal(read({ cards: [{ id: 'one', name: '单体', type: 'Skill', effects: { damage: 2, count: 3 } }] }).get('multi-hit')?.detected, false, 'an unrelated count field is not damage hits');
assert.equal(read({ statuses: [{ id: 'enemy_burn', name: '敌方灼烧', type: 'debuff', triggers: { tick: { effects: { damage: 99 } } } }] }).get('direct-damage')?.detected, false, 'unreferenced enemy status definitions are outside player evidence');
console.log('tower foundation recognition checks passed');

const unusedChild={id:'unused',name:'未使用子卡',type:'Skill',cost:1,effects:{damage:8,bypass_block:true}};
assert.equal(read({cards:[{id:'plain_with_registry',type:'Skill',effects:{block:2},creates:[unusedChild]}]}).get('piercing').detected,false,'unused creates definitions are not owned engine evidence');
const linkedChild={id:'linked',name:'真实子卡',type:'Skill',cost:1,effects:{damage:8,bypass_block:true}};
both('child_reference',{add_card:'linked',to:'hand'},['generated-card','piercing'],{creates:[linkedChild]},{creates:[linkedChild]});
both('random_self',{heal:2,targets:{mode:'random',team:'self'}},['random-ally']);
both('all_enemy',{damage:2,targets:{mode:'all'}},['all-enemies']);
const spawn={spawn_summon:{id:'bomb',name:'炸弹',emoji:'💣',max_hp:3,abilities:[{id:'burst',name:'爆炸',trigger:'defeated',effects:{damage:5}}]}};
const dismiss={dismiss_summon:{selector:{owner:'self',template_id:'bomb'}}};
for(const compiledForm of [false,true]) {
 const parts=[spawn,dismiss].map((effects,i)=>({id:'bomb_part_'+i,type:'Skill',...(compiledForm?{effectProgram:compiled(effects)}:{effects})}));
 const result=read({cards:parts}).get('summon-self-destruct');
 assert.equal(result.detected,true,'matching summon setup and sacrifice can live on different cards');
 assert.deepEqual(new Set(result.supportingIds),new Set(['bomb_part_0','bomb_part_1']));
 const mismatch={dismiss_summon:{selector:{owner:'self',template_id:'other'}}};
 assert.equal(read({cards:[parts[0],{id:'wrong',effects:mismatch}]}).get('summon-self-destruct').detected,false,'unrelated summon identities do not establish a sacrifice loop');
}
console.log('Reachable child templates, team targets and cross-card summon identity evidence passed.');
