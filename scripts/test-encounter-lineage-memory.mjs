import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const core = require(resolve('src/game-core/index.ts'));

function pack(enemy) {
  return core.createContentPack({ enemy });
}

const scout = {
  id: 'gel_scout', family_id: 'gel_family', family_name: '胶质兽群', evolution_stage: '幼体', name: '腐蚀胶质兽', hp: 30, max_hp: 30,
  actions: [
    { id: 'spray', name: '腐液喷射', effects: { damage: 4, apply_status: 'erosion', stacks: 2, to: 'opponent' } },
    { id: 'guard', name: '胶壳收缩', effects: { block: 6 } },
  ],
  abilities: [],
};
let memory = core.updateEncounterLineageMemory(null, pack(scout));
assert.equal(memory.spec, 'mwg.encounter-lineage/v1');
assert.equal(memory.families.length, 1);
assert.equal(memory.families[0].canonicalActions.length, 2);
assert.deepEqual(memory.families[0].stages, ['幼体']);

const boss = {
  id: 'gel_king', family_id: 'gel_family', family_name: '胶质兽群', evolution_stage: '首领', name: '腐蚀胶质王', hp: 90, max_hp: 90,
  actions: [
    { id: 'spray', name: '王冠腐液喷射', effects: { damage: 4, apply_status: 'erosion', stacks: 2, to: 'opponent' } },
    { id: 'split', name: '王体分裂', effects: { spawn_enemy: { id: 'gel_child', name: '幼体', max_hp: 12, actions: [] } } },
  ],
  abilities: [],
};
const review = core.reviewEnemyLineageContinuity(memory, boss);
assert.equal(review.knownFamily, true);
assert.ok(review.sharedActionCount >= 1, 'renaming an inherited action must not hide its mechanical continuity');
assert.equal(review.issues.length, 0);
memory = core.updateEncounterLineageMemory(memory, pack(boss));
assert.equal(memory.families[0].encounters, 2);
assert.ok(memory.families[0].memberNames.includes('腐蚀胶质王'));
assert.deepEqual(memory.families[0].stages, ['幼体', '首领']);
assert.ok(core.formatEncounterLineageForModel(memory).some(line => line.includes('胶质兽群')));
const promptView = core.createEncounterLineagePromptView(memory, pack(boss));
assert.equal(promptView.families.length, 1);
assert.ok(promptView.families[0].canonicalActions.length <= 2, 'model-facing lineage must stay compact');
assert.ok(promptView.families[0].canonicalActions.every(action => !('action_config' in action.definition)));

const drifted = {
  id: 'gel_fake', family_id: 'gel_family', name: '完全漂移的胶质兽', hp: 40, max_hp: 40,
  actions: [{ id: 'plain', name: '普通挥击', effects: { damage: 9 } }],
};
const driftReview = core.reviewEnemyLineageContinuity(memory, drifted);
assert.ok(driftReview.issues.length > 0, 'an explicit family that drops all inherited structure must be called out');

const unrelated = { id: 'stranger', name: '无关联旅人', hp: 20, max_hp: 20, actions: [{ name: '等待', effects: { block: 1 } }] };
const unrelatedReview = core.reviewEnemyLineageContinuity(memory, unrelated);
assert.equal(unrelatedReview.knownFamily, false, 'the program must not force semantic family identity from a name guess');

console.log('Enemy lineage memory preserves bounded family actions without forcing semantic guesses.');
