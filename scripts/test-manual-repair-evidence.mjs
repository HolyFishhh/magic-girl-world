import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS=JSON.stringify({module:'CommonJS',moduleResolution:'node'});
require('ts-node/register/transpile-only');require('tsconfig-paths/register');
const {DesignAssistantController}=require('../src/sillytavern-extension/controller.ts');
const {DESIGN_ASSISTANT_CARD_SCOPE,DESIGN_ASSISTANT_EXTENSION_ID,DEFAULT_DESIGN_ASSISTANT_SETTINGS}=require('../src/sillytavern-extension/types.ts');
const {INITIAL_GENERATION_EVIDENCE_METADATA_KEY: key,InitialGenerationEvidence}=require('../src/sillytavern-extension/initialGenerationEvidence.ts');
const context={chatId:'repair-evidence-chat',chat:[],characterId:0,groupId:null,
  characters:[{data:{extensions:{magic_girl_world:{design_assistant_scope:DESIGN_ASSISTANT_CARD_SCOPE}}}}],
  extensionSettings:{[DESIGN_ASSISTANT_EXTENSION_ID]:{...DEFAULT_DESIGN_ASSISTANT_SETTINGS,enabled:false}},
  chatMetadata:{},saveMetadataDebounced(){},saveSettingsDebounced(){},eventSource:{on(){},removeListener(){}},eventTypes:{}};
const controller=new DesignAssistantController({context:()=>context,mvu:()=>null,now:()=>1,notify(){}},undefined,
  {currentChatId:()=>context.chatId,generate:async()=>'',stopGenerationById:()=>true,emitInternalEvent:async()=>{},createChatMessages:async()=>{}},{towerCoordinator:false});
controller.activate();
const generationId='mwg-stat-data-repair-test',raw='invalid-model-output: '+ '原'.repeat(20000);
controller.onStructuredRepairProgress({phase:'begin',generationId,detail:'begin'});
controller.onStructuredRepairProgress({phase:'applying',generationId,detail:'validate',rawOutput:raw});
controller.onStructuredRepairProgress({phase:'error',generationId,detail:'invalid JSON',rawOutput:raw});
const saved=JSON.parse(JSON.stringify(context.chatMetadata[key]));
assert.equal(saved.runs[0].outcome,'failed');
assert.equal(saved.runs[0].records.find(r=>r.stage==='repair-final').text,raw);
const restored=new InitialGenerationEvidence();restored.retainChat(context.chatId,saved);
assert.deepEqual(restored.snapshot(context.chatId),saved);
controller.onStructuredRepairProgress({phase:'begin',generationId:'mwg-stat-data-repair-late',detail:'begin'});
context.chatId='another-chat';context.chatMetadata={};
controller.onStructuredRepairProgress({phase:'error',generationId:'mwg-stat-data-repair-late',detail:'late',rawOutput:'private-old-response'});
assert.equal(context.chatMetadata[key],undefined);
controller.deactivate();
console.log('PASS manual repair raw response archived across reload, failed validation retained, late cross-chat response excluded');
