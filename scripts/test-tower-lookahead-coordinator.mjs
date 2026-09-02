import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { TowerLookaheadCoordinator } = require(resolve('src/sillytavern-extension/towerCoordinator.ts'));
const { TowerGenerationCancelledError } = require(resolve('src/sillytavern-extension/towerGenerationQueue.ts'));
const { completeRunNode, createRunState, enterRunNode } = require(resolve('src/game-core/runState.ts'));
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

function nodeResult(request) {
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
    payload = { battle: { enemy: {
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
    } } };
    const cards = ['strike', 'guard', 'cycle'].map((suffix, index) => ({
      id: `${request.nodeId}_${suffix}`,
      name: `测试奖励${index + 1}`,
      type: index === 0 ? 'Attack' : 'Skill',
      rarity: request.kind === 'boss' ? 'Rare' : 'Common',
      cost: 1,
      quantity: 1,
      effects: index === 0 ? { damage: 7 } : { block: 6 + index },
    }));
    const artifacts = request.kind === 'boss'
      ? [0, 1, 2].map(index => ({ id: `${request.nodeId}_relic_${index}`, name: `遗物${index}` }))
      : request.kind === 'elite'
        ? [{ id: `${request.nodeId}_relic`, name: '精英遗物' }]
        : [];
    const items = request.kind === 'battle'
      ? [{ id: `${request.nodeId}_potion`, name: '恢复药剂', count: 1, effects: { heal: 6 } }]
      : [];
    reward = { card: cards, artifact: artifacts, item: items };
  } else if (request.kind === 'event') {
    payload = { event: { choices: [
      { id: 'accept', label: '接受', outcome: {} },
      { id: 'leave', label: '离开', outcome: {} },
    ] } };
  } else if (request.kind === 'shop') {
    payload = { shop: {} };
    reward = { cards: [], artifacts: [], items: [] };
  } else if (request.kind === 'treasure') {
    payload = { treasure: {} };
    reward = { cards: [], artifacts: [], items: [] };
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

// Opening is generated first and blocks all node prefetch until consumed.
{
  const harness = createHarness(20260840);
  harness.coordinator.activateChat('tower-chat');
  try {
    await waitFor(() => harness.variables().stat_data.run.opening.phase === 'ready', 'opening ready');
  } catch (error) {
    throw new Error(`${error.message}; requests=${JSON.stringify(harness.requests)}; errors=${JSON.stringify(harness.errors.map(entry => String(entry[1])))}`);
  }
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].generationType, 'opening');
  assert.equal(harness.requests[0].timeoutMs, undefined, 'structured opening generation has no business-layer hard timeout');
  assert.equal(harness.requests[0].maxAttempts, 3, 'empty structured responses receive bounded automatic retries');
  assert.match(harness.requests[0].prompt, /偏好具有机制互动的敌人/);
  await tick();
  assert.equal(harness.requests.filter(request => request.generationType === 'batch').length, 0);

  settleTowerOpeningChoiceInStat(harness.variables().stat_data, 'accept');
  harness.coordinator.schedule('opening-consumed');
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
  await waitFor(() => {
    const envelopes = Object.values(harness.variables().stat_data.run.nodeContent);
    return envelopes.filter(envelope => envelope.phase === 'ready').length === expectedLookaheadCount;
  }, 'lookahead ready');
  assert.ok(expectedLookaheadCount > 0);
  const lookaheadBatch = harness.requests.find(request => request.generationType === 'batch');
  assert.equal(lookaheadBatch.jobs.length, expectedLookaheadCount);
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
  harness.coordinator.deactivate();
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

// Choosing one ready branch while a sibling is still generating cancels that
// precise obsolete request. Its eventual result cannot enter the new route.
{
  let variables = towerVariables(20260842);
  variables.stat_data.run = {
    ...variables.stat_data.run,
    opening: { ...variables.stat_data.run.opening, phase: 'skipped' },
  };
  variables.stat_data.run = completeRunNode(
    enterRunNode(
      variables.stat_data.run,
      variables.stat_data.run.choices[0].id,
    ),
    { outcome: 'cleared' },
  );
  const window = towerState.queueTowerLookaheadInStat(variables.stat_data).queued;
  assert.equal(window.length, 3);
  const obsolete = window[0];
  const kept = window[1];
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
