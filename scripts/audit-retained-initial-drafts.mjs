import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { inspectInitialDraft, INITIAL_DRAFT_SPEC } = require('../src/game-core/initialDraft.ts');
const { decodeInitialDraftContainers } = require('../src/sillytavern-extension/initialDraftDecoding.ts');
const { normalizeMvuPlayerAuthoredContent } = require('../src/runtime/mvuBattleContentNormalizer.ts');
const { createContentPackFromMvuBattle } = require('../src/runtime/contentPackAdapter.ts');
const { assessInitialPlayerContent } = require('../src/game-core/playerContentReadiness.ts');
const { collectRewardCandidateTypedContractIssues } = require('../src/game-core/rewardCandidateValidation.ts');
const files = [[46,81],[47,84],[48,93],[49,93],[50,93],[51,93],[52,93],[53,102]];
const results = [];
for (const [sample, version] of files) {
  const file = new URL(`../tmp/initial${sample}-mechanism-final-v${version}.json`, import.meta.url);
  const bytes = readFileSync(file);
  const entries = JSON.parse(bytes);
  const drafts = entries.filter(entry => entry.value?.player !== undefined && entry.value?.registry !== undefined);
  if (!drafts.length) results.push({ sample, state: 'no_retained_draft', retainedEntries: entries.length });
  for (const [index, entry] of drafts.entries()) {
    const source = structuredClone(entry.value);
    const sourceBefore = JSON.stringify(source);
    try {
      // A diagnostic envelope only: no reconstructed story is counted as evidence.
      const decoded = decodeInitialDraftContainers({ ...source, spec: source.spec ?? INITIAL_DRAFT_SPEC,
        narrative: 'DIAGNOSTIC ONLY: retained mechanism replay, not original preset narrative' });
      const draft = normalizeMvuPlayerAuthoredContent(decoded);
      const inspection = inspectInitialDraft(draft, preview => {
        const issues = assessInitialPlayerContent(createContentPackFromMvuBattle(preview.player)).issues
          .map(issue => ({ ...issue, stage: 'player' }));
        const statuses = preview.player.statuses ?? [];
        for (const [choiceIndex, choice] of (preview.opening?.choices ?? []).entries()) {
          for (const category of ['cards', 'artifacts', 'items']) {
            for (const [candidateIndex, candidate] of (choice.outcome?.reward?.[category] ?? []).entries()) {
              const found = collectRewardCandidateTypedContractIssues(category, candidate,
                { statusDefinitions: statuses, knownStatusIds: statuses.map(s => s.id) });
              issues.push(...found.map(issue => ({ ...issue, stage: 'reward',
                owner: `opening.choices[${choiceIndex}].outcome.reward.${category}[${candidateIndex}]` })));
            }
          }
        }
        return issues;
      });
      results.push({ sample, index, inspected: inspection.inspected, references: inspection.references,
        rules: inspection.rules, cleanAtInspectedLayers: inspection.inspected && !inspection.references.length && !inspection.rules.length });
    } catch (error) {
      results.push({ sample, index, error: String(error.message) });
    }
    assert.equal(JSON.stringify(source), sourceBefore);
  }
  assert.deepEqual(readFileSync(file), bytes, 'retained evidence must remain unchanged');
  results.filter(result => result.sample === sample).forEach(result => {
    result.sha256 = createHash('sha256').update(bytes).digest('hex');
  });
}
console.log(JSON.stringify({ scope: 'Read-only retained payload batch, current decoding/normalization/reference and player/reward contracts. Not full opening parse, semantic play, original narrative, provider attribution, or new acceptance samples.', results }, null, 2));
