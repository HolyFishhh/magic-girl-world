import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('worldbook_new');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const entryConfig = JSON.parse(await readFile(resolve(root, 'entry-config.json'), 'utf8'));
const responsibilityIndex = await readFile(resolve(root, 'README.md'), 'utf8');
const requiredEntries = [
  '额外模型变量更新格式',
  '卡牌常驻规范',
  '首条消息变量更新',
  '战斗内容生成要求',
  '变量更新规则',
  '[initvar]不要启用',
  '输出格式要求',
  '爬塔开局剧情',
  '剧情交接锚点',
  '变量说明',
  '战斗场景生成',
  '战斗结算生成',
  '等级表现形式',
  '远征节点协议',
  '初始战斗内容修复',
  '战斗场景修复',
  '世界信息',
  '地点与NPC线路',
  '入侵与遭遇类型',
  '变量数据结构',
  '[config_override]',
];
assert.deepEqual(Object.keys(manifest).sort(), requiredEntries.sort());
assert.equal(new Set(Object.values(manifest)).size, Object.values(manifest).length, 'manifest sources must be unique');
assert.deepEqual(Object.keys(manifest), [
  '世界信息',
  '地点与NPC线路',
  '入侵与遭遇类型',
  '变量说明',
  '等级表现形式',
  '爬塔开局剧情',
  '输出格式要求',
  '剧情交接锚点',
  '[initvar]不要启用',
  '额外模型变量更新格式',
  '变量更新规则',
  '变量数据结构',
  '卡牌常驻规范',
  '战斗内容生成要求',
  '首条消息变量更新',
  '战斗场景生成',
  '战斗结算生成',
  '初始战斗内容修复',
  '战斗场景修复',
  '远征节点协议',
  '[config_override]',
]);
assert.deepEqual(Object.keys(entryConfig), Object.keys(manifest), 'entry config order must mirror manifest import order');
assert.match(responsibilityIndex, /模式入口/);
assert.match(responsibilityIndex, /剧情通用/);
assert.match(responsibilityIndex, /MVU 数据契约/);
assert.match(responsibilityIndex, /战斗内容生成/);
assert.match(responsibilityIndex, /结算与修复/);
assert.match(responsibilityIndex, /爬塔专用/);
assert.match(responsibilityIndex, /末端终检/);

const sources = new Map();
for (const [entryName, sourceName] of Object.entries(manifest)) {
  const content = await readFile(resolve(root, sourceName), 'utf8');
  assert.ok(content.trim(), `${entryName} source must not be empty`);
  sources.set(entryName, content);
}

const expectedMvuRoles = {
  '额外模型变量更新格式': 'update',
  '卡牌常驻规范': 'update',
  '首条消息变量更新': 'update',
  '变量更新规则': 'update',
  '输出格式要求': 'plot',
  '爬塔开局剧情': 'plot',
  '变量说明': 'plot',
  '变量数据结构': 'update',
  '战斗内容生成要求': 'update',
  '战斗场景生成': 'update',
  '战斗结算生成': 'update',
  '远征节点协议': 'update',
  '初始战斗内容修复': 'update',
  '战斗场景修复': 'update',
  '等级表现形式': 'plot',
  世界信息: 'plot',
  地点与NPC线路: 'plot',
  入侵与遭遇类型: 'plot',
};
for (const [entryName, role] of Object.entries(expectedMvuRoles)) {
  const comment = String(entryConfig[entryName]?.comment || '');
  const hasPlot = /\[mvu_plot\]/i.test(comment);
  const hasUpdate = /\[mvu_update\]/i.test(comment);
  const actualRole = hasPlot && hasUpdate ? 'mixed' : hasUpdate ? 'update' : hasPlot ? 'plot' : 'unclassified';
  assert.equal(actualRole, role, `${entryName} must remain a ${role} MVU world-book entry`);
}
for (const name of ['世界信息', '地点与NPC线路', '入侵与遭遇类型', '变量说明', '等级表现形式', '输出格式要求']) {
  assert.match(entryConfig[name].comment, /\[剧情通用\]/, `${name} must remain in the story-only group`);
}
assert.match(entryConfig['剧情交接锚点'].comment, /\[末端终检\]/);
assert.match(entryConfig['爬塔开局剧情'].comment, /\[模式入口\]/);
assert.deepEqual(entryConfig['爬塔开局剧情'].keys, ['[爬塔模式]']);
for (const name of ['额外模型变量更新格式', '变量更新规则', '变量数据结构', '卡牌常驻规范']) {
  assert.match(entryConfig[name].comment, /\[数据契约\]/, `${name} must remain in the MVU contract group`);
}
for (const name of ['战斗内容生成要求', '战斗场景生成']) {
  assert.match(entryConfig[name].comment, /\[战斗生成\]/, `${name} must remain in the battle generation group`);
}
for (const name of ['战斗结算生成', '初始战斗内容修复', '战斗场景修复']) {
  assert.match(entryConfig[name].comment, /\[结算修复\]/, `${name} must remain in the settlement/repair group`);
}
assert.equal(entryConfig['[config_override]']?.enabled, false, 'config override must stay a disabled card-settings entry');
assert.equal(entryConfig['[initvar]不要启用']?.enabled, false, 'initvar template must stay disabled');
for (const [entryName, config] of Object.entries(entryConfig)) {
  if ((config.keys || []).length > 0) {
    assert.equal(config.use_regex, false, `${entryName} marker keys must use literal matching`);
  }
}

const initial = JSON.parse(sources.get('[initvar]不要启用'));
assert.equal(initial.$meta.extensible, false);
assert.deepEqual(initial.battle.cards, ['$__META_EXTENSIBLE__$']);
assert.deepEqual(initial.battle.statuses, ['$__META_EXTENSIBLE__$']);
assert.deepEqual(initial.battle.player_abilities, ['$__META_EXTENSIBLE__$']);
assert.deepEqual(initial.battle.player_status_effects, ['$__META_EXTENSIBLE__$']);
assert.deepEqual(initial.battle.enemy.actions, ['$__META_EXTENSIBLE__$']);
assert.deepEqual(initial.battle.enemy.abilities, ['$__META_EXTENSIBLE__$']);
assert.deepEqual(initial.battle.enemy.status_effects, ['$__META_EXTENSIBLE__$']);
assert.equal(initial.battle.enemy.lust_effect.$meta.extensible, true);
assert.equal(initial.battle.player_lust_effect.$meta.extensible, true);
assert.equal(Object.hasOwn(initial.battle.enemy.lust_effect, 'effects'), false);
assert.equal(Object.hasOwn(initial.battle.player_lust_effect, 'effects'), false);
assert.equal(initial.run, null);
assert.equal(initial.run_result, null);
assert.equal(initial.run_upgrade, null);
assert.equal(initial.game_mode, 'story');
assert.equal(initial.game_mode_lock, null);
assert.equal(initial.battle.design_context, null);

const allPromptSources = Array.from(sources.values()).join('\n');
assert.doesNotMatch(allPromptSources, /六个浅层字段|六个字段/);
assert.doesNotMatch(allPromptSources, /疾风骤雨|咒缠魅魔|暴怒独眼巨人|处刑斧|深渊巨魔|灰爪撕咬|资源汲取|魔藤花/);
for (const [name, config] of Object.entries(entryConfig)) {
  if (name === '远征节点协议') continue;
  const keys = config.keys || [];
  for (const staleMarker of ['[路线节点]', '[事件选择]', '[营火升级]', '[商店生成]']) {
    assert.equal(keys.includes(staleMarker), false, `${name} must not retain stale tower marker ${staleMarker}`);
  }
}
const storyPrompt = [
  '世界信息',
  '地点与NPC线路',
  '入侵与遭遇类型',
  '变量说明',
  '等级表现形式',
  '输出格式要求',
  '剧情交接锚点',
].map(name => sources.get(name)).join('\n');
assert.doesNotMatch(storyPrompt, /爬塔|远征|短叙事|TOWER_NODE_RESULT|地图拓扑/);
const towerOpeningGuide = sources.get('爬塔开局剧情');
assert.match(towerOpeningGuide, /完全沿用玩家当前启用的预设与用户要求/);
assert.match(towerOpeningGuide, /不覆盖正文长度、段落数量、文风、节奏或剧情选择/);
assert.match(towerOpeningGuide, /第二轮 MVU 负责生成合法变量/);
assert.doesNotMatch(towerOpeningGuide, /300 个中文字符以内|不直接开始战斗/);
assert.match(towerOpeningGuide, /不影响剧情模式/);
assert.match(sources.get('首条消息变量更新'), /唯一详细生成入口/);
assert.match(sources.get('战斗场景生成'), /唯一详细入口/);
assert.match(sources.get('战斗结算生成'), /唯一权威/);
assert.match(sources.get('战斗内容生成要求'), /效果字段、触发器、目标视角和公式边界的唯一权威/);
assert.equal(entryConfig['卡牌常驻规范']?.constant, true, 'compact card rules must stay active for every MVU turn');
assert.equal(entryConfig['变量说明']?.constant, true, 'the plot model must receive current MVU state every turn');
assert.equal(entryConfig['变量数据结构']?.constant, false, 'full schema must not spend tokens on ordinary MVU turns');
assert.ok(entryConfig['变量数据结构']?.keys.includes('<CHARACTER_INIT_PENDING>'));
assert.ok(entryConfig['变量数据结构']?.keys.includes('<BATTLE_PENDING>'));
assert.equal(entryConfig['变量数据结构']?.keys.includes('[开始游戏]'), false);
assert.match(sources.get('变量更新规则'), /get_message_variable::stat_data\.battle\.cards/);
assert.match(sources.get('变量数据结构'), /常驻“变量更新规则”中的完整快照/);
assert.doesNotMatch(sources.get('变量数据结构'), /get_message_variable::stat_data\./);
const plotStateGuide = sources.get('变量说明');
for (const path of [
  'status.clothing',
  'status.inventory',
  'battle.core',
  'battle.cards',
  'battle.artifacts',
  'battle.items',
  'battle.statuses',
  'battle.player_lust_effect',
  'battle.design_context.brief',
  'npcs',
  'factions',
]) {
  assert.ok(
    plotStateGuide.includes(`get_message_variable::stat_data.${path}`),
    `plot model must always receive ${path}`,
  );
}
for (const transientPath of [
  'battle.enemy',
  'battle.player_abilities',
  'battle.player_status_effects',
  'reward',
  'run_result',
  'run_upgrade',
  'game_mode',
  'run',
]) {
  assert.ok(
    !plotStateGuide.includes(`get_message_variable::stat_data.${transientPath}`),
    `${transientPath} must stay out of the ordinary plot context and be injected only by its transaction`,
  );
}
assert.match(plotStateGuide, /一次性战斗或奖励对象由对应事务消息按需提供/);
assert.match(plotStateGuide, /游戏流程专用状态同样不进入普通剧情上下文/);
assert.doesNotMatch(plotStateGuide, /爬塔|远征|短叙事|地图拓扑/);
assert.match(plotStateGuide, /剧情模型每轮读取这些 MVU 值/);
assert.match(plotStateGuide, /永远不输出变量命令/);
assert.match(sources.get('剧情交接锚点'), /最后一句若仍在描写敌人的攻击/);
assert.match(sources.get('剧情交接锚点'), /最后一个字符必须是半角 `>`/);
const updateStateGuide = sources.get('变量更新规则');
for (const path of [
  'status.time',
  'status.location',
  'status.profession',
  'status.permanent_status',
  'status.temporary_status',
  'status.clothing',
  'status.inventory',
  'battle.core',
  'battle.cards',
  'battle.artifacts',
  'battle.items',
  'battle.statuses',
  'battle.player_abilities',
  'battle.player_status_effects',
  'battle.player_lust_effect',
  'battle.enemy',
  'battle.level',
  'battle.exp',
  'battle.design_context',
  'factions.player_alignment',
  'factions.relations',
  'factions.invasion',
  'npcs',
  'reward',
  'game_mode',
  'run',
  'run_result',
  'run_upgrade',
]) {
  assert.ok(
    updateStateGuide.includes(`get_message_variable::stat_data.${path}`),
    `MVU update model must always receive ${path}`,
  );
}
assert.match(updateStateGuide, /第二阶段每轮可见的完整当前快照/);
assert.match(updateStateGuide, /不授权重写未变化内容/);
assert.match(updateStateGuide, /design_context.*程序.*只读/);
assert.match(sources.get('战斗内容生成要求'), /软参考/);
assert.match(sources.get('战斗内容生成要求'), /不要求卡组必须具有防御、治疗或传统攻防比例/);
assert.match(sources.get('战斗内容生成要求'), /同一组待选奖励不能只换名称与表现而保持机械结构相同/);
assert.match(sources.get('卡牌常驻规范'), /`<CONTENT_PENDING>`/);
for (const presetStatusId of ['weak', 'bleed', 'poison', 'vulnerable', 'fog_locked', 'ember_mark']) {
  assert.doesNotMatch(
    allPromptSources,
    new RegExp(`(?:apply_status|remove_status|"id"|状态:)[:"\\s]*${presetStatusId}`, 'i'),
    `world-book must not teach ${presetStatusId} as a predefined status`,
  );
}
for (const hardExample of ['moon_slash', 'spark_forge', 'star_charm', 'tonic', '镜影魔女', '雾魇', '火焰牌']) {
  assert.doesNotMatch(allPromptSources, new RegExp(hardExample, 'i'), `world-book must not anchor generation to ${hardExample}`);
}
for (const obsoletePath of [
  'battle.player_deck',
  'battle.player_relics',
  'battle.player_items',
  'battle.core.statuses',
]) {
  assert.ok(!allPromptSources.includes(obsoletePath), `world-book must not teach obsolete path ${obsoletePath}`);
}

const battleGuide = sources.get('战斗内容生成要求');
const firstMessageGuide = sources.get('首条消息变量更新');
assert.match(firstMessageGuide, /初始化不依赖 `<CHARACTER_INIT_PENDING>`/);
assert.match(firstMessageGuide, /第一条助手回复中只要 `battle\.cards` 没有任何真实卡牌对象/);
assert.match(firstMessageGuide, /之后的空牌组只能由玩家明确提出的修复操作处理/);
assert.match(firstMessageGuide, /`battle\.cards` 已是非空数组/);
assert.match(firstMessageGuide, /即使最新回复错误地再次含有 `<CHARACTER_INIT_PENDING>`/);
assert.match(firstMessageGuide, /绕过表单直接自由输入/);
assert.match(firstMessageGuide, /`<CHARACTER_INIT_PENDING>`/);
assert.match(firstMessageGuide, /只更新 `status\.time\/location\/core` 属于失败/);
assert.match(firstMessageGuide, /`battle\.artifacts` 或 `battle\.items` 留空/);
assert.match(firstMessageGuide, /至少 1 个初始遗物和 1 个初始战斗道具/);
assert.match(firstMessageGuide, /单个 `emoji`/);
assert.match(firstMessageGuide, /`emoji` 不得留空/);
assert.match(firstMessageGuide, /卡牌只能写入此路径/);
assert.match(firstMessageGuide, /禁止写入 `battle\.player_abilities`/);
assert.match(firstMessageGuide, /剧情模式的 `run` 保持 null/);
assert.match(firstMessageGuide, /爬塔模式由程序在初始化内容通过门禁后创建运行状态/);
assert.match(firstMessageGuide, /不输出选项或战斗启动标记/);
assert.match(sources.get('输出格式要求'), /不写任何以 `\[A\.`、`\[B\.`、`\[1\.` 等开头/);
assert.match(sources.get('输出格式要求'), /开局不让玩家先选初始技能或初始卡牌/);
assert.match(sources.get('输出格式要求'), /用户明确要求立即战斗时/);
assert.doesNotMatch(firstMessageGuide, /首轮路线由状态栏提供|状态栏会立即给出第一层路线/);
assert.match(battleGuide, /禁止旧 `effect` 字符串、内部 `spec\/op\/steps` AST/);
assert.match(battleGuide, /单个或可同时结算的效果写一个对象/);
assert.match(battleGuide, /基础键：`damage\/heal\/block\/energy\/lust\/set_hp\/draw`/);
assert.match(battleGuide, /禁止把内部动作名 `gain_block\/gain_energy\/gain_lust` 写进 AI 输出/);
assert.match(battleGuide, /状态操作使用 `apply_status\/remove_status` 对象/);
assert.match(battleGuide, /不要在状态对象之外重复层数或目标/);
assert.match(battleGuide, /禁止把 `attribute\/operation\/value` 对象嵌套进 `modify`/);
assert.match(battleGuide, /递归预检会拒绝未知字段、未知状态/);
assert.match(battleGuide, /`scope\/ordinal\/n\/event\/phase\/reason\/source_kind\/source_id\/damage_type\/card_type\/template_id\/card_instance_id\/actor_id\/target_id`/);
assert.match(battleGuide, /`first` 禁止写 `n`/);
assert.match(battleGuide, /`nth\/every_n` 必须写正整数 `n`/);
assert.match(battleGuide, /`count\/last_damage\/last_hp_loss\/last_heal\/last_resource_spent\/last_turn\/last_sequence`/);
assert.match(battleGuide, /`run` 作用域只在宿主明确提供跨战斗历史时生效/);
assert.match(battleGuide, /程序没有内置状态/);
assert.match(battleGuide, /首次引用前用 `_.assign\('battle\.statuses'/);
assert.match(battleGuide, /容器固定为数组/);
assert.match(battleGuide, /值直接是非空效果对象或数组，不再包 `effects`/);
assert.match(battleGuide, /Power 可仅提供合法 `trigger`/);
assert.match(battleGuide, /`description` 通常写一句叙事表现/);
assert.match(battleGuide, /玩家可见的 `name\/description\/narrate\/source` 必须是自然中文/);
assert.match(battleGuide, /含 `when\/on\/trigger\/discard_effects`/);
assert.match(battleGuide, /何时触发、满足什么条件、实际发生什么/);
assert.match(battleGuide, /不复述无条件的简单数值标签/);
assert.match(battleGuide, /写伤害时使用“对敌方造成”/);
assert.match(battleGuide, /公式数字最多一位小数/);
assert.match(firstMessageGuide, /`description` 可省略，但通常应填写一句简短自然中文/);
assert.match(firstMessageGuide, /存在 `when\/on\/trigger\/discard_effects`/);
assert.match(firstMessageGuide, /不能只写氛围，也不能把“触发后”写成“打出时”/);
assert.match(firstMessageGuide, /实际结算仍只由 `effects` 决定/);
assert.match(firstMessageGuide, /程序没有内置状态/);
assert.match(firstMessageGuide, /每个引用 ID 都必须在同一更新中先完整注册且只注册一次/);
assert.match(firstMessageGuide, /弃牌构筑中的每次主动弃牌都必须把数量直接写在 `discard`/);
assert.match(firstMessageGuide, /必须拆成依次结算的独立数组项/);
assert.match(battleGuide, /单能量 X 费仍将 `cost` 写成 `"energy"`/);
assert.match(battleGuide, /自定义战斗资源必须先在对应实体的 `resources` 数组注册/);
assert.match(battleGuide, /`spent_resource\.<id>\/x_resource\.<id>`/);
assert.match(battleGuide, /所有组件一次检查并原子支付/);
assert.match(battleGuide, /写唯一资源 ID 数组时只免除这些组件/);
assert.match(battleGuide, /目标属性只用 `damage\/damage_taken\/lust\/lust_taken\/heal\/block\/summon_capacity`/);
assert.match(battleGuide, /`triggers` 只允许/);
assert.match(battleGuide, /`apply\/stack\/tick\/remove\/hold\/threshold_execute`/);
assert.match(battleGuide, /仅有衰减或眩晕时可让根 `triggers` 为空对象/);
assert.match(battleGuide, /`discard\/exhaust` 的值只能是数量/);
assert.match(battleGuide, /不存在通用的 `count:1` 省略规则/);
assert.match(battleGuide, /主动弃牌即使数量为 1 也必须显式写在 `discard`/);
assert.match(battleGuide, /每个牌区操作必须独占一个 `effects` 数组项/);
assert.match(battleGuide, /`combat` 才表示含消耗堆在内的四个当前战斗牌区/);
assert.match(battleGuide, /`root_only:true` 只排除运行时临时复制实例/);
assert.match(battleGuide, /`name` 精确匹配可见名称/);
assert.match(battleGuide, /`template_id` 匹配同模板/);
assert.match(battleGuide, /绝不能注册值为空对象或空数组的子触发器/);
assert.match(battleGuide, /持续修饰符和出牌规则只用于 `passive` 能力\/遗物或状态 `hold`/);
for (const ruleGroup of [
  'replay/free',
  'retain_hand/retain_block',
  'limit_draw/limit_block_gain/limit_energy_gain',
  'deny_card_play/allow_card_play',
  'limit_card_play',
  'card_destination',
]) {
  assert.ok(battleGuide.includes(ruleGroup), `card_rule contract must document ${ruleGroup}`);
}
assert.match(battleGuide, /`stance` 用于进入一个互斥姿态/);
assert.match(battleGuide, /`channel_orb` 用于向目标的有序 Orb 槽位右端充能/);
assert.match(battleGuide, /`extra_turn` 写正整数或合法公式/);
assert.match(battleGuide, /`end_turn:true` 请求强制结束/);
assert.match(battleGuide, /`targets` 访问敌人实体集合：`mode` 只用 `active\/by_id\/all\/random\/random_n\/lowest_hp\/highest_hp`/);
assert.match(battleGuide, /敌人来源攻击玩家仍以 `opponent` 且不写 `targets`/);
assert.match(battleGuide, /以 `to:"self"` 配合 `targets` 访问敌方同阵营集合/);
assert.match(battleGuide, /`action_priority` 从高到低，再按整数 `speed` 从高到低/);
assert.match(battleGuide, /活动目标死亡后切到仍存活的最前实体/);
for (const summonContract of [
  '## 召唤单位',
  '`spawn_summon`',
  '`battle.summons`',
  '`reject/replace_oldest/replace_lowest_hp`',
  '`on_existing` 只用 `reinforce/replace`',
  '`on_defeated` 只用 `new_instance/revive_reset/revive_reinforce`',
  '`left/right/random/random_n/choose/all/lowest_hp/highest_hp/by_id`',
  '`id/template_id/tags/slot`',
  '`damage_summon/heal_summon`',
  '`summon_resource/set_summon_resource`',
  '`apply_summon_status/remove_summon_status`',
  '`activate_summon`',
  '`dismiss_summon`',
  '`modify_summon_effect`',
  '`copy_summon`',
  '`damage_modifier/damage_taken_modifier/lust_damage_modifier/lust_damage_taken_modifier/heal_modifier/block_modifier`',
  '`self` 精确表示当前召唤实例',
  '`mode:"unblocked_attack"`',
  '`selectable/accepts_status/acts/intercepts`',
]) {
  assert.ok(battleGuide.includes(summonContract), `summon contract must document ${summonContract}`);
}
assert.match(battleGuide, /先由被保护战斗实体的格挡结算/);
assert.match(battleGuide, /`ensure_card` 用于保证某个 `creates` 模板在当前战斗中的根实例至少达到 `minimum`/);
assert.match(battleGuide, /计数固定扫描手牌、抽牌堆、弃牌堆和消耗堆/);
assert.match(battleGuide, /已经消耗的根实例仍满足数量/);
assert.match(battleGuide, /默认省略或写 `include_copies:false`/);
assert.match(battleGuide, /新增实例按统一溢出规则进入弃牌堆/);
assert.match(battleGuide, /不继承此前登记给未来模板或未来副本的补丁/);
assert.match(battleGuide, /`patch_card`.*值必须直接是.*字符串/);
assert.match(battleGuide, /运算字段、布尔字段、`scope\/from\/pick` 与全部筛选字段必须和 `patch_card` 处在同一层/);
assert.match(battleGuide, /严禁使用 `patch_card:\{字段:\{运算:数值\}\}` 的嵌套形状/);
assert.match(battleGuide, /`from:"combat"`、`pick:"all"`、同一 `template_id` 与 `root_only:true`/);
assert.match(battleGuide, /省略 `match` 以采用默认 `instance` 匹配/);
assert.match(battleGuide, /不会修改 `creates` 模板、长期牌组、临时复制品或之后才生成的副本/);
assert.match(battleGuide, /`threshold_execute` 是回合末恢复、Orb 与常规状态 tick、衰减都完成后的独立阶段/);
assert.match(battleGuide, /只允许 `execute` 或 `kill:true`/);
assert.match(battleGuide, /必须作用于状态持有者 `to:"self"`/);
assert.match(battleGuide, /先按阵营内稳定实体和状态顺序建立快照再结算/);
assert.match(battleGuide, /`attach_card`/);
assert.match(battleGuide, /`enchantment\/affliction`/);
assert.match(battleGuide, /`discard_auto_play`/);
assert.match(battleGuide, /`player_choice\/random_effect\/effect\/turn_cleanup\/scry/);
assert.match(battleGuide, /run\/permanent 附着会随长期卡牌写回/);
assert.match(battleGuide, /`free` 不写 `extra`/);
assert.match(battleGuide, /候选同级附 `status` 完整定义/);
assert.match(battleGuide, /初始牌组总 quantity 至少为 10，不设总量上限/);
assert.match(battleGuide, /字段形状、费用、效果可执行性、状态注册与重复 ID 仍必须通过契约校验/);
assert.match(battleGuide, /`\[构筑建议\]` 由程序提供缺口、联动与候选方向/);
assert.match(battleGuide, /同机制换皮(?:是)?允许/);
assert.match(battleGuide, /不同对象(?:始终)?使用不同稳定 ID/);
assert.match(battleGuide, /敌人行动和能力同样可用 `creates \+ add_card`/);
assert.match(battleGuide, /机制首先服从本轮剧情中的身份、形态、行为与场景/);
assert.match(battleGuide, /不因含有欲望、诱惑或精神影响主题就强制采用纯欲望流/);
assert.match(battleGuide, /自定义状态、能力与牌库干扰可按剧情自由组合/);
assert.match(battleGuide, /至少一条可执行的终局路径/);
assert.match(battleGuide, /避免只堆生命、伤害和格挡数值/);
assert.ok(entryConfig['战斗内容生成要求'].keys.includes('<CONTENT_PENDING>'));
assert.doesNotMatch(battleGuide, /`ME\.|`OP\.|`ALL\.|if\[|add_to_hand|copy_card\./);

const sceneGuide = sources.get('战斗场景生成');
const updateFormatGuide = sources.get('额外模型变量更新格式');
const updateRulesGuide = sources.get('变量更新规则');
for (const [entryName, guide] of [
  ['额外模型变量更新格式', updateFormatGuide],
  ['首条消息变量更新', firstMessageGuide],
  ['变量更新规则', updateRulesGuide],
  ['战斗场景生成', sceneGuide],
]) {
  assert.match(guide, /<Analysis>Update\.<\/Analysis>/, `${entryName} must require one fixed short analysis line`);
  assert.doesNotMatch(
    guide,
    /Briefly list only the variables changed|variables changed by this turn and why|逐项列出.*变化.*原因/i,
    `${entryName} must not ask the extra model for a reasoning list`,
  );
}
assert.match(sceneGuide, /没有能力或活动状态时分别写空的 `abilities\/status_effects` 数组/);
assert.match(sceneGuide, /普通敌人不强制为空能力或空状态/);
assert.match(sceneGuide, /一个或多个独立特色被动、临时牌、牌库干扰、增援或形态变化/);
assert.match(sceneGuide, /程序没有内置状态/);
assert.match(sceneGuide, /机制必须有可读预告或合理应对窗口/);
assert.match(sceneGuide, /禁止 `pattern\/rotation\/cycle\/attack`/);
assert.match(sceneGuide, /只允许更新 `status\.time\/status\.location`/);
assert.match(sceneGuide, /## 最终输出门禁/);
assert.match(sceneGuide, /若草稿出现重复敌人或被动 ID、字符串行动、空欲望效果、未知状态、未注册状态、`pattern`/);
assert.match(sceneGuide, /`abilities` 可选且允许多个/);
assert.match(sceneGuide, /`defeated` 会在实体移除前执行/);
assert.match(sceneGuide, /通用 `spawn_enemy`/);
assert.match(sceneGuide, /`actions`、`abilities`、`lust_effect` 的 `description` 可省略/);
assert.match(sceneGuide, /描述必须明确写出触发时机、条件和结果/);
assert.match(sceneGuide, /不要续写剧情，不要输出 `<BATTLE_PENDING>`、`<BATTLE_START>` 或选项/);
assert.match(sceneGuide, /写错会在启动前按路径报错/);
assert.match(sceneGuide, /`battle\.design_context` 提供程序评分、回合曲线、目标预算/);
assert.match(sceneGuide, /不是需要复制、解释或写回的字段/);
assert.match(sceneGuide, /不依赖固定生命区间/);
assert.match(sceneGuide, /同时含 `<CHARACTER_INIT_PENDING>`/);
assert.match(sceneGuide, /`battle\.cards` 为空/);
assert.match(sceneGuide, /不得为补齐门禁套用固定遗物、道具、状态或数值模板/);
assert.match(sceneGuide, /单敌写 `battle\.enemy` 并清空 `battle\.enemies`/);
assert.match(sceneGuide, /多敌写 `battle\.enemies` 并清空 `battle\.enemy`/);
assert.match(sceneGuide, /每个对象必须有唯一稳定英文 `id`/);
assert.match(sceneGuide, /`action_priority` 从高到低，再按 `speed` 从高到低/);
assert.match(sceneGuide, /多敌不改变相对视角/);
assert.match(sceneGuide, /敌人治疗、格挡、强化或清除同阵营敌人的状态时写 `to:"self"`/);
assert.match(sceneGuide, /玩家效果默认作用当前活动目标/);
assert.match(sceneGuide, /名称各自唯一/);
assert.match(sceneGuide, /主模型的敌人描述为唯一叙事依据/);
assert.match(sceneGuide, /程序没有内置状态/);
assert.match(sceneGuide, /不能因 ID 名称常见而省略定义/);
assert.match(sceneGuide, /浅层 `effects`/);
assert.match(sceneGuide, /不要因为出现欲望、诱惑或精神影响主题就把敌人固定成纯欲望流/);
assert.match(sceneGuide, /不预先规定欲望与生命伤害的比例/);
assert.match(sceneGuide, /至少一条可执行终局路径/);
assert.match(sceneGuide, /`abilities\/status_effects` 必须是合法数组/);
assert.doesNotMatch(sceneGuide, /镜影魔女|镜怒|裂光|镜面反噬/);
assert.doesNotMatch(sceneGuide, /<Story>|"effect"\s*:/);

const variableGuide = sources.get('变量说明');
assert.match(variableGuide, /不负责修改，也不需要解释内部公式/);
assert.match(variableGuide, /get_message_variable::stat_data\.battle\.cards/);
assert.match(variableGuide, /name\/description.*浅层 `effects`/);
assert.match(variableGuide, /`battle\.cards`/);
assert.match(variableGuide, /构筑友好叙事/);
assert.doesNotMatch(variableGuide, /_\.set|_\.assign|"player_abilities"/);

const variableDataGuide = sources.get('变量数据结构');
assert.match(variableDataGuide, /"player_abilities":/);
assert.match(variableDataGuide, /"player_status_effects":/);
assert.match(variableDataGuide, /`stat_data`/);
assert.match(variableDataGuide, /`run`、`run_node`、`run_node_reward`/);
assert.match(variableDataGuide, /由流程程序独占/);
assert.match(variableDataGuide, /多敌的整数 `action_priority\/speed` 分别按高到低排序/);
assert.match(variableDataGuide, /当前 MVU 变量没有可写的 `battle\.summons` 路径/);
assert.match(variableDataGuide, /`battle\.core\.emoji` 是玩家在战斗舞台中的形象/);
assert.doesNotMatch(variableDataGuide, /## 战后奖励|各类别的 `candidates\/pick`|候选数量不符时禁止结束输出/);
assert.match(variableDataGuide, /战后候选、惩罚和请求清理只按“战斗结算生成”处理/);
assert.doesNotMatch(variableDataGuide, /胜利若在正文中明确形成了持久代价/);
assert.doesNotMatch(variableDataGuide, /"effect"\s*:/);

const initializationGuide = sources.get('首条消息变量更新');
assert.doesNotMatch(initializationGuide, /\{ 卡牌效果字段 \}/);
assert.match(initializationGuide, /最多输出 20 条 MVU 命令/);
assert.match(initializationGuide, /总 `quantity` 至少为 10，不设总量上限/);
assert.match(initializationGuide, /卡组总量超过 13 不属于错误/);
assert.match(sources.get('卡牌常驻规范'), /`<CHARACTER_INIT_PENDING>` 只是显式提示而不是必要条件/);
assert.match(initializationGuide, /默认保持空数组/);
assert.match(initializationGuide, /明确要求状态构筑时.*只使用 1 个新状态/);
assert.match(initializationGuide, /初始构筑默认不引用状态，也不生成状态定义/);
assert.match(firstMessageGuide, /禁止自行引用状态/);
assert.match(firstMessageGuide, /卡牌、遗物、道具、欲望效果和敌人都不得出现任何 `apply_status\/remove_status`/);
assert.match(initializationGuide, /必须共享恰好 1 个新状态/);
assert.match(initializationGuide, /禁止生成未被任何内容引用的备用状态/);
assert.match(initializationGuide, /只补齐缺失项/);
assert.match(initializationGuide, /每张卡各用一条 `_\.assign\('battle\.cards'/);
assert.match(initializationGuide, /不要把整副卡组或多个对象塞进一条超长数组命令/);
assert.match(initializationGuide, /初次生成通常使用 3-4 个不同卡牌定义/);
assert.match(initializationGuide, /关闭 `<\/UpdateVariable>` 前做形状终检/);
assert.match(initializationGuide, /禁止对这些数组根路径用 `_\.set` 写单个对象/);
assert.match(initializationGuide, /等级与经验都已经在本次事务中完成/);
assert.doesNotMatch(initializationGuide, /首轮把完整卡牌数组一次写入/);
assert.match(initializationGuide, /不要输出教学示例或占位对象/);
assert.doesNotMatch(initializationGuide, /"id"\s*:/);
assert.doesNotMatch(initializationGuide, /<Story>|"effect"\s*:/);

const outputGuide = sources.get('输出格式要求');
assert.equal(entryConfig['输出格式要求']?.extensions?.position, 4);
assert.equal(entryConfig['输出格式要求']?.extensions?.depth, 1);
assert.equal(entryConfig['输出格式要求']?.extensions?.role, 0);
const plotHandoffGuide = sources.get('剧情交接锚点');
assert.equal(entryConfig['剧情交接锚点']?.extensions?.position, 4);
assert.equal(entryConfig['剧情交接锚点']?.extensions?.depth, 0);
assert.equal(entryConfig['剧情交接锚点']?.extensions?.role, 0);
assert.match(plotHandoffGuide, /`battle\.cards` 为空/);
assert.match(plotHandoffGuide, /`<CHARACTER_INIT_PENDING>`/);
assert.match(plotHandoffGuide, /`<CONTENT_PENDING>`/);
assert.match(plotHandoffGuide, /`<BATTLE_PENDING>`/);
assert.match(plotHandoffGuide, /标记之后不再写正文/);
const mvuOverride = JSON.parse(sources.get('[config_override]'));
assert.equal(mvuOverride.更新方式, '额外模型解析');
assert.equal(mvuOverride.额外模型解析配置.启用自动请求, true);
assert.equal(mvuOverride.额外模型解析配置.世界书条目白名单正则, '^\\[mvu_update\\]');
assert.equal(Object.hasOwn(mvuOverride.额外模型解析配置, '兼容假流式'), false);
assert.equal(Object.hasOwn(mvuOverride.额外模型解析配置, '模型来源'), false);
assert.equal(entryConfig['首条消息变量更新'].extensions.scan_depth, 1);
assert.equal(entryConfig['首条消息变量更新'].constant, true);
assert.equal(entryConfig['首条消息变量更新'].selective, false);
assert.deepEqual(entryConfig['首条消息变量更新'].keys, []);
assert.ok(entryConfig['战斗场景生成'].keys.includes('〈BATTLE_PENDING〉'));
assert.ok(entryConfig['战斗场景生成'].keys.includes('＜BATTLE_PENDING＞'));
assert.match(outputGuide, /直接输出自然、连贯的 Markdown 剧情正文/);
assert.match(outputGuide, /`opening` 字段规定首轮正文的当前时机/);
assert.match(outputGuide, /危险或敌人尚未出现.*不得描写敌人现身、攻击或玩家迎战/);
assert.match(outputGuide, /不使用 `<Story>`、HTML、代码块或页面容器/);
assert.match(outputGuide, /不使用 `<Story>`/);
assert.match(outputGuide, /不输出 `<Options>`、`<Option>`、`<BattleOption>`/);
assert.match(outputGuide, /不输出 `<UpdateVariable>`/);
assert.match(outputGuide, /不输出 `<BATTLE_START>`/);
assert.match(outputGuide, /“剧情交接锚点”为唯一标准/);
assert.doesNotMatch(outputGuide, /依次输出 `<CHARACTER_INIT_PENDING>` 和 `<BATTLE_PENDING>`|半角 ASCII 尖括号|不要只描写“战斗开始”却漏掉交接标记/);
assert.match(outputGuide, /只输出战后剧情正文/);
const runGuide = sources.get('远征节点协议');
assert.deepEqual(entryConfig['远征节点协议']?.keys, ['[爬塔后台节点生成]', '[爬塔开局馈赠事件]']);
assert.equal(entryConfig['远征节点协议']?.constant, false);
assert.match(runGuide, /已锁定爬塔模式后台内容生成的唯一协议/);
assert.match(runGuide, /剧情模式.*不得套用本协议/);
assert.match(runGuide, /程序独占维护游戏模式、地图拓扑、路线/);
assert.match(runGuide, /AI 只填写请求指定的一个节点或一个开局馈赠事件/);
assert.match(runGuide, /只输出请求指定的单个标签 JSON/);
assert.match(runGuide, /`node_id`、`request_id`、`based_on_revision`、`kind`/);
assert.match(runGuide, /<TOWER_NODE_RESULT>/);
assert.match(runGuide, /<TOWER_OPENING_RESULT>/);
assert.match(runGuide, /`payload\.battle`/);
assert.match(runGuide, /多敌人必须各自完整、可独立行动/);
assert.match(runGuide, /同一次请求中预生成/);
assert.match(runGuide, /胜利前隐藏/);
assert.match(runGuide, /`payload\.event\.choices`/);
assert.match(runGuide, /`outcome`、`hp`、`max_hp`、`gold`、`card_removals`、`reward`/);
assert.match(runGuide, /禁止写价格/);
assert.match(runGuide, /恢复、升级、删卡、复制和变形.*由程序/);
assert.match(runGuide, /同一敌人族群或上下位关系/);
assert.match(runGuide, /不限定题材、元素、角色身份、叙事风格和构筑创意/);
assert.doesNotMatch(runGuide, /\[路线节点\]|run_result|run_upgrade|moon_slash/);

const repairGuide = sources.get('初始战斗内容修复');
assert.equal(entryConfig['初始战斗内容修复']?.constant, false);
assert.deepEqual(entryConfig['初始战斗内容修复']?.keys, [
  '[战斗内容修复]',
  '[玩家自然语言卡牌修复]',
]);
assert.ok(entryConfig['战斗内容生成要求']?.keys.includes('[战斗内容修复]'));
assert.ok(entryConfig['战斗内容生成要求']?.keys.includes('[玩家自然语言卡牌修复]'));
assert.ok(entryConfig['变量数据结构']?.keys.includes('[玩家自然语言卡牌修复]'));
assert.match(repairGuide, /只对要求涉及的卡牌做最小增量修改/);
assert.match(repairGuide, /所有非卡牌变量保持原样/);
assert.match(repairGuide, /只允许修改/);
assert.match(repairGuide, /`battle\.cards\/artifacts\/items\/statuses`/);
assert.match(repairGuide, /保持剧情事实和 `status\/factions\/npcs` 不变/);
assert.match(repairGuide, /禁止修改 `run\/run_result\/run_upgrade\/reward\/enemy`/);
assert.match(repairGuide, /总 `quantity` 至少 10，不设总量上限/);
assert.match(repairGuide, /卡组总量超过 13 不是问题路径/);
assert.match(repairGuide, /至少一个遗物、至少一个道具和足以逆转或决定战局的玩家欲望满溢终极效果/);
assert.match(repairGuide, /原楼层修复/);
assert.match(repairGuide, /所有卡牌只能写入 `battle\.cards`/);
assert.match(repairGuide, /程序没有内置状态/);
assert.match(repairGuide, /已有合法定义直接复用/);
assert.match(repairGuide, /未被问题路径指出的合法卡牌、状态、遗物和道具必须保留/);
assert.match(repairGuide, /逐项复核 `问题=` 中的每一个路径/);
assert.match(repairGuide, /`from\/pick` 必须与其同级/);
assert.match(repairGuide, /公式禁止任何函数/);
assert.match(repairGuide, /禁止再包一层 `effects`/);
assert.match(repairGuide, /`damage_modifier\/damage_taken_modifier\/lust_damage_modifier\/lust_damage_taken_modifier\/heal_modifier\/block_modifier` 不是卡牌、状态触发器或其他 `effects` 的公开操作键/);
assert.match(repairGuide, /实际 `modify` 规则写进该状态的 `triggers\.hold`/);
assert.match(repairGuide, /`set_hp\/set_lust\/set_energy\/set_block` 的值直接是数值或合法公式/);
assert.match(repairGuide, /`scry\/seek` 只写数量/);
assert.match(repairGuide, /只能引用 `battle\.core\.resources` 中已完整注册的 ID/);
assert.match(repairGuide, /每个道具必须有非空 `effects`/);
assert.doesNotMatch(repairGuide, /spec\/op\/steps|"effect"\s*:/);

const battleRepairGuide = sources.get('战斗场景修复');
assert.equal(entryConfig['战斗场景修复']?.constant, false);
assert.deepEqual(entryConfig['战斗场景修复']?.keys, ['[战斗场景修复]']);
assert.equal(entryConfig['战斗内容生成要求']?.keys.includes('[战斗场景修复]'), false);
assert.ok(entryConfig['战斗场景生成']?.keys.includes('[战斗场景修复]'));
assert.match(battleRepairGuide, /单敌时完整替换 `battle\.enemy` 并清空 `battle\.enemies`/);
assert.match(battleRepairGuide, /多敌时完整替换 `battle\.enemies` 并清空 `battle\.enemy`/);
assert.match(battleRepairGuide, /不得在修复中丢失仍在参战的实体/);
assert.match(battleRepairGuide, /不得清空整份状态定义表/);
assert.match(battleRepairGuide, /保持 `battle\.core\/cards\/artifacts\/items\/player_lust_effect\/level\/exp`/);
assert.match(battleRepairGuide, /`status\/factions\/npcs\/run\/run_result\/run_upgrade\/reward` 不变/);
assert.match(battleRepairGuide, /只输出一个 `<UpdateVariable>`/);
assert.match(battleRepairGuide, /程序没有内置状态/);
assert.match(battleRepairGuide, /不得重复注册同一 ID/);
assert.match(battleRepairGuide, /不输出 `<BATTLE_START>`/);
assert.match(battleRepairGuide, /逐项复核 `问题=` 中的每一个路径/);
assert.match(battleRepairGuide, /不要重新初始化未被问题路径涉及的玩家内容/);
assert.doesNotMatch(battleRepairGuide, /"effect"\s*:/);
assert.match(sceneGuide, /当前战斗不得改写永久 `battle\.cards\/artifacts\/items\/player_lust_effect`/);
assert.match(sceneGuide, /入战当前值必须承接本轮已经写完的剧情/);
assert.match(sceneGuide, /已受伤、被治疗、欲望变化、获得格挡或被施加可执行状态/);
assert.match(sceneGuide, /不能拿上一场遗留的非满值冒充本次先手结果/);
assert.match(sceneGuide, /旧值必须逐字取自本轮注入的当前变量/);
assert.match(sceneGuide, /初始化标记与战斗标记同轮出现，这是一次合并事务/);
assert.match(sceneGuide, /同时通过初始化门禁和敌人门禁/);
assert.doesNotMatch(sceneGuide, /```|教学示例/);

const contentGuide = sources.get('战斗内容生成要求');
assert.match(contentGuide, /`damage` 可同级配整数 `hits`/);
assert.match(contentGuide, /self\.hand_size\/draw_pile_size\/discard_pile_size\/exhaust_pile_size/);
assert.match(contentGuide, /turn_number/);
assert.match(contentGuide, /attacks_played_this_turn/);
assert.match(contentGuide, /skills_played_this_turn/);
assert.match(contentGuide, /包含当前正在结算的牌/);
assert.match(contentGuide, /on_exhaust/);
assert.match(contentGuide, /on_draw/);
assert.match(contentGuide, /on_shuffle/);
assert.match(contentGuide, /`on_draw\/on_shuffle` 内禁止再次抽牌/);
assert.match(contentGuide, /`recover` 只从 `discard\/exhaust` 取回/);
assert.match(contentGuide, /`scry` 只写查看数量/);
assert.match(contentGuide, /`seek` 只写数量/);
assert.match(contentGuide, /不触发 `on_draw\/on_discard`/);
assert.match(contentGuide, /敌人行动和能力同样可用 `creates \+ add_card`/);
assert.match(contentGuide, /只属于本场战斗/);
assert.match(contentGuide, /绝不输出空 `effects`、空 `trigger\.effects`/);
assert.match(contentGuide, /独立玩家\/敌人能力填写简短中文 `source`/);

const updateGuide = sources.get('变量更新规则');
const settlementGuide = sources.get('战斗结算生成');
assert.equal(entryConfig['战斗结算生成']?.constant, false);
assert.deepEqual(entryConfig['战斗结算生成']?.keys, ['[MVU_BATTLE_SETTLEMENT]']);
assert.equal(entryConfig['战斗结算生成']?.extensions?.prevent_recursion, true);
assert.match(settlementGuide, /该轮最高优先级任务/);
assert.match(settlementGuide, /`request\.cards\.candidates`/);
assert.match(settlementGuide, /`battle\.design_context\.rewardPlan`/);
assert.match(settlementGuide, /深化、相邻桥接、渐进转向和通用散卡/);
assert.match(settlementGuide, /实际卡组分数增量、流派亲和、桥接度、新颖性与结构重复/);
assert.match(settlementGuide, /四项缺一即为无效结算/);
assert.match(settlementGuide, /胜利不等于没有代价/);
assert.match(settlementGuide, /惩罚可以是一项或多项/);
assert.match(settlementGuide, /组合诅咒牌、负面遗物和 `status\.permanent_status`/);
assert.doesNotMatch(settlementGuide, /恰好增量登记一项|三选一|不要同时生成多项/);
assert.doesNotMatch(allPromptSources, /一次只选择.*诅咒牌|通常按敌人主题增量登记一项/);
assert.match(settlementGuide, /禁止修改 `battle\.core`、`battle\.exp`、`battle\.enemy\/battle\.enemies`/);
assert.match(settlementGuide, /禁止修改模式、地图、路线和节点事务状态/);
assert.match(settlementGuide, /最后一条命令必须是两参数 `_\.set\('reward\.request', null\)`/);
assert.match(updateGuide, /第二阶段的 MVU 额外模型/);
assert.match(updateGuide, /不要续写剧情、复述正文、生成选项/);
assert.doesNotMatch(updateGuide, /setLocalVar|initialized_lorebooks|SnowYuki/);
assert.doesNotMatch(updateGuide, /剧情与选项之后/);
assert.ok(!updateGuide.trimStart().startsWith('```'), 'variable rules must not be wrapped in a prompt-wide code fence');
assert.doesNotMatch(updateGuide, /\$\{(?:path|old|new|reason)|format:\s*\|-|^rule:/m);
assert.match(updateGuide, /变量路径均相对于 `stat_data`/);
const extraFormatGuide = sources.get('额外模型变量更新格式');
assert.match(extraFormatGuide, /_\.set\('path', oldValue, newValue\)/);
assert.match(extraFormatGuide, /_\.assign\('array\.path', value\)/);
assert.match(extraFormatGuide, /两参数 `_.assign` 只允许向当前已经存在的数组追加一个完整元素/);
assert.match(extraFormatGuide, /当前值是数组的路径，更新后仍必须是数组/);
assert.match(extraFormatGuide, /绝不能对数组路径用 `_\.set\(path, 单个对象或字符串\)`/);
assert.match(extraFormatGuide, /`battle\.cards\/artifacts\/items\/statuses\/player_abilities\/player_status_effects`/);
assert.match(extraFormatGuide, /`npcs` 是对象映射/);
assert.match(extraFormatGuide, /禁止对任何 `\.effects` 或 `\.trigger` 路径使用 `_.assign`/);
assert.match(extraFormatGuide, /_\.remove\('path', keyOrIndexOrValue\)/);
assert.match(extraFormatGuide, /_\.add\('numeric\.path', delta\)/);
assert.match(updateGuide, /本条只负责普通增量规则和事务路由/);
assert.match(updateGuide, /专用事务的字段清单、生成要求与末端校验以对应专用条目为唯一权威/);
assert.match(updateGuide, /`reward\.request\.marker` 为 `\[MVU_BATTLE_SETTLEMENT\]`：执行“战斗结算生成”/);
assert.doesNotMatch(updateGuide, /战败不生成奖励|`reward\.card\/artifact\/item\/limits` 全部使用两参数|诅咒牌、负面遗物或永久状态/);
assert.match(extraFormatGuide, /没有事实变化时/);
assert.match(extraFormatGuide, /真实原值/);
assert.doesNotMatch(updateGuide, /_\.set\('status\.time', T, T\);/);
assert.match(updateGuide, /不得直接改等级/);
assert.match(updateGuide, /`run` 及其路线、节点和事务状态只读/);
assert.match(updateGuide, /保留现有 NPC、势力关系与未解决行动/);
assert.match(updateGuide, /永久战斗内容只在明确成长、奖励、商店、营火或玩家主动修复事务中增量处理/);
assert.match(updateGuide, /后续楼层即使卡组为空或重复出现标记，也禁止再次初始化/);
assert.match(updateGuide, /若第一条回复时卡牌已经存在但其他初始化必需项缺失，只补齐缺失项/);
assert.match(updateGuide, /标记不是必要条件/);
assert.match(updateGuide, /初始化只发生在对话第一条助手回复对应的第二阶段请求/);
assert.match(updateGuide, /`deckQuality` 会按不可主动使用、常规资源难以打出、低费用效率、偏离主构筑且低效/);
assert.match(updateGuide, /即使漏了 `<BATTLE_PENDING>`/);
assert.match(updateGuide, /合法敌人注册后由运行时打开战斗页/);
assert.match(sources.get('卡牌常驻规范'), /漏掉 `<BATTLE_PENDING>` 时/);
assert.match(sources.get('卡牌常驻规范'), /本条不重复敌人对象与行动模式规则/);
assert.doesNotMatch(sources.get('卡牌常驻规范'), /`action_mode:"random"`|纯欲望流|自定义减益、能力或本场牌库干扰/);

const locationGuide = sources.get('地点与NPC线路');
assert.match(locationGuide, /0-2 名会持续登场的 NPC/);
assert.match(locationGuide, /路人和普通敌人不登记/);
const invasionGuide = sources.get('入侵与遭遇类型');
assert.match(invasionGuide, /长期威胁 0-7/);
assert.match(invasionGuide, /单次遭遇的强弱应由当时剧情、参战者和环境决定/);
assert.doesNotMatch(invasionGuide, /路线 `danger`|节点的战术危险/);
for (const name of ['世界信息', '地点与NPC线路', '入侵与遭遇类型']) {
  assert.equal(entryConfig[name]?.constant, false);
  assert.deepEqual(entryConfig[name]?.keys, ['[开始游戏]']);
}

console.log('World-book manifest, MUV schema, and AI battle-output contract passed.');
