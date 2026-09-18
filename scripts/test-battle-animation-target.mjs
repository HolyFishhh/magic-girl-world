import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { resolveCombatAnimationTarget } = require(resolve('src/fish/ui/animationManager.ts'));

const program = steps => ({ spec: 'mwg.effect/v1', steps });

assert.equal(resolveCombatAnimationTarget(program([{ op: 'damage', target: 'opponent', amount: 6 }]), 'attack'), 'opponent');
assert.equal(resolveCombatAnimationTarget(program([{ op: 'gain_block', target: 'self', amount: 5 }]), 'skill'), 'self');
assert.equal(resolveCombatAnimationTarget(program([{ op: 'apply_status', target: 'opponent', status: 'x', stacks: 1 }]), 'skill'), 'opponent');
assert.equal(resolveCombatAnimationTarget(program([{ op: 'draw_cards', amount: 1 }]), 'skill'), 'self');
assert.equal(
  resolveCombatAnimationTarget(
    program([{ op: 'if', condition: { op: 'compare', relation: 'gt', left: 1, right: 0 }, then: [{ op: 'gain_lust', target: 'opponent', amount: 2 }] }]),
    'power',
  ),
  'opponent',
);

const managerSource = readFileSync(resolve('src/fish/ui/animationManager.ts'), 'utf8');
const presenterSource = readFileSync(resolve('src/fish/ui/battleEffectPresenter.ts'), 'utf8');
const battleSource = readFileSync(resolve('src/fish/ui/battleUI.ts'), 'utf8');
const executorSource = readFileSync(resolve('src/fish/combat/unifiedEffectExecutor.ts'), 'utf8');
const battleManagerSource = readFileSync(resolve('src/fish/combat/battleManager.ts'), 'utf8');
const styles = readFileSync(resolve('src/fish/index.scss'), 'utf8');
assert.match(managerSource, /stageHealthSnapshots/, 'health animation retains a prior value by stable identity');
assert.match(managerSource, /stageHealthLosses/, 'an in-flight loss layer survives a stage markup refresh by stable identity');
assert.match(managerSource, /element\.dataset\.enemyId === stableId/, 'an enemy hit resolves its own stage bar rather than the selected target');
assert.match(managerSource, /detailedHealthFill[\s\S]*is-active/, 'an off-target enemy cannot overwrite the selected enemy detail bar');
assert.match(managerSource, /\.hp-loss/, 'the detailed HUD receives a separate translucent loss layer');
assert.match(managerSource, /updateSummonHealthBar/, 'summon bars use the same loss-layer animation contract');
assert.match(presenterSource, /previousValue \|\| 0\) > 0 && \(nextValue \|\| 0\) <= 0/, 'shield break fires only on a positive-to-zero transition');
assert.match(presenterSource, /showShieldBreak\(target, enemyId\)/, 'the shield-break target keeps the enemy identity');
assert.match(battleSource, /syncStageHealthBar\('enemy',[\s\S]*String\(enemy\.id\)/, 'stage rendering seeds each enemy history with its stable id');
assert.match(battleSource, /syncSummonHealthBar/, 'stage rendering seeds summon history separately from its owner');
assert.match(battleSource, /restoreStageHealthLoss\('enemy'/, 'enemy stage rebuilds reattach their in-flight loss layer');
assert.match(battleSource, /restoreSummonHealthLoss/, 'summon stage rebuilds reattach their in-flight loss layer');
assert.match(styles, /stage-health-loss/, 'the loss layer receives its own translucent style');
assert.match(styles, /\.hp-loss/, 'the detailed health loss layer has its own style');
assert.match(styles, /stage-shield-break/, 'shield break has a short visual effect');
assert.match(presenterSource, /waitForActionPresentation[\s\S]*#battle-stage[\s\S]*animationManager\.waitForActionPresentation/, 'only a live theater awaits the action token it started');
assert.match(managerSource, /stageActionPresentation = presentation.finished[\s\S]*return presentation.impact/, 'the stage action has a completion promise rather than a guessed timer');
assert.match(managerSource, /clearTransientEffects\(\)[\s\S]*damageQueue\.length = 0/, 'settlement clears queued cosmetic effects before replacing the battle scene');
assert.match(presenterSource, /clearTransientEffects\(\)[\s\S]*is-settling/, 'battle-end confirmation clears transient emoji tokens before its exit transition');
assert.match(styles, /mwg-battle-end-exit/, 'battle-end presentation has a bounded exit transition');
assert.match(executorSource, /await this\.presentation\.waitForActionPresentation\?\.\(\)/, 'each automatic summon action awaits the optional presentation beat');
assert.match(battleManagerSource, /await TavernBattleEffectPresenter\.getInstance\(\)\.waitForActionPresentation\?\.\(\)/, 'each queued enemy action awaits the same optional beat');

console.log('Battle theater resolves action anchors and keeps health-loss/shield-break animations bound to stable combatant identities.');
