import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { compileInitialDraftToMvu } = require('../src/game-core/initialDraft.ts');
const { normalizeMvuPlayerAuthoredContent } = require('../src/runtime/mvuBattleContentNormalizer.ts');
for (const number of [66, 67]) {
  const path = `tmp/initial${number}-mechanism-final-v120.json`;
  const bytes = readFileSync(path, 'utf8');
  const responses = JSON.parse(bytes);
  assert.equal(responses.length, 1);
  const raw = responses[0].value;
  const saved = JSON.parse(readFileSync(`tmp/initial${number}-final-browser-v120.json`, 'utf8')).root.stat_data.battle;
  const result = compileInitialDraftToMvu(normalizeMvuPlayerAuthoredContent({ ...raw,
    narrative: 'Offline compilation stub, not a replacement for the preset story.' }));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  for (const field of ['cards', 'artifacts', 'player_abilities']) {
    for (const original of raw.player[field] || []) {
      for (const actual of [result.value.player, saved]) {
        const definition = actual[field].find(x => x.id === original.id);
        assert.ok(definition, `${number}:${field}:${original.id}`);
        for (const rule of ['effects', 'trigger', 'discard_effects', 'exhaust_effects'])
          assert.deepEqual(definition[rule], original[rule], `${number}:${original.id}:${rule}`);
      }
    }
  }
  assert.deepEqual(raw.player.player_abilities || [], []);
  assert.deepEqual(result.value.player.player_abilities || [], []);
  assert.deepEqual(saved.player_abilities || [], []);
  if (number === 66) {
    assert.deepEqual(raw.registry.statuses, []);
    assert.deepEqual(raw.player.artifacts.map(x => x.trigger.on), ['battle_start']);
  } else {
    assert.equal(raw.registry.statuses.length, 1);
    const status = raw.registry.statuses[0];
    assert.deepEqual(Object.keys(status.triggers), ['hold']);
    for (const actual of [result.value.player, saved])
      assert.deepEqual(actual.statuses.find(x => x.id === status.id).triggers, status.triggers);
    // Templates alone are not event listeners; don't mistake definitions for invocation.
    assert.deepEqual(raw.player.artifacts.map(x => x.trigger.on), ['turn_start']);
  }
  assert.equal(readFileSync(path, 'utf8'), bytes);
  console.log(`PASS ${number}: retained author rules preserved through compiler and saved MVU; missing listener is already absent in original response. No live gameplay claim.`);
}
