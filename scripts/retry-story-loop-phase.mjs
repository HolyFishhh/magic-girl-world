import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseConfig = JSON.parse(await readFile(resolve(root, 'release.config.json'), 'utf8'));
const [requestedPhase] = process.argv.slice(2);
const logPath = resolve(root, `real-story-loop-${releaseConfig.cardVersion}.log`);
const evidence = JSON.parse(await readFile(logPath, 'utf8'));
const phases = Array.isArray(evidence.phases) ? evidence.phases : [];
const index = requestedPhase
  ? phases.findIndex(phase => phase?.name === requestedPhase)
  : phases.length - 1;
if (index < 0 || !phases[index]) throw new Error(`Story-loop phase was not found: ${requestedPhase || '(last)'}`);

const phase = phases[index];
evidence.phases = phases.slice(0, index);
evidence.inflight = {
  name: phase.name,
  userText: phase.userText,
  main: phase.main,
};
delete evidence.final;
await writeFile(logPath, JSON.stringify(evidence, null, 2), 'utf8');

console.log(
  JSON.stringify(
    {
      logPath,
      retryPhase: phase.name,
      retainedPhases: evidence.phases.map(item => item.name),
      reusedMain: true,
      reusedExtra: false,
    },
    null,
    2,
  ),
);
