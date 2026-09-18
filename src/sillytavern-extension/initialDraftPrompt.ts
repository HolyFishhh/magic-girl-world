import { OPENING_TRANSFORM_GUIDANCE } from '../game-core/towerOpeningTransforms';
import { INITIAL_DRAFT_SPEC } from '../game-core/initialDraft';
import { isCanonicalTowerStartRequest } from '../game-core/characterStartRequest';
import { mechanismAuthoringReview } from '../game-core/mechanismAuthoringReview';
import { initialDeckAuthoringGuidance } from '../game-core/initialDeckAuthoringGuidance';
import { initialDraftAuthorEnvelopeContract } from '../game-core/initialDraftEnvelope';
import { INITIAL_TEMPLATE_REPAIR_SPEC, type InitialTemplateRepairPlan } from '../game-core/initialTemplateRepair';
import { formatCompactEffectAuthoringContract } from '../game-core/towerRequest';
import { INITIAL_DRAFT_REGISTRY_REPAIR_SPEC, type InitialDraftRegistryRepairPlan } from '../game-core/initialDraftRepair';
import { towerDungeonPlanningPrompt } from '../game-core/towerDungeonPlan';

export { EFFECT_PROTOCOL_TIMING_EXAMPLES as INITIAL_DRAFT_TIMING_EXAMPLES } from '../game-core/effectProtocolExamples';

const registryPlacement = [
  '[本次 AI 草稿的定义位置；与编译后的运行时表示区分]',
  'registry 固定为 {statuses:[],resources:[],templates:[]}。所有完整状态定义只在 registry.statuses 登记一次；所有玩家初始资源定义只在 registry.resources 登记一次；全部临时牌模板只在 registry.templates 登记一次。每类 ID 唯一，已有 ID 直接引用，不重复展开定义。',
  '下面的完整 effects 契约使用本次草稿的定义位置。AI player 不写 statuses，player.core 不写 resources，所有卡牌/遗物/道具/能力/奖励/模板/召唤行动都不写 creates 或同级状态定义。引用保持稳定英文 ID；程序按真实引用闭包分配定义，尚未领取的奖励专用状态不会提前生效。',
  '召唤自己的 resources 仍是召唤局部映射，不属于玩家 registry.resources，保持公开 spawn_summon 契约。状态的非 hold/threshold_execute 触发器可以用 add_card/ensure_card/transform_card 引用 registry.templates；程序把真实引用闭包编译到该状态自身的 creates，AI 不重复输出 creates。生成牌不会立即执行其 effects，模板不能循环生成，状态 stacks 也不会被偷偷捕获为未来卡牌的公式上下文。',
].join('\n');

export function initialDraftTemplateRepairPrompt(plan: InitialTemplateRepairPlan): string {
  return [
    '[一次性指定模板修正；其余内容保持不变]', `SPEC=${INITIAL_TEMPLATE_REPAIR_SPEC}`,
    `SLOTS=${JSON.stringify(plan.slots)}`, `ORIGINAL_DRAFT=${JSON.stringify(plan.original)}`,
    '只返回 {spec,replacements:{t0:完整模板,...}}，恰好覆盖给出的token。模板身份、名称、类型、稀有度、说明及未列入fields的全部字段逐值锁定；不可修改剧情、已持有卡、馈赠或其它定义。',
    '由你依据原说明修正非法根effects中的引用，add_card/ensure_card/transform_card引用ID字符串，不嵌套完整卡。不能删除真实有效的弃牌效果或捏造状态绕过条件。Curse必须省略整个cost；只有确实没有打出效果的不可打出牌才省略根effects，仍保留原discard_effects。没有合法实现时不得伪造占位效果。',
    registryPlacement, formatCompactEffectAuthoringContract('initial-draft'),
    '本次不允许增加定义或修改被锁定字段；全部引用仍需由原registry闭合。程序将重新编译并完整校验，不再追加修正。',
  ].join('\n');
}

export function initialDraftNarrativePrompt(input: { startPrompt: string; config: Record<string, string> }): string {
  return [
    '[爬塔开局：当前 preset 负责引导剧情]',
    isCanonicalTowerStartRequest(input.startPrompt, input.config) ? '' : input.startPrompt,
    `PLAYER_CONFIG=${JSON.stringify(input.config)}`,
    '按照当前酒馆预设的文风和角色设定创作开局正文。交代当前时间、所在位置、角色职业能力和进入高塔的处境，在守门人邀请选择启程馈赠的位置结束。',
    towerDungeonPlanningPrompt(),
    '不要提前结算馈赠、战斗或地图推进；除指定规划块外，不输出 MVU 更新、JSON、卡牌字段或程序结构。后续机制草稿将严格承接这段已经成立的剧情。',
  ].filter(Boolean).join('\n');
}

export function initialDraftAuthoringPrompt(input: {
  startPrompt: string; config: Record<string, string>; narrative: string;
  currentStat: Record<string, any>; designGuidance: string | null;
}): string {
  // Reference first, then the concrete task once, followed by submission checks.
  const { card, towerRequirements, ...characterConfig } = input.config;
  return [
    '# 开局机制草稿',
    `SPEC=${INITIAL_DRAFT_SPEC}`,
    '承接既定 preset 正文，输出完整机制数据；不重新创作剧情，不输出程序派生字段。',
    '## 输出结构与定义位置',
    initialDraftAuthorEnvelopeContract(),
    registryPlacement,
    '## 玩家与馈赠',
    'player.status：按剧情填写 time、location、profession:{name,ability}。player.core：由 AI 确定 emoji、hp、max_hp、lust、max_lust；hp 在 0..max_hp，lust 在 0..max_lust，两个上限为正。程序不代填职业、形象或数值。',
    'player.cards：完整已持有卡组。完全相同的非唯一卡（名称、类型、费用和可执行规则均相同，例如重复造成 6 点伤害）只写一个完整定义，复用同一稳定 id/名称并以 unique:false、整数 quantity:1..100 表达份数；每份会成为独立持有实例，不要为了凑变化另起近义名或新 id。unique:true 的卡 quantity:1；规则、费用或效果不同才是新卡并使用新 id。可选 artifacts/items/player_abilities/player_status_effects/player_lust_effect/level/exp 按公共契约。不要生成敌人、地图、NPC、势力、关系或普通剧情背包。',
    initialDeckAuthoringGuidance(),
    'opening：title、narrative、恰好三项 choices。选项为 {id,label,description?,outcome}，id 唯一。outcome 仅 hp/max_hp/lust/max_lust/gold/card_removals/reward/deck_transforms，可包含非零数值变化、完整奖励或批量永久转化；max_lust 为欲望上限的整数变化（-99..999），结算后上限至少为1，lust 限制在新上限内；不直接结算战斗 block/energy/resource/status/effects。',
    OPENING_TRANSFORM_GUIDANCE.replace('新状态按该候选的 statuses 闭包提供', '本次草稿新状态只在 registry.statuses 定义，编译器生成该替换牌的状态闭包'),
    'reward：仅 cards/artifacts/items 数组。奖励与已持有非唯一卡完全相同时，优先仅写 {card_ref:"已有卡ID",quantity:份数}，程序复制完整效果和依赖而不允许附加覆盖字段；每份会成为独立持有实例。引用只指本次 player.cards 的唯一完整定义，不指模板、其他奖励或历史存档。新卡、改进版、遗物和道具写完整定义，并使用新 ID；不要把规则不同的内容伪装成已有卡副本。',
    '[完整玩法语义与执行契约]',
    formatCompactEffectAuthoringContract('initial-draft'),
    '## 本次输入',
    isCanonicalTowerStartRequest(input.startPrompt, input.config) ? '' : `START_REQUEST=${JSON.stringify(input.startPrompt)}`,
    `PLAYER_CONFIG=${JSON.stringify(characterConfig)}`,
    `ESTABLISHED_NARRATIVE=${JSON.stringify(input.narrative)}`,
    `CURRENT_START_STATE=${JSON.stringify({ status: input.currentStat.status, tower_requirements: input.currentStat.tower_requirements })}`,
    input.designGuidance ? `DESIGN_GUIDANCE=${JSON.stringify(input.designGuidance)}` : '',
    `REQUESTED_CARD_DESIGN=${JSON.stringify(card || '')}`,
    `REQUESTED_TOWER_RULES=${JSON.stringify(towerRequirements || '')}`,
    '[提交前核对实际玩法]',
    mechanismAuthoringReview(),
    '允许语义等价的实现；不照抄未要求的示例机制。状态、资源与模板引用（含奖励依赖）须闭合，不填占位效果。核对不新增输出字段，不输出检查报告或推理过程。',
  ].filter(Boolean).join('\n');
}

export function initialDraftRegistryRepairPrompt(plan: InitialDraftRegistryRepairPlan): string {
  return [
    '[一次性缺失定义补齐；禁止重写已经生成的内容]',
    `SPEC=${INITIAL_DRAFT_REGISTRY_REPAIR_SPEC}`,
    `MISSING_DEFINITIONS=${JSON.stringify(plan.slots)}`,
    `ORIGINAL_DRAFT=${JSON.stringify(plan.original)}`,
    '只返回 {spec,additions:{r0:完整定义,...}}。token 和 id 必须逐字匹配程序列出的槽位；不添加槽位，不修改 player、opening、正文或已存在定义，不通过删除引用或改变实际机制绕过错误。',
    '请按原草稿的真实使用方式与剧情语义补齐各缺失定义。所有新定义的依赖也必须引用已存在或本次被指定补齐的 ID；若再次产生缺失引用，程序会停止，不再追加自动修复。',
    formatCompactEffectAuthoringContract('initial-draft'), registryPlacement,
  ].join('\n');
}
