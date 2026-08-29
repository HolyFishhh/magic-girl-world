# 剧情模式卡牌与敌人平衡创意辅助器

研究、架构、实现与校准报告  
项目：魔法少女世界  
日期：2026-08-29  
受众：角色卡作者、战斗系统开发者、世界书维护者  
范围：剧情模式的卡组评分、敌人生成预算、流派演化、谱系连续性与 MVU 接线；不评价具体题材  
重要假设：战斗运行时和公开效果 DSL 是唯一可执行事实；当前生命属于本场资源，最大生命属于长期构筑  
状态：v3 程序评分、奖励流派规划与确定性校准阶段

## 执行摘要

本项目需要解决的不是“为每点伤害规定一个固定价格”，而是让第二阶段 MVU 在高度自定义、剧情驱动的前提下，持续生成有挑战、有反制、有构筑关联且不重复的卡牌、敌人与奖励。调研和代码验证表明，单一静态公式会误伤纯欲望、玻璃大炮、弃牌、X 费、条件牌和自定义状态等合法构筑；完全依赖生成模型自行判断，则会重复出现数值失控、机械换皮、奖励无选择、敌人无终结渠道及重置长期变量等问题。

本报告采用“三层设计导演”方案：

1. 硬合法性由现有 TypeScript 契约、效果运行时和事务边界裁决。
2. 平衡风险由静态画像、确定性多策略影子模拟和真实战斗反馈评估。
3. 创意质量由机械指纹、压力维度、行动熵、近期重复与奖励选择质量评估。

AI 仍是候选设计师，程序是裁判。生成前，程序把多回合分布、标准探针前沿、难度百分比、敌人共享预算、流派向量和谱系记忆注入第二阶段 MVU；生成后，可选校准完全由程序按真实影子模拟调整敌人数值，不再让模型重写敌人。契约非法仍走现有 MVU 修复流程。这样既能提高挑战质量，又不会把“没有防御牌”“没有治疗”之类设计偏好错误升级为硬门禁。

本轮已完成 v3 实现并通过自动化长流程验证。卡组画像记录第 1/2/3/5/8 回合输出、防护、恢复、看牌、能量与死手分布，并以六类标准压力探针形成约 100 分的参考前沿；难度系统提供 10/50/80/100/110% 五档敌人预算。流派图谱现有 62 个机械节点，支持单卡多亲和、边际构筑贡献、整组占比、通用散卡和相邻演化。奖励规划把候选区分为深化、相邻桥接、渐进转向与通用散卡，并在生成后计算真实卡组分数增量、流派亲和、新颖性和结构重复。敌人谱系只在剧情明确关联时保存招牌行动与机械主题。普通刷新把昂贵画像放到渲染后的后台任务，并以有界缓存和内容指纹避免重复计算。

## 1. 研究问题与边界

### 1.1 核心问题

需要同时满足以下目标：

- 剧情事实优先：正文中的先手命中、当前伤势、身份、环境和已建立能力必须进入战斗初始状态。
- 构筑自由：不要求固定攻击、防御、治疗比例，不限制题材和状态名称。
- 可执行：所有效果必须使用统一 DSL，卡牌展示、战斗结算和模拟不能各自实现一套公式。
- 有挑战：避免无准备秒杀、纯堆生命、无限拖延以及敌人没有击败玩家的渠道。
- 有决策：不同策略应产生可观察差异，敌人应有可读意图和反制窗口。
- 有成长：奖励既能补足风险，也能强化主轴或提供转向，不能只是同一机械换皮。
- 可持续校准：实际胜负、回合数、结束生命和欲望应影响后续遭遇，而非只看单场静态数据。

### 1.2 明确不做的事情

- 不建立具体卡牌、敌人或题材范本库来约束 AI。
- 不把公开游戏的总体胜率直接复制为本项目目标。
- 不保存或展示模型私有思考链。
- 不让剧情模型修改变量、计算公式或决定战斗结算。
- 不因卡组缺少传统防御、治疗或牌数偏多而报错。
- 不在战斗开始后动态作弊；所有适配只影响下一次生成。

## 2. 研究方法与证据

本研究分三路进行：第一，复核 SillyTavern 和 Tavern Helper 的提示、世界书、后台生成与变量能力；第二，查阅 Mega Crit、Wildfrost、Monster Train、Griftlands、Hades 和 Magic 设计资料；第三，查阅程序化内容生成与 AI 玩家评估研究，并把结论映射到当前代码和历史聊天夹具。

SillyTavern 官方文档明确说明 World Info 是动态提示插入工具，可以引导模型，但不能保证内容一定出现在输出中；同时建议条目保持简洁以节省上下文。[S1] 因此世界书适合放生成方向和公开 DSL，不适合承担最终格式、合法性或平衡裁决。其推理文档还指出 reasoning 会占用输出 token，推理模型通常需要更高 token 上限。[S4] 第二阶段 MVU 应只返回固定短分析和变量命令，不要求展开长思考。

Tavern Helper 的社区接口提供 generation id、独立 prompt 排序、聊天历史限制、流事件、JSON Schema 和工具定义等能力。[S5] 当前项目已有稳定的 MVU 额外模型和重试事件，因此本版继续使用现有通路；未来可把独立 JSON Schema 作为备用，而不是为了平衡器立即替换整条生成链。

Mega Crit 公布的 2026 年数据包含约 2.4 亿次 Slay the Spire 2 游玩，总体胜率约 25%，A0 约 16%，A10 约 17%；同文对比 StS1 A0 约 9%、A20 约 3%。[S8] 这些数字受玩家选择、熟练度和模式构成影响，不能直接作为剧情模式目标，但足以说明必须按玩家和难度分层。Mega Crit 还公开提到移除一个“微观决策有趣但复杂度过高”的 Boss，[S9] 以及禁止在同一张卡上叠加附魔，以降低单卡滚雪球，强调 deckbuilding 而非 cardbuilding。[S10]

Wildfrost 把可见计数器和提前规划作为核心；Monster Train 展示了空间、推进和固定种子挑战可以制造不同于单纯伤害的压力；Griftlands 与 Hades 则表明失败、关系、循环成长和剧情记忆都能成为持续内容，而不是流程中断。[S14–S17]

程序化内容生成研究建议把内容编码为候选，再由显式质量函数评估；体验驱动 PCG 进一步要求质量函数结合玩家模型和实时体验。[S18][S19] 多策略 AI 玩家研究显示，单一最优代理不足以代表真人，不同策略代理能发现职业和敌人类型之间的特定失衡；AI 表现分布也可预测难度与参与度。[S20][S21]

## 3. 设计决策

### 3.1 三层导演

| 层级 | 负责内容 | 失败处理 |
|---|---|---|
| 硬合法性 | Schema、ID、引用、目标、效果可执行性、有限数、事务安全 | 阻止进入战斗，复用 MVU 修复 |
| 平衡风险 | 构筑画像、敌人预算、影子胜率、爆发、死手、真实战绩 | 当前仅软诊断，影响下一次生成 |
| 创意质量 | 机械指纹、压力维度、行动熵、反制窗口、奖励选择差异 | 软诊断，建议局部替换而非重建 |

硬门禁只覆盖“无法运行或必然破坏状态”的问题。平衡和创意指标在获得足够真人数据之前保持影子运行，避免模型化估算误伤合法构筑。

### 3.2 不使用万能点数公式

一张牌的价值依赖费用、牌序、当前手牌、敌人意图、状态层数、遗物、触发次数和整副构筑。固定换算会错误估值动态公式和组合收益。本实现复用 `analyzeContentScenarios` 与统一效果描述，提取输出、防护、续航、抽牌、能量、状态和动态指标；复杂效果降低模拟置信度，而不是假装精确。

### 3.3 机械指纹忽略题材

机械指纹忽略 ID、名称、emoji、描述、稀有度和叙事来源，但保留类型、费用、数量、效果、触发器、目标、状态引用和行动模式。于是只换名称或世界观不会改变平衡结果；真正改变目标、公式、触发或牌区行为才会形成新机械。

### 3.4 压力而非题材分类

敌人画像使用爆发、消耗、成长、控制、资源、牌库污染、反应、阶段、群体和欲望等机械维度。题材仍完全由剧情决定。辅助器同时计算行动熵、最大行动概率、功能多样性、峰值伤害、欲望满溢伤害和反制窗口，能识别“动作很多但实战仍只会重复一种”的情况。

## 4. 已实现系统

### 4.1 核心文件

| 文件 | 作用 |
|---|---|
| `src/game-core/contentDesignAssistant.ts` | 构筑、敌人、遭遇、奖励和实战反馈的统一评估 |
| `src/game-core/contentFingerprint.ts` | 与表现文本无关的机械指纹 |
| `src/game-core/encounterShadowSimulation.ts` | 四策略、确定性种子的影子模拟 |
| `src/game-core/deckPowerProfile.ts` | 多回合分布、六类标准探针和长期卡组总分 |
| `src/game-core/encounterBalance.ts` | 难度预算包、当前资源封顶和确定性数值校准 |
| `src/game-core/archetypeGraph.ts` | 62 节点流派知识图谱、单卡多亲和与演化建议 |
| `src/game-core/rewardArchetypePlanner.ts` | 奖励四类方向、候选边际分数、流派亲和和单卡构筑贡献 |
| `src/game-core/encounterLineageMemory.ts` | 有界敌人谱系、招牌行动和主题机械继承 |
| `src/runtime/contentDesignContextAdapter.ts` | 从 MVU 快照生成并写入程序只读上下文 |
| `src/runtime/automaticBalanceCalibration.ts` | 不调用模型的生成后敌人数值校准与防重复写回 |
| `src/runtime/battleSettlementAdapter.ts` | 保存真实胜负、回合与结束状态 |
| `src/fish/core/battleEndHost.ts` | 把真实战果加入奖励方向简报 |
| `scripts/calibrate-tavern-content.mjs` | 在线或离线读取聊天变量并输出校准报告 |

### 4.2 构筑画像

快速构筑画像包含：

- 胜利方式：生命、欲望、混合或特殊。
- 主轴机制：优先状态与实际操作，过滤仅表示表现位置的弱标签。
- 节奏、生存、资源、稳定性和复杂度。
- 当前牌组数量和机械指纹。

权威 v2 画像进一步保存第 1/2/3/5/8 回合的生命输出、欲望压力、减伤、治疗、看牌、能量盈余和死手率，并对稳定压力、预告爆发、后期成长、控制税、欲望压力和多目标六类探针求风险前沿。纯欲望、玻璃大炮、弃牌和 X 费测试均不会因缺少传统防御或治疗产生硬错误；未完整覆盖的复杂机制会降低置信度，而不是被错误计为零价值。

### 4.3 敌人与遭遇画像

敌人画像包含期望生命伤害、期望欲望压力、格挡、峰值、动作多样性、行动熵、最大动作概率、压力维度、行动节奏和反制窗口。遭遇预估包含预计击杀回合、预计承压回合、目标回合带和置信度。

生成前预算把卡组总分乘以 10/50/80/100/110% 难度，并给出有效耐久、逐回合生命/欲望/格挡压力、爆发上限、成长上限、控制预算、目标战长和反制窗口。当前生命和当前欲望只影响本场可行性封顶，不改变长期卡组分。当前重点诊断包括：

- 无准备秒杀风险。
- 玩家通常在完成胜利循环前被压垮。
- 战斗几乎无压力或结束过快。
- 行动功能重复或概率过度集中。
- 持续施压但没有观察和反制窗口。
- 纯欲望积累但满溢后没有实际终结压力。
- 与近期遭遇的压力、节奏和机械签名重复。
- 条件、触发和状态堆叠造成可读性过载。

### 4.4 奖励选择质量

生成前的奖励计划读取当前卡组总分、主要流派、短板维度和相邻演化，给出深化、相邻桥接、渐进转向与通用散卡四类软方向。生成后的每项候选按“加入当前牌组一张”重新计算快速卡组分，得到真实边际分数变化，同时计算流派亲和、桥接或转向归属、短板收益、新颖性与结构重复。普通页面还能显示当前每种卡牌移除一张前后的构筑分差，负贡献对诅咒和严重卡手同样有效。

奖励候选还会计算机械唯一数、角色多样性、与构筑主轴的关联和相对复杂度。当前软诊断包括：

- 机械结构相同、仅名称和表现不同。
- 在费用和复杂度不高的情况下，一项候选全面覆盖另一项。
- 多项候选集中在同一操作角色，缺少真实选择。

动态公式、X 费、条件牌和弃牌收益不会参与静态严格支配判定，因为它们需要模拟和上下文。奖励不要求固定“攻击、防御、治疗”三分法，也不要求每张候选绑定当前最高占比流派；通用散卡是正式选择方向，不是识别失败的残余类别。

### 4.5 流派图谱与谱系记忆

图谱以可执行机械而非题材建立 62 个节点。卡牌可以同时支持多个流派，整副牌组保留各流派占比与通用散卡占比；奖励可以深化、补收益端、桥接相邻节点或提供通用散卡。不同叙事名称但相同运行时结构不会被算作新流派。

个人 Skill `maintain-card-archetype-graph` 提供可复用维护流程和确定性扫描器：扫描效果操作与图谱引用，报告新增或未覆盖原子、重复结构、悬空邻接和候选组合，再要求按运行时事实更新特征提取、节点、邻接、反协同及回归测试。新增机制不会直接自动写成几十个重复流派，而是先经过“是否改变实际决策、是否形成启动与收益循环、是否只是通用散卡”的门禁。

敌人谱系采用显式关系：只有变量或剧情能够确认上下位、同族或同一系列时，才保存机械主题、状态 ID 和有界招牌行动。无明确关系的敌人只进入近期遭遇记录，不按名称猜测族群。这样能让上位敌人继承可识别行动，又不会把任意相似名称错误绑定。

### 4.6 影子模拟

完整遭遇评估支持直接进攻、生存优先、构筑感知和合法随机等策略；实时程序卡组画像用更小的确定性样本和专用探针控制延迟，显式离线校准可以提高样本量。输出包括：

- 胜率和 Wilson 95% 区间。
- 回合数中位数与 P90。
- 结束生命比例中位数。
- 无牌可打回合率。
- 构筑感知与直接进攻胜率。
- 多策略胜率差，即初步技巧空间。

模拟复用统一内容分析和敌方行动选择器。复杂状态、遗物、能力和动态公式会把置信度降为低；低置信度结果不会产生强诊断。内容解析、卡组画像和模拟结果都使用有界缓存。

普通页面先完成渲染，再延迟约一个短任务周期计算权威画像；计算发生在 MVU 写事务外。画像完成后只在当前消息仍是最新楼层且机械指纹未变化时写回，避免卡顿和旧楼层污染。

### 4.7 生成后确定性校准

设置中可启用“程序自动校准”。程序以已生成敌人为候选，通过真实影子模拟寻找目标前沿，只缩放敌方最大生命、当前生命比例和允许缩放的效果数值。名称、描述、目标、行动顺序、概率、攻击次数和剧情伤势比例保持不变。相同卡组、敌人和难度最多应用一次，小于 2% 的调整不写回。结果写入 `balance.programCalibration` 供审计，不产生第三次模型请求。

### 4.8 真实反馈

战斗结算保存胜负、回合数、结束生命比例和欲望比例。单场快速战败最多把下一战软预算下调约 10%，轻松速胜最多上调约 8%。至少三场后启用 EWMA 聚合，综合平滑胜率和结束生命生成 0.92–1.08 的长期压力系数；与单场方向合并后总调整限制在 0.85–1.15。当前战斗开始后不再修改。

`battle.design_context` 由程序维护、长期可见且禁止 AI 修改。剧情模型只读取紧凑 `brief`，用来关联构筑和剧情机会；第二阶段变量模型读取完整对象，包括最近三种敌人签名、上一战、聚合表现、上一场优先建议和一次性奖励审查。

## 5. 提示与 MVU 边界

世界书只增加短规则：设计上下文是软参考；剧情事实优先；不要求传统攻防比例；敌人围绕主压力、副机制和反制窗口；同一组奖励不能仅换名称而保持相同机械结构。完整对象优先读取 `balance.deckProfile/targetEnvelope`，后台画像尚未完成时才回退到快速 `balance.deck/target`。没有加入具体卡牌、敌人或状态示例，避免模型锚定。

第二阶段分析行固定为 `Update.`，不展开思考。程序给出预算和方向，模型无需重新计算。模式和远征锚点不进入剧情模型；完整变量只提供给负责更新的第二阶段模型。

## 6. 验证结果

### 6.1 自动化覆盖

已通过的核心验证包括：

- TypeScript 类型检查。
- 平衡预算与构筑方向。
- 内容设计辅助器和 MVU 适配器。
- 影子模拟确定性、结果边界和表现文本不变性。
- 世界书与 MVU 路径契约。
- 战斗结算、普通剧情循环和战后续写事务。
- 初始化、首战胜利、奖励候选、领取成长、第二次不同机制遇敌、带伤入场、第二战失败和多项惩罚的长流程。

新增回归点包括：

- 相同楼层重复加载不增长敌人历史。
- 奖励领取后机械指纹和构筑简报更新。
- 一次性奖励审查在领取后消失。
- 快速战败降低下一战预算，轻松速胜提高预算。
- 三场后 EWMA 压力系数按表现变化。
- 低置信度模拟不触发影子强诊断。
- 纯欲望、玻璃大炮、弃牌、X 费和条件奖励不被硬拒绝。
- 改名、换 emoji、换描述和换稀有度不伪造机械新颖度。

### 6.2 历史聊天校准

校准脚本支持两种来源：运行中的 SillyTavern API，或本地 JSONL 历史聊天文件。对 0.5.146 的真实历史聊天检查发现，最新变量层保留了五张玩家卡牌，但敌人已为空且契约不完整；该聊天中的助手正文以“好的，我将进行符合需求的创作”开头，正对应过去第二阶段被剧情预设污染的失败。新辅助器不会把这种结构错误当作平衡问题，仍交给硬契约和 MVU 修复；同时能为下次生成提供现有构筑简报。

对 0.5.148 奖励展示夹具校准得到三项候选、三种机械、五种操作角色，无换皮重复或严格支配诊断。对历史战斗修复夹具，构筑被识别为高节奏、强生存；敌人被评为低压力，影子策略均胜，诊断建议增加机制压力而非堆生命。由于夹具包含大量复杂遗物和能力，模拟置信度正确降为低，没有把该胜率升级为强制结论。

### 6.3 尚未完成的现场验证

本地 SillyTavern 的 `127.0.0.1:8012` 已确认返回 HTTP 200，端口也处于监听状态。Codex 内置浏览器仍显示“无法访问此站点”，原因是 Browser URL Policy 明确阻止自动化访问回环地址，而不是酒馆关闭或端口被占用。现场验证因此采用酒馆 HTTP/API、变量快照、Socket.IO、聊天 JSONL、构建夹具和用户手动浏览器检查；研发手册已记录这一边界和 6621 实时监听流程。

## 7. 风险与下一阶段

### 7.1 当前限制

- 影子模拟仍不能穷尽所有自定义触发、独立容器和未来新增机制；未覆盖内容通过降低置信度处理。
- 实时画像为交互延迟采用较小确定性样本；临界候选需要显式离线提高样本量。
- 聚合反馈只有本地上下文，尚无匿名跨玩家统计。
- 奖励严格支配是静态软检查，动态候选必须依赖后续实战。
- 自动程序校准只处理数值，无法替代对敌人机械可读性、剧情合理性和真人乐趣的判断。

### 7.2 升级门槛

建议只有在收集足够本项目实战后，才把以下项目从软诊断升级：

1. 连续多场出现相同误差方向，且低置信度样本已排除。
2. 真人胜率、回合数和结束状态与影子预测具有稳定相关性。
3. 自动局部修复能保留题材、主机制和长期变量，并通过事务回滚测试。
4. 临界样本使用 256 种子后结论稳定。

未来完整模拟应继续复用真实效果程序、卡牌事务和回合流程，不能复制第二套公式。程序校准继续坚持可审计、可回滚和只改敌方数值，不重建玩家牌组，也不请求模型为修分而改变题材与机制。

## 8. 结论

当前实现已经把“让 AI 自己感觉平衡”改造成可观察、可测试、可持续校准的程序系统，同时保留了剧情和构筑自由。它不承诺一次生成就达到竞技级平衡，而是提供可靠闭环：非法内容必修；v3 卡组能力与奖励边际贡献可解释；敌人预算随难度变化；机械换皮可识别；流派能渐进演化；同谱系敌人保持连续；生成后的数值可由程序复核；真实胜负会影响下一次遭遇。

对本项目最重要的提升不是某个伤害公式，而是形成闭环：剧情事实进入候选，候选经程序画像、流派图谱、谱系记忆和影子模拟，实战结果再回到下一轮设计简报。后续重点应放在积累真人样本、扩展模拟覆盖和校准阈值，而不是继续增加未经证实的硬规则。

## 来源

- 世界书只适合作为动态提示、不能承担确定性执行：S1–S4。
- 酒馆助手可提供独立生成、流事件、历史边界、结构化输出和生成 ID：S5–S7。
- 商业卡牌游戏强调分层难度、可读决策、构筑约束与复杂度预算：S8–S17。
- 程序化内容应使用显式质量函数、玩家模型和多策略代理，而不是单一静态点数：S18–S21。

访问说明：协调者于 2026-08-29 独立复核 S1、S4、S5、S8、S18、S19；S1、S4、S5、S8 返回 HTTP 200，DOI 解析端返回已接受并继续解析。其余来源由第一轮广泛发现与第二轮定向补证保存；产品页面只支持机械设计语境，不承担具体数值结论。公开胜率存在玩家结构、难度层级和版本差异，本报告只把它作为“必须分层校准”的证据，不直接复制为剧情模式目标。

### Claim-to-source ledger

| 编号 | 来源标题 / 发布者或作者 | 日期 | 支持的主张 | URL | 访问与使用说明 |
|---|---|---|---|---|---|
| S1 | World Info / SillyTavern | 未标示 | 世界书是动态提示插入，适合短指导而非确定性裁决 | https://docs.sillytavern.app/usage/core-concepts/worldinfo/ | 2026-08-29 独立访问，HTTP 200；核心架构证据 |
| S2 | Prompt Manager / SillyTavern | 未标示 | 提示组成与注入位置可分层管理 | https://docs.sillytavern.app/usage/prompts/prompt-manager/ | 两轮材料留存，未由协调者逐页复核；辅助证据 |
| S3 | Function Calling / SillyTavern | 未标示 | 宿主可提供结构化工具能力，但不替代本地契约 | https://docs.sillytavern.app/for-contributors/function-calling/ | 两轮材料留存，未由协调者逐页复核；备用接线证据 |
| S4 | Reasoning / SillyTavern | 未标示 | reasoning 占用输出预算，MVU 不应要求长思考 | https://docs.sillytavern.app/usage/prompts/reasoning/ | 2026-08-29 独立访问，HTTP 200；低延迟设计证据 |
| S5 | Generation API documentation and type definitions / Tavern Helper、JS-Slash-Runner | 持续更新 | generation id、独立提示排序、历史限制、流事件与结构化输出能力 | https://n0vi028.github.io/JS-Slash-Runner-Doc/ ; https://github.com/N0VI028/JS-Slash-Runner/blob/main/%40types/function/generate.d.ts | 2026-08-29 独立访问；接口会随版本变化，实施前应再核对本地版本 |
| S6 | Variable API / Tavern Helper、JS-Slash-Runner | 持续更新 | 长期变量可由宿主读取与写回 | https://github.com/N0VI028/JS-Slash-Runner-Doc/tree/main/src/guide/%E5%8A%9F%E8%83%BD%E8%AF%A6%E6%83%85/%E5%8F%98%E9%87%8F | 两轮材料留存，未逐页版本化复核；实现同时以本地契约测试为准 |
| S7 | Event and prompt injection documentation / Tavern Helper、JS-Slash-Runner | 持续更新 | 事件监听和提示注入可承载有界上下文刷新 | https://github.com/N0VI028/JS-Slash-Runner-Doc/tree/main/src/guide/%E5%8A%9F%E8%83%BD%E8%AF%A6%E6%83%85 | 两轮材料留存，未逐页版本化复核；实现同时以本地契约测试为准 |
| S8 | The Neowsletter – May 2026 / Mega Crit Games | 2026-05-22 | 公开胜率随模式与难度显著变化，必须分层而不能复制单一目标 | https://www.megacrit.com/news/2026-5-22-neowsletter-issue-22/ | 2026-08-29 独立访问，HTTP 200；存在玩家构成和版本混杂 |
| S9 | The Neowsletter – April 2026 / Mega Crit Games | 2026-04-17 | 微观决策收益不能无限抵消复杂度成本 | https://www.megacrit.com/news/2026-4-17-neowsletter-issue-21/ | 两轮材料留存，未由协调者独立复核；设计语境证据 |
| S10 | The Neowsletter – August 2026 / Mega Crit Games | 2026-08-14 | 限制单卡叠加有助于保留整副构筑取舍 | https://www.megacrit.com/news/2026-8-14-neowsletter-issue-25/ | 两轮材料留存，未由协调者独立复核；设计语境证据 |
| S11 | Twenty Years, Twenty Lessons—Part 1 / Mark Rosewater、Wizards of the Coast | 2016-05-30 | 玩家认知、选择与约束是卡牌设计的重要边界 | https://magic.wizards.com/en/news/making-magic/twenty-years-twenty-lessons-part-1-2016-05-30 | 两轮材料留存；辅助设计原则，不支持本项目数值 |
| S12 | Twenty Years, Twenty Lessons—Part 2 / Mark Rosewater、Wizards of the Coast | 2016-06-06 | 复杂度和选择空间需有明确用途 | https://magic.wizards.com/en/news/making-magic/twenty-years-twenty-lessons-part-2-2016-06-06 | 两轮材料留存；辅助设计原则，不支持本项目数值 |
| S13 | Twenty Years, Twenty Lessons—Part 3 / Mark Rosewater、Wizards of the Coast | 2016-06-13 | 设计应服务真实体验而非抽象规则堆叠 | https://magic.wizards.com/en/news/making-magic/twenty-years-twenty-lessons-part-3-2016-06-13 | 两轮材料留存；辅助设计原则，不支持本项目数值 |
| S14 | Wildfrost / Deadpan Games、Chucklefish | 未标示 | 可见计数器和提前规划可构成非纯数值压力 | https://www.wildfrostgame.com/ | 产品页；只作机制发现，不作精确因果或数值证据 |
| S15 | Monster Train / Shiny Shoe、Good Shepherd | 未标示 | 空间、推进与固定挑战能形成不同压力轴 | https://www.themonstertrain.com/ | 产品页；只作机制发现，不作精确因果或数值证据 |
| S16 | Griftlands / Klei Entertainment | 未标示 | 关系与剧情可以承载长期构筑反馈 | https://www.klei.com/games/griftlands | 产品页；只作机制发现，不作精确因果或数值证据 |
| S17 | Hades FAQ / Supergiant Games | 未标示 | 失败与循环成长可以继续叙事而非中断流程 | https://www.supergiantgames.com/blog/hades-faq | 产品页；只作机制发现，不作精确因果或数值证据 |
| S18 | Experience-Driven Procedural Content Generation / Yannakakis、Togelius | 2011 | PCG 质量函数应结合玩家模型与体验反馈 | https://doi.org/10.1109/T-AFFC.2011.6 | 2026-08-29 DOI 解析被接受；核心方法证据 |
| S19 | Search-Based Procedural Content Generation: A Taxonomy and Survey / Togelius 等 | 2011 | 内容可编码为候选并由显式目标函数搜索或评估 | https://doi.org/10.1109/TCIAIG.2011.2148116 | 2026-08-29 DOI 解析被接受；核心方法证据 |
| S20 | Dungeons & Replicants II / Pfau 等 | 2022 | 多策略代理比单一策略更能暴露特定失衡 | https://doi.org/10.1109/TG.2022.3167728 | 两轮材料留存，未由协调者独立访问全文；方法辅助证据 |
| S21 | Predicting Game Difficulty and Engagement Using AI Players / Roohi 等 | 2021 | AI 玩家结果分布可辅助预测难度与参与度 | https://doi.org/10.1145/3474658 | 两轮材料留存，未由协调者独立访问全文；方法辅助证据 |

### 未纳入强结论的证据缺口

SillyTavern Data Bank / RAG、MagVarUpdate beta 源码、动态难度调整综述 `10.1155/2018/5681652` 和 Restricted Play `10.1609/aiide.v8i1.12513` 尚未完成协调者独立访问，因此不作为本报告已验证主张的依据。它们主要可能强化长期检索、变量接线与受限策略代理的实施细节，不改变“AI 生成候选、程序负责评分与可通关裁决、MVU 只注入有界摘要”的主架构结论。

[S1] SillyTavern, “World Info.” https://docs.sillytavern.app/usage/core-concepts/worldinfo/  
[S2] SillyTavern, “Prompt Manager.” https://docs.sillytavern.app/usage/prompts/prompt-manager/  
[S3] SillyTavern, “Function Calling.” https://docs.sillytavern.app/for-contributors/function-calling/  
[S4] SillyTavern, “Reasoning.” https://docs.sillytavern.app/usage/prompts/reasoning/  
[S5] Tavern Helper / JS-Slash-Runner, generation API documentation and type definitions. https://n0vi028.github.io/JS-Slash-Runner-Doc/ ; https://github.com/N0VI028/JS-Slash-Runner/blob/main/%40types/function/generate.d.ts  
[S6] Tavern Helper / JS-Slash-Runner, variable API documentation. https://github.com/N0VI028/JS-Slash-Runner-Doc/tree/main/src/guide/%E5%8A%9F%E8%83%BD%E8%AF%A6%E6%83%85/%E5%8F%98%E9%87%8F  
[S7] Tavern Helper / JS-Slash-Runner, event and prompt injection documentation. https://github.com/N0VI028/JS-Slash-Runner-Doc/tree/main/src/guide/%E5%8A%9F%E8%83%BD%E8%AF%A6%E6%83%85  
[S8] Mega Crit Games, “The Neowsletter – May 2026.” https://www.megacrit.com/news/2026-5-22-neowsletter-issue-22/  
[S9] Mega Crit Games, “The Neowsletter – April 2026” and May 2026. https://www.megacrit.com/news/2026-4-17-neowsletter-issue-21/  
[S10] Mega Crit Games, “The Neowsletter – August 2026.” https://www.megacrit.com/news/2026-8-14-neowsletter-issue-25/  
[S11] Mark Rosewater, “Twenty Years, Twenty Lessons—Part 1.” https://magic.wizards.com/en/news/making-magic/twenty-years-twenty-lessons-part-1-2016-05-30  
[S12] Mark Rosewater, “Twenty Years, Twenty Lessons—Part 2.” https://magic.wizards.com/en/news/making-magic/twenty-years-twenty-lessons-part-2-2016-06-06  
[S13] Mark Rosewater, “Twenty Years, Twenty Lessons—Part 3.” https://magic.wizards.com/en/news/making-magic/twenty-years-twenty-lessons-part-3-2016-06-13  
[S14] Deadpan Games / Chucklefish, “Wildfrost.” https://www.wildfrostgame.com/  
[S15] Shiny Shoe / Good Shepherd, “Monster Train.” https://www.themonstertrain.com/  
[S16] Klei Entertainment, “Griftlands.” https://www.klei.com/games/griftlands  
[S17] Supergiant Games, “Hades FAQ.” https://www.supergiantgames.com/blog/hades-faq  
[S18] Yannakakis & Togelius, “Experience-Driven Procedural Content Generation,” IEEE Transactions on Affective Computing, 2011. https://doi.org/10.1109/T-AFFC.2011.6  
[S19] Togelius et al., “Search-Based Procedural Content Generation: A Taxonomy and Survey,” IEEE TCIAIG, 2011. https://doi.org/10.1109/TCIAIG.2011.2148116  
[S20] Pfau et al., “Dungeons & Replicants II,” IEEE Transactions on Games, 2022. https://doi.org/10.1109/TG.2022.3167728  
[S21] Roohi et al., “Predicting Game Difficulty and Engagement Using AI Players,” PACM HCI, 2021. https://doi.org/10.1145/3474658
