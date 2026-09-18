// Bounded diagnostic replay. Uses Tavern's saved connection; never writes chats,
// settings, preset data, or MVU. Not an independent gameplay acceptance sample.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createTavernApi, getSettings } from './lib/tavern-api.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
assert.ok(option('--capture'), 'required: --capture <actual preset-narrative capture>');
const captured = JSON.parse(await readFile(resolve(option('--capture')), 'utf8'));
assert.equal(captured.purpose, 'preset-narrative');
assert.ok(Array.isArray(captured.messages) && captured.messages.length > 0);
assert.ok(!captured.json_schema, 'narrative-only experiment; do not conflate JSON-mode failures');
const { purpose, ...parameters } = captured;
assert.equal(parameters.chat_completion_source, 'deepseek');

// Hypothesis only: represent in-band model control markers as literal text.
// All ordinary writing instructions, roles and generation parameters remain.
const markers = /<｜[^<>\r\n]{1,80}｜>/gu;
let changedMarkers = 0;
const literalMessages = parameters.messages.map(message => {
  assert.equal(typeof message.content, 'string');
  return { ...message, content: message.content.replace(markers, token => {
    changedMarkers += 1;
    return token.replace('<', '&lt;').replace('>', '&gt;');
  }) };
});
assert.ok(changedMarkers > 0, 'capture contains no candidate control markers');

const api = await createTavernApi('http://127.0.0.1:8012/');
const settingsBefore = (await getSettings(api)).oai_settings;
assert.equal(settingsBefore.chat_completion_source, parameters.chat_completion_source);
assert.equal(settingsBefore.deepseek_model, parameters.model);
const settingsDigest = settings => createHash('sha256').update(JSON.stringify(settings)).digest('hex');
const baselineSettingsDigest = settingsDigest(settingsBefore);
const evidence = {
  spec: 'mwg.preset-transport-probe/v1',
  scope: 'Four bounded actual-preset diagnostic replays; not independent starts or gameplay acceptance.',
  hypothesis: 'Literalize in-band model control markers; preserve writing instructions and request parameters.',
  model: parameters.model,
  stream: parameters.stream,
  originalPromptHash: createHash('sha256').update(JSON.stringify(parameters.messages)).digest('hex'),
  changedMarkers,
  results: [],
};
const dir = resolve('tmp/preset-transport');
await mkdir(dir, { recursive: true });
const path = resolve(dir, `literal-markers-${Date.now()}.json`);
await writeFile(path, JSON.stringify(evidence, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ evidence: path, model: parameters.model, stream: parameters.stream, changedMarkers }));

// ABBA order reduces a simple order effect; too small to claim reliability.
for (const variant of ['control', 'literal-markers', 'literal-markers', 'control']) {
  const currentSettings = (await getSettings(api)).oai_settings;
  assert.equal(settingsDigest(currentSettings), baselineSettingsDigest, 'connection/settings changed; stop diagnostic');
  const started = Date.now();
  const row = { variant, startedAt: new Date(started).toISOString() };
  try {
    const response = await api.request('/api/backends/chat-completions/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...parameters, type: 'quiet',
        messages: variant === 'control' ? parameters.messages : literalMessages,
        reverse_proxy: currentSettings.reverse_proxy, proxy_password: currentSettings.proxy_password,
      }), signal: AbortSignal.timeout(90000),
    });
    const raw = await response.text();
    const records = [];
    try { records.push(JSON.parse(raw)); } catch {
      for (const match of raw.matchAll(/^data:\s*(.+)$/gm)) {
        try { records.push(JSON.parse(match[1])); } catch { /* [DONE] is not JSON. */ }
      }
    }
    const choices = records.flatMap(record => record.choices ?? []);
    Object.assign(row, {
      status: response.status, elapsedMs: Date.now() - started,
      finalChars: choices.reduce((n, choice) => n + (choice.delta?.content?.length ?? choice.message?.content?.length ?? 0), 0),
      reasoningChars: choices.reduce((n, choice) => n + (choice.delta?.reasoning_content?.length ?? choice.message?.reasoning_content?.length ?? 0), 0),
      finishReasons: choices.map(choice => choice.finish_reason).filter(Boolean),
      errorPresent: records.some(record => Boolean(record.error)),
      parsedRecords: records.length,
    });
    // Deliberately do not retain raw response, reasoning, credentials or headers.
  } catch (error) {
    Object.assign(row, { elapsedMs: Date.now() - started, errorName: error.name });
  }
  evidence.results.push(row);
  await writeFile(path, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(row));
}
