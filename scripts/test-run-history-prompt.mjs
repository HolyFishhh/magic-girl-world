import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { buildTowerSemanticMvuContext, buildTowerGenerationContext } = require(resolve('src/sillytavern-extension/towerCoordinator.ts'));
const { buildSecondStageSemanticMvuContext } = require(resolve('src/sillytavern-extension/mvuPromptContext.ts'));
const { compactRunEventHistoryForPrompt } = require(resolve('src/sillytavern-extension/runHistoryPrompt.ts'));
const { createBattleEventJournal, appendBattleEvent, archiveBattleJournalInRun, createRunEventHistory,
  readBattleEventHistoryValue } = require(resolve('src/game-core/battleEventJournal.ts'));

// Independent decoder: column paths contain literal keys, never dotted path
// expressions. defineProperty handles __proto__ as data, not a prototype setter.
function restore(table) {
  if (!['mwg.run-event-history-columns/v1','mwg.run-event-history-columns/v2'].includes(table?.format)) return structuredClone(table);
  const stringTables = new Map((table.string_tables || []).map(entry=>[`${entry.field_set}:${entry.column}`,entry.values]));
  const records = [];
  for (const encounter of table.encounters) {
    for (const row of encounter.rows) {
      const columns = table.field_sets[row[0]];
      assert.equal(row.length, columns.length + 1);
      const event = {};
      for (let index = 0; index < columns.length; index++) {
        const path = columns[index];
        let target = event;
        for (const key of path.slice(0, -1)) {
          if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, {value:{}, enumerable:true});
          target = target[key];
        }
        const strings = stringTables.get(`${row[0]}:${index}`);
        const stored = row[index + 1];
        if (strings) { assert.ok(Number.isInteger(stored)&&stored>=0&&stored<strings.length);assert.equal(typeof strings[stored],'string'); }
        Object.defineProperty(target, path.at(-1), {value:structuredClone(strings ? strings[stored] : stored), enumerable:true});
      }
      records.push({encounterId: encounter.encounter_id, event});
    }
  }
  return {schemaVersion: table.source_schema_version, records};
}

function journalFixture(count = 60) {
  let journal = createBattleEventJournal();
  for (let i = 0; i < count; i++) {
    const added = appendBattleEvent(journal, {
      kind: 'damage_resolved', phase: 'resolve', turn: Math.floor(i / 4) + 1,
      actorId: 'player', targetId: 'enemy:paper', actorSide: 'player', targetSide: 'enemy',
      damageKind: 'attack', requested: 6, modified: 6, blocked: i % 2, hpLost: 6 - i % 2, fatal: false,
      cause: {source: {kind:'card', id:'paper_needle', name:'纸针', ownerId:'player'}, reason:'effect'},
    });
    assert.equal(added.ok, true);
    journal = added.state;
  }
  return journal;
}
let history = archiveBattleJournalInRun(createRunEventHistory(), 'encounter_a', journalFixture());
history = archiveBattleJournalInRun(history, 'encounter_b', journalFixture(44));
const variables = {stat_data:{game_mode:'tower', battle:{cards:[{id:'original', effects:[{damage:6}], quantity:1}]},
  status:{time:'夜间', location:'纸塔', profession:{name:'修复师'}}, run_event_history:history,
  story_fact:{text:'拒绝了镜中人的交易；仍然带着信件。'}, tower_requirements:'保留召唤与主动弃牌'}};
const before = structuredClone(variables);
const view = buildTowerSemanticMvuContext(variables);
const packed = view.stat_data.run_event_history;
assert.equal(packed.format, 'mwg.run-event-history-columns/v2', 'large runtime history must share repeated string values as well as keys');
assert.ok(packed.string_tables.length>0);
assert.ok(JSON.stringify(packed).length < JSON.stringify(history).length * 0.8);
assert.deepEqual(restore(packed), history, 'every original event, source, field, value and chronological position survives');
assert.deepEqual(variables, before, 'canonical MVU is immutable');
assert.deepEqual(view.stat_data.story_fact, before.stat_data.story_fact);
assert.deepEqual(buildSecondStageSemanticMvuContext(variables).stat_data.run_event_history, packed,
  'tower MVU second-stage uses the same projection');
assert.deepEqual(buildSecondStageSemanticMvuContext({...variables,stat_data:{...variables.stat_data,game_mode:'story'}})
  .stat_data.run_event_history, history, 'ordinary story-mode history is unchanged');
const context = buildTowerGenerationContext({mvuData:variables, designSnapshot:null, designState:{lineage:{}},
  settings:{difficultyPercent:80},chatId:'fixture',messageId:0});
assert.deepEqual(JSON.parse(context.completeMvuContext).stat_data.run_event_history, packed,
  'formal node authoring gets the compact history');
function assertHistoryQueriesAgree(original, restored) {
  const roundTripJournal = createBattleEventJournal([], restored);
  const originalJournal = createBattleEventJournal([], original);
  const kinds = [...new Set(['damage_resolved', 'card_played', ...original.records.map(record => record.event.kind)])];
  for (const kind of kinds) {
    for (const metric of ['count','last_damage','last_hp_loss','last_heal','last_resource_spent','last_turn','last_sequence']) {
      assert.equal(readBattleEventHistoryValue(roundTripJournal,{scope:'run',filter:{kind},metric}),
        readBattleEventHistoryValue(originalJournal,{scope:'run',filter:{kind},metric}), `${kind}/${metric}`);
    }
  }
}
assertHistoryQueriesAgree(history, restore(packed));
console.log('PASS: production journal fixture has an exact event-order/field/value round trip; MVU/gameplay facts are immutable and run-history queries agree.');

// Opaque literal transport, not gameplay validation: absent vs null, nested
// extension data, empty containers and path-like keys must never be reinterpreted.
const edge = structuredClone(history);
for (let i = 0; i < edge.records.length; i++) {
  const event = edge.records[i].event;
  if (i % 3 === 0) event.optional = null;
  if (i % 4 === 0) delete event.actorSide;
  if (i % 5 === 0) event.cause.source = {};
  event.literal = {nested:{text:'two  spaces\n  中文 "quote" \\ slash'},list:[null,false,0,'']};
  Object.defineProperty(event, '__proto__', {value: {retained: i}, enumerable:true});
  event['cause.source.id'] = 'literal.dot.key';
  event.cause.source['nested.key'] = {notFlattened: true};
  if (i % 7 === 0) edge.records[i].encounterId = 'interleaved';
}
const edgeBefore = structuredClone(edge);
const edgePacked = compactRunEventHistoryForPrompt(edge);
assert.equal(edgePacked.format,'mwg.run-event-history-columns/v1', 'v1 is retained when literal extension fields make value sharing uneconomic');
assert.deepEqual(restore(edgePacked), edgeBefore, 'no missing/null merging, path splitting, chronology regrouping or literal mutation');
assert.deepEqual(edge, edgeBefore);
assert.equal({}.retained, undefined, 'prototype-like instance keys remain data');
assert.deepEqual(compactRunEventHistoryForPrompt(edge), edgePacked, 'deterministic on the same input');
assert.deepEqual(compactRunEventHistoryForPrompt(edgePacked), edgePacked, 'already encoded input is not packed twice');
const valueEdges=structuredClone(history);
for(let i=0;i<valueEdges.records.length;i++) {
  const event=valueEdges.records[i].event;
  event.sharedString='  12\n文字 "quote" \\ \\';
  event.mixed=i%2?12:'12';
  event.nullable=i%2?null:'12';
  event.literal={field_set:0,column:0,values:['literal']};
  Object.defineProperty(event,'__proto__',{value:'retained prototype-like key',enumerable:true});
}
const valueBefore=structuredClone(valueEdges),valuePacked=compactRunEventHistoryForPrompt(valueEdges);
assert.equal(valuePacked.format,'mwg.run-event-history-columns/v2');
assert.deepEqual(restore(valuePacked),valueBefore,'dictionary values preserve numeric-looking strings, whitespace and literal objects; mixed numbers/null are not indices');
assert.deepEqual(valueEdges,valueBefore);assert.equal({}.values,undefined);
for(const table of valuePacked.string_tables){
  const path=valuePacked.field_sets[table.field_set][table.column];
  assert.ok(!['mixed','nullable','literal'].includes(path[0]),'mixed/non-string columns must not be indexed');
}
assert.deepEqual(compactRunEventHistoryForPrompt(valuePacked),valuePacked,'v2 is never interpreted as a canonical runtime history');
// Independently calculate both sides of the strict 20% v2/v1 boundary. Padding
// stays inside literal objects, so it cannot become a shared string column.
const paddingFixture=n=>{const copy=structuredClone(history);for(const record of copy.records)record.event.literalPadding={padding:'x'.repeat(n)};return copy;};
const baseV2=compactRunEventHistoryForPrompt(paddingFixture(0));
assert.equal(baseV2.format,'mwg.run-event-history-columns/v2');
const baseV1=structuredClone(baseV2);
baseV1.format='mwg.run-event-history-columns/v1';baseV1.instructions=baseV1.instructions.split('string_tables仅共享')[0];
assert.ok(baseV1.instructions.length<baseV2.instructions.length);
for(const table of baseV1.string_tables)for(const e of baseV1.encounters)for(const row of e.rows)if(row[0]===table.field_set)row[table.column+1]=table.values[row[table.column+1]];
delete baseV1.string_tables;
const v1Size=JSON.stringify(baseV1).length,v2Size=JSON.stringify(baseV2).length;
const crossing=Math.ceil((0.8*v1Size-v2Size)/(0.2*history.records.length));
assert.ok(crossing>1&&crossing<10000);
for(const [padding,expectedFormat] of [[crossing-1,'mwg.run-event-history-columns/v2'],[crossing+1,'mwg.run-event-history-columns/v1']]){
  const input=paddingFixture(padding),actual=compactRunEventHistoryForPrompt(input);
  const expectedV1=v1Size+padding*history.records.length,expectedV2=v2Size+padding*history.records.length;
  assert.equal(expectedV2<expectedV1*0.8,expectedFormat.endsWith('/v2'));
  assert.equal(actual.format,expectedFormat,'upgrade only across the independently computed strict size threshold');
  assert.equal(JSON.stringify(actual).length,expectedFormat.endsWith('/v2')?expectedV2:expectedV1);
  assert.deepEqual(restore(actual),input);
}
const nonV1Candidate={schemaVersion:1,records:Array.from({length:30},()=>({encounterId:'a',event:{a:'repeat-string'.repeat(300)}}))};
assert.deepEqual(compactRunEventHistoryForPrompt(nonV1Candidate),nonV1Candidate,
  'deliberate scope: do not introduce dictionary-only encoding where the prior v1 path was uneconomic');
for (const invalid of [null, undefined, {}, {schemaVersion:2,records:history.records},
  {...history,unknownMetadata:{keep:true}}, {schemaVersion:1,records:[{...history.records[0],extra:'keep'}]},
  {schemaVersion:1,records:[{encounterId:'a',event:null}]},
  {schemaVersion:1,records:[{encounterId:'a',event:{value:undefined}}]},
  {schemaVersion:1,records:[{encounterId:'a',event:{value:NaN}}]},
  {schemaVersion:1,records:[{encounterId:'a',event:{value:-0}}]},
  {schemaVersion:1,records:[]}, {schemaVersion:1,records:[history.records[0]]},
  {schemaVersion:1,records:Array.from({length:20_001},()=>history.records[0])},
  {schemaVersion:1,records:Array.from({length:129},(_,i)=>({encounterId:'a',event:{['unique_'+i]:i}}))},
]) {
  const before = structuredClone(invalid);
  assert.deepEqual(compactRunEventHistoryForPrompt(invalid), before, 'unrecognized/uneconomic data stays exact, never truncated');
  assert.deepEqual(invalid, before);
}
console.log('PASS: literal/absent/null/order/determinism/prototype safety and conservative envelope/size/shape fallback checks.');

// Optional real-save replay is explicit and read-only; CI does not require the
// user's private test saves. It does not count as a new model/UI acceptance.
const saveIndex = process.argv.indexOf('--live-save');
if (saveIndex !== -1) {
  const saved = JSON.parse(readFileSync(process.argv[saveIndex + 1], 'utf8'));
  const message = saved.records[1];
  const root = message.variables[message.swipe_id];
  const before = structuredClone(root);
  const actual = buildTowerSemanticMvuContext(root).stat_data.run_event_history;
  assert.equal(actual.format, 'mwg.run-event-history-columns/v2');
  assert.deepEqual(restore(actual), root.stat_data.run_event_history);
  assertHistoryQueriesAgree(root.stat_data.run_event_history, restore(actual));
  assert.deepEqual(root, before);
  console.log(JSON.stringify({readOnlyRealSave:true, records:root.stat_data.run_event_history.records.length,
    beforeCharacters:JSON.stringify(root.stat_data.run_event_history).length,
    afterCharacters:JSON.stringify(actual).length, exactRoundTrip:true, historyQueriesAgree:true}));
}

assert.match(context.deckBalanceContext, /见完整游戏事实/);
assert.doesNotMatch(context.deckBalanceContext, /"battle"|"run"/, 'fallback must not duplicate complete gameplay facts');
