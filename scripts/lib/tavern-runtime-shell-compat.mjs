import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const COMPAT_ID='magic-girl-world-scoped-fish-shell-compat-v1';
const COMPAT_SPEC='mwg.scoped-shell-compat/v1';
const GLOBAL_ID='magic-girl-world-fish-interface';
const hash=text=>createHash('sha256').update(text).digest('hex');
// Tavern's regexFromString parses /pattern/flags with a single-line pattern.
// Literal newlines would parse only the opening fence, leaving the old script.
const escapeRegex=text=>text.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')
  .replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/\t/g,'\\t')
  .replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const ruleHash=rule=>hash(JSON.stringify(Object.fromEntries(Object.entries(rule)
  .filter(([key])=>key!=='mwg_runtime_shell_compat').sort(([a],[b])=>a.localeCompare(b)))));

/**
 * Tavern runs global regexes before character regexes. Recover only the EXACT
 * configured legacy fish shell to its presentation marker, within this character.
 * This is literal matching, not provenance detection: an identical old shell
 * already pasted in raw text is also adapted for display. Raw text is untouched.
 * The following current character rules then own version, view and depth.
 * Never change raw messages, global rules, disabled switches or other cards.
 */
export function planScopedFishShellCompatibility(data,globalRegex) {
  assert.equal(data?.extensions?.magic_girl_world?.design_assistant_scope,'mwg.design-assistant-card/v1');
  const version=data.extensions.magic_girl_world.card_version;
  const original=data.extensions.regex_scripts;
  const managed=original.filter(r=>r.id===COMPAT_ID);
  assert.ok(managed.length<=1,'duplicate scoped shell compatibility id');
  for(const rule of managed){
    assert.equal(rule.mwg_runtime_shell_compat?.spec,COMPAT_SPEC,'compatibility id belongs to another rule');
    assert.equal(rule.mwg_runtime_shell_compat?.ruleHash,ruleHash(rule),'compatibility rule was edited; preserve it instead of overwriting');
  }
  const remaining=original.filter(r=>r.id!==COMPAT_ID);
  const globals=globalRegex.filter(r=>r.id===GLOBAL_ID);
  assert.ok(globals.length<=1,'ambiguous legacy global fish rule');
  const source=globals[0];
  const none={regexScripts:remaining,compatibility:[]};
  if(!source||source.disabled)return none;
  const target=remaining.find(r=>r.scriptName==='战斗模块');
  assert.ok(target,'missing current character battle shell');
  if(target.disabled)return none;
  const old=source.replaceString;
  assert.equal(typeof old,'string','legacy shell replacement must be literal');
  const versions=[...old.matchAll(/\bvar expectedVersion = "([^"\r\n]+)";/g)];
  assert.equal(versions.length,1,'unrecognized legacy shell version declaration');
  const sourceVersion=versions[0][1];
  if(sourceVersion===version)return none;
  assert.equal(target.markdownOnly,true,'current fish shell is not display-only');
  assert.equal(target.promptOnly,false,'current fish shell also affects prompts');
  assert.deepEqual(target.placement,[2],'current fish shell placement changed');
  assert.equal(Number(target.substituteRegex),0,'current fish shell find pattern is dynamic');
  assert.equal(target.runOnEdit,true,'current fish shell edit lifecycle changed');
  assert.ok(old.startsWith('```\n<body>')&&old.endsWith('</body>\n```')&&old.length<65536,'unrecognized legacy fish shell envelope');
  assert.ok(old.includes('var view = "fish";')&&old.includes("waitGlobalInitialized('MagicGirlWorld')")&&old.includes('.getViewAsset('),'not a recognized shared-runtime fish shell');
  assert.ok(!/\{\{|\$(?:\d|<)/.test(old),'dynamic legacy replacement cannot be recovered as an exact literal');
  const knownLegacy = '(?:<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>\\s*)?(?:<StatusPlaceHolderImpl\\s*\\/?>\\s*)?<BATTLE_START>\\s*(?:<StatusPlaceHolderImpl\\s*\\/?>)?';
  assert.ok(source.findRegex === target.findRegex || (source.findRegex === knownLegacy && target.findRegex === '^(?=[\\s\\S]*<BATTLE_START>)[\\s\\S]*$'), 'legacy fish marker contract differs; do not guess');
  assert.equal(source.markdownOnly,true);assert.equal(source.promptOnly,false);
  assert.deepEqual(source.placement,[2]);assert.equal(Number(source.substituteRegex),0);
  const rule={id:COMPAT_ID,scriptName:'魔法少女世界 · 旧战斗壳隔离',
    findRegex:`/${escapeRegex(old)}/g`,replaceString:'<BATTLE_START>',trimStrings:[],placement:[2],
    disabled:false,markdownOnly:true,promptOnly:false,runOnEdit:true,substituteRegex:0,
    minDepth:target.minDepth??null,maxDepth:target.maxDepth??null};
  const provenance={spec:COMPAT_SPEC,sourceId:GLOBAL_ID,sourceVersion,sourceHash:hash(old),targetVersion:version,ruleHash:ruleHash(rule)};
  return {regexScripts:[{...rule,mwg_runtime_shell_compat:provenance},...remaining],compatibility:[provenance]};
}
