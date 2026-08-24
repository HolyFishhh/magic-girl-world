import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { formatBattleContentRepairPrompt, preflightBattleContent } = require(
  resolve('src/fish/core/battleContentPreflight.ts'),
);

const invalidBattle = {
  core: { hp: 50, max_hp: 50, lust: 0, max_lust: 100 },
  cards: [
    { id: 'strike', name: '斩击', type: 'Attack', rarity: 'Common', cost: 1, quantity: 5, effects: { damage: 7 } },
    { id: 'guard', name: '防御', type: 'Skill', rarity: 'Common', cost: 1, quantity: 5, effects: { block: 6 } },
  ],
  artifacts: [],
  items: [],
  statuses: [],
  player_abilities: [],
  player_status_effects: [],
  player_lust_effect: { name: '满溢', effects: { damage: 5 } },
  level: 1,
  enemy: {
    name: '损坏敌人',
    hp: 30,
    max_hp: 30,
    lust: 0,
    max_lust: 100,
    actions: [{ name: '泄漏名称', weight: 0, effects: { damage: 'unknown * 4' } }],
    abilities: [],
    status_effects: [],
    lust_effect: { name: '反噬', effects: { damage: 2 } },
    action_mode: 'probability',
    action_config: { probability: { 泄漏名称: 0 } },
  },
};
const preflight = preflightBattleContent(invalidBattle);
assert.equal(preflight.ok, false);
const prompt = formatBattleContentRepairPrompt(preflight.issues);
assert.match(prompt, /^\[战斗场景修复\]\n问题=battle\.enemy/);
assert.doesNotMatch(prompt, /泄漏名称|损坏敌人|unknown/);
assert.ok(prompt.length < 300);

const [fishSource, fishHtml, gameStateSource, repairHostSource, shellPresenterSource] = await Promise.all([
  readFile(resolve('src/fish/index.ts'), 'utf8'),
  readFile(resolve('src/fish/index.html'), 'utf8'),
  readFile(resolve('src/fish/core/gameStateManager.ts'), 'utf8'),
  readFile(resolve('src/fish/core/battleRepairHost.ts'), 'utf8'),
  readFile(resolve('src/fish/ui/battleShellPresenter.ts'), 'utf8'),
]);
assert.match(fishHtml, /id="battle-content-repair"/);
assert.match(fishSource, /formatBoundedContentIssueSummary\(loadIssues\)/);
assert.match(fishSource, /battleRepairHost\.requestRepair\(issues\)/);
assert.match(repairHostSource, /formatBattleContentRepairPrompt\(issues\)/);
assert.match(repairHostSource, /continuationHost\.continueWithPrompt\(\{ prompt \}\)/);
assert.doesNotMatch(repairHostSource, /triggerSlash\(`\/send|triggerSlash\('\/send/);
assert.match(repairHostSource, /assertCurrentMessageLatest\(\)/);
assert.match(shellPresenterSource, /isCurrentMessageLatest\(\)/);
assert.doesNotMatch(fishSource, /const errorHtml|innerHTML = errorHtml/);
assert.doesNotMatch(fishSource, /triggerSlash|document\.|\$\(|location\./);
assert.match(gameStateSource, /getLastLoadIssues\(\)/);
assert.match(gameStateSource, /this\.lastLoadIssues = preflight\.issues/);
assert.match(gameStateSource, /error instanceof BattleContentContractError/);

const realFixtureSource = await readFile(resolve('scripts/test-real-tavern-battle-repair.mjs'), 'utf8');
assert.match(realFixtureSource, /effects: \{ damage: 3, hits: 3 \}/);
assert.match(realFixtureSource, /effects: \{ block: 5, to: 'opponent' \}/);
assert.match(realFixtureSource, /effects: \{ block: 'self\.exhaust_pile_size \* 4' \}/);
assert.match(
  realFixtureSource,
  /effects: \{ damage: 'turn_number \+ attacks_played_this_turn \* 2 \+ skills_played_this_turn' \}/,
);
assert.match(realFixtureSource, /trigger: 'on_exhaust', effects: \{ block: 1 \}/);
for (const trigger of ['card_played', 'attack_played', 'skill_played', 'power_played']) {
  assert.match(realFixtureSource, new RegExp(`trigger: '${trigger}'`));
}
assert.match(realFixtureSource, /id: 'type_power'[\s\S]*type: 'Power'[\s\S]*innate: true/);
assert.equal((realFixtureSource.match(/innate: true/g) || []).length >= 5, true);

const realFixturePreflight = JSON.parse(
  execFileSync(process.execPath, ['scripts/test-real-tavern-battle-repair.mjs', 'valid', 'fixture.png'], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: { ...process.env, PREFLIGHT_ONLY: '1' },
  }),
);
assert.deepEqual(realFixturePreflight, { scenario: 'valid', ok: true, issues: [] });

console.log('Invalid battle content exposes one bounded Tavern repair action without duplicating validation.');
