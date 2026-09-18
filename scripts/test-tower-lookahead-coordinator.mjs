import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const {
  TowerLookaheadCoordinator,
  buildTowerDeckProfilePromptContext,
  buildTowerKnowledgeGraphPromptContext,
  buildTowerSemanticMvuContext,
  buildTowerGenerationContext,
} = require(resolve('src/sillytavern-extension/towerCoordinator.ts'));
const growthReceiptSource = { stat_data: { battle: { core: { max_hp: 34, persistent_growth_receipts: ['receipt-a'] } } } };
const growthPrompt = buildTowerSemanticMvuContext(growthReceiptSource);
assert.equal(growthPrompt.stat_data.battle.core.max_hp, 34);
assert.equal(growthPrompt.stat_data.battle.core.persistent_growth_receipts, undefined, 'host receipts never enter authoring prompts');
assert.deepEqual(growthReceiptSource.stat_data.battle.core.persistent_growth_receipts, ['receipt-a'], 'prompt projection does not erase the real commit receipt');
const {
  collectTowerBatchUnreportedValidationIssues,
  preserveUnreportedTowerBatchResults,
} = require(resolve('src/sillytavern-extension/controller.ts'));
const { TowerGenerationCancelledError } = require(resolve('src/sillytavern-extension/towerGenerationQueue.ts'));
const { completeRunNode, createRunState, enterRunNode } = require(resolve('src/game-core/runState.ts'));
const { recommendShopBudget } = require(resolve('src/game-core/contentBudget.ts'));
const { createTowerEncounterPlan } = require(resolve('src/game-core/towerEncounterPlan.ts'));
const {
  parseTowerNodeBatchResult,
  parseTowerNodeResult,
  parseTowerOpeningResult,
} = require(resolve('src/game-core/towerRequest.ts'));
const towerState = require(resolve('src/runtime/towerStateAdapter.ts'));
const towerOpening = require(resolve('src/runtime/towerOpeningAdapter.ts'));
const { settleTowerOpeningChoiceInStat } = require(resolve('src/common/runTransactions.ts'));
const {
  DESIGN_ASSISTANT_STATE_SPEC,
  DEFAULT_DESIGN_ASSISTANT_SETTINGS,
} = require(resolve('src/sillytavern-extension/types.ts'));
const { DesignKnowledgeGraph } = require(resolve('src/sillytavern-extension/knowledgeGraph.ts'));
const { formatTowerNodeBatchGenerationPrompt } = require(resolve('src/game-core/towerRequest.ts'));

const tick = () => new Promise(resolvePromise => setTimeout(resolvePromise, 0));

async function waitFor(predicate, label, attempts = 1000) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function chatState() {
  return {
    spec: DESIGN_ASSISTANT_STATE_SPEC,
    lineage: { schemaVersion: 1, families: [] },
    calibratedEnemyFingerprints: [],
  };
}

function towerVariables(seed) {
  return {
    // Program-only top-level data must not displace gameplay facts.
    mvu_padding: 'x'.repeat(3500),
    mvu_tail_probe: 'COORDINATOR_LATEST_MVU_TAIL',
    stat_data: {
      semantic_tail_probe: 'COORDINATOR_SEMANTIC_MVU_TAIL',
      game_mode: 'tower',
      game_mode_lock: { schemaVersion: 1, mode: 'tower' },
      status: {
        time: '01年01月01日 08:00',
        location: '塔下营地',
        profession: { name: '测试者', ability: '测试能力' },
        inventory: [],
      },
      battle: {
        core: { hp: 100, max_hp: 100, card_removal_count: 0 },
        cards: [{ id: 'semantic_card_probe', name: 'probe', effects: { damage: 6 } }],
        artifacts: [],
        items: [],
        design_context: { repeated_report: 'y'.repeat(20_000) },
      },
      reward: {
        card: [], artifact: [], item: [], limits: {},
        request: { runtime_only_probe: true },
        disabled_categories: [], pool_revision: 7, reroll_count: 2,
      },
      run_node_reward: { runtime_only_staged_reward_probe: true },
      run_reward_reroll: { runtime_only_reroll_probe: true },
      run: createRunState({ seed }),
      tower_requirements: '偏好具有机制互动的敌人',
    },
  };
}

// Model context removes runtime-only duplication without deleting gameplay
// distinctions. Only cards that differ solely by their own runInstanceId are
// recombined; upgrade/source/attachment differences and late deck burdens stay.
{
  const variables = towerVariables(20260903);
  variables.stat_data.battle.cards = [
    {
      id: 'same_card', name: '同构卡', type: 'Attack', rarity: 'Common', cost: 1,
      quantity: 1, effects: [{ damage: 6 }], templateId: 'same_card', runInstanceId: 'same_card__run__1', origin: 'deck',
    },
    {
      id: 'same_card', name: '同构卡', type: 'Attack', rarity: 'Common', cost: 1,
      quantity: 1, effects: [{ damage: 6 }], templateId: 'same_card', runInstanceId: 'same_card__run__2', origin: 'deck',
    },
    {
      id: 'same_card', name: '同构卡+', type: 'Attack', rarity: 'Common', cost: 1,
      quantity: 1, effects: [{ damage: 9 }], templateId: 'same_card', runInstanceId: 'same_card__run__3',
      origin: 'deck', patches: [{ id: 'upgrade_1', changes: { damage: 3 } }],
    },
    {
      id: 'same_card', name: '异源同名卡', type: 'Attack', rarity: 'Common', cost: 1,
      quantity: 1, effects: [{ damage: 6 }], templateId: 'same_card', runInstanceId: 'same_card__run__4', origin: 'event',
    },
    {
      id: 'curse_tail_probe', name: '末尾负担', type: 'Curse', rarity: 'Curse', cost: 0,
      quantity: 1, effects: [{ apply_status: 'burden', stacks: 1 }], templateId: 'curse_tail_probe',
      runInstanceId: 'curse_tail_probe__run__1', origin: 'event', attachments: [{ id: 'sealed' }],
    },
  ];
  variables.stat_data.battle.statuses = [{
    id: 'story_trace',
    name: '剧情余波',
    type: 'neutral',
    description: '上一节点留下、会影响后续设计的真实状态。',
    triggers: { hold: [{ modify: 'damage', add: 1 }] },
  }];
  variables.stat_data.run.visitedNodeIds = ['story-node'];
  variables.stat_data.run.nodeContent = {
    'story-node': {
      schemaVersion: 1,
      nodeId: 'story-node',
      kind: 'event',
      phase: 'ready',
      requestId: 'story-request',
      basedOnRevision: 0,
      attempts: 1,
      content: { title: '裂镜余波', narrative: '玩家刚刚拒绝了镜中人的交易。' },
    },
  };
  const sharedEnemy = { id: 'mirror_enemy', name: '镜像敌人', max_hp: 20, hp: 20, actions: [] };
  variables.stat_data.battle.enemy = structuredClone(sharedEnemy);
  variables.stat_data.battle.enemies = [structuredClone(sharedEnemy), { ...sharedEnemy, id: 'other_enemy', name: '另一敌人' }];
  const semantic = buildTowerSemanticMvuContext(variables);
  const cards = semantic.stat_data.battle.cards;
  assert.equal(cards.length, 4);
  assert.equal(cards[0].quantity, 2);
  assert.equal('runInstanceId' in cards[0], false);
  assert.equal(cards.some(card => card.name === '同构卡+' && card.patches?.length === 1), true);
  assert.equal(cards.some(card => card.name === '异源同名卡' && card.origin === 'event'), true);
  assert.equal(cards.at(-1).id, 'curse_tail_probe');
  assert.equal(cards.at(-1).attachments[0].id, 'sealed');
  assert.equal(semantic.stat_data.status.location, '塔下营地');
  assert.equal(semantic.stat_data.status.profession.name, '测试者');
  assert.equal('inventory' in semantic.stat_data.status, false, 'tower context keeps compact story facts instead of story-mode inventory');
  assert.equal(semantic.stat_data.tower_requirements, '偏好具有机制互动的敌人');
  assert.equal(semantic.stat_data.battle.statuses[0].id, 'story_trace');
  assert.equal(
    semantic.stat_data.run.recentNodeContent['story-node'].content.narrative,
    '玩家刚刚拒绝了镜中人的交易。',
    'recent resolved node narrative must remain visible to the structured model',
  );
  assert.equal('enemy' in semantic.stat_data.battle, false);
  assert.equal(semantic.stat_data.battle.enemies.length, 2);
}

// The prompt graph keeps authored semantic nodes, relations and evolution
// paths, while omitting generated mechanic-node mirrors already present in an
// archetype's required/optional/payoff data.
{
  const graph = {
    spec: 'mwg.st-knowledge-graph/v2',
    nodes: [
      { id: 'archetype:a', kind: 'archetype', label: '流派A', data: { required: ['damage'] } },
      { id: 'archetype:b', kind: 'archetype', label: '流派B', data: { required: ['spawn_summon'] } },
      { id: 'mechanic:tail', kind: 'mechanic', label: '末尾机制', data: { field: 'operations', value: 'spawn_summon' } },
    ],
    edges: [
      { id: 'edge:tail', from: 'archetype:a', to: 'mechanic:tail', kind: 'requires', weight: 1, data: { minimum: 1 } },
      { id: 'edge:evolution', from: 'archetype:a', to: 'archetype:b', kind: 'evolves-to', weight: 0.6, data: { transitionCost: 0.4 } },
    ],
    evolutionPaths: [{ from: 'archetype:a', to: 'archetype:b', fromLabel: '流派A', toLabel: '流派B', transitionCost: 0.4, bridgeFeatures: ['operations:spawn_summon'] }],
  };
  const compact = buildTowerKnowledgeGraphPromptContext(graph);
  assert.equal(compact.encoding, 'semantic-columnar-json/v2');
  assert.deepEqual(
    compact.nodes.map(row => Object.fromEntries(compact.nodeColumns.map((key, index) => [key, row[index]]))),
    graph.nodes.filter(node => node.kind !== 'mechanic'),
  );
  assert.deepEqual(
    compact.edges.map(row => Object.fromEntries(compact.edgeColumns.map((key, index) => [key, row[index]]))),
    graph.edges.filter(edge => edge.kind === 'evolves-to').map(({ id: _storageId, ...edge }) => edge),
  );
  assert.deepEqual(compact.evolutionPaths.map(row => Object.fromEntries(compact.evolutionPathColumns.map((key, index) => [key, row[index]]))), graph.evolutionPaths);
}

// Production requests retrieve only the current archetypes, their immediate
// evolution choices and attached anti-synergy constraints. Unrelated graph
// branches remain persisted/queryable without consuming model attention.
{
  const graph = {
    spec: 'mwg.st-knowledge-graph/v2',
    nodes: [
      { id: 'archetype:a', kind: 'archetype', label: '流派A', data: { requiredFeatures: ['damage'] } },
      { id: 'archetype:b', kind: 'archetype', label: '流派B', data: { requiredFeatures: ['block'] } },
      { id: 'archetype:c', kind: 'archetype', label: '无关流派', data: { requiredFeatures: ['heal'] } },
      { id: 'constraint:b', kind: 'constraint', label: 'B的冲突', data: {} },
      { id: 'constraint:c', kind: 'constraint', label: 'C的冲突', data: {} },
      { id: 'mechanic:damage', kind: 'mechanic', label: 'damage', data: {} },
    ],
    edges: [
      { id: 'ab', from: 'archetype:a', to: 'archetype:b', kind: 'evolves-to', weight: 0.7 },
      { id: 'bc', from: 'archetype:b', to: 'constraint:b', kind: 'anti-synergy', weight: 1 },
      { id: 'cc', from: 'archetype:c', to: 'constraint:c', kind: 'anti-synergy', weight: 1 },
      { id: 'am', from: 'archetype:a', to: 'mechanic:damage', kind: 'requires', weight: 1 },
    ],
    evolutionPaths: [
      { from: 'archetype:a', to: 'archetype:b', fromLabel: '流派A', toLabel: '流派B', transitionCost: 0.3, bridgeFeatures: ['operations:block'] },
      { from: 'archetype:c', to: 'archetype:a', fromLabel: '无关流派', toLabel: '流派A', transitionCost: 0.8, bridgeFeatures: ['operations:damage'] },
    ],
  };
  const compact = buildTowerKnowledgeGraphPromptContext(graph, ['a']);
  assert.equal(compact.encoding, 'retrieved-semantic-subgraph/v3');
  assert.deepEqual(compact.activeArchetypeIds, ['archetype:a']);
  const retainedIds = compact.nodes.map(row => row[0]);
  assert.deepEqual(retainedIds, ['archetype:a', 'archetype:b', 'constraint:b']);
  assert.equal(compact.evolutionPaths.length, 1);
  assert.equal(compact.evolutionPaths[0][0], 'archetype:a');
  assert.equal(JSON.stringify(compact).includes('无关流派'), false);
}

{
  const compact = buildTowerDeckProfilePromptContext({
    spec: 'deck-profile', fingerprint: 'cache-only', seeds: 8, totalScore: 42, confidence: 0.8,
    maxHp: 80, horizons: { 3: { hpDamage: { p50: 30 } } }, dimensions: { burst: 20 },
    deckQuality: { multiplier: 0.9 }, unsupportedFeatures: ['summon'], scatterShare: 10,
    archetypes: Array.from({ length: 7 }, (_, index) => ({ id: `a${index}` })),
    reasons: ['可执行说明'], probeFrontiers: [{ internal: true }], victoryFrontiers: [{ internal: true }],
  });
  assert.equal(compact.totalScore, 42);
  assert.equal(compact.archetypes.length, 5);
  assert.equal('fingerprint' in compact, false);
  assert.equal('probeFrontiers' in compact, false);
  assert.equal('victoryFrontiers' in compact, false);
}

// Authoring context keeps game content and qualitative deck guidance, but never
// carries a previous node's evaluator receipt or snapshot-wide enemy budget.
{
  const variables = towerVariables(20260914);
  variables.stat_data.program_balance = { evaluation: { trials: ['TOP_LEVEL_TRIAL'], seeds: [11] } };
  variables.stat_data.run_node = {
    node_id: 'active-diagnostic', program_balance: { trials: ['ACTIVE_TRIAL'], seeds: [12] },
    content: { title: '当前节点内容', program_balance: { originalEvaluation: 'ACTIVE_ORIGINAL' } },
  };
  variables.stat_data.run.visitedNodeIds = ['diagnostic-node'];
  variables.stat_data.run.encounterBaseline = { privateTrial: 'RUN_BASELINE_MUST_NOT_PROMPT' };
  variables.stat_data.run.currentNode = { id: 'diagnostic-node', contentSeed: 314159, rewardSeed: 271828 };
  variables.stat_data.run.nodeContent = {
    'diagnostic-node': {
      nodeId: 'diagnostic-node', kind: 'battle',
      content: {
        title: '保留的玩家节点内容', narrative: '可供后续剧情使用。',
        program_balance: { evaluation: { trials: ['RECENT_TRIAL'], seeds: [13] }, originalEvaluation: 'RECENT_ORIGINAL' },
      },
    },
  };
  variables.stat_data.battle.cards[0] = {
    ...variables.stat_data.battle.cards[0], name: '玩家合法内容保留',
    encounterBaseline: { mechanic: '同名卡牌字段必须保留' },
    effects: { damage: 6, random_target: { mode: 'all_enemies' } },
  };
  const snapshot = {
    prompt: 'LEGACY_SNAPSHOT_PROMPT totalBudget=991001 enemy=772002',
    deckProfile: {
      spec: 'deck-profile', totalScore: 71, confidence: 0.8, maxHp: 80,
      horizons: { 3: { hpDamage: { p50: 30 } } }, dimensions: { burst: 20 }, deckQuality: { multiplier: 1 },
      unsupportedFeatures: ['summon'], archetypes: [{ id: 'summon_core', label: '召唤核心' }],
      scatterShare: 0, reasons: ['旧影子输出 771，缺少稳定防御'], seeds: 8,
    },
    enemyEnvelope: { spec: 'legacy-envelope', targetScore: 772002, totalBudget: 991001, trials: ['LEGACY_ENVELOPE_TRIAL'] },
    enemyPower: null, lineage: chatState().lineage, deckFingerprint: 'deck', enemyFingerprint: null,
    knowledgeGraph: { spec: 'graph', nodes: [], edges: [], evolutionPaths: [] },
  };
  const context = buildTowerGenerationContext({
    chatId: 'tower-chat', mvuData: variables, designSnapshot: snapshot,
    designState: chatState(), settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS },
  });
  assert.equal(context.enemyBudgetEnvelope, undefined, 'only the root per-job plan may supply an encounter budget');
  assert.match(context.completeMvuContext, /玩家合法内容保留/);
  assert.match(context.completeMvuContext, /同名卡牌字段必须保留/);
  assert.match(context.completeMvuContext, /"damage":6/,
    'prompt cleanup removes only snapshot fields and retains authored card numbers');
  assert.match(context.completeMvuContext, /random_target/);
  assert.doesNotMatch(context.completeMvuContext, /RUN_BASELINE_MUST_NOT_PROMPT/);
  assert.match(context.completeMvuContext, /314159/);
  assert.match(context.completeMvuContext, /保留的玩家节点内容/);
  assert.doesNotMatch(context.completeMvuContext, /TOP_LEVEL_TRIAL|ACTIVE_TRIAL|RECENT_TRIAL|ACTIVE_ORIGINAL|RECENT_ORIGINAL/);
  assert.doesNotMatch(context.deckBalanceContext, /991001|772002|LEGACY_SNAPSHOT_PROMPT|LEGACY_ENVELOPE_TRIAL/);
  assert.match(context.deckBalanceContext, /summon_core|summon/);
  assert.doesNotMatch(context.deckBalanceContext, /旧影子输出 771|缺少稳定防御/,
    'snapshot reasons can contain stale shadow scoring and are not authoring context');
  const mixedBatch = formatTowerNodeBatchGenerationPrompt('mixed-budget-audit', [
    { nodeId: 'normal-node', requestId: 'normal-request', basedOnRevision: 0, kind: 'battle', act: 1, floor: 2, contentSeed: 101, rewardSeed: 102, difficultyMultiplier: 1 },
    { nodeId: 'elite-node', requestId: 'elite-request', basedOnRevision: 0, kind: 'elite', act: 1, floor: 3, contentSeed: 201, rewardSeed: 202, difficultyMultiplier: 1.2 },
  ], context);
  assert.match(mixedBatch, /normal-node[\s\S]*elite-node/);
  assert.doesNotMatch(mixedBatch, /991001|772002|LEGACY_SNAPSHOT_PROMPT|LEGACY_ENVELOPE_TRIAL/);
}

// The production graph projection removes only the generated mechanic mirror.
// Every retrieved archetype keeps the complete authored design method, while
// constraints, transitions and anti-synergies remain queryable by the model.
{
  const graph = new DesignKnowledgeGraph().query([], undefined, 1, 36);
  const compact = buildTowerKnowledgeGraphPromptContext(graph);
  const compactNodes = compact.nodes.map(row => (
    Object.fromEntries(compact.nodeColumns.map((key, index) => [key, row[index]]))
  ));
  const rawSemanticNodes = graph.nodes.filter(node => node.kind !== 'mechanic');
  assert.deepEqual(compactNodes, rawSemanticNodes);
  assert.ok(compactNodes.some(node => node.kind === 'constraint'));
  assert.ok(compact.edges.some(row => row[2] === 'evolves-to'));
  assert.ok(compact.edges.some(row => row[2] === 'anti-synergy'));
  for (const node of compactNodes.filter(node => node.kind === 'archetype')) {
    assert.equal(typeof node.data.description, 'string');
    assert.ok(Array.isArray(node.data.requiredFeatures));
    assert.ok(Array.isArray(node.data.optionalFeatures));
    assert.ok(Array.isArray(node.data.payoffFeatures));
    assert.ok(Array.isArray(node.data.genericRoles));
  }
  assert.ok(
    JSON.stringify(compact).length < JSON.stringify(graph).length,
    'semantic projection should remove duplicate storage without dropping authored gameplay knowledge',
  );
}

// A repair response may change only the nodes named in the validation error.
// Already-valid siblings are restored from the authored response, preventing a
// repair model from inventing a new formula or reward error elsewhere.
{
  const jobs = [
    { nodeId: 'node_valid', requestId: 'request_valid', basedOnRevision: 0, kind: 'treasure', act: 1, floor: 1 },
    { nodeId: 'node_invalid', requestId: 'request_invalid', basedOnRevision: 0, kind: 'battle', act: 1, floor: 2 },
  ];
  const original = JSON.stringify({
    spec: 'mwg.tower-node-batch-result/v1', batch_id: 'batch', based_on_revision: 0,
    results: [
      { node_id: 'node_valid', title: '原始有效节点', payload: { treasure: {} }, reward: { artifacts: [{ id: 'kept' }] } },
      { node_id: 'node_invalid', title: '待修节点', payload: { battle: { enemies: [] } } },
    ],
  });
  const repaired = JSON.stringify({
    spec: 'mwg.tower-node-batch-result/v1', batch_id: 'batch', based_on_revision: 0,
    results: [
      { node_id: 'node_valid', title: '不应采用的重写', payload: { treasure: {} }, reward: { artifacts: [{ id: 'drifted' }] } },
      { node_id: 'node_invalid', title: '待修节点', payload: { battle: { enemies: [{ id: 'fixed' }] } } },
    ],
  });
  const guarded = JSON.parse(preserveUnreportedTowerBatchResults(
    original,
    repaired,
    jobs,
    new Error('node_invalid: enemy.status_effects[0].stacks must be positive'),
  ));
  assert.equal(guarded.results[0].title, '原始有效节点');
  assert.equal(guarded.results[0].reward.artifacts[0].id, 'kept');
  assert.equal(guarded.results[1].payload.battle.enemies[0].id, 'fixed');
}

// Within a failed node, a payload-only repair cannot rewrite its already-valid
// reward, and a reward-only repair cannot rewrite the encounter payload.
{
  const jobs = [{ nodeId: 'node_one', requestId: 'request_one', basedOnRevision: 0, kind: 'battle', act: 1, floor: 2 }];
  const originalNode = {
    node_id: 'node_one', title: '原节点',
    payload: { battle: { enemies: [{ id: 'bad_enemy', status_effects: [{ id: 'mark', stacks: 0 }] }] } },
    reward: { card: [{ id: 'kept_reward', effects: { damage: 5 } }] },
  };
  const repairedNode = {
    node_id: 'node_one', title: '擅自重写',
    payload: { battle: { enemies: [{ id: 'fixed_enemy', status_effects: [] }] } },
    reward: { card: [{ id: 'drifted_reward', effects: { damage: 99 } }] },
  };
  const payloadGuarded = JSON.parse(preserveUnreportedTowerBatchResults(
    JSON.stringify({ results: [originalNode] }),
    JSON.stringify({ results: [repairedNode] }),
    jobs,
    new Error('node_one: tower battle payload is invalid: enemy.status_effects[0].stacks'),
  ));
  assert.equal(payloadGuarded.results[0].payload.battle.enemies[0].id, 'fixed_enemy');
  assert.equal(payloadGuarded.results[0].reward.card[0].id, 'kept_reward');
  assert.equal(payloadGuarded.results[0].title, '原节点');

  const rewardGuarded = JSON.parse(preserveUnreportedTowerBatchResults(
    JSON.stringify({ results: [originalNode] }),
    JSON.stringify({ results: [repairedNode] }),
    jobs,
    new Error('node_one: tower reward cards is invalid: $[0].to'),
  ));
  assert.equal(rewardGuarded.results[0].payload.battle.enemies[0].id, 'bad_enemy');
  assert.equal(rewardGuarded.results[0].reward.card[0].id, 'drifted_reward');
  assert.equal(rewardGuarded.results[0].title, '原节点');

  const bothGuarded = JSON.parse(preserveUnreportedTowerBatchResults(
    JSON.stringify({ results: [originalNode] }),
    JSON.stringify({ results: [repairedNode] }),
    jobs,
    new Error([
      'node_one: tower battle payload is invalid: enemy.max_lust',
      'node_one: tower reward cards is invalid: $[0].scope',
    ].join('；')),
  ));
  assert.equal(bothGuarded.results[0].payload.battle.enemies[0].id, 'fixed_enemy');
  assert.equal(bothGuarded.results[0].reward.card[0].id, 'drifted_reward');
  assert.equal(bothGuarded.results[0].title, '原节点');
}

// A payload shape failure must not hide an independently invalid reward from
// the one bounded repair request.
{
  const jobs = [{ nodeId: 'node_one', requestId: 'request_one', basedOnRevision: 0, kind: 'battle', act: 1, floor: 2 }];
  const response = JSON.stringify({
    results: [{
      node_id: 'node_one',
      reward: {
        card: [{
          id: 'bad_scope', name: '错误时限', type: 'Skill', rarity: 'Common', cost: 1,
          effects: [{ block: 4 }, { reduce_cost: 1, from: 'hand', pick: 'choose', scope: 'turn' }],
        }],
        artifact: [], item: [], limits: { cards: 1, artifacts: 0, items: 0 },
      },
    }],
  });
  const issues = collectTowerBatchUnreportedValidationIssues(response, jobs, {
    core: { resources: [] }, cards: [], artifacts: [], items: [], statuses: [],
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /node_one:.*scope/);
}

// An early batch-shape failure must still surface a nested event reward error,
// and the preservation guard must accept the repaired event payload instead of
// restoring its invalid original reward.
{
  const jobs = [
    { nodeId: 'battle_missing_reward', requestId: 'battle_request', basedOnRevision: 0, kind: 'battle', act: 1, floor: 2 },
    { nodeId: 'event_bad_reward', requestId: 'event_request', basedOnRevision: 0, kind: 'event', act: 1, floor: 3 },
  ];
  const badArtifact = {
    id: 'bad_event_relic', name: '错误遗物', rarity: 'Uncommon',
    trigger: { on: 'passive', effects: { energy: 1 } },
  };
  const original = JSON.stringify({
    results: [
      { node_id: 'battle_missing_reward', payload: { battle: { enemies: [] } } },
      {
        node_id: 'event_bad_reward',
        payload: { event: { choices: [
          { id: 'take', label: '领取', outcome: { reward: { artifacts: [badArtifact] } } },
          { id: 'leave', label: '离开', outcome: { outcome: 'cleared' } },
        ] } },
      },
    ],
  });
  const battle = { core: { resources: [] }, cards: [], artifacts: [], items: [], statuses: [] };
  const issues = collectTowerBatchUnreportedValidationIssues(original, jobs, battle);
  assert.equal(issues.length, 2);
  assert.match(issues.find(issue => issue.startsWith('event_bad_reward:')), /passive/);

  const repaired = JSON.stringify({
    results: [
      { node_id: 'battle_missing_reward', payload: { battle: { enemies: [] } }, reward: { card: [], artifact: [], item: [] } },
      {
        node_id: 'event_bad_reward',
        payload: { event: { choices: [
          {
            id: 'take', label: '领取', outcome: { reward: { artifacts: [{
              ...badArtifact,
              trigger: { on: 'battle_start', effects: { energy: 1 } },
            }] } },
          },
          { id: 'leave', label: '离开', outcome: { outcome: 'cleared' } },
        ] } },
      },
    ],
  });
  const guarded = JSON.parse(preserveUnreportedTowerBatchResults(
    original,
    repaired,
    jobs,
    new Error(issues.join('；')),
  ));
  assert.equal(
    guarded.results[1].payload.event.choices[0].outcome.reward.artifacts[0].trigger.on,
    'battle_start',
  );
}

function nodeResult(request) {
  const budget = require('../src/game-core/contentBudget.ts').recommendTowerBattleRewardBudget({nodeId:request.nodeId, kind:request.kind, act:request.act||1,floor:request.floor||1,rewardSeed:request.rewardSeed});
  const common = {
    spec: 'mwg.tower-node-result/v1',
    node_id: request.nodeId,
    request_id: request.requestId,
    based_on_revision: request.basedOnRevision,
    kind: request.kind,
    title: `测试${request.kind}`,
    narrative: '短暂的节点情境。',
  };
  let payload;
  let reward;
  if (['battle', 'elite', 'boss'].includes(request.kind)) {
    const enemyCount = createTowerEncounterPlan(request)?.enemyCount ?? 1;
    payload = { battle: { enemies: Array.from({ length: enemyCount }, (_, index) => ({
      id: `test_enemy_${index + 1}`,
      name: '测试敌人',
      emoji: '👾',
      hp: 40,
      max_hp: 40,
      lust: 0,
      max_lust: 100,
      actions: [{ name: '测试攻击', effects: { damage: 6 } }],
      abilities: [],
      status_effects: [],
      action_mode: 'random',
      action_config: {},
    })) } };
    const cards = ['strike', 'guard', 'cycle'].map((suffix, index) => ({
      id: `${request.nodeId}_${suffix}`,
      name: `测试奖励${index + 1}`,
      type: index === 0 ? 'Attack' : 'Skill',
      rarity: budget.cards.slotRarities?.[index] || (request.kind === 'boss' ? 'Rare' : 'Common'),
      cost: 1,
      quantity: 1,
      effects: index === 0 ? { damage: 7 } : { block: 6 + index },
    }));
    const artifacts = Array.from({length:budget.artifacts?.candidates || 0},(_,index)=>({id:`${request.nodeId}_relic_${index}`,name:`遗物${index}`,rarity:budget.artifacts?.slotRarities?.[index] || 'Rare'}));
    const items = budget.items ? [{id:`${request.nodeId}_potion`,name:'药水',count:1,effects:{heal:6}}] : [];
    reward = { card: cards, artifact: artifacts, item: items };
  } else if (request.kind === 'event') {
    payload = { event: { choices: [
      { id: 'accept', label: '接受', outcome: {} },
      { id: 'leave', label: '离开', outcome: {} },
    ] } };
  } else if (request.kind === 'shop') {
    payload = { shop: {} };
    const budget = recommendShopBudget({
      act: request.act ?? 1,
      actCount: 3,
      floor: request.floor ?? 1,
      floorsPerAct: 16,
      kind: 'shop',
      danger: 0,
    });
    reward = {
      cards: Array.from({ length: budget.cards - Math.min(2, request.shopMemoryCards?.length || 0) }, (_, index) => ({
        id: `${request.nodeId}_shop_card_${index}`,
        name: `商店卡牌${index + 1}`,
        type: 'Attack',
        rarity: 'Common',
        cost: 1,
        quantity: 1,
        effects: { damage: 6 + index },
      })),
      artifacts: Array.from({ length: budget.artifacts }, (_, index) => ({
        id: `${request.nodeId}_shop_artifact_${index}`,
        name: `商店遗物${index + 1}`,
        description: '用于测试商店候选。',
      })),
      items: Array.from({ length: budget.items }, (_, index) => ({
        id: `${request.nodeId}_shop_item_${index}`,
        name: `商店道具${index + 1}`,
        count: 1,
        description: '用于测试商店候选。',
        effects: { heal: 5 + index },
      })),
      limits: { ...budget },
    };
  } else if (request.kind === 'treasure') {
    payload = { treasure: {} };
    reward = {
      cards: [],
      artifacts: [1, 2, 3].map(index => ({ id: `${request.nodeId}_treasure_${index}`, name: `宝箱遗物${index}`, description: '用于测试宝箱候选。', rarity: 'Common', trigger: { on: 'battle_start', effects: { block: index } } })),
      items: [],
      limits: { cards: 0, artifacts: 1, items: 0 },
    };
  } else {
    payload = { rest: {} };
  }
  return `<TOWER_NODE_RESULT>${JSON.stringify({ ...common, payload, ...(reward ? { reward } : {}) })}</TOWER_NODE_RESULT>`;
}

function openingResult(request) {
  return `<TOWER_OPENING_RESULT>${JSON.stringify({
    spec: 'mwg.tower-opening-result/v1',
    request_id: request.requestId,
    based_on_revision: request.revision,
    title: '开局馈赠',
    narrative: '引路者递来一份选择。',
    choices: [
      { id: 'accept', label: '接受馈赠', outcome: { reward: {} } },
      { id: 'leave', label: '保持原样', outcome: { reward: {} } },
      { id: 'prepare', label: '整备行装', outcome: { gold: 20 } },
    ],
  })}</TOWER_OPENING_RESULT>`;
}

function batchResult(request) {
  const results = request.jobs.map(job => JSON.parse(
    nodeResult({ ...job, basedOnRevision: job.revision })
      .slice('<TOWER_NODE_RESULT>'.length, -'</TOWER_NODE_RESULT>'.length),
  ));
  return JSON.stringify({
    spec: 'mwg.tower-node-batch-result/v1',
    batch_id: request.batchId,
    based_on_revision: request.basedOnRevision,
    results,
  });
}

function createHarness(seed, options = {}) {
  let chatId = 'tower-chat';
  let variables = towerVariables(seed);
  const replacements = [];
  const requests = [];
  const errors = [];
  let coordinator;
  const scope = () => ({
    chatId,
    mvuData: structuredClone(variables),
    designSnapshot: null,
    designState: chatState(),
    settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS },
  });
  coordinator = new TowerLookaheadCoordinator({
    snapshot: () => (options.story ? null : scope()),
    prepareDesignSnapshot: async () => {
      options.warmupCount = (options.warmupCount || 0) + 1;
      if (options.rejectWarmup) throw new Error('模拟设计快照准备失败');
    },
    replaceLatest: async (next, expectedChatId) => {
      assert.equal(expectedChatId, chatId);
      variables = structuredClone(next);
      replacements.push(structuredClone(next));
    },
    requestGeneration: async request => {
      requests.push(structuredClone(request));
      const failedJob = options.failNodeId
        ? request.generationType === 'batch'
          ? request.jobs.find(job => job.nodeId === options.failNodeId)
          : request.nodeId === options.failNodeId
            ? request
            : null
        : null;
      if (failedJob && !options.failedOnce) {
        options.failedOnce = true;
        const failedJobs = request.generationType === 'batch' ? request.jobs : [request];
        for (const job of failedJobs) {
          towerState.failTowerGenerationInStat(variables.stat_data, {
            nodeId: job.nodeId,
            requestId: job.requestId,
            revision: job.revision ?? job.basedOnRevision,
            error: '模拟生成失败',
          });
        }
        throw new Error('模拟生成失败');
      }
      if (request.generationType === 'opening') {
        const parsed = parseTowerOpeningResult(openingResult(request), {
          requestId: request.requestId,
          basedOnRevision: request.revision,
        });
        towerOpening.commitTowerOpeningInStat(variables.stat_data, parsed);
      } else if (request.generationType === 'batch') {
        const parsed = parseTowerNodeBatchResult(batchResult(request), request.batchId, request.jobs.map(job => ({
          ...job,
          basedOnRevision: job.revision,
        })));
        parsed.results.forEach((entry, index) => {
          const job = request.jobs[index];
          towerState.commitTowerGenerationInStat(variables.stat_data, {
            nodeId: job.nodeId,
            requestId: job.requestId,
            revision: job.revision,
            content: entry,
            ...(entry.reward ? { reward: entry.reward } : {}),
          });
        });
      } else {
        const parsed = parseTowerNodeResult(nodeResult(request), {
          nodeId: request.nodeId,
          requestId: request.requestId,
          basedOnRevision: request.basedOnRevision,
          kind: request.kind,
          act: request.act,
          floor: request.floor,
        });
        towerState.commitTowerGenerationInStat(variables.stat_data, {
          nodeId: request.nodeId,
          requestId: request.requestId,
          revision: request.basedOnRevision,
          content: parsed,
          ...(parsed.reward ? { reward: parsed.reward } : {}),
        });
      }
    },
    onError: (message, error) => errors.push([message, error]),
  });
  return {
    coordinator,
    requests,
    replacements,
    errors,
    variables: () => variables,
    setVariables: value => { variables = value; },
    setChat: value => { chatId = value; },
  };
}

// Story/unavailable scopes are strict no-ops.
{
  const harness = createHarness(1, { story: true });
  harness.coordinator.activateChat('story-chat');
  await tick();
  await tick();
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.replacements.length, 0);
  harness.coordinator.deactivate();
}

// Opening is generated first; as soon as it is visible, reachable nodes are
// prepared in parallel while the player reads and chooses the gift.
{
  const harness = createHarness(20260840);
  harness.coordinator.activateChat('tower-chat');
  try {
    await waitFor(() => harness.variables().stat_data.run.opening.phase === 'ready', 'opening ready');
  } catch (error) {
    throw new Error(`${error.message}; requests=${JSON.stringify(harness.requests)}; errors=${JSON.stringify(harness.errors.map(entry => String(entry[1])))}`);
  }
  assert.equal(harness.requests[0].generationType, 'opening');
  assert.equal(harness.requests[0].timeoutMs, undefined, 'structured opening generation has no business-layer hard timeout');
  assert.equal(harness.requests[0].maxAttempts, 3, 'empty structured responses receive bounded automatic retries');
  assert.match(harness.requests[0].prompt, /偏好具有机制互动的敌人/);
  const expectedLookaheadCount = towerState.collectTowerLookahead(harness.variables().stat_data.run).length;
  assert.ok(expectedLookaheadCount >= 1 && expectedLookaheadCount <= 3);
  try {
    await waitFor(
      () => harness.requests.filter(request => request.generationType === 'batch').length === 1,
      'reachable lookahead generation',
    );
  } catch (error) {
    const phases = Object.fromEntries(Object.entries(harness.variables().stat_data.run.nodeContent)
      .filter(([, envelope]) => envelope.phase !== 'idle')
      .map(([nodeId, envelope]) => [nodeId, envelope.phase]));
    throw new Error(`${error.message}; status=${JSON.stringify(harness.coordinator.getStatus())}; requests=${JSON.stringify(harness.requests.map(request => request.nodeId || request.generationType))}; phases=${JSON.stringify(phases)}; errors=${JSON.stringify(harness.errors.map(entry => String(entry[1])))}`);
  }
  try {
    await waitFor(() => {
      const envelopes = Object.values(harness.variables().stat_data.run.nodeContent);
      return envelopes.filter(envelope => envelope.phase === 'ready' && envelope.kind !== 'rest').length === expectedLookaheadCount;
    }, 'lookahead ready');
  } catch (error) {
    const phases = Object.fromEntries(Object.entries(harness.variables().stat_data.run.nodeContent)
      .filter(([, envelope]) => envelope.phase !== 'idle')
      .map(([nodeId, envelope]) => [nodeId, { phase: envelope.phase, error: envelope.error }]));
    throw new Error(`${error.message}; expected=${expectedLookaheadCount}; status=${JSON.stringify(harness.coordinator.getStatus())}; phases=${JSON.stringify(phases)}; errors=${JSON.stringify(harness.errors.map(entry => String(entry[1])))}`);
  }
  assert.ok(expectedLookaheadCount > 0);
  const lookaheadBatch = harness.requests.find(request => request.generationType === 'batch');
  assert.equal(lookaheadBatch.jobs.length, expectedLookaheadCount);
  const firstRooms = harness.variables().stat_data.run.choices.map(choice => choice.id);
  assert.equal(firstRooms.length, 3, "new maps expose three independent entrances");
  const playableWindow = towerState.collectTowerLookahead(harness.variables().stat_data.run);
  assert.deepEqual(lookaheadBatch.jobs.map(job => job.nodeId), playableWindow.map(node => node.nodeId),
    'the independent opening batch includes the first playable battle and its nearest successors');
  assert.match(lookaheadBatch.prompt, /mwg\.tower-semantic-mvu\/v1/);
  assert.ok(lookaheadBatch.jobs.every(request => Number.isFinite(request.difficultyMultiplier)));
  assert.equal(lookaheadBatch.maxAttempts, 3);
  assert.equal(lookaheadBatch.timeoutMs, undefined, 'structured nodes have no business-layer hard timeout');
  assert.ok(harness.requests.every(request => request.prompt.includes('COORDINATOR_SEMANTIC_MVU_TAIL')));
  assert.ok(harness.requests.every(request => request.prompt.includes('semantic_card_probe')));
  assert.ok(harness.requests.every(request => !request.prompt.includes('runtime_only_probe')));
  assert.ok(harness.requests.every(request => !request.prompt.includes('runtime_only_staged_reward_probe')));
  assert.ok(harness.requests.every(request => !request.prompt.includes('runtime_only_reroll_probe')));
  assert.equal(harness.requests.some(request => request.prompt.includes('COORDINATOR_LATEST_MVU_TAIL')), false);
  assert.equal(harness.requests.some(request => request.prompt.includes('repeated_report')), false);
  assert.equal(harness.requests.some(request => request.prompt.includes('createChatMessages')), false);
  settleTowerOpeningChoiceInStat(harness.variables().stat_data, 'accept');
  harness.coordinator.schedule('opening-consumed');
  await tick(); await tick();
  assert.equal(harness.requests.filter(request => request.generationType === 'batch').length, 1,
    'settling the gift must not start a second batch just to backfill an omitted first branch');
  assert.deepEqual(harness.variables().stat_data.run.choices.map(choice => choice.id), firstRooms, "claiming the opening gift preserves all entrances");
  harness.coordinator.deactivate();
}

// An independent opening does not invalidate its first-battle request; it is
// invalidated only once that room is entered and the route advances.
{
  const stat = towerVariables(20260840).stat_data;
  const start = stat.run.choices[0].id;
  const old = towerState.queueTowerLookaheadInStat(stat).queued.find(job => job.nodeId === start);
  towerState.claimTowerGenerationInStat(stat, start, old.requestId);
  stat.run.opening = { ...stat.run.opening, phase: 'ready', requestId: 'gift-test', content:
    parseTowerOpeningResult(openingResult({ requestId: 'gift-test', revision: 0 }), { requestId: 'gift-test', basedOnRevision: 0 }) };
  towerState.queueTowerLookaheadInStat(stat);
  settleTowerOpeningChoiceInStat(stat, 'accept');
  towerState.commitTowerGenerationInStat(stat, { ...old, content: { late: true } });
  stat.run = enterRunNode(stat.run, stat.run.choices[0].id);
  towerState.queueTowerLookaheadInStat(stat);
  assert.equal(stat.run.nodeContent[start].phase, 'ready', 'the entered first battle retains its completed prepared content');
  // Advance with the real run reducer to the next act. Its independent gift is
  // pending while the first real battle remains in the prefetch window.
  while (stat.run.act === 1) {
    if (stat.run.phase === 'awaiting_choice') stat.run = enterRunNode(stat.run, stat.run.choices[0].id);
    stat.run = completeRunNode(stat.run, { outcome: 'cleared' });
  }
  assert.equal(stat.run.floor, 0);
  assert.equal(stat.run.opening.phase, 'pending');
  assert.equal(stat.run.choices[0].kind, 'battle');
  assert.equal(towerState.collectTowerLookahead(stat.run)[0].nodeId, stat.run.choices[0].id);
}

// A failed batch leaves every member explicitly retryable. Retrying one node
// creates a one-node batch instead of regenerating unrelated siblings.
{
  const options = {};
  const harness = createHarness(20260843, options);
  const stat = harness.variables().stat_data;
  stat.run = { ...stat.run, opening: { ...stat.run.opening, phase: 'skipped' } };
  const lookahead = towerState.queueTowerLookaheadInStat(stat, 3).queued;
  assert.ok(lookahead.length >= 2);
  options.failNodeId = lookahead[0].nodeId;
  harness.coordinator.activateChat('tower-chat');
  await waitFor(
    () => harness.requests.filter(request => request.generationType === 'batch').length === 1,
    'failed lookahead batch',
  );
  await waitFor(() => {
    const envelopes = lookahead.map(request => harness.variables().stat_data.run.nodeContent[request.nodeId]);
    return envelopes.every(envelope => envelope.phase === 'failed');
  }, 'failed batch members');
  assert.equal(await harness.coordinator.retryNode(lookahead[0].nodeId), true);
  await waitFor(
    () => harness.variables().stat_data.run.nodeContent[lookahead[0].nodeId].phase === 'ready',
    'one-node retry batch',
  );
  assert.equal(harness.requests.filter(request => request.generationType === 'batch').at(-1).jobs.length, 1);
  assert.equal(harness.errors.length, 1);
  harness.coordinator.deactivate();
}

// Claims are persisted before prompt preparation. A rejected warmup must
// settle every exact claimed envelope to failed and must not call the model.
// Explicit retry then owns one fresh request and can complete normally.
{
  const options = { rejectWarmup: true };
  const harness = createHarness(20260915, options);
  harness.variables().stat_data.run = {
    ...harness.variables().stat_data.run,
    opening: { ...harness.variables().stat_data.run.opening, phase: 'skipped' },
  };
  const queued = towerState.queueTowerLookaheadInStat(harness.variables().stat_data, 3).queued;
  assert.ok(queued.length >= 1);
  harness.coordinator.activateChat('tower-chat');
  await waitFor(() => queued.every(job =>
    harness.variables().stat_data.run.nodeContent[job.nodeId].phase === 'failed'
  ), 'warmup rejection settles claimed envelopes');
  assert.equal(harness.requests.length, 0, 'warmup rejection does not make an AI request');
  assert.equal(harness.errors.length, 1);
  assert.ok(queued.every(job => {
    const envelope = harness.variables().stat_data.run.nodeContent[job.nodeId];
    return envelope.requestId === job.requestId
      && envelope.error.includes('模拟设计快照准备失败');
  }));
  options.rejectWarmup = false;
  assert.equal(await harness.coordinator.retryNode(queued[0].nodeId), true);
  await waitFor(() => harness.variables().stat_data.run.nodeContent[queued[0].nodeId].phase === 'ready',
    'manual retry after warmup rejection');
  const retry = harness.requests.at(-1);
  const retryJob = retry.jobs.find(job => job.nodeId === queued[0].nodeId);
  assert.notEqual(retryJob.requestId, queued[0].requestId, 'retry uses a new request identity');
  assert.equal(harness.requests.length, 1, 'only the explicit retry reaches the model');
  harness.coordinator.deactivate();
}

// A normal refresh/recovery request during a live transport is deferred. It
// must not convert the owned generating envelope into a failed stale job.
{
  let variables = towerVariables(20260916);
  variables.stat_data.run = {
    ...variables.stat_data.run,
    opening: { ...variables.stat_data.run.opening, phase: 'skipped' },
  };
  let releaseBatch;
  let batchRequest;
  const coordinator = new TowerLookaheadCoordinator({
    snapshot: () => ({
      chatId: 'tower-chat', mvuData: structuredClone(variables), designSnapshot: null,
      designState: chatState(), settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS },
    }),
    prepareDesignSnapshot: async () => {},
    replaceLatest: async next => { variables = structuredClone(next); },
    requestGeneration: request => {
      if (request.generationType !== 'batch') return Promise.resolve();
      batchRequest = structuredClone(request);
      return new Promise(resolvePromise => { releaseBatch = resolvePromise; });
    },
  });
  coordinator.activateChat('tower-chat');
  await waitFor(() => batchRequest, 'live batch transport');
  const ownedJobs = batchRequest.jobs;
  coordinator.requestRecovery();
  await tick(); await tick();
  assert.ok(ownedJobs.every(job => variables.stat_data.run.nodeContent[job.nodeId].phase === 'generating'),
    'state refresh does not recover a coordinator-owned live request');
  ownedJobs.forEach(job => towerState.commitTowerGenerationInStat(variables.stat_data, {
    nodeId: job.nodeId, requestId: job.requestId, revision: job.revision, content: { completed: true },
  }));
  releaseBatch();
  await waitFor(() => coordinator.getStatus().phase === 'waiting', 'live batch settles after refresh');
  coordinator.deactivate();
}

// An unresolved pass from a chat that has already been replaced cannot make a
// retry in the new chat await forever. The old response remains epoch-fenced.
{
  let activeChat = 'first-chat';
  const runs = new Map(['first-chat', 'second-chat'].map(chatId => {
    const variables = towerVariables(chatId === 'first-chat' ? 20260917 : 20260918);
    variables.stat_data.run = {
      ...variables.stat_data.run,
      opening: { ...variables.stat_data.run.opening, phase: 'skipped' },
    };
    return [chatId, variables];
  }));
  let firstRequestHeld = false;
  let secondRequestCount = 0;
  const coordinator = new TowerLookaheadCoordinator({
    snapshot: () => ({
      chatId: activeChat, mvuData: structuredClone(runs.get(activeChat)), designSnapshot: null,
      designState: chatState(), settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS },
    }),
    prepareDesignSnapshot: async () => {},
    replaceLatest: async (next, expectedChatId) => { runs.set(expectedChatId, structuredClone(next)); },
    requestGeneration: request => {
      if (activeChat === 'first-chat') {
        firstRequestHeld = true;
        return new Promise(() => {});
      }
      secondRequestCount += 1;
      request.jobs.forEach(job => towerState.commitTowerGenerationInStat(runs.get('second-chat').stat_data, {
        nodeId: job.nodeId, requestId: job.requestId, revision: job.revision, content: { completed: true },
      }));
      return Promise.resolve();
    },
  });
  coordinator.activateChat('first-chat');
  await waitFor(() => firstRequestHeld, 'first chat unresolved pass');
  activeChat = 'second-chat';
  coordinator.activateChat('second-chat');
  await waitFor(() => secondRequestCount === 1, 'new chat pass after stale unresolved pass');
  assert.ok(Object.values(runs.get('second-chat').stat_data.run.nodeContent)
    .some(envelope => envelope.phase === 'ready'));
  coordinator.deactivate();
}

// Choosing one ready branch while a sibling is still generating cancels that
// precise obsolete request. Its eventual result cannot enter the new route.
{
  let variables = towerVariables(20260842);
  variables.stat_data.run = {
    ...variables.stat_data.run,
    opening: { ...variables.stat_data.run.opening, phase: 'skipped' },
  };
  const window = towerState.queueTowerLookaheadInStat(variables.stat_data).queued;
  assert.equal(window.length, 3);
  const obsolete = window[0];
  const kept = window[1];
  assert.ok(variables.stat_data.run.choices.some(choice => choice.id === kept.nodeId));
  assert.ok(variables.stat_data.run.choices.some(choice => choice.id === obsolete.nodeId));
  towerState.claimTowerGenerationInStat(variables.stat_data, kept.nodeId, kept.requestId);
  towerState.commitTowerGenerationInStat(variables.stat_data, {
    ...kept,
    content: { opaque: 'ready branch' },
  });
  let rejectObsolete = null;
  const cancelled = [];
  const requests = [];
  const errors = [];
  const coordinator = new TowerLookaheadCoordinator({
    snapshot: () => ({
      chatId: 'tower-chat',
      mvuData: structuredClone(variables),
      designSnapshot: null,
      designState: chatState(),
      settings: { ...DEFAULT_DESIGN_ASSISTANT_SETTINGS },
    }),
    replaceLatest: async next => { variables = structuredClone(next); },
    requestGeneration: request => {
      requests.push(structuredClone(request));
      if (request.generationType === 'batch' && request.jobs.some(job => job.nodeId === obsolete.nodeId)) {
        return new Promise((_resolve, reject) => { rejectObsolete = reject; });
      }
      return Promise.resolve();
    },
    cancelGeneration: (request, reason) => {
      cancelled.push({ request: structuredClone(request), reason });
      rejectObsolete?.(new TowerGenerationCancelledError(reason));
      return true;
    },
    onError: (message, error) => errors.push([message, error]),
  });
  coordinator.activateChat('tower-chat');
  await waitFor(() => rejectObsolete !== null, 'obsolete branch generation');
  towerState.enterTowerRunNodeInStat(variables.stat_data, kept.nodeId);
  assert.equal(variables.stat_data.run.nodeContent[obsolete.nodeId].phase, 'abandoned');
  coordinator.schedule('route-changed');
  await waitFor(() => cancelled.length === 1, 'obsolete branch cancellation');
  await waitFor(() => coordinator.getStatus().phase !== 'lookahead', 'cancelled coordinator pass');
  assert.match(cancelled[0].request.nodeId, /^__tower_batch__/);
  assert.ok(cancelled[0].request.jobs.some(job => job.nodeId === obsolete.nodeId));
  assert.match(cancelled[0].reason, /路线已改变/);
  assert.equal(errors.length, 0);
  assert.notEqual(coordinator.getStatus().phase, 'error');
  coordinator.deactivate();
}

// A stale generating request is recovered to failed on activation and remains
// failed until the explicit retry API queues a new request ID.
{
  const harness = createHarness(20260841);
  const stat = harness.variables().stat_data;
  stat.run = { ...stat.run, opening: { ...stat.run.opening, phase: 'skipped' } };
  const queued = towerState.queueTowerLookaheadInStat(stat).queued;
  const stale = towerState.claimTowerGenerationInStat(stat, queued[0].nodeId, queued[0].requestId).request;
  harness.coordinator.activateChat('tower-chat');
  await waitFor(() => harness.variables().stat_data.run.nodeContent[stale.nodeId].phase === 'failed', 'stale recovery');
  const requestsBeforeRetry = harness.requests.filter(request =>
    request.nodeId === stale.nodeId || request.jobs?.some(job => job.nodeId === stale.nodeId)
  ).length;
  await harness.coordinator.retryNode(stale.nodeId);
  await waitFor(() => harness.variables().stat_data.run.nodeContent[stale.nodeId].phase === 'ready', 'manual retry ready');
  const retried = harness.requests.filter(request =>
    request.nodeId === stale.nodeId || request.jobs?.some(job => job.nodeId === stale.nodeId)
  );
  assert.equal(retried.length, requestsBeforeRetry + 1);
  const retriedJob = retried.at(-1).jobs?.find(job => job.nodeId === stale.nodeId) ?? retried.at(-1);
  assert.notEqual(retriedJob.requestId, stale.requestId);
  harness.coordinator.deactivate();
}

console.log('Tower lookahead coordinator opening gate, reachable prefetch, recovery, and manual retry tests passed.');

{
 const options={};const harness=createHarness(20260840,options);
 harness.coordinator.activateChat('tower-chat');
 await waitFor(()=>harness.requests.some(r=>r.generationType==='batch') && harness.coordinator.getStatus().phase==='waiting','background settled before idle test');
 const before=options.warmupCount;
 harness.coordinator.schedule('ui-rerender-with-no-new-work');
 for(let i=0;i<10;i++) await tick();
 assert.equal(options.warmupCount,before,'no pending generation means no repeated simulation');
 harness.coordinator.deactivate();
}
console.log('PASS idle UI scheduling does not recompute design simulation.');
// Act-two recovery uses the same message/saved run, not a new initial deck.
{
  const harness = createHarness(20260918);
  const saved = harness.variables();
  const first = saved.stat_data.run;
  const boss = first.map.acts[0].nodes.find(node => node.kind === 'boss');
  saved.stat_data.run = completeRunNode({ ...first, opening: { ...first.opening, phase: 'consumed' },
    phase: 'in_node', floor: boss.floor - 1, currentNode: { ...boss }, choices: [] }, { outcome: 'cleared' });
  saved.stat_data.reward = { card: [], artifact: [], item: [], limits: {}, gold: 151, gold_claimed: true };
  assert.equal(saved.stat_data.run.act, 2);
  assert.equal(saved.stat_data.run.opening.phase, 'pending');
  const deckBefore = JSON.stringify(saved.stat_data.battle.cards);
  harness.setVariables(JSON.parse(JSON.stringify(saved)));
  harness.coordinator.activateChat('tower-chat');
  await waitFor(() => harness.variables().stat_data.run.opening.phase === 'ready', 'restored second-act gift');
  assert.equal(harness.requests[0].generationType, 'opening');
  assert.equal(harness.variables().stat_data.run.act, 2);
  assert.equal(JSON.stringify(harness.variables().stat_data.battle.cards), deckBefore);
  settleTowerOpeningChoiceInStat(harness.variables().stat_data, 'accept');
  harness.coordinator.schedule('opening-consumed');
  await waitFor(() => harness.variables().stat_data.run.choices.every(node =>
    harness.variables().stat_data.run.nodeContent[node.id]?.phase === 'ready'), 'second-act entrances ready');
  assert.ok(harness.variables().stat_data.run.choices.every(node => node.act === 2));
  assert.deepEqual(harness.errors, []);
  harness.coordinator.deactivate();
  console.log('PASS saved boss settlement -> second-act gift -> all second-act entrances ready, no deck reset.');
}
