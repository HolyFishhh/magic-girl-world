// Read retained evidence only. Never rerun generation, edit captures or infer
// semantics from AI prose. Review verdicts below point to human-readable audits.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {summarizeFixedOpenings} from './lib/fixed-opening-acceptance.mjs';
const bytes=readFileSync('tmp/live-initial-v192-plan.json');
assert.equal(createHash('sha256').update(bytes).digest('hex'),'a30f060b3eeba71a7597ac081d2dd39cccbeb15e7a82544d1d4ac8b168352db7');
const plan=JSON.parse(bytes),report=JSON.parse(readFileSync('tmp/batch-report-v192.json','utf8'));
assert.equal(report.candidate,'191a');
const review={103:'fail',104:'unverified',105:'fail',106:'fail',107:'fail'};
const rows=plan.scenarios.map(s=>{
  const evidence=report.samples.filter(r=>r.sample===s.number);assert.equal(evidence.length,1);
  const r=evidence[0];
  const binding=JSON.parse(readFileSync(`tmp/initial${s.number}-binding-v192.json`,'utf8'));
  assert.equal(r.chatId,binding.chatId);
  assert.equal(binding.extensionHash,plan.extensionSha256);assert.equal(binding.runtimeHash,plan.runtimeSha256);
  return {id:s.id,published:r.published,persisted:r.exactPersistence,mechanismCalls:r.mechanismRequests,semantics:review[s.number]};
});
assert.equal(new Set(report.samples.map(r=>r.chatId)).size,5);
const result=summarizeFixedOpenings(plan.scenarios.map(s=>s.id),rows);
assert.equal(result.verdict,'fail');assert.equal(result.additionalRate,.2);
console.log(JSON.stringify({...result,candidate:'191a',basis:'retained batch report plus explicit reviewed verdicts; not a fresh browser test',
  reviewSources:['docs/batch-191a-findings.md','docs/summon-target-194.md','tmp/replay-delay106-v196.log'],
  completionRateMeaning:'fraction proven complete; zero verified completions is not a claim that every scenario is unplayable'},null,2));
