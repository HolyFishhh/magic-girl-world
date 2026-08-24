import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('worldbook_new');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const entryConfig = JSON.parse(await readFile(resolve(root, 'entry-config.json'), 'utf8'));
const requiredEntries = [
  '额外模型变量更新格式',
  '首条消息变量更新',
  '战斗内容生成要求',
  '变量更新规则',
  '[initvar]不要启用',
  '输出格式要求',
  '变量说明',
  '战斗场景生成',
  '等级表现形式',
  '远征节点协议',
  '初始战斗内容修复',
  '战斗场景修复',
  '世界信息',
  '地点与NPC线路',
  '入侵与遭遇类型',
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
  '首条消息变量更新': 'update',
  '变量更新规则': 'update',
  '输出格式要求': 'mixed',
  '变量说明': 'mixed',
  '战斗内容生成要求': 'mixed',
  '战斗场景生成': 'mixed',
  '远征节点协议': 'mixed',
  '初始战斗内容修复': 'mixed',
  '战斗场景修复': 'mixed',
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
assert.match(firstMessageGuide, /`\[角色创建\]` 后的一行浅层 JSON/);
assert.match(firstMessageGuide, /`mode\/name\/faction\/ordinary\/supernatural\/city\/location\/note`/);
assert.match(firstMessageGuide, /剧情模式的 `run` 保持 null/);
assert.match(firstMessageGuide, /远征模式在起始战斗内容通过门禁后由程序创建/);
assert.match(firstMessageGuide, /剧情模式开场生成符合剧情的 Option/);
assert.doesNotMatch(firstMessageGuide, /首轮路线由状态栏提供|状态栏会立即给出第一层路线/);
assert.match(battleGuide, /`\{"lust":4\}`/);
assert.match(battleGuide, /`effect` 字符串和内部 `spec\/op\/steps` AST 都会被拒绝/);
assert.match(battleGuide, /单个或同条件组合优先让 `effects` 直接写一个对象/);
assert.match(battleGuide, /`damage\/heal\/block\/energy\/lust\/apply_status\/remove_status\/draw` 可在同一对象组合/);
assert.match(battleGuide, /运行时会在战斗开始前递归预检/);
assert.match(
  battleGuide,
  /卡牌、`creates` 模板、遗物、道具、能力、敌人行动、双方欲望效果和状态都不要输出 `description`/,
);
assert.doesNotMatch(battleGuide, /"type":"Attack"[^\n]*"description"/);
assert.doesNotMatch(battleGuide, /"id":"battle_focus"[^\n]*"description"/);
assert.doesNotMatch(battleGuide, /"name":"重击"[^\n]*"description"/);
assert.doesNotMatch(battleGuide, /"id":"bleed"[^\n]*"description"/);
assert.match(firstMessageGuide, /卡牌、遗物、道具、能力、欲望效果和状态不写 `description`/);
assert.match(battleGuide, /X 费牌将 `cost` 写为 `"energy"`/);
assert.match(battleGuide, /`modify` 可用 `damage\/damage_taken\/lust\/lust_taken\/heal\/block`/);
assert.match(battleGuide, /`triggers` 只允许/);
assert.match(battleGuide, /候选同级附加 `"status":\{完整状态定义\}`/);
assert.match(battleGuide, /初始牌组总 `quantity` 至少 10/);
assert.match(battleGuide, /`\[构筑建议\] need=\.\.\. synergy=\.\.\. roles=\.\.\.`/);
assert.match(battleGuide, /机制或数值相同可以接受/);
assert.match(battleGuide, /不同对象使用不同稳定 ID/);
assert.match(battleGuide, /三张卡依次满足三个 `roles`/);
assert.doesNotMatch(battleGuide, /`ME\.|`OP\.|`ALL\.|if\[|add_to_hand|copy_card\./);

const sceneGuide = sources.get('战斗场景生成');
assert.match(sceneGuide, /"abilities":\[\s*\{\s*"id":/);
assert.match(sceneGuide, /"abilities":[\s\S]*?"effects":/);
assert.doesNotMatch(sceneGuide, /"id":"mirror_rage"[^\n]*"description"/);
assert.doesNotMatch(sceneGuide, /"name":"裂光"[^\n]*"description"/);
assert.doesNotMatch(sceneGuide, /"name":"镜面反噬"[^\n]*"description"/);
assert.match(sceneGuide, /"status_effects":\[\]/);
assert.match(sceneGuide, /普通剧情响应禁止输出 `<BATTLE_START>`/);
assert.match(sceneGuide, /写错会在启动前按路径报错/);
assert.match(sceneGuide, /\[构筑摘要\]/);
assert.match(sceneGuide, /不要复制、解释或写回/);
assert.match(sceneGuide, /\[敌人预算\]/);
assert.match(sceneGuide, /不要自行重算预算/);
assert.match(sceneGuide, /名称各自唯一/);
assert.match(sceneGuide, /未被标签包裹的原生引导正文/);
assert.match(sceneGuide, /"effects"/);
assert.match(sceneGuide, /"effects":\{"damage":8\}/);
assert.doesNotMatch(sceneGuide, /<Story>|"effect"\s*:/);

const variableGuide = sources.get('变量说明');
assert.match(variableGuide, /"player_abilities":/);
assert.match(variableGuide, /"player_status_effects":/);
assert.match(variableGuide, /Common, Uncommon, Rare, Boss, ENS/);
assert.match(variableGuide, /100\+50\*\(n-1\)/);
assert.match(variableGuide, /`stat_data\.battle` 必须保持为对象/);
assert.match(variableGuide, /平铺 `battle` 不属于当前协议/);
assert.match(variableGuide, /新内容只生成浅层 `effects`/);
assert.match(variableGuide, /可选远征模式的程序存档，默认 null/);
assert.doesNotMatch(variableGuide, /"effect"\s*:/);

const initializationGuide = sources.get('首条消息变量更新');
assert.doesNotMatch(initializationGuide, /\{ 卡牌效果字段 \}/);
assert.match(initializationGuide, /"id":"shadow_strike"/);
assert.match(initializationGuide, /"quantity":5/);
assert.match(initializationGuide, /"rarity":"Common"/);
const initializationObjects = Array.from(
  initializationGuide.matchAll(/_\.assign\('battle\.(cards|artifacts|items)', (\{[^\n]+\})\);/g),
  match => ({ domain: match[1], value: JSON.parse(match[2]) }),
);
const initialCards = initializationObjects.filter(entry => entry.domain === 'cards').map(entry => entry.value);
assert.ok(initialCards.length >= 3, 'initialization example must include a playable deck core');
assert.ok(
  initialCards.reduce((total, card) => total + card.quantity, 0) >= 10,
  'initialization example must teach a deck with at least ten total cards',
);
for (const card of initialCards) {
  assert.ok(
    card.id &&
      card.name &&
      card.type &&
      card.rarity &&
      (Array.isArray(card.effects) || typeof card.effects === 'object'),
  );
  assert.equal(Array.isArray(card.effects), false, 'simple initialization cards should omit the effects array wrapper');
  assert.ok(Number.isInteger(card.quantity) && card.quantity > 0);
  if (card.type !== 'Curse') assert.ok(card.cost === 'energy' || Number.isInteger(card.cost));
}
assert.equal(initializationObjects.filter(entry => entry.domain === 'artifacts').length, 1);
assert.equal(initializationObjects.filter(entry => entry.domain === 'items').length, 1);
assert.doesNotMatch(initializationGuide, /<Story>|"effect"\s*:/);

const outputGuide = sources.get('输出格式要求');
const mvuOverride = JSON.parse(sources.get('[config_override]'));
assert.equal(mvuOverride.更新方式, '额外模型解析');
assert.equal(mvuOverride.额外模型解析配置.启用自动请求, true);
assert.match(outputGuide, /剧情正文直接输出为普通 Markdown/);
assert.match(outputGuide, /不要用 HTML、代码块或卡片包裹正文/);
assert.doesNotMatch(outputGuide, /<Story>/);
assert.match(outputGuide, /\[路线节点\]/);
assert.match(outputGuide, /\[事件选择\]/);
assert.match(outputGuide, /\[营火升级\]/);
assert.match(outputGuide, /\[奖励预算\]/);
assert.match(outputGuide, /artifacts=候选\/可选/);
assert.match(outputGuide, /不要重算、解释或写回这行文本/);
assert.match(outputGuide, /`\[战斗后续\] ordinary\/run`/);
assert.match(outputGuide, /`ordinary`：这是普通角色扮演战斗/);
assert.match(outputGuide, /领奖完成后接下来做什么/);
assert.match(outputGuide, /领取、查看、选择或放弃奖励均不是 Option/);
assert.match(outputGuide, /本次回复的 `<UpdateVariable>` 中立即写入全部候选和经验/);
assert.match(outputGuide, /`run`：这是可选远征战斗/);
assert.doesNotMatch(outputGuide, /奖励后不再生成探索 Option/);
const runGuide = sources.get('远征节点协议');
assert.match(runGuide, /程序会按 Act、层数、节点类型和已完成的同类节点/);
assert.match(runGuide, /机制相同但叙事身份不同/);
assert.match(runGuide, /\[世界连续性\]/);
assert.match(runGuide, /最多两名正在追踪 NPC/);
assert.match(runGuide, /原有 `status\/factions\/npcs`/);
assert.match(runGuide, /轻量代价.*明确取舍.*高价值高代价/);
assert.match(runGuide, /基础补给、定向补强或高阶成长/);
assert.match(runGuide, /程序独占维护 `run`/);
assert.match(runGuide, /"card_id":"moon_slash"/);
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
assert.match(repairGuide, /只替换/);
assert.match(repairGuide, /`battle\.cards\/artifacts\/items\/statuses`/);
assert.match(repairGuide, /保持剧情事实和 `status\/factions\/npcs` 不变/);
assert.match(repairGuide, /禁止修改 `run\/run_result\/run_upgrade\/reward\/enemy`/);
assert.match(repairGuide, /总 `quantity` 至少 10/);
assert.match(repairGuide, /至少一个遗物、至少一个道具和玩家欲望满溢效果/);
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
assert.match(battleRepairGuide, /`<UpdateVariable>` 和 `<BATTLE_START>`/);
assert.doesNotMatch(battleRepairGuide, /"effect"\s*:/);
assert.match(sceneGuide, /当前战斗不得改写永久 `battle\.cards\/artifacts\/items\/player_lust_effect`/);

const contentGuide = sources.get('战斗内容生成要求');
assert.match(contentGuide, /\{"damage":4,"hits":3\}/);
assert.match(contentGuide, /self\.hand_size\/draw_pile_size\/discard_pile_size\/exhaust_pile_size/);
assert.match(contentGuide, /每击分别结算格挡和触发器/);
assert.match(contentGuide, /turn_number/);
assert.match(contentGuide, /attacks_played_this_turn/);
assert.match(contentGuide, /skills_played_this_turn/);
assert.match(contentGuide, /包含当前正在结算的牌/);
assert.match(contentGuide, /on_exhaust/);
assert.match(contentGuide, /打出后消耗、空灵和效果选择消耗/);
assert.match(contentGuide, /on_draw/);
assert.match(contentGuide, /on_shuffle/);
assert.match(contentGuide, /起始手牌不触发/);
assert.match(contentGuide, /不得再次写 `draw`/);
assert.match(contentGuide, /\{"recover":1,"from":"discard","pick":"choose"\}/);
  assert.match(contentGuide, /\{"scry":3\}/);
  assert.match(contentGuide, /\{"seek":1\}/);
assert.match(contentGuide, /可选择 0 到该数量张置入弃牌堆/);
assert.match(contentGuide, /不触发 `on_draw\/on_discard`/);

const updateGuide = sources.get('变量更新规则');
assert.doesNotMatch(updateGuide, /setLocalVar|initialized_lorebooks|SnowYuki/);
assert.ok(!updateGuide.trimStart().startsWith('```'), 'variable rules must not be wrapped in a prompt-wide code fence');
assert.doesNotMatch(updateGuide, /\$\{(?:path|old|new|reason)|format:\s*\|-|^rule:/m);
assert.match(updateGuide, /变量路径均相对于 `stat_data`/);
assert.match(updateGuide, /_\.set\('path', oldValue, newValue\)/);
assert.match(updateGuide, /_\.assign\('array\.path', value\)/);
assert.match(updateGuide, /_\.remove\('path', keyOrIndexOrValue\)/);
assert.match(updateGuide, /_\.add\('numeric\.path', delta\)/);
assert.match(updateGuide, /没有变量变化时仍输出空更新块/);
assert.match(updateGuide, /_\.add\('battle\.exp', 正整数\)/);
assert.match(updateGuide, /100 \+ 50\*\(n-1\)/);
assert.match(updateGuide, /禁止直接修改 `battle\.level`/);
assert.match(updateGuide, /`run` 由状态栏程序独占维护/);
assert.match(updateGuide, /`run_result` 只按“远征节点”规则/);
assert.match(updateGuide, /长期世界连续性/);
assert.match(updateGuide, /已有 NPC 使用原稳定 ID/);
assert.match(updateGuide, /禁止用一份重新生成的完整对象重置未变化内容/);

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
