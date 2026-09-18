import assert from 'node:assert/strict';
import {planRuntimeInstall} from './install-tavern-character-runtime.mjs';
const scope='mwg.design-assistant-card/v1';
const oldBody='```\n<body><script>var view = "fish"; var expectedVersion = "0.6.0"; waitGlobalInitialized(\'MagicGirlWorld\'); api.getViewAsset(view);</script></body>\n```';
const regex=(id,scriptName,replaceString)=>({id,scriptName,findRegex:'<BATTLE_START>',replaceString,
  placement:[2],markdownOnly:true,promptOnly:false,disabled:false,runOnEdit:true,substituteRegex:0,minDepth:0,maxDepth:0,trimStrings:[]});
const globalRule=regex('magic-girl-world-fish-interface','战斗模块',oldBody);
const shells=['开始模块','变量更新展示','通用模块','战斗模块'].map((name,i)=>regex('new-'+i,name,i===3?'CURRENT-FISH':'UNUSED'));
shells.slice(0,3).forEach((r,i)=>r.findRegex='unused-'+i);
const character={data:{extensions:{magic_girl_world:{design_assistant_scope:scope,card_version:'0.6.6'},
  tavern_helper:{scripts:[{type:'script',id:'magic-girl-world-runtime-0-6-6',name:'魔法少女世界运行时',content:'old',enabled:true}]},
  regex_scripts:[...shells.map((r,i)=>({...r,id:'existing-'+i})),{id:'custom',scriptName:'自定义',findRegex:'CUSTOM',replaceString:'PRESERVED'}]}}};
const runtime='void 0;',manifest={spec:'mwg.tavern-runtime/v1',cardVersion:'0.6.6',runtimeBytes:7};
const before=structuredClone({character,globalRule});
const plan=planRuntimeInstall(character,runtime,manifest,shells,{globalRegex:[globalRule]});
const regexFromString=raw=>raw.startsWith('/')?new RegExp(raw.slice(1,raw.lastIndexOf('/')),raw.slice(raw.lastIndexOf('/')+1)):new RegExp(raw,'g');
const apply=(text,rules)=>rules.reduce((text,r)=>r.disabled?text:text.replace(regexFromString(r.findRegex),()=>r.replaceString),text);
const raw='剧情前文\n<BATTLE_START>\n剧情后文';
assert.equal(apply(raw,[globalRule,...plan.data.extensions.regex_scripts]),'剧情前文\nCURRENT-FISH\n剧情后文',
  'only the current character must recover the marker after a legacy global shell consumed it');
assert.deepEqual({character,globalRule},before);
assert.equal(apply(raw,[globalRule]),'剧情前文\n'+oldBody+'\n剧情后文','other characters still receive the unchanged old global rule');
assert.deepEqual(plan.data.extensions.regex_scripts.at(-1),character.data.extensions.regex_scripts.at(-1));
assert.equal(plan.scopedShellCompatibility.length,1);
const again=planRuntimeInstall({...character,data:plan.data},runtime,manifest,shells,{globalRegex:[globalRule]});
assert.deepEqual(again.data,plan.data,'idempotent reinstall: no duplicate compatibility rules');
const compat=plan.data.extensions.regex_scripts[0];
assert.doesNotMatch(compat.findRegex,/[\r\n\u2028\u2029]/,'Tavern slash-pattern parser must receive a single line');
assert.equal(compat.replaceString,'<BATTLE_START>');assert.equal(compat.substituteRegex,0);
assert.equal(compat.markdownOnly,true);assert.equal(compat.promptOnly,false);
assert.deepEqual(compat.placement,[2]);assert.equal(compat.minDepth,0);assert.equal(compat.maxDepth,0);
assert.equal(apply(oldBody.replace('api.getViewAsset','CUSTOM.getViewAsset'),[compat]),oldBody.replace('api.getViewAsset','CUSTOM.getViewAsset'),'not a broad version-number rewrite');
assert.equal(apply(oldBody+'\n'+oldBody,[compat]),'<BATTLE_START>\n<BATTLE_START>');
const metacharBody=oldBody.replace('</script>','const x="a/b.c[d](e)+?^|\\\\$&";</script>');
const metacharPlan=planRuntimeInstall(character,runtime,manifest,shells,{globalRegex:[{...globalRule,replaceString:metacharBody}]});
assert.equal(apply(metacharBody,[metacharPlan.data.extensions.regex_scripts[0]]),'<BATTLE_START>','escape regex metacharacters literally');
const disabled=structuredClone(character);disabled.data.extensions.regex_scripts.find(r=>r.scriptName==='战斗模块').disabled=true;
const disabledPlan=planRuntimeInstall(disabled,runtime,manifest,shells,{globalRegex:[globalRule]});
assert.equal(disabledPlan.scopedShellCompatibility.length,0,'never activate a disabled character battle view');
assert.equal(disabledPlan.data.extensions.regex_scripts.find(r=>r.scriptName==='战斗模块').disabled,true);
for(const globals of [[],[{...globalRule,disabled:true}],[{...globalRule,id:'unrelated'}],[{...globalRule,replaceString:oldBody.replace('0.6.0','0.6.6')}]] ){
  const next=planRuntimeInstall({...character,data:plan.data},runtime,manifest,shells,{globalRegex:globals});
  assert.equal(next.scopedShellCompatibility.length,0);
  assert.equal(next.data.extensions.regex_scripts.some(r=>r.id===compat.id),false);
}
for(const bad of [
  {...globalRule,replaceString:oldBody+'{{char}}'},
  {...globalRule,replaceString:oldBody+'$1'},
  {...globalRule,replaceString:oldBody.replace('"fish"','"common"')},
  {...globalRule,findRegex:'CUSTOM'},
  {...globalRule,promptOnly:true},
]) assert.throws(()=>planRuntimeInstall(character,runtime,manifest,shells,{globalRegex:[bad]}),'reject unsupported/dynamic shell instead of guessing');
assert.throws(()=>planRuntimeInstall(character,runtime,manifest,shells,{globalRegex:[globalRule,globalRule]}),'ambiguous duplicate global id');
const custom=structuredClone(character);custom.data.extensions.regex_scripts.unshift({...compat,replaceString:'USER-EDIT'});
assert.throws(()=>planRuntimeInstall(custom,runtime,manifest,shells,{globalRegex:[globalRule]}),'never overwrite edited compatibility rule');
const collision=structuredClone(character);collision.data.extensions.regex_scripts.unshift({id:compat.id,scriptName:'USER-OWNED'});
assert.throws(()=>planRuntimeInstall(collision,runtime,manifest,shells,{globalRegex:[globalRule]}),'never overwrite id collision');
for(const change of [{placement:[1]},{markdownOnly:false},{promptOnly:true},{substituteRegex:1},{runOnEdit:false}]){
  const incompatible=shells.map(r=>r.scriptName==='战斗模块'?{...r,...change}:r);
  assert.throws(()=>planRuntimeInstall(character,runtime,manifest,incompatible,{globalRegex:[globalRule]}),'target lifecycle contract changed; compatibility must fail closed');
}
console.log('PASS scoped legacy runtime-shell compatibility: exact output recovery, character-only, immutable globals/story, lifecycle/idempotency, literal matching, settings/depth/disabled boundaries and collision safeguards.');
