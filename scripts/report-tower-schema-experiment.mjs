import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectSchemaExperimentRecord, summarizeSchemaExperiment } from './lib/tower-schema-experiment-report.mjs';

const since = process.argv[2];
if (!since || !Number.isFinite(Date.parse(since))) throw new Error('Usage: node scripts/report-tower-schema-experiment.mjs <since-ISO> [output.json]');
const directory = resolve('tmp/real-tavern-tower-acceptance');
const records = [];
const skipped = {};
const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
for (const file of (await readdir(directory)).sort()) {
  if (!file.endsWith('.json')) continue;
  let data;
  try { data = JSON.parse(await readFile(resolve(directory, file), 'utf8')); }
  catch { skip('unreadable_json'); continue; }
  const result = projectSchemaExperimentRecord(file, data, since);
  if (result.record) records.push(result.record);
  else skip(result.reason);
}
const report = summarizeSchemaExperiment(records, { since, skipped });
if (process.argv[3]) await writeFile(resolve(process.argv[3]), JSON.stringify(report, null, 2), 'utf8');
const { records: omittedRecords, ...summary } = report;
console.log(JSON.stringify({ ...summary, recordCount: omittedRecords.length }, null, 2));
