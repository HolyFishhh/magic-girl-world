import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('worldbook_new');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const entryConfig = JSON.parse(await readFile(resolve(root, 'entry-config.json'), 'utf8'));
const requiredEntries = [
  '额外模型变量更新格式',
  '卡牌常驻规范',
  '首条消息变量更新',
  '战斗内容生成要求',
  '变量更新规则',
  '[initvar]不要启用',
  '输出格式要求',
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

const allPromptSources = Array.from(sources.values()).join('\n');
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
assert.match(plotStateGuide, /一次性战斗\/奖励对象由对应事务消息按需提供/);
assert.match(plotStateGuide, /模式和远征状态则由程序锚点切换对应世界书/);
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
assert.match(firstMessageGuide, /只有当前最新的剧情模型回复含 `<CHARACTER_INIT_PENDING>`/);
assert.match(firstMessageGuide, /不要因为历史消息曾含 `\[开始游戏\]`/);
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
assert.match(firstMessageGuide, /远征模式在起始战斗内容通过门禁后由程序创建/);
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
assert.match(battleGuide, /X 费卡将 `cost` 写成 `"energy"`/);
assert.match(battleGuide, /目标属性只用 `damage\/damage_taken\/lust\/lust_taken\/heal\/block`/);
assert.match(battleGuide, /`triggers` 只允许/);
assert.match(battleGuide, /仅有衰减或眩晕时可让根 `triggers` 为空对象/);
assert.match(battleGuide, /`discard\/exhaust` 的值只能是数量/);
assert.match(battleGuide, /不存在通用的 `count:1` 省略规则/);
assert.match(battleGuide, /主动弃牌即使数量为 1 也必须显式写在 `discard`/);
assert.match(battleGuide, /每个牌区操作必须独占一个 `effects` 数组项/);
assert.match(battleGuide, /绝不能注册值为空对象或空数组的子触发器/);
assert.match(battleGuide, /持续修饰符和出牌规则只用于 `passive` 能力\/遗物或状态 `hold`/);
assert.match(battleGuide, /`card_rule` 只用 `replay\/free`/);
assert.match(battleGuide, /`free` 不写 `extra`/);
assert.match(battleGuide, /候选同级附 `status` 完整定义/);
assert.match(battleGuide, /初始牌组总 quantity 至少为 10，不设总量上限/);
assert.match(battleGuide, /字段形状、费用、效果可执行性、状态注册与重复 ID 仍必须通过契约校验/);
assert.match(battleGuide, /`\[构筑建议\]` 由程序提供缺口、联动与候选方向/);
assert.match(battleGuide, /同机制换皮允许/);
assert.match(battleGuide, /不同对象使用不同稳定 ID/);
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
assert.match(sceneGuide, /一个特色能力、临时牌或牌库干扰/);
assert.match(sceneGuide, /程序没有内置状态/);
assert.match(sceneGuide, /机制必须有可读预告或合理应对窗口/);
assert.match(sceneGuide, /禁止 `pattern\/rotation\/cycle\/attack`/);
assert.match(sceneGuide, /只允许更新 `status\.time\/status\.location`/);
assert.match(sceneGuide, /## 最终输出门禁/);
assert.match(sceneGuide, /若草稿出现字符串行动、空欲望效果、未知状态、未注册状态、`pattern`/);
assert.match(sceneGuide, /`actions`、`abilities`、`lust_effect` 的 `description` 可省略/);
assert.match(sceneGuide, /描述必须明确写出触发时机、条件和结果/);
assert.match(sceneGuide, /不要续写剧情，不要输出 `<BATTLE_PENDING>`、`<BATTLE_START>` 或选项/);
assert.match(sceneGuide, /写错会在启动前按路径报错/);
assert.match(sceneGuide, /\[构筑摘要\]/);
assert.match(sceneGuide, /不要复制、解释或写回/);
assert.match(sceneGuide, /\[敌人预算\]/);
assert.match(sceneGuide, /不要自行重算预算/);
assert.match(sceneGuide, /同时含 `<CHARACTER_INIT_PENDING>`/);
assert.match(sceneGuide, /`battle\.cards` 为空/);
assert.match(sceneGuide, /`battle\.artifacts\/items` 至少各注册 1 个/);
assert.match(sceneGuide, /都必须完整替换 `battle\.enemy`/);
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
assert.match(variableDataGuide, /`run` 由远征程序独占/);
assert.match(variableDataGuide, /`battle\.core\.emoji` 是玩家在战斗舞台中的形象/);
assert.match(variableDataGuide, /战后奖励/);
assert.match(variableDataGuide, /各类别的 `candidates\/pick`/);
assert.match(variableDataGuide, /`limits` 整对象写入 `reward\.limits`/);
assert.match(variableDataGuide, /禁止分路径写限制/);
assert.match(variableDataGuide, /不存在的类别保持空数组/);
assert.match(variableDataGuide, /固定写 `"quantity":1`/);
assert.match(variableDataGuide, /战斗胜利经验已由程序提前结算/);
assert.match(variableDataGuide, /候选数量不符时禁止结束输出/);
assert.match(variableDataGuide, /失败请求不给胜利奖励/);
assert.match(variableDataGuide, /可登记一项或多项主题相关的持久代价/);
assert.match(variableDataGuide, /也可组合诅咒牌、`status\.permanent_status` 永久状态和负面遗物/);
assert.match(variableDataGuide, /胜利若在正文中明确形成了持久代价/);
assert.doesNotMatch(variableDataGuide, /"effect"\s*:/);

const initializationGuide = sources.get('首条消息变量更新');
assert.doesNotMatch(initializationGuide, /\{ 卡牌效果字段 \}/);
assert.match(initializationGuide, /最多输出 20 条 MVU 命令/);
assert.match(initializationGuide, /总 `quantity` 至少为 10，不设总量上限/);
assert.match(initializationGuide, /卡组总量超过 13 不属于错误/);
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
assert.deepEqual(entryConfig['首条消息变量更新'].keys, [
  '<CHARACTER_INIT_PENDING>',
  '〈CHARACTER_INIT_PENDING〉',
  '＜CHARACTER_INIT_PENDING＞',
]);
assert.ok(entryConfig['战斗场景生成'].keys.includes('〈BATTLE_PENDING〉'));
assert.ok(entryConfig['战斗场景生成'].keys.includes('＜BATTLE_PENDING＞'));
assert.match(outputGuide, /直接输出自然、连贯的 Markdown 剧情正文/);
assert.match(outputGuide, /`opening` 字段规定首轮正文的当前时机/);
assert.match(outputGuide, /危险或敌人尚未出现.*不得描写敌人现身、攻击、玩家迎战/);
assert.match(outputGuide, /不使用 `<Story>`、HTML、代码块或页面容器/);
assert.match(outputGuide, /不使用 `<Story>`/);
assert.match(outputGuide, /不输出 `<Options>`、`<Option>`、`<BattleOption>`/);
assert.match(outputGuide, /不输出 `<UpdateVariable>`/);
assert.match(outputGuide, /<BATTLE_PENDING>/);
assert.match(outputGuide, /不输出 `<BATTLE_START>`/);
assert.match(outputGuide, /`battle\.cards` 为空/);
assert.match(outputGuide, /依次输出 `<CHARACTER_INIT_PENDING>` 和 `<BATTLE_PENDING>`/);
assert.match(outputGuide, /半角 ASCII 尖括号/);
assert.match(outputGuide, /不要只描写“战斗开始”却漏掉交接标记/);
assert.match(outputGuide, /只输出战后剧情正文/);
const runGuide = sources.get('远征节点协议');
assert.match(runGuide, /程序会按 Act、层数、节点类型和已完成的同类节点/);
assert.match(runGuide, /机制相同但叙事身份不同/);
assert.match(runGuide, /\[世界连续性\]/);
assert.match(runGuide, /最多两名正在追踪 NPC/);
assert.match(runGuide, /原有 `status\/factions\/npcs`/);
assert.match(runGuide, /轻量代价.*明确取舍.*高价值高代价/);
assert.match(runGuide, /基础补给、定向补强或高阶成长/);
assert.match(runGuide, /程序独占维护 `run`/);
assert.match(runGuide, /`node_id\/card_id` 必须使用消息和当前卡组中的真实值/);
assert.doesNotMatch(runGuide, /moon_slash/);
assert.match(runGuide, /向 `reward\.card\/artifact\/item` 写对应数量的商品候选/);
assert.match(runGuide, /\[商店预算\]/);
assert.match(runGuide, /商店商品禁止写 `price`/);
assert.match(runGuide, /程序会按 Act、类别、稀有度和数量确定价格/);
assert.match(runGuide, /候选同级附 `"status":\{完整状态定义\}`/);
assert.doesNotMatch(runGuide, /reward\.status/);
assert.doesNotMatch(runGuide, /card_price|artifact_price|item_price/);
assert.doesNotMatch(runGuide, /price\(card=/);
assert.match(runGuide, /`failed` 会结束整次远征/);
assert.match(runGuide, /`gold\/hp` 是 -999\.\.999 的整数变化量/);
assert.match(runGuide, /非 `failed` 不能扣到 0/);
assert.match(runGuide, /禁止另行修改 `battle\.core\.hp`/);
assert.match(runGuide, /同时写入 `run_result` 和 `reward\.card\/artifact\/item`/);
assert.match(runGuide, /确认领取”或“跳过/);
assert.match(runGuide, /不要把事件代价拆成另一条命令/);

const repairGuide = sources.get('初始战斗内容修复');
assert.equal(entryConfig['初始战斗内容修复']?.constant, false);
assert.deepEqual(entryConfig['初始战斗内容修复']?.keys, ['[战斗内容修复]']);
assert.ok(entryConfig['战斗内容生成要求']?.keys.includes('[战斗内容修复]'));
assert.match(repairGuide, /只允许修改/);
assert.match(repairGuide, /`battle\.cards\/artifacts\/items\/statuses`/);
assert.match(repairGuide, /保持剧情事实和 `status\/factions\/npcs` 不变/);
assert.match(repairGuide, /禁止修改 `run\/run_result\/run_upgrade\/reward\/enemy`/);
assert.match(repairGuide, /总 `quantity` 至少 10，不设总量上限/);
assert.match(repairGuide, /卡组总量超过 13 不是问题路径/);
assert.match(repairGuide, /至少一个遗物、至少一个道具和玩家欲望满溢效果/);
assert.match(repairGuide, /原楼层修复/);
assert.match(repairGuide, /所有卡牌只能写入 `battle\.cards`/);
assert.match(repairGuide, /程序没有内置状态/);
assert.match(repairGuide, /已有合法定义直接复用/);
assert.match(repairGuide, /未被问题路径指出的合法卡牌、状态、遗物和道具必须保留/);
assert.match(repairGuide, /逐项复核 `问题=` 中的每一个路径/);
assert.match(repairGuide, /`from\/pick` 必须与其同级/);
assert.match(repairGuide, /公式禁止任何函数/);
assert.doesNotMatch(repairGuide, /spec\/op\/steps|"effect"\s*:/);

const battleRepairGuide = sources.get('战斗场景修复');
assert.equal(entryConfig['战斗场景修复']?.constant, false);
assert.deepEqual(entryConfig['战斗场景修复']?.keys, ['[战斗场景修复]']);
assert.equal(entryConfig['战斗内容生成要求']?.keys.includes('[战斗场景修复]'), false);
assert.ok(entryConfig['战斗场景生成']?.keys.includes('[战斗场景修复]'));
assert.match(battleRepairGuide, /完整替换 `battle\.enemy`/);
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
assert.match(settlementGuide, /四项缺一即为无效结算/);
assert.match(settlementGuide, /胜利不等于没有代价/);
assert.match(settlementGuide, /惩罚可以是一项或多项/);
assert.match(settlementGuide, /组合诅咒牌、负面遗物和 `status\.permanent_status`/);
assert.doesNotMatch(settlementGuide, /恰好增量登记一项|三选一|不要同时生成多项/);
assert.doesNotMatch(allPromptSources, /一次只选择.*诅咒牌|通常按敌人主题增量登记一项/);
assert.match(settlementGuide, /禁止修改 `battle\.core`、`battle\.exp`、`battle\.enemy`/);
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
assert.match(updateGuide, /战败不生成奖励/);
assert.match(updateGuide, /程序已完成生命、经验、敌人清理等战斗结算/);
assert.match(updateGuide, /禁止再修改 `battle\.core\/battle\.exp\/battle\.enemy\/battle\.enemies`/);
assert.match(updateGuide, /`reward\.card\/artifact\/item\/limits` 全部使用两参数/);
assert.match(updateGuide, /诅咒牌、负面遗物或永久状态/);
assert.match(extraFormatGuide, /没有事实变化时/);
assert.match(extraFormatGuide, /真实原值/);
assert.doesNotMatch(updateGuide, /_\.set\('status\.time', T, T\);/);
assert.match(updateGuide, /不得直接改等级/);
assert.match(updateGuide, /`run` 只读/);
assert.match(updateGuide, /保留现有 NPC、势力关系与未解决行动/);
assert.match(updateGuide, /`<CONTENT_PENDING>`/);
assert.match(updateGuide, /`battle\.cards` 非空时，无论正文是否误含 `<CHARACTER_INIT_PENDING>`/);
assert.match(updateGuide, /禁止重复登记 `battle\.cards\/artifacts\/items\/statuses\/player_lust_effect`/);
assert.match(updateGuide, /用 `_\.assign\/_\.remove` 增量处理/);
assert.match(updateGuide, /即使漏了 `<BATTLE_PENDING>`/);
assert.match(updateGuide, /合法敌人出现后运行时自动打开战斗页/);
assert.match(sources.get('卡牌常驻规范'), /漏掉 `<BATTLE_PENDING>` 时/);
assert.match(sources.get('卡牌常驻规范'), /机制仍服从剧情身份、形态和场景/);
assert.match(sources.get('卡牌常驻规范'), /不因带有欲望主题就生成纯欲望流/);
assert.match(sources.get('卡牌常驻规范'), /自定义减益、能力或本场牌库干扰/);
assert.match(sources.get('卡牌常驻规范'), /所有新状态必须在引用前完整注册/);
assert.match(sources.get('卡牌常驻规范'), /没有明确顺序或权重需求时使用 `action_mode:"random"`/);
assert.match(sources.get('卡牌常驻规范'), /保留可反复推进至战斗结束的生命伤害或完整注册的持续伤害/);
assert.match(sources.get('卡牌常驻规范'), /不能堆砌无关机制或修改持久玩家内容/);

const locationGuide = sources.get('地点与NPC线路');
assert.match(locationGuide, /0-2 名会持续登场的 NPC/);
assert.match(locationGuide, /路人和普通敌人不登记/);
const invasionGuide = sources.get('入侵与遭遇类型');
assert.match(invasionGuide, /长期威胁 0-7/);
assert.match(invasionGuide, /战术危险 0-3/);
assert.match(invasionGuide, /禁止直接复制换算/);
for (const name of ['世界信息', '地点与NPC线路', '入侵与遭遇类型']) {
  assert.equal(entryConfig[name]?.constant, false);
  assert.deepEqual(entryConfig[name]?.keys, ['[开始游戏]']);
}

console.log('World-book manifest, MUV schema, and AI battle-output contract passed.');
