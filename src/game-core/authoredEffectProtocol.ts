import { DAMAGE_PROTECTION_AUTHORING_CLAUSES } from './damageProtection';
import { battlePresentationContractClauses } from './battlePresentationContract';
import { ABILITY_TRIGGERS } from './battleTriggers';
import { semanticPreservationContract } from './semanticPreservationContract';
import { effectCompositionContract } from './effectCompositionContract';
import { effectTimingRouteContract } from './effectTimingRoute';
import { formulaAuthoringContractClauses } from './formulaAuthoringContract';
import { statusExecutionContractClauses } from './statusExecutionContract';
import { summonAuthoringShape } from './summonAuthoringFields';
import { SUMMON_EFFECT_REWRITE_LIFETIME } from './summonLifecycleDescription';
import { permanentGrowthAuthoringContract } from './permanentGrowthAuthoringContract';
import { EFFECT_PROTOCOL_TIMING_EXAMPLES } from './effectProtocolExamples';
import { eventFilterVocabularyContract } from './eventAuthoringContract';
import { formatCombatResourceAuthoringContract } from './resourceAuthoringContract';
import { formatCompactEffectTargetContract } from './compactEffectTarget';
import { formatAuthoredMechanicDescriptionContract } from './authoredTriggerTiming';
import { formatBattleItemAuthoringContract } from './battleItemUsage';
import { cardExecutionContractClauses } from './cardAuthoringContract';
import { lustEffectExecutionContract } from './lustEffectAuthoringContract';
import { statusEventConditionContract, triggerOwnershipContract } from './triggerEventContract';

export type EffectProtocolPlacement = 'runtime' | 'initial-draft';
export interface EffectProtocolSection { id: string; title: string; clauses: string[] }

/** One semantic reference shared by initial drafts, node generation and repairs.
 * Placement projects definition ownership only; it never changes execution rules.
 * Keep task inputs and error-specific advice out of this reference.
 */
export function compactEffectProtocolSections(placement: EffectProtocolPlacement = 'runtime'): EffectProtocolSection[] {
  return [
    { id: 'containers', title: '内容类型、效果位置与寿命', clauses: [
      effectTimingRouteContract(),
      `${placement === 'initial-draft' ? "正式卡牌与 registry.templates 模板" : "正式卡牌与 creates 模板"}：type=Attack/Skill/Power/Event/Curse；rarity=Common/Uncommon/Rare/Epic/Legendary/Corrupt。所有模板共用这些枚举，不另设 Token/Special 类型或稀有度。`,
      ...cardExecutionContractClauses(),
      '遗物与独立能力：根 trigger:{on,effects}，允许 battle_start/passive。遗物不是卡牌，不写 type:"Relic"；rarity=Common/Uncommon/Rare/Epic/Legendary；Boss/ENS 保留旧内容兼容。节点奖励严格使用程序给出的稀有度。道具、敌人行动和欲望效果使用非空根 effects，不写 trigger。',
      '内容寿命：cards/artifacts/items/statuses 是持久定义；player_abilities/player_status_effects 仅本场，结算清除。battle_start 是时机而非永久寿命。每场自动生效的职业能力应由 AI 创作成已持有遗物及其 trigger，职业说明、单场能力或未领取奖励不能代替。Power 每场需实际打出，战后不保留获得的持续规则；程序不按描述搬移机制或补造遗物。',
      `${placement === 'initial-draft' ? "player.player_lust_effect" : "battle.player_lust_effect 与敌人 lust_effect"}：仅在存在真实欲望体系时生成；一旦生成必填 name/effects，仅可选 ${placement === 'initial-draft' ? "emoji/description/when" : "emoji/description/creates/when"}。这是一次性结算，不直接使用 modify/card_rule。若满溢时强化当前已有召唤物，直接使用独占项 modify_summon 或 modify_summon_effect；确需长期状态时才用 apply_status/apply_summon_status，并在 ${placement === 'initial-draft' ? "registry.statuses" : "本结果 statuses"} 登记完整同ID定义。持续规则放该状态 triggers.hold，不以未登记状态或描述替代实现。`,
      lustEffectExecutionContract(),
      'narrate 仅用于 Event 卡唯一顶层效果：{narrate:"自然中文叙事"}，不写 when/on。其他内容容器不用 narrate。',
      formatBattleItemAuthoringContract(),
    ] },
    { id: 'basics', title: 'effects 结构与目标', clauses: [
      '{wait:true} 表示空过（仍消耗本次行动）；{say:"台词"} 只记录台词，不产生数值效果；{enemy_intent:"行动ID"} 将当前结算敌人的下一次行动改为该敌人 actions 中已有的稳定 ID，不影响其他敌人，禁止引用不存在或其他敌人的行动 ID。可用于现有触发器与条件分支。',
      "id：以字母或下划线开头，仅字母、数字、下划线，同容器唯一。name/source/narrate 用自然中文。未使用的可选字段省略，不写空 effects、空 trigger.effects、空子触发器、null 或占位效果；某操作明确允许的空值除外。description 可省略；若描述机制，须与结构一致。",
      effectCompositionContract(),
      "操作名是 effects 项的主键，不使用通用 operation/target/condition/operator/value/amount/source 包装。条件写该项 when；目标仅在操作允许时写 to/targets。嵌套结构的合法字段以该操作契约为准（如 upgrade_card.changes 的 operator/value、resource 的 amount）。不输出旧 effect 或内部 spec/op/steps；不把 trigger 塞入 effects。",
      formatCompactEffectTargetContract(),
      '基础操作：damage/heal/block/energy/lust/set_hp/set_lust/set_energy/set_block 的值为数值或公式，实体 to 仅 self/opponent。damage 可另写 hits:正整数；damage/lust 默认对方，heal/block/energy 默认自身。生命流失写 {damage:N,damage_type:"hp_loss",to:"self"}，无视格挡；恢复生命用 heal，直接设生命用 set_hp，不使用 hp/lose_hp 或负数 heal。',
      permanentGrowthAuthoringContract(),
      '多敌选择器：targets:{mode:"active"|"by_id"|"all"|"random"|"random_n"|"lowest_hp"|"highest_hp"}。指定实体用 targets:{mode:"by_id",id:"敌人ID"}；random_n 必填内部 count:正整数。random/random_n 可写 allow_repeat:布尔、retarget:"locked"|"each_hit"。绝不能写 targets:"enemies" 或数组，实体ID不写进 to。',
      '多敌方向：targets 省略 to 时选择当前来源可访问的敌群：玩家来源为对方敌人，敌人来源为己方敌群；显式 to 必须一致。敌人攻击玩家不用 targets；治疗指定队友用 to:"self",targets:{mode:"by_id",id:"队友ID"}。',
      '抽牌与牌库查看：{draw:数量}、{scry:数量}、{seek:数量} 只允许同级 when，不允许 to、targets、from、pick、count 或 amount。',
      '基础抽牌修饰：passive/hold 使用 {modify:"draw_per_turn",add|subtract|multiply|divide|set:数值或合法stacks公式}，只调整玩家开局及每回合自动抽牌，结算时向下取整且至少0；主动draw不受影响，固有牌仍按原规则进入开局手牌。按状态当前层数计算，移除状态即失效；即时draw的负数不是少抽牌，limit_draw是每次抽牌上限，不是基础抽牌增减。',
      '状态操作：{apply_status:"状态ID",stacks?:层数,to?:目标}；{remove_status:"状态ID|all|buffs|debuffs",to?:目标}。值为字符串，stacks/to 与操作同级。block/energy/hp/max_hp/lust/max_lust/max_energy 是数值池而非状态ID，不为其补造状态。清空格挡用 set_block:0，增加格挡用 block，其余数值池用对应数值操作。',
    ] },
    { id: 'formulas', title: '公式与局部结果', clauses: [
      ...formulaAuthoringContractClauses(),
      `同段条件收益：${JSON.stringify(EFFECT_PROTOCOL_TIMING_EXAMPLES.localDiscardResult)}。仅本段最近一次 discard 恰好选弃一张手牌且提交时牌型匹配才满足 discarded_card_type；参数为一个合法卡牌 type。多张、非手牌、无牌、取消均不满足。嵌套触发不覆盖父结果；新的触发器没有外层操作结果，延迟结算也不继承。仅用于 when，不读取事件牌型或历史弃牌。`,
'需要把历史事件值用于数值时，在数值位置写真正的 JSON 对象 {history:{metric,scope?,event?,phase?,reason?,source_kind?,source_id?,damage_type?,card_type?,template_id?,card_instance_id?,actor_id?,target_id?}}；metric 只用 count/last_damage/last_hp_loss/last_heal/last_resource_spent/last_turn/last_sequence。history.event 与根 trigger.on 是两套不同枚举：history.event 只用“事件筛选枚举”中的底层事件名；例如伤害记录使用 damage_resolved，不能写 deal_damage/take_damage。history 绝不能被引号包成字符串，键名和值也必须使用合法 JSON 双引号。它读取已提交事件，不读取描述，也不把当前未提交结果重复计数。',
      '状态公式只能读取已经注册且会被真实效果增减的状态。禁止为了代替卡牌类型计数或其他未公开传感器，临时创建 triggers:{} 的“在场/存在”空标记状态；这种状态不会自动跟随战场变化。召唤存在性已有正式字段：条件使用 self.has_summon/opponent.has_summon，数量公式使用 self.summon_count/opponent.summon_count。多敌战斗中的存活非召唤队友使用 self.has_ally/opponent.has_ally 或 self.ally_count/opponent.ally_count；数量排除当前实体自身和召唤物。召唤的群体强化、激活、伤害、治疗与控制仍应直接使用 summon selector。确实需要记录其他跨效果数据时，显式注册资源并由真实效果维护。',
    ] },
    { id: 'cards', title: '牌区、模板与卡牌修改', clauses: [
      '牌区选择：from 只用 hand/draw/discard/exhaust/all/combat；pick 只用 random/choose/left/right/top/bottom/all。left/right 表示手牌在界面中的最左/最右，只能与 from:"hand" 使用；draw/discard/exhaust 是有顺序牌堆，用 top/bottom。from:all/combat 必须配 pick:all。first/last 属于Orb选择而非牌区；“本回合第一张牌”用根 trigger 的正确事件及 ordinal:"first"，不使用牌区位置。绝不存在 pick:"any"。',
      '牌区筛选字段：name/card_type/rarity/cost/min_cost/max_cost/tag/template_id/run_instance_id/combat_instance_id/origin/upgraded/keyword/exclude_keyword/root_only。card_type/rarity/tag/keyword/exclude_keyword 支持单值或非空数组；origin=deck/generated/copied/transformed；keyword/exclude_keyword=retain/exhaust/ethereal/innate。选择带消耗关键词的牌写 keyword:"exhaust"，不是同级 exhaust:true。',
      '牌区操作独占数组项：{discard|exhaust:数量或"all",from?,pick?,筛选字段...}；{recover:数量或"all",from:"discard"|"exhaust",pick?:"random"|"choose"|"all",筛选字段...}；{reduce_cost:数值,count?,from?,pick?,筛选字段...}；{copy|double:数量或"all",from?,pick?,筛选字段...}；{modify_card:"damage"|"block"|"lust"|"stacks",add|subtract|multiply|divide:数值,from?,pick?,count?,筛选字段...}。除copy可写to:"hand"，其余不写to/amount；modify_card不修改hits。',
      '回收与复制：recover 的固定目的地是手牌，不写to/destination，不用top/bottom；指定牌堆位置移动用 move_card 的from/pick/destination/position。copy 复制选中的现有牌并把新副本加入手牌，可省略to，且仅允许显式 to:"hand"，不再add_card。double 不生成副本：给所选现有可用牌一次下次打出的额外结算，打出后移除标记。',
      '现有牌减费：reduce_cost 只在效果结算当下修改已经选中的现有卡牌，不接受 scope，也不会自动影响“下一张牌”。带turn/combat/run等寿命的减费用 patch_card:"cost" 和对应scope，说明须对应选择范围。',
      'patch_card 的值直接是 damage/block/lust/stacks/cost/dynamic_cost/x_value/replay/hits/retain/exhaust/ethereal/innate 之一，并与唯一运算、scope、match、选择字段同级；hits 只写正整数 add，给目标卡自身每段已编译伤害增加命中（每段最多20），不重放抽牌/格挡等副作用，也不改召唤模板。scope 只用 resolution/turn/until_played/combat/run/permanent，match 只用 instance/run_instance/template/filter。cost/x_value 用 add/subtract/multiply/divide/set/min/max；dynamic_cost 还必填 timing:on_draw/while_in_hand/on_play，可写 minimum/maximum；布尔关键词使用 enabled。只有模板或过滤器匹配可写 future_copies。patch_card 绝不是对象。',
      'upgrade_card 的固定浅层形状是 {upgrade_card:数量或"all",changes:[...],levels?,max_level?,scope?,选择字段...}，同级必填非空 changes，scope 只用 combat/run/permanent。每项 change 用 kind:numeric/cost/keyword/replay/hits/x_value/dynamic_cost，再填写该 kind 所需的 stat/operator/value、keyword/enabled、extra、add 或 timing；hits 只接受正整数 add，且只选择具有自身伤害段的牌。不能只增加等级而不改变可执行内容。附着的核心形状是 attach_card:{id,kind,name,scope,changes}，其中 kind 只用 enchantment/affliction，可写 description/emoji/remove_on/remaining/discard_reasons/priority；remove_on 只用 resolution_end/played/discarded/turn_end/combat_end/run_end/manual。changes.kind 可用 numeric/cost/keyword/replay/x_value/dynamic_cost/play_access/discard_auto_play；play_access.mode 只用 deny/allow，discard_auto_play 必填 reasons、failure_destination、only_player_turn。',
      '弃牌触发只把 player_choice/random_effect/effect 视为真实手牌弃牌原因；discard_auto_play.reasons 与 remove_on:"discarded" 的 discard_reasons 只使用这些值。failure_destination 只用 discard/exhaust/draw_top/draw_bottom/hand/remove。回合清理、预见、抽牌堆移动、消耗、生成、复制、变形和自动打出不冒充弃牌。',
      `${placement === 'initial-draft' ? "临时牌模板只在 registry.templates 登记一次，由卡牌、能力、遗物、召唤行动、道具或状态的 effects/trigger/triggers 使用 add_card/ensure_card/transform_card 引用；各内容对象不输出 creates" : "临时牌模板放在使用它的卡牌、能力、遗物、行动、道具或状态定义自身同级 creates。只有同一内容的 effects/trigger/triggers 确实用 add_card/ensure_card/transform_card 引用了模板时才写 creates"}；状态 hold 与 threshold_execute 仍不能生成牌；spawn_summon 已经在自身对象内包含完整召唤定义，绝不需要再把召唤物${placement === 'initial-draft' ? "复制成 registry.templates 卡牌模板" : "复制成 creates 卡牌模板"}。每个模板只使用 id/name，以及可选 emoji/type/rarity/cost/description/effects/discard_effects/unique/retain/exhaust/ethereal；仅当模板 type:"Power" 时才可额外使用根 trigger，Attack/Skill/Event/Curse 模板一律不写 trigger。模板绝不写 quantity、tags、innate 或嵌套 creates，实际生成数量只由 add_card.count 或 ensure_card.minimum 决定。模板内部也不能用 add_card/ensure_card 引用自己，${placement === 'initial-draft' ? "因为临时牌不支持自我生成" : "因为它没有自己的 creates 容器"}；当前公开语法不支持临时牌自我生成；自由设计应在公开能力内组合。若玩家明确要求该机制，只能采用语义等价实现，无法等价表达时不能声称完成，不得用其他牌区、状态或负面牌机制冒充。生成只写 {add_card:"模板ID",to?:"hand"|"deck"|"discard",count?:正整数} 或 {ensure_card:"模板ID",to?:"hand"|"deck",minimum:1..100,include_copies?:布尔}；add_card 的 discard 表示新实例直接进入弃牌堆，不算手牌弃牌，也不会触发 discard_effects。${placement === 'initial-draft' ? "add_card/ensure_card 只能引用 registry.templates 中已完整登记的模板" : "add_card/ensure_card 只能引用同一内容对象自身 creates 中的模板"}，不能引用玩家长期牌组里已有的卡、当前卡自身或另一个持有卡 ID；复制现有牌使用 copy，double 是现有牌的额外结算而非复制，不能先 copy 再用 add_card 重复加入。ensure_card 会扫描四个战斗牌区，默认不把临时复制品计入根实例数量。`,
    ] },
    { id: 'resources', title: '资源与支付', clauses: [
      formatCombatResourceAuthoringContract(placement),
      '费用公式中，spent_energy 表示当前卡牌本次实际支付的能量，固定能量费与 energy X 费都可读取；x_value 只属于 cost:"energy" 的单能量 X 费。凡当前卡牌公式读取 spent_resource.资源ID，该卡 cost 必须是包含同一资源ID的费用对象；读取 x_resource.资源ID 时，该对象中的同一资源ID还必须写成 "all"。cost:"energy" 只会支付能量，绝不会支付任意自定义资源。若只是读取资源池当前值而不消费它，改读 self.resource.资源ID.current，不得使用 spent_resource。复合费用含 energy:"all" 时用 x_resource.energy，不能再用 x_value。延迟、触发器、当前姿态或姿态槽中的姿态等脱离当前出牌支付上下文的效果不得读取任何 spent_resource/x_resource/x_value。',
    ] },
    { id: 'persistent', title: '持续规则', clauses: [
      '持续修饰：{modify:"damage"|"damage_taken"|"lust"|"lust_taken"|"heal"|"block"|"summon_capacity"|"draw_per_turn",add|subtract|multiply|divide|set:数值}。modify 为属性字符串，只配一种运算，不写 scope/selector/targets/stat/attribute/event；不存在 scope:"summon" 或 modify:"summon_damage"。',
      '持续数值只由常数和当前状态层数组成。状态自身 hold 中读取层数必须写裸 stacks，不读 self.status.ID.stacks。Power/遗物/能力的 passive 无状态层数上下文，使用常数。百分比写倍数：提高50%用 multiply:1.5，降低20%用 multiply:0.8，不写带百分号的字符串。',
      'card_rule 的值同样直接是规则字符串，绝不能写成对象。replay 配 limit:数量或"all"、extra:正数、筛选字段，每回合前N张匹配牌额外完整结算，费用只付一次；free 配 limit:数量或"all"、可选 resources:"all"|资源ID数组及筛选字段，免除费用。',
      '其他 card_rule：retain_hand/retain_block 不写 limit；limit_draw/limit_block_gain/limit_energy_gain 写非负 limit；deny_card_play/allow_card_play 至少一个筛选字段；limit_card_play 配筛选字段和非负 limit；card_destination 配筛选字段、destination、可选 priority。不需要的筛选字段省略，绝不写 name:""、origin:""、空数组或null。',
      '持续规则位置：modify/card_rule 仅在 Power/遗物/独立能力的 passive 或状态 triggers.hold；普通 Attack/Skill/Event/Curse 的根 effects 绝不能直接放 card_rule。card_rule 本身没有 scope:"turn"；card_rule 不接受 when/on；card_rule 额外不接受 trigger 专用的 ordinal/n/scope/event/phase/reason/source_kind/source_id/damage_type。limit 表示每回合前N张，“每回合第一张”只写 limit:1。',
      `条件持续规则通过状态存在与否控制：apply_status/remove_status、stacks_change 决定寿命，规则放 triggers.hold。普通 Attack/Skill 实现“本回合下一张或前N张牌免费/重放”：根 effects 写 {apply_status:"临时状态ID",stacks:1,to:"self"}，在 ${placement === 'initial-draft' ? 'registry.statuses' : '同一结果 statuses'} 中登记该状态，hold 放 card_rule，根 stacks_change:"reset" 使其回合末清除；说明与此时机一致。`,
    ] },
    { id: 'events', title: '事件与状态生命周期', clauses: [
      `根 trigger.on 只能逐字使用这些公开触发名：${ABILITY_TRIGGERS.map(value => `"${value}"`).join('、')}。turn_started、turn_ended、card_drawn、damage_resolved、status_applied 等是 event 筛选值，绝不能写进 on；例如回合开始固定写 on:"turn_start"，只有需要事件筛选时才另写 event:"turn_started"。`,
      `结构化 trigger 的时机对照（数值仅示例）：每回合首次弃攻击牌 ${JSON.stringify(EFFECT_PROTOCOL_TIMING_EXAMPLES.firstAttackDiscard)}；每回合首次打出技能牌 ${JSON.stringify(EFFECT_PROTOCOL_TIMING_EXAMPLES.firstSkill)}。不能写成 turn_start 加计数条件，也不能用普通技能牌的即时收益代替监听。状态事件没有 trigger.card_type 等结构化筛选字段。`,
      '精简触发器通常省略 event、phase 和由 on 唯一确定的 card_type，程序会补出，不需要 AI 重复填写。如果显式写这些字段，必须与 on 一致：出牌、抽牌、弃牌、消耗和 kill 为 after，其余可筛选触发为 resolve；公开触发没有 before 阶段。first/first_n/nth/every_n 只数真正分发该触发的事件：区分牌型、精确来源/持有者、增益/减益和主动弃牌；一次出牌的 before/after 不计成两次。team 序数按该触发的来源阵营或接收阵营计数；普通 history 查询仍是底层日志查询，统计出牌次数时应明确 phase:"after"，不能把两阶段当两张牌。',
      '抽牌、返还能量、造牌会扩大后续行动，伤害触发抽牌尤其要评估多段攻击、群攻和零费循环。默认优先用 scope:"turn",ordinal:"first_n",n:正整数 限制每回合前 N 次收益；也可用费用、消耗或有限资源形成明确代价。允许无次数限制的强力组合，能自行维持抽牌/能量循环的设计应倾向最高稀有度 Legendary 并考虑获得阶段。这是生成设计指导，不是禁止强卡或自动改写合法卡牌的硬门槛。卡牌 description 不重复计数范围、事件字段等实现术语，必要次数由结构化规则显示。',
      eventFilterVocabularyContract(),
`事件筛选只用于拥有持久事件的触发：turn_start/turn_end、出牌与牌区事件、生命/欲望/格挡变化、获得或失去增益/减益，以及 kill。可选筛选字段只用 scope/ordinal/n/event/phase/reason/source_kind/source_id/damage_type/card_type/template_id/card_instance_id/actor_id/target_id；scope 只用 turn/combat/run/card_instance/team，ordinal 只用 first/first_n/nth/every_n，first 不写 n，first_n/nth/every_n 必填正整数 n；first_n 表示范围内前 n 次；枚举见事件筛选枚举。回合开始/结束分别匹配 event:"turn_started"/"turn_ended"，出牌匹配 event:"card_played"，伤害/治疗分别匹配 event:"damage_resolved"/"heal_resolved"，状态获得/失去分别匹配 event:"status_applied"/"status_removed"。kill 固定匹配 event:"entity_defeated"、phase:"after"：它只在持有者实际击败敌人后分发，玩家持有者只计玩家本体击败，召唤持有者只计该召唤击败；可用 source_kind/source_id 等现有字段筛选击杀来源，不能拿死亡者的 defeated 冒充击杀。trigger.on 的 deal_damage/take_damage/deal_heal/take_heal 是面向内容的触发名，绝不能照抄进 event；方向由触发器本身以及 actor_id/target_id 表达。deal_damage/deal_heal 等是精确来源实体的本地事件：玩家能力只响应玩家本体，召唤能力只响应该召唤；需要“召唤命中后让主人获益”时把 trigger 写在召唤 ability 上，再用 summoner_effects 给主人效果，不创建虚假状态标记。battle_start/ability_gain/defeated/passive 不写任何事件筛选。`,
      '状态定义固定为 {id,name,emoji,type,description?,stacks_change?,tick_timing?,maxStacks?,stun?,character_emoji?,protection?,triggers}，type 只用 buff/debuff/neutral。tick_timing 只可省略（默认 before_action）、before_action 或 after_action；triggers.tick 仅在持有者自身行动前/后执行，不是 turn_start/turn_end，且 stacks_change 仍只在持有者回合末衰减一次。生命周期键包括 apply/stack/tick/remove/hold/threshold_execute；状态事件键包括 battle_start/ability_gain/turn_start/turn_end/card_played/attack_played/skill_played/power_played/on_discard/on_exhaust/on_draw/on_shuffle/take_damage/take_heal/deal_damage/deal_heal/lust_increase/lust_decrease/deal_lust_increase/deal_lust_decrease/gain_buff/gain_debuff/lose_buff/lose_debuff/enemy_gain_buff/enemy_gain_debuff/enemy_lose_buff/enemy_lose_debuff/gain_block/lose_block/defeated/kill。每个已写触发键的值直接是非空浅层效果对象或非空数组，禁止包成 {on,effects}、{effects:...} 或 {when:条件,effects:...}。数组各项的 when 在执行到该项时重新判断，不是事件开始时的快照。共享条件仅在前序效果及其触发联动不会改变条件真假时才能逐项复制；有支付、状态移除或其他依赖时，必须保留判断时机和先后关系，不能机械展开。一次判断后顺序执行使用 guard 条件组，见组合契约；必须保留原组边界及子条件，不删除条件或收益。不能让状态事件值只剩 when，也不能为了通过校验删除原操作。threshold_execute 是回合末独立处决阶段，只允许 {execute:阈值,threshold_mode?:"hp"|"hp_percent",to:"self"} 或 {kill:true,to:"self"}，必须作用状态持有者、不得写 targets，也不得混入其他操作。只写真正有作用的键，没有效果的键必须完全省略，绝不能写 [] 或 {}。根 triggers 只有在状态仅靠 stacks_change/stun/character_emoji/protection 工作时才可为空对象。',
      ...statusExecutionContractClauses(),
      statusEventConditionContract(),
      triggerOwnershipContract(),
      'battle_won/victory/battle_end 等战后阶段不是 when 变量，也不是公开 trigger.on。卡牌、状态、遗物或能力不能承诺“战斗胜利后”再执行战斗内效果；胜利后的内容必须由节点 reward/结算事务承担。无法用当前战斗公开变量表达的条件不要生成，不得发明裸标识符或空状态作为替代。',
    ] },
    { id: 'advanced', title: '选择、预约、重放、当前姿态与姿态槽', clauses: [
      `预约效果写 {schedule:非负等待回合,phase:"turn_start"|"before_draw"|"after_draw"|"turn_end",effects:届时执行的浅层效果,repeat_every?:正整数,repeats?:正整数,priority?:整数}；持续预约必须同时写 repeat_every 与 repeats。自动出牌写 {auto_play:数量或"all",from?,pick?,free?:布尔,筛选字段...}，默认从抽牌堆顶免费打出；当前牌结算去向写 {card_destination:"discard"|"exhaust"|"draw_top"|"draw_bottom"|"hand"|"remove"}。移动写 {move_card:数量或"all",destination:"hand"|"draw"|"discard"|"exhaust",position?:"top"|"bottom",选择字段...}；移除写 {remove_card:数量或"all",选择字段...}；变形写 {transform_card:"${placement === 'initial-draft' ? "registry.templates 中的模板ID" : "同一 creates 中的模板ID"}",选择字段...}。`,
      '当前这张非 Power、非 Event 卡要在本次打出中再次完整结算，使用独占数组项 {replay_current:正整数或合法数值公式,when?:条件}。条件只放在 when，replay_current 不写三元式；例如“本回合打出过技能牌则重放一次”固定写 {replay_current:1,when:"skills_played_this_turn > 0"}，不要把同一条件再次写成 replay_current:"skills_played_this_turn > 0 ? 1 : 0"。当前牌整段原效果先正常结束，再额外完整结算 N 次；费用只付一次，重放沿用第一次的实际支付资源和 X 值，每次都产生正常出牌事件并触发卡牌、状态、遗物与能力联动，最终牌区移动只发生一次。重放中再次遇到 replay_current 不继续追加，并受安全上限约束。它只允许出现在当前卡牌直接主效果，绝不能放进 Power、Event、trigger、discard_effects、状态、遗物、能力、敌人行动、召唤行动或 schedule。禁止写 {replay:true}，也禁止用重复伤害或 double/patch_card:"replay"/card_rule:"replay" 改变原意：后三者分别修改选中卡牌或后续规则，不等于当前牌现在完整再结算。',
      '固定分支选择写 {choose:"稳定英文ID",count?:正整数,options:[{id,label,effects},...]}，options 至少 1 项、id 互不重复且每项 effects 非空；count 省略为 1，且必须不超过 options 数量。它表示让玩家从预先写好的不同效果分支中选 count 项，所选分支按 options 的书写顺序执行。它不用于选择牌区中的卡牌：选择手牌、抽牌堆、弃牌堆或消耗堆中的卡，必须在对应 discard/recover/modify_card/copy/double/auto_play 等牌区操作同级写 pick:"choose" 与 from/筛选条件，绝不能另写 options。当前姿态写 {stance:{id,name,emoji?,description?,enter?,exit?,passive?,events?},to?} 或 {stance:null,to?} 退出；enter/exit 是一次性效果，passive 只含持续 modify/card_rule。向姿态槽充能写 {channel_orb:{id,name,emoji?,description?,value,passive?,evoke?},to?}；evoke_orb 写激发数量或 "all"，数量可配 pick:first/last，"all" 只配 pick:all 或省略；orb_slots 写 0..20；modify_orb:"value" 与唯一 add/subtract/multiply/divide 同级，并用 pick/count/orb_id 选中姿态。姿态槽内的姿态公式额外可读 orb_value。',
      '姿态的事件型收益写 events:[{on,effects,scope?,ordinal?,n?,event?,phase?,reason?,source_kind?,source_id?,damage_type?,card_type?,template_id?,card_instance_id?,actor_id?,target_id?}]，1..16项，沿用公开非passive能力触发器及筛选契约。不要放到 passive.trigger。例：{stance:{id:"balanced_flow",name:"均衡气流",events:[{on:"attack_played",scope:"turn",ordinal:"first",effects:{resource:{id:"pressure",amount:1}}}]}}，其中pressure须在玩家资源库定义。events只在本次姿态仍生效时监听，退出或切换即停用，不会留下永久能力；同ID重复进入不重新触发enter、也不重置计数。事件开始后新获得的姿态不追溯响应该事件。first表示整个scope范围内首次，不是进入姿态后首次。events效果中的self为姿态持有者，普通目标默认值适用；不需要且不支持self.has_stance函数。未来事件不捕获原卡的spent_energy/x_value/spent_resource或状态stacks，不放永久on注册、当前卡replay_current或持续modify/card_rule。程序自动管理姿态实例编号，AI不输出实例编号或内部计数。',
      '姿态身份条件可写 when:"self.stance == \'balanced_flow\'" 或 opponent.stance != null，也可作三元公式的条件；仅支持与稳定姿态ID字符串或null进行相等/不等判断，可组合&&/||/!。null才表示无姿态，字符串\'none\'只是字面ID。self/opponent按当前效果来源绑定，召唤物自身不继承主人姿态；在summoner_effects内才读取主人。姿态身份不是数值，不参与大小比较、加减或函数调用；AI不新增stanceId字段。叙述中的条件和每个分支的数值、操作必须与effects逐项一致，不用描述补写未实现的分支。',
      "姿态条件不扩大公式上下文：持续 modify 仍只读常数和当前状态 stacks，不接受 when 或姿态判断。",
    ] },
    { id: 'summons', title: '召唤与敌群', clauses: [
      `定义：${summonAuthoringShape(placement)}。count 在 spawn_summon 内，to 在外层且默认 self；未用可选字段省略。`,
      '生命：有生命用正数 max_hp；无生命写 has_hp:false 并省略 max_hp。不输出 hp、顶层 trigger 或旧存档单数 action。',
      '行动：actions 始终为数组，各项 effects 非空；weight 为正数相对权重，when 为合法条件。abilities 使用 trigger:{on,effects}，不支持 passive。行动/能力的 fixed:true 表示不受召唤效果强化；两者全无的外壳不算召唤玩法。',
      '数值：actions_per_activation 为0..20整数，action_priority/speed 为-999..999整数，block 非负。tags 为唯一稳定ID数组，最多32项。capabilities 仅含 selectable/accepts_status/acts/intercepts 布尔字段；retain_corpse 为布尔值。',
      '生命周期：intercept 仅 {mode:"unblocked_attack",priority?:整数,max_per_turn?:正整数}。on_existing=reinforce/replace，on_defeated=new_instance/revive_reset/revive_reinforce，二者均要求稳定 slot。overflow=reject/replace_oldest/replace_lowest_hp。',
      '局部属性：resources 为资源ID到 {name,emoji,max,refresh:"reset"|"retain",start?或current?} 的映射；modifiers 仅含 damage_modifier/damage_taken_modifier/lust_damage_modifier/lust_damage_taken_modifier/heal_modifier/block_modifier 有限数值。',
      '召唤物的具体主人身份由程序在创建时记录，并随战斗存档保存，AI绝不输出summonerId/summoner_id/ownerId。summoner_effects始终作用于该具体主人，不随选中的敌人变化；主人已死亡或旧存档身份不明时明确提示未执行，不转给其他敌人。同一slot只在同一个具体主人内强化/复活。copy_summon的to:"same"保留原具体主人；to:"self"或"opponent"则绑定该接收方，复制体不占用原随从的唯一slot。',
      '选择器：selector={owner?:"self"|"opponent"|"any",pick?:"left"|"right"|"random"|"random_n"|"choose"|"all"|"lowest_hp"|"highest_hp"|"by_id"|"source",count?,id?,template_id?,tags?,slot?,include_untargetable?}。owner 默认 self，pick 默认 left，仅 random_n 写 count。source 只在当前召唤物自身触发的 effects 内使用，精确指向该实例，脱离该上下文时不选取任何单位，绝不按模板或随机回退。tags 为唯一非空稳定ID数组，与召唤定义的 tags 精确匹配；选择已知种类优先用 template_id，不能凭中文类别猜 tags。',
      '空选择：没有匹配召唤时操作不产生效果，无须额外判断。仅当存在性决定另一收益时，when 使用 self.has_summon/opponent.has_summon，数值使用 self.summon_count/opponent.summon_count；这些是字段，不是函数。',
      '若一张卡必须在某个指定召唤模板仍在场时才能打出，在卡牌根部写 requires_summon:"模板ID"。它在扣费前检查，缺失时卡牌不可打出；不能用 effects.when 冒充出牌门槛。',
      [
        '操作索引（运算键 add/subtract/multiply/divide/set 按该行范围只选一个）：',
        '',
        '| 实际意图 | effects 独占项 |',
        '| --- | --- |',
        '| 召唤对敌人输出 | 召唤 actions/abilities 内普通 damage/lust/apply_status，不是 damage_summon |',
        '| 外部效果伤害/治疗召唤 | {damage_summon:{selector,amount}} / {heal_summon:{selector,amount}}，不写裸数值，selector 不外移 |',
        '| 修改召唤本体 | {modify_summon:{selector,stat,add/subtract/multiply/divide/set}}；stat=max_hp/block/actions_per_activation/speed/action_priority |',
        '| 修改召唤行动输出 | {modify_summon_effect:{selector,stat,add/subtract/multiply/divide}}；stat=damage/block/lust/stacks |',
        '| 增减/设定召唤资源 | {summon_resource:{selector,id,amount}} / {set_summon_resource:{selector,id,value}} |',
        '| 施加/移除召唤状态 | {apply_summon_status:{selector,id,stacks?}} / {remove_summon_status:{selector,id}} |',
        '| 激活/命令/遣散/复制召唤 | {activate_summon:{selector}}；单次命令 {activate_summon:{selector,action:{id,name,effects}}}（行动归属所选召唤）/ {dismiss_summon:{selector,retain_corpse?}} / {copy_summon:{selector,to?,capacity?,overflow?}} |',
        '| 召唤给主人收益 | 仅召唤自己的行动/能力内 {summoner_effects:浅层效果}，不是普通 to:self |',
      ].join('\n'),
      `强化边界：两种 modify_summon 操作只修改执行时选中的现有召唤，不影响未来召唤；不能放 passive/hold，可由状态 apply/stack 执行。modify_summon_effect ${SUMMON_EFFECT_REWRITE_LIFETIME}。一次执行不等于只生效一次；仅下次或本回合强化须另有可执行的次数消耗或到期恢复，不能删改时效承诺掩盖缺失。获得格挡用本体 stat:block；伤害强化用输出 stat:damage。不存在 block_summon，也不把 damage_modifier/attack/attack_modifier 当作这两个操作的 stat。`,
      '动态增援固定写成独占项 {spawn_enemy:{完整敌人字段...,count?:数量,capacity?:场上容量}}。count/capacity 必须位于 spawn_enemy 的值对象内部，绝不能写成 {spawn_enemy:{...},count:1,capacity:3} 的外层同级字段。完整增援敌人必须含稳定 id、中文显示字段、hp/max_hp/lust/max_lust、非空 actions 与行动模式；只有其自身存在真实欲望体系时才附带闭合的 lust_effect:{name,effects}。abilities/status_effects 仅在实际需要时填写。增援进入正式敌人集合并参与胜负，不能用 spawn_summon 代替。处决使用 {execute:生命阈值,threshold_mode?:"hp"|"hp_percent",to?} 或 {kill:true,to?}；额外回合使用 {extra_turn:正整数或公式,to?}，强制结束回合使用 {end_turn:true,to?}。所有复杂操作都必须独占 effects 数组项。',
      '初始敌人可选 escape_when:条件公式。条件成立时先显示准备逃跑，到该敌人下一次行动前才离场；它不是死亡，不触发击败/击杀。初始敌人可选 defeat_reward:{cards?:完整卡牌数组,artifacts?:完整遗物数组,items?:完整道具数组,gold?:非负整数}，只在该原始敌人实际击败时发放。增援、分裂和复制敌人不会携带 defeat_reward；不要把掉落写进 spawn_enemy。',
      '协作敌人应设计同伴死亡后的行为：支援行动使用互补 when 分支，例如有队友时施加增益，self.ally_count == 0 时反击玩家；或使用 escape_when:"self.ally_count == 0" 预告逃跑。不能反复给已死亡的固定目标赋予效果。依赖指定队友时用可执行选择器条件判断其存活，不用说明文字代替。description 用中文介绍怪物并暗示其支援、失去同伴后的反应、逃跑或携带宝物。适合携带宝物的精英、运输者、稀有怪可主动设计 defeat_reward 专属掉落；逃跑既不发专属掉落，也扣除该原始敌人对应的基础金币份额。不要给所有敌人机械添加相同套路。',
    ] },
    { id: 'damage-protection', title: '同队保护与伤害分摊', clauses: [...DAMAGE_PROTECTION_AUTHORING_CLAUSES] },
    { id: 'presentation', title: '说明与语义', clauses: [
      ...battlePresentationContractClauses(),
      semanticPreservationContract(),
      formatAuthoredMechanicDescriptionContract(),
    ] },
  ];
}

export function formatCompactEffectProtocol(placement: EffectProtocolPlacement = 'runtime'): string {
  return compactEffectProtocolSections(placement)
    .map(section => '## ' + section.title + '\n' + section.clauses.join('\n'))
    .join('\n\n');
}
