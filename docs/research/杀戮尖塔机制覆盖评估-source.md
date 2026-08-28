# 《杀戮尖塔 1/2》机制覆盖评估

更新时间：2026-08-29  
范围：本项目通用战斗 DSL 与运行时、《杀戮尖塔 1》正式版、《杀戮尖塔 2》当前公开 Early Access / Beta 内容  
结论级别：工程规划稿，不把当前 EA/Beta 数据视为《杀戮尖塔 2》最终正式版

## 执行摘要

本轮已经把用户明确提出的三类能力落成通用底层原语，而不是按卡牌名或状态名特判：

1. 修改选定卡牌中的伤害、格挡、欲望和状态层数，支持加、减、乘、除；支持手牌、抽牌堆、弃牌堆及三者合并范围，选择方式支持随机、手选、最左、最右和全部。
2. 由被动能力、遗物或状态持续规则声明“每回合前 N 张牌 / 所有牌额外完整结算若干次”。
3. 由相同持续来源声明“每回合前 N 张牌 / 所有牌本次不消耗能量”。

攻击命中数 `hits` 与上述数值修改通道完全隔离。Replay 重复的是整张牌的效果程序，不是增加某一个伤害节点的命中数。当前事务约定为：费用只支付一次，整张牌依次重复结算，最后统一进入弃牌或消耗区，出牌后触发器只结算一次，以避免递归爆炸。

这些能力覆盖了用户当前提出的“回响式额外结算”和“虚无式前 N 张免费”的核心语义，但不等于已经完整覆盖两代《杀戮尖塔》。完整覆盖 STS1 还需要更强的卡牌实例/持久化、动态费用、牌区事务、历史事件、类型化伤害、规则替换、多敌人、姿态与 Orb 等能力；覆盖 STS2 当前公开内容还需要 Enchantment、Affliction、多资源费用、Sly、Osty、Doom、Forge 与多人目标。

## 本轮实现状态

### 卡牌数值修改

- AI 紧凑字段：`modify_card`。
- 可修改通道：`damage`、`block`、`lust`、`stacks`。
- 可用运算：`add`、`subtract`、`multiply`、`divide`。
- 牌区：`hand`、`draw`、`discard`、`all`；其中 `all` 是前三个战斗牌区的合集。
- 选择：`random`、`choose`、`left`、`right`、`all`。
- 递归处理条件分支和注册触发器内的对应数值节点。
- 结果最低为 0；常量直接计算，公式使用安全 AST 包装下限。
- 不修改 `hits`、费用、目标、触发时机、卡牌类型或动态生成牌模板。
- 当前作用于战斗中的卡牌实例，不会永久写回整局牌组模板。

### Replay 与免费出牌窗口

- AI 紧凑字段：`card_rule`，规则为 `replay` 或 `free`。
- 只允许出现在 passive 能力/遗物或状态 `hold` 中。
- `limit` 为正数、状态层数公式或 `all`。
- `replay.extra` 是原始结算之外的额外完整结算次数，多个来源叠加，上限 20。
- `free` 不改变卡牌原始费用；X 费牌免费打出时，本次 `spent_energy=0`。
- 规则范围使用出牌前的 `cardsPlayedThisTurn`，每个玩家回合自然重置。
- Replay 与现有一次性 double-effect 可以叠加。

### 已验证路径

- TypeScript 类型检查通过。
- 紧凑 DSL 编译、内部 AST 校验、世界书契约通过。
- 数值修改的手选、最左、最右、随机、全部路径均执行通过。
- 四类数值通道执行通过，多段伤害的命中数保持不变。
- 前 N 张 Replay、所有牌 Replay、多来源叠加及上限通过。
- 前 N 张免费、X 费免费、与一次性 double-effect 共存通过。
- passive/hold 的合法位置和 tick/普通即时效果中的非法位置均通过策略测试。

## 机制覆盖矩阵

| 机制族 | 当前项目状态 | 为何重要 | 建议阶段 |
|---|---|---|---|
| 战斗卡牌实例 ID | 部分具备：运行时副本有唯一 ID，但模板、整局实例、战斗实例和临时副本尚未完全分层 | 永久成长、复制、附魔、同名卡跨区修改依赖清晰身份 | P0-P1 |
| 卡牌选择器 | 本轮已支持三个主要牌区与随机/手选/左右/全部；缺消耗堆、顶底、类型和标签过滤 | STS 大量卡牌依赖指定牌区、顺序和过滤 | P0-P1 |
| 数值补丁 | 本轮已支持四通道与四则运算，作用于战斗实例 | 用户当前需求已满足；永久/按模板/按标签作用域仍缺 | P0-P1 |
| Replay 事务 | 本轮已支持前 N 张/全部、多来源叠加、费用一次、最后移牌 | 必须与 hits 和普通出牌触发分开 | P0 |
| 免费窗口 | 本轮已支持前 N 张/全部与 X 费 0 消耗 | 免费不是把卡牌永久改成 0 费 | P0 |
| 多段攻击 | 已有固定 hits，数值修改不会污染 hits | 多段攻击与整卡 Replay 是不同语义 | P0 |
| 原子出牌事务 | 已有准备/提交和牌区提交框架；复杂 Replay 触发阶段仍需持续回归 | 防止扣费、移牌和触发器在失败时半完成 | P0-P1 |
| 牌区移动 | 已有抽牌、弃牌、消耗、回收、检索、占卜、复制和生成的部分能力 | STS1 大量构筑以牌区和顺序为核心 | P1 |
| 卡牌生成/复制/变形 | 有生成和复制；缺通用变形、升级、按规则继承补丁 | 随机牌、复制、卡链、变形和成长所必需 | P1 |
| 动态关键词补丁 | 仅有卡牌静态 retain/exhaust/ethereal/innate 等字段 | 动态增加 Retain、移除 Exhaust、附加 Replay 仍无法统一表达 | P1-P2 |
| 动态费用与多费用 | 有基础减费和单一能量/X 费；缺持续时间、多组件费用与重算事件 | STS1 动态费用和 STS2 Stars 都依赖它 | P1-P2 |
| 条件与表达式 | 有安全表达式、条件和部分当前状态/计数引用 | 仍缺聚合、最近事件、实际伤害、卡牌集合统计 | P1 |
| 历史与原因 | 有本回合出牌分类计数；缺统一事件历史和弃牌/伤害原因 | Sly、Fatal、每 N 次、主动弃牌与回合清理必须区分 | P1-P2 |
| 延迟与预约 | 触发器可覆盖部分回合时机；缺通用未来 N 回合调度器 | 下回合、三回合后、持续若干回合效果 | P1 |
| 类型化伤害/Fatal | 当前伤害模型可执行，但来源、实际 HP 损失、直接失血、击杀归因仍不完整 | 反伤、吸血、无视格挡、击杀成长需要准确语义 | P1 |
| 规则替换 | 持续修饰符可改数值；缺“不弃手牌、禁止抽牌、保留格挡”等通用规则替换 | 不能用普通数值 Buff 模拟 | P1 |
| 姿态/Orb/额外回合 | 尚无独立容器和完整事务 | STS1 角色核心机制 | P1 |
| 多敌人 | 当前核心按 1v1 设计 | ALL、随机敌人、扩散状态、击杀后继续结算依赖实体集合 | P1 |
| Enchantment/Affliction | 尚无可持久化、带来源和移除时机的卡牌补丁包 | STS2 当前公开内容的核心机制 | P2 |
| Sly | 尚未区分足够细的弃牌原因与自动打出 | 只应在特定弃牌原因和阶段触发 | P2 |
| Stars/多资源 | 尚无资源映射与复合费用事务 | 免费与仅普通能量归零在 STS2 中语义不同 | P2 |
| Osty/召唤单位 | 尚无独立 HP、拦截和攻击来源的下属实体 | 不能可靠压成普通状态层数 | P2 |
| Doom/直接处决 | 可近似叙述，缺正式 execute/kill 原语 | 按阈值死亡不应伪装成普通伤害 | P2 |
| Forge/跨区同族修改 | 尚无模板组/同族选择器和确保生成语义 | 需要跨牌区、跨实例一致修改 | P2 |
| 多玩家 | 当前不支持 | 当前 STS2 已有队友目标和全队事件计数 | P2 |
| 战斗外牌组事务 | 奖励/删卡已有部分流程，尚未统一成整局事件模型 | 商店、营火、奖励改写、永久成长 | P3 |

## 关键语义陷阱

### Hits 不是 Replay

`hits` 表示单个伤害动作内部的命中次数；Replay 表示整张卡重新结算，可能同时重复伤害、格挡、抽牌、状态、条件和牌区效果。官方 v0.107.1 将相关效果从“额外命中”改为 Replay 1，直接证明两者不可合并。[S3]

### 免费不是降费

“本次免费打出”属于费用替换窗口，不应永久改写卡牌 cost。STS2 的 Stars 资料还显示，真正 free 与只把普通能量费用降为 0 的结果不同；未来必须支持多组件费用事务。[S12]

### 卡牌模板、整局实例与战斗副本不能混用

永久成长应写回整局实例；本场强化只属于战斗实例；临时生成牌通常不应污染牌组模板。复制时还必须明确是否继承临时费用、附魔和负面卡牌修饰。没有这层分离，任何“同名卡成长”都会产生难以追踪的串改。

### 弃牌必须携带原因

玩家主动弃牌、随机效果弃牌、回合结束清理、Scry 移出抽牌堆和变形不是同一个事件。STS2 的 Sly 依赖特定阶段和原因，监听“卡离开手牌”会误触发。[S7]

### 伤害必须携带来源和类型

需要区分攻击伤害、效果伤害、直接失去 HP、格挡后的实际损失、召唤单位拦截和阈值处决。否则吸血、反伤、Fatal、Osty 与 Doom 无法稳定组合。[S11][S13]

## 推荐路线图

### P0：当前需求闭环

- 保持本轮数值修改、Replay、免费窗口为底层通用原语。
- 为 UI 选择器补齐取消、无合法目标和日志来源表现。
- 将所有新命令接入长期存档和恢复回归测试。
- 明确 Replay 的触发阶段文档，并防止来源递归触发自身。

### P1：覆盖 STS1 主要卡牌语义

- 完成模板/整局实例/战斗副本分层和持久化补丁。
- 扩展统一选择器：消耗堆、牌堆顶底、类型/标签/费用过滤。
- 实现动态关键词、动态费用持续时间、变形、升级和永久成长。
- 建立类型化伤害包、击杀归因、事件原因和作用域计数器。
- 增加规则替换、调度器、姿态、Orb、额外回合和多敌人实体选择器。

### P2：覆盖 STS2 当前公开 EA/Beta 机制族

- 参数化 Replay 关键词。
- Enchantment/Affliction 通用卡牌补丁包。
- Sly 与弃牌原因过滤。
- Stars 与多资源复合费用。
- Osty/通用召唤单位、Doom/处决、Forge/模板组修改。
- 多玩家目标、所有玩家事件总线和共享计数器。

### P3：整局与遗物规则

- 把奖励、商店、营火、删卡、变形、复制、奖励重投和整局恢复接入统一事务。
- 让遗物、能力、状态和战斗外规则共享触发器、计数器、来源与日志模型。

## 研究边界与置信度

- STS1：解析了结构化卡牌记录 371 条，并以关键词和遗物数据交叉核验，机制族判断为高置信度。[S4][S5][S6]
- STS2：解析当前公开五角色、无色及相关模块共 607 条结构化记录；包含状态、诅咒、特殊牌和变体，不能把 607 直接当作唯一普通卡牌数量。机制族判断为中高置信度。[S7][S8]
- STS2 于 2026-03-05 进入 Early Access；截至 2026-08-14 公开 Beta 公告仍持续重做和平衡卡牌。因此本报告只能评估“当前公开 EA/Beta 机制”，不能保证未来正式版全覆盖。[S1][S2]
- 精确逐帧结算顺序和 Replay 对全部触发器的边界交互仍需游戏运行时实测；本项目当前采用了明确、可测试且避免递归的事务约定。

## 来源

- [S1] Mega Crit Games. Slay the Spire 2 is out NOW in Early Access!! 2026-03-05. https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1826362059922055
- [S2] Mega Crit / demileaf. Beta Patch Notes - v0.111.0. 2026-08-14. https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1840944183778277
- [S3] Mega Crit / demileaf. Major Update #2 - v0.107.1. 2026-06-19. https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1835871199305790
- [S4] Slay the Spire Wiki contributors. Module:Cards/data, rev 28903. https://slaythespire.wiki.gg/wiki/Module:Cards/data?oldid=28903
- [S5] Slay the Spire Wiki contributors. Keywords, rev 45695. https://slaythespire.wiki.gg/wiki/Keywords?oldid=45695
- [S6] Slay the Spire Wiki contributors. Module:Relics/data, rev 28329. https://slaythespire.wiki.gg/wiki/Module:Relics/data?oldid=28329
- [S7] Slay the Spire Wiki contributors. Slay the Spire 2: Keywords, rev 50226. https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Keywords?oldid=50226
- [S8] Slay the Spire Wiki contributors. Module:Cards/StS2 data. https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data
- [S9] Slay the Spire Wiki contributors. Enchantments, rev 46531. https://slaythespire.wiki.gg/wiki/Module:Keywords/StS2_data/Enchantments?oldid=46531
- [S10] Slay the Spire Wiki contributors. Afflictions, rev 29654. https://slaythespire.wiki.gg/wiki/Module:Keywords/StS2_data/Afflictions?oldid=29654
- [S11] Slay the Spire Wiki contributors. Slay the Spire 2: Osty. https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Osty
- [S12] Slay the Spire Wiki contributors. Slay the Spire 2: Stars. https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Stars
- [S13] Slay the Spire Wiki contributors. Slay the Spire 2: Doom. https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Doom
- [S14] Slay the Spire Wiki contributors. Slay the Spire 2: Replay. https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Replay

所有网页访问日期：2026-08-29。
