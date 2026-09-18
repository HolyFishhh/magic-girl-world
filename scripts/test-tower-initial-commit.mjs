import assert from 'node:assert/strict';
import { dungeonPlanFixture, withDungeonPlan } from './lib/tower-plan-fixture.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'webpack/node_modules/ajv/dist/2020.js';
const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { DesignAssistantController } = require(resolve('src/sillytavern-extension/controller.ts'));
const { observeNarrativeDelivery } = require(resolve('src/sillytavern-extension/narrativeDeliveryObservation.ts'));
const { formatCompactEffectAuthoringContract } = require(resolve('src/game-core/towerRequest.ts'));
const { createGlobalTowerGenerationPorts, createProviderSafeJsonSchema } = require(resolve('src/sillytavern-extension/towerGenerationHost.ts'));
const {GenerationTransportError,classifyGenerationTransportFailure}=require(resolve('src/sillytavern-extension/generationTransportError.ts'));
const { DESIGN_ASSISTANT_CARD_SCOPE, DESIGN_ASSISTANT_EXTENSION_ID } = require(resolve('src/sillytavern-extension/types.ts'));
const { TOWER_INITIAL_COMMIT_KEY: receiptKey, TOWER_INITIAL_PUBLICATION_KEY: publicationKey, towerInitialStateKey } = require(resolve('src/sillytavern-extension/towerInitialCommit.ts'));
const { INITIAL_ARTIFACT_ACQUISITION_KEY: initialArtifactReceiptKey } = require(resolve('src/common/initialArtifactAcquisition.ts'));
const { verifyTowerInitialPersistence } = require(resolve('src/sillytavern-extension/initialPersistence.ts'));
const { selectInitialSlotRepairGuidance } = require(resolve('src/sillytavern-extension/initialSlotRepairGuidance.ts'));
const allSlotGuidance = JSON.parse(readFileSync(resolve('scripts/fixtures/initial-slot-guidance-before-selection.json'),'utf8'));
let slotGuidanceChecks = 0;
const { refreshMvuContentDesignContext } = require(resolve('src/runtime/contentDesignContextAdapter.ts'));
const { queueTowerLookaheadInStat, claimQueuedTowerGenerationsInStat } = require(resolve('src/runtime/towerStateAdapter.ts'));

const fixture = () => ({
  narrative: '你来到高塔入口，守门人请你选择馈赠。',
  player: {
    status: { time: '清晨', location: '高塔入口', profession: { name: '星火旅者', ability: '控制星火' } },
    core: { emoji: '✨', hp: 60, max_hp: 60, lust: 0, max_lust: 100 },
    cards: [{ id: 'strike', name: '星火', type: 'Attack', rarity: 'Common', cost: 1, quantity: 6, effects: { damage: 6 } }],
    artifacts: [], items: [], statuses: [], player_abilities: [], player_status_effects: [], level: 1, exp: 0,
  },
  opening: { title: '入塔馈赠', narrative: '守门人递来三种馈赠。', choices: [
    { id: 'a', label: '钱袋', outcome: { gold: 30 } },
    { id: 'b', label: '生命', outcome: { max_hp: 4 } },
    { id: 'c', label: '精简', outcome: { card_removals: 1 } },
  ] },
});
const request = { spec: 'mwg.tower-single-floor-start/v1', sourceMessageId: 0, prompt: '依照剧情开始高塔之旅。' };
function setup(hooks = {}) {
  const listeners = new Map();
  const eventSource = {
    on(event, listener) { listeners.set(event, [...(listeners.get(event) || []), listener]); },
    removeListener(event, listener) { listeners.set(event, (listeners.get(event) || []).filter(l => l !== listener)); },
    async emit(event, ...args) { for (const listener of listeners.get(event) || []) await listener(...args); },
  };
  const h = {
    listeners,
    variables: { stat_data: { game_mode: 'tower', game_mode_lock: { schemaVersion: 1, mode: 'tower' }, status: {}, battle: {} } },
    modelCalls: 0, narrativeCalls: 0, modelRequests: [], narrativeRequests: [], writes: 0, cacheWrites: 0, storyWrites: 0, saves: 0,
  };
  h.context = {
    chatId: 'commit-chat', chat: [{ mes: '[爬塔模式开场]', is_user: false, is_system: false, swipe_id: 0 }],
    characterId: 0, characters: [{ data: { extensions: { magic_girl_world: { design_assistant_scope: DESIGN_ASSISTANT_CARD_SCOPE } } } }],
    extensionSettings: { [DESIGN_ASSISTANT_EXTENSION_ID]: { enabled: false, initialAuthoringProtocol: hooks.protocol || 'canonical', initialMechanismThinking: hooks.thinkingMode } }, chatMetadata: {},
    saveSettingsDebounced() {}, saveMetadataDebounced() {}, eventSource,
    eventTypes: { CHAT_CHANGED: 'chat_id_changed', MESSAGE_UPDATED: 'message_updated' },
    updateMessageBlock() { h.storyWrites++; hooks.story?.(h); },
    async saveChat() { h.saves++; await hooks.save?.(h); },
  };
  globalThis.TavernHelper = { async replaceVariables(root, options) {
    assert.equal(options.type, 'chat');
    h.cacheWrites++; h.cache = structuredClone(root);
    // Match Helper's real chat-scope replacement semantics, including removal
    // of unrelated preset/user variables. A detached cache hides data loss.
    h.context.chatMetadata.variables = structuredClone(root);
    await hooks.cache?.(h);
  } };
  h.mvu = {
    getMvuData: () => structuredClone(h.variables),
    async replaceMvuData(root) {
      await hooks.beforeWrite?.(h);
      h.writes++;
      h.variables = structuredClone(root);
      await hooks.afterWrite?.(h);
    },
  };
  h.makeController = () => new DesignAssistantController({
    context: () => h.context, mvu: () => h.mvu, now: () => 202609050100 + h.modelCalls,
    notify() {},
    ...(hooks.verify ? { verifyTowerInitialPersistence: expected => hooks.verify(h, expected) } : {}),
  }, undefined, {
    currentChatId: () => h.context.chatId,
    observeStructuredDelivery: id => observeNarrativeDelivery(eventSource, id),
    createChatMessages: async () => { throw new Error('must not append messages'); },
    generate: async config => {
      const projectionLine=String(config.user_input||'').match(/^REPAIR_SLOTS=(.+)$/m);
      if(projectionLine){
        const projection=JSON.parse(projectionLine[1]);
        const selected=selectInitialSlotRepairGuidance(Object.values(projection).map(root=>({slots:Object.values(root.slots)})));
        for(const paragraph of allSlotGuidance)assert.equal(config.user_input.split(paragraph).length-1,selected.includes(paragraph)?1:0,'actual controller prompt delivers exactly the selected guidance, once');
        assert.ok(config.user_input.includes('没有 description 槽时不得改说明'));
        assert.ok(config.user_input.includes('所有根和槽都必须出现一次'));
        slotGuidanceChecks++;
      }
      h.modelCalls++; h.modelRequests.push(structuredClone(config)); await hooks.generate?.(h);
      let response = hooks.structured ? await hooks.structured(h, config) : JSON.stringify(fixture());
      if (hooks.protocol !== 'registry-draft') {
        try {
          const parsed = typeof response === 'string' ? JSON.parse(response) : structuredClone(response);
          if (parsed?.player && typeof parsed.narrative === 'string') {
            parsed.narrative = withDungeonPlan(parsed.narrative);
            response = typeof response === 'string' ? JSON.stringify(parsed) : parsed;
          }
        } catch { /* Deliberately malformed transport fixtures stay malformed. */ }
      }
      if (hooks.customStreamTransport) {
        h.pendingCustomFinal = typeof response === 'string' ? response : JSON.stringify(response);
        h.customWire ??= [];
        h.customPorts ??= (() => {
          const settings = {chat_completion_source:'custom',custom_model:'deepseek-v4-flash【果汁】',custom_url:'https://fixture.invalid/v1',
            ...(hooks.customStructuredThinking ? {show_thoughts:true,custom_include_body:'',custom_exclude_body:''} : {})};
          const fetchHost = {location:{href:'http://127.0.0.1:8012/'},fetch:async (_url,init)=>{
            h.customWire.push(JSON.parse(init.body));
            return new Response('data: '+JSON.stringify({choices:[{delta:{role:'assistant',content:h.pendingCustomFinal}}]})+'\n\ndata: [DONE]\n\n',
              {headers:{'Content-Type':'text/event-stream'}});
          }};
          return createGlobalTowerGenerationPorts({generateRaw:async helperConfig=>{
            h.helperRequests ??= []; h.helperRequests.push(structuredClone(helperConfig));
            const payload={
              chat_completion_source:settings.chat_completion_source,model:settings.custom_model,custom_url:settings.custom_url,
              stream:true,json_schema:helperConfig.json_schema,messages:helperConfig.ordered_prompts.filter(p=>typeof p==='object'),
            };
            await eventSource.emit('chat_completion_settings_ready',payload);
            const response=await fetchHost.fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify(payload)});
            const wire=await response.text();return JSON.parse(wire.split('\n')[0].slice(6)).choices[0].delta.content;
          }},()=>({...h.context,chatCompletionSettings:settings}),fetchHost);
        })();
        return h.customPorts.generate(config);
      }
      if (hooks.realTransport) {
        return createGlobalTowerGenerationPorts({ generateRaw: async helperConfig => {
          h.helperRequests ??= []; h.helperRequests.push(structuredClone(helperConfig)); return response;
        } }, () => ({ ...h.context, chatCompletionSettings: {
          chat_completion_source: 'deepseek', deepseek_model: 'deepseek-v4-flash', function_calling: false,
        } })).generate(config);
      }
      return response;
    },
    generateNarrative: async config => {
      if (hooks.protocol !== 'registry-draft') throw new Error('legacy protocol uses one structured authoring call');
      h.narrativeCalls++; h.narrativeRequests.push(structuredClone(config)); await hooks.narrative?.(h);
      const response = hooks.narrativeResponse ? await hooks.narrativeResponse(h, config)
        : '在黎明之塔入口，你以星火旅者的身份面对守门人。请选择馈赠。';
      return response ? withDungeonPlan(response) : response;
    },
    canRecoverEmptyNarrative: () => hooks.narrativeRecovery === true,
    stopGenerationById: id => { (h.stoppedIds ??= []).push(id); return true; }, emitInternalEvent: async () => {},
  }, { towerCoordinator: false });
  h.controller = h.makeController();
  h.controller.activate();
  return h;
}
async function scenario(name, hooks, check) {
  const h = setup(hooks);
  try {
    await check(h);
    if(h.variables[receiptKey]) assert.deepEqual(h.variables.stat_data.run.dungeonPlan,dungeonPlanFixture);
    if(h.storyWrites) assert.ok(h.context.chat.every(message=>!String(message.mes).includes('<TOWER_DUNGEON_PLAN>')));
    console.log(`PASS ${name}`);
  }
  finally { h.controller.deactivate(); }
}
const previousHelper = globalThis.TavernHelper;
const previousMonitor = globalThis.MagicGirlWorldMvuMonitor;
try {
  for (const cryptoAvailable of [true, false]) await scenario(`canonical card_ref compiles, saves and resumes (SubtleCrypto=${cryptoAvailable})`, {
    structured: () => {
      const value = fixture();
      value.opening.choices[0].outcome = { reward: { cards: [{ card_ref: 'strike', quantity: 2 }] } };
      return value;
    },
  }, async h => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    if (!cryptoAvailable) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    try {
      await h.controller.startTowerSingleFloor(request);
      assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
      const schema = new Ajv2020({ strict: false }).compile(h.modelRequests[0].json_schema.value);
      const authored = fixture(); authored.opening.choices[0].outcome = { reward: { cards: [{ card_ref: 'strike', quantity: 2 }] } };
      assert.equal(schema(authored), true, JSON.stringify(schema.errors));
      const saved = JSON.parse(JSON.stringify(h.variables));
      const card = saved.stat_data.run.opening.content.choices[0].outcome.reward.cards[0];
      assert.equal(card.id, 'strike'); assert.equal(card.name, '星火'); assert.equal(card.quantity, 2);
      assert.deepEqual(card.effects, { damage: 6 });
      const { compileCompactEffectList } = require('../src/game-core/compactEffectDsl.ts');
      const { executeEffectProgram } = require('../src/game-core/effectDsl.ts');
      const { describeCompactCard } = require('../src/game-core/contentDescription.ts');
      const { compactContentToDisplayTags } = require('../src/game-core/effectDisplay.ts');
      const compiled = compileCompactEffectList(card.effects);
      assert.equal(compiled.ok, true);
      const combatant = { hp: 20, maxHp: 20, lust: 0, maxLust: 100, energy: 3, maxEnergy: 3, block: 0 };
      const played = executeEffectProgram(compiled.value, { self: { ...combatant }, opponent: { ...combatant }, currentTurn: 1,
        cardsPlayedThisTurn: 0, attacksPlayedThisTurn: 0, skillsPlayedThisTurn: 0 }, { spentEnergy: 1 });
      assert.equal(played.ok, true); assert.equal(played.state.opponent.hp, 14);
      assert.match(describeCompactCard(card), /6.*伤害/);
      assert.match(compactContentToDisplayTags(card).map(tag => tag.text).join(''), /6/);
      assert.doesNotMatch(JSON.stringify(saved), /card_ref/);
      assert.equal(saved.stat_data.battle.cards.reduce((n, c) => n + c.quantity, 0), 6);
      h.variables = saved;
      await h.controller.resumeTowerInitialCommit();
      assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
      const { settleTowerOpeningChoiceInStat } = require('../src/common/runTransactions.ts');
      saved.stat_data.reward = { card: [], artifact: [], item: [], limits: {}, disabled_categories: [] };
      settleTowerOpeningChoiceInStat(saved.stat_data, 'a');
      assert.equal(saved.stat_data.battle.cards.reduce((n, c) => n + c.quantity, 0), 8, 'copies are acquired only on selection');
      assert.throws(() => settleTowerOpeningChoiceInStat(saved.stat_data, 'a'), /没有可结算/);
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor); else delete globalThis.crypto;
    }
  });
  for (const [label, reference] of [
    ['missing', { card_ref: 'missing', quantity: 1 }],
    ['override', { card_ref: 'strike', quantity: 1, effects: { damage: 999 } }],
    ['zero', { card_ref: 'strike', quantity: 0 }],
  ]) await scenario(`canonical ${label} reference is rejected without changing the save`, {
    structured: () => { const value = fixture(); value.opening.choices[0].outcome = { reward: { cards: [reference] } }; return value; },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request));
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 0); assert.equal(h.variables[receiptKey], undefined);
    const evidence = JSON.stringify(h.context.chatMetadata);
    assert.match(evidence, /provider-final/, 'default route retains the original response even when rejected');
  });
  for (const [label, acquisition] of [
    ['missing acquisition cost resource', { cost: { resources: { absent_charge: 1 } } }],
    ['nested transform missing status', { deck_actions: [{ id: 'replace', kind: 'transform', count: 1, pick: 'choose', replacement: {
      id: 'bad_nested', name: '坏替换', type: 'Skill', rarity: 'Common', cost: 0, effects: { apply_status: 'absent_status' },
    } }] }],
  ]) {
    await scenario(`initial ${label} stays before receipt persistence`, {
      structured: () => {
        const value = fixture();
        value.player.artifacts = [{ id: 'bad_initial_relic', name: '坏初始遗物', rarity: 'Rare', on_acquire: acquisition }];
        return value;
      },
    }, async h => {
      await assert.rejects(h.controller.startTowerSingleFloor(request));
      assert.equal(h.writes, 0, 'invalid initial acquisition must enter bounded repair without committing a pending receipt');
      assert.equal(h.variables[receiptKey], undefined);
      assert.equal(h.variables.stat_data.initial_artifact_acquisition, undefined);
      assert.equal(h.modelCalls, 2, 'the existing one bounded structural repair is attempted before failure');
    });
  }
  await scenario('new initial player relic stamps one pending acquisition receipt; resume does not rebuild it', {
    structured: () => {
      const value = fixture();
      value.player.artifacts = [{ id: 'initial_key', name: '初始钥匙', rarity: 'Rare', on_acquire: { gold: 2 } }];
      return value;
    },
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    const stamped = structuredClone(h.variables.stat_data[initialArtifactReceiptKey]);
    assert.deepEqual(stamped, {
      spec: 'mwg.initial-artifact-acquisition/v1', generationId: h.variables[receiptKey].generationId,
      createdAtRevision: h.variables.stat_data.run.stateRevision, phase: 'pending',
      artifacts: [h.variables.stat_data.battle.artifacts[0]],
    });
    const writes = h.writes;
    await h.controller.resumeTowerInitialCommit();
    assert.equal(h.writes, writes, 'resume only republishes the exact committed root');
    assert.deepEqual(h.variables.stat_data[initialArtifactReceiptKey], stamped);
  });
  await scenario('independent selected mechanics survives the actual start config boundary', {}, async h => {
    const config = { card: '只保留用户自己填写的卡组要求', selectedMechanics: '独立勾选的机制要求' };
    await h.controller.startTowerSingleFloor({ ...request, config });
    const sent = JSON.parse(h.modelRequests[0].user_input.match(/^PLAYER_CONFIG=(.+)$/m)[1]);
    assert.equal(sent.card, config.card);
    assert.equal(sent.selectedMechanics, config.selectedMechanics);
    assert.equal(h.variables.stat_data.selected_mechanics, config.selectedMechanics, 'the chosen foundations persist separately for later-node generation');
    assert.equal(h.modelCalls, 1, 'the independent field does not add an AI request');
  });
  for (const stage of ['narrative', 'mechanism']) {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await scenario(`explicit ${stage} cancellation releases UI and rejects late writes`, {
      ...(stage === 'narrative' ? { protocol: 'registry-draft', narrative: () => held } : { generate: () => held }),
    }, async h => {
      const before = structuredClone(h.variables);
      const pending = h.controller.startTowerSingleFloor(request);
      const rejected = assert.rejects(pending, /取消/);
      for (let i = 0; i < 30 && !(stage === 'narrative' ? h.narrativeCalls : h.modelCalls); i++) await new Promise(setImmediate);
      assert.equal(stage === 'narrative' ? h.narrativeCalls : h.modelCalls, 1);
      assert.equal(h.controller.cancelTowerInitialStart({ sourceMessageId: 99 }), false);
      const originalChat = h.context.chatId; h.context.chatId = 'other-chat';
      assert.equal(h.controller.cancelTowerInitialStart({ sourceMessageId: 0 }), false);
      h.context.chatId = originalChat;
      assert.equal(h.controller.cancelTowerInitialStart({ sourceMessageId: 0, generationId: 'stale-monitor-request' }), false);
      const activeGenerationId = [...h.controller.initialStartOperations.values()][0].generationId;
      assert.equal(h.controller.cancelTowerInitialStart({ sourceMessageId: 0, generationId: activeGenerationId }), true);
      assert.equal(h.controller.cancelTowerInitialStart({ sourceMessageId: 0 }), false);
      await rejected;
      assert.equal(h.controller.getTowerInitialPublicationStatus().busy, false);
      assert.ok(h.stoppedIds.length > 0);
      release();
      for (let i = 0; i < 10; i++) await new Promise(setImmediate);
      assert.deepEqual(h.variables, before);
      assert.equal(h.writes, 0); assert.equal(h.saves, 0);
      assert.equal(h.modelCalls, stage === 'narrative' ? 0 : 1, 'no automatic extra mechanism request');
      if (stage === 'mechanism') {
        await h.controller.startTowerSingleFloor(request);
        assert.equal(h.writes, 1, 'a player-started new operation is not poisoned');
        assert.notEqual(h.modelRequests[0].generation_id, h.modelRequests[1].generation_id);
      }
    });
  }
  await scenario('cancellation cannot interrupt authoritative commit', {
    beforeWrite: h => { assert.equal(h.controller.cancelTowerInitialStart({ sourceMessageId: 0 }), false); },
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.writes, 1); assert.ok(h.variables[receiptKey]);
    assert.equal(h.controller.cancelTowerInitialStart({ sourceMessageId: 0 }), false);
  });
  {
    const releases = [];
    await scenario('late cancelled result cannot publish into a newer start', {
      generate: () => new Promise(resolve => releases.push(resolve)),
    }, async h => {
      const first = h.controller.startTowerSingleFloor(request);
      const rejected = assert.rejects(first, /取消/);
      for (let i = 0; i < 30 && releases.length < 1; i++) await new Promise(setImmediate);
      assert.equal(releases.length, 1);
      const firstId = h.modelRequests[0].generation_id;
      await h.context.eventSource.emit('js_stream_token_received_fully', 'old', firstId);
      assert.equal(h.controller.cancelTowerInitialStart({ sourceMessageId: 0 }), true);
      await rejected;
      const cancelledDiagnostic = h.controller.getTowerGenerationDiagnostics().find(row => row.generationId === firstId);
      assert.equal(cancelledDiagnostic.outcome, 'cancelled');
      assert.equal(cancelledDiagnostic.structuredDelivery.streamMaxCharacters, 3);
      for (const event of ['js_stream_token_received_fully', 'js_generation_ended']) {
        assert.equal((h.listeners.get(event) || []).length, 0, 'initial cancellation immediately detaches delivery listeners');
      }
      const second = h.controller.startTowerSingleFloor(request);
      for (let i = 0; i < 30 && releases.length < 2; i++) await new Promise(setImmediate);
      assert.equal(releases.length, 2);
      const secondId = h.modelRequests[1].generation_id;
      await h.context.eventSource.emit('js_stream_token_received_fully', 'PRIVATE_LATE_OLD_OUTPUT', firstId);
      await h.context.eventSource.emit('js_generation_ended', 'PRIVATE_LATE_OLD_OUTPUT', firstId);
      await h.context.eventSource.emit('js_stream_token_received_fully', 'fresh', secondId);
      await h.context.eventSource.emit('js_generation_ended', 'fresh', secondId);
      releases[0]();
      for (let i = 0; i < 10; i++) await new Promise(setImmediate);
      assert.equal(h.writes, 0);
      assert.equal(h.controller.getTowerInitialPublicationStatus().busy, true);
      releases[1](); await second;
      assert.equal(h.writes, 1);
      assert.equal(h.modelCalls, 2, 'only the two explicit player starts');
      assert.equal(h.controller.getTowerInitialPublicationStatus().busy, false);
      const diagnostics = h.controller.getTowerGenerationDiagnostics().filter(row => row.nodeId === '__initial_mechanism');
      assert.equal(diagnostics.length, 2);
      assert.deepEqual(diagnostics.find(row => row.generationId === firstId), cancelledDiagnostic,
        'late response and events cannot mutate a cancelled initial diagnostic');
      const completed = diagnostics.find(row => row.generationId === secondId);
      assert.equal(completed.outcome, 'returned');
      assert.equal(completed.structuredDelivery.streamMaxCharacters, 5);
      assert.equal(completed.structuredDelivery.endCharacters, 5);
      assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE_LATE_OLD_OUTPUT'));
      for (const event of ['js_stream_token_received_fully', 'js_generation_ended']) {
        assert.equal((h.listeners.get(event) || []).length, 0, 'new initial completion also detaches listeners');
      }
    });
  }
  for (const protocol of ['canonical','registry-draft']) await scenario(`${protocol} publication preserves chat-scope preset and user variables`, {
    protocol,
    structured:()=>{
      const value=fixture();if(protocol==='canonical')return JSON.stringify(value);
      delete value.narrative;delete value.player.statuses;
      return {spec:'mwg.initial-draft/v1',...value,registry:{statuses:[],resources:[],templates:[]}};
    },
    generate:h=>{h.context.chatMetadata.variables.preset_test = 'set during current authoring';},
    save:h=>{h.disk=[{chat_metadata:structuredClone(h.context.chatMetadata)},
      {...h.context.chat[0],variables:[structuredClone(h.variables)]}];},
    verify:async(h,expected)=>{
      h.checkedChatCache=expected.requireChatCache;
      await verifyTowerInitialPersistence({...h.context,characters:[{avatar:'fixture.png',chat:h.context.chatId}],getRequestHeaders:()=>({})},
        expected,async()=>({ok:true,json:async()=>h.disk}));
    },
  },async h=>{
    const userVariables={user_owned:{flags:['keep',false],counter:17},preset_test:'previous turn',
      collision:{stat_data:'ordinary nested field'},empty:null};
    h.context.chatMetadata.variables=structuredClone(userVariables);
    await h.controller.startTowerSingleFloor(request);
    const expected={...userVariables,preset_test:'set during current authoring'};
    assert.equal(h.context.chatMetadata.variables.user_owned?.counter,17,'publication must not erase unrelated user variables');
    assert.deepEqual(h.context.chatMetadata.variables,expected);
    assert.deepEqual(h.disk[0].chat_metadata.variables,expected);
    assert.equal(h.cacheWrites,0);assert.equal(h.writes,1);assert.equal(h.modelCalls,1);
    assert.equal(h.checkedChatCache,false,'publication does not require a disposable chat mirror');
    assert.ok(h.variables[receiptKey]);assert.ok(h.context.chatMetadata[publicationKey]);
    h.context.chatMetadata.variables.user_owned.counter=18;
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.context.chatMetadata.variables.user_owned.counter,18);
    assert.equal(h.cacheWrites,0);assert.equal(h.writes,1);assert.equal(h.modelCalls,1);
  });
  let encodedContainerBattle;
  let encodedContainerOpening;
  for (const first of ['valid', 'empty', 'invalid']) await scenario(`default text delivery ${first} preserves full commit and bounded repair`, {
    protocol:'registry-draft',realTransport:true,
    structured:h=>h.modelCalls===1&&first!=='valid'?(first==='empty'?'':'not JSON'):
      JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-encoded-containers.json'),'utf8')).rawArguments,
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls,1);assert.equal(h.modelCalls,first==='valid'?1:2);assert.equal(h.writes,1);
    for(const sent of h.helperRequests){
      for(const key of ['json_schema','tools','tool_choice','custom_api','deepseek_thinking_mode','structured_delivery'])
        assert.equal(Object.hasOwn(sent,key),false,`default helper request contains ${key}`);
      assert.ok(sent.ordered_prompts.some(p=>typeof p==='object'&&p.content.includes('[MWG_SCHEMA_COMPATIBILITY/v1]')));
    }
    assert.ok(h.variables[receiptKey]);
  });
  await scenario('real sample33 encoded object containers retain original data and pass the full guarded commit', {
    protocol:'registry-draft',realTransport:true,
    structured:()=>JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-encoded-containers.json'),'utf8')).rawArguments,
  },async h=>{
    const raw=JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-encoded-containers.json'),'utf8')).rawArguments;
    const reported=[];globalThis.MagicGirlWorldMvuMonitor={beginStructuredOperation(){},
      applyStructuredOperation:event=>reported.push(structuredClone(event)),completeStructuredOperation(){},fail(){}};
    try{
      await h.controller.startTowerSingleFloor(request);
      assert.equal(h.modelCalls,1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
      assert.ok(h.variables[receiptKey]);assert.ok(reported.some(e=>e.rawOutput===raw),'monitor retains exact returned bytes before decoding');
      const encoded=JSON.parse(raw),authored=JSON.parse(encoded.player),actual=h.variables.stat_data.battle;
      assert.deepEqual(actual.core,{...authored.core,resources:JSON.parse(encoded.registry).resources});
      assert.equal(actual.cards.length,authored.cards.length);
      assert.equal(actual.cards.reduce((n,c)=>n+c.quantity,0),authored.cards.reduce((n,c)=>n+c.quantity,0));
      for(let i=0;i<authored.cards.length;i++)for(const key of ['id','name','description','cost','quantity'])
        assert.deepEqual(actual.cards[i][key],authored.cards[i][key]);
      encodedContainerBattle=structuredClone(actual);encodedContainerOpening=structuredClone(h.variables.stat_data.run.opening.content);
      await h.controller.startTowerSingleFloor(request);assert.equal(h.modelCalls,1);assert.equal(h.writes,1);
    }finally{globalThis.MagicGirlWorldMvuMonitor=previousMonitor;}
  });
  await scenario('the exact sample33 as ordinary object containers produces identical complete content', {
    protocol:'registry-draft',structured:()=>{
      const parsed=JSON.parse(JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-encoded-containers.json'),'utf8')).rawArguments);
      return {...parsed,...Object.fromEntries(['player','opening','registry'].map(k=>[k,JSON.parse(parsed[k])]))};
    },
  },async h=>{
    await h.controller.startTowerSingleFloor(request);assert.equal(h.writes,1);assert.equal(h.modelCalls,1);
    assert.deepEqual(h.variables.stat_data.battle,encodedContainerBattle);
    assert.deepEqual(h.variables.stat_data.run.opening.content,encodedContainerOpening);
  });
  await scenario('encoded containers after empty recovery use the same single extra request and unchanged full content', {
    protocol:'registry-draft',realTransport:true,structured:h=>h.modelCalls===1?'':
      JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-encoded-containers.json'),'utf8')).rawArguments,
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.deepEqual(h.variables.stat_data.battle,encodedContainerBattle);
    assert.deepEqual(h.variables.stat_data.run.opening.content,encodedContainerOpening);
    assert.equal(h.modelRequests[1].empty_json_fallback,true);
    assert.deepEqual(h.helperRequests[0].tools,h.helperRequests[1].tools);
  });
  for(const fallback of [false,true])for(const [label,mutate] of [
    ['malformed inner JSON',d=>{d.player='{"core":';}],
    ['array instead of object',d=>{d.player='[]';}],
    ['ambiguous duplicate key',d=>{d.registry='{"statuses":[],"statuses":[{}],"templates":[],"resources":[]}';}],
    ['second encoded layer',d=>{d.player=JSON.stringify(d.player);}],
    ['wrong version',d=>{d.spec='wrong';}],
    ['unknown root field',d=>{d.unapproved='must not be dropped';}],
    ['narrative replacement',d=>{d.narrative='hijack established preset story';}],
    ['duplicate definition',d=>{const registry=JSON.parse(d.registry);registry.statuses.push(structuredClone(registry.statuses[0]));d.registry=JSON.stringify(registry);}],
  ])await scenario(`encoded container ${label} (${fallback?'fallback':'first'}) still cannot publish`,{
    protocol:'registry-draft',realTransport:true,structured:h=>{
      if(fallback&&h.modelCalls===1)return '';
      const d=JSON.parse(JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-encoded-containers.json'),'utf8')).rawArguments);
      mutate(d);return JSON.stringify(d);
    },
  },async h=>{
    const before=structuredClone(h.variables);await assert.rejects(h.controller.startTowerSingleFloor(request));
    assert.equal(h.modelCalls,fallback?2:1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,0);
    assert.equal(h.saves,0);assert.equal(h.cacheWrites,0);assert.deepEqual(h.variables,before);
  });
  await scenario('decoded object with missing AI core field still requires authoritative validation, never a default',{
    protocol:'registry-draft',realTransport:true,structured:()=>{
      const d=JSON.parse(JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-encoded-containers.json'),'utf8')).rawArguments);
      const player=JSON.parse(d.player);delete player.core.emoji;d.player=JSON.stringify(player);
      return JSON.stringify(d);
    },
  },async h=>{
    const before=structuredClone(h.variables);await assert.rejects(h.controller.startTowerSingleFloor(request));
    assert.ok(h.modelCalls<=2);assert.equal(h.writes,0);assert.deepEqual(h.variables,before);
  });
  for(const outcome of ['success','proxy_again','empty','missing_definition','cancel','chat_change'])await scenario(`ordinary text proxy recovery ${outcome} shares one mechanism budget`,{
    protocol:'registry-draft',customStreamTransport:true,
    structured:h=>{
      if(h.modelCalls===1){
        if(outcome==='cancel')h.controller.cancelTowerInitialStart({sourceMessageId:0});
        if(outcome==='chat_change')h.context.chatId='another';
        return readFileSync(resolve('scripts/fixtures/minimal-proxy-504.txt'),'utf8');
      }
      if(outcome==='proxy_again')return readFileSync(resolve('scripts/fixtures/minimal-proxy-504.txt'),'utf8');
      if(outcome==='empty')return '';
      const draft=JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-paper-discard.json'),'utf8'));
      if(outcome==='missing_definition')draft.registry.templates=[];
      return draft;
    },
  },async h=>{
    const before=structuredClone(h.variables),story=h.context.chat[0].mes;
    if(outcome==='success'){
      await h.controller.startTowerSingleFloor(request);assert.equal(h.writes,1);assert.ok(h.variables[receiptKey]);
      assert.equal(h.context.chat[0].mes.includes('Proxy error'),false);
    }else{
      await assert.rejects(h.controller.startTowerSingleFloor(request));
      assert.deepEqual([h.writes,h.cacheWrites,h.storyWrites,h.saves],[0,0,0,0]);
      assert.deepEqual(h.variables,before);assert.equal(h.context.chat[0].mes,story);
    }
    assert.equal(h.narrativeCalls,1);assert.equal(h.modelCalls,['cancel','chat_change'].includes(outcome)?1:2);
    if(h.modelCalls===2)assert.deepEqual(h.modelRequests[1],{...h.modelRequests[0],generation_id:h.modelRequests[1].generation_id},'same ordinary-text request, no model override');
    for(const wire of h.customWire)for(const key of ['json_schema','response_format','tools','tool_choice'])assert.equal(Object.hasOwn(wire,key),false,key);
  });
  for(const status of [401,402,403,400,418,429,503,undefined])await scenario(`initial transport HTTP ${status} recovery is bounded`,{
    protocol:'registry-draft',structured:h=>{
      if(h.modelCalls===1)throw new GenerationTransportError(classifyGenerationTransportFailure(status));
      return readFileSync(resolve('scripts/fixtures/initial-draft-paper-discard.json'),'utf8');
    },
  },async h=>{
    if([429,503].includes(status)){await h.controller.startTowerSingleFloor(request);assert.equal(h.modelCalls,2);assert.equal(h.writes,1);}
    else {await assert.rejects(h.controller.startTowerSingleFloor(request));assert.equal(h.modelCalls,1);assert.deepEqual([h.writes,h.cacheWrites,h.storyWrites,h.saves],[0,0,0,0]);}
  });
  await scenario('empty initial preset recovers once before a single authored draft and guarded commit', {
    protocol: 'registry-draft', narrativeRecovery: true,
    narrativeResponse: h => h.narrativeCalls === 1 ? '' : '你来到高塔，守门人请你选择馈赠。',
    structured: () => readFileSync(resolve('scripts/fixtures/initial-draft-paper-discard.json'), 'utf8'),
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls,2);assert.equal(h.modelCalls,1);assert.equal(h.writes,1);
    assert.equal(h.narrativeRequests[1].empty_narrative_fallback,true);assert.ok(h.variables[receiptKey]);
    await h.controller.startTowerSingleFloor(request);assert.equal(h.narrativeCalls,2);assert.equal(h.writes,1);
  });
  for(const outcome of ['success','empty','error','changed'])await scenario(`preset transient recovery ${outcome} preserves bounded publication`,{
    protocol:'registry-draft',narrativeRecovery:true,
    narrativeResponse:h=>{
      if(h.narrativeCalls===1){
        if(outcome==='changed')h.variables.stat_data.status.location='玩家的新位置';
        throw new GenerationTransportError(classifyGenerationTransportFailure(502));
      }
      if(outcome==='error')throw new GenerationTransportError(classifyGenerationTransportFailure(503));
      return outcome==='empty'?'':'原preset正文：守门人请你选择馈赠。';
    },structured:()=>readFileSync(resolve('scripts/fixtures/initial-draft-paper-discard.json'),'utf8'),
  },async h=>{
    if(outcome==='success'){
      await h.controller.startTowerSingleFloor(request);assert.equal(h.writes,1);assert.equal(h.modelCalls,1);assert.ok(h.variables[receiptKey]);
      assert.deepEqual(h.narrativeRequests[1],{...h.narrativeRequests[0],generation_id:h.narrativeRequests[1].generation_id});
      await h.controller.startTowerSingleFloor(request);assert.equal(h.writes,1);
    }else{
      await assert.rejects(h.controller.startTowerSingleFloor(request));assert.equal(h.writes,0);assert.equal(h.modelCalls,0);assert.equal(h.variables[receiptKey],undefined);
    }
    assert.equal(h.narrativeCalls,outcome==='changed'?1:2);
  });
  await scenario('both preset finals empty: no mechanism request, third narrative or partial publication', {
    protocol: 'registry-draft', narrativeRecovery: true, narrativeResponse: () => '',
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request),/剧情模型/);
    assert.equal(h.narrativeCalls,2);assert.equal(h.modelCalls,0);assert.equal(h.writes,0);assert.equal(h.variables[receiptKey],undefined);
  });
  await scenario('preset and mechanism each use their one empty recovery, then one authoritative commit', {
    protocol:'registry-draft',narrativeRecovery:true,realTransport:true,
    narrativeResponse:h=>h.narrativeCalls===1?'':'你来到高塔，守门人请你选择馈赠。',
    structured:h=>h.modelCalls===1?'':JSON.parse(readFileSync(resolve('scripts/fixtures/initial-tool-draft-response.json'),'utf8')).tool_calls[0].function.arguments,
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls,2);assert.equal(h.modelCalls,2);assert.equal(h.writes,1);assert.ok(h.variables[receiptKey]);
    await h.controller.startTowerSingleFloor(request);assert.equal(h.narrativeCalls+h.modelCalls,4);assert.equal(h.writes,1);
  });
  await scenario('player edit during empty preset prevents even the fallback request', {
    protocol: 'registry-draft', narrativeRecovery: true,
    narrativeResponse: h => {h.variables.stat_data.status.location='玩家的新位置';return '';},
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request),/变|取消/);
    assert.equal(h.narrativeCalls,1);assert.equal(h.modelCalls,0);assert.equal(h.writes,0);
  });
  await scenario('real paper-discard draft closes status templates without reauthoring or repair', {
    protocol: 'registry-draft',
    structured: () => readFileSync(resolve('scripts/fixtures/initial-draft-paper-discard.json'), 'utf8'),
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls, 1);
    assert.equal(h.modelCalls, 1, 'the exact recorded mechanism draft needs no model repair');
    assert.equal(h.writes, 1);
    assert.ok(h.variables[receiptKey]);
    const status = h.variables.stat_data.battle.statuses.find(entry => entry.id === 'trimming_stamp');
    assert.equal(status.creates[0].id, 'edge_scrap');
    assert.deepEqual(status.triggers.on_discard, { add_card: 'edge_scrap', to: 'hand', count: 1 });
    assert.equal(h.variables.stat_data.battle.cards.reduce((count, card) => count + card.quantity, 0), 12);
    assert.equal(h.variables.stat_data.battle.artifacts[0].id, 'paper_bobbin_kit');
  });
  await scenario('absent Curse cost normalizes before controller readiness without a repair call', {
    protocol: 'registry-draft',
    structured: () => {
      const draft = JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-paper-discard.json'), 'utf8'));
      const template = draft.registry.templates[0];
      template.type = 'Curse'; template.cost = null;
      delete template.effects;
      template.discard_effects = {draw: 1};
      return draft;
    },
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls, 1); assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
    const template = h.variables.stat_data.battle.statuses.find(entry => entry.id === 'trimming_stamp').creates[0];
    assert.equal(template.type, 'Curse'); assert.equal(Object.hasOwn(template, 'cost'), false);
    assert.deepEqual(template.discard_effects, {draw: 1});
    assert.ok(h.variables[receiptKey]);
  });
  await scenario('successful commit, duplicate retry and controller reload do not reauthor', {}, async h => {
    await Promise.all([h.controller.startTowerSingleFloor(request), h.controller.startTowerSingleFloor(request)]);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
    const initial = structuredClone(h.variables);
    assert.ok(initial[receiptKey]);
    h.controller.deactivate(); h.controller = h.makeController(); h.controller.activate();
    assert.equal((await h.controller.startTowerSingleFloor(request)).resumed, true);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
    assert.deepEqual(h.variables, initial);
  });
  await scenario('unavailable chat-cache API does not block message-owned publication', {
    cache:()=>{throw new Error('chat cache must not be called');},
  },async h=>{
    h.context.chatMetadata.variables={preset:'keep',user:{checkpoint:9}};
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.cacheWrites,0);assert.equal(h.writes,1);
    assert.deepEqual(h.context.chatMetadata.variables,{preset:'keep',user:{checkpoint:9}});
  });
  for (const stage of ['story', 'save', 'afterWrite']) {
    let fail = true;
    await scenario(`${stage} failure recovers the committed deck with zero new model calls`, {
      [stage]: () => { if (fail) { fail = false; throw new Error(`injected ${stage}`); } },
    }, async h => {
      h.context.chatMetadata.variables={user:{checkpoint:9},preset:'keep'};
      await assert.rejects(h.controller.startTowerSingleFloor(request), /injected/);
      assert.equal(h.writes, 1); assert.ok(h.variables[receiptKey]);
      assert.deepEqual(h.context.chatMetadata.variables,{user:{checkpoint:9},preset:'keep'});
      h.context.chatMetadata.variables.user.checkpoint=10;
      const committed = structuredClone(h.variables);
      h.controller.deactivate(); h.controller = h.makeController(); h.controller.activate();
      await h.controller.startTowerSingleFloor(request);
      assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
      assert.deepEqual(h.variables, committed);
      assert.match(h.context.chat[0].mes, /守门人/);
      assert.equal(h.cacheWrites,0);
      assert.deepEqual(h.context.chatMetadata.variables,{user:{checkpoint:10},preset:'keep'});
    });
  }
  await scenario('failure before authoritative write can retry safely', {
    beforeWrite: h => { if (h.modelCalls === 1) throw new Error('write unavailable'); },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /write unavailable/);
    assert.equal(h.writes, 0); assert.equal(h.variables[receiptKey], undefined);
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.writes, 1);
  });
  for (const [label, mutate] of [
    ['same-floor variables', h => { h.variables.stat_data.status.location = '玩家修改的位置'; }],
    ['root metadata', h => { h.variables.display_data = { changed: true }; }],
    ['manual story edit', h => { h.context.chat[0].mes = '玩家编辑后的正文'; }],
    ['swipe', h => { h.context.chat[0].swipe_id = 1; }],
    ['chat switch', h => { h.context.chatId = 'another'; }],
    ['chat ABA switch', async h => { h.context.chatId = 'another'; await h.context.eventSource.emit('chat_id_changed'); h.context.chatId = 'commit-chat'; }],
  ]) await scenario(`${label} while authoring prevents stale write`, { generate: mutate }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /变化|旧结果/);
    assert.equal(h.writes, 0); assert.equal(h.cacheWrites, 0); assert.equal(h.storyWrites, 0);
  });
  await scenario('chat changes after commit: no cache/story dispatch', {
    afterWrite: h => { h.context.chatId = 'another'; },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /切换|变化/);
    assert.equal(h.writes, 1); assert.equal(h.cacheWrites, 0); assert.equal(h.storyWrites, 0);
  });
  await scenario('state changes during story rendering: no stale save or publication', {
    story: h => { h.variables.stat_data.run.stateRevision++; },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /进度已变化/);
    assert.equal(h.writes, 1); assert.equal(h.storyWrites, 1);assert.equal(h.saves,0);assert.equal(h.cacheWrites,0);
  });
  await scenario('message-root metadata changes during story rendering prevent stale save', {
    story:h=>{h.variables.user_owned_message_note={changed:'during rendering'};},
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),/进度已变化/);
    assert.equal(h.writes,1);assert.equal(h.saves,0);assert.equal(h.cacheWrites,0);
    assert.deepEqual(h.variables.user_owned_message_note,{changed:'during rendering'});
    assert.equal(h.context.chatMetadata[publicationKey],undefined);
  });
  await scenario('fresh initial commit through Act 2 accepts new opening identity without replay', {}, async h => {
    const { enterRunNode, completeRunNode, validateRunState } = require(resolve('src/game-core/runState.ts'));
    const { consumeTowerOpening } = require(resolve('src/game-core/towerOpeningState.ts'));
    const { queueTowerOpeningInStat, claimTowerOpeningInStat } = require(resolve('src/runtime/towerOpeningAdapter.ts'));
    await h.controller.startTowerSingleFloor(request);
    const initialReceipt = structuredClone(h.variables[receiptKey]);
    let run = h.variables.stat_data.run;
    run = { ...run, opening: consumeTowerOpening(run.opening).opening };
    while (run.act === 1) {
      assert.ok(run.choices.length, 'fresh map has a reachable next room');
      run = completeRunNode(enterRunNode(run, run.choices[0].id), { outcome: 'cleared' });
      assert.equal(validateRunState(run).ok, true);
    }
    assert.equal(run.act, 2); assert.equal(run.opening.requestId, null);
    h.variables.stat_data.run = run;
    h.context.chat[0].mes = '第二幕当前剧情，不得被开局覆盖';
    h.context.chat[0].swipe_id = 2;
    // A new revision may refresh chat activity metadata; that is not initial-state replay.
    const counts = [h.modelCalls, h.writes, h.cacheWrites, h.storyWrites];
    for (const phase of ['pending', 'queued', 'generating']) {
      if (phase === 'queued') queueTowerOpeningInStat(h.variables.stat_data);
      if (phase === 'generating') claimTowerOpeningInStat(h.variables.stat_data);
      assert.notEqual(h.variables.stat_data.run.opening.requestId, initialReceipt.openingRequestId);
      assert.equal(h.controller.getTowerInitialPublicationStatus().ready, true, phase);
      const before = structuredClone(h.variables);
      await h.controller.resumeTowerInitialCommit();
      assert.deepEqual(h.variables, before, 'resume cannot replay the initial state');
      assert.equal(h.context.chat[0].mes, '第二幕当前剧情，不得被开局覆盖');
      assert.deepEqual([h.modelCalls, h.writes, h.cacheWrites, h.storyWrites], counts);
    }
    h.controller.deactivate(); h.controller = h.makeController(); h.controller.activate();
    assert.equal(h.controller.getTowerInitialPublicationStatus().ready, true, 'reload remains unblocked');
    assert.deepEqual(h.variables[receiptKey], initialReceipt);
  });
  await scenario('advanced save retry preserves newer story and state', {}, async h => {
    await h.controller.startTowerSingleFloor(request);
    h.variables.stat_data.run.stateRevision++;
    h.variables.stat_data.run.opening.phase = 'consumed';
    h.variables.stat_data.battle.core.hp = 23;
    h.context.chat[0].mes = '已经进入新的剧情';
    const advanced = structuredClone(h.variables);
    const previous = [h.cacheWrites, h.storyWrites, h.saves];
    await h.controller.startTowerSingleFloor(request);
    assert.deepEqual(h.variables, advanced);
    assert.deepEqual([h.cacheWrites, h.storyWrites, h.saves], previous);
    assert.equal(h.context.chat[0].mes, '已经进入新的剧情');
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
  });
  for (const kind of ['missing', 'mismatched', 'message-mismatched', 'corrupt']) await scenario(`${kind} receipt cannot reroll an established save`, {}, async h => {
    await h.controller.startTowerSingleFloor(request);
    if (kind === 'missing') delete h.variables[receiptKey];
    if (kind === 'mismatched') h.variables[receiptKey].chatId = 'another';
    if (kind === 'message-mismatched') h.variables[receiptKey].messageId = 1;
    if (kind === 'corrupt') h.variables[receiptKey] = null;
    await assert.rejects(h.controller.startTowerSingleFloor(request), /凭据|已经建立开局/);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
  });
  await scenario('silent partial MVU write is not claimed successful', {
    afterWrite: h => { h.variables.stat_data.battle.core.hp = 1; },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /完整状态未得到确认/);
    assert.equal(h.cacheWrites, 0); assert.equal(h.storyWrites, 0);
    assert.equal(h.modelCalls, 1);
    await assert.rejects(h.controller.startTowerSingleFloor(request), /数据摘要不匹配/);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
  });
  assert.equal(towerInitialStateKey({ b: 2, a: [1, { z: 3, y: 4 }] }), towerInitialStateKey({ a: [1, { y: 4, z: 3 }], b: 2 }));
  const registryFixture = () => {
    const value = fixture();
    delete value.narrative; delete value.player.statuses;
    return { spec: 'mwg.initial-draft/v1', ...value, registry: { statuses: [], resources: [], templates: [] } };
  };
  const missingStatusFixture = () => {
    const value = registryFixture();
    value.player.cards[0].effects = [{ apply_status: 'starlight', stacks: 1, to: 'self' }, { damage: 6 }];
    return value;
  };
  for (const invalidRoot of [null, undefined, []]) for (const outcome of ['valid', 'missing-definition', 'erase-condition', 'rewrite-story']) {
    const rootDraft=registryFixture();rootDraft.registry=invalidRoot;
    rootDraft.player.cards[0].effects=[{damage:6,resource:{id:'spark',amount:1},when:'self.hp > 0'}];
    await scenario(`registry root plus rule repair full publication: ${String(invalidRoot)} / ${outcome}`, {
      protocol:'registry-draft',realTransport:true,structured:h=>{
        assert.ok(h.modelCalls<=2,'shared repair budget must prevent a third request');
        if(h.modelCalls===1)return JSON.stringify(rootDraft);
        const schema=h.modelRequests.at(-1).json_schema;
        assert.equal(schema.name,'mwg_initial_joint_repair');
        const roots=schema.value.properties.rules.properties.roots.properties;
        const response={spec:'mwg.initial-joint-repair/v1',
          registry:{spec:'mwg.initial-draft-registry-repair/v1',additions:{}},
          source:{replacements:Object.fromEntries(Object.keys(schema.value.properties.source.properties.replacements.properties).map(token=>[token,{
            statuses:[],templates:[],resources:outcome==='missing-definition'?[]:[{id:'spark',name:'星火',emoji:'✨',start:0,max:3,refresh:'retain'}],
          }]))},
          rules:{spec:'mwg.tower-initial-slot-repair/v1',support_statuses:[],support_resources:[],
            roots:Object.fromEntries(Object.entries(roots).map(([token,root])=>[token,{slots:Object.fromEntries(Object.keys(root.properties.slots.properties).map(slot=>[slot,{
              action:'replace_sequence',value:[{damage:6,when:'self.hp > 0'},{resource:{id:'spark',amount:1},when:'self.hp > 0'}],
            }]))}]))}};
        // The schema owns the operation; this fixture must not guess it.
        for(const [token,root] of Object.entries(roots))for(const [slot,definition] of Object.entries(root.properties.slots.properties))
          response.rules.roots[token].slots[slot].action=definition.properties.action.const;
        if(outcome==='erase-condition')for(const root of Object.values(response.rules.roots))for(const slot of Object.values(root.slots))delete slot.value[0].when;
        if(outcome==='rewrite-story')response.narrative='替换既定剧情';
        return '修复结果：\n```json\n'+JSON.stringify(response)+'\n```';
      },
    },async h=>{
      const before=structuredClone(h.variables),messageBefore=h.context.chat[0].mes;
      if(outcome==='valid'){
        await h.controller.startTowerSingleFloor(request);
        assert.equal(h.writes,1);
        assert.equal(h.variables.stat_data.battle.cards[0].effects.length,2);
        assert.deepEqual(h.variables.stat_data.battle.cards[0].effects,[{damage:6,when:'self.hp > 0'},{resource:{id:'spark',amount:1},when:'self.hp > 0'}]);
        assert.match(h.context.chat[0].mes,/黎明之塔/);
      }else{
        await assert.rejects(h.controller.startTowerSingleFloor(request));
        assert.equal(h.writes,0);assert.equal(h.cacheWrites,0);assert.equal(h.storyWrites,0);assert.equal(h.saves,0);
        assert.deepEqual(h.variables,before);assert.equal(h.context.chat[0].mes,messageBefore);
      }
      assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);
      assert.ok(h.helperRequests.every(config=>!Object.hasOwn(config,'json_schema')&&!Object.hasOwn(config,'tools')));
    });
  }
  const malformedTemplateFixture = () => {
    const value=registryFixture();
    value.player.cards[0].effects=[{damage:6},{add_card:'scrap'}];
    value.registry.templates=[{id:'scrap',name:'残页',type:'Curse',rarity:'Common',cost:1,
      description:'不可打出。弃牌时抽1张牌。',effects:{add_card:{id:'scrap',name:'残页',type:'Curse',rarity:'Common',effects:{draw:1}}},discard_effects:{draw:1}}];
    return value;
  };
  for(const mode of ['valid','unchanged','erase-discard','change-description','new-reference','budget-spent'])await scenario(`bounded template repair ${mode}`,{
    protocol:'registry-draft',structured:h=>{
      if(mode==='budget-spent')return h.modelCalls===1?'':malformedTemplateFixture();
      if(h.modelCalls===1)return malformedTemplateFixture();
      const template=malformedTemplateFixture().registry.templates[0];delete template.cost;
      if(mode!=='unchanged')delete template.effects;
      if(mode==='erase-discard')delete template.discard_effects;
      if(mode==='change-description')template.description='风味';
      if(mode==='new-reference')template.effects={add_card:'missing'};
      return {spec:'mwg.initial-template-repair/v1',replacements:{t0:template}};
    },
  },async h=>{
    if(mode==='valid'){
      await h.controller.startTowerSingleFloor(request);assert.equal(h.writes,1);assert.ok(h.variables[receiptKey]);
      const template=h.variables.stat_data.battle.cards[0].creates[0];assert.deepEqual(template.discard_effects,{draw:1});
      assert.equal(Object.hasOwn(template,'cost'),false);assert.equal(Object.hasOwn(template,'effects'),false);
      assert.deepEqual(h.variables.stat_data.battle.cards[0].effects,malformedTemplateFixture().player.cards[0].effects);
    }else{await assert.rejects(h.controller.startTowerSingleFloor(request));assert.equal(h.writes,0);assert.equal(h.variables[receiptKey],undefined);}
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);
    if(mode!=='budget-spent')assert.equal(h.modelRequests[1].json_schema.name,'mwg_initial_draft_template_repair');
  });
  await scenario('registry missing fixed spec is supplied by the request protocol, not reauthored',{
    protocol:'registry-draft',structured:()=>{const d=registryFixture();delete d.spec;return d;},
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects,{damage:6});
  });
  for(const version of ['mwg.initial-draft/v2','',null])await scenario(`registry explicit wrong spec ${version} is never replaced`,{
    protocol:'registry-draft',structured:()=>({...registryFixture(),spec:version}),
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),/INVALID_DRAFT/);
    assert.equal(h.modelCalls,1);assert.equal(h.writes,0);
  });
  await scenario('recorded sample16 mechanisms need only the omitted technical version, no model repair',{
    protocol:'registry-draft',structured:()=>readFileSync(resolve('scripts/fixtures/initial-draft-summon-missing-spec.json'),'utf8'),
  },async h=>{
    // Real mechanism draft, isolated narrative/host fixture. This is not a
    // repaired live save, new model sample, or narrative-semantic acceptance.
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.ok(h.variables[receiptKey]);
  });
  const toolEnvelope = JSON.parse(readFileSync(resolve('scripts/fixtures/initial-tool-draft-response.json'), 'utf8'));
  const recordedPileDraft = JSON.parse(readFileSync(resolve('scripts/fixtures/initial-draft-player-pile-self.json'), 'utf8'));
  for (const firstEmpty of [false, true]) await scenario(`custom text delivery preserves thinking and exact controller budget; first empty=${firstEmpty}`, {
    protocol:'registry-draft',customStreamTransport:true,customStructuredThinking:true,
    structured:h=>firstEmpty&&h.modelCalls===1?'':structuredClone(recordedPileDraft),
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,firstEmpty?2:1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.equal(h.customWire.length,h.modelCalls);
    assert.ok(h.customWire.every(p=>!Object.hasOwn(p,'custom_include_body')&&!Object.hasOwn(p,'json_schema')));
    assert.ok(h.variables[receiptKey]);
    assert.equal(h.variables.stat_data.battle.core.hp,recordedPileDraft.player.core.hp);
  });
  for (const firstEmpty of [false, true]) await scenario(`recorded sample41 player draw receiver is representation-only; first empty=${firstEmpty}`, {
    protocol: 'registry-draft',
    structured: h => firstEmpty && h.modelCalls === 1 ? '' : structuredClone(recordedPileDraft),
  }, async h => {
    // Exact retained game draft, simulated narrative/host. Not a new live
    // success and not a rewrite of the failed user's save.
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls, firstEmpty ? 2 : 1);
    assert.equal(h.narrativeCalls, 1); assert.equal(h.writes, 1); assert.ok(h.variables[receiptKey]);
    const expected = structuredClone(recordedPileDraft.player.player_lust_effect);
    delete expected.effects[1].to;
    assert.deepEqual(h.variables.stat_data.battle.player_lust_effect, expected);
    assert.equal(h.variables.stat_data.battle.core.hp, recordedPileDraft.player.core.hp);
    assert.equal(h.variables.stat_data.battle.core.emoji, recordedPileDraft.player.core.emoji);
    assert.deepEqual(recordedPileDraft.player.player_lust_effect.effects[1], {draw:1,to:'self'});
  });
  await scenario('empty first final uses ordinary text recovery once and publishes through the real controller gates', {
    protocol: 'registry-draft', realTransport: true,
    structured: h => h.modelCalls === 1 ? '' : toolEnvelope.tool_calls[0].function.arguments,
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls, 2); assert.equal(h.narrativeCalls, 1); assert.equal(h.writes, 1);
    for(const sent of h.helperRequests)for(const key of ['tools','json_schema','custom_api','tool_choice'])assert.equal(Object.hasOwn(sent,key),false);
    assert.deepEqual(h.helperRequests[0].ordered_prompts.slice(1),h.helperRequests[1].ordered_prompts.slice(1),'same complete text contract; each attempt has its own identity marker');
    assert.ok(h.variables[receiptKey]);
    const published = structuredClone(h.variables);
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls, 2); assert.deepEqual(h.variables, published, 'duplicate does not generate or grant twice');
  });
  await scenario('captured Helper tool punctuation recovery preserves 13 cards and all three gifts through full publication gates', {
    protocol: 'registry-draft', realTransport: true,
    structured: h => h.modelCalls === 1 ? '' : JSON.parse(readFileSync(resolve('scripts/fixtures/initial-tool-draft-syntax-response.json'), 'utf8')).tool_calls[0].function.arguments,
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls, 2); assert.equal(h.narrativeCalls, 1); assert.equal(h.writes, 1);
    assert.equal(h.variables.stat_data.battle.cards.reduce((n,c)=>n+c.quantity,0),13);
    assert.ok(h.variables[receiptKey]);
  });
  for (const defect of ['wrong tool', 'invalid mechanics']) await scenario(`empty then ${defect} tool draft stops with no third request or partial write`, {
    protocol: 'registry-draft', realTransport: true,
    structured: h => {
      if (h.modelCalls === 1) return '';
      const bad = structuredClone(toolEnvelope);
      if (defect === 'wrong tool') bad.tool_calls[0].function.name = 'delete_save';
      else {
        const draft = JSON.parse(bad.tool_calls[0].function.arguments);
        draft.player.cards[0].effects = { damage: 5, hits: 0 };
        bad.tool_calls[0].function.arguments = JSON.stringify(draft);
      }
      return defect === 'wrong tool' ? bad : bad.tool_calls[0].function.arguments;
    },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /工具|INVALID_DRAFT|完整运行校验/);
    assert.equal(h.modelCalls, 2); assert.equal(h.writes, 0); assert.equal(h.variables[receiptKey], undefined);
    assert.equal(h.variables.stat_data.run, undefined);
  });
  for(const field of ['player','opening','registry'])await scenario(`registry missing gameplay root ${field} is not defaulted with the version`,{
    protocol:'registry-draft',structured:()=>{const d=registryFixture();delete d.spec;delete d[field];return d;},
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),/结构修复/);
    assert.equal(h.modelCalls,2);assert.equal(h.writes,0);
  });
  for(const field of ['player','opening','registry'])await scenario(`AI repairs missing ${field} through the text contract with valid siblings locked`,{
    protocol:'registry-draft',realTransport:true,structured:h=>{
      const d=registryFixture();
      if(h.modelCalls===1){delete d[field];return JSON.stringify(d);}
      return JSON.stringify({replacements:{e0:d[field]}});
    },
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.ok(h.variables[receiptKey]);
    assert.equal(h.modelRequests[1].json_schema.name,'mwg_initial_draft_envelope_repair');
    assert.ok(h.helperRequests.every(c=>!Object.hasOwn(c,'json_schema')&&!Object.hasOwn(c,'tools')));
  });
  await scenario('registry explicit owned card reference reaches protected publication without reauthoring', {
    protocol:'registry-draft',structured:()=>{
      const value=registryFixture();
      value.opening.choices[0].outcome={reward:{cards:[{card_ref:'strike',quantity:2}]}};
      return value;
    },
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.match(h.modelRequests[0].user_input,/card_ref/);
    assert.doesNotMatch(JSON.stringify(h.variables),/card_ref/,'draft-only reference never enters MVU');
    assert.equal(h.variables.stat_data.battle.cards.reduce((n,c)=>n+c.quantity,0),6,'gift is not acquired before selection');
    assert.ok(h.variables[receiptKey]);
  });
  await scenario('registry missing owned card reference neither invents a card nor consumes a repair request', {
    protocol:'registry-draft',structured:()=>{
      const value=registryFixture();value.opening.choices[0].outcome={reward:{cards:[{card_ref:'missing',quantity:1}]}};return value;
    },
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),/INVALID_REFERENCE/);
    assert.equal(h.modelCalls,1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,0);
  });
  const statusDefinition = () => ({ id: 'starlight', name: '星辉', emoji: '✨', type: 'buff', stacks_change: 'keep', triggers: { hold: [{ modify: 'block', add: 1 }] } });
  const repairResponse = definition => ({ spec: 'mwg.initial-draft-registry-repair/v1', additions: { r0: definition } });
  const badHitsFixture = () => {
    const value=registryFixture();value.player.cards[0].effects=[{damage:6,hits:0},{block:2}];return value;
  };
  const effectSlotResponse = (config,replacement={damage:6,hits:2}) => {
    const match=config.user_input.match(/REPAIR_SLOTS=(\{.*\})\nREPAIR_CONTEXT=/);
    assert.ok(match,'second mechanism request must contain fixed repair slots, not another full draft');
    const projection=JSON.parse(match[1]);
    return {spec:'mwg.tower-initial-slot-repair/v1',roots:Object.fromEntries(Object.entries(projection).map(([token,root])=>[
      token,{slots:Object.fromEntries(Object.entries(root.slots).map(([key,slot])=>[key,{action:slot.action,value:replacement}]))},
    ])),support_statuses:[],support_resources:[]};
  };
  for (const pressure of ['direct', 'existing-status']) for (const protocol of ['canonical', 'registry-draft']) for (const outcome of ['existing', 'repair', 'empty-repair', 'joint-repair', 'joint-empty-repair']) {
    const joint = outcome.startsWith('joint-');
    const empty = outcome.endsWith('empty-repair');
    if (protocol === 'canonical' && joint) continue;
    const value = joint ? missingStatusFixture()
      : protocol === 'registry-draft' ? registryFixture() : fixture();
    const payoff = { name: '星火满溢', effects: [{ damage: 8 }] };
    value.opening.choices[0].outcome = { reward: { cards: [{
      ...fixture().player.cards[0], id: 'lust_gift', quantity: 1, effects: [{ lust: 10, to: 'opponent' }],
    }] } };
    value.opening.choices[1].outcome = { reward: { items: [{
      id: 'lust_potion', name: '星火药剂', count: 1, effects: [{ lust: 5, to: 'opponent' }],
    }] } };
    if (pressure === 'existing-status') {
      const definition = { id: 'gift_pressure', name: '馈赠烙印', emoji: '◈', type: 'debuff', triggers: { tick: { lust: 3 } } };
      (protocol === 'registry-draft' ? value.registry.statuses : value.player.statuses).push(definition);
      value.opening.choices[0].outcome.reward.cards[0].effects = [{ apply_status: definition.id, stacks: 1, to: 'opponent' }];
      value.opening.choices[1].outcome.reward.items[0].effects = [{ apply_status: definition.id, stacks: 1, to: 'opponent' }];
    }
    if (outcome === 'existing') value.player.player_lust_effect = payoff;
    const authored = structuredClone(value);
    await scenario(`${protocol} gift-only lust owner context (${pressure}): ${outcome}`, {
      protocol, realTransport: protocol === 'registry-draft', structured: (h, config) => {
        assert.ok(h.modelCalls <= 2, 'owner repair shares the one extra mechanism request');
        if (h.modelCalls === 1) return value;
        const projection = JSON.parse(config.user_input.match(/^REPAIR_SLOTS=(.+)$/m)[1]);
        const slots = Object.values(projection).flatMap(root => Object.values(root.slots));
        assert.equal(slots.length, 1, 'two gifts share one player overflow slot');
        assert.equal(slots[0].kind, 'missing_lust_effect');
        const rules = effectSlotResponse(config, empty ? {} : payoff);
        const response = joint
          ? { spec: 'mwg.initial-joint-repair/v1', registry: repairResponse(statusDefinition()), rules }
          : rules;
        if (joint && !empty) {
          const validate = new Ajv2020({ strict: false }).compile(config.json_schema.value);
          assert.equal(validate(response), true, JSON.stringify(validate.errors));
          const inline = structuredClone(response);
          inline.registry.additions.r0.creates = [{ id: 'unapproved', name: '越界', type: 'Attack', rarity: 'Common', cost: 0, effects: { damage: 1 } }];
          assert.equal(validate(inline), false, 'rule definitions must not widen registry placement rules');
        }
        return response;
      },
    }, async h => {
      const before = structuredClone(h.variables);
      if (empty) {
        await assert.rejects(h.controller.startTowerSingleFloor(request));
        assert.equal(h.writes, 0); assert.equal(h.saves, 0);
        assert.deepEqual(h.variables, before);
      } else {
        await h.controller.startTowerSingleFloor(request);
        assert.equal(h.writes, 1);
        assert.deepEqual(h.variables.stat_data.battle.player_lust_effect, payoff);
        assert.deepEqual(h.variables.stat_data.battle.cards[0].effects, authored.player.cards[0].effects);
        assert.ok(h.variables[receiptKey]);
      }
      assert.equal(h.modelCalls, outcome === 'existing' ? 1 : 2);
      assert.equal(h.narrativeCalls, protocol === 'registry-draft' ? 1 : 0);
      assert.deepEqual(value, authored, 'original gifts and player content stay intact');
    });
  }
  const timingFixture = (registry = true) => {
    const value = registry ? badHitsFixture() : fixture();
    if (!registry) value.player.cards[0].effects=[{damage:6,hits:0},{block:2}];
    value.player.artifacts=[{id:'start_guard',name:'起始护符',rarity:'Common',emoji:'🛡️',
      description:'每回合开始时，获得1点格挡。',trigger:{on:'battle_start',effects:{block:1}}}];
    return value;
  };
  const timingRepair = (config, on = 'turn_start') => {
    const projection=JSON.parse(config.user_input.match(/REPAIR_SLOTS=(\{.*\})\nREPAIR_CONTEXT=/)[1]);
    const kinds=Object.values(projection).flatMap(root=>Object.values(root.slots).map(slot=>slot.kind)).sort();
    assert.deepEqual(kinds,['effect_item','trigger_on'],'semantic and structural faults must share the same request');
    return {spec:'mwg.tower-initial-slot-repair/v1',roots:Object.fromEntries(Object.entries(projection).map(([token,root])=>[
      token,{slots:Object.fromEntries(Object.entries(root.slots).map(([key,slot])=>[key,{action:slot.action,
        value:slot.kind==='trigger_on'?on:{damage:6,hits:2}}]))},
    ])),support_statuses:[],support_resources:[]};
  };
  for (const protocol of ['registry-draft','canonical']) await scenario(`${protocol} timing contradiction joins structural repair before its single extra request`, {
    protocol, structured:(h,config)=>h.modelCalls===1?timingFixture(protocol==='registry-draft'):timingRepair(config),
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,protocol==='registry-draft'?1:0);assert.equal(h.writes,1);
    assert.deepEqual(h.variables.stat_data.battle.artifacts[0],{...timingFixture().player.artifacts[0],trigger:{on:'turn_start',effects:{block:1}}});
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects,[{damage:6,hits:2},{block:2}]);
    assert.deepEqual(h.variables.stat_data.run.opening.content.choices,fixture().opening.choices);
    await h.controller.startTowerSingleFloor(request);assert.equal(h.modelCalls,2);assert.equal(h.writes,1);
  });
  await scenario('valid repair JSON that preserves a known timing contradiction cannot publish or request again', {
    protocol:'registry-draft',structured:(h,config)=>h.modelCalls===1?timingFixture():timingRepair(config,'battle_start'),
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),/EXPLICIT_TRIGGER_TIMING_MISMATCH/);
    assert.equal(h.modelCalls,2);assert.equal(h.writes,0);assert.equal(h.variables[receiptKey],undefined);
  });
  await scenario('empty transport fallback cannot append a third request for a discovered timing contradiction', {
    protocol:'registry-draft',structured:h=>h.modelCalls===1?'':timingFixture(),
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),/EXPLICIT_TRIGGER_TIMING_MISMATCH/);
    assert.equal(h.modelCalls,2);assert.equal(h.writes,0);assert.equal(h.variables[receiptKey],undefined);
  });
  await scenario('registry nonempty structure error uses exactly one bounded slot repair', {
    protocol:'registry-draft',structured:(h,config)=>h.modelCalls===1?badHitsFixture():effectSlotResponse(config),
  },async h=>{
    const result=await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.equal(h.modelRequests[1].json_schema.name,'mwg_tower_initial_slot_repair');
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects,[{damage:6,hits:2},{block:2}]);
    assert.deepEqual(h.variables.stat_data.run.opening.content.choices,fixture().opening.choices);
    assert.equal(h.variables[receiptKey].narrative,'在黎明之塔入口，你以星火旅者的身份面对守门人。请选择馈赠。');
    assert.equal(result.resumed,false);
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.writes,1,'repeat publication must not reauthor');
  });
  for(const [label,first,second,errorPattern] of [
    ['empty fallback already consumed',()=>'',()=>badHitsFixture(),/完整运行校验/],
    ['legacy definition-only reply to joint request',()=>{const d=badHitsFixture();d.player.cards[1]={...fixture().player.cards[0],id:'missing_status',effects:{apply_status:'starlight',stacks:1}};return d;},()=>repairResponse(statusDefinition()),/联合修正格式/],
  ])await scenario(`registry ${label} cannot append a third structural request`,{
    protocol:'registry-draft',structured:h=>h.modelCalls===1?first():second(),
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),errorPattern);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,0);
  });
  await scenario('joint registry and existing rule repair publish once with one extra mechanism request',{
    protocol:'registry-draft',structured:(h,config)=>{
      if(h.modelCalls===1){const d=badHitsFixture();d.player.cards[1]={...fixture().player.cards[0],id:'missing_status',effects:{apply_status:'starlight',stacks:1}};return d;}
      assert.match(config.generation_id,/__joint_repair$/);
      return {spec:'mwg.initial-joint-repair/v1',registry:repairResponse(statusDefinition()),rules:effectSlotResponse(config)};
    },
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects,[{damage:6,hits:2},{block:2}]);
    assert.ok(h.variables.stat_data.battle.statuses.some(status=>status.id==='starlight'));
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.writes,1);
  });
  await scenario('registry mixed effect repair publishes every operation while preserving adjacent effects',{
    protocol:'registry-draft',thinkingMode:'disabled',structured:(h,config)=>{
      if(h.modelCalls===1){const d=registryFixture();d.registry.resources=[{id:'charge',name:'充能',emoji:'✨',start:1,max:5,refresh:'retain'}];
        d.player.cards[0].effects=[{damage:6,resource:{id:'charge',amount:1},to:'self'},{block:2}];return d;}
      return effectSlotResponse(config,[{damage:6,to:'opponent'},{resource:{id:'charge',amount:1},to:'self'}]);
    },
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects,[{damage:6,to:'opponent'},{resource:{id:'charge',amount:1},to:'self'},{block:2}]);
    assert.equal(h.variables.stat_data.battle.core.resources[0].id,'charge');
    assert.ok(h.modelRequests.every(config=>config.deepseek_thinking_mode===undefined&&config.structured_delivery==='text-json'));
    assert.ok(h.narrativeRequests.every(config=>config.deepseek_thinking_mode===undefined));
  });
  await scenario('registry gift-only structure repair preserves initial deck and does not grant the gift',{
    protocol:'registry-draft',structured:(h,config)=>{
      if(h.modelCalls===1){const d=registryFixture();d.opening.choices[0].outcome={reward:{cards:[{...fixture().player.cards[0],id:'gift',quantity:1,effects:[{damage:6,hits:0},{block:2}]}]}};return d;}
      return effectSlotResponse(config);
    },
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.writes,1);
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects,{damage:6});
    assert.ok(h.variables.stat_data.battle.cards.every(card=>card.id==='strike'));
    assert.deepEqual(h.variables.stat_data.run.opening.content.choices[0].outcome.reward.cards[0].effects,[{damage:6,hits:2},{block:2}]);
  });
  for(const [label,response] of [
    ['empty',()=> ''],['invalid',config=>effectSlotResponse(config,{damage:6,hits:0})],
    ['out-of-scope narrative',config=>({...effectSlotResponse(config),narrative:'replace story'})],
    ['new missing reference',config=>effectSlotResponse(config,{apply_status:'brand_new',stacks:1})],
  ])await scenario(`registry final slot repair ${label} stops at two requests`,{
    protocol:'registry-draft',structured:(h,config)=>h.modelCalls===1?badHitsFixture():response(config),
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request));
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,0);
  });
  for(const [label,mutate] of [
    ['chat',h=>{h.context.chatId='elsewhere';}],
    ['swipe',h=>{h.context.chat[0].swipe_id=1;}],
    ['story',h=>{h.context.chat[0].mes='new story';}],
    ['MVU',h=>{h.variables.stat_data.external_change=true;}],
    ['ABA',async h=>{h.context.chatId='elsewhere';await h.context.eventSource.emit('chat_id_changed');h.context.chatId='commit-chat';await h.context.eventSource.emit('chat_id_changed');}],
  ])await scenario(`registry bounded structure repair rejects concurrent ${label} change`,{
    protocol:'registry-draft',generate:async h=>{if(h.modelCalls===2)await mutate(h);},
    structured:(h,config)=>h.modelCalls===1?badHitsFixture():effectSlotResponse(config),
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),/变化|切换/);
    assert.equal(h.modelCalls,2);assert.equal(h.writes,0);
  });
  await scenario('unparseable draft uses the shared repair with full contract and unchanged preset', {
    protocol:'registry-draft',structured:h=>h.modelCalls===1?'not a JSON object':registryFixture(),
  }, async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.deepEqual(h.modelRequests[1].json_schema,h.modelRequests[0].json_schema);
    assert.ok(h.modelRequests[1].user_input.startsWith(h.modelRequests[0].user_input+'\n'));
    assert.match(h.modelRequests[1].generation_id,/__draft_format_repair$/);
  });
  for(const [label,response,error]of [
    ['missing definition',()=>missingStatusFixture(),/定义引用未闭合/],
    ['narrative replacement',()=>({...registryFixture(),narrative:'replacement'}),/重写/],
    ['bad JSON again',()=> 'still not an object',/合法 JSON/],
  ])await scenario(`format repair ${label} cannot publish or request a third call`,{
    protocol:'registry-draft',structured:h=>h.modelCalls===1?'not a JSON object':response(),
  },async h=>{
    await assert.rejects(h.controller.startTowerSingleFloor(request),error);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,0);assert.equal(h.saves,0);
  });
  for (const [label,output,error,stored] of [
    ['plain text', '生成暂时不可用', /文本 7 字符，没有 JSON 对象起始符/, ''],
    ['repairable malformed object', '{"player":@@@}', /INVALID_DRAFT/, '{"player":@@@}'],
  ]) await scenario(`registry ${label} output is diagnosed before parse, with no writes or excess retry`, {
    protocol:'registry-draft',structured:()=>output,
  }, async h => {
    const events=[];
    globalThis.MagicGirlWorldMvuMonitor={applyStructuredOperation:event=>events.push(event),fail() {}};
    try {
      await assert.rejects(h.controller.startTowerSingleFloor(request),error);
      assert.equal(h.modelCalls,label==='plain text'?2:1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,0);assert.equal(h.saves,0);
      assert.equal(events.length,1);assert.match(events[0].detail,new RegExp(`${output.length} 字符`));
      assert.equal(events[0].rawOutput,stored);
      assert.equal(h.context.chatMetadata[publicationKey],undefined);
    } finally { globalThis.MagicGirlWorldMvuMonitor=previousMonitor; }
  });
  for (const fallback of [false, true]) await scenario(`unparseable original argument text remains observable (${fallback ? 'after empty recovery' : 'first request'}) but cannot publish`, {
    protocol: 'registry-draft', realTransport: true,
    structured: h => fallback && h.modelCalls === 1 ? '' : '{"player":true false}',
  }, async h => {
    const events=[],errors=[],before=structuredClone(h.variables),chatBefore=structuredClone(h.context.chat);
    globalThis.MagicGirlWorldMvuMonitor={applyStructuredOperation:event=>events.push(event),fail:error=>errors.push(String(error))};
    try {
      await assert.rejects(h.controller.startTowerSingleFloor(request),/没有返回合法 JSON/);
      assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);
      assert.equal(events.length,fallback?2:1);
      assert.equal(events.at(-1).rawOutput,'{"player":true false}');
      assert.match(events.at(-1).detail,/21 字符/);
      assert.doesNotMatch(JSON.stringify({events,errors}),/PRIVATE_REASONING_MUST_NOT_BE_EXPORTED|tool_calls/);
      assert.deepEqual(h.variables,before);assert.deepEqual(h.context.chat,chatBefore);
      assert.equal(h.writes+h.cacheWrites+h.storyWrites+h.saves,0);
      assert.equal(h.context.chatMetadata[publicationKey],undefined);
      assert.equal(h.controller.getTowerInitialPublicationStatus().busy,false);
    } finally {globalThis.MagicGirlWorldMvuMonitor=previousMonitor;}
  });
  await scenario('empty initial draft uses one shared repair attempt without reauthoring the preset', {
    protocol: 'registry-draft', structured: h => h.modelCalls === 1 ? ' \n\t' : registryFixture(),
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls, 1); assert.equal(h.modelCalls, 2); assert.equal(h.writes, 1);
    const [first, second] = h.modelRequests;
    assert.equal(first.empty_json_fallback, undefined);
    assert.equal(second.empty_json_fallback, true);
    assert.notEqual(second.generation_id, first.generation_id);
    const { generation_id: firstId, ...firstConfig } = first;
    const { generation_id: secondId, empty_json_fallback, ...secondConfig } = second;
    assert.deepEqual(secondConfig, firstConfig, 'same complete schema, narrative, gameplay contract and sampling options');
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects, fixture().player.cards[0].effects);
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls, 2, 'published retry must not reauthor either response');
  });
  for (const [label, output, error] of [
    ['empty again', '', /空响应，0 字符/],
    ['missing definition', () => missingStatusFixture(), /定义引用未闭合/],
    ['invalid text', '暂不可用', /没有 JSON 对象起始符/],
  ]) await scenario(`empty initial fallback ${label} cannot spend a third request`, {
    protocol: 'registry-draft', structured: h => h.modelCalls === 1 ? '' : typeof output === 'function' ? output() : output,
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), error);
    assert.equal(h.narrativeCalls, 1); assert.equal(h.modelCalls, 2);
    assert.equal(h.writes, 0); assert.equal(h.saves, 0);
    assert.equal(h.variables[receiptKey], undefined);
    assert.equal(h.context.chatMetadata[publicationKey], undefined);
  });
  for (const attempt of [1, 2]) for (const [label, mutate] of [
    ['chat', h => { h.context.chatId = 'elsewhere'; }],
    ['state', h => { h.variables.stat_data.status.location = 'new location'; }],
    ['swipe', h => { h.context.chat[0].swipe_id = 1; }],
    ['story', h => { h.context.chat[0].mes = 'manually edited narrative'; }],
    ['ABA chat', async h => { h.context.chatId = 'elsewhere'; await h.context.eventSource.emit('chat_id_changed'); h.context.chatId = 'commit-chat'; }],
  ]) await scenario(`empty initial attempt ${attempt} stops after ${label} changes`, {
    protocol: 'registry-draft', generate: async h => { if (h.modelCalls === attempt) await mutate(h); },
    structured: h => h.modelCalls === 1 ? '' : registryFixture(),
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /切换|变化/);
    assert.equal(h.modelCalls, attempt); assert.equal(h.narrativeCalls, 1);
    assert.equal(h.writes, 0); assert.equal(h.saves, 0);
  });
  await scenario('initial request exceptions do not trigger an empty-response fallback', {
    protocol: 'registry-draft', generate: () => { throw new Error('provider unavailable'); },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /provider unavailable/);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 0);
  });
  await scenario('registry protocol uses current preset narrative and compact structured draft', {
    protocol: 'registry-draft', structured: () => registryFixture(),
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls, 1); assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
    assert.equal(h.narrativeRequests[0].preset_name, 'in_use');
    assert.equal(h.narrativeRequests[0].max_chat_history, 'all');
    assert.equal(h.modelRequests[0].max_chat_history, 0);
    assert.equal(h.modelRequests[0].json_schema.name, 'mwg_initial_draft');
    assert.equal(h.modelRequests[0].json_schema.value.properties.narrative, undefined);
    assert.ok(!h.modelRequests[0].json_schema.value.required.includes('narrative'));
    assert.match(h.modelRequests[0].user_input, /ESTABLISHED_NARRATIVE=.*黎明之塔/);
    assert.ok(h.modelRequests[0].user_input.includes(formatCompactEffectAuthoringContract('initial-draft')),
      'the complete current execution and lifetime contract reaches the author, not an obsolete heading');
    assert.match(h.context.chat[0].mes, /黎明之塔/);
    assert.equal(h.variables.stat_data.status.profession.name, '星火旅者');
    assert.equal(h.variables.stat_data.battle.core.hp, 60);
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects, fixture().player.cards[0].effects);
  });
  await scenario('filtered status wrapper cannot spend a repair that erases its first-per-turn condition', {
    protocol:'registry-draft', structured:()=>{
      const draft=registryFixture();
      draft.registry.statuses=[{id:'filtered_status',name:'首次',emoji:'✨',type:'buff',
        triggers:{attack_played:{scope:'turn',ordinal:'first',effects:{block:2}}}}];
      draft.player.cards.push({...fixture().player.cards[0],id:'apply_filtered',effects:{apply_status:'filtered_status',stacks:1,to:'self'}});
      return draft;
    },
  },async h=>{
    const before=structuredClone(h.variables);
    await assert.rejects(h.controller.startTowerSingleFloor(request),/安全修复槽|完整运行校验/);
    assert.equal(h.modelCalls,1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,0);
    assert.deepEqual(h.variables,before);
  });
  await scenario('legal structured first-per-turn listener still publishes without repair', {
    protocol:'registry-draft',structured:()=>{
      const draft=registryFixture();
      draft.player.artifacts=[{id:'first_attack',name:'先声',emoji:'✨',rarity:'Common',
        trigger:{on:'attack_played',scope:'turn',ordinal:'first',effects:{block:2}}}];
      return draft;
    },
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,1);assert.equal(h.writes,1);
    assert.deepEqual(h.variables.stat_data.battle.artifacts[0].trigger,
      {on:'attack_played',scope:'turn',ordinal:'first',effects:{block:2}});
  });
  await scenario('complex operation bundle repairs by AI-selected order within one extra request', {
    protocol:'registry-draft',structured:h=>{
      if(h.modelCalls===1){
        const draft=registryFixture();
        draft.player.cards.push({...fixture().player.cards[0],id:'empower',type:'Skill',effects:{
          modify_summon:{selector:{owner:'self',pick:'all',tags:['wisp']},stat:'max_hp',add:4},
          modify_summon_effect:{selector:{owner:'self',pick:'all',tags:['wisp']},stat:'damage',add:2},
        }});
        return draft;
      }
      assert.equal(h.modelCalls,2);
      const roots=h.modelRequests.at(-1).json_schema.value.properties.roots.properties;
      return {spec:'mwg.tower-initial-slot-repair/v1',support_statuses:[],support_resources:[],
        roots:Object.fromEntries(Object.entries(roots).map(([root,value])=>[root,{slots:Object.fromEntries(
          Object.entries(value.properties.slots.properties).map(([token,schema])=>[token,
            {action:'replace_effect',value:[...schema.properties.value.items.enum].reverse()}]))}]))};
    },
  },async h=>{
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
    assert.deepEqual(h.variables.stat_data.battle.cards.find(c=>c.id==='empower').effects,[
      {modify_summon_effect:{selector:{owner:'self',pick:'all',tags:['wisp']},stat:'damage',add:2}},
      {modify_summon:{selector:{owner:'self',pick:'all',tags:['wisp']},stat:'max_hp',add:4}},
    ]);
  });
  for (const empty of ['', ' \t\n']) {
    await scenario('empty optional overflow root condition needs no model repair', {
      protocol:'registry-draft', structured:h=>{
        assert.equal(h.modelCalls,1,'empty optional field must not trigger a repair call');
        const draft=registryFixture();
        draft.player.player_lust_effect={name:'星光溢出',description:'造成3点伤害。',when:empty,effects:{damage:3}};
        return draft;
      },
    },async h=>{
      await h.controller.startTowerSingleFloor(request);
      assert.equal(h.modelCalls,1);assert.equal(h.narrativeCalls,1);assert.equal(h.writes,1);
      assert.deepEqual(h.variables.stat_data.battle.player_lust_effect,
        {name:'星光溢出',description:'造成3点伤害。',effects:{damage:3}});
    });
  }
  for (const repairedCondition of ['skills_played_this_turn == 1', null, 'cards_played_this_turn == 1']) {
    await scenario(`exact first-Skill mismatch uses bounded condition repair: ${repairedCondition}`, {
      protocol:'registry-draft',structured:h=>{
        if(h.modelCalls===1){
          const draft=registryFixture();
          draft.registry.statuses=[{id:'first_skill',name:'技能护盾',emoji:'🛡️',type:'buff',stacks_change:'keep',
            description:'每回合首次打出技能牌时，获得3点格挡。',
            triggers:{skill_played:{block:3,to:'self',when:'cards_played_this_turn == 1'}}}];
          draft.player.cards.push({id:'activate_first_skill',name:'技能护盾',type:'Power',rarity:'Common',quantity:1,cost:1,effects:{apply_status:'first_skill',to:'self'}});
          return draft;
        }
        assert.equal(h.modelCalls,2);
        const roots=h.modelRequests.at(-1).json_schema.value.properties.roots.properties;
        assert.equal(Object.keys(roots).length,1);
        return {spec:'mwg.tower-initial-slot-repair/v1',support_statuses:[],support_resources:[],
          roots:Object.fromEntries(Object.entries(roots).map(([token,root])=>{
            assert.equal(Object.keys(root.properties.slots.properties).length,1);
            return [token,{slots:Object.fromEntries(Object.keys(root.properties.slots.properties).map(slot=>[slot,{action:'replace_value',value:repairedCondition}]))}];
          }))};
      },
    },async h=>{
      const before=structuredClone(h.variables);
      if(repairedCondition==='skills_played_this_turn == 1'){
        await h.controller.startTowerSingleFloor(request);
        assert.equal(h.writes,1);
        assert.deepEqual(h.variables.stat_data.battle.statuses[0].triggers,{skill_played:{block:3,to:'self',when:repairedCondition}});
        assert.equal(h.variables.stat_data.battle.statuses[0].description,'每回合首次打出技能牌时，获得3点格挡。');
      }else{
        await assert.rejects(h.controller.startTowerSingleFloor(request));
        assert.equal(h.writes,0);assert.deepEqual(h.variables,before);
      }
      assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);
    });
  }
  for (const originalCondition of ['欲望满溢时', 'opponent.lust >= opponent.lust_max']) {
  for (const condition of ['opponent.lust >= opponent.max_lust', null, '欲望满溢时']) {
    await scenario(`overflow condition leaf repair preserves transaction boundary: ${originalCondition} -> ${condition}`, {
      protocol:'registry-draft', structured:h=>{
        if(h.modelCalls===1){
          const draft=registryFixture();
          draft.player.player_lust_effect={name:'星光溢出',description:'敌人欲望满溢时造成3点伤害。',when:originalCondition,effects:{damage:3}};
          return draft;
        }
        assert.equal(h.modelCalls,2);
        assert.doesNotMatch(h.modelRequests.at(-1).user_input,/删除这个重复的 lust>=max_lust 条件/,'generic advice cannot override the locked condition slot');
        const roots=h.modelRequests.at(-1).json_schema.value.properties.roots.properties;
        assert.equal(Object.keys(roots).length,1);
        return {spec:'mwg.tower-initial-slot-repair/v1',support_statuses:[],support_resources:[],
          roots:Object.fromEntries(Object.entries(roots).map(([root,value])=>{
            assert.equal(Object.keys(value.properties.slots.properties).length,1);
            return [root,{slots:Object.fromEntries(Object.keys(value.properties.slots.properties).map(token=>
              [token,{action:'replace_value',value:condition}]))}];
          }))};
      },
    },async h=>{
      const before=structuredClone(h.variables);
      if(condition==='opponent.lust >= opponent.max_lust'){
        await h.controller.startTowerSingleFloor(request);
        assert.equal(h.writes,1);
        assert.deepEqual(h.variables.stat_data.battle.player_lust_effect,
          {name:'星光溢出',description:'敌人欲望满溢时造成3点伤害。',when:condition,effects:{damage:3}});
      }else{
        await assert.rejects(h.controller.startTowerSingleFloor(request));
        assert.equal(h.writes,0);assert.deepEqual(h.variables,before);
      }
      assert.equal(h.modelCalls,2);assert.equal(h.narrativeCalls,1);
    });
  }
  }
  await scenario('registry missing definition: exactly one typed repair, unchanged authored mechanics', {
    protocol: 'registry-draft', structured: h => h.modelCalls === 1 ? missingStatusFixture() : repairResponse(statusDefinition()),
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls, 1); assert.equal(h.modelCalls, 2); assert.equal(h.writes, 1);
    assert.equal(h.modelRequests[1].json_schema.name, 'mwg_initial_draft_registry_repair');
    assert.deepEqual(h.modelRequests[1].json_schema.value.properties.additions.required, ['r0']);
    assert.doesNotMatch(h.modelRequests[1].user_input, /AI 只输出 spec、player/);
    assert.deepEqual(h.variables.stat_data.battle.cards[0].effects, missingStatusFixture().player.cards[0].effects);
    assert.equal(h.variables.stat_data.battle.statuses[0].id, 'starlight');
    assert.match(h.context.chat[0].mes, /黎明之塔/);
  });
  await scenario('opt-in initial thinking mode applies to mechanisms and typed repair, never preset', {
    protocol: 'registry-draft', thinkingMode: 'disabled',
    structured: h => h.modelCalls === 1 ? missingStatusFixture() : repairResponse(statusDefinition()),
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls, 2); assert.equal(h.narrativeCalls, 1);
    assert.ok(h.modelRequests.every(config => config.deepseek_thinking_mode === undefined && config.structured_delivery === 'text-json'));
    assert.ok(h.narrativeRequests.every(config => config.deepseek_thinking_mode === undefined));
    assert.equal(h.narrativeRequests[0].preset_name, 'in_use');
  });
  await scenario('registry reward-only state is not acquired before gift choice', {
    protocol: 'registry-draft', structured: () => {
      const value = registryFixture(); value.registry.statuses.push(statusDefinition());
      value.opening.choices[0].outcome = { reward: { cards: [{ ...fixture().player.cards[0], id: 'gift_card', effects: { apply_status: 'starlight', stacks: 1, to: 'self' } }] } };
      return value;
    },
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    assert.deepEqual(h.variables.stat_data.battle.statuses, []);
    assert.equal(h.variables.stat_data.run.opening.content.choices[0].outcome.reward.cards[0].statuses[0].id, 'starlight');
  });
  for (const [label, mutate, error] of [
    ['bad core', value => { value.player.core.hp = 1000; }, /完整运行校验/],
    ['missing story state', value => { delete value.player.status; }, /时间、位置或职业/],
    ['unrequested narrative rewrite', value => { value.narrative = '改写剧情'; }, /重写.*preset/],
    ['invalid reference id', value => { value.player.cards[0].effects = { apply_status: 'invalid:id', stacks: 1 }; }, /定义引用未闭合/],
    ['invalid opening', value => { value.opening.choices = []; }, /完整运行校验/],
  ]) await scenario(`registry ${label} cannot bypass final validation or fall back to legacy`, {
    protocol: 'registry-draft', structured: () => { const value = registryFixture(); mutate(value); return value; },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), error);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 0);
  });
  for (const [label, response, error] of [
    ['empty response', () => '', /空响应，0 字符/],
    ['new dangling dependency', () => repairResponse({ ...statusDefinition(), triggers: { turn_end: [{ apply_status: 'another_missing', stacks: 1 }] } }), /定义引用未闭合/],
    ['illegal status mechanics', () => repairResponse({ ...statusDefinition(), triggers: { hold: [{ damage: 1 }] } }), /完整运行校验/],
    ['overwrite narrative', () => ({ ...repairResponse(statusDefinition()), narrative: '偷偷换剧情' }), /补齐响应格式无效/],
    ['wrong identity', () => repairResponse({ ...statusDefinition(), id: 'different' }), /ID 不匹配/],
  ]) await scenario(`registry repair ${label} stops without another repair`, {
    protocol: 'registry-draft', structured: h => h.modelCalls === 1 ? missingStatusFixture() : response(),
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), error);
    assert.equal(h.modelCalls, 2); assert.equal(h.writes, 0);
  });
  await scenario('preset generation scope change stops before structured generation', {
    protocol: 'registry-draft', narrative: h => { h.context.chatId = 'elsewhere'; },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /切换|变化/);
    assert.equal(h.narrativeCalls, 1); assert.equal(h.modelCalls, 0); assert.equal(h.writes, 0);
  });
  let failRegistrySave = true;
  await scenario('registry save failure retry reuses both story and deck', {
    protocol: 'registry-draft', structured: () => registryFixture(),
    save: () => { if (failRegistrySave) { failRegistrySave = false; throw new Error('disk unavailable'); } },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /disk unavailable/);
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.narrativeCalls, 1); assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
  });
  let dropDiskWrite = true;
  await scenario('host save silently fails: real readback gate rejects success, retry saves without reauthoring', {
    save: h => {
      if (!dropDiskWrite) h.disk = [{ chat_metadata: structuredClone(h.context.chatMetadata) },
        { ...h.context.chat[0], variables: [structuredClone(h.variables)] }];
    },
    verify: async (h, expected) => verifyTowerInitialPersistence({
      ...h.context, characters: [{ avatar: 'fixture.png', chat: h.context.chatId }], getRequestHeaders: () => ({}),
    }, expected, async () => ({ ok: true, json: async () => h.disk || [] })),
  }, async h => {
    const published = [];
    const derived = [];
    h.controller.onStructuredRepairProgress = event => published.push(event);
    for (const method of ['saveTowerArchiveMetadata', 'scheduleTowerChatActivityTouch', 'scheduleWarmup']) {
      h.controller[method] = () => derived.push(method);
    }
    await assert.rejects(h.controller.startTowerSingleFloor(request), /磁盘读回/);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
    assert.equal(published.filter(event => event.phase === 'complete').length, 0);
    assert.deepEqual(derived, [], 'failed disk verification cannot schedule successful-start side effects');
    dropDiskWrite = false;
    const result = await h.controller.startTowerSingleFloor(request);
    assert.equal(result.persistenceVerified, true);
    assert.equal(result.resumed, true);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
    assert.equal(published.filter(event => event.phase === 'complete').length, 1);
    assert.deepEqual(derived, ['saveTowerArchiveMetadata', 'scheduleTowerChatActivityTouch', 'scheduleWarmup']);
  });
  await scenario('chat switches during disk verification: no successful publication', {
    verify: h => { h.context.chatId = 'another-chat'; },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /变化/);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
  });
  await scenario('real view analysis during message render leaves the opening commit intact', {
    story: h => {
      const before = structuredClone(h.variables);
      assert.equal(refreshMvuContentDesignContext(h.variables).changed, false);
      assert.deepEqual(h.variables, before);
    },
  }, async h => {
    await h.controller.startTowerSingleFloor(request);
    h.controller.deactivate(); h.controller = h.makeController(); h.controller.activate();
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.modelCalls, 1); assert.equal(h.writes, 1);
  });
  await scenario('publication confirmation is saved with the same story and variables, never released in flight', {
    story: h => {
      assert.equal(h.controller.getTowerInitialPublicationStatus().busy, true);
      assert.equal(h.controller.towerCoordinatorScope(), null);
    },
    save: h => { h.disk = [{ chat_metadata: structuredClone(h.context.chatMetadata) },
      { ...h.context.chat[0], variables: [structuredClone(h.variables)] }]; },
    verify: async (h, expected) => {
      assert.equal(h.controller.towerCoordinatorScope(), null, 'tentative metadata does not unlock lookahead');
      assert.ok(expected.publication);
      await verifyTowerInitialPersistence({...h.context,characters:[{avatar:'fixture.png',chat:h.context.chatId}],getRequestHeaders:()=>({})},
        expected,async()=>({ok:true,json:async()=>h.disk}));
    },
  }, async h => {
    const result = await h.controller.startTowerSingleFloor(request);
    assert.equal(result.persistenceVerified, true);
    assert.equal(h.controller.getTowerInitialPublicationStatus().ready, true);
    assert.ok(h.controller.towerCoordinatorScope());
    // A subsequent background prefetch is allowed and must never make a
    // duplicate start replay the original state or fail the initial digest.
    queueTowerLookaheadInStat(h.variables.stat_data);
    const claimed = claimQueuedTowerGenerationsInStat(h.variables.stat_data, 3);
    assert.ok(claimed.requests.length > 0);
    const counts = [h.modelCalls,h.writes,h.storyWrites,h.saves];
    await h.controller.resumeTowerInitialCommit();
    assert.deepEqual([h.modelCalls,h.writes,h.storyWrites,h.saves],counts);
    h.controller.deactivate(); h.controller = h.makeController(); h.controller.activate();
    assert.equal(h.controller.getTowerInitialPublicationStatus().ready, true);
    const savedPublication = structuredClone(h.context.chatMetadata[publicationKey]);
    for (const [field, value] of [['chatId','elsewhere'], ['messageId',1], ['generationId','older'], ['stateDigest','0'.repeat(64)]]) {
      h.context.chatMetadata[publicationKey] = { ...savedPublication, [field]:value };
      assert.equal(h.controller.getTowerInitialPublicationStatus().ready, false, `confirmation must match ${field}`);
    }
    h.context.chatMetadata[publicationKey] = savedPublication;
    h.context.chat[0].swipe_id = 1;
    assert.equal(h.controller.getTowerInitialPublicationStatus().ready, false, 'confirmation is swipe-specific');
  });
  let rejectReadback = true;
  await scenario('failed confirmation is withdrawn; in-memory controller recreation stays blocked until no-model save recovery', {
    verify: () => { if (rejectReadback) throw new Error('readback unavailable'); },
  }, async h => {
    await assert.rejects(h.controller.startTowerSingleFloor(request), /readback unavailable/);
    assert.equal(h.context.chatMetadata[publicationKey],undefined);
    assert.equal(h.controller.towerCoordinatorScope(),null);
    await assert.rejects(h.controller.requestTowerGeneration({ sourceMessageId:0 }), /开局保存确认/);
    assert.equal(h.modelCalls,1, 'direct generation cannot bypass the confirmation gate');
    h.controller.deactivate(); h.controller = h.makeController(); h.controller.activate();
    assert.equal(h.controller.getTowerInitialPublicationStatus().ready,false);
    rejectReadback = false;
    const result = await h.controller.resumeTowerInitialCommit();
    assert.equal(result.resumed,true); assert.equal(result.persistenceVerified,true);
    assert.equal(h.modelCalls,1); assert.equal(h.writes,1);
    assert.equal(h.controller.getTowerInitialPublicationStatus().ready,true);
  });
  await scenario('exact successful disk save followed by unavailable acknowledgement can reload without reauthoring', {
    save:h=>{h.disk=structuredClone([{chat_metadata:h.context.chatMetadata},
      {...h.context.chat[0],variables:[h.variables]}]);},
    verify:()=>{throw new Error('readback unavailable after successful save');},
  },async h=>{
    h.context.chatMetadata.variables={user_owned:{counter:17},preset_test:'keep'};
    await assert.rejects(h.controller.startTowerSingleFloor(request),/readback unavailable/);
    assert.equal(h.context.chatMetadata[publicationKey],undefined,'current attempt is not acknowledged');
    assert.ok(h.disk[0].chat_metadata[publicationKey],'tentative marker was saved atomically with the exact complete record');
    const saved=structuredClone(h.disk),root=structuredClone(h.variables);
    assert.deepEqual(saved[1].variables[0],root);assert.equal(saved[1].mes,h.context.chat[0].mes);
    assert.deepEqual(saved[0].chat_metadata.variables,{user_owned:{counter:17},preset_test:'keep'});
    h.controller.deactivate();h.context.chatMetadata=structuredClone(saved[0].chat_metadata);
    h.context.chat=[structuredClone(saved[1])];h.variables=structuredClone(saved[1].variables[0]);
    h.controller=h.makeController();h.controller.activate();
    assert.equal(h.controller.getTowerInitialPublicationStatus().ready,true,
      'an exact saved snapshot is recoverable; this is not an acknowledgement-failure-always-blocks claim');
    const counts=[h.modelCalls,h.writes,h.cacheWrites];
    await h.controller.resumeTowerInitialCommit();
    // Controller activation may rerender/resave the exact loaded record. It
    // must not call the model, reapply inventory, or replace chat variables.
    assert.deepEqual([h.modelCalls,h.writes,h.cacheWrites],counts);
    assert.deepEqual(h.variables,root);
    assert.equal(h.disk[1].send_date,new Date(202609050100+h.modelCalls).toISOString(),'existing activity touch uses fixture host time');
    const withoutActivityDate=structuredClone(h.disk);delete withoutActivityDate[1].send_date;
    assert.deepEqual(withoutActivityDate,saved,'entire saved record unchanged except exact activity date');
  });
  await scenario('custom host without readback cannot unlock an unconfirmed start; empty recovery never authors', {}, async h => {
    await assert.rejects(h.controller.resumeTowerInitialCommit(), /没有已提交开局/);
    assert.equal(h.modelCalls,0);
    await h.controller.startTowerSingleFloor(request);
    assert.equal(h.controller.getTowerInitialPublicationStatus().ready,false);
    assert.equal(h.controller.towerCoordinatorScope(),null);
    assert.equal(h.context.chatMetadata[publicationKey],undefined);
  });
  const proxyRejection='### **Proxy error (HTTP 400 Bad Request)**\n\nThe proxy encountered an error while trying to send your prompt to the API. Further details are provided below.\n\n```\n'
    +JSON.stringify({error:{code:'invalid_request_error',message:'This response_format type is unavailable now'},proxy:{debug:'DO_NOT_LEAK'},proxy_note:'Rejected'})
    +'\n```\n<!-- oai-proxy-error -->';
  for(const [name,first,second,passes,calls] of [
    ['ordinary text success',()=>JSON.stringify(registryFixture()),registryFixture,true,1],
    ['empty then valid',()=>'',registryFixture,true,2],
    ['empty twice',()=>'',()=>'',false,2],
    ['empty then missing definition',()=>'',missingStatusFixture,false,2],
    ['parameter rejection without schema',()=>proxyRejection,registryFixture,false,1],
  ]) {
    await scenario(`actual custom stream boundary ordinary text: ${name}`,{
      protocol:'registry-draft',customStreamTransport:true,structured:h=>h.modelCalls===1?first():second(),
    },async h=>{
      const before=structuredClone(h.variables);
      if(passes)await h.controller.startTowerSingleFloor(request);else await assert.rejects(h.controller.startTowerSingleFloor(request));
      assert.equal(h.modelCalls,calls,'only empty delivery consumes the shared extra request; an already text-only parameter rejection is terminal');
      assert.equal(h.narrativeCalls,1,'established preset is never reauthored');assert.equal(h.customWire.length,calls);
      assert.ok(h.customWire.every(p=>!Object.hasOwn(p,'json_schema')&&!Object.hasOwn(p,'tools')));
      const prompt=h.customWire[0].messages.find(m=>m.content.startsWith('[MWG_SCHEMA_COMPATIBILITY/v1]'));
      const shared = JSON.parse(prompt.content.slice(prompt.content.indexOf('\n{')+1));
      // Text fallback factors repeated schema nodes; compare the independently
      // expanded constraints, not its intentionally different representation.
      const {$defs, ...schemaRoot} = shared;
      const expand = value => {
        if (Array.isArray(value)) return value.map(expand);
        if (!value || typeof value !== 'object') return value;
        if (Object.keys(value).length === 1 && /^#\/\$defs\/S\d+$/.test(value.$ref || '')) {
          const definition = $defs?.[value.$ref.split('/').at(-1)];
          assert.ok(definition, 'factored reference must resolve');
          return expand(definition);
        }
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
      };
      const expanded=$defs ? expand(schemaRoot) : shared;
      assert.deepEqual(expanded,createProviderSafeJsonSchema(h.modelRequests[0].json_schema).value,'ordinary text carries the same complete authoring outline');
      assert.ok(expanded.properties.player&&expanded.properties.registry&&expanded.properties.opening);
      assert.ok(expanded.required.includes('registry')&&expanded.required.includes('player')&&expanded.required.includes('opening'));
      if(calls===2)assert.ok(h.modelRequests[1].generation_id.endsWith('__draft_empty_retry'));
      assert.equal(h.writes,passes?1:0);
      if(passes)assert.ok(h.variables[receiptKey]);else {assert.deepEqual(h.variables,before);assert.equal(h.variables[receiptKey],undefined);}
    });
  }
  if (process.argv[2]) {
    const archive = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const draft = JSON.parse(archive.run.records.find(record => record.stage === 'provider-final').text);
    const narrative = JSON.parse(archive.run.records.find(record => record.stage === 'merged-draft').text).narrative;
    const beforeDraft = structuredClone(draft);
    await scenario('recorded max_lust gift and summon-local resource publish unchanged without a repair request', {
      protocol: 'registry-draft', realTransport: true,
      narrative: () => narrative,
      structured: () => draft,
    }, async h => {
      await h.controller.startTowerSingleFloor(request);
      assert.equal(h.modelCalls, 1); assert.equal(h.narrativeCalls, 1); assert.equal(h.writes, 1);
      assert.ok(h.variables[receiptKey]);
      const actual = h.variables.stat_data.run.opening.content.choices[0];
      assert.equal(actual.outcome.max_lust, 5);
      assert.ok(actual.outcome.reward.cards[0].effects.spawn_summon.resources.libido);
      assert.deepEqual(draft, beforeDraft, 'archived provider mechanics are replayed without rewriting');
    });
  }
} finally { globalThis.TavernHelper = previousHelper; globalThis.MagicGirlWorldMvuMonitor=previousMonitor; }
assert.ok(slotGuidanceChecks>0,'selection assertions must execute through the real controller');
console.log(`PASS actual repair guidance selection across ${slotGuidanceChecks} controller requests; generic scope/description locks retained.`);
