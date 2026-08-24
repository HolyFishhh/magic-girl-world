# Tavern Helper 运行时架构

更新时间：2026-08-23。

本文固定魔法少女世界在 SillyTavern、Tavern Helper 与 MagVarUpdate 中的目标架构、迁移顺序和验收条件。它用于约束后续实现，不把尚未通过真实酒馆回归的设计写成已完成功能。

## 目标与非目标

- 默认交付仍是一张可导入角色卡。用户只需已有 Tavern Helper，不应再安装项目专用插件。
- 正文继续由 SillyTavern 原生显示；普通回复只在末尾出现交互状态栏；战斗页面仍在战斗引导正文之后出现。
- 开始页保持一次性入口，不在当前重构阶段扩展或改版；start/common/fish 正则均固定 `minDepth=0,maxDepth=0`，只让最新楼层加载交互 iframe。
- 大型 HTML、CSS、JavaScript 不再作为每条消息的正则替换文本重复注入。
- 卡牌和战斗规则保持在 `src/game-core`，不依赖 DOM、MUV、Tavern Helper 或 SillyTavern。
- 可选服务器模式可以减少角色卡和 iframe 负担，但网络不可用时不得破坏默认自包含角色卡。
- 不为迁移无关的玩法字段延后核心、宿主和 UI 的拆分。

## 当前旧架构

```text
AI 输出 marker
  -> 角色卡局部正则匹配整条消息
  -> replaceString 注入完整 HTML + CSS + JavaScript
  -> Tavern Helper 把代码块渲染为 iframe/srcdoc
  -> 每个 iframe 自己等待 MUV、读取楼层变量、运行规则和渲染 UI
```

迁移前三个替换产物约为：

| 模块 | 产物大小 | 当前作用 |
| --- | ---: | --- |
| 开始模块 | 47 KB | 启动和角色创建 |
| 通用模块 | 303 KB | 正文末尾状态栏、选项、奖励和路线 UI |
| 战斗模块 | 627 KB | 战斗规则宿主与完整战斗 UI |

`0.5.56` 完成 common/fish 加载迁移，`0.5.57` 移除了 `$1/$2` 消息搬运并把 MUV 就绪门禁放入共享角色脚本，`0.5.58` 又迁入最后的 start 视图。当前发布产物为：

| 产物 | 大小 | 说明 |
| --- | ---: | --- |
| `character-runtime.js` | 891,460 B | 角色卡脚本库中只嵌入一次的 start/common/fish 版本化资源运行时 |
| `start-interface.json` | 4,489 B | 开始 marker 定位和轻量 bootstrap |
| `common-interface.json` | 4,696 B | 协议定位、轻量 bootstrap；正文和选项由当前楼层读取 |
| `fish-interface.json` | 4,615 B | 战斗协议定位、轻量 bootstrap |

`0.5.56` 壳已经在 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0` 中完成首次世界书确认、状态栏恢复、战斗页面恢复、`seek` 选择、MUV 快照和刷新恢复回归。`0.5.57` 的无捕获正则、原始消息选项读取和共享就绪端口已通过自动契约及真实隔离聊天回归。`0.5.58` 的 start 壳已通过 fenced iframe 实机回归；最新 start、readiness 和 battle 隔离聊天均只加载一个最新楼层 iframe，历史 start 聊天不加载消息 iframe。`0.5.59` 的浏览器基线仍有效；`0.5.64` 完成 start 首楼层门禁和战斗壳分离，`0.5.65/0.5.66` 收口触发、现代命令、遗物与卡牌副作用。`0.5.67` 在酒馆助手 `4.9.3` 中实测结构化 common 续写、MUV 节点提交和历史 iframe 卸载；`0.5.68` 完成 common 远征/奖励应用宿主迁移。`0.5.69` 完成统一选牌；`0.5.70` 把 start/common/修复/战后四条续写统一为结构化消息；`0.5.71` 把战斗状态所有权迁入 `BattleStateStore`；`0.5.72` 把现代卡牌副作用迁入 `CardEffectRuntime`；`0.5.73` 把现代数值战斗副作用迁入 `BattleEffectRuntime`；`0.5.74` 至 `0.5.76` 又完成动态状态、触发定义、修饰符和完整状态生命周期迁移。`0.5.77` 删除全部旧效果兼容模块，最终 PNG 在酒馆助手 `4.9.3` 中通过现代状态周期、消息快照和刷新重开回归。

这个架构已经能在真实酒馆运行，仍有两个可选的结构优化：

1. 历史楼层已不创建项目 iframe，但最新楼层仍会把对应完整视图复制进一个活动 iframe；common/fish 尚未进一步按交互区域分块。
2. 自包含角色脚本仍内嵌约 1 MB 资源，尚未实现带版本校验和卡内回退的可选服务器/分块模式。

开始模块的大正则迁移已经完成，不再列入剩余结构债务。这里的“正则迁移完成”只表示加载链路收敛，不能代替规则宿主拆分和完整实机验收。

## 新旧架构差异

| 维度 | 旧架构 | 新架构 |
| --- | --- | --- |
| 正则职责 | 匹配消息并携带整页 HTML/CSS/JS，common 还搬运正文和选项 | 只定位 marker、移除协议文本并插入约 3 KB 壳 |
| 资源存放 | 每份局部正则各保存一套完整 bundle | start/common/fish 资源只在角色脚本运行时保存一次 |
| 消息数据 | `$1/$2` 经过正则、Markdown、HTML 多层解析 | 按明确 `message_id` 调用 `getChatMessages`/MUV 读取 |
| 正文显示 | 容易被前端再次包裹或复制 | 始终由 SillyTavern 原生显示，普通消息只追加状态栏 |
| 宿主就绪 | 各 iframe 自己轮询 MUV、世界书和变量 | `MagicGirlWorld.waitForMessageReady` 统一门禁 |
| 存档边界 | UI、规则和 MUV 写回混在 fish/common | `game-core` 负责纯规则，Tavern 适配器负责楼层与 MUV |
| 历史楼层 | 容易读写 latest 或重复运行交互 | 显式绑定所在楼层，历史视图强制只读 |
| 复用方式 | 依赖 DOM、酒馆 API 和旧效果字符串 | 网站、服务或 Mod 可复用纯核心和稳定命令端口 |
| 发布方式 | 大正则难审计且多次解析 | 默认仍是一张自包含角色卡；服务器仅为可选加速 |

## 目标新架构

```text
角色卡脚本库：MagicGirlWorldRuntime（每个角色上下文加载一次）
  -> 等待并包装 MUV
  -> 持有可移植 game-core 与 Tavern 宿主适配器
  -> 通过 initializeGlobal('MagicGirlWorld', api) 共享稳定接口
  -> 监听消息/聊天事件并管理事务、存档和版本

AI 输出 marker
  -> 小型角色卡正则只保留原生正文并插入 <body><div data-mwg-view=...>
  -> 小型 iframe bootstrap 调用 waitGlobalInitialized('MagicGirlWorld')
  -> 按 message_id 挂载 status/start/battle 视图
  -> 只有最新楼层可写，历史楼层只读或不加载交互运行时
```

### 1. 可移植核心

`src/game-core` 负责浅层 AI JSON、公式、内容契约、牌区、出牌事务、回合、随机数、敌人行动、终态和成长结算。输入和输出只能是普通数据、显式随机端口和显式宿主命令。

现代卡牌副作用的当前主链路为：

```text
AI 浅层 JSON
  -> EffectProgram
  -> EffectCommand
  -> CardEffectRuntime / BattleEffectRuntime / 类型化宿主端口
  -> BattleStateStore
  -> 宿主选择 / 生命周期 / 呈现端口
```

`0.5.77` 起只有浅层 JSON 编译出的 `EffectProgram` 可以进入执行边界。卡牌语义直接进入 `CardEffectRuntime`，数值语义直接进入 `BattleEffectRuntime`，状态与注册命令进入类型化宿主端口。Tavern UI 不得重新决定候选、选择范围、牌区提交或数值战斗规则。

`0.5.59` 至 `0.5.76` 依次统一嵌套事务、事件调度、呈现/结束宿主、敌人行动、选牌、能力/状态、遗物、common 事务、续写、战斗状态、现代卡牌/数值副作用、动态状态注册、定义门禁、修饰符和状态生命周期。`0.5.77` 删除迁移过程中保留的字符串 parser、host、adapter 和展示分析模块。`ReferenceBattleRuntimeHost` 可组合相同状态、事务、卡牌、数值与触发运行时。所有这些协议不把 DOM、MUV 或 Tavern API 带入规则核心；网站、服务或 Mod 通过同一状态、快照、触发、卡牌、数值、消息、存储与呈现端口接入。

`0.5.77` 已删除旧字符串模块及其专用端口。现代浅层 JSON + 简易公式是唯一内容入口。楼层渲染约束不随此清理变化：start 只在 AI 消息 0，common/fish 只在最新 AI 楼层，正文不进入 iframe。

网站、AI 服务或 Mod 可以复用核心，也可以只实现同一端口；不要求复用 Tavern UI 或 MUV 存档。

### 2. Tavern 宿主运行时

角色卡脚本库中的单一运行时负责：

- Tavern Helper 和 SillyTavern 版本门禁；
- MUV 首次导入、就绪等待和消息楼层绑定；
- 事务、消息快照、历史楼层只读、斜杠命令和宿主事件；
- 把 `game-core` 命令适配为 MUV 写回、动画、日志和选择请求；
- 对 UI 暴露小而稳定的 `MagicGirlWorld` API。

Tavern Helper 文档明确支持角色脚本随角色卡导出，也支持 `initializeGlobal` / `waitGlobalInitialized` 在脚本与前端 iframe 之间共享接口。这是减少大正则注入的主要依赖。

### 3. UI 壳与视图

角色卡局部正则只做两件事：

1. 只识别稳定 marker 并移除协议标记；
2. 输出满足 Tavern Helper 渲染条件的最小 `<body>` 容器和 bootstrap。

正则不再用 `$1/$2` 搬运正文或选项。酒馆助手实时编写教程建议复杂输出由前端通过当前楼层消息接口读取和解析，正则只负责定位界面出现的位置。common 通过共享运行时的 `getMessageText(message_id)` 读取当前楼层，只提取 `<Options>` 和奖励 marker；fish 通过同一消息楼层绑定读取 MUV 战斗快照。这样正文始终留在 SillyTavern 原生楼层，选项数据不再经过替换组、Markdown 和 iframe 的二次解析。

bootstrap 不拥有规则和存档，只提供：

- 当前 `message_id`；
- 视图种类 `start/status/battle`；
- 容器挂载和卸载；
- 当前楼层消息文本读取和 MUV 就绪门禁；
- 与共享运行时通信；
- 无法加载时的有界错误提示。

开始页在本阶段只作为一次性角色创建入口，不继续扩展或重做布局；它仅在消息楼层 `0` 的初始 `[开始游戏]` AI 消息仍为最新楼层时挂载。start 壳自身再次检查 `getCurrentMessageId() === 0`，即使后续 AI 正文误带同名 marker 也会清空壳，不会重新创建角色表单。后续状态栏和战斗页同样按最新消息楼层单实例渲染，避免历史楼层重复运行前端；视图根节点记录 `data-mwg-mounted-view`，防止同一楼层脚本重复执行时重复挂载。

普通正文不得进入 iframe。战斗正文也保留在原生楼层，战斗容器位于其后。

角色卡三条界面正则统一限制为 `minDepth=0,maxDepth=0`，并且 start 只作用于 AI 输出（`placement=[2]`）。因此只有最新消息创建交互 iframe；start 不会被创建按钮发送的用户交接消息重新触发，提交后自动退出渲染，common/fish 历史楼层保留原生文本和存档但不重复执行完整前端。这个限制属于正则安装配置，不在运行时调用慢速正则更新 API。

这条楼层限制是当前 UI 的冻结约束：开始页暂不改版，只在 AI 消息 `0` 的初始入口挂载；普通状态栏和战斗页只在最新 AI 楼层末尾出现。状态刷新通过该楼层已有 iframe 的共享运行时更新完成，不创建新的正则替换、外层包裹或第二套状态栏。需要改版时，应先保持这三个生命周期条件，再替换视图资源。

### 4. 自包含与服务器双模式

默认自包含模式把版本化 UI 资源随角色卡脚本携带一次，由最小 bootstrap 获取并挂载。实现前必须在真实 Tavern Helper 中证明跨 iframe 资源获取、执行和卸载可靠，不能仅靠浏览器单测假定。

可选服务器模式允许 bootstrap 从 HTTPS 地址加载带版本和完整性标识的静态资源。它用于开发热更新和低前端压力，不作为唯一发布链路。加载失败时应回退到卡内资源或显示明确错误，不能静默使用不匹配版本。

## 为什么不在运行时修改大正则

Tavern Helper 文档明确说明 `replaceTavernRegexes` 和 `updateTavernRegexesWith` 是慢操作，会重载整个聊天、触发 `CHAT_CHANGED`，继而重载全局脚本和楼层界面。因此它们只适合安装或升级，不适合每回合渲染、状态刷新或开发热更新。

状态变化应通过共享运行时事件和单楼层视图更新完成。必要时只调用 `renderOneMessage(message_id)`；该函数只更新显示，不负责数据持久化。

## 迁移顺序

1. 建立最小角色脚本运行时，只提供版本、楼层 ID、MUV 就绪与诊断 API；保留现有 UI 作为回退。**已完成（0.5.56）**。
2. 用一个轻量状态栏试点验证角色脚本、`initializeGlobal`、iframe bootstrap、历史楼层和刷新恢复。**已完成（0.5.56）**。
3. 将通用模块的变量读写、选项发送、奖励/路线事务迁到宿主运行时，正则只保留状态栏壳。**结构化消息与通用 MUV 端口已完成（0.5.67），路线、奖励、事件、营火、商店与删卡应用宿主已完成（0.5.68）**。
4. 将战斗遗物、能力、状态、选牌和效果执行迁到明确的核心/宿主端口。**已完成；迁移期旧格式模块在 0.5.77 删除**。
5. 战斗 UI 改为壳加载，但保持在引导正文之后，功能与布局先不变。**已完成；主要规则、选择、终态、续写、战斗状态、卡牌、数值和状态生命周期均有明确所有者**。
6. 最后迁移开始模块，删除旧的大型 `replaceString`。**已完成（0.5.58）**。第一次非 fenced 候选未执行 bootstrap，已按官方渲染器条件统一为 fenced body；真实 start/latest、start/historical、readiness 和 battle 烟测均通过。

每一步都必须保留上一步可回滚产物，不能一次替换三条链路。

## 完成定义

只有同时满足以下条件，才能称为“旧系统迁移完成”：

- 新世界书和运行时只接受 AI 浅层 JSON 与简易公式；
- 遗物、能力、动态状态、抽弃牌、随机数、回合、终态均由核心规则和明确宿主端口驱动；
- MUV 写回、消息快照、历史楼层和首次导入时序只有一个 Tavern 适配入口；
- 正则替换文本不再包含完整应用 bundle；
- 状态栏和战斗 UI 的选择、动画、日志、奖励、成长、营火、商店均通过新运行时完成；
- `npm run release:tavern` 通过；
- 最终 PNG 在指定 SillyTavern + Tavern Helper + MUV 版本中完成首次导入、普通回复、战斗交互、刷新恢复和历史楼层只读回归。

`0.5.77` 已满足以上迁移完成条件。后续的服务器模式和视图分块是可选性能优化，不再属于旧系统兼容或迁移阻塞项。

`0.5.78` 在不改变楼层和 UI 约束的前提下，把战斗快照契约迁入纯核心，并新增 `dist/portable` 的 card/battle/combined ESM 与声明交付物。酒馆继续消费同一 `game-core`，外部宿主不再需要从 fish 复制快照或规则代码。

## 参考资料

- [如何正确使用酒馆助手](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/%E5%9F%BA%E6%9C%AC%E7%94%A8%E6%B3%95/%E5%A6%82%E4%BD%95%E6%AD%A3%E7%A1%AE%E4%BD%BF%E7%94%A8%E9%85%92%E9%A6%86%E5%8A%A9%E6%89%8B.html)
- [渲染器](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/%E5%9F%BA%E6%9C%AC%E7%94%A8%E6%B3%95/%E6%B8%B2%E6%9F%93%E5%99%A8.html)
- [脚本库](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/%E5%9F%BA%E6%9C%AC%E7%94%A8%E6%B3%95/%E8%84%9A%E6%9C%AC%E5%BA%93.html)
- [渲染楼层](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/%E5%8A%9F%E8%83%BD%E8%AF%A6%E6%83%85/%E6%A5%BC%E5%B1%82%E6%B6%88%E6%81%AF/%E6%B8%B2%E6%9F%93%E6%B6%88%E6%81%AF.html)
- [监听和发送事件](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/%E5%8A%9F%E8%83%BD%E8%AF%A6%E6%83%85/%E7%9B%91%E5%90%AC%E5%92%8C%E5%8F%91%E9%80%81%E4%BA%8B%E4%BB%B6.html)
- [分享接口](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/%E5%8A%9F%E8%83%BD%E8%AF%A6%E6%83%85/%E5%88%86%E4%BA%AB%E6%8E%A5%E5%8F%A3.html)
