// Read-only, bounded replay of an ACTUAL failed node batch. No chat/MVU writes.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createTavernApi, getSettings } from './lib/tavern-api.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { parseTowerNodeBatchResult } = require('../src/game-core/towerRequest.ts');
const { validateTowerBattleNodeForActivation, validateTowerEventNodeForActivation, normalizeTowerReward } = require('../src/runtime/towerContentActivation.ts');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
assert.ok(option('--capture'), 'required: --capture <actual failed node batch request>');
const captured = JSON.parse(await readFile(resolve(option('--capture')), 'utf8'));
const allowed = new Set('type messages model temperature frequency_penalty presence_penalty top_p max_tokens stream chat_completion_source user_name char_name group_names include_reasoning reasoning_effort enable_web_search request_images request_image_resolution request_image_aspect_ratio custom_prompt_post_processing json_schema stop seed'.split(' '));
assert.ok(Object.keys(captured).every(key => allowed.has(key)), 'request contains unexpected fields; do not persist credentials');
assert.equal(captured.chat_completion_source, 'deepseek');
assert.equal(captured.stream, false);
assert.equal(captured.json_schema?.name, 'mwg_tower_node_batch_result');
assert.ok(captured.messages.some(message => message.role === 'system' && message.content.startsWith('MWG_TOWER_STRUCTURED_REQUEST:')));
const prompt = captured.messages.map(message => message.content).join('\n');
const batch = prompt.match(/batch_id=(\S+) revision=(\d+) node_count=(\d+)/);
assert.ok(batch, 'actual request scope missing');
const jobs = [...prompt.matchAll(/\[节点 \d+\] node_id=(\S+) request_id=(\S+)\nact=(\d+) floor=(\d+) kind=(\S+)\ncontent_seed=(\d+) reward_seed=(\d+) 本幕倍率=([\d.]+)/g)].map(match => ({
  nodeId: match[1], requestId: match[2], basedOnRevision: Number(batch[2]),
  act: Number(match[3]), floor: Number(match[4]), kind: match[5],
  contentSeed: Number(match[6]), rewardSeed: Number(match[7]), difficultyMultiplier: Number(match[8]),
}));
assert.equal(jobs.length, Number(batch[3]));
assert.equal(captured.json_schema.value.properties.batch_id.const, batch[1]);
const factsLine = prompt.split('[当前完整游戏事实]\n')[1]?.split('\n')[0];
assert.ok(factsLine, 'captured authoritative facts missing');
const battleFacts = JSON.parse(factsLine).stat_data?.battle;
assert.ok(battleFacts, 'captured battle facts missing');
function validateFinal(final) {
  const row = { strictJson: false, nodeParserPassed: false, activationValidationPassed: false };
  try { JSON.parse(final); row.strictJson = true; } catch { /* the runtime parser may accept a fenced JSON response */ }
  try {
    const parsed = parseTowerNodeBatchResult(final, batch[1], jobs);
    row.nodeParserPassed = true;
    row.parsedNodes = parsed.results.length;
    const before = JSON.stringify(battleFacts);
    for (const [index, candidate] of parsed.results.entries()) {
      const job = jobs[index];
      const route = { id: job.nodeId, kind: job.kind, act: job.act, floor: job.floor };
      if (['battle', 'elite', 'boss'].includes(job.kind)) validateTowerBattleNodeForActivation(battleFacts, candidate.payload.battle, candidate.reward, route);
      else if (job.kind === 'event') validateTowerEventNodeForActivation(battleFacts, candidate.payload.event);
      else if (['shop', 'treasure'].includes(job.kind)) normalizeTowerReward(candidate.reward, battleFacts);
    }
    assert.equal(JSON.stringify(battleFacts), before, 'validation mutated captured facts');
    row.activationValidationPassed = true;
  } catch (error) { row.validationError = String(error.message).slice(0, 1800); }
  return row;
}
// Validate a final-only artifact captured through real Tavern Helper, without
// calling a model or treating the old captured scope as the live game state.
if (option('--final')) {
  const finalPath = resolve(option('--final'));
  const final = await readFile(finalPath, 'utf8');
  const validation = validateFinal(final);
  console.log(JSON.stringify({ spec: 'mwg.captured-node-final-validation/v1', finalArtifact: finalPath,
    sourceCaptureHash: createHash('sha256').update(JSON.stringify(captured)).digest('hex'),
    finalHash: createHash('sha256').update(final).digest('hex'), validation,
    scope: 'Parser and activation validation against captured facts only; no live commit or gameplay acceptance.',
  }));
  process.exit(validation.activationValidationPassed ? 0 : 1);
}
// Recheck an already recorded experiment without further model requests. This
// also upgrades older probe evidence using exactly the captured game context.
if (option('--recheck')) {
  const evidencePath = resolve(option('--recheck'));
  const previous = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(previous.spec, 'mwg.node-json-mode-probe/v1');
  assert.equal(previous.requestHash, createHash('sha256').update(JSON.stringify(captured)).digest('hex'));
  const validation = [];
  for (const row of previous.results) {
    if (!row.finalArtifact) continue;
    validation.push({ variant: row.variant, finalHash: row.finalHash, ...validateFinal(await readFile(row.finalArtifact, 'utf8')) });
  }
  const output = evidencePath.replace(/\.json$/, '-activation-validation.json');
  await writeFile(output, JSON.stringify({ spec: 'mwg.node-json-mode-validation/v1', requestHash: previous.requestHash, validation }, null, 2));
  console.log(JSON.stringify({ evidence: output, validation }));
  process.exit(0);
}
const variants = (option('--variants') || 'json-mode,text-schema').split(',');
assert.ok(variants.length >= 1 && variants.length <= 4 && variants.every(value => ['json-mode', 'text-schema'].includes(value)));
const timeoutMs = Number(option('--timeout-ms') || 240000);
assert.ok(timeoutMs >= 10000 && timeoutMs <= 240000);

// Matches the inspected Tavern DeepSeek adapter exactly. Moving this same
// message before that adapter leaves its post-processing input byte-identical;
// the sole provider-side difference is the presence of response_format.
const schemaMessage = { role: 'user', content: `JSON schema for the response:\n${JSON.stringify(captured.json_schema.value, null, 4)}` };
const textRequest = structuredClone(captured);
delete textRequest.json_schema;
textRequest.messages.push(schemaMessage);
assert.deepEqual(textRequest.messages, [...captured.messages, schemaMessage]);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const api = await createTavernApi('http://127.0.0.1:8012/');
const settings = (await getSettings(api)).oai_settings;
assert.equal(settings.chat_completion_source, captured.chat_completion_source);
assert.equal(settings.deepseek_model, captured.model);
const settingsHash = digest(settings);
const evidence = {
  spec: 'mwg.node-json-mode-probe/v1',
  scope: 'Bounded diagnostic replays, not independent starts or gameplay acceptance. No chat/settings/MVU writes.',
  hypothesis: 'Same effective messages, schema and sampling/thinking parameters; change only provider response_format.',
  validation: 'Actual node parser and controller activation validators with captured facts; not simulation, persistence or gameplay acceptance.',
  model: captured.model, requestHash: digest(captured), effectiveMessagesHash: digest(textRequest.messages),
  schemaHash: digest(captured.json_schema.value), nodeCount: jobs.length, timeoutMs, results: [],
};
const dir = resolve('tmp/node-json-mode');
await mkdir(dir, { recursive: true });
const path = resolve(dir, `paired-${Date.now()}.json`);
await writeFile(path, JSON.stringify(evidence, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ evidence: path, model: evidence.model, variants, nodeCount: jobs.length }));
for (const variant of variants) {
  const current = (await getSettings(api)).oai_settings;
  assert.equal(digest(current), settingsHash, 'settings changed; stop replay');
  const started = Date.now();
  const row = { variant, startedAt: new Date(started).toISOString() };
  try {
    const request = variant === 'json-mode' ? captured : textRequest;
    const response = await api.request('/api/backends/chat-completions/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, reverse_proxy: current.reverse_proxy, proxy_password: current.proxy_password }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = await response.json();
    const choice = result.choices?.[0];
    const final = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    Object.assign(row, {
      status: response.status, elapsedMs: Date.now() - started, finalChars: final.length,
      reasoningChars: typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content.length : 0,
      finishReason: choice?.finish_reason ?? null, errorPresent: Boolean(result.error),
      usage: result.usage ? { prompt_tokens: result.usage.prompt_tokens, completion_tokens: result.usage.completion_tokens,
        reasoning_tokens: result.usage.completion_tokens_details?.reasoning_tokens } : undefined,
      strictJson: false, nodeParserPassed: false, activationValidationPassed: false,
    });
    if (final.trim()) {
      Object.assign(row, validateFinal(final));
      const outputPath = path.replace(/\.json$/, `-${evidence.results.length + 1}-${variant}-final.txt`);
      await writeFile(outputPath, final, { flag: 'wx' });
      row.finalArtifact = outputPath;
      row.finalHash = digest(final);
    }
    // Never save raw provider envelopes, reasoning text, credentials or headers.
  } catch (error) { Object.assign(row, { elapsedMs: Date.now() - started, errorName: error.name }); }
  evidence.results.push(row);
  await writeFile(path, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(row));
}
assert.equal(digest((await getSettings(api)).oai_settings), settingsHash, 'settings changed during replay');
