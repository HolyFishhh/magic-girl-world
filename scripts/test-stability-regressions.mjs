import { spawnSync } from 'node:child_process';

const checks = [
  'interception-contract',
  'card-payment-contract',
  'status-action-contract',
  'card-removal-permissions',
  'archetype-score-accuracy',
  'evidence-file-archive', 'tower-generation-evidence', 'tower-evidence-history-ui', 'mvu-monitor-chat-scope',
  'stability-transactions', 'diagnostic-redaction', 'tower-mvu-restoration',
  'tower-lookahead-coordinator', 'persistent-mvu-repair-host', 'message-variable-authority',
  'run-transactions', 'run-history-prompt', 'battle-event-journal', 'trigger-event-contract',
  'status-defense-integration', 'status-defense-summon-e2e', 'damage-protection',
  'battle-terminal', 'ordinary-battle-loop', 'ability-trigger-integration',
  'card-traits', 'card-lifecycle', 'tower-preselection', 'common-interface', 'common-tower-map-integration', 'runtime-safety', 'runtime-view-switcher',
];
for (const name of checks) {
  const result = spawnSync(process.execPath, [`scripts/test-${name}.mjs`], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) {
    console.error(`FAIL ${name}`, result.error || '');
    process.exit(result.status || 1);
  }
}
console.log(`PASS ${checks.length} stability regression suites`);
