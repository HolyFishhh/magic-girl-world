import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(`worldbook_new/${name}`,'utf8');
const config=JSON.parse(read('entry-config.json'));
// The creation user message is one turn behind the generated assistant narrative.
// The narrative is allowed to omit a handoff marker; creation must still get its DSL.
for(const name of ['变量数据结构','战斗内容生成要求','流派体系与设计方法']){
  assert.equal(config[name].constant,false,`${name} must remain selective`);
  for(const marker of ['[角色创建]','[开始游戏]'])
    assert.ok(config[name].keys.includes(marker),`${marker} must activate ${name} without an AI marker`);
  assert.equal(config[name].extensions?.scan_depth,2,`${name} must scan the creation message behind the narrative`);
}
// Repairs must receive the same rule vocabulary as initial authoring.
for(const marker of config['战斗场景修复'].keys){
  for(const name of ['战斗场景生成','变量数据结构','战斗内容生成要求'])
    assert.ok(config[name].constant||config[name].keys.includes(marker),`${marker} must activate ${name}`);
}
const initial=read('4首条消息变量更新.md');
assert.doesNotMatch(initial,/最多输出 20 条 MVU 命令|超出时减少卡牌种类和附加机制/,'output economy must not silently remove requested mechanics');
const update=read('5变量更新.MD');
assert.doesNotMatch(update,/卡牌已经存在但其他初始化必需项缺失，只补齐缺失项/,'ordinary route must not override the completed-initialization gate');
assert.match(initial,/第一条助手回复/);assert.match(initial,/即使卡组为空也禁止再次初始化/);
assert.equal(config['额外模型变量更新格式'].constant,true);
assert.equal(config['[config_override]'].enabled,false);
for(const file of ['0额外模型变量更新格式.md','5变量更新.MD']){
  assert.doesNotMatch(read(file),/JSON 标签/,'node envelope is an object, not an invented XML wrapper');
  assert.match(read(file),/不包 XML 标签/);
  assert.match(read(file),/历史正文提及标记/,'historical text must not authorize a new background transaction');
}
console.log('PASS source worldbook repair activation and non-destructive initialization policy; not a live Tavern injection test.');
