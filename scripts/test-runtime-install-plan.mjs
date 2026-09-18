import assert from 'node:assert/strict';
import { planRuntimeInstall } from './install-tavern-character-runtime.mjs';
const shells = ['开始模块','变量更新展示','通用模块','战斗模块'].map((scriptName,i)=>({id:`new-${i}`,scriptName,findRegex:'test',replaceString:'new-shell',disabled:false}));
const character = {data:{name:'test',description:'keep-story',extensions:{magic_girl_world:{design_assistant_scope:'mwg.design-assistant-card/v1',card_version:'0.6.6'},world:'keep-book',other:{key:1},tavern_helper:{variables:{keep:1},scripts:[
  {type:'script',id:'mvu',name:'MVU变量框架',content:'keep-mvu'},
  {type:'folder',scripts:[{type:'script',id:'magic-girl-world-runtime-0-6-6',name:'魔法少女世界运行时',content:'old',enabled:true,button:{enabled:false},data:{keep:1}}]},
]},regex_scripts:[...shells.map((s,i)=>({...s,id:`existing-${i}`,replaceString:'old-shell',disabled:i===0})),{id:'other',scriptName:'custom',replaceString:'keep'}]}}};
const runtime='void 0;'; const manifest={spec:'mwg.tavern-runtime/v1',cardVersion:'0.6.6',runtimeBytes:Buffer.byteLength(runtime)};
const before=structuredClone(character);
const plan=planRuntimeInstall(character,runtime,manifest,shells);
assert.deepEqual(character,before);
assert.equal(plan.data.extensions.tavern_helper.scripts[1].scripts[0].content,runtime);
assert.deepEqual(plan.data.extensions.tavern_helper.scripts[0],before.data.extensions.tavern_helper.scripts[0]);
assert.deepEqual(plan.data.extensions.tavern_helper.variables,{keep:1});
assert.equal(plan.data.extensions.regex_scripts[0].id,'existing-0');
assert.equal(plan.data.extensions.regex_scripts[0].disabled,true);
assert.deepEqual(plan.data.extensions.regex_scripts.at(-1),before.data.extensions.regex_scripts.at(-1));
for(const bad of [{...manifest,cardVersion:'0.6.7'},{...manifest,runtimeBytes:1}]) assert.throws(()=>planRuntimeInstall(character,runtime,bad,shells));
assert.throws(()=>planRuntimeInstall(character,runtime,manifest,shells.slice(1)));
const wrong=structuredClone(character);wrong.data.extensions.magic_girl_world.design_assistant_scope='other';
assert.throws(()=>planRuntimeInstall(wrong,runtime,manifest,shells));
console.log('Runtime install plan preserves MVU, presets, custom scripts/regexes and data, rejects scope/version/manifest mismatch, and does not mutate input.');
