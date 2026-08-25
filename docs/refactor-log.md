# 魔法少女世界重构日志

## 2026-08-25：普通剧情 MVU 首轮竞态修复（0.5.93）

- 待修复问题溯源确认：开始页原先在 MVU 聊天级监听器完成安装前就创建用户楼层并触发生成，导致首个 `MESSAGE_RECEIVED` 被错过；MUV 写入失败还会被开始页吞掉。
- 开始页现在先等待共享角色运行时的 MUV/`stat_data.battle` 就绪，再写入 `game_mode` 并发送 `[角色创建]`；MUV 更新失败会阻止发送并明确提示，允许用户重试。
- `首条消息变量更新` 的世界书 `scan_depth` 固定为 `2`，覆盖“创建用户楼层 -> 首个助手回复”的触发距离。
- 普通状态栏移除强制战斗按钮；用户输入只推进剧情，战斗由剧情模型自然输出 `<BATTLE_PENDING>` 后再交给 MVU 注册。
- 远征“首次设置激活专用世界书、用户输入不受限制、仅按需注入第二轮模型”已写入 `docs/future-mvu-extra-model.md`，本批不实现远征协议。
- 完整 `npm run release:tavern` 用时约 `207.3s` 并通过。最终角色卡为 `7,391,389` 字节，SHA-256 `ADE3E523278BBFEFF68D866AB7B59DE21222B3659ADFF6A1D02EDB9CB350E913`；角色运行时为 `806,257` 字节，SHA-256 `E0DD7094DDC3E965615EA427B515FE65F3D07BCE90C384773D3967C1934C2E99`。
- 最终卡通过官方接口导入为 `魔法少女世界 0.5.93.png`，内嵌世界书 `魔法少女世界0.5.93` 成功导入并链接。酒馆保存的原始世界书为 17 条，`[mvu_update] 首条消息变量更新` 的实际 `scanDepth=2`。
- 无模型普通剧情夹具 `readiness-valid-2026-08-25T02-49-43Z` 在真实 SillyTavern 中只显示自由文本输入框和“发送”，没有强制战斗按钮，MVU 脚本加载成功。当前本地酒馆未连接模型 API，因此本批不把无模型夹具冒充为双模型在线生成验证。

## 2026-08-24：两阶段 MVU、状态栏主题与战斗单屏收口（0.5.92）

- 世界书从混合职责改为严格 `[mvu_plot]` / `[mvu_update]` 分流。主模型只写原生剧情、读取玩家构筑和输出战斗待注册标记；MVU 额外模型独占变量 schema、浅层 JSON、公式、敌人和奖励生成。正式条目不再存在 mixed 标签。
- 战斗交接改为 `<BATTLE_PENDING>` -> MVU 更新 -> `BEFORE_MESSAGE_UPDATE` 校验 -> `<BATTLE_START>`。敌人名称或行动为空时保持待注册状态，不提前渲染错误战斗页。
- `[config_override]` 默认设置额外模型解析、自动请求、兼容假流式、模型来源“与插头相同”和 `^\[mvu_update\]` 白名单；卡内运行时只在首次安装默认值，不覆盖玩家之后的手动选择。
- 删除 AI 选项输出和 `optionTags.ts`，并移除仍依赖旧选项协议的孤立实机审计脚本。普通行动与进入战斗由用户自由输入触发，奖励候选继续使用程序事务界面。
- common 状态栏保持正文原生、末尾追加和最近三层。溯源初版 Git 后保留暖白日记纸和彩色书签设计；真实酒馆发现运行时合并的第二段 CSS 前含 BOM，浏览器会丢弃紧随其后的 `:root` 规则。发布器现统一删除脚本和样式中的 BOM，并有运行时门禁。
- fish SCSS 从约 4800 行重复覆盖整理为约 1200 行单一设计系统。真实酒馆 `519x330` iframe 为“敌人 / 手牌 / 我方”三层，文档、body 和根容器横纵滚动量均为 0。
- 原生 HTML5 drag/drop 在 Tavern Helper `srcdoc` iframe 中复现无法出牌；改为 Pointer Events 后，真实鼠标拖牌使手牌 `5 -> 4`、弃牌 `0 -> 1`，战斗日志同步记录“使用了卡牌 星痕净化”。鼠标与触屏共用实现，不再维护 drag/touch 两套分支。
- 手机 `390x844` 验收发现视口变化后旧绝对定位未重排；加入 resize + requestAnimationFrame 轻量布局后，手牌按当前 iframe 宽度重新重叠，不重建战斗状态。
- 战后提示与战斗页日志改为共享事件来源，最多携带 36 条详细事件、终局数值和四个牌区计数。远征仍是可选实验入口，本轮不扩展。
- 新增 `measure:worldbook-roles`：主模型全部剧情条目 `2828` token，额外模型常驻 `2860`，首轮完整内容 `7702`，敌人注册 `7558`（`o200k_base`）。
- 完整 `npm run release:tavern` 通过，用时约 `184s`；最终角色运行时为 `805,277` 字节，SHA-256 `480A84CD9D7ADC623EBAA97E17A8D0768FE51F0BF44018A08AD4F80EE912FFCD`。最终角色卡为 `7,388,901` 字节，SHA-256 `E6E06698ECAAA61FA1CE81DF8A0268A730020FC5BCC017563BA6A897E1297C26`。
- 最终卡通过 SillyTavern 官方导入接口导入为 `魔法少女世界 0.5.92.png`。首次打开时酒馆识别内嵌世界书并成功导入、链接 `魔法少女世界0.5.92`；卡内复核为 17 条世界书、7 条正则和 2 个启用的角色脚本（MVU 变量框架、魔法少女世界运行时）。
- 普通状态栏夹具 `readiness-valid-2026-08-24T11-52-34Z` 在真实酒馆中保留原生正文，末尾只有一个暖白少女日记状态栏，CSS `--surface=#fffaf7`，无 AI 选项。通用正则为 `minDepth=0/maxDepth=2`，对应最新三层。
- 普通战斗夹具 `battle-repair-status-2026-08-24T11-42-40Z` 在桌面 `519x330` iframe 和手机 `390x844` 视口下均无横纵页面滚动。手机缩放后 5 张手牌全部重新排入手牌容器；真实拖动“星痕净化”后手牌 `5 -> 4`、弃牌 `0 -> 1`，共享战斗日志记录具体牌名。

## 2026-08-24：开始页与普通状态栏实机回归修复（0.5.86）

- 开始正则此前只匹配 `[开始游戏]`，MUV 追加 `<StatusPlaceHolderImpl/>` 时会被通用正则再次命中，导致同一楼层出现两个“正在加载” iframe。开始模块现在一次性消费占位符，通用模块不会再重复挂载；`npm run verify:tavern` 和真实 start/common 夹具均通过。
- 普通状态栏的 CSS 资源并未丢失，问题是 SillyTavern 深色宿主与 iframe 的 `prefers-color-scheme`、`localStorage` 相互独立，iframe 首次使用亮色变量，最终表现为黑字叠在深色背景。主题检测现在优先读取父酒馆正文背景，并把暗色变量同时绑定到 iframe 根和状态栏根；只有用户主动切换主题才保存偏好，旧版主题缓存不会覆盖自动检测。
- 真实酒馆 `1.18.0` + Tavern Helper `4.9.3` 中，普通夹具显示唯一状态栏 iframe、暗色背景 `rgb(23,26,31)` 与正文 `rgb(244,245,247)`；状态栏样式资源存在且按钮可见。开始页回归继续使用最新兼容卡验证，旧卡不再作为验收输入。
- 重新导入最新卡后，酒馆自动保存为 `魔法少女世界 0.5.864.png`；新建 `start-runtime-latest-2026-08-24T03-52-52Z` 聊天实测消息 iframe 数为 `1`，`.magical-girl-creator` 为 `1`，加载节点为 `0`，运行时样式和脚本各 `1`。这组数字作为截图中“两个加载框/空白 UI”的回归基线。
- 最终卡 `魔法少女世界.png` 与 `dist/tavern/魔法少女世界-酒馆兼容版.png` 已同步，大小 `7,504,013` 字节，SHA-256 `7DC4EB3C41609F2C366654109FEDB5C8F4B6ECF6C21C19D2B4F93D8837AB27D8`；角色运行时大小 `857,742` 字节，SHA-256 `A50B49582B756085ACD916196E7D971D6C606A22F7B957E6507D2EBD6BAC7BFB`。

## 2026-08-24：普通战斗到 AI 角色扮演完整闭环收口（0.5.86）

- 追加官方导出链复核：本地 SillyTavern `1.18.0` 导入 `魔法少女世界1.png` 后，先确认内嵌世界书，再在角色管理中切换到该卡；Tavern Helper `4.9.3` 的角色脚本库显示“MVU变量框架”和“魔法少女世界运行时”，MUV 状态栏显示 `魔法少女世界0.5.86`。
- 通过 SillyTavern 官方“导出并下载 -> PNG”导出 `C:\Users\EDY\Downloads\魔法少女世界1.png`，重新解包确认仍有 14 条世界书、7 条正则和 2 个角色脚本。导入后只查看全局/预设脚本库或未切换当前角色，会错误显示空列表；该前置步骤记录在 `README.md` 和 P56。

- 战斗终态提示改为按 ordinary/run 与 victory/defeat/terminated 输出短控制行，并固定放在战后用户消息末尾。真实 Tavern 提示词 A/B 表明，一条自然语言要求能稳定让 `deepseek-v4-flash` 同时输出奖励、经验、`<UpdateVariable>` 和 2-5 个领奖后剧情 `<Option>`；继续增加键值门禁和字段说明反而会提高整段遗漏概率，因此没有扩展 AI 协议或 JSON 嵌套。
- 世界书明确奖励候选和经验必须在当前回复立即写入，Option 只表示领奖完成后的剧情行动；领取、查看、选择和放弃奖励不属于 Option。当前卡牌格式仍是浅层 JSON + 简易公式，复杂卡牌输出长度和 `effects` 契约不变。
- `inspectRewardCandidates()` 复用唯一核心候选校验器。common 在渲染奖励时提前检查每项候选，无效项显示精确原因并禁用；有效项仍可领取，全部无效时仍可跳过。确认提交继续由同一校验器原子复核，没有在 UI 中复制卡牌规则。
- 新增真实聊天只读审计器 `npm run tavern:audit-battle-loop -- <avatar.png> <chat-file>`，检查 Option、奖励预算、候选合法性、经验、`run=null`、敌人清理、领取后永久入库、候选清空和剧情续写。终态审计可从不可变 AI 回复中的 `_.assign('reward.*', JSON)` 重建已清空候选，避免领取后失去验证证据；“查看既有遗物链路”不再被误判为“查看奖励”。
- 最终两次完整 `npm run release:tavern` 均全部通过，收口复跑用时约 `215.8s`。最终 PNG 为 `7,502,453` 字节，SHA-256 `940A91C417F66ABDFBC7B07ACF3C9EABB06B67B6F1C2307E578B4BF19F3C055A`；`character-runtime.js` 为 `857,222` 字节，SHA-256 `BCBCA58AFDA283D7E127F1B65D148C6F87E68031795581D68D78F555612B8F7E`。portable combined/card/battle 为 `179,131/129,866/179,978` 字节。
- 最终卡在真实 SillyTavern `1.18.0` 导入为 `魔法少女世界14.png`，确认并链接 `魔法少女世界0.5.86`；酒馆助手为 `4.9.3`，MUV 为 `v0.181.0`。闭环夹具 `battle-repair-loop-2026-08-23T18-28-06Z` 以 `run=null` 和 `LV1/90` 开始，零费“闭环终击”击败 3 HP 敌人。
- 真实 `deepseek-v4-flash` 生成 3 卡、1 道具、25 EXP 和 3 个普通剧情 Option。MUV 结算到 `LV2/15`；非法“镜面回环”因把 `discard/draw` 合在同一效果对象而禁用，“回声观测/碎镜迸射/镜光药水”保持可领。领取“回声观测”和“镜光药水”后永久内容各增加一次、候选清空，Option 自动恢复。
- 点击“走到窗边”后新增结构化用户楼层，附带一次性奖励摘要；模型返回普通剧情、3 个下一步 Option、`<UpdateVariable>` 和最新状态栏。整页刷新并从最近聊天重开后，聊天为 5 个可见消息、只在最新 AI 楼层 `mesid=4` 挂载一个 iframe；等级、经验、牌组、道具、`run=null` 和空敌人一致恢复。最终审计报告为 `phase=story-resumed`、`ok=true`、`issues=[]`。
- 上游 MVU 已具有额外模型解析，但按当前范围不升级、不加世界书标记、不改变主线。调查结果和未来验收边界单独记录在 `docs/future-mvu-extra-model.md`。

## 2026-08-23：主体数据契约、复杂卡牌和后端边界收口（0.5.84）

- 新增 `schemas/mwg-mvu-stat-data-v1.json`，逐字段记录当前 `stat_data` 的 shape、所有者、生命周期、写入方和允许 AI 命令。`test:mvu-contract` 从 `变量初始化.json` 展开全部叶子与可扩展对象，确认 57 个规范路径一一覆盖，并扫描正式世界书和宿主适配器，拒绝旧字段重新进入生产链路。
- 删除快照报告对敌人 `actionMode/actionConfig` 的 camelCase 回退、远征种子对嵌套牌组的 `flat(2)` 展开，以及 MUV 数组读取器对旧字符串占位符 `"[]"/""` 的识别。生产 `src` 只接受当前直接数组和 `$__META_EXTENSIBLE__$` 初始化标记；运行时能量、格挡与抽牌规则仍只属于 `BattleState`。
- 新增 `ai-complex-content-v1.json` 完整首轮压力夹具，覆盖 X 费、状态公式、条件组合、多触发 Power、弃牌/回收/减费、动态衍生牌与自定义状态。六种卡牌中最大容器深度为 4，最复杂卡为 93 token，完整 14 张牌构筑连同状态、遗物、道具和欲望效果为 558 `o200k_base` token；内容契约、程序描述、实际公式执行和精确错误路径共同通过。
- portable 门禁新增 TypeScript 运行时依赖闭包检查。卡牌入口为 37 个运行时模块，不得依赖战斗状态、回合、快照、终态或参考宿主；战斗入口为 67 个模块并单向复用卡牌闭包。真实 card/battle/combined bundle 已构建，磁盘动态导入、伤害执行、快照和外部 TypeScript 消费者均通过。
- `docs/worldbook-migration.md` 的当前字段章节已改为严格单协议说明；历史段落仅保留决策证据，不代表当前卡继续支持旧聊天。本批没有增加 AI 字段、MUV 路径、远征玩法或 UI，远征仍是默认 `null` 的整体可选模式。
- 完整 `npm run release:tavern` 用时约 `207.1s` 并全部通过。最终 PNG 为 `7,494,845` 字节，SHA-256 `D26FD3DDBF7EA5B987E528D52564A1ADF7445D0AA77FBA1F8C673064065D3B0A`；`character-runtime.js` 为 `855,067` 字节，SHA-256 `09F102F18B60CD3DFD2551644A3EFAA7721F050B0E17E883AB93593E6289489A`。portable combined/card/battle 为 `178,105/129,866/178,952` 字节，SHA-256 依次为 `C47BF7E4A7A6853D435CAFC47F6FAB5D3C7BDDFE20E1BA79090CCBC23CC89C2E`、`DC92461873125EC5E35E8762ADDFAB523A70D6328E65660BA42FD90424D4EAB0`、`54CDDD1039C4A94445772AB624CC368CC449B62794783789219F46348BEA2270`。完整世界书/普通回合/首轮仍为 `12,850/3,756/9,282 o200k_base token`。
- 最终卡在真实 SillyTavern `1.18.0` 导入为 `魔法少女世界12.png`，确认并链接 `魔法少女世界0.5.84`。酒馆助手为 `4.9.3`，MUV 为 `v0.181.0`。普通模式夹具 `readiness-valid-2026-08-23T16-07-44Z` 的 `run=null`、原生正文、唯一状态栏 iframe、两个普通 Option、隐藏路线和唯一远征入口均通过。
- 真实普通战斗夹具 `battle-repair-status-2026-08-23T16-24-04Z` 明确保持 `run=null`。打出“星痕叠印”后手牌 `5 -> 4`、弃牌 `0 -> 1`、1 层星痕与 3 格挡；结束回合后进入回合 2，玩家 `41/80 HP`、无状态、手牌/抽牌/弃牌/消耗为 `5/0/5/0`。官方快照的 `requestNodeId=null`，整页刷新并从最近聊天重开后数值、牌区和顺序一致，证明主体战斗不依赖可选远征。
- 浏览器仍会记录既有上游日志：MUV/酒馆助手注册期的无路径 `Type mismatch: expected object schema but got undefined at path`、SillyTavern 设置初始化重试和宏 API deprecation。项目状态栏、战斗事务、官方快照和刷新恢复均成功，未出现项目运行时错误或失败 UI；后续依赖升级时按既有 P41 规则复查。

## 2026-08-23：远征改为显式可选模式并完成实机收口（0.5.83）

- 普通 AI 角色扮演恢复为默认流程。首轮和普通剧情仍输出原生正文与 `<Options>`，`变量初始化.json` 保持 `run/run_result/run_upgrade=null`；common 同步只处理已存在的远征，不再自动创建 `run`。
- `TavernRunActionHost.startRun()` 成为唯一远征创建入口。状态栏无 `run` 时隐藏路线区，只在最新楼层“卡牌与资源”的首项显示“开始远征”；起始内容无效时复用同一内容门禁并显示修复入口。路线、营火、商店、Boss 与 Act 推进只有玩家主动开启后才参与流程，没有增加 AI 字段或 MUV schema。
- 实机发现深层远征按钮在高 iframe 中不利于操作和自动验证，入口已移到面板首项。common 初始化改用原生、幂等 DOM readiness，不再依赖某个 jQuery ready 实例；远征开始/修复改为 document 委托，发送锁和历史楼层会显示原因而非静默返回。
- `npm run release:tavern` 最终完整通过，用时约 `352.9s`。最终 PNG 为 `7,495,149` 字节，SHA-256 `4CDE304D0E0DD690345D7EC5266EFA16CD34B88C30383B78AA97FC8E18A5CBA5`；`character-runtime.js` 为 `855,181` 字节，SHA-256 `2332439A31849F33DF0FBD7C2EF35F1CF61DD68A9A49423B77B2E7F2D0417F56`。
- portable combined/card/battle 均为 `0.5.83`，大小 `178,105/129,866/178,952` 字节，SHA-256 分别为 `C47BF7E4A7A6853D435CAFC47F6FAB5D3C7BDDFE20E1BA79090CCBC23CC89C2E`、`DC92461873125EC5E35E8762ADDFAB523A70D6328E65660BA42FD90424D4EAB0`、`54CDDD1039C4A94445772AB624CC368CC449B62794783789219F46348BEA2270`。
- 最终卡导入真实酒馆为 `魔法少女世界11.png`，确认并链接 `魔法少女世界0.5.83`。夹具 `readiness-valid-2026-08-23T15-18-59Z` 打开时路线隐藏、入口唯一、MUV `run=null`；点击后写入 `awaiting_choice / act 1 / floor 0 / gold 99` 和 `a1_f1_battle_0_0`。整页刷新并从最近聊天重开后，路线按钮、阶段和数值完全恢复。
- 当前输出测量为完整世界书 `12,850`、普通回合 `3,756`、首轮 `9,282 o200k_base token`；战斗路线含构筑预算为 `138`。可选远征没有改变卡牌 JSON、复杂公式或候选内容输出长度。

## 2026-08-23：运行时兼容层最终清理（0.5.79）

- 删除 `src/runtime/tavernRuntime.ts` 中完整的 localStorage 变量库、训练卡组和伪造 Tavern Helper API。common/fish 现在通过 `tavernHost.ts` 严格要求真实 `getVariables/replaceVariables/updateVariablesWith/insertOrAssignVariables/getCurrentMessageId/getLastMessageId`，缺失时直接显示宿主错误，不再让本地模拟掩盖酒馆链路故障。
- 消息变量操作必须取得明确且非负的当前楼层 ID；缺少或非法 ID 不再回退 `latest`。最新楼层判断同样要求真实 current/last ID，历史楼层继续保持只读并请求 Tavern Helper 重新应用正则深度。
- 删除终局 `winner` 副状态和从 `winner` 推测胜负的旧快照回退。schema 3 快照必须包含合法 `battleResult` 与字符串 `battleNarrative`；战斗会话恢复只返回现代 `GameState | null`，不再暴露无人消费的 stale 兼容标记。
- MUV 适配只接受当前 `变量初始化.json` 的直接标量和直接数组。嵌套 `[items, description]`、嵌套牌组/奖励和道具 `quantity`、敌人 `isBoss`、中文 `回合数` 等历史别名全部删除；`$__META_EXTENSIBLE__$` 只允许在 runtime 初始化边界被过滤，`game-core` 与 portable 包不再认识任何 MUV 标记。
- 删除 common/fish/start 的全部生产 `console.log`、完整 `stat_data` 序列化、按钮调用栈、逐卡/逐状态日志，以及 `debugData/checkSendingState/resetSendingState/testVariableOperations/refreshData` 调试全局入口。错误与事务恢复警告保留，状态栏、战斗布局、正文/iframe 分流和 AI 浅层 JSON 协议均未改变。
- 完整 `npm run release:tavern` 用时约 `208.9s` 并全部通过，仅有既有 Webpack 体积建议。最终角色卡为 `7,528,877` 字节，SHA-256 `2886714296607F491007255A26C1F7DDDB1F61D0B92D5620350BB23EA8980418`；`character-runtime.js` 为 `867,773` 字节，SHA-256 `14DE98B3BE1255A07A9D7702FC75B936D261A0AB3C235AC8FFF955BA607F5FD8`。portable combined/card/battle 分别为 `179,406/130,371/180,253` 字节，SHA-256 为 `982D9B0AEB451F1B7514025CA59B1CF347EFD7BF46FC1940D87BA827C92C8555`、`1BF7F6DC02CE60FB24B565408934DA4CC2E7496367FCBDCBA0B4EA1A58118722`、`6349085FE3FA8E95F8D54AFC1E8459D0505B4D7302EF66A5FDA371DC23E1E35A`。
- 最终卡在 SillyTavern `1.18.0` 中导入为 `魔法少女世界7.png`，运行时日志确认 `0.5.79`；酒馆助手为 `4.9.3`，MagVarUpdate 为 `v0.181.0`。隔离夹具 `battle-repair-status-2026-08-23T12-33-31Z` 在玩家回合 1 以 `40/80 HP` 开始；打出 `status_apply__2` 后手牌 `5 -> 4`、弃牌 `0 -> 1`、获得 1 层星痕与 3 格挡。结束回合后进入回合 2，玩家为 `41/80 HP`、无状态、弃牌 5，手牌顺序为 `status_attack__3/status_attack__1/status_defend__2/status_attack__2/status_defend__1`。整页刷新并从最近聊天重开后，回合、生命、状态、牌区和实例顺序完全恢复；原生正文位于项目 iframe 外且在战斗页之前，消息项目 iframe 恰好 1 个，无残留 modal。
- 酒馆控制台在每次 `global_Mvu_initialized` 后由 MagVarUpdate/酒馆助手函数工具注册链输出一次无路径的 `Type mismatch: expected object schema but got undefined at path`。该日志发生在项目战斗恢复前，随后宿主注册完成；本轮实际 MUV 读写、消息快照、出牌、回合推进和刷新恢复均通过，项目运行时没有对应异常分支或失败状态。将其记录为当前依赖组合的上游诊断噪声，后续升级依赖时复查。

## 2026-08-23：严格现代单协议清理（0.5.77）

- 外部内容只接受浅层 `effects`/`discard_effects`；`effect`、`discard_effect`、`effect_program/effectProgram`、`ME/OP/ALL`、字符串触发器/条件/选择器/动态插牌和平铺 `battle` 根均被拒绝。
- 删除旧效果 parser、旧 Tavern host、旧字符串卡牌宿主、现代转旧适配器、旧意图分析、旧 UI 展示器、旧变量解析器以及只服务这些入口的选择器/条件模块和测试。`0.5.76` 角色卡保留为独立回退点，不在新运行时中继续携带兼容代码。
- `EffectProgramDisplay` 直接遍历类型化程序生成卡牌提示、能力/遗物/状态标签和敌人意图；现代程序不再为了 UI 反向编译为文本。`effectDefinitions.ts` 收缩为实际显示所需的属性名和触发器配置。
- `battleContentPreflight` 从七百余行双协议分支收缩为核心 `validateContentPackContract` 加酒馆专属数值、行动配置、描述与可玩性检查。奖励、首轮内容和 MUV adapter 使用相同的严格失败语义。
- MUV 当前根固定为 `stat_data.battle`，战斗私有快照 schema 升至 `3` 并要求所有运行时可执行对象包含合法 `EffectProgram`；战后结算不再读写平铺 `battle`。
- start/common/fish 楼层规则和 UI 位置不变：start 只在 AI 消息 0，common/fish 只在最新 AI 楼层，原生正文不进入 iframe，状态栏追加在正文末尾，战斗页仍位于引导正文之后。
- 删除最后一个未接入发布门禁、仍引用已删除 selector 模块的孤立测试脚本，以及无人使用的 fish 历史类型重导出；静态扫描不再发现生产或可执行测试对旧 parser/host/adapter/UI 模块的引用。
- 完整 `npm run release:tavern` 通过。最终角色卡为 `7,593,429` 字节，SHA-256 `68BC2298F720A02FDE9B6B15946368FC12BBCA74C295707C49F3424C8828F45F`；`character-runtime.js` 为 `891,973` 字节，SHA-256 `BD12A1242CB1E9AE7B680E4B6B8C03F757A98565899C151FAB70B67772411E05`；start/common/fish 壳为 `4,489/4,696/4,615` 字节。
- 最终卡在 SillyTavern `1.18.0` 中导入为 `魔法少女世界5.png`，确认并链接世界书 `魔法少女世界0.5.77`。全新现代夹具 `battle-repair-status-2026-08-23T10-42-56Z` 打出状态牌后正确执行 `apply` 与 `hold`，结束回合执行 `tick`、衰减和移除，进入回合 2 时玩家为 `41/80 HP`、无状态、弃牌堆 5。整页刷新并从最近聊天重开后恢复相同回合、生命、状态和手牌顺序 `status_attack__3/status_attack__1/status_defend__2/status_attack__2/status_defend__1`。原生正文保持在 iframe 外并位于战斗页之前，当前消息 iframe 恰好 1 个且无残留 modal。
- 至此旧系统迁移完成。后续迭代只以现代浅层 JSON + 简易公式为协议，不再恢复旧聊天、旧字段或旧效果字符串兼容，也不再以新增玩法字段延后维护性工作。

## 2026-08-23：后端可移植发布批次（0.5.78）

- 将战斗快照 fingerprint、schema 3 和可执行程序完整性校验迁入 `src/game-core/battleSnapshot.ts`；fish 的 `battleSessionStore` 只负责 `__magic_girl_world.battle_session` 的消息变量读写。
- 新增 `src/portable/` 公共入口、ESM bundle 构建、版本清单、SHA-256 和 `.d.ts`。`card-backend.mjs`、`battle-backend.mjs`、`magic-girl-core.mjs` 均不包含 Tavern Helper、MUV、DOM、时间或全局随机依赖；参考宿主仍为可选组合，不复制规则。
- 新增 portable boundary、bundle 执行和外部 TypeScript consumer 门禁。构建后实际导入卡牌与战斗包，执行浅层效果编译、3 点伤害和 schema 3 快照读取。
- 完整 `npm run release:tavern` 用时约 `211.1s` 并通过。最终角色卡为 `7,592,061` 字节，SHA-256 `E48FA4F755DD2A44E33BE6F815680B316C2B68E2DB99E61F1AA73E85594281CA`；`character-runtime.js` 为 `891,460` 字节，SHA-256 `19EA38363B259382E9366F7E01A9F034C62A96FA6761B087D22BAFB86485E239`。portable combined/card/battle 分别为 `179,981/130,554/180,828` 字节，SHA-256 为 `C0E31D35CE84A4E223B430B142A67EA3B5B43C73C265F7DBFB237169F4EB8DCC`、`9B59374058D721DD3CF8479DA88E8A1D87272EE4143BA7E005F61541B45C307F`、`42A6FEA94E681C295482126FBFE2AE7FC7DEF3E21421FA314E8CD334E1336417`。
- 最终卡在 SillyTavern `1.18.0` 导入为 `魔法少女世界6.png`，确认内嵌世界书 `魔法少女世界0.5.78` 后创建全新夹具 `battle-repair-status-2026-08-23T11-33-40Z`。打出 `status_apply__2` 后手牌 `5 -> 4`、弃牌 `0 -> 1`、获得 1 层星痕与 3 格挡；结束回合执行 tick、衰减和移除，进入回合 2 时为 `41/80 HP`、无状态、弃牌 5。整页刷新并从最近聊天重开后恢复相同回合、生命、状态和五张手牌顺序，原生正文在 iframe 外、消息 iframe 恰好 1 个且无 modal。
- 删除从首个提交遗留且从未进入构建、类型入口或生产 import 的 `手机界面/界面模板/界面示例/脚本模板/脚本示例`。这些目录包含第二套手机聊天、动态空间、备份 HTML、教学控件和外部表情资源，不属于魔法少女世界运行链路；Git 历史保留原内容。新增 `test:source-layout`，顶层源码只允许 `adapters/common/fish/game-core/portable/runtime/start` 七个所有权根。

## 2026-08-23：状态完整生命周期迁入可移植核心（0.5.76）

- 新增 `src/game-core/statusLifecycleRuntime.ts`，统一状态 `apply/stack/tick/remove`、层数上限与衰减、显式/批量移除、状态所有权事件、旧直接修饰符清理和旧 `stacks` 替换。`apply/stack` 保持在调用方外层动作事务中；`tick/remove` 使用可恢复的嵌套事务，单个触发失败不会阻断后续衰减与移除。
- `TavernBattleTriggerHost` 只注入当前状态、定义、事务、效果、分发和呈现端口，并把结构化事件映射为日志/动画；不再拥有状态施加、衰减、移除或所有权分发规则。`ReferenceBattleRuntimeHost.createStatusLifecycleRuntime()` 让网站、服务和 Mod 组合相同生命周期而无需导入 fish、MUV 或 Tavern API。
- 边界测试禁止 fish 恢复状态生命周期辅助函数，三条锁定旧宿主实现的静态断言改为验证核心所有权。本批不增加 AI 字段、MUV schema、世界书 token 或 UI：start 仍只挂 AI 消息 0，common/fish 仍只挂最新 AI 楼层，正文保持原生，战斗页仍位于引导正文之后。
- 完整 `npm run release:tavern` 用时约 `262.3s` 并通过。最终卡为 `7,892,237` 字节，SHA-256 `07C5B75B5708C578F4040DCCEB1406AFE76817B305C9B9F452E22FE1345C2F54`；`character-runtime.js` 为 `1,002,793` 字节，SHA-256 `FC2774BABBB6FC6AADA6C6B45C16F9C28450A69428F391F41E5C7E084277F204`；start/common/fish 壳仍为 `4,489/4,696/4,615` 字节。
- 最终卡在 SillyTavern `1.18.0` 导入为 `魔法少女世界4.png`，确认并链接世界书 `魔法少女世界0.5.76`。干净夹具 `battle-repair-status-2026-08-23T08-52-55Z` 依次覆盖 `apply -> hold -> stack -> explicit remove -> reapply -> tick -> stacks_change:-1 -> decay remove`：回合结束前玩家 `45/80 HP`、8 格挡、1 层星痕；结算后为 `49/80 HP`、0 格挡、无状态、回合 2。整页刷新并从最近聊天重开后恢复相同数值和五张手牌；原生引导正文在 iframe 外，消息 iframe 恰好 1 个且无残留 modal。
- 用户在本版验收时明确后续不再要求旧语法兼容。`0.5.76` 作为删除前可回退基线；下一批以现代浅层 JSON + 简易公式为唯一生产协议，删除旧字符串 parser/host/adapter、旧世界书示例和只服务旧存档的测试，不再为旧入口增加实现。

## 2026-08-23：触发定义与声明式修饰符迁入可移植核心（0.5.75）

- 新增 `src/game-core/legacyTriggerSyntax.ts`，唯一负责顶层效果分段、旧 `target.trigger(effects)` 解析/格式化、别名归一化和遗物触发片段选择。删除 fish 的 `abilitySyntax.ts`、`effectListSyntax.ts` 与 `triggeredEffectSyntax.ts`；预检、旧 parser、展示和 Tavern 宿主直接消费核心兼容结果，现代程序不经过旧语法。
- 新增 `src/game-core/triggerDefinitionRuntime.ts`。能力和遗物都先解析为只含现代 `EffectProgram` 或旧效果片段的执行计划；定义顺序、现代优先、按目标/触发器隔离的递归门禁和异常后门禁释放只实现一次。Tavern 能力/遗物宿主仅负责读取 `BattleStateStore`、嵌套回滚事务、效果端口和呈现，并把伤害、格挡等事件 context 原样交给能力计划。
- 新增 `src/game-core/declarativeModifierRuntime.ts`，统一现代/旧 ability、relic passive 与状态 hold 的声明式修饰符。删除 fish `passiveAbilityModifiers.ts`；数值运行时与 UI breakdown 继续通过同一来源，不产生刷新敏感的直接修饰符写入。
- `ReferenceBattleRuntimeHost` 增加能力与遗物触发运行时组合入口。网站、服务和 Mod 可以复用同一旧别名、定义匹配、顺序和递归规则，只实现自己的执行端口；核心仍不依赖 Tavern、MUV、DOM、日期或全局随机数。
- 本批没有增加 AI 字段、MUV schema、世界书语法或 token，也没有修改开始页和战斗布局。start 仍只挂 AI 消息 0；common/fish 仍只挂最新 AI 楼层，正文保持原生，数值更新只作用于所属 iframe。
- 完整 `npm run release:tavern` 用时约 `269.9s` 并通过。最终卡为 `7,888,885` 字节，SHA-256 `050C989D2D2CD073EA386998B984E436797AD38F93441034D5D27BC3CDE39063`；`character-runtime.js` 为 `1,001,538` 字节，SHA-256 `69756FE26E11F7CE0B2655AB9F099901382CDC70237809E094A3F3673EA197CB`；start/common/fish 壳保持 `4,489/4,696/4,615` 字节。
- 最终卡在 SillyTavern `1.18.0` 导入为 `魔法少女世界3.png`，确认并链接世界书 `魔法少女世界0.5.75`。隔离夹具 `battle-repair-triggers-2026-08-23T08-05-50Z` 同时载入现代/旧能力、现代/旧遗物和现代/旧 passive。零费 3 伤害探针受两种 passive 后造成 6 伤害，四个 `card_played` 来源各执行一次，玩家获得 `1+2+4+8=15` 格挡；刷新重开后再次打出 4 伤害牌，受 passive 后造成 7 伤害并再次获得 15 格挡。最终快照为玩家 `50/80 HP`、30 格挡、`2/3` 能量，敌人 `23/36 HP`，牌区 `3/5/2/0`，出牌计数 `2/2/0`。再次刷新重开后完全恢复，原生引导正文在 iframe 外，消息 iframe 恰好 1 个且无残留 modal。`0.5.75` 成为最新真实酒馆基线。

## 2026-08-23：现代数值战斗效果迁入可移植核心（0.5.73）

- 新增 `src/game-core/battleEffectRuntime.ts`。`BattleEffectRuntime` 直接执行现代 `damage/heal/gain_block/gain_energy/gain_lust/set_stat/modify` 命令；目标解析、修饰符顺序、格挡吸收、属性 clamp/round、属性事件计划和死亡标记由核心持有，只通过状态、修饰来源、触发、欲望溢出和呈现端口连接宿主，不依赖 Tavern、MUV、DOM、全局随机数或日期。
- 伤害顺序保持既有行为：来源伤害修饰、目标受伤修饰、格挡吸收、`lose_block` 触发、刷新触发后 HP 基线、HP 变化、`take/deal_damage` 触发、最终死亡标记。治疗、格挡、能量、欲望和 `set_*` 同样保留动画/日志、属性触发、欲望溢出与能量可暂时超过上限的旧语义。
- `TavernEffectCommandHost` 现在按命令类型直接调用 `CardEffectRuntime`、`BattleEffectRuntime`、`TavernBattleTriggerHost`、能力注册或叙事端口。`src/fish/core/effectCommandAdapter.ts` 及其测试已删除；现代数值、状态、修饰符和叙事不再构造伪旧 `EffectExpression`。`UnifiedEffectExecutor.executeExpression()` 只服务历史字符串兼容。
- `ReferenceBattleRuntimeHost.createBattleEffectRuntime()` 为网站、服务或 Mod 提供相同数值效果组合入口。新增核心行为测试覆盖修饰符、格挡触发中途治疗、敌方来源、clamp、能量、欲望溢出和死亡；结构门禁拒绝 Tavern/MUV/DOM 依赖及现代命令回流旧表达式。
- 本批不修改开始页、战斗页布局、世界书、AI 浅层 JSON、公式、MUV schema、玩法字段或 token。start 仍只允许 AI 消息 0；start/common/fish 仍固定 `placement=[2]`、`minDepth=0,maxDepth=0`，正文保持原生，common/fish 只在最新 AI 楼层末尾互斥挂载。
- 完整 `npm run release:tavern` 一次通过，用时约 `310.8s`。最终发布卡为 `7,889,661` 字节，SHA-256 `4FEF304F04C8E307164C13465DC60E1A3BC49506C1227E64DB6633ECD9B00BC5`；`character-runtime.js` 为 `1,001,827` 字节，SHA-256 `0575B160EAFA14BACA90452BD3BC12F0C1453D46C77C368E645D38E964C23C93`；start/common/fish 壳保持 `4,489/4,696/4,615` 字节。
- 最终卡导入 SillyTavern `1.18.0` 为 `魔法少女世界194.png`，酒馆助手 `4.9.3`、MUV `v0.181.0`；世界书 `魔法少女世界0.5.73` 已确认导入并链接。最终效果链夹具只有一个 `0.5.73/fish` 消息 iframe，原生引导正文在外。依次打出五张先天卡后：格挡先设为 3；7 点攻击受被动 `+2` 后使敌人 `36 -> 27`；玩家变为 `68/80 HP`、9 格挡、`4/3` 能量；敌人变为 `20/100` 欲望并获得 2 层 `weak`；玩家 `focus` 被移除。官方消息快照保存回合 1、五张弃牌、抽牌 6 和相同数值；整页刷新从最近聊天重开后，数值、状态、空手牌、唯一 iframe 和无 modal 全部恢复。

## 2026-08-23：现代卡牌副作用迁入可移植核心（0.5.72）

- 新增 `src/game-core/cardEffectRuntime.ts`。`CardEffectRuntime` 直接执行抽牌、预见、弃牌、消耗、取回/检索、减费、复制、下次双倍和现代动态插牌，并统一持有牌区计划、稳定 ID 选择、宿主响应校验与提交顺序；它只依赖 `BattleStateStore` 端口及选牌/生命周期/呈现端口，不读取 Tavern、MUV、DOM、全局随机数或日期。
- `TavernEffectCommandHost` 现在用 `isCardEffectCommand()` 把现代卡牌命令直接交给 `CardEffectRuntime`。`effectCommandAdapter.ts` 改为只适配非卡牌战斗命令，现代卡牌命令不再往返 `EffectCommand ->` 伪旧 `EffectExpression -> TavernCardEffectHost`。
- `TavernCardEffectHost` 退化为只读旧语法归一化器：可规范化的历史抽牌、选牌、牌区和卡牌修改语义进入同一 `CardEffectRuntime`；只有不含现代程序的历史动态卡保留薄插入兜底。`CardSystem` 只提供 Tavern 选牌 UI、抽弃牌/消耗生命周期、日志和动画端口，零调用的 `selectCards`、`selectCardsWithSelector`、`executeCardZoneOperation` 与 `exhaustOwnedCards` 已删除。
- `cardZoneOperation` 增加 `excludeCardIds`，正在结算的卡不能把自己当作弃牌/消耗候选；`BattleStateStore.addCardToHand()` 返回是否受手牌上限成功接收。`ReferenceBattleRuntimeHost.createCardEffectRuntime()` 为网站、服务或 Mod 提供相同组合入口，不复制 Tavern 规则。
- 本批不修改开始页、战斗页布局、世界书、AI 浅层 JSON、公式、MUV schema、玩法字段或 token。start 仍只允许 AI 消息 0；start/common/fish 仍固定 `placement=[2]`、`minDepth=0,maxDepth=0`，正文保持原生，common/fish 只在最新 AI 楼层末尾互斥挂载。
- 新增卡牌副作用核心/宿主测试，并更新牌区、事务、旧效果、现代命令和结构门禁。完整 `npm run release:tavern` 一次通过，用时约 `256.4s`。最终发布卡为 `7,875,685` 字节，SHA-256 `F4347484552DF09AE77D1A9627ACC03C277CA98E3E8C9C7C21B26BE57E30E129`；`character-runtime.js` 为 `996,590` 字节，SHA-256 `5ED3859EF2543E4C592DB5A82B51659975947F90217BB5716A893CF7DD83AB92`；start/common/fish 壳保持 `4,489/4,696/4,615` 字节。
- 最终卡导入 SillyTavern `1.18.0` 为 `魔法少女世界193.png`，酒馆助手 `4.9.3`、MUV `v0.181.0`；世界书 `魔法少女世界0.5.72` 已确认导入并链接。预见夹具只有一个 `0.5.72/fish` 消息 iframe，原生引导正文在外；“星见”只打开一个通用 modal、旧 modal 为 0，候选严格为牌库顶 3 张。选择一张后玩家 `80/80 HP`、20 格挡、`3/3` 能量，手牌/抽牌/弃牌/消耗为 `4/6/2/0`。消息快照一致；整页刷新落到欢迎页后从最近聊天重开，仍恢复回合 1 和相同牌区，且无残留 modal 或重复项目 iframe。

## 2026-08-23：战斗状态所有权迁入可移植核心（0.5.71）

- 新增 `src/game-core/battleState.ts`，由无 Tavern、MUV、DOM 和全局随机依赖的 `BattleStateStore` 唯一拥有玩家/敌人状态、回合、计数器、牌区、状态增删、运行时 ID、确定性 PRNG、监听、快照和回滚。`GameStateManager` 继承该核心，只保留 MUV 读取/转换、战斗预检、消息快照持久化、诊断与旧敌人恢复兜底，不再维护第二套状态方法。
- 生产 fish 模块直接从 `game-core` 读取战斗类型；`src/fish/types/index.ts` 只做兼容重导出。结构门禁禁止生产代码重新依赖 fish 类型入口，也禁止 `GameStateManager` 重新出现牌区、回合、状态或随机规则。
- 新增 `ReferenceBattleRuntimeHost`，把同一 `BattleStateStore` 与现有动作门、嵌套触发事务组合为网站、服务或 Mod 的参考宿主。它不实现效果引擎；外部接入仍通过稳定端口复用现有规则与事务。
- 新增可移植状态和参考宿主聚焦测试；完整 `npm run release:tavern` 一次通过，用时约 `261.5s`。最终发布卡为 `7,873,197` 字节，SHA-256 `2737B839740AE18E36DB3DF01B72C9CFD5447E27C75C8ED81EF212B2D948D4BD`；`character-runtime.js` 为 `995,657` 字节，SHA-256 `87A67AC1FB6C94CF4D911C09EF6D06BB8162CC0BB6B0FDB5C60154C4EF4A8632`；start/common/fish 壳保持 `4,489/4,696/4,615` 字节。
- 最终卡导入 SillyTavern `1.18.0` 为 `魔法少女世界192.png`，酒馆助手 `4.9.3`、MUV `v0.181.0`；世界书 `魔法少女世界0.5.71` 已确认导入并链接。start latest 实机只有一个 `0.5.71/start` iframe且创建按钮初始禁用；historical 实机为零消息 iframe，原生两条正文保留，全程无模型调用。
- 合法战斗夹具只有一个 `0.5.71/fish` iframe，原生引导正文在外。打出“三重星芒”后敌人 `36 -> 27`、能量 `3 -> 2`、手牌 `5 -> 4`、弃牌 `0 -> 1`；结束回合后进入回合 2，手牌/抽牌/弃牌为 `5/3/5`，玩家 `80/80 HP`、`62` 格挡，敌人 `27/36 HP`。消息快照保存同一状态；整页刷新落到欢迎页后从“最近的聊天”重开，仍恢复相同数值且只有一个项目 iframe。
- 本版不修改开始页或战斗页布局，不修改 AI 浅层 JSON、公式、世界书、MUV schema、玩法字段或 token。start 仍只允许 AI 消息 0；start/common/fish 仍固定 `placement=[2]`、`minDepth=0,maxDepth=0`，正文保持原生，common/fish 只在最新 AI 楼层末尾互斥挂载。

## 2026-08-23：统一 Tavern 续写与战斗退出事务（0.5.70）

- 新增 `src/runtime/tavernContinuation.ts` 作为四个交互入口唯一的续写事务：角色创建、common 行动、战斗修复和战后继续都用 `createChatMessages([{ role: 'user', message }], { refresh: 'affected' })` 原样创建用户消息，并只把固定 `/trigger` 交给 STScript。生产 `src/start`、`src/common`、`src/fish`、`src/runtime` 已无动态 `/send` 路径。
- `TavernCommonActionHost` 保留现有外部 API，但委托共享 continuation host；`characterCreator` 与 `TavernBattleRepairHost` 同样不再维护自己的消息/生成事务。共享宿主拒绝空提示和并发请求，并明确区分消息未创建与消息已创建后生成失败：前者允许调用方回滚准备状态，后者保留消息及已提交状态供用户重试生成。
- `TavernBattleEndHost` 统一拥有战后提示构造、奖励预算、构筑建议、结束弹窗恢复、确认结算和结构化续写。退出战斗会先保存完整源楼层变量，再清除私有 `battle_session` 并结算 MUV；消息创建前失败会完整替换回原变量并重新加载战斗，消息创建后 `/trigger` 失败则保留结算。`UnifiedEffectExecutor` 只判定终态并调用 `presentBattleEnd()`，不再拥有战后提示或弹窗控制。
- `BattleSessionStore.clear()` 不再吞掉快照删除错误；失败时恢复内部 enable/fingerprint/generation 状态，使上层事务能够重试或回滚。`messageVariables.ts` 增加完整当前楼层变量替换边界，避免仅恢复部分 `stat_data` 后遗留私有快照或元数据。
- 新增 `scripts/test-tavern-continuation.mjs`，覆盖 `||`、JSON、引号和换行原样传递、并发拒绝、创建失败回滚、`/trigger` 失败不回滚、战斗结算中途完整恢复，以及消息创建后生成失败保留结算。完整 `npm run release:tavern` 一次通过，用时 `257.6s`。
- 最终发布卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,873,389` 字节，SHA-256 `C200B83E4703541B2F1A10F28119E7F0E1A39BA1D0140750E950B04CFEDFE609`；`character-runtime.js` 为 `995,730` 字节，SHA-256 `6D365BC6151BD6F89DD4998F208CA2D84620E96A5C8C796BC608EBF339135E0A`；start/common/fish 壳保持 `4,489/4,696/4,615` 字节。
- 最终卡在 SillyTavern `1.18.0` 中导入为 `魔法少女世界191.png`，酒馆助手 `4.9.3`、MUV `v0.181.0`；世界书 `魔法少女世界0.5.70` 已确认导入。start 首楼层只有一个 `0.5.70/start` iframe。无效战斗实机点击“请求 AI 修复”后，用户楼层完整保留 `[战斗场景修复]` 与全部错误路径，原 fish iframe 从 `1` 降为 `0`；测试服未连接模型导致 `/trigger` 失败，但消息按设计保留。
- 合法夹具 `battle-repair-valid-2026-08-23T03-42-09Z` 重新打开后只有一个 `0.5.70/fish` iframe，原生引导正文在外，敌人“镜影训练体”、玩家回合、结束回合按钮和 5 张手牌均恢复，修复按钮为 0。刷新先落到 P00 欢迎页时，等待初始化完成并从“最近的聊天”打开目标记录即可，不应重复刷新碰运气。
- 本版没有修改开始页、战斗页面布局、AI 浅层 JSON、公式、世界书、MUV schema、玩法字段或 token；三条正则继续固定 `placement=[2]`、`minDepth=0,maxDepth=0`，正文继续由 SillyTavern 原生显示。

## 2026-08-23：统一选牌协议与旧效果解释去重（0.5.69）

- 新增 `src/game-core/cardSelection.ts`：纯核心只使用稳定卡牌 ID 生成自动/交互选择计划，并统一校验候选重复、最少/最多数量、取消语义和宿主响应；随机选择必须注入消息快照 PRNG，不读取 DOM、MUV、Tavern Helper 或全局随机源。
- 新增 `src/fish/core/cardSelectionHost.ts` 作为唯一 Tavern 选牌宿主，只负责 Card 对象与稳定 ID 映射并调用通用弹窗。出牌弃牌费用、现代牌区命令和历史选择器已迁入该宿主；牌区移动、支付、触发器和效果执行继续留在既有唯一协议中。旧 `selectDiscardCards()` 专用弹窗和 `.discard-selection-modal` 样式已删除。
- `TavernLegacyEffectHost` 现在唯一拥有旧 `effect` 字符串的严格执行编译、宽松只读解析、说明生成和敌人意图摘要。`effectAnalysis.ts` 不再用正则猜测旧语义，`UnifiedEffectDisplay` 不再直接创建 parser，也删除了第二套 `parseEffectDescriptionSimple()`。
- 本批不修改开始页、战斗 UI、世界书、AI 浅层 JSON、公式、MUV schema、玩法字段或 token。start 仍只允许 AI 消息楼层 0；common/fish 仍由 `placement=[2]`、`minDepth=0,maxDepth=0` 在最新 AI 楼正文末尾互斥挂载。正文保持 SillyTavern 原生；所属楼层变为历史时通过 `refreshOneMessage(message_id)` 重算正则并卸载项目 iframe。
- 类型检查、统一选牌、旧效果宿主、牌区语义、事件、MUV、快照协调器与效果聚焦测试均通过；完整 `npm run release:tavern` 一次通过，用时约 244 秒。最终角色卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,861,501` 字节，SHA-256 `F03D95E536A7EE97E718CE2FF629F9E7C10110AC43BC003611A9D4CCB5B53F0F`；`character-runtime.js` 为 `991,274` 字节，SHA-256 `C65C6DBF313D5615A0CCD16D63A81ED8E0BB9AE94AEDB8FDBF22A93A5DA428AC`；start/common/fish 壳为 `4,489/4,696/4,615` 字节。
- 最终卡导入真实 SillyTavern `1.18.0` 为 `魔法少女世界190.png`，酒馆助手 `4.9.3`、MUV `v0.181.0`；内嵌世界书 `魔法少女世界0.5.69` 首次确认后已链接到 `character_world`。首次打开夹具时确认框占用 MUV 等待窗口，确认并重新打开同一夹具后正常；这是首次世界书导入前置条件，不是代码回退。
- start latest、start historical、readiness valid 和 battle valid 四个无模型 HTTP/MUV 夹具通过。最终 battle 只有一个 `TH-message--0--0` iframe，原生引导正文在 iframe 外，运行时为 `0.5.69/fish`，敌人“镜影训练体”、玩家回合和 5 张手牌完整恢复。
- 统一选牌实机夹具 `battle-repair-scry-2026-08-23T02-59-56Z` 通过：真实点击“星见”后只出现一个 `.card-selection-modal`，旧 `.discard-selection-modal` 为 0，弹窗显示 `0-3` 张候选范围；选择一张确认后抽牌堆 `7 -> 6`、弃牌堆 `0 -> 2`，牌区结果与预见及已打出卡一致。整页刷新命中 P00 欢迎页竞争后，从最近聊天重新打开同一夹具仍恢复 `6/2`、格挡 20 和剩余 4 张手牌，确认消息快照已持久化。

## 2026-08-23：common 远征行动宿主迁移（0.5.68）

- 新增 `src/common/runActionHost.ts`，唯一拥有路线进入/重试、普通奖励/商店/事件结算、营火恢复/升级请求、新远征和删卡的 Tavern MUV 应用事务。`src/common/index.ts` 不再直接选择结算函数、保存回滚字段或修改上述领域状态，只调用宿主并把结构化结果映射为现有通知和 DOM。
- `src/game-core/runPrompt.ts` 新增宿主无关的 `compactCardForUpgrade()` 与 `formatRestUpgradePrompt()`；AI 仍收到原有三行短升级请求，但卡牌投影不携带 `description/quantity/runtimeId/type/rarity` 等无关字段。路线、选项和营火升级请求现在共享一个纯核心格式入口，网站、服务或 Mod 无需依赖 common UI、MUV 或 Tavern Helper。
- 进入路线、重试和营火升级的创建消息前回滚统一保留字段存在性，区分“字段不存在”和显式 `null`；消息已创建但 `/trigger` 失败仍保留准备状态。事件存在待选奖励时继续等待玩家选择并与 `run_result` 原子结算，空奖励事件仍自动结算；商店继续使用程序价格，营火和删卡继续复用既有唯一核心/适配器，没有新增第二套规则。
- 新增 `test-common-run-action-host.mjs`，覆盖最新/历史楼层、单次 MUV 同步、事件延迟结算、营火升级、路线进入与回滚、重试缺失字段回滚、升级请求投影、普通/商店/事件奖励、恢复、离店、重开和删卡；common 结构门禁明确拒绝这些事务实现回流页面协调器。
- 本批不修改世界书、AI 浅层 JSON、公式、MUV schema、正则或页面布局。start 仍只在 AI 楼层 0；正文保持 SillyTavern 原生；common/fish 仍由 `placement=[2]`、`minDepth=0,maxDepth=0` 在最新 AI 楼层末尾互斥挂载，历史楼层通过单楼重渲染卸载。
- 完整 `npm run release:tavern` 一次通过，用时约 231 秒。最终角色卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,875,365` 字节，SHA-256 `5E8B4E7ED395742FFFCC19660BF6FD32BD0C516018AFCD28E6B3FAABD84522DB`；`character-runtime.js` 为 `996,257` 字节，SHA-256 `F3313B0B02C534F46D27C5ABABE6D716FE81416AA255029AC9823591FC345F85`；start/common/fish 壳为 `4,489/4,696/4,615` 字节。
- 最终卡导入真实 SillyTavern `1.18.0` 为 `魔法少女世界189.png`，酒馆助手 `4.9.3`、MUV `v0.181.0`。start latest/history、readiness valid 和 battle valid 四个 HTTP/MUV 夹具通过且无模型调用；新世界书 `魔法少女世界0.5.68` 已在浏览器确认导入并链接。
- 浏览器确认最终 battle 只有 `TH-message--0--0` 一个 iframe，运行时 `0.5.68`、视图 `fish`，敌人“镜影训练体”、玩家回合、5 张手牌和原生引导正文均正常。最终 common 夹具只有一个 `0.5.68` 状态栏；真实点击路线后完整用户消息创建，AI 楼层和用户楼层 MUV 均保存 `run.phase=in_node/currentNode=a1_f1_battle_0_0`，项目 iframe 从 `1` 降为 `0`，原生正文保留。刷新时仍会先命中已记录的 P00 欢迎页设置竞争，因此浏览器回归通过最近聊天重新打开夹具完成，没有掩盖该测试服问题。
- 输出预算不变：完整世界书 `12,860 token`、普通回合 `3,765`、首轮 `9,279`、初始/战斗修复 `7,649/5,276`；简单营火升级 `24`、复杂升级 `40`、动态生成牌模板 `66`、携带新状态奖励 `101 token`。

## 2026-08-23：旧效果兼容与 common 续写宿主收口（0.5.67）

- 新增 `src/fish/core/legacyEffectHost.ts`，唯一持有 `UnifiedEffectParser`、旧属性优先级排序、条件后置和整链非法拒绝。`UnifiedEffectExecutor` 只把历史 `effect` 字符串委托给该宿主，并继续作为唯一实际副作用执行服务；现代浅层 JSON/`EffectProgram` 不回编译旧字符串。
- 新增 `src/common/commonActionHost.ts`，集中 common 的当前楼层 MUV 写入、准备/发送失败回滚、生成失败保留和并发锁。六条路线、事件、营火、修复及自定义行动续写不再在页面协调器中直接调用 Tavern Helper 全局。
- common 用户消息从 `triggerSlash('/send ...')` 改为官方结构化 `createChatMessages([{role:'user',message}], {refresh:'affected'})`，随后只调用 `/trigger`。公式中的 `||`、浅层 JSON、引号和换行不再经过 STScript 命令解析；省略插入位置以兼容旧版 `insert_at` 与新版 `insert_before`，二者默认都追加到末尾。
- 已按 MagVarUpdate `v0.181.0` 实现核对继承链：处理新 AI 楼层时，MUV 会在之前楼层中向前查找最近一份含 `stat_data` 的消息变量，因此新建用户消息无需复制整份 MUV `data`。创建用户消息前失败会回滚准备状态；消息已创建但 `/trigger` 失败时不回滚，避免手动重试生成读取错误节点。
- 节点重试补齐 `run_result/run_upgrade` 创建失败回滚。新增 common 宿主和旧效果宿主回归，结构门禁禁止 `triggerSlash`/MUV 写入回流 common 页面、禁止 parser/排序回流执行器，也覆盖 `||`/JSON 原样传递、并发、回滚失败包装和非法旧链拒绝。
- 不修改开始页、战斗 UI、世界书、AI 浅层 JSON、公式、MUV schema 或玩法字段。start/common/fish 仍由 `placement=[2]`、`minDepth=0,maxDepth=0` 的互斥正则只定位最新 AI 楼层；start 只允许消息 0，common/fish bootstrap 又校验当前楼层仍是 latest，同一 iframe 仍有单实例标记。正文继续由 SillyTavern 原生显示。视图从 latest 变为历史时先禁用交互，再统一调用酒馆助手 `refreshOneMessage(message_id)` 重算正则深度并卸载旧 iframe；API 失败才保留只读兜底。
- 类型检查及 common 事务、旧效果兼容、核心边界、历史楼层、远征事务和效果链原子性聚焦回归已通过。完整 `npm run release:tavern` 一次通过，用时约 235 秒；实机发现已显示的 latest iframe 在追加消息后不会仅凭正则配置自行卸载，补入共享单楼重渲染边界后只重跑受影响的类型/历史/common/runtime 门禁、生产构建、角色运行时、PNG 补丁和最终 Tavern 契约。
- 最终角色卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,870,309` 字节，SHA-256 `7A266AA9F02883424BB9C3FEEAC62A08D40662004442C82EE222AC7868D2DAC7`；`character-runtime.js` 为 `994,360` 字节，SHA-256 `B59A55C6921DA9C71684B5BA0A4EF30410E1C5F3A97C045D797DC194D804A8CA`；start/common/fish 壳为 `4,489/4,696/4,615` 字节，仍为 `placement=[2]`、`minDepth=0,maxDepth=0`。
- 最终卡导入真实 SillyTavern `1.18.0` 为 `魔法少女世界188.png`，酒馆助手为 `4.9.3`、MUV 为 `v0.181.0`。start latest/history、readiness valid 和 battle valid 四个 HTTP/MUV 夹具通过；浏览器确认 start 最新消息只有 `TH-message--0--0` 一个 iframe，角色创建根可见且按钮禁用。common 真实指针点击路线后，结构化用户消息完整创建，原 AI 楼层 MUV 进入 `run.phase=in_node`，随后旧项目 iframe 从 `1` 降为 `0`，正文保留。
- AI 输出长度不变：完整世界书 `12,860 token`、普通回合 `3,765`、首轮 `9,279`、初始/战斗修复 `7,649/5,276`；动态生成牌模板 `66 token`，携带新状态的现代奖励样例 `101 token`。本批没有新增或加深 AI 输出字段。

## 2026-08-23：遗物生命周期与卡牌副作用宿主拆分（0.5.66）

- 删除 `src/fish/modules/relicEffectManager.ts`，新增 `src/fish/core/relicTriggerHost.ts` 作为唯一遗物生命周期宿主。现代 `effectProgram` 与历史触发字符串共用同一筛选、递归保护、上下文、`recover-and-continue` 事务和 presenter 反馈；宿主通过 `configureExecutionPorts()` 回到唯一 `UnifiedEffectExecutor`，不再形成执行器循环依赖。
- 新增 `src/fish/core/cardEffectHost.ts`，把执行器内的抽牌、随机/选择弃牌、减费、复制、下次双倍、动态插牌、消耗、取回与预见副作用迁到一个 Tavern 宿主。选择、弃牌和消耗继续通过 `CardSystem` 端口，随机弃牌继续使用消息快照中的持久化 PRNG；取回和预见不伪触发抽牌/弃牌事件。
- `UnifiedEffectExecutor.executeCardEffect()` 现在只解析数值并委托宿主；`CardSystem`、`BattleManager` 和 fish 协调器统一调用 `triggerRelics()`。结构门禁禁止恢复旧遗物管理器，并检查两个新宿主无 DOM/MUV/全局随机依赖、私有方法均有真实调用点。
- 类型检查及遗物矩阵、嵌套事务、旧效果兼容、现代效果、抽弃牌/消耗/取回/预见、动态插牌、X 费、牌区所有权、能力/状态/伤害触发、回合事务、内容预检与 `game-core` 边界聚焦回归通过。
- 本批不修改世界书、AI 浅层 JSON、公式、MUV schema 或页面布局。开始页保持最小一次性入口，只在消息楼层 `0` 的初始 AI marker 挂载；正文由 SillyTavern 原生显示，common 状态栏与 fish 战斗页继续由 `placement=[2]`、`minDepth=0,maxDepth=0` 的互斥楼层正则在正文末尾挂载，不新增第二套渲染器。
- 完整 `npm run release:tavern` 一次通过（约 237 秒）。最终角色卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,857,077` 字节，SHA-256 `39CB210F52B1E0B711D48319E2912B11755C29F1F4574579EBF1B76A7D16701F`；`character-runtime.js` 为 `991,015` 字节，SHA-256 `EAC5682A403E8BDEA706C85F664A505B01E5D362E295C1C76374D4CE5291D31B`；start/common/fish 壳为 `3,950/4,157/4,076` 字节，仍为 `placement=[2]`、`minDepth=0,maxDepth=0`。
- 真实 Tavern 导入返回 `魔法少女世界186.png`。最终卡的 start latest/history 分别报告 `1/0` 个消息 iframe，readiness valid 与 battle valid HTTP/MUV 夹具全部通过且无模型调用。浏览器只读复核仍停在“正在初始化…”并连续记录 `Settings not ready, scheduling another save`，与 P00 一致，因此没有把最终 DOM 冒充通过。
- AI 输出长度不变：完整世界书 `12,860 token`、普通回合 `3,765`、首轮 `9,279`、初始/战斗修复 `7,649/5,276`；动态生成牌模板 `66 token`，携带新状态的现代奖励样例 `101 token`。本次拆分没有增加世界书字段或复杂卡牌输出。

## 2026-08-23：战斗触发与现代命令宿主拆分（0.5.65）

- 新增 `src/fish/core/battleTriggerHost.ts`，集中能力递归保护、能力注册/移除、能力与遗物分派顺序、状态施加/叠层/tick/衰减/移除、状态归属事件、旧 `stacks` 占位兼容和 `recover-and-continue` 嵌套回滚。宿主不读取 DOM 或 MUV，只从唯一执行器注入现代程序、旧字符串、遗物和呈现端口。
- 新增 `src/fish/core/effectCommandHost.ts`，集中现代 `EffectProgram` 的顺序运行、终态短路、牌区命令分类、触发器注册和 `EffectCommand -> EffectExpression` 适配。`UnifiedEffectExecutor` 保留执行上下文、死亡结算与实际副作用，不再同时拥有上述调度实现，也没有增加第二个效果执行服务。
- 结构门禁已迁移到新所有权，额外拒绝事务、递归保护或现代命令调度回流旧执行器。类型检查、现代命令、牌区、能力、状态、遗物、伤害、事件与 `game-core` 边界聚焦测试通过。
- 本批不修改世界书、AI 浅层 JSON、公式、MUV schema 或 UI。开始页继续只在消息楼层 `0` 的首轮 AI 消息挂载；start/common/fish 继续使用 `placement=[2]`、`minDepth=0,maxDepth=0`，正文保持原生，最新楼层仅挂载一个对应状态栏或战斗视图，iframe 内状态更新不得创建第二套外层界面。
- 完整 `npm run release:tavern` 一次通过（约 242 秒）；随后现代 Power 兼容字符串补丁又通过类型检查、现代命令/能力/事务/核心边界聚焦测试、生产构建、角色运行时、PNG 补丁和 Tavern 最终校验。最终角色卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,861,269` 字节，SHA-256 `7E2F951C4807E7F6928F0A1A4AC43517FF993BF772A96A23F02B24D775120AE0`；`character-runtime.js` 为 `992,587` 字节，SHA-256 `99D4AE870329279E44299C0A149684808D41E295239EB1C409F180D3C0E6E999`；start/common/fish 壳为 `3,950/4,157/4,076` 字节，均继续为最新 AI 楼层 `0..0`。
- 最终真实 Tavern 导入返回 `魔法少女世界185.png`。start latest/history 分别报告 `1/0` 个消息 iframe，readiness valid 与 battle valid HTTP/MUV 夹具全部在最终卡重跑通过且无模型调用；浏览器在前一候选中确认原生战斗引导正文之后只有一个 fish iframe，并成功导入、链接同版本 `魔法少女世界0.5.65` 世界书。随后 P00 `Settings not ready` 欢迎页竞争在重载时清空活动角色/聊天并留下空 iframe，因此没有把最终战斗 DOM 标记为通过；既有 `Type mismatch` 仍来自 Tavern Helper `log.js`。

## 2026-08-23：首楼层开始页门禁与战斗壳宿主分离（0.5.64）

- start 轻量壳增加首楼层门禁：只有 `getCurrentMessageId() === 0` 的初始 `[开始游戏]` AI 消息挂载角色创建页；后续正文误带 marker 时直接清空壳。所有视图增加 `data-mwg-mounted-view` 单实例标记，防止同一楼层重复执行脚本时重复挂载。
- 新增 `src/fish/ui/battleShellPresenter.ts`，集中战斗页面的事件绑定、道具弹窗、历史楼层只读、日志入口和视图刷新；新增 `src/fish/core/battleRepairHost.ts`，集中战斗内容修复的 `/send` 与 `/trigger` Tavern 链路。
- `fish/index.ts` 保持纯协调器：不再直接构造 HTML、操作 DOM、调用 `BattleLog`、`location.reload()` 或 Tavern slash 命令；战斗页面 HTML/SCSS、MUV schema、AI 字段和正文/状态栏分流不变。
- 新增/更新 start 首楼层、战斗呈现边界、HTML 安全和协调器结构门禁。完整 `release:tavern` 一次通过（约 251 秒），包含全部规则测试、构建、Tavern/MUV 契约、PNG 打包和最终校验。最终角色卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,862,565` 字节，SHA-256 `43F40567CDE79D1312C07EF023F7240B13EF7226E82C870DA87210533E656F9`；`character-runtime.js` 为 `993,068` 字节，SHA-256 `930948D68CC75FC1762C2E11ACC0773E9E1316A9F73AB3C1E86792FD00AA6CC5`；start/common/fish 壳为 `3,526/3,527/3,525` 字节，三者均为 `placement=[2]`、`minDepth=0,maxDepth=0`。
- 真实 Tavern HTTP 夹具导入为 `魔法少女世界183.png`；start latest/history、初始 readiness valid 和合法 battle fixture 均通过，版本为 `0.5.64`。浏览器 DOM 复核受已打开欢迎页的 P00 竞争影响：刷新时欢迎页会把空角色设置写回并覆盖 API 激活的夹具，未将该次浏览器结果冒充通过；P00 已记录在 `docs/tavern-helper-pitfalls.md`，HTTP 夹具仍是本批真实链路证据。

## 2026-08-23：Tavern 交互副作用边界收敛（0.5.63）

- `UnifiedEffectExecutor` 的日志调用统一经过 `TavernBattleEffectPresenter`；执行器不再直接导入 `BattleLog`，效果顺序、日志内容和状态/欲望反馈保持不变。
- 新增 `src/fish/ui/cardInteractionPresenter.ts`，集中卡牌选择/弃牌弹窗、出牌动画、阻止提示、悬停状态和卡牌日志。`CardSystem` 只保留牌区规则、两阶段付款、触发事务与执行器调用，不再直接依赖 jQuery、`AnimationManager`、HTML 转义或 `BattleLog`。
- 新增 `src/fish/ui/relicEffectPresenter.ts`，集中遗物触发闪烁和失败日志；`RelicEffectManager` 只负责筛选遗物、事务和效果执行。删除零调用旧 `src/fish/ui/components.ts`，避免另一套未转义卡牌/战斗日志 DOM 回流。
- 扩充战斗呈现边界、HTML 安全和核心边界门禁，覆盖日志端口、卡牌 presenter、遗物 presenter 和旧 UI 文件删除。类型检查、事件流、卡牌事务、遗物矩阵、HTML 安全、game-core 边界测试通过。
- 本批不改开始页、战斗页布局、正则深度、MUV schema、世界书语法或 AI 字段。
- 完整 `npm run release:tavern` 通过（约 237 秒）。最终产物：`dist/tavern/魔法少女世界-酒馆兼容版.png` `7,853,533` 字节，SHA-256 `1DC25275DEECEC881B5D2327E17E1F010A23DD1B60D41769BFDE3001FF41FBBA`；`character-runtime.js` `992,418` 字节，SHA-256 `50F6CC3505810B68F7339F9F50DAB3E0900534158D6479268DE199E11CCCA716`；start/common/fish 壳仍为 `3,038/3,245/3,164` 字节。
- 真实导入返回 `魔法少女世界182.png`。HTTP 夹具的 start 最新/历史、初始 readiness valid 和 `battle-repair seek` 均通过；后者确认 `星轨检索`、抽牌堆选择和“不触发 on_draw”。单标签浏览器实际打开该聊天后确认唯一战斗 iframe、星轨训练体、5 张手牌、6 张抽牌堆、9 件遗物和玩家回合；本批自动化 click 未能派发 iframe 内 delegated handler，故不宣称新的选择弹窗 DOM 通过，上一批真实 `seek` 交互证据继续有效。

## 2026-08-23：敌人行动宿主与意图呈现分离（0.5.62）

- 新增 `src/fish/core/enemyActionHost.ts`，只消费纯核心 `selectEnemyAction()`，负责选择行动、推进序列游标并一次提交敌人状态；新增 `src/fish/ui/enemyIntentPresenter.ts`，统一意图 DOM、眩晕/行动动画和对应战斗日志。
- 删除旧 `EnemyIntentManager` 混合类。`BattleManager` 不再直接依赖 DOM、jQuery、`AnimationManager` 或意图 DOM 实现，只编排回合、调用行动状态宿主、效果执行器和 presenter；行动选择异常继续向外层会话事务冒泡，单纯展示异常不会破坏战斗结算。
- 不修改开始页或战斗页 HTML/SCSS，不新增 AI 字段。开始页仍只由 AI 首轮 `[开始游戏]` marker 触发，start/common/fish 三条局部正则保持 `placement=[2]` 与 `minDepth=0,maxDepth=0`；历史楼层不创建交互 iframe，正文继续由 SillyTavern 原生显示。
- 新增敌人行动宿主回归，并在核心边界门禁中禁止恢复旧混合模块或让 `BattleManager` 重新引用动画/DOM。类型检查、敌人行动、回合、MUV 适配、事件流和 game-core 边界测试通过。
- 完整 `npm run release:tavern` 通过（约 230 秒），包含全部规则测试、构建、导出、PNG 打包和 Tavern/MUV 契约。最终产物：`dist/tavern/魔法少女世界-酒馆兼容版.png` `7,849,677` 字节，SHA-256 `9AAAFD6B08EF50AE80A7685976C787F5B10DC406BE5E9CBD5D73C2C833766914`；`character-runtime.js` `990,970` 字节，SHA-256 `0043E743294422EABAD51CBA6B85493CACB9D056A757AC914CC1C2C1A8E14B57`；start/common/fish 壳为 `3,038/3,245/3,164` 字节。
- 真实 SillyTavern HTTP 夹具导入返回 `魔法少女世界181.png`，覆盖 start 最新/历史、初始 readiness 和 battle-repair valid；版本 `0.5.62`、预检、路线、玩家回合和互斥 iframe 契约通过。浏览器复核再次遇到旧欢迎页标签覆盖活动角色，已记录为 P00 测试环境竞争，不能把该次 DOM 结果冒充新版本通过；上一批 `0.5.59` 的真实 DOM 基线继续有效。

## 2026-08-23：战斗呈现与敌人初始化边界（0.5.61）

- 新增 `src/fish/ui/battleEffectPresenter.ts`，统一动画、能量/手牌可用性刷新、欲望溢出和战斗结束弹窗；新增 `src/fish/core/battleEndHost.ts`，统一确认结算、清理当前消息快照、发送后续剧情和重开。
- `UnifiedEffectExecutor` 不再直接引用 DOM、jQuery、`AnimationManager`、`LustOverflowDisplay`、`triggerSlash`、`location` 或 MUV 结算；`GameStateManager` 不再渲染错误 HTML，也不动态 `require` 敌人意图 UI 模块。
- `convertMvuEnemy()` 一次完成首个敌人行动和序列游标准备，避免初始化重复抽取随机数；后续回合由 `enemyActionHost` 选择并持久化，`EnemyIntentPresenter` 只负责展示。
- 新增战斗呈现边界回归，更新事件/结算测试；类型检查、事件、伤害、运行结算、MUV 适配、回合、敌人事务和会话测试通过。完整 `release:tavern` 成功，真实 Tavern API 夹具使用 `魔法少女世界180.png` 覆盖 start 最新/历史、readiness 和 battle，版本、预检、路线和玩家回合契约通过。
- 最终 `0.5.61` 产物：`dist/tavern/魔法少女世界-酒馆兼容版.png` `7,853,165` 字节，SHA-256 `66F18D89F9A523874E3B46BDE93ECEA56320913CCE79DB6EA0FA7845A42584AD`；`character-runtime.js` `992,279` 字节，SHA-256 `9476D46B62DC802A3644A4055057B3B6F0F5C0C3DFAF8B67B46277929F963997`；start/common/fish 壳仍为 `3,038/3,245/3,164` 字节。

## 2026-08-23：玩家卡牌触发调度去重（0.5.60）

- `battleEventDispatch` 新增纯核心 `resolvePlayerTriggerDispatch()`，统一玩家事件的能力优先、遗物随后顺序；`battleTriggerRuntime` 继续只负责按计划调用宿主端口。
- `CardSystem` 新增唯一的 `dispatchPlayerTrigger()` Tavern 适配入口。出牌后、消耗、抽牌和回洗不再三次拼装同一调度数组与回调，行为、递归保护和终态检查保持不变。
- 本批不改开始页和战斗页 UI，不增加 AI 字段。开始模块仍由 `[开始游戏]` 与 `minDepth=0,maxDepth=0` 限定在首轮最新 AI 楼层；common/fish 也保持 `minDepth=0,maxDepth=0`，状态栏和战斗界面只渲染最新楼层，历史楼层只留 SillyTavern 原生正文。
- 类型检查、battle-event/card-operation/card-play、damage/trigger/card-lifecycle/event/relic、角色运行时和 Tavern 契约均通过。完整 `release:tavern` 的所有规则测试、构建和导出通过；首次 `patch:card` 遇 Windows 短暂文件占用，重试后成功，`verify:tavern` 通过。
- 真实 Tavern API 夹具已用 `魔法少女世界179.png` 生成 `start-runtime-latest`、`start-runtime-historical`、`readiness-valid` 和 `battle-repair-valid`；版本 `0.5.60`、预检和预期 iframe/路线/战斗契约均通过。浏览器复核时发现旧的欢迎页标签会在刷新时覆盖 API 夹具的活动角色，导致页面回到欢迎页；该会话竞争记录为测试环境问题，不作为角色运行时失败。
- 最终 `0.5.60` 产物：`dist/tavern/魔法少女世界-酒馆兼容版.png` `7,858,533` 字节，SHA-256 `1F343C36F4AB176E9CEBAFF2E805E6D4E1FD037024A3FCC33AA621A66AF8EFF9`；`character-runtime.js` `994,159` 字节，SHA-256 `5C02BFF1B3AEC10BB5C8E2EB2D49A61E37E052CE9360BCB72031A4AEC48E2D6B`；start/common/fish 壳分别 `3,038/3,245/3,164` 字节。

## 2026-08-23：触发器事务收敛（0.5.59）

- 新增无宿主依赖的 `src/game-core/triggerTransaction.ts`，统一触发器的快照端口、提交/回滚结果、失败策略和回滚异常；协议不拥有 UI 动作门，允许在出牌和结束回合事务内部安全嵌套。
- `BattleSessionHost` 与 `ReferenceBattleSessionHost` 新增 `beginScopedTransaction()`/`triggerTransactionPorts()`；快照 token 由宿主顺序生成，不再在效果路径使用 `Date.now()`。
- `CardSystem` 的弃牌/诅咒、`UnifiedEffectExecutor` 的状态/能力、`RelicEffectManager` 的遗物全部删除本地 snapshot/catch/finally 样板，统一调用核心协议；日志和“失败后继续”仍保留在各自适配层。
- 新增 `test-trigger-transaction-core.mjs`，并补充外层动作嵌套触发回归；类型检查、触发器、会话协调器、参考宿主、能力/遗物/状态和 runtime safety 门禁通过。
- 本阶段明确不改开始页 UI、战斗页面布局、正文/状态栏分流或 AI 字段。三条 Tavern 正则继续 `placement=[2]`、`minDepth=0,maxDepth=0`：开始页只在首轮最新 AI 楼层出现，后续状态栏/战斗页仅渲染最新楼层。
- 完整 `npm run release:tavern` 通过（约 233.5 秒）。发布卡导入真实 SillyTavern `1.18.0` 后返回 `魔法少女世界178.png`。浏览器 DOM 实测：`start-runtime-latest-2026-08-22T20-56-53Z` 为唯一 `mesid=0`、唯一 iframe/创建根且创建按钮禁用；`start-runtime-historical-2026-08-22T20-59-41Z` 保留两个原生消息且 iframe 为 0；`readiness-valid-2026-08-22T21-00-55Z` 为唯一 `mesid=0`、唯一 iframe/状态栏，路线标题和“进入战斗”各一份。`battle-repair-valid-2026-08-22T20-56-57Z` 的核心预检和夹具契约确认镜影训练体、玩家回合及完整机制，本批未重复浏览器 DOM 检查；`0.5.58` 的同页实机基线仍保留。
- 最终 `0.5.59` 产物：`dist/tavern/魔法少女世界-酒馆兼容版.png` `7,857,941` 字节，SHA-256 `FE11FA4BE212D99546CFDB4449D4F88F8B4641CA7F3846F5D135B9038BF58896`；`character-runtime.js` `993,938` 字节，SHA-256 `CB4DDEA5B1D524A0A1CE0DCBAEE7A665455B42B6798C3015FB497D8A4C86DA6D`；start/common/fish 壳分别 `3,038/3,245/3,164` 字节。

## 2026-08-23：开始模块迁入共享运行时（0.5.58）

- 停止扩玩法字段，集中完成最后的加载迁移：`RuntimeViewName` 和角色脚本资源表加入 `start`，开始页与 common/fish 共用 `initializeGlobal('MagicGirlWorld')` / `waitGlobalInitialized('MagicGirlWorld')` 版本化挂载链路。
- `start-interface.json` 从约 `47 KB` 降为 `3,038` 字节；common/fish 为 `3,245/3,164` 字节。完整开始视图只给角色脚本增加约 `46 KB`，`character-runtime.js` 当前为 `993,471` 字节，不再在每个开始 marker 的正则替换文本中重复保存。
- 第一次实机保留开始页既有非 fenced 完整文档模式时，轻量壳被插入 SillyTavern 外层 DOM，bootstrap 没有执行并永久停在加载态。按 Tavern Helper 渲染器文档改为 fenced `<body>` 后，start 与 common/fish 使用同一 iframe 识别链。生产构建经 parse5 验证仍包含角色创建根、结果区、创建和开始按钮，避免历史多余 `</body></html>` 导致尾随节点被误删。
- 根据 Tavern Helper `TavernRegex` 类型和 SillyTavern `1.18.0` 正则引擎复核，最新消息为 `depth=0`。start/common/fish 全部固定 `minDepth=0,maxDepth=0`：开始页在产生下一楼后停止渲染，状态栏与战斗页的历史楼层也不再创建完整交互 iframe。
- 角色运行时和 Tavern 契约已覆盖三视图清单、start 根节点、脚本语法、壳体积、版本匹配、卡内唯一运行时与正则同步。聚焦 `build`、`export:tavern`、`test:tavern-character-runtime`、`patch:card`、`verify:tavern` 已通过。
- 本版不修改 AI 浅层 JSON、公式、世界书 token、MUV schema、正文/末尾状态栏分流或战斗页面位置。正则加载迁移完成不等于整个重构完成；fish 中剩余宿主调度、历史楼层降载和可选服务器模式仍是后续工作。
- 真实酒馆基线已完成：导入 `dist/tavern/魔法少女世界-酒馆兼容版.png` 返回 `魔法少女世界177.png`；`start-runtime-latest-2026-08-22T20-23-35Z`（前一份 0.5.58 卡）中运行时日志为 `MagicGirlWorld 0.5.58 已就绪`，最新楼层只有一个 `TH-message--0--0` iframe，iframe 内 `.magical-girl-creator` 存在且创建按钮初始禁用。`start-runtime-historical-2026-08-22T20-27-28Z` 含 `[开始游戏]` 和后续消息，消息 iframe 数为 0，历史正文保留；最终卡 `177` 的 start 正则已收窄到 AI 输出 `placement=[2]`。
- 最终卡 `177` 的最新隔离聊天 `start-runtime-latest-2026-08-22T20-36-19Z` 再次确认唯一 `TH-message--0--0`、`.magical-girl-creator` 和禁用的创建按钮均由 fenced 壳正常挂载。
- 同一 `0.5.58` 卡的 `readiness-valid-2026-08-22T20-31-02Z` 与 `battle-repair-valid-2026-08-22T20-31-04Z` 均在真实酒馆只创建最新楼层 iframe；前者显示合法路线选项，后者显示“镜影训练体 / 玩家回合”、8 张抽牌堆、完整手牌、能力、遗物和结束回合按钮。未调用模型，故角色创建提交和自动开场剧情仍不属于本批烟测范围。
- 最终发布产物：`character-runtime.js` `993,471` 字节，SHA-256 `C90F0636AB827C6462EE41A56924B46896BE8CC58F2C3E733E6AE9D856A285DF`；`魔法少女世界-酒馆兼容版.png` `7,856,693` 字节，SHA-256 `C02F0FF8CA35FE8231DA13D65C4185D7FA4E7007A4EEF8F054D1DE990A38941F`。start/common/fish 正则分别为 `3,038/3,245/3,164` 字节，均为 `minDepth=0,maxDepth=0`，start 额外固定 `placement=[2]`。

## 2026-08-23：正则定位收敛与共享宿主门禁（0.5.57）

- 按 Tavern Helper 官方实时编写教程复核后，common/fish 正则不再使用 `$1/$2` 搬运正文、选项或战斗引导；正则只定位并移除协议 marker，普通正文继续由 SillyTavern 原生渲染。
- common 通过 `getCurrentChatMessageText()` 和角色脚本共享的 `MagicGirlWorld.getMessageText(message_id)` 读取原始楼层，只提取 `<Options>` 与奖励 marker；fish 战斗数据仍按显式消息楼层读取 MUV。
- `MagicGirlWorld` 新增 `waitForMessageReady(message_id, options)`，统一检查 Tavern Helper 版本、MUV API、世界书可读性和 `stat_data.battle`；iframe 仅在没有共享端口或本地模式时回退旧轮询。
- `common-interface.json` 为 `3,251` 字节，`fish-interface.json` 为 `3,170` 字节，角色脚本 `character-runtime.js` 为 `945,602` 字节；最终 PNG 为 `7,843,965` 字节，SHA-256 `ADBAF8B05A32FBD02BA957575FEC09E4E26D8FEB144523371CFD676F4ECEE40A`。
- 完整发布命令的全部规则测试和三个生产构建通过；第一次到最终 PNG 写入时遇到一次 Windows 短暂文件占用，单独重试 `patch:card` 后 `verify:tavern` 通过。第二次包装命令在本机 6 分钟工具上限处被截断，没有返回测试失败；随后单独重跑 `export:tavern`、`patch:card`、`test:tavern-character-runtime` 和 `verify:tavern` 均通过，没有跳过失败的测试。
- 真实酒馆导入为 `魔法少女世界172.png`，世界书 `魔法少女世界0.5.57`；日志确认 `MagicGirlWorld 0.5.57 已就绪`。隔离聊天 `readiness-valid-2026-08-22T19-22-24Z` 显示原生正文、状态栏和路线，`battle-repair-valid-2026-08-22T19-25-57Z` 在引导正文后恢复完整玩家回合。
- `readiness-valid-2026-08-22T19-29-46Z` 进一步确认共享消息接口读取原始 `<Options>`，解析出“继续调查 / 进入战斗”并生成按钮 DOM；首层路线门禁按既有规则隐藏行动区、优先要求选择程序路线。控制台没有新增项目错误，既有 `Type mismatch: expected object schema but got undefined at path` 仍来自 Tavern Helper `log.js`，继续追踪。
- 发布元数据移除非确定性的 `generatedAt`；相同输入连续两次导出后，角色脚本 SHA-256 均为 `23D4645614281FEB7E609EA7AB3D67B738B6079B6D47B9816FDA65741FB0FBAF`，PNG SHA-256 均为 `ADBAF8B05A32FBD02BA957575FEC09E4E26D8FEB144523371CFD676F4ECEE40A`。最终卡又成功导入为 `魔法少女世界173.png`。

## 2026-08-23：角色脚本运行时与轻量正则壳（0.5.56）

- 新增 `src/runtime/characterRuntime.ts` 和 `scripts/export-tavern-runtime.mjs`：通用状态栏与战斗页面的 body、CSS、bundle 由角色卡脚本只嵌入一次；运行时通过 `initializeGlobal('MagicGirlWorld', api)` 向楼层 iframe 发布版本化资源和诊断信息。
- 新增 `src/runtime/viewBootstrap.ts`：common/fish 正则只保留正文捕获、`<body>`、选项交接和 `waitGlobalInitialized('MagicGirlWorld')` bootstrap，不再把完整应用 bundle 写入 `replaceString`。普通正文仍由 SillyTavern 原生渲染，战斗页面仍在引导正文之后。
- `common-interface.json` 从约 `303 KB` 降为 `3,446` 字节，`fish-interface.json` 从约 `627 KB` 降为 `3,350` 字节；角色脚本 `character-runtime.js` 为 `941,389` 字节，资源只随角色卡脚本保存一次。开始模块暂留 `47 KB`，下一批再迁移。
- 角色卡补丁以稳定 ID `magic-girl-world-runtime` upsert 运行时，不覆盖其他角色脚本；内嵌世界书、MUV 脚本和局部正则保持一份。版本升至 `0.5.56`，世界书为 `魔法少女世界0.5.56`。
- 新增 `scripts/test-tavern-character-runtime.mjs` 并加入 `release:tavern`；覆盖角色脚本经典语法、共享 API、版本、资源根节点、轻量 shell、选项交接和角色卡唯一脚本。
- `npm run release:tavern` 全量通过，用时约 `264.3s`；只有既有 Webpack 体积和 Browserslist 数据提示。最终 PNG `7,833,509` 字节，SHA-256 `45BFE3271CBBDB22996424F6606EC68A8AD67A7D5693D95DD25389079D5AA8FB`。
- 真实酒馆基线：SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。导入返回 `魔法少女世界171.png`；首次确认世界书后日志出现 `MagicGirlWorld 0.5.56 已就绪`，合法状态栏显示路线并刷新恢复。
- 同一新卡的隔离聊天 `battle-repair-seek-2026-08-22T18-27-37Z` 完成真实 `seek` 交互：星轨检索弹窗列出 6 张抽牌堆，选择“星轨样本·一”后抽牌堆 `6 -> 5`、弃牌堆 `0 -> 1`、手牌加入原卡、格挡 `20`；官方 MUV/battle_session 快照与界面一致，刷新并重新打开后保持一致。
- 观察到的 `Type mismatch: expected object schema but got undefined at path` 仍来自 Tavern Helper `log.js`，不是新运行时挂载失败；继续按未归因问题追踪，不能标记为已解决。

## 2026-08-23：Tavern Helper 加载架构复盘

- 重新核对酒馆助手的渲染器、角色脚本库、楼层渲染、正则管理、事件、版本和分享接口文档。确认角色脚本可随角色卡导出，`initializeGlobal` / `waitGlobalInitialized` 可作为后台运行时与楼层 iframe 的正式通信边界。
- 当前 `start/common/fish` 三份正则替换产物约为 `47/303/627 KB`；普通状态栏和战斗页面仍把完整 HTML/CSS/JS 放入 `replaceString`。旧系统尚未迁移完成，不能把纯核心模块数量等同于整体完成度。
- 新增 `docs/tavern-helper-runtime-architecture.md`，固定“角色脚本运行时 + 轻量正则壳 + game-core + MUV 适配器”的目标、迁移顺序和完成定义；默认仍为可导入角色卡，外部服务器只作为可选加速模式。
- 新增 `docs/tavern-helper-pitfalls.md`，记录正则双重解析、角色正则许可、脚本生命周期、MUV 首次导入、消息楼层绑定、共享接口就绪、历史渲染压力和未归因浏览器错误。文档明确禁止用 `replaceTavernRegexes` 作为运行时 UI 刷新，因为该 API 会重载整个聊天并触发脚本/楼层重载。
- 从本节点开始，玩法字段只在阻塞迁移或封闭既有玩法循环时增加；近期主线转为状态栏壳试点、宿主运行时和遗物/能力/状态调度迁移。

## 2026-08-23：牌区操作计划收归核心（0.5.55）

- 新增纯 `game-core/cardZoneOperation.ts` 两阶段协议：计划阶段给出候选卡牌 ID、来源/目标、手牌上限和 `choose/random/left/right/all` 选择范围；提交阶段校验牌区快照、重复 ID、选择边界并一次性移动牌。
- 现代 `scry_cards`、`recover_cards`、`discard_cards`、`exhaust_cards` 由 `UnifiedEffectExecutor` 直接交给 `CardSystem.executeCardZoneOperation()`；不再把现代命令翻译回旧字符串后重复决定牌区规则。Tavern 仍复用原有弹窗和触发器，旧字符串兼容路径保持不变。
- 外部网站、服务或 Mod 可以只实现“展示候选 -> 返回稳定 ID”的选择端口，直接复用核心计划/提交；核心没有 DOM、MUV、Tavern Helper、时间或全局随机依赖。
- 新增 `scripts/test-card-zone-operation.mjs`，覆盖检索、预见、取回、手牌上限、顺序、陈旧计划、越界选择和重复 ID；已接入 `test:card-zone-reducer` 与发布门禁。

## 2026-08-23：抽牌堆定向检索（0.5.54）

- AI 只新增 `{"seek":1}` 一个浅层操作：从整个抽牌堆选择 N 张原卡加入手牌，牌堆或手牌空位不足时按可用数量处理；不增加 `from/pick/count`、筛选器、嵌套选择器或重复说明字段。完整“星轨检索”卡为 `27 token`。
- 内部不新增同义牌区命令。既有 `recover_cards` 来源从 `discard/exhaust` 扩展为 `draw/discard/exhaust`，`GameStateManager.recoverOwnedCards()` 和纯核心 `moveCardsBetweenZones()` 成为三种来源到手牌的同一移动入口；Tavern 继续复用 `CardSystem.selectCardsWithSelector()`。
- 检索移动原卡而非复制，不触发 `on_draw`，受 10 张手牌上限约束；取消或没有目标时牌区不变。Schema、浅层编译、内部 AST、命令运行时、Tavern 适配、自动说明、内容估值、世界书和测试同步。
- 世界书总量 `12,845`、普通回合 `3,765`、首轮 `9,264`、初始修复 `7,634`、战斗修复 `5,276 token`。普通角色扮演回合和战斗修复没有增加；新增规则只进入需要完整战斗内容契约的首轮/初始化修复。
- `npm run release:tavern` 全量通过，只有既有 Webpack 体积和 Browserslist 提示。最终发布 PNG 为 `7,739,733` 字节，SHA-256：`737AB497D4459E06A1383F3885D81465378DC5935B23DF869ED4AC2582D39645`；SillyTavern `1.18.0` 最终导入返回 `魔法少女世界169.png`，内嵌世界书 `魔法少女世界0.5.54` 成功链接并直接进入玩家回合。
- `魔法少女世界168.png` 的隔离聊天 `battle-repair-seek-2026-08-22T16-28-04Z` 完成完整交互：检索弹窗列出整个 6 张抽牌堆。选择“星轨样本·一”后手牌保持 5 张、抽牌堆 `6 -> 5`、弃牌堆只有已打出的“星轨检索”、消耗堆 0；官方快照为回合 1、格挡 20、出牌 `1/0/1`。格挡 20 精确证明通用/技能出牌联动正常，而 `on_draw` 能力和遗物未触发；整页刷新并重新打开后全部恢复。最终卡 `169` 的隔离聊天 `battle-repair-seek-2026-08-22T16-50-15Z` 又确认世界书同步后的产物可直接显示“星轨训练体 / 玩家回合 / 星轨检索”且无 MUV 超时。

## 2026-08-22：首次导入 MUV 自动续接（0.5.53）

- 根因是卡内 MUV loader 会无限等待内嵌世界书可读取，但 fish iframe 的 `ensureMvuRuntimeReady()` 把 MUV 全局和消息变量共用同一个 8 秒预算。首次打开角色时，SillyTavern 的世界书确认框可以占满该预算；用户确认后 MUV 虽然成功加载，已经报错的 iframe 却不会继续。
- `src/runtime/messageVariables.ts` 仍是唯一就绪边界。酒馆助手接口与最低版本先校验；MUV API 有独立的 120 秒首次导入预算，当前楼层 `stat_data.battle` 在 MUV 出现后再使用独立的 30 秒预算。酒馆助手全局通知只作为可选信号，实际 API 轮询是判断依据，避免通知过早返回，也兼容没有该通知函数的宿主；永久缺少 MUV 会有界失败，低版本、核心接口缺失和非世界书类 schema/type 错误立即失败。
- 卡内 loader 改为 `__MAGIC_GIRL_WORLD_MVU_LOADER__.promise/state` 单例。重复执行复用同一个 Promise，不会重复 import；`state.status` 记录 `waiting/loading/ready`，`lastError` 保留最近一次等待或网络错误用于真实环境诊断。没有新增第二个 MUV 初始化器。
- 自动 Tavern 契约新增延迟全局回归：即使 `waitGlobalInitialized('Mvu')` 先返回，只有实际 `Mvu.getMvuData/replaceMvuData` 出现后才继续；生产默认预算必须覆盖旧 8 秒窗口。完整 `npm run release:tavern` 全量通过，只有既有 Webpack 体积和 Browserslist 提示。
- 最终发布 PNG 为 `7,736,837` 字节，SHA-256：`7C8C9965677D0667C8A80A8D26BA00B12122DDC874500A6EC4157FF572489CC9`。SillyTavern `1.18.0` 最终导入返回 `魔法少女世界167.png`，内嵌并链接世界书 `魔法少女世界0.5.53`；最终隔离聊天 `battle-repair-scry-2026-08-22T16-07-05Z` 直接恢复“星见训练体 / 回合 1 / 玩家回合”，无 MUV 超时。
- 首次导入候选卡 `魔法少女世界166.png` 的隔离聊天 `battle-repair-scry-2026-08-22T15-49-49Z` 打开后，战斗 iframe 显示“正在恢复战斗”，同时出现世界书确认框。故意等待 9 秒后 iframe 仍无可见错误；点击“是”后不刷新页面即自动恢复“星见训练体 / 回合 1 / 玩家回合”。官方消息快照为 HP 80、能量 3、初始遗物格挡 2、手牌 5、抽牌堆 7，并保存 `battle_session`；整页刷新、从最近聊天重新打开后全部恢复且不再弹出世界书确认。
- 本批只修复 SillyTavern + 酒馆助手 + MUV 宿主时序，不修改 AI 浅层 JSON、公式、MUV schema、正文/末尾状态栏或战斗页面。世界书仍为总量 `12,761`、普通回合 `3,765`、首轮 `9,180`、初始修复 `7,550`、战斗修复 `5,276 token`，完整预见卡仍为 `29 token`。

## 2026-08-22：牌库顶预见（0.5.52）

- AI 只新增 `{"scry":3}` 一个浅层操作：查看当前抽牌堆顶 N 张，玩家可把其中 0 到 N 张置入弃牌堆；不增加 `from/pick/count`、嵌套选择器或说明字段。
- 纯核心 `scryCardsFromDraw()` 校验候选只能来自实际牌库顶并保持剩余顺序；Tavern 继续使用 `CardSystem.selectCardsWithSelector()` 的同一弹窗，只扩展可配置最少选择数，既有操作仍默认必须选满。
- 预见移动不属于抽牌或手牌弃置，不触发 `on_draw/on_discard`。Schema、核心 AST、命令运行时、说明、内容分析、Tavern 适配与测试共用同一操作；完整“星见”卡为 `29 token`。世界书总量 `12,761`、普通回合 `3,765`、首轮 `9,180`、初始修复 `7,550`、战斗修复 `5,276`。
- `npm run release:tavern` 全量通过（`182.4` 秒），只有既有 Webpack 体积和 Browserslist 提示。最终 PNG 为 `7,735,749` 字节，SHA-256：`F860960056F9C3DCBCE2296C40AF3D82B0A8A5DCB2F8DF9508F2CEAB17FF9898`；SillyTavern 导入返回 `魔法少女世界165.png`，内嵌世界书 `魔法少女世界0.5.52` 成功导入并链接。
- 隔离聊天 `battle-repair-scry-2026-08-22T15-13-50Z` 在真实酒馆显示牌库顶“未来刻痕·三 / 月幕防御 / 未来刻痕·一”，允许只选 1/3 张。选择“未来刻痕·三”后抽牌堆 `7 -> 6`，弃牌堆 `0 -> 2`（所选牌和已打出的“星见”），格挡精确为 `20`；额外的 `on_draw/on_discard` 能力与遗物均未触发。官方快照为手牌 4、抽牌堆 6、弃牌堆 2、消耗堆 0、出牌 `1/0/1`，牌库剩余顶部顺序与选择前一致；整页刷新并重新打开聊天后全部恢复。
- 首次导入后打开隔离聊天再次出现一次既有 MUV 初始化超时；世界书导入并刷新后正常，后续整页刷新可直接恢复。该样本继续归入首次导入加载时序问题，不影响本版机制结论。

## 2026-08-22：牌区取回与选择入口收敛（0.5.51）

- AI 新增一个扁平 `recover/from/pick` 操作，从弃牌堆或消耗堆取回卡牌；核心只新增 `recover_cards` 命令，取回不触发 `on_draw`，手牌上限由同一牌区 reducer 强制。
- Tavern 选择 UI 从 `UnifiedEffectExecutor` 收归 `CardSystem.selectCardsWithSelector()`；弃牌、消耗、减费、复制、双倍效果和取回共用一个选择入口，网站/服务/Mod 不需要复制 Tavern 弹窗或牌区规则。
- Schema、核心 AST、命令运行时、Tavern 适配、自动说明、内容分析与测试使用同一契约。完整取回卡为 `36 token`；世界书总量 `12,664`、普通回合 `3,765`、首轮 `9,083`、初始修复 `7,453`、战斗修复 `5,276`。
- `npm run release:tavern` 全量通过（约 `192` 秒），只有既有 Webpack 体积警告。最终 PNG 为 `7,728,117` 字节，SHA-256：`038ED225F8051DE9E7E1338086F2953370D0EC7E320693CE03C75AB07C2C6A42`；SillyTavern 导入返回 `魔法少女世界164.png`，内嵌世界书 `魔法少女世界0.5.51` 成功导入并链接。
- 隔离聊天 `battle-repair-recovery-2026-08-22T14-37-56Z` 在真实酒馆验证：弃牌选择只列出已打出的“回声落片”，确认后移动原卡回手；消耗选择只列出“余烬落片”，确认后原卡回手且消耗堆归零。最终为回合 1、格挡 `1820`、手牌 3、抽牌堆 7、弃牌堆 2、消耗堆 0、总出牌 4、技能牌 4；格挡探针证明取回没有触发 `on_draw`。官方消息快照与界面一致，整页刷新并重新打开聊天后完整恢复。
- 首次打开隔离聊天仍遇到一次既有 MUV 初始化超时；刷新并重新打开后正常。该问题继续作为首次导入加载时序样本跟踪，不影响本版取回语义和持久化验收结论。

## 2026-08-22：抽牌与回洗生命周期（0.5.50）

- 共享 `battleTriggers` 新增 `on_draw/on_shuffle` 及兼容别名；核心 `advanceCardDrawLifecycle()` 把回洗和逐张入手拆成有序事件，避免把 UI 的 `deck_shuffled` 通知误当成游戏逻辑。
- Tavern `CardSystem.drawCards()` 成为普通抽牌、回合抽牌、旧字符串效果和 UI 抽牌按钮的唯一入口。回洗后先触发 `on_shuffle`，卡牌进入手牌后再触发 `on_draw`；每个事件仍按能力先、遗物后的固定顺序执行。起始手牌继续由 `resolveStartingHand()` 初始化，不触发联动。
- AI 只替换既有同级 `trigger/on` 枚举；现代效果禁止 `on_draw/on_shuffle` 再抽牌，防止常见的无限循环。新增测试覆盖核心事件顺序、满手停止、别名、编译门禁和 Tavern 入口约束。
- `npm run release:tavern` 全量通过。最终 PNG 为 `7,718,541` 字节，SHA-256：`6B07D34BB925591573E26F7FFB91587649E4057C86A549F8DC20D9AEB6C78C5C`；SillyTavern 导入返回 `魔法少女世界163.png`，内嵌世界书 `魔法少女世界0.5.50` 成功链接。
- 隔离聊天 `battle-repair-valid-2026-08-22T13-32-36Z` 在真实酒馆验证：结束第一回合后格挡为 `62`（五次抽牌逐张触发），结束第二回合触发一次回洗后格挡为 `198`，手牌 `5`、抽牌堆 `8`、弃牌堆 `0`；整页刷新并重新打开同一聊天后回合 `3`、格挡 `198` 和四牌区完全恢复。官方消息快照同时记录随机游标 `24`，证明 MUV 持久化与 iframe 状态一致。

## 2026-08-22：牌型出牌联动（0.5.49）

- 共享 `battleTriggers` 目录新增 `attack_played/skill_played/power_played` 及三个旧式 `on_*` 别名。核心 `resolvePlayedCardTriggers()` 只返回有序事件列表：所有可打出的牌先发出 `card_played`，Attack/Skill/Power 再各自追加一个牌型事件；Tavern `CardSystem` 复用既有能力与遗物触发器，不维护牌型分支或第二套分发器。
- AI 继续只在遗物、能力或 Power 的既有同级 `trigger/on` 中替换一个枚举值，不新增事件数组、嵌套对象、效果操作或内部 AST。Schema、内容分析权重、自动说明、UI 显示和世界书同步；完整 `attack_played` 遗物为 `32 token`，通用 `card_played` 对照为 `33`。
- 世界书总量 `12,516`、普通回合 `3,765`、首轮 `8,935`、初始修复 `7,305`、战斗修复 `5,276`。相较 `0.5.48`，只让会激活完整战斗内容契约的首轮与初始修复各增加 `123 token`；普通角色扮演回合、战斗修复和每张复杂卡的结构均不增加。
- `npm run release:tavern` 全量通过（约 `128` 秒）。最终 PNG 为 `7,711,125` 字节，SHA-256：`5A60D66E19C171CC5C6D4EFAFE90458A0F1214A90608C73B07A262091217490B`；SillyTavern `1.18.0` 导入返回 `魔法少女世界162.png`，卡内世界书 `魔法少女世界0.5.49` 成功导入并链接。
- 隔离聊天 `battle-repair-valid-2026-08-22T12-48-33Z` 以公式型遗物验证真实顺序：初始格挡 2，攻击牌后精确为 16，刷新恢复仍为 16；技能牌后为 76；Power 先单次进入消耗堆并触发 `on_exhaust`，随后结算通用与能力牌事件，最终格挡 328。官方消息快照为总出牌 3、攻击 1、技能 1、弃牌堆 2、消耗堆 1，证明 Power 没有重复消耗或重复通知。

## 2026-08-22：统一消耗触发管线（0.5.48）

- 共享触发目录新增 `on_exhaust`，并兼容旧别名 `card_exhausted`。AI 只在遗物、能力或 Power 的既有 `trigger/on` 使用；每张牌实际进入消耗堆后触发一次，卡牌自身无需增加字段。
- `CardSystem.exhaustCard/exhaustOwnedCards` 成为唯一通知入口。打出后消耗、Power 消耗、空灵回合末消耗以及 `exhaust` 选择器都复用它；`UnifiedEffectExecutor` 不再直接移动牌到消耗堆。能力先于玩家遗物结算，现有递归保护避免触发器继续消耗牌形成无限链，外层宿主事务保留回滚边界。
- Schema、触发器显示、程序说明、内容分析和世界书消费同一触发目录。标准 `on_exhaust` 遗物为 `32 token`；世界书总量 `12,393`、普通回合 `3,765`、首轮 `8,812`、初始修复 `7,182`、战斗修复 `5,276`。相较 `0.5.47`，首轮与初始修复各增加 37，普通回合和战斗修复不变。
- 完整发布门禁首次运行拦住了要求执行器直接移动消耗牌的过时源码断言；门禁已改为禁止该直连并强制调用共享管线。最终 `npm run release:tavern` 全量通过（`150.3` 秒）。
- 发布 PNG 为 `7,706,541` 字节，SHA-256：`243A3BBF54EE661B9514695BE0BF6AD00C0E8D3FA3CE232942575F5BFE6D7C9A`；SillyTavern `1.18.0` 导入返回 `魔法少女世界161.png`。隔离聊天 `battle-repair-valid-2026-08-22T12-26-20Z` 实测一张牌进入消耗堆后，遗物令玩家格挡 `2 -> 3`，随后消耗堆公式令其 `3 -> 7`；消息快照为消耗堆 1、格挡 7、总出牌 2、技能牌 2，且没有修复 UI。

## 2026-08-22：回合成长与牌型连击公式（0.5.47）

- AI 公式新增 `turn_number`、`attacks_played_this_turn`、`skills_played_this_turn`。本回合总出牌、攻击牌和技能牌计数都包含当前正在结算的牌；下一玩家回合由唯一 `turnState` 入口一并归零。
- 攻击/技能计数与扣费、弃牌代价和从手牌移除在同一个两阶段出牌事务中提交；取消、校验失败和事务回滚不会留下计数。消息快照持久化三项计数，旧快照缺少新字段时按 0 兼容，负数或小数新字段仍拒绝恢复。
- 纯核心公式、内容分析、Schema、自动说明、Tavern AST 适配、旧显示解析和快照诊断共用同一状态语义。AI 只写一行公式，如 `{"damage":"attacks_played_this_turn * 3"}`，不增加嵌套对象或新的效果操作。
- token 实测：完整三计数公式卡 `43`；世界书总量 `12,356`、普通回合 `3,765`、首轮 `8,775`、初始修复 `7,145`、战斗修复 `5,276`。相较 `0.5.46`，普通回合与战斗修复不变，首轮和初始修复各增加 `98 token`。
- 真实酒馆第一回合依次打出技能、多段攻击、连击终结技和技能。终结技读取 `turn=1 / attacks=2 / skills=1`，造成 `6` 点伤害，敌人由 `32/36` 变为 `26/36`；当回合快照为总出牌 4、攻击 2、技能 2。结束回合后进入回合 2，三项计数均为 0，能量恢复 3，6 点来袭伤害被已有 6 格挡吸收。
- `npm run release:tavern` 全量通过（`146.1` 秒）。发布 PNG 为 `7,704,637` 字节，SHA-256：`FB140CED43F5FEDA4F677300CD5CDF22E3426937A5BE9D22ACD5FA40955224EB`；SillyTavern `1.18.0` 导入返回 `魔法少女世界160.png`。隔离聊天 `battle-repair-valid-2026-08-22T12-02-37Z` 完成出牌、快照只读检查和回合重置，未出现修复 UI。

## 2026-08-22：浅层多段攻击与牌区公式（0.5.46）

- AI 多段攻击改为单个浅层对象 `{"damage":4,"hits":3}`；`hits` 只接受整数 `1-20`，且只能与独立 `damage` 同级使用。编译器将它展开为多个已有 `damage` 节点，一个外层 `when/on` 仍包住整组攻击，不新增宿主专用多段操作。
- 公式补齐 `self.hand_size`、`self.draw_pile_size`、`self.discard_pile_size` 和 `self.exhaust_pile_size`。纯核心公式上下文、Tavern AST 适配、旧变量解析/校验和玩家说明共用同一含义；AI 不接触内部 AST、`spec/op/steps` 或旧 `ME.*` 语法。
- Schema、内容分析、预算、自动说明和世界书都只增加上述两个扁平概念。完整多段攻击卡为 `33 token`，消耗堆公式卡为 `36`；世界书总量 `12,258`、普通回合 `3,765`、首轮 `8,677`、初始修复 `7,047`、战斗修复 `5,276`。相较 `0.5.45`，普通回合与战斗修复不变，首轮和初始修复各增加 `82 token`。
- 真实酒馆隔离夹具先用 0 费消耗技能给敌人 5 格挡，再打出 `3×3` 多段攻击，最后读取 1 张消耗牌获得 4 格挡。实测敌方逐击显示护盾 `-3`、护盾 `-2` 同时生命 `-1`、生命 `-3`，最终 `32/36`；玩家由开战遗物的 2 格挡增至 6，消耗堆为 1。
- `npm run release:tavern` 全量通过（`132.9` 秒）。发布 PNG 为 `7,694,373` 字节，SHA-256：`20D821299D2FF79D0099C5F9469679765F9DD27F47035255EFDF6CEE23D311C5`；SillyTavern `1.18.0` 导入返回 `魔法少女世界159.png`，内嵌正则启用。导入 `0.5.46` 世界书并完成顶层重载后，隔离聊天 `battle-repair-valid-2026-08-22T11-40-35Z` 通过且没有修复 UI。

## 2026-08-22：战斗场景 AI 修复闭环（0.5.45）

- 新增纯核心 `contentRepair.ts` 有界诊断格式器；初始内容与战斗场景共用同一条路径/错误码白名单。修复请求、fish 错误弹窗均不回显 AI 生成的敌人名、行动名、公式或错误文本，内部 AST 仍不暴露给 AI。
- `BattleContentContractError` 保留结构化核心 issues，`GameStateManager` 保留 `lastLoadIssues`；fish 在创建/恢复会话前检查原始 MUV，避免规范化后的默认值掩盖非法输入。历史楼层、运行环境错误和无结构化 issue 的错误不提供修复按钮。
- 新增条件世界书 `8战斗场景修复.md`。`[战斗场景修复]` 只允许重建当前 `battle.enemy` 和必要本场临时状态，并要求重新输出 `<BATTLE_START>`；玩家永久卡牌、遗物、道具、能力、状态、成长、路线、世界状态与奖励不得改变。普通战斗也明确禁止直接写入永久内容。
- 修复按钮使用 `/send` + `/trigger`，并删除旧的三份内联错误横幅；错误弹窗刷新按钮不再复用 `.return-setup-btn`，因此不会同时清理会话和刷新。初始内容与战斗隔离聊天共用 `saveAndActivateCharacterChat()` 和 `createInitializedMvuLayer()`，避免复制酒馆 HTTP/MVU 初始化知识。
- 实机首次运行旧夹具时发现 MUV 会用新世界书初始化模板覆盖未标记的自造 `stat_data`；共享夹具现写入 `initialized_lorebooks` 并以空 schema 让 MUV 从夹具生成真实 schema。第二次实机又发现底层错误消息会回显动作名，现由同一个有界摘要函数修复并加入测试。
- token 实测：完整世界书 `12,176`，普通回合 `3,765`、首轮 `8,595` 均未增加；初始修复上下文 `6,965`，战斗修复上下文 `5,276`，战斗修复请求 `33`。复杂卡牌输出格式和长度没有改变。
- 最终 `npm run release:tavern` 全量通过（约 `140.2` 秒）。发布 PNG 为 `7,688,965` 字节，SHA-256：`9E4FEDBEF203AA7E0567D7C85DF11749A7CF974589707BE61ADED160DD995579`；真实 SillyTavern `1.18.0` 导入返回 `魔法少女世界157.png` 并启用内嵌角色正则。
- 最终 invalid 聊天命中权重、未知公式变量、行动结构和概率映射深层错误：错误标题与修复按钮各一个，测试敌人名、行动名和原公式均零回显。valid 聊天显示“镜影训练体”、玩家回合和结束回合按钮，修复按钮与错误弹窗均为零。当前酒馆 `main_api` 为未连接的 Horde 配置，真实点击已到 `/trigger` 边界但没有模型回复；未猜测服务地址，也未把测试凭据写入项目或日志。

## 2026-08-22：初始 AI 内容就绪与修复闭环（0.5.44）

- 新增纯核心 `playerContentReadiness.ts`，复用 `contentContract + contentAnalysis + deckPlayability` 检查第一层路线开放前的完整玩家内容。总牌数、基础可出牌、胜利/防御、遗物、道具、欲望满溢、生命/欲望和等级/经验缺一时均不会进入远征。
- `contentContract` 补齐现代名称、遗物/能力 trigger、关键词布尔值、弃牌需求和双重弃牌效果源校验；fish 的 MUV 路径投影改用核心 `contentPathToBattlePath()`，不增加第二份校验或路径表。旧字符串仍由 Tavern 兼容层读取。
- common 仅在 `run.floor === 0` 展示该严格门禁。错误摘要最多显示三项，按钮发送最多四个路径/错误码；不回显 AI 名称和文本。独立条件世界书只在 `[战斗内容修复]` 时要求重建初始玩家战斗内容，保持剧情、世界状态、路线、奖励和敌人不变。
- token 实测：完整参考世界书 `11,769`，首轮 `8,595`、普通回合 `3,765` 均未增加；修复请求 `43`，只在失败时激活的修复回合上下文 `6,965`。AI 正常输出格式和复杂卡牌长度不变。
- `npm run release:tavern` 全量通过（约 `119` 秒）；发布 PNG 为 `7,674,813` 字节，SHA-256：`5D29000BF8112C1EFB59D45B1C5A433C30DBAD5DCC9684D7454F7124992B2496`。真实 SillyTavern `1.18.0` 导入返回 `魔法少女世界155.png`，内嵌角色正则启用，导入后的 `npm run verify:tavern` 再次通过。
- 新增 `tavern:readiness-chat` 隔离回归工具；它用核心契约自检合法/非法 MUV 快照，再经官方聊天与角色接口创建专用聊天，不修改既有聊天、不触发模型。浏览器实测 `readiness-invalid-2026-08-22T10-27-05Z` 显示“起始战斗内容需要修复”、一个可用修复按钮、零路线按钮；`readiness-valid-2026-08-22T10-31-08Z` 显示第一层战斗路线、一个可用路线按钮、零修复按钮。两者正文均由 SillyTavern 原生渲染，common 只追加在末尾。

## 2026-08-22：路线提示与长期连续性收敛（0.5.43）

- `game-core/runPrompt.ts` 统一路线节点、普通/战斗选项、事件选择和 `[开始战斗]` marker 顺序；common 只传当前宿主数据，不再保存第二份提示协议。
- `worldContinuity.ts` 从现有 `status.location`、`factions.invasion` 和最多两名追踪 NPC 生成有界摘要，不新增 MUV 存档。Tavern 只在事件路线发送摘要，战斗/商店才构建一次牌组上下文，事件和营火不再执行无用的内容分析。
- `5变量更新.MD` 要求已有地点、NPC、势力和关系作为事实，只更新本轮实际变化；事件连续性行不可复制或写回。AI JSON、浅层 `effects`、正文/状态栏分流和战斗 iframe 位置均未改变。
- 最新测量：完整世界书 `11,463`、首轮 `8,595`、普通回合 `3,765 o200k_base token`；带构筑/敌人预算的战斗路线 `138`，带连续性摘要的事件路线 `128`。
- `npm run release:tavern` 全量通过，用时约 `130.5` 秒；发布 PNG 为 `7,619,733` 字节，SHA-256：`5D461DFBEF2867C128530BFCC3566DF03C313D8367AAEF529E5B16C9D3C26498`。真实 SillyTavern `1.18.0` 导入返回 `魔法少女世界154.png`，内嵌角色正则启用成功，导入后的 `npm run verify:tavern` 再次通过。角色管理器当前分页仍只展示旧缓存条目，因此文件名与正则以官方导入接口返回为准。

## 2026-08-22：事件选择提示跨宿主去重（0.5.42）

- 新增纯核心 `src/game-core/runPrompt.ts`，统一生成事件节点的 `[事件选择]`、`node_id`、结果枚举和 `gold/hp` 约束；common 的战斗选项、普通选项和自定义行动都只调用这一入口。
- `test-common-interface` 改为门禁“common 调用共享协议、协议原文只存在核心”，不再要求 Tavern UI 重复保存协议文本。网站、服务和 Mod 可以直接复用同一提示函数；AI 输出字段、MUV、正文/状态栏分流和战斗 iframe 位置没有改变。
- `npm run release:tavern` 全量通过（约 125 秒）；发布卡 SHA-256 为 `8B889CD4523B3AF304A4C9B1B51BEA484926EBFEF7F7B2E1BC179802CC8B6B70`，大小 `7,612,493` 字节。真实酒馆导入返回 `魔法少女世界153.png`，内嵌正则启用成功；`npm run verify:tavern` 再次通过。

## 2026-08-22：公式、状态与遗物场景联动校准（0.5.41）

- `contentPack.ts` 的构筑预算现在把调用方实际 `hp/maxHp` 传入固定脱离宿主场景；低生命条件卡不再始终按固定代表生命估算。卡牌、被动遗物/能力、当前状态触发器、欲望效果和状态层数在同一场景内计算，避免把联动拆成互不相干的几次扫描。
- 加法型 `damage`/`block`/`heal` 修饰符只有在内容已经有对应基础分量时才生效；纯格挡牌不会凭空产生攻击，纯攻击牌不会凭空产生防御。实际战斗执行器和 MUV 写回没有改变。
- 新增宿主无关 `summarizeBuildBudgetScenarios()`，返回内部 `expected/min/max` 诊断范围；`summarizeBuildBudget()` 和 `formatBuildBudget()` 仍只输出原来的扁平预算行，不增加 AI JSON、MUV 字段或状态栏内容。场景权重由 `getContentAnalysisScenarios()` 单点提供，避免预算模块复制权重表。
- 新增低生命、无源修饰符、状态层数公式与 hold 修饰符联动回归；`typecheck`、内容分析、BattleRequest、内容预算和 game-core 边界测试通过。40 张动态公式卡的 100 次预算测量约 2.1 秒，单次约 21 ms，未引入第二套动态扫描或缓存层。
- `npm run release:tavern` 全量通过（约 141 秒）；最终发布卡版本 `0.5.41`，SHA-256 为 `8E520AC299EF65154AF2B22E2E61175B34D70BDC529FF6E79563A5536B306808`，大小 `7,613,029` 字节。通过 `npm run import:tavern-card` 导入本机 `http://127.0.0.1:8012/`，酒馆返回 `魔法少女世界152.png`，内嵌正则启用成功；`npm run verify:tavern` 再次通过。

## 2026-08-22：奖励计划跨宿主拆分（0.5.40）

- 新增纯核心 `src/game-core/rewardSettlement.ts`，统一生成“已校验的奖励选择计划”：候选规则、同批稳定 ID 冲突、辅助状态定义一致性、数量和玩家可见摘要只在核心完成一次。
- `common/rewardTransactions.ts` 现在只负责 MUV 数组包装、卡牌/道具数量合并、状态写入和候选清理；普通奖励、商店和事件奖励共用同一核心计划，外部网站或 Mod 可直接复用规则而不导入 common/Tavern。
- 纯核心计划会复制候选对象后再交给宿主，避免宿主写回或价格处理污染 AI 候选；旧候选、旧字符串卡牌和 MUV 嵌套数组兼容保持不变。
- 新增核心计划测试，并与选择、奖励事务、商店事务、事件结算一起纳入 `release:tavern`。
- `npm run release:tavern` 全量通过（约 136 秒）；最终发布卡版本 `0.5.40`，SHA-256 为 `93B9595E9D074B18DB5CCFBF7BE4F438132C5289C235AD6057538486C0EF5C2D`。通过 `npm run import:tavern-card` 导入本机 `http://127.0.0.1:8012/`，酒馆返回 `魔法少女世界148.png`；PNG 元数据中的角色版本、`extensions.world`、`character_book.name` 均为 `0.5.40` 对应值，7 条正则完整保留。

## 2026-08-22：奖励选择契约收敛（0.5.39）

- 新增纯核心 `src/game-core/rewardSelection.ts`，统一校验奖励、商店和事件奖励使用的三类下标选择：字段白名单、数组类型、候选范围、去重和每类上限只实现一次。
- `common/rewardTransactions.ts` 和 `common/runTransactions.ts` 复用该契约；商店价格计算直接消费已规范化下标，普通奖励和事件奖励仍沿用原有候选校验、状态注册、MUV 数组包装和原子提交。
- 该契约不读取 DOM、Tavern Helper 或 MUV，也不改变 AI 输出字段、奖励候选结构、正文包裹、状态栏末尾渲染或战斗 iframe 位置。
- 回归新增未知字段、缺失类别、重复下标、越界下标、超限选择、错误类型和负上限测试；发布前会与现有奖励/商店事务测试一起执行。
- `npm run release:tavern` 全量通过（约 144 秒）；最终发布卡版本 `0.5.39`，SHA-256 为 `BF2A9FAF3B5691AC0C1D5244FCB79C92F73ADC32D16531272DF4C612B7C2A10D`。通过 `npm run import:tavern-card` 导入本机 `http://127.0.0.1:8012/`，酒馆返回 `魔法少女世界147.png`；PNG 元数据中的角色版本、`extensions.world`、`character_book.name` 均为 `0.5.39` 对应值，7 条正则完整保留。

## 2026-08-22：远征输入契约收敛（未改 AI 输出长度）

- `game-core/eventOutcome.ts` 新增 `parseRunResultInput()`，成为 `run_result` 短 JSON 的唯一形状和范围门禁：只接受 `node_id/outcome/gold/hp`，整数变化量固定为 `-999..999`，并转换为网站、服务、Mod 都能直接使用的 `EventOutcomeInput`。
- Tavern 运行时不再重复维护 `run_result` 字段白名单、枚举和值域；它只读取 MUV、准备 `battle.core` 的生命快照，再交给核心结算。事件路线、金币、生命和清理仍在同一更新事务中完成，旧 `run_result` JSON 继续兼容。
- 营火升级补丁增加可选 `node_id` 绑定。新提示会要求回写当前节点；旧聊天缺少该字段时仍可结算，但如果提供了过期节点 ID，事务会拒绝并保留补丁以便重试。`cardUpgrade` 仍是唯一的卡牌规则补丁校验器，没有新增第二套升级解析器。
- 回归覆盖 snake_case 解析、未知字段、数值字符串、空节点 ID、旧升级补丁、过期升级补丁和原子回滚；本阶段未改变正文包裹、状态栏末尾渲染或战斗 iframe 链路。
- `npm run release:tavern` 全量通过（约 148 秒）；最终发布卡版本 `0.5.38`，SHA-256 为 `E3A582ADB25BB2CA9A43282F283D78B2082D2770C8082C1379BE057894AEABAC`。通过 `npm run import:tavern-card` 导入本机 `http://127.0.0.1:8012/`，酒馆返回 `魔法少女世界146.png`；PNG 元数据中的角色版本、`extensions.world`、`character_book.name` 均为 `0.5.38` 对应值，7 条正则完整保留。

## 2026-08-22：现代内容校验去重（0.5.37 真实酒馆通过）

- `contentContract` 成为现代 JSON 内容的唯一跨宿主门禁；fish 预检改为复用 `createContentPackFromMvuBattle()` 和核心校验，不再维护第二套 `EffectProgramPolicy`、现代 `effects` 或状态引用规则。
- `createContentPack()` 不再静默丢弃非法数组条目，核心可以报告原始索引；错误路径统一投影为 `battle.cards[0].effects[0]` 等 AI 可直接修复的字段路径，直接对象仍省略内部 `[0]`。
- fish 预检继续负责旧 `effect` 字符串、酒馆实体数值、敌人行动配置、描述诊断和可玩性警告，历史聊天兼容不变；不新增 AI 字段、第二套执行器、MUV 初始化器或 UI 入口。
- 类型检查、核心边界、内容契约、battle content adapter、battle content preflight 和 runtime safety 回归通过。
- 完整 `npm run release:tavern` 通过，用时约 `151s`；发布产物角色卡版本 `0.5.37`，内嵌世界书 `魔法少女世界0.5.37`，MUV `v0.181.0`，SHA-256：`7D300632995C3FA7A4F4FC2B37EEAE5D09A9623AA706074C740FF4DDDD5B7EDB`。PNG 元数据核对为 7 个酒馆正则，`data.extensions.world` 与 `data.character_book.name` 一致。
- 使用 `npm run import:tavern-card` 导入真实 SillyTavern `1.18.0`，接口返回最新文件名 `魔法少女世界144.png` 并启用该卡的内嵌正则。0.5.35/0.5.36 已通过的首开、MUV、世界书和角色创建链路未被本阶段触及；自动 AI 回复仍受测试酒馆 Horde 模型配置限制。

状态：**0.5.37 完整发布与真实酒馆导入通过；自动 AI 生成待 Horde 模型可用后回归**。

## 2026-08-22：动态内容场景校准（0.5.36 真实酒馆通过）

- 新增纯核心 `analyzeContentScenarios()` 与 `analyzeContentScenarioRange()`，只复用现有 `contentAnalysis`、`compactEffectDsl` 和 `effectCommandRuntime`；动态公式/条件在低生命、满生命、低能量、满能量和敌人低生命等固定脱离宿主场景中得到加权期望值及最小/最大范围。
- `summarizeBuildBudget()`、构筑方向和主动状态预算消费同一个场景期望值；敌人预算只使用同一范围的最大估计做爆发诊断。固定数值效果直接返回零宽范围，不做额外采样。
- 场景数据不进入 AI JSON、MUV、消息快照或真实战斗状态；真实战斗仍由现有唯一 `EffectProgram` 执行器读取实时宿主状态。AI 继续只输出浅层 `effects`，没有新增 `spec/op/steps` 或分析字段。
- 新增动态条件范围、固定效果零宽范围和敌人条件爆发诊断回归；类型检查、内容分析、内容预算和 BattleRequest 契约通过。
- 完整 `npm run release:tavern` 通过，用时约 `144s`；发布产物 `dist/tavern/魔法少女世界-酒馆兼容版.png` 的角色卡版本为 `0.5.36`，内嵌世界书为 `魔法少女世界0.5.36`，MUV 为 `v0.181.0`，SHA-256：`B5F16E2F8D6955376B5AC27AD35CBC24F33A34BBECC3EAA343CD0F94D644A3FF`。
- 使用 `npm run import:tavern-card` 导入真实 SillyTavern `1.18.0`，接口返回最新文件名 `魔法少女世界142.png` 并启用该卡的内嵌正则。已有 0.5.35 首开回归证明酒馆/MUV/世界书/角色创建链路，0.5.36 本阶段只改变纯核心预算估值和诊断，不改变实际战斗执行或初始化入口。

状态：**0.5.36 发布门禁通过，真实酒馆导入通过；自动 AI 生成仍受测试酒馆 Horde 模型配置限制**。

## 2026-08-22：跨宿主内容契约门禁（0.5.35 真实酒馆通过）

- 新增纯核心 `contentContract.ts`，由 `createBattleRequest()` 统一检查内容包集合、稳定 ID、现代 `effects/effect_program` 来源、状态引用、Power/Event/修饰符/X 费策略和敌人行动基本结构。
- `createContentPack()` 在同一输入边界收敛 MUV 可扩展数组包装；不解析旧 `effect` 字符串，不读取 Tavern Helper、MUV、DOM，也不新增第二套执行器、分析器或 UI 诊断。
- 旧聊天仍可通过 `effect` 字符串进入 Tavern 兼容链；现代内容错误现在在所有宿主创建 `BattleRequest` 前失败，网站/服务/Mod 获得与 Tavern 相同的核心输入语义。
- 新增 `test:content-contract`，并加入 `release:tavern`；类型检查、内容契约、BattleRequest 和内容分析回归通过。
- 完整 `npm run release:tavern` 重新通过，发布产物为 `dist/tavern/魔法少女世界-酒馆兼容版.png`，角色卡版本 `0.5.35`，内嵌世界书 `魔法少女世界0.5.35`，MUV `v0.181.0`，SHA-256：`D79D25A5DA6AB70AF2076FA619E073B27BC928D114705510727550C967DB1638`。
- 真实 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0` 已导入 `魔法少女世界140.png`。角色管理器能识别并显示 0.5.35；首次打开角色创建 iframe 正常出现，内嵌世界书 `魔法少女世界0.5.35` 成功导入并链接到角色，日志确认 `global_Mvu_initialized`、`mag_variable_initialized`、`变量初始化完成` 和 `角色创建系统初始化完成`。随后重新导入当前发布产物，SillyTavern 返回最新文件名 `魔法少女世界141.png`。
- 角色创建表单已提交测试数据（魔法少女 / 医生 / 魔法守护者 / 白木市 / 白木市政大楼），实际发送 `[角色创建]` 浅层 profile JSON，界面显示“角色已提交，正在生成开场剧情。”正文保持 SillyTavern 原生显示，状态栏只在末尾追加，战斗 iframe 仍位于战斗引导正文之后。
- 测试酒馆当前没有可用 Horde 模型，生成开场剧情时报 `No Horde model selected or the selected models are no longer available.`；这是外部 AI 配置阻塞，不是卡片导入、世界书、MUV、角色创建或前端渲染错误。此前确定性 `/sendas` 已覆盖战斗、状态栏、MUV 写回、战斗 iframe 和刷新恢复链路。

状态：**0.5.35 完整发布与真实酒馆基础链路通过；AI 自动生成回归待测试酒馆配置可用模型后继续**。

## 2026-08-22：0.5.34 卡片内 MUV loader 世界书门控（真实酒馆通过）

- 角色卡内的裸 MUV `import` 改为等待内嵌世界书 `魔法少女世界0.5.34` 可读取后再动态加载 MagVarUpdate；全局 loader 标记保证同一页面不会重复加载。`ensureMvuRuntimeReady()` 仍是唯一 Tavern/MUV 就绪边界，common、start、fish 和 game-core 没有新增初始化器或平行重试。
- `verify:tavern` 现在检查发布卡中确实存在目标世界书门控；完整 `npm run release:tavern`、类型检查、核心边界、战斗契约、HTML 安全、世界书契约和 Tavern 产物验证全部通过。
- 发布产物为 `dist/tavern/魔法少女世界-酒馆兼容版.png`，角色卡版本 `0.5.34`，内嵌世界书 `魔法少女世界0.5.34`，MUV `v0.181.0`，SHA-256：`542D02958288984657F7798828F8AB2BCA57DC2853D8899B6D7823DC5C56989B`。
- 真实 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0` 首次打开 `魔法少女世界139.png` 已通过：角色创建 iframe 正常出现，状态栏显示 `[MVU]脚本加载成功`、`[MVU]变量初始化成功` 和当前世界书名称；无需手动点击“重新处理变量”。未发现新的 0.5.34 世界书缺失错误，唯一匹配为旧 0.5.33 卡留下的历史日志。

状态：**0.5.34 真实酒馆首次打开通过**。

## 2026-08-22：0.5.33 MUV 世界书就绪边界重试

- `ensureMvuRuntimeReady()` 仍是唯一 Tavern/MUV 就绪入口；对明确的“未能找到世界书”瞬时错误在既有超时窗口内重试，schema/类型和其他错误立即抛出，不复制 MUV 初始化器。
- 新增 Tavern 契约回归：两次瞬时世界书缺失后继续等待 `stat_data.battle`，并确认非瞬时 schema 错误不会被重试吞掉。AI `effects`、世界书、MUV schema、正则、正文/状态栏分流和战斗页面位置不变。
- `npm run typecheck`、`npm run verify:tavern`、`npm run test:runtime-safety`、`npm run test:common-interface` 已通过；完整发布和真实酒馆首次打开回归已在 0.5.34 卡片 loader 门控中完成。

## 2026-08-22：0.5.32 欲望分量与敌人压力预算统一

- `ContentAnalysis` 保留 `metrics.attack` 作为扁平 AI 摘要，同时拆出内部 `damage`/`lust` 分量；`contentPack` 通过现有 `modifierMath` 分别应用 `damage`、`damage_taken`、`lust` 和 `lust_taken`，混合卡牌不会把欲望修饰符套到生命伤害上。
- 玩家 `player_lust_effect` 现在作为低频支援效果加入构筑预算，不增加 AI 字段，也不改变溢出触发运行时；欲望效果使用统一的 `CONTENT_DESIRE_EFFECT_WEIGHT`，避免在多个消费者重复声明权重。
- `enemyBudget.assessEnemyBudget()` 继续只由 `contentAnalysis` 提取内容；普通 `lust` 行动和敌人 `lust_effect` 满溢效果都能证明敌人有压力，不再被误报为“无风险战斗”。旧 `OP.lust +` 字符串也会进入同一分量，`OP.lust -` 不再被误判为输出。
- 新增混合牌、旧欲望字符串、玩家溢出效果、敌人欲望行动和敌人满溢效果回归；未新增 Tavern/MUV/DOM 依赖。
- 完整 `npm run release:tavern` 通过；发布 PNG 为 `7,558,197` 字节，SHA-256：`3138059FF3B955E50CEF312F6A4C1F2B1DEB0F433430EACD17E24036BAD21FC4`。世界书 `11,249` token，首轮 `8,510`，普通回合 `3,680`；欲望效果样例仍为 `17` token。
- 真实 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0` 导入为 `魔法少女世界136.png`，角色版本显示 `0.5.32`，内嵌 `魔法少女世界0.5.32` 成功导入并链接。首次打开时宿主先处理消息再完成世界书加载，点击角色卡提供的“重新处理变量”后初始化成功；这是酒馆加载时序，不改代码链路。
- 确定性聊天 `魔法少女世界 - 2026-08-22@12h43m24s130ms` 通过 `/sendas` 走真实 MUV/正则/iframe：状态栏显示魔法守护者、契约护幕 x5、生命之根和玩家欲望效果；战斗敌人“欲望镜灵”行动显示“使对方增加6点欲望”，敌人满溢效果显示“造成4点伤害”，玩家欲望效果显示“造成5点伤害”。结束回合后玩家欲望 `0 -> 6`，出牌后敌人 `30 -> 24 HP`；刷新并从最近聊天重开后恢复敌人 `24/30 HP`、玩家欲望 `6/100`、能量 `2/3`、手牌 4 张，结束回合按钮可用。

状态：**0.5.32 真实酒馆通过**。

## 2026-08-22：0.5.31 历史状态触发预算统一

- `contentAnalysis.analyzeStatusDefinition()` 现在通过同一个 `analyzeContentDefinition()` 入口读取状态触发器中的历史 `effect` 字符串、字符串数组和现代浅层 `effects`；旧状态仍只在读取边界兼容，不新增第二套公式解析器。
- 这修复了一个只影响构筑提示/敌人诊断的漏计：历史 `tick/apply/...` 状态触发器此前会被预算静默跳过，导致恢复、防御、伤害联动低估；运行时历史字符串执行行为未改变。
- 新增回归覆盖旧字符串、字符串数组和 `stacks` 动态公式；`game-core` 仍不读取 Tavern Helper、MUV 或 DOM。
- 完整 `npm run release:tavern` 通过；发布卡为 `7,554,317` 字节，SHA-256：`92E40F556B1693F0757F2865AE7BA59A20533E34222F39F1E13BC9945AD2283D`。真实 SillyTavern `1.18.0` 导入为 `魔法少女世界135.png`，角色版本和世界书均显示 `0.5.31`，并成功加载角色创建 iframe。

## 2026-08-22：0.5.30 远征非战斗节点闭环（真实酒馆通过）

- 在同一套 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0` 环境中，补做了事件、营火和商店三个节点的确定性回归，均使用单消息 assistant fixture 验证状态栏写入，不改生产规则。
- 事件节点：领取带 `run_result` 和卡牌候选的事件奖励后，生命由 `40` 降到 `32`，金币由 `119` 增至 `131`，候选清空，卡牌入库，路线推进到 Act 1 第 4 层；`run_result` 被消费且不会重复结算。
- 营火节点：点击“恢复 30% 最大生命”后生命由 `32` 增至 `56`，节点完成并推进到第 5 层；路线选择数量和危险级正常生成，营火不会生成 AI 变量补丁。
- 商店节点：程序显示卡牌/遗物/道具价格 `45/95/35`，选择卡牌和道具后通过“未满上限”二次确认，金币由 `131` 降至 `51`，物品与卡牌入库，候选清空并推进到第 5 层；价格没有进入 AI 输出或 MUV 候选对象。
- 本阶段完整 `npm run release:tavern` 通过，用时约 `127s`。发布卡维持 `0.5.30`，文件大小 `7,552,789` 字节，SHA-256：`5921B0D5478C604E6D175683C1B47A6832073355EC2C83521F284DE9F1B8BF4D`。`npm run measure:run-output` 当前测得完整世界书 `11,249`、首轮 `8,510`、普通回合常驻 `3,680` 个 `o200k_base` token；奖励、商店、事件和升级仍只在对应节点注入。

## 2026-08-22：0.5.30 真实酒馆战斗到奖励路线闭环（确定性回复回归）

- 在 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0` 中，使用 0.5.30 角色卡和浅层 `effects` 战斗内容完成真实交互回归。测试回复为确定性 assistant 快照，仅用于在没有 AI API 时验证酒馆链路，不改变生产代码或规则。
- 战斗 iframe 成功读取 `stat_data.battle`：敌人、行动序列、首手牌、遗物 `battle_start` 效果、能量和格挡均正常显示。实际打出 6 张牌并结束 2 次敌人回合，敌人伤害、格挡、弃牌堆、能量和生命变化与 UI 日志一致。
- 真实胜利确认后，`battleSettlementAdapter` 完成单次清理：敌人对象清空、临时能力/状态清空、战斗快照移除；`run.phase` 进入 `awaiting_choice`，Act 1 第 2 层路线生成，金币从 `99` 增加到 `119`。
- 奖励回归验证了 `reward.card` 的 3 选 1 UI、结构化规则说明和原子领取：选择“月影引导”后候选清空、正式牌组增加该卡、经验保持 `25/100`，并生成“新增卡牌”通知。随后点击下一层战斗路线，用户消息收到 `[路线节点] act=1 floor=2 kind=battle`，`run.phase` 进入 `in_node`，构筑摘要将 `draw=1` 纳入预算。
- 没有可用 AI API 时，确认按钮只会发起后续剧情请求并等待 AI；这不是代码错误。真实战斗、MUV 写入和路线事务均已由酒馆端完成。
- 本轮回归命令全部通过：`npm run typecheck`、`npm run test:battle-settlement-adapter`、`npm run test:run-transactions`、`npm run test:reward-transactions`、`npm run verify:tavern`。

## 2026-08-22：0.5.30 首轮交接与空牌组门控（真实酒馆通过）

- 真实初始聊天暴露空牌组可直接进入路线的问题；common 远征渲染入口现在以当前 MUV `battle.cards` 为门控，空牌组最新楼层只显示“等待起始牌组”，不会创建不可玩的战斗节点，且不影响历史消息和奖励/事件结算。
- 首轮角色创建改为唯一的 `src/start/core/promptGenerator.ts` 浅层 JSON 生成器，消息固定为 `[角色创建]`、一行 profile JSON、`[开始游戏]`；移除了未接入生产且残留 `gender` 的旧提示生成器，并为创建按钮增加并发锁与历史楼层只读锁。
- 新增 `test:start-flow`，校验角色消息字段、长度上限、世界书触发标记、创建并发门和消息历史锁；该门禁已加入完整发布流程。
- 示例角色创建消息由旧版 `138` 个 `o200k` token 降为 `52`；首轮世界书因增加显式输入协议从 `8,460` 增至 `8,510`，合计仍净减少约 `36` token，普通回合常驻保持 `3,680`。
- `npm run release:tavern` 完整通过，用时约 `115.5s`；发布卡为 `7,552,789` 字节，SHA-256：`5921B0D5478C604E6D175683C1B47A6832073355EC2C83521F284DE9F1B8BF4D`，角色版本与内嵌世界书均为 `0.5.30`。
- 真实酒馆导入文件为 `魔法少女世界134.png`；新聊天成功加载 `魔法少女世界0.5.30`、MUV `v0.181.0` 和状态栏。空牌组新楼层实际显示“等待起始牌组”，路线按钮数量为 0；同卡注入 3 张真实 MUV 牌组后，第一层战斗按钮重新出现，并实际注入 `[构筑摘要] deck=11 atk=14 def=12 ...` 与 `[敌人预算] hp=21..42 hit=4..12`。
- 首轮创建 iframe、状态栏 iframe 和 MUV 初始化日志均在真实 SillyTavern 消息楼层加载；测试酒馆没有可用 Horde 模型，因此没有自动 AI 战斗回复，但不影响本批首轮、路线和变量链路验收。

## 2026-08-22：0.5.29 构筑联动估值与候选分工（真实酒馆通过）

- common 状态栏的构筑摘要、敌人预算和构筑建议共享一个完整 `ContentPack` 边界；卡牌、状态、遗物、能力、当前状态和欲望效果不再由三处提示函数分别挑选。
- 真实 Tavern 内容校准工具也调用同一个 `createContentPackFromMvuBattle()`；测试门禁禁止它重新手写 `cards/statuses/artifacts/player_status_effects` 映射，运行时与诊断工具不会再产生两份 MUV 内容解释。
- 构筑预算继续复用结构化效果执行器：当前玩家状态层数进入公式代表值，`passive`/状态 `hold` 的 `modify` 只应用到实际卡牌效果一次，不把修饰符本身重复算成攻击或防御。
- 同批候选的 `[构筑建议] roles` 带程序计算的短方向，例如 `补短板(防御),强联动(状态:ember_mark),转方向`。这不增加 AI JSON 字段、不保存候选历史，也不禁止机制相近但叙事身份不同的内容。
- 世界书总量为 `11,199` token，首轮 `8,460`、普通回合常驻 `3,680`；奖励预算加构筑建议 `48` token，商店预算加建议 `39` token，均只在对应节点出现。
- `npm run release:tavern` 完整通过；发布卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,542,261` 字节，SHA-256：`F01C14F8AD480A12297EC7DB34EDB87757951719DE583049C5845A0F8C2494A6`。
- 真实环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。卡片导入为 `魔法少女世界132.png`，内嵌世界书 `魔法少女世界0.5.29`、MUV 初始化和状态栏恢复均通过。
- 在 `魔法少女世界132.png` 的真实酒馆聊天中，路线按钮实际注入 `[构筑摘要] deck=11 atk=14 def=12 heal=0 draw=0 energy=0 hp=80/80` 与 `[敌人预算] hp=21..42 hit=4..12`；同一楼层快照经 `tavern:calibrate-content` 得到相同构筑/敌人预算。空牌组的初始创建阶段不输出预算，避免给 AI 伪造构筑信息。
- 同一聊天刷新并从聊天列表重开后，状态栏将旧楼层标为历史记录，最新楼层保持可交互；正文仍是原生 Markdown，普通消息只在末尾追加状态栏，战斗引导仍保持原位置。测试酒馆没有可用 Horde 模型，因此未执行自动战斗回复。

## 2026-08-22：0.5.28 远征节奏单一契约（真实酒馆通过）

- 新增 `src/game-core/runPacing.ts`，集中处理 Act、层数、节点种类和同类节点计数对内容节奏的影响。
- 路线方向、战斗奖励预算、商店候选数量和 Tavern 战斗请求复用同一份 `RunPacingContext`；适配器不再重新推断 Act 阶段。
- `normalizeRunAct()` 统一奖励预算与商店价格的 Act 边界；核心边界门禁禁止预算层重新加入本地 `actOf` 或硬编码夹取。
- 没有改变 `run` schema，也没有增加 AI 输出字段。事件与商店仅获得短自然语言提示，机制相同的换皮内容仍然允许。
- 自动测试覆盖确定性、Act 开局递进、后段事件代价、商店层级和路线上下文传递；完整 `npm run release:tavern` 已通过。
- 世界书总量由 `11,015` 增至 `11,164` token，但首轮仍为 `8,425`、普通回合常驻仍为 `3,680`；完整路线提示仅在选择节点时出现，带构筑/敌人预算时为 `138` token。
- 最终发布输出为 `dist/tavern/魔法少女世界-酒馆兼容版.png`，大小 `7,535,525` 字节，SHA-256：`AE4196E0587DB399BB18FFCF868405FEC23DF7E849A17BFFE640F577C9B6CFB0`；完整 `npm run release:tavern` 用时约 `136.8` 秒并通过。
- 真实环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。最终导入后的角色卡文件为 `魔法少女世界131.png`，大小 `7,535,661` 字节，SHA-256：`4B30F00C17610D9B34F83F5A44E6A94527EA6D9E6723C4188BE6CCFEDAB42E5C`；角色版本、开场局部正则和内嵌世界书 `魔法少女世界0.5.28` 的 MUV 初始化均成功。
- `魔法少女世界130.png` 实测路线按钮在聊天中新增并注入 `[路线节点] act=1 floor=1 kind=battle danger=1 node_id=a1_f1_battle_0_0`，同时写入节奏、章线、构筑摘要和敌人预算。整页刷新后从聊天列表重开，最新路线消息仍在，状态栏恢复为“历史记录 · 战斗 · Act 1 第1层”，MUV 远征状态保持 Act 1、`0/10` 层、`99` 金币。最终 `131` 与该卡相比仅收敛程序内部 Act 归一化，没有改变 AI/MUV/UI 契约。
- 本轮未能自动生成战斗 AI 回复，原因是测试酒馆没有可用 Horde 模型（`No Horde model selected or the selected models are no longer available.`）；这不影响卡片导入、MUV 初始化、路线注入或状态恢复链路。

## 2026-08-22：0.5.27 外层生命周期权重边界

- 共享触发目录现在导出 `OUTER_LIFECYCLE_TRIGGER_SET`/`isOuterLifecycleTrigger`，内容分析不再把 `battle_start/passive` 当成可注册的内部 `on` 触发器。
- `analyzeEffectProgram` 增加仅作用于当前层直接效果的权重参数；外层生命周期只降低立即执行的默认效果，内部 `on: "turn_start"` 等注册效果保持自己的频率。新增回归覆盖现代、旧字符串、根触发和嵌套触发。
- 这批没有改变 AI 字段、EffectProgram 执行或 Tavern UI；需要重新发布是为了保证角色卡内嵌版本与工作树一致。
- 完整 `npm run release:tavern` 通过（约 237 秒），世界书 token 保持完整 `11,015`、首轮 `8,425`、普通回合 `3,680`。最终 PNG 为 `7,523,437` 字节，SHA-256 `96BE48C638A33E152CBA31F624A1A3D510896164065996CB1FFD72DE2E73D81F`，真实酒馆导入为 `魔法少女世界128.png`。
- 内嵌 `魔法少女世界0.5.27` 成功导入并链接。确定性聊天 `魔法少女世界 - 2026-08-22@08h10m00s739ms` 使用纯对象格式卡牌、遗物、敌人行动和双方欲望效果；打出 `校准星击` 后敌人 `24 -> 20 HP`，结束回合后玩家 `40 -> 39 HP`、能量恢复 `3/3` 并进入回合 2。整页刷新后从聊天列表重开，快照数值和可操作战斗界面一致恢复，随机游标为 9。

## 2026-08-22：0.5.26 触发权重校准与 Tavern 工具边界收敛

- `src/game-core/contentAnalysis.ts` 现在把现代 `effects` 连同定义级 `trigger` 一起交给同一个紧凑 DSL 编译器。根触发器与单项 `on` 覆盖会按编译后的实际注册结构分别计权，不再把根权重重复乘到例外效果上；旧 `effect` 字符串仍走兼容权重路径。
- 新增 `scripts/lib/tavern-api.mjs`，统一 CSRF、Cookie、聊天读取和保存的 SillyTavern HTTP 边界。角色卡导入、快照工具和内容校准脚本不再各自复制请求链路。
- 新增只读 `scripts/calibrate-tavern-content.mjs` 和 `npm run tavern:calibrate-content`，直接读取真实聊天的 `stat_data.battle`，复用 `game-core` 的内容分析、构筑预算和敌人预算；它没有聊天写入入口。`test:tavern-tools` 用 mock fetch 和源码门禁保证这一点。
- 真实样本校准覆盖 `0.5.22`、`0.5.23`、`0.5.24` 和 `0.5.25` 聊天；结果没有证明需要改全局平衡数字，只证明触发权重的重复计算需要修正。
- 完整 `npm run release:tavern` 通过（约 136 秒）。正式世界书仍为 `11,015 o200k_base token`，首轮 `8,425`，普通回合 `3,680`；最终 PNG 为 `7,522,501` 字节，SHA-256 为 `F7F379DFA6A372EE1743B057E24F2218BE6681B7F63F2B16EF87D2F71574C4D2`，并通过导入接口进入真实酒馆为 `魔法少女世界127.png`。
- `0.5.26` 中间卡的角色版本和内嵌世界书均为 `0.5.26` / `魔法少女世界0.5.26`；其完整聊天证据由最终 `0.5.27` 回归取代。

## 2026-08-22：0.5.25 单对象效果与共享紧凑契约

- 新增 `src/game-core/compactEffectContract.ts`，作为 AI 紧凑效果容器、组合展开顺序和操作元数据投影的唯一事实来源。编译器、显示文本、内容分析、战斗预检、奖励校验、动态状态、卡牌升级和 JSON Schema 均复用该契约，不再维护平行操作表。
- `effects` 在只有一个浅层效果时可省略数组；无前后状态依赖的常见效果可合并在同一对象。共享 `when/on` 作用于整个组合；有先后依赖的效果继续使用数组，保持逐步重读最新状态的语义。
- 单对象错误路径会定位到具体字段，例如 `battle.cards[0].effects.damage.left`。MUV 初始化模板中的玩家/敌人欲望效果容器改为可扩展对象，同时保留旧数组读取兼容。
- 世界书、AI 格式文档、效果 DSL、旧语法审计和发布 Schema 已同步更新。完整 `npm run release:tavern` 用时约 136 秒并通过，仅有既有的 Webpack 体积和 Browserslist 提示。

正式世界书为 `11,015 o200k_base token`，首轮 `8,425`，普通回合 `3,680`。单效果从数组的 30 token 降为对象的 28 token，伤害加格挡从 34 降为 32，动态生成牌从 75 降为 66。最终发布卡导入为 `魔法少女世界126.png`；源 PNG 大小 `7,522,365` 字节，SHA-256 为 `F31870A73BFBA386BC9A2A541C511078F0871907C6262440005C0682637B99C3`。

真实回归环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`，聊天 `魔法少女世界 - 2026-08-22@07h07m00s574ms`。纯对象格式的组合卡、治疗卡、状态卡、敌人行动、双方欲望效果和状态 `hold` 均执行成功；结束回合后为回合 2、玩家 `32/40 HP`、敌人 `26/30 HP`、随机游标 9、手牌 5/抽牌 1/弃牌 5/消耗 0、聚焦 2。整页刷新并重新打开聊天后状态一致，`结束回合` 仍可用。

## 2026-08-22：0.5.24 现代命令直连与显示定义去重

- 新增 `src/fish/core/effectCommandAdapter.ts`，把核心逐步解析得到的 `EffectCommand` 直接映射到 Tavern 宿主命令。现代程序不再经过旧字符串编译器和 `UnifiedEffectParser` 的往返，核心规则与酒馆副作用之间只保留一个适配边界。
- 在 `src/fish/combat/effectDefinitions.ts` 集中注册 `heal_modifier`，效果标签和修饰符名称都从统一属性定义读取；删除 `UnifiedEffectDisplay` 的重复本地属性映射，并修复 `ME`/`OP` 目标极性显示。
- 保持 AI 浅层 JSON、简易公式、MUV schema、正文/末尾状态栏分流和战斗页面布局不变。旧 `effect` 字符串仍由兼容入口执行，避免历史聊天回归。
- 新增直接命令适配和运行时回归断言；`npm run release:tavern` 全链路通过。

最终发布卡为 `魔法少女世界125.png`，大小 `7,507,885` 字节，SHA-256 为 `86B39DD2FE5D68BB3CF14E216457E41865858D3EA105858B01F198015AA145FB`。真实 SillyTavern 回归覆盖治疗修饰符、公式伤害、状态叠层、动态插牌、旧 Power、结束回合、牌区迁移以及整页刷新后重新打开聊天恢复；结果为回合 2、玩家 `43/50 HP`、敌人 `29/40 HP`、抽牌堆 3、弃牌堆 5。

## 2026-08-22：0.5.23 现代程序策略单点预检

- 新增宿主无关 `src/game-core/effectProgramPolicy.ts`，统一校验现代 `EffectProgram` 的入口策略：Power 顶层触发器、普通牌/道具/敌人行动禁止延迟触发、X 费 `spent_energy`、状态 `stacks`、Event 唯一顶层 `narrate`、passive/hold 仅允许 `modify`，以及状态 ID 引用。
- `battleContentPreflight` 现在对现代 `effects`/`effect_program` 直接使用核心策略和 `contentAnalysis`；不再把现代 AST 回编译为旧 `ME/OP` 字符串后重复解析。历史 `effect` 字符串仍由 `validateEffectSyntax` 兼容读取，旧聊天行为不变。
- 预检的构筑胜利压力、防御/恢复和敌人压力改为读取统一内容分析结果，避免第二套正则扫描与动态公式误判。错误路径映射回 `effects[index]` 或 `effect_program.steps[index]`，便于 AI/用户修复。
- 新增 `test-effect-program-policy.mjs`，并纳入 `test:game-core-effect-dsl`；现有 battle-content-preflight 回归更新为精确字段路径。本批不新增 AI 字段、不改变浅层 JSON 或复杂卡牌输出长度。

完整 `npm run release:tavern` 用时约 114.8 秒并通过（仅保留既有 Webpack 体积和 Browserslist 提示）。最终发布卡为 `魔法少女世界123.png`，PNG 大小 `7,509,669` 字节，SHA-256 为 `66CFF6A4D3B742DE8F08054F390EF95B420DFF8A42DE32F9D0063FC27F9E0B5D`。

真实酒馆复验使用 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`，聊天 `魔法少女世界 - 2026-08-22@05h10m08s876ms`。内嵌世界书 `魔法少女世界0.5.23` 成功导入并链接；角色创建、MUV 初始化、战斗 iframe、旧 Power、现代遗物/能力/状态、主动弃牌、结束回合和整页刷新恢复均通过。回合 2 快照为玩家 `44/50 HP`、2 格挡、`3/3` 能量，敌人 `26/30 HP`、1 格挡，状态 1 层，牌区手牌 5/抽牌 0/弃牌 4/消耗 1；开战遗物未重复触发。

同一真实酒馆再注入非法现代 X 费公式到普通 1 费卡，战斗没有进入可玩状态，iframe 明确显示 `battle.cards[1].effects[1].amount.left: SPENT_ENERGY_NOT_ALLOWED`。这证明新策略在 MUV/酒馆助手链路中于开战前生效，而非只在 Node 测试中存在。

## 2026-08-22：0.5.22 统一内容分析与重复实现清理

- 新增宿主无关 `src/game-core/contentAnalysis.ts`，统一提取卡牌、遗物、能力、状态、敌人行动和生成牌的攻击、防御、恢复、抽牌、能量、状态引用、联动标签与确定伤害诊断。现代浅层 `effects` 先通过同一受限编译器执行在脱离宿主的代表性状态上，再由统一触发权重折算；条件、延迟触发、生成牌和弃牌副作用不会被多个消费者重复计入。
- `contentPack.ts`、`buildGuidance.ts` 与 `enemyBudget.ts` 现在只消费 `contentAnalysis` 输出，不再各自遍历 `effects` 或匹配字符串。减费按选中卡数折算能量价值，公式和条件会标记动态性，延迟/生成伤害不会误报为确定敌人行动伤害；旧 `ME/OP` 字符串仍走兼容读取。
- 删除完整 `src/fish - 副本/` 第二套执行器、战斗管理器、卡牌系统、状态/UI 和测试实现；删除生产 fish 中零调用的旧测试器与纯转发文件。Git 历史保留旧实现，`test:game-core-boundary` 现在把这些路径列入禁止回流清单，确保以后继续单点实现。
- 新增 `test:content-analysis` 回归覆盖公式、条件、触发权重、状态层数、生成牌、减费、弃牌和旧字符串；`release:tavern` 已纳入该测试与边界门禁。本批不改变 AI 浅层 JSON、世界书/MUV/UI 契约或复杂卡牌输出长度。
- 新增共享 `watchCurrentMessageUntilHistorical()` 消息守卫。普通状态栏和战斗 iframe 都从同一运行时入口判断当前楼层；新消息出现后，旧战斗隐藏行动区并停止轮询，卡牌和所有 MUV 写入口再次拒绝历史楼层操作。

当前 token 实测仍为完整世界书 `10,881`、首轮 `8,257`、普通回合 `3,680`；复杂 Power `89`、生成牌 `75`。历史消息守卫加入后的完整 `npm run release:tavern` 用时约 98.9 秒并通过；生产 PNG 为 `7,496,525` 字节，SHA-256 为 `E42A1F1D1AD248A3A2D0746FCF4927C336DF1E08FAB132E849193EC921016F8B`。

状态：**0.5.22 真实酒馆通过**。完整数值回归使用 `魔法少女世界121.png`：角色版本 `0.5.22`，内嵌并链接 `魔法少女世界0.5.22` 共 12 个条目；MUV `v0.181.0` 脚本加载成功。新聊天 `魔法少女世界 - 2026-08-22@04h06m35s185ms` 完成角色创建和变量初始化后，通过确定性 `/sendas` 覆盖原生引导正文、战斗 iframe、旧 Power、现代遗物/能力/状态、主动弃牌和完整回合。

- 开战为玩家 `41/50 HP`、2 格挡、3 能量，敌人 `30/30 HP`；现代“曙光之根”只执行一次，旧字符串 Power 只进入消耗堆一次并注册回合开始能力。
- 主动“回声献击”选择弃掉“回声代价”后，弃牌副作用只结算一次：玩家 `41 -> 43 HP`、能量回到 `2`，敌人 `30 -> 26 HP`，弃牌堆为 2。
- 结束回合后进入回合 `2`：玩家 `44/50 HP`、2 格挡、`3/3` 能量，敌人 `26/30 HP`、1 格挡，状态从 2 层降到 1 层，牌区为手牌 5、抽牌 0、弃牌 4、消耗 1。
- 整页刷新并从最近聊天重开后上述状态完全一致；消息快照随机游标为 8，开战遗物未再次触发。`npm run tavern:snapshot-tool -- inspect 魔法少女世界121.png "魔法少女世界 - 2026-08-22@04h06m35s185ms" 2` 已取得同一证据。
- 最终产物导入为 `魔法少女世界122.png` 后又做了针对性实机复验：战斗 iframe 正常加载；随后追加普通 `/sendas`，旧战斗显示“历史战斗记录”，结束回合按钮消失，卡牌不可操作；最新消息仍保留原生正文和一个可用状态栏。该链路由 `scripts/test-message-history-guard.mjs` 与 `test:runtime-safety` 共同守护。

## 2026-08-22：0.5.21 生产执行入口去重

- 删除只转发到 `UnifiedEffectExecutor` 的 `EffectEngine`。战斗回合、出牌、道具和开战流程现在直接使用唯一执行器，不再保留第二个效果服务、第二套错误包装或同义方法名。
- 删除 `CardSystem` 中零生产调用的旧牌库初始化、单独洗牌、卡牌添加包装、牌堆计数、被动弃牌、旧字符串描述器和“所有数字 +1”升级实现。正式流程继续分别使用 `GameStateManager` 牌区入口、`game-core` reducer/运行时 ID/升级器和 `UnifiedEffectExecutor -> CardSystem.discardCard` 的唯一弃牌管线。
- 删除 `GameStateManager` 中零调用的出牌计数自增、单独回洗、遗物增删与监听移除入口；删除遗物管理器的两个零调用查询包装。遗物现代程序和历史字符串现在共用同一份事务、上下文、反馈与回滚代码。
- `test:game-core-boundary` 的私有方法 AST 门禁扩展到 `CardSystem`、`GameStateManager` 和 `RelicEffectManager`，并禁止生产代码重新引用 `EffectEngine`。旧的被动弃牌测试改为保护真实的 `discardCard` 管线，不再反向要求保留死 API。
- 本批不改变 AI 浅层 JSON、公式、世界书条目、MUV schema、正文/状态栏或战斗 UI，不增加 token 与复杂卡牌输出长度。

状态：**0.5.21 真实酒馆通过**。完整 `npm run release:tavern` 用时 136.1 秒并全部通过，仅有既有 Webpack 体积和 Browserslist 提示。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 最终卡导入为 `魔法少女世界120.png`，角色版本 `0.5.21`，内嵌 `魔法少女世界0.5.21` 共 12 个条目，已成功导入并链接；新建聊天中的角色创建、MUV 初始化、原生正文、末尾状态栏与战斗 iframe 均正常加载。
- 确定性战斗同时覆盖旧 Power `ALL.turn_start(ME.block + 1)`、现代开战遗物、现代回合开始能力、现代回合末状态和主动弃牌副作用。Power 只消耗一次并让双方各新增 1 条能力；“回声献击”选择弃掉“回声代价”后只结算一次，玩家 `41 -> 43 HP`、能量先支付再恢复为 2、敌人 `30 -> 26 HP`，弃牌堆恰为 2。
- 结束回合后只进入回合 `2`：状态只结算一次并从 2 层变为 1 层，玩家为 `44/50 HP`、2 格挡、`3/3` 能量，敌人只行动一次并为 `26/30 HP`、1 格挡；牌区为手牌 5、抽牌堆 0、弃牌堆 4、消耗堆 1。
- 整页刷新并从最近聊天 `魔法少女世界 - 2026-08-22@03h16m25s185ms` 重新打开后，上述回合、HP、格挡、能量、能力、状态和全部牌区一致恢复，开战遗物未重复触发。最终发布 PNG 为 `7,437,829` 字节，SHA-256：`E2C8CB866BD48A93D4EC4C2B1644BC4A642304ACF58156D444C35A6018C950E8`。

## 2026-08-22：0.5.20 效果执行器重复入口清理

- `UnifiedEffectExecutor` 的旧能力注册从 `addAbility -> addAbilityNew -> registerAbility` 三层同义包装收敛为 `addAbility -> registerAbility`；跨目标日志直接留在旧字符串适配入口。现代结构化能力与历史字符串能力最终继续共用同一个 `registerAbility` 落库及 `ability_gain` 触发入口。
- 删除零调用空实现 `executeDiscardWithSelectorV2`、旧卡牌能量 setter，以及已被 `effectVariableResolver`/纯核心替代的实体读取、stacks 解析、变量 switch 和数学求值方法。历史聊天仍由正式兼容解析器执行，没有删除旧语法能力。
- `test:game-core-boundary` 除了禁止上述旧名称回流，还通过 TypeScript AST 检查 `UnifiedEffectExecutor` 的每个私有方法必须存在真实类内调用点；以后新增未使用占位或改名保留的第二套实现会直接阻断发布。
- 本批不改变 AI 浅层 JSON、世界书条目、MUV schema、正文/状态栏与战斗 UI，也不增加 token 或复杂卡牌输出长度。

状态：**0.5.20 真实酒馆通过**。完整 `npm run release:tavern` 用时 138.5 秒并全部通过，仅有既有 Webpack 体积和 Browserslist 提示。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 最终卡导入为 `魔法少女世界119.png`，角色版本 `0.5.20`，内嵌 `魔法少女世界0.5.20` 共 12 个条目，已成功导入并链接；MUV 脚本与初始化变量均确认加载。
- 实测旧 Power `ALL.turn_start(ME.block + 1)`。打出后卡只进入消耗堆一次、能量 `3 -> 2`，玩家和敌人各注册且只注册 1 条能力；消息快照中的双方能力 ID 均为各自容器内确定性的 `ability__1`。
- 结束回合后只进入回合 `2`，敌人只造成一次 1 点伤害，玩家为 `49/50 HP`；双方回合开始能力各触发一次，玩家和敌人格挡均为 1。牌区为手牌 5、抽牌堆 0、弃牌堆 4、消耗堆 1。
- 整页刷新并从最近聊天重新打开后，回合、HP、双方能力数量与规则、双方格挡、能量和全部牌区完全恢复。测试聊天为 `魔法少女世界 - 2026-08-22@02h48m58s881ms`。
- 同名新版本卡在已运行页面中导入时，必须先完成世界书导入和角色脚本加载，再建立验收聊天；本次最初的空初始化聊天仅用于定位宿主加载顺序，不作为功能结果。最终发布 PNG 为 `7,452,493` 字节，SHA-256：`C1B912B36E93B0CFE69C93A40D1C2B2EECEE3869D65971CBBEBB96C0DC84A1D0`。

## 2026-08-22：0.5.19 敌方动作规则与事务去重

- 敌方行动不再在 `BattleManager` 内创建第二层 `Date.now()` 快照。结构化程序或旧字符串执行失败会直接冒泡到 `battleSessionCoordinator`，由同一个 `end_turn` 外层事务回滚完整回合；不会再出现“敌方动作失败但其余回合仍被提交”的半成功状态。
- 默认攻击的 `5..12` 伤害分布迁入纯核心 `rollDefaultEnemyAttackDamage()`，并继续显式消费消息快照中的确定性随机源。fish 只把核心结果转换为旧兼容效果并协调动画、日志和副作用。
- 删除没有任何生产调用点的 `updateEnemyAI`、`adjustDifficulty` 和按字符串替换所有数字的旧难度实现。敌人选择继续唯一使用 `enemyActionSelector`；以后若加入动态 AI 或难度，只能先在 `src/game-core` 建立结构化规则，再由宿主适配。
- `test:enemy-action-transaction`、`test:battle-turn-flow` 与 `test:game-core-boundary` 现在同时禁止 fish 自建敌方动作快照、时间 ID、第二套权重修改和字符串难度缩放，并锁定默认伤害边界与非法随机输入。
- `effectAnalysis` 经调用点审计确认只负责把已确定的行动效果投影为 MUV/意图 UI 文案，不负责选行动或执行效果，因此保留在宿主展示适配层。本批不改 AI 浅层 JSON、世界书、MUV schema 或 UI，token 开销不变。

状态：**0.5.19 真实酒馆通过**。完整 `npm run release:tavern` 用时约 111.6 秒并全部通过，仅有既有 Webpack 体积和 Browserslist 提示。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 最终卡导入为 `魔法少女世界118.png`，角色版本 `0.5.19`，内嵌 `魔法少女世界0.5.19` 共 12 个条目，已成功导入并链接；MVU 显示脚本正常加载。
- 最小回归战斗从回合 `1`、玩家 `50/50 HP`、敌人 `30/30 HP` 开始。只点击一次“结束回合”后进入回合 `2`，固定敌方行动只结算一次，玩家精确降至 `46/50 HP`；敌人仍为 `30/30 HP`。
- 消息快照记录 `phase=player_turn`、`currentTurn=2`、`currentHp=46`、`randomSeed=2547161126`、`randomCursor=9`；牌区为手牌 5、抽牌堆 0、弃牌堆 5、消耗堆 0，且保存全部实体卡 ID。整页刷新并从最近聊天重新打开后，回合、HP、敌人、意图、能量和牌区完全恢复。
- 测试聊天为 `魔法少女世界 - 2026-08-22@01h45m22s440ms`。最终发布 PNG 为 `7,460,421` 字节，SHA-256：`F17E2A09A43858B207E5A6A1D777FBAF04C85BFD4C42E611F3B6CFE0A38273D4`。

## 2026-08-22：0.5.18 无 DOM 战斗会话协调器

- 新增纯核心 `battleSessionCoordinator.ts`，组合既有 `cardPlayTransaction`、`battleTurnFlow` 与宿主端口，统一拥有一次性开战、两阶段出牌、道具、结束回合的动作互斥、外层事务、异常回滚和终态短路。它不实现公式、牌区、触发器或效果副作用，不形成第二套规则。
- 出牌动画和弃牌选择现在发生在共享动作门取得所有权之后；快速双击出牌、选择期间结束回合、道具与其他玩家动作并发会被同一个 gate 拒绝。弃牌触发完成后仍从最新手牌与能量提交，双重效果、卡牌 transit、目标牌堆和 `card_played` 顺序保持原契约。
- 新增 fish `battleSessionHost.ts`，只把事务端口映射到 `GameStateManager` 完整快照。`BattleManager`、`CardSystem` 和 iframe 入口不再各自维护开战/出牌/道具/结束回合的外层快照、`Date.now()` 编号或布尔锁。
- 新增无酒馆依赖的 `src/adapters/referenceBattleSessionHost.ts`，为网站、服务和 Mod 示范脱离引用的可序列化状态、共享动作门与完整回滚。它不提供 UI，也不复制酒馆消费者。
- 新增 `test:battle-session-coordinator` 和 `test:reference-battle-session-host`，覆盖恢复时跳过开战效果、并发拒绝、选择取消、非法付款、弃牌触发后最新状态、双重执行、终态、异常回滚和外部状态隔离；原源码形状门禁已改为强制 fish 调用协调器。
- 本批不修改 AI 浅层 JSON、世界书字段、MUV schema、正文/状态栏布局或战斗页面，因而不增加提示 token 和复杂卡牌输出长度。

状态：**0.5.18 真实酒馆通过**。完整 `npm run release:tavern` 用时 80.8 秒并全部通过，仅有既有 Webpack 体积和 Browserslist 提示。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 最终卡导入为 `魔法少女世界117.png`，内嵌 `魔法少女世界0.5.18` 共 12 个条目，已成功导入并链接；角色级正则权限已启用。
- 确定性战斗开局为玩家 `40/50 HP`、3 能量、1 格挡，敌人 `30/30 HP`；1 格挡证明开战遗物只执行一次。道具原子事务使玩家 `40 -> 43 HP`、药剂数量变为 0。
- “回声献击”使用两阶段付款，选择弃掉“回声代价”后，弃牌触发先使玩家 `43 -> 45 HP`、能量 `3 -> 4`，再支付 1 能量并造成 4 点伤害；最终为玩家 `45/50 HP`、`3/3` 能量、敌人 `26/30 HP`、弃牌堆 2。消息快照保存准确的实体卡 ID 与 seed 游标。
- 整页刷新并重新打开聊天后，回合、HP、能量、格挡、敌人 HP、全部牌区、实体卡 ID 和随机游标完全恢复，开战格挡没有重复。终结牌随后进入胜利终态；强制尝试继续出牌和结束回合均未改变终态快照。
- 确认胜利后 `battle_session` 删除，MUV 写回 `battle.core.hp=45`、药剂数量 0，并清空敌人和行动配置。第二场合法战斗快速双击结束回合只从回合 1 进入回合 2，敌人只造成一次 1 点伤害，玩家 `45 -> 44 HP`；共享动作门没有重复推进。
- 测试聊天为 `魔法少女世界 - 2026-08-22@00h53m37s895ms`。最终发布 PNG 为 `7,462,645` 字节，SHA-256：`F9DB1298F6DA336BFE154ED8804F648B47447B9BA37B28BF3830A7DCA5351E20`。

## 2026-08-21：0.5.17 结构化命令、终态与 MUV 结算单一规则源

- 新增纯核心 `effectCommandRuntime.ts`。现代 `EffectProgram` 不再整体编译成一段旧字符串执行，而是严格按 AI `effects` 原数组顺序逐步解析为 `EffectCommand`；每一步都从宿主读取最新状态后重算公式与条件，执行后立即检查终态。数值公式继续使用既有向下取整规则，回合内能量仍允许临时超过上限。
- `CardSystem`、Power、遗物、道具、双方能力、敌人行动、欲望效果、状态 `apply/stack/tick/remove`、动态生成卡牌及快照恢复全部携带并执行同一份 `effectProgram`。fish 只消费单条命令并协调动画、日志、选择、事务、快照和 MUV；旧效果字符串只保留历史聊天兼容，`hold/passive` 暂保留兼容字符串供现有修饰符计算与展示。
- 新增纯核心 `battleTerminal.ts` 与 `battleEndPrompt.ts`，唯一维护胜利、失败、Event 终止、双方同时死亡时玩家优先、旧快照终态恢复，以及结束提示、战斗摘要、叙事卡记录、奖励预算和构筑建议格式。
- 新增 `runtime/battleSettlementAdapter.ts`，用同一清理计划结算规范与旧版两个 MUV battle 根：写回 HP/欲望/道具和路线结果，清空临时能力、活动状态、敌人及行动配置。内部状态 `triggerPrograms` 在写回 MUV 前剥离，不改变 AI/MUV schema。
- 快照恢复会递归校验运行时卡牌的 `effectProgram/discardEffectProgram`；损坏程序拒绝恢复。新增命令运行时、终态和结算适配器测试并纳入 `test:game-core-boundary`，结构门禁继续禁止适配层重新实现规则。
- AI 浅层 JSON、世界书字段、MUV schema 和 UI 均未改变。完整世界书仍为 `10,881 o200k_base token`，首轮 `8,257`，普通回合 `3,680`；复杂卡牌输出长度也未增加。
- 首次完整发布在最终酒馆脚本检查发现 Webpack 新导出名 `$1` 被旧发布保护转换为非法标识符 `\x241`。发布器现使用字符串和标识符都合法的 `\u0024`，最终 `vm.Script` 门禁直接覆盖该酒馆二次解析边界；修复后完整 `npm run release:tavern` 连续通过，仅有既有体积和 Browserslist 提示。

状态：**0.5.17 真实酒馆通过**。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 最终卡导入为 `魔法少女世界116.png`，内嵌 `魔法少女世界0.5.17` 共 12 个条目，已成功导入并链接；角色级正则权限已启用。
- 组合战斗依次使用结构化道具、顺序公式牌、Power、状态、动态生成牌、敌人顺序行动和双方欲望效果。开战为玩家 `40/50 HP`、`4/3` 能量、1 格挡，敌人 1 格挡；道具治疗 2，`顺序棱镜` 先获得 2 格挡、再从最新 `self.block` 读取 3 并获得 3，最终正确为 6，而不是从旧状态计算。
- 状态连续施加两次后触发 `apply/stack`，玩家为 `42/50 HP`、`5/3` 能量、9 格挡、`回声刻度 2`；动态“试验星火”执行伤害与欲望效果后进入消耗堆，敌人为 `33/40 HP`。官方消息快照保存 Power、动态程序、全部牌区与确定性 ID；整页刷新并从最近聊天重开后完全一致。
- 第一轮结束后状态 tick/衰减为 1 层、玩家 `43/50 HP`，Power 在下一回合只触发一次并获得 2 格挡；第二轮结束后状态 tick 到 `44/50 HP` 并移除，敌方“结构防御”获得 3 格挡，下一意图回到“欲望冲击”。
- `终局裁定` 进入胜利终态；确认后快照删除、`battle.core.hp=44`、道具数量写回 0，敌人、行动、临时能力和活动状态清空。另两场最小实测分别得到“战斗终止”和“失败”，Event 叙事正确保留，确认后同样清理；失败将 `battle.core.hp` 写回 0。
- 测试聊天为 `魔法少女世界 - 2026-08-21@23h33m01s878ms`。最终发布 PNG 为 `7,455,373` 字节，SHA-256：`2980BE8E339E1999E5B0C6D1BF757E05E8EE33EEEAE83D64B6332B35148244D7`。

## 2026-08-21：0.5.16 回合流程与事件分派单一规则源

- 新增纯核心 `battleTurnFlow.ts`，唯一维护一次性战斗开始步骤与“玩家回合结束 -> 敌人回合 -> 下一玩家回合”的完整顺序，并在每一步后检查终态。无敌人、眩晕、已准备意图、即时选择与默认行动也只由核心决定分支。
- 新增纯核心 `battleEventDispatch.ts`，唯一决定生命、欲望、格挡和状态归属变化应通知哪些能力与玩家遗物，并固定接收者能力、来源能力、玩家遗物的消费顺序。
- `BattleManager` 只实现核心步骤端口；删除眩晕/正常敌人回合的两套尾结算、未使用的第二套玩家开回合流程和状态生命周期空转路径。卡牌、能力、遗物与状态各自只保留一个正式调用入口。
- `test:battle-turn-flow`、`test:battle-event-dispatch` 与结构门禁阻止 fish 重建步骤数组、事件路由或同义触发包装。后续修改顺序或映射时必须先改 `src/game-core`，酒馆、MUV 和 UI 只消费结果。
- 本批不修改 AI 浅层 JSON、世界书字段、MUV schema 或 UI，完整世界书仍为 `10,881 token`，首轮 `8,257`，普通回合 `3,680`。

状态：**0.5.16 真实酒馆通过**。完整 `npm run release:tavern` 用时 60.5 秒并全部通过，仅有既有 Webpack 体积和 Browserslist 提示。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 最终卡导入为 `魔法少女世界115.png`，内嵌 `魔法少女世界0.5.16` 已成功导入并链接，局部正则权限已启用。
- 组合实测同时覆盖双方 `battle_start/turn_start/turn_end`、伤害收发、格挡变化、状态获得观察、遗物、状态 tick/衰减、首轮眩晕与次轮正常意图。战斗开始只执行一次；首张卡结算后玩家为 `42/80 HP`、`4/3` 能量、`11` 格挡和 `3` 欲望，敌人为 `37/40 HP`、`3` 格挡。`4/3` 是既有的回合内临时超额能量规则，不是重复触发。
- 第一轮敌人因眩晕跳过行动，但回合尾能力与状态衰减仍执行一次；第二轮“校验打击”只执行一次，4 点伤害由 1 格挡吸收后扣除 3 HP，受伤触发随后正确结算。官方消息快照最终为回合 `3`、`phase=player_turn`、玩家 `46/80 HP`、`4/3` 能量、`1` 格挡，敌人 `37/40 HP`、`2` 格挡。
- 整页刷新并从最近聊天重新打开后，上述数值、牌区、运行时卡牌 ID `dispatch_card_115__1` 与敌人意图全部一致恢复。
- 发布 PNG 为 `7,429,165` 字节，SHA-256：`0C722DFE1E4A0893E728C54185A654FFD9E1156B1F007336CDD5F7F804939F30`。

## 2026-08-21：0.5.15 出牌事务与触发目录单一规则源

- 新增纯核心 `battleTriggers.ts`，统一拥有能力/状态触发器 ID、旧别名、AST 可注册子集及状态持有者/观察者事件映射。效果 AST、浅层编译、奖励/状态校验、显示定义和 fish 执行链全部读取该目录，不再各自维护触发器列表。
- 新增纯核心 `cardPlayTransaction.ts`，把出牌拆成 `prepareCardPlay()` 与 `commitCardPlay()`：先验证并取得弃牌候选，选择完成后再从最新手牌与能量提交。fish 只协调选择 UI、效果、动画、日志、快照和 MUV。
- 提交阶段要求宿主提供实际弃牌 ID 作为付款证据，防止只打开选择 UI 却未支付弃牌；重新读取最新状态，防止弃牌触发生成的卡牌、治疗、格挡或能量变化被旧快照覆盖。
- `discard_requirement` 仅作为旧卡兼容字段恢复到类型、内容适配、预检、奖励校验与程序描述链；新世界书和 AI 浅层格式不增加该字段，也不增加 token 开销。
- `test:battle-triggers` 对触发目录消费者做结构门禁，禁止重新声明能力/状态触发器全集；出牌事务、能量、状态和生产调用链均有专项测试。后续核心规则继续遵循“`src/game-core` 唯一实现，酒馆/MUV/UI 只适配调用”。

状态：**0.5.15 真实酒馆通过**。完整 `npm run release:tavern` 用时 58.4 秒并全部通过，仅有既有 Webpack 单文件体积警告。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 首次导入的 `魔法少女世界113.png` 暴露 `battleContentAdapter` 丢失旧卡 `discard_requirement`，仅作为问题定位记录，不是最终基线。
- 修复后最终卡导入为 `魔法少女世界114.png`，角色版本 `0.5.15`，内嵌 `魔法少女世界0.5.15` 成功导入并链接。
- 实机使用 1 费且要求弃 1 张牌的“献火一击”，支付时弃掉“回响火种”；弃牌效果恢复 2 生命并生成“余火”，`on_discard` 能力和遗物分别获得 1/2 格挡。结算后敌人 `40 -> 36`、玩家 `40 -> 42`、格挡 `0 -> 3`、能量 `3 -> 2`、弃牌堆 2，手牌保留“守势”和新生成的“余火”。
- 整页刷新并重新打开 `114` 后，敌人 `36/40`、玩家 `42/80`、格挡 `3`、能量 `2/3`、弃牌堆 2 和两张手牌全部一致恢复。
- 世界书与 AI 输出格式未改变：完整 `10,881`、首轮 `8,257`、普通回合 `3,680 o200k_base token`。

最终源发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,439,205` 字节，SHA-256：
`AE9010E0F44D88AADD33993961C6F1374500661E9C8F6482C40B45CE3D878DD7`。

## 2026-08-21：0.5.14 叙事同机制内容兼容

- 撤销奖励/商店按玩法指纹禁用候选的策略。项目同时是 AI 角色扮演游戏，名称、设定和来源属于内容本身；“生命之石”和“生命之根”即使规则相同，也可以用不同稳定 ID 同时存在。
- common 状态栏不再隐藏或减少同机制候选，领取事务允许同批及跨楼层的不同 ID 同规则卡牌、遗物和道具进入永久内容。真正的数据安全规则保持不变：同 ID 不同定义拒绝、遗物同 ID 不得重复、非法效果/公式/状态引用原子回滚。
- 删除未再参与运行的玩法指纹模块和相关 UI 样式，降低维护成本。AI 仍会收到简短构筑分工建议，但世界书明确允许因叙事主题而保留机制相近内容，不增加输出字段或历史列表。
- 精简后的 `o200k_base` 实测：完整世界书 `10,881`、首轮 `8,257`、普通回合 `3,680`，分别比 `0.5.13` 减少 33、33、4 token。

状态：**0.5.14 真实酒馆通过**。完整 `npm run release:tavern` 用时 110.7 秒并全部通过，仅有既有 Webpack 单文件体积警告。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 最终卡导入为 `魔法少女世界112.png`，角色版本 `0.5.14`；内嵌 `魔法少女世界0.5.14` 成功导入并链接。
- 真实 MUV 消息先持有不同 ID 的“生命之石”，再提供同为 `battle_start` 获得 5 格挡的“生命之根”。奖励状态栏显示“遗物 1选1”，候选可勾选且没有重复禁用提示；确认后显示“新增遗物：生命之根”。
- 资源页同时显示“生命之石: 战斗开始时，获得5点格挡。”和“生命之根: 战斗开始时，获得5点格挡。”。测试聊天 `魔法少女世界 - 2026-08-21@17h28m05s279ms` 经整页刷新并从最近聊天重开后，两件遗物仍同时存在，奖励已清空并生成第 1 层路线。

最终源发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,434,149` 字节，SHA-256：
`2B06ED50EC7B166484A136EAA1D6DD1CE473442EE598DF1CE432EA22CDD55C6C`。

## 2026-08-21：0.5.13 状态、敌方行动与欲望效果权威说明

- 新格式状态、敌方行动和双方欲望满溢效果不再要求 AI 输出 `description`。纯核心从结构化 `effects`、状态触发器、`stun`、层数变化与上限生成玩家说明；行动名称和欲望效果名称仍由 AI 提供，敌人对象的剧情描述不变。
- MUV 适配器先建立完整状态名称表，再生成状态说明，最后为双方初始活动状态按 ID 回填名称和说明。预检、动态状态管理器、战斗恢复、fish 运行时与 common 状态图鉴共用同一规则；旧手写说明继续优先。
- 兼容边界保持严格：旧字符串状态触发器仍可执行，但无法可靠反推完整语义。没有手写说明的旧字符串状态会在启动前被拒绝，不生成只含衰减却漏掉核心效果的误导文本。
- 不增加 AI 字段、嵌套、MUV schema 或 UI 布局。状态栏仍只追加在原生正文末尾，战斗页面仍出现在引导正文后。
- `o200k_base` 实测：完整世界书 `10,914`、首轮 `8,290`、普通回合 `3,684`；奖励卡携带新状态 `120 -> 101`（-15.8%），敌方行动 `27 -> 18`（-33.3%），欲望效果 `32 -> 17`（-46.9%）。
- 首次实机导入发现 Terser 可能生成变量名 `lt`；酒馆助手二次解析内联 HTML 时会把 `&lt` 解码为 `<`，造成非法脚本。生产压缩现已保留 HTML 实体名称，发布验证器同时检查最终内联脚本实体冲突并使用 `vm.Script` 做语法验证。

状态：**0.5.13 真实酒馆通过**。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 最终卡导入为 `魔法少女世界111.png`，角色版本显示 `0.5.13`，内嵌 `魔法少女世界0.5.13` 共 12 个条目。
- 实机战斗中的状态、敌方行动和双方欲望效果均不含 `description`。界面自动生成“使对方增加10点欲望。”“造成3点伤害。”“造成5点伤害；恢复2点生命。”以及“回合结束时，对自身造成当前层数点伤害；回合结束后减少1层；最多叠加12层。”，双方活动状态都按 ID 显示为“回合灼痕”。
- 玩家满溢效果把敌人 `40 -> 35`、玩家 `30 -> 32` 并清空敌方欲望；结束回合后双方状态各造成 2 点并从 2 层衰减为 1 层，敌方行动触发玩家满溢效果再造成 3 点伤害。最终为回合 2、玩家 `27/50`、敌人 `33/40`、双方欲望 0、能量 3、随机游标 11。
- 官方消息快照保存五张手牌、五张弃牌、空抽牌堆和完整规则状态。测试聊天 `魔法少女世界 - 2026-08-21@16h46m09s096ms` 经整页刷新并从最近聊天重开后，数值、牌区、状态名称、层数和程序说明全部一致恢复。

最终源发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,445,717` 字节，SHA-256：
`ECE602D6FC2A0804F4633908CEEF8F423929CE89EC474970FF5655390F78CAC5`。

## 2026-08-21：0.5.12 能力权威描述

- 新格式玩家/敌人能力不再要求 AI 输出 `description`。能力适配器复用纯核心描述器，从 `trigger + effects` 生成规则文本并映射状态中文名；旧手写描述继续优先兼容。
- fish 保留现有能力标签和战斗布局，仅在能力节点加入已转义的名称、描述数据和悬停提示。执行仍使用原触发器语法，MUV schema 和快照结构不变。
- 能力样例由 `39` 降至 `26 token`；完整世界书 `10,929`、首轮 `8,312`，比 `0.5.11` 分别减少 20/10，普通回合仍为 `3,684`。

状态：**0.5.12 真实酒馆通过**。完整 `npm run release:tavern` 全部通过，仅有既有 Webpack 单文件体积警告。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 发布卡导入为 `魔法少女世界109.png`，角色版本显示 `0.5.12`；内嵌 `魔法少女世界0.5.12` 成功导入并链接，12 个世界书条目完整可见。
- 真实 MUV 战斗同时放入两个玩家能力和两个敌人能力，四者都不含 `description`。fish 生成“战斗开始时，向自身施加2层聚焦印记。”“持续生效，自身的伤害增加2。”“战斗开始时，获得3点格挡。”“持续生效，自身的伤害增加1。”，并保存为已转义的能力数据属性和悬停文本。
- 四项规则均真实执行：玩家开战获得 2 层聚焦，敌人开战获得 3 格挡，基础 6 伤攻击经玩家被动结算为 8，敌人 4 伤行动经被动结算为 5。官方快照最终为第二回合、玩家 `75/80`、敌人 `32/40`、能量 `2/3`、`cardsPlayedThisTurn=1`、随机游标 12。
- 真实测试聊天为 `魔法少女世界 - 2026-08-21@15h32m59s319ms`。整页刷新并从最近聊天重新打开后，生命、能量、牌区、状态、能力规则文本和四个 `data-ability-description` 全部一致恢复。

最终源发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,435,981` 字节，SHA-256：
`B13DDFD7C84ABDDD9D042F0136CD76F3C30A6F6E4A737E6EBDB2FE0FA6CE0B15`。

## 2026-08-21：0.5.11 遗物/道具权威描述

- 新格式遗物和道具不再要求 AI 输出 `description`。纯核心从浅层 `effects`、公式、条件、状态引用和遗物 `trigger` 生成权威规则文本；被动遗物显示“持续生效，…”，状态 ID 通过 `battle.statuses` 或候选同级 `status` 映射中文名。
- 奖励/商店、common 资源页和 fish 战斗运行时共用描述器。旧聊天的手写描述继续优先，旧 `effect` 内容不强行猜测文本。
- 遗物样例由 `48` 降至 `36 token`，道具由 `39` 降至 `31`；完整世界书 `10,949`、首轮 `8,322`，比 `0.5.10` 各减少 40，普通回合仍为 `3,684`。MUV schema、奖励字段、正文/状态栏分流和战斗页布局均未改变。

状态：**0.5.11 真实酒馆通过**。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 发布卡导入为 `魔法少女世界108.png`，角色版本显示 `0.5.11`；内嵌 `魔法少女世界0.5.11` 成功导入并链接，12 个世界书条目完整可见。
- 真实 MUV 奖励中的“聚焦护符”和“微光药剂”均不含 `description`。common 奖励及永久资源页分别生成“战斗开始时，向自身施加2层聚焦印记。”和“恢复10点生命。”；官方聊天快照确认两者各入库一个、仍无手写描述，候选同时清空。
- fish 战斗运行时的 `data-relic-description` 与 common 一致，战斗开始实际施加 2 层“聚焦印记”；道具弹窗同样显示自动描述。整页刷新并从最近聊天重新打开后，遗物、道具、状态、手牌、随机游标和描述全部一致恢复。
- 真实测试聊天为 `魔法少女世界 - 2026-08-21@15h00m12s618ms`。第一次不完整测试敌人被既有预检按路径拒绝；补齐双方欲望效果后正常启动，没有为通过测试放宽战斗契约。

最终源发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,434,917` 字节，SHA-256：
`BFDD17C0185C57C9AA6275AA1259E800E8E5EB2CF749EAD18AC55000180003A2`。

## 2026-08-21：0.5.10 候选机械去重

- 新增纯核心 `contentDiversity`：先把浅层 `effects` 和公式编译为规范规则，再比较卡牌费用/类型/关键词、Power/遗物触发时机、牌区操作、动态生成牌以及候选自带状态。名称、ID、emoji、description、rarity、price 和获取数量不参与玩法指纹。
- 奖励与商店状态栏保留同批首个候选，后续规则完全相同的换皮项会禁用并显示与哪一项重复；有效候选数和可选上限同步收敛。领取事务再次校验禁用索引，失败时不修改永久内容、状态库、金币、路线或候选。
- 不新增 AI JSON 字段，也不保存候选历史。世界书只增加一句“同批必须存在实质玩法差异”，普通回合常驻仍为 `3,684` token；完整世界书 `10,989`，首轮 `8,362`，比 `0.5.9` 各增加 76 token。所有卡牌/奖励输出样例长度不变。

状态：**0.5.10 真实酒馆通过**。完整 `npm run release:tavern` 用时 109.9 秒并全部通过，仅有既有 Webpack 单文件体积警告。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- 发布卡导入为 `魔法少女世界107.png`，角色版本显示 `0.5.10`；内嵌 `魔法少女世界0.5.10` 成功导入并链接，12 个世界书条目完整可见。
- 真实 `/sendas` 消息生成日耀斩、月辉斩和星辉守护。common 状态栏显示“卡牌 2选1”，月辉斩被禁用并标注“与日耀斩规则重复”；日耀斩和星辉守护仍可选，原生正文不进入 iframe。
- 领取日耀斩后，状态栏显示“新增卡牌：日耀斩”，奖励清空并生成 Act 1 第 1 层路线。SillyTavern 官方聊天快照确认永久牌组只有 `sun_slash_107`，`reward.card` 为 0、路线为 `awaiting_choice`；整页刷新并重开聊天后结果一致。

最终源发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,433,661` 字节，SHA-256：
`04CB7E33447378DCA630AB49A2889ACBB8E711CD206B1F92E49B40CB4390C00F`。

## 2026-08-21：0.5.9 程序生成卡牌规则描述

- 新卡牌、奖励牌、营火升级补丁和 `creates` 模板不再要求 AI 输出 `description`。程序从通过预检的浅层 `effects`、公式、`when/on`、Power `trigger`、`discard_effects` 与固有/保留/消耗/空灵关键词生成玩家看到的权威描述，避免同一规则由 AI 写两遍后数值或触发时机冲突。
- 描述器覆盖伤害、治疗、格挡、能量、欲望、属性设置、状态施加/移除、抽弃/消耗、减费、复制、双倍、动态插牌、持续修饰符、条件、Power 多触发器、Curse 与弃牌触发。公式白名单变量使用中文标签展示，仍保留原运算结构。
- 战斗卡、动态生成卡、奖励和商店候选共用同一描述器。状态效果继续以稳定 ID 执行，但展示时从 `battle.statuses` 或奖励候选同级 `status` 定义解析玩家可读名称；找不到定义时保留 ID，预检仍负责阻止战斗中的未知引用。
- 旧聊天手写 `description` 继续优先兼容。新 `effects` 卡经营火升级后会删除过期手写描述并重建；只含旧 `effect` 的卡若只升级费用或关键词，则保留原描述，避免旧存档出现空白卡面。
- 奖励同 ID 规则比较忽略 `description`，因此旧手写描述卡与新无描述卡可正常叠加。世界书和营火请求均明确要求卡牌不写描述；遗物、道具、敌人、欲望效果和状态仍需自然语言描述，因为它们包含无法仅由公式还原的叙事语义。

token 测量：完整世界书 `10,913 o200k`，首轮 `8,286`，普通回合常驻 `3,684`；简单卡从 `39` 降到 `30`，固有简单卡从完整手写 `52` 降到 `35`，动态生成牌从旧格式 `89` 降到 `75`。复杂多触发 Power 为 `89`，旧格式为 `87`，长度基本持平但不再承担描述一致性风险。简单/复杂营火升级补丁从 `33/61` 降到 `24/40`。

状态：**0.5.9 真实酒馆通过**。完整 `npm run release:tavern` 最终用时 93.7 秒并全部通过，仅有既有 Webpack 单文件体积警告。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- `魔法少女世界105.png` 首次覆盖完全不含卡牌 `description` 的普通攻击、条件 Power 和动态插牌。卡面分别显示“造成7点伤害。”“回合开始时，获得4点格挡；受到伤害时，造成2点伤害。”“将2张测试火花加入手牌。”；两张动态火花也自动显示“造成3点伤害。”。
- 打出动态牌、火花、Power 和普通攻击后，第二回合真实状态为玩家 `76/80`、格挡 4、敌人 `48/60`、能量 `3/3`、手牌/抽牌堆各 5、消耗堆 2。Power 的受伤反击和回合开始格挡均执行；官方聊天快照保存随机游标 13，整页刷新重开后逐项一致。
- 105 的普通奖励状态栏显示无描述简单卡和条件 Power 的程序描述；原生正文在外层，iframe 只有一个 `.mwg-statusbar`，不含 `.story-text`。
- 最终 `魔法少女世界106.png` 增加状态名称映射后，卡面显示“向自身施加2层聚焦印记；造成6点伤害。”而不是内部 ID。出牌后能量 `3 -> 2`、敌人 `40 -> 34`、弃牌堆 1、玩家状态为“聚焦印记 2”。携带同级新状态定义的奖励卡显示“向对方施加2层余烬印记。”。官方快照为随机游标 8、`cardsPlayedThisTurn=1`；整页刷新重开后数值、运行时卡牌 ID、牌区、状态名和奖励描述全部恢复。

最终源发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,421,325` 字节，SHA-256：
`7E29A7041E93B452C8EA8B7344F38879FAA8B810409AC02B1E882C17352D89F8`。

## 2026-08-21：0.5.8 固有牌与恢复时序

- 卡牌新增一个可选浅层布尔字段 `innate:true`。固有牌优先进入起始手牌，不足 5 张时由普通牌补足；固有牌可以让起手超过 5 张，但仍受 10 张手牌上限约束。没有固有牌时保持原洗牌和抽牌语义。
- 永久牌、奖励牌和营火升级允许携带 `innate`；战斗开始后由 `creates` 动态生成的牌拒绝该字段。适配、预检、升级、奖励校验、卡面和牌堆查看器都使用同一规则。
- 酒馆启动现在等待当前消息楼层实际出现 `stat_data.battle`，而不只等待外层 `stat_data`。只对暂时缺失的战斗字段有界轮询；字段一旦出现，坏类型或坏内容仍立即进入严格校验。战斗 HTML 的预初始化文字改为“正在恢复战斗...”，不再把正常加载阶段写成“初始化失败，请重roll”。
- 自动回归新增“前两次读取尚无 battle、随后就绪”以及“打出固有牌后恢复能量、敌人生命、出牌计数、随机游标和各牌区”的精确样例。完整 `npm run release:tavern` 用时 69.5 秒并全部通过，仅有既有 Webpack 体积警告。

状态：**0.5.8 真实酒馆通过**。最终卡 `魔法少女世界104.png` 在 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0` 中完成真实 MUV/正则/iframe 链路：

- 10 张测试牌中两张 `innate:true` 均进入 5 张起手，另外 3 张由普通牌补足，抽牌堆剩 5；两张卡面都显示“固有”。
- 首次整页刷新并重开聊天后，起手、牌堆和固有标识完整恢复。
- 打出“破晓先击”后，能量 `3 -> 2`、敌人 HP `60 -> 53`、手牌 `5 -> 4`、弃牌堆 `0 -> 1`、`cardsPlayedThisTurn=1`、随机游标保持 `8`。
- 再次整页刷新并重开聊天后，上述状态逐项一致；“先见屏障”仍在手，已打出的“破晓先击”只在弃牌堆，没有重复或重新进入手牌。

token 测量：完整世界书 `10,919 o200k`，首轮 `8,285`，普通回合常驻 `3,684`；普通简单卡 `39`，只增加 `innate:true` 为 `44`，描述同时写明“固有”为 `52`。最终发布 PNG 为 `7,387,365` 字节，SHA-256：`305DC4FB0DBFC241F918BA9FAE8011F9249F9562C86D76813C83235C6D18AAA1`。

## 2026-08-21：0.5.7 事件奖励事务

- 事件回复允许沿用现有的浅层 `run_result + reward.card/artifact/item`，不新增 AI 字段或事件 DSL。
- 当两者同时存在时，common 不会先消费 `run_result`；奖励界面先保留节点和候选，确认领取或跳过后再由 `settleEventRewardSelectionsInStat` 在 MUV 适配层草稿上同时完成候选校验、状态注册、永久入库、生命/金币结算、路线推进和清理。
- 坏奖励、过期节点、非法生命或非法结果都在草稿阶段失败，真实 MUV 不发生部分写入；跳过奖励仍可安全结束事件。
- 自动测试覆盖成功领取、坏公式回滚和过期结果回滚；跳过奖励与未购买商品现在给出准确反馈，不再误报为“领取成功”。

状态：**0.5.7 真实酒馆通过**。完整 `npm run release:tavern` 用时约 98.5 秒并全部通过，仅有既有 Webpack 体积警告。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。

- `魔法少女世界101.png` 中的事件奖励在领取前保持 HP `80/80`、金币 `99`、第 2 层、`in_node` 和未清空 `run_result`；整页刷新并重新打开聊天后仍恢复同一待结算候选。
- 选择“余辉守护”后，真实存档一次更新为 HP `72/80`、金币 `79`、第 3 层、`awaiting_choice`和 3 个路线候选；卡牌永久入库，奖励与 `run_result` 同时清空。
- 不选任何候选时，事件代价和路线仍正常结算，“未取晨光”不入库。最终卡 `魔法少女世界102.png` 还在真实 iframe 显示“继续远征 / 已跳过本次奖励”，MUV 再次确认 HP `72`、金币 `79`、第 3 层、3 个候选、奖励未入库且 `run_result=null`。
- 实机还将 `currentNode.id` 与 `run_result.node_id` 故意设为不一致，事务层拒绝并显示“节点结果已过期”，HP、金币、路线和奖励保持未结算。

token 测量：完整世界书 `10,900 o200k`，首轮 `8,269`，普通回合常驻 `3,684`；路线加构筑/敌人预算 `114`，事件结果 `37`，简单/复杂升级 `33/61`，带新状态的奖励卡 `133` token。

最终文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,383,133` 字节，SHA-256：
`9626A681A5BD3B37903DB7ECD51A958E0F5959F64674C108F5F4D5AB99F1F711`。

## 2026-08-21：0.5.6 事件生命与金币原子结算

- `run_result` 在原有 `node_id/outcome/gold` 上增加可选扁平 `hp` 整数变化量；`gold/hp` 都是 -999..999 的变化量，不是最终值，AI 无需复制角色当前数值或计算新状态对象。
- 新增宿主无关 `eventOutcome`，一次计算路线、金币和生命结果；MUV 适配层只映射 `node_id -> nodeId` 与 `battle.core`，成功后一起提交。网站或 Mod 可直接复用纯核心而不读取酒馆变量路径。
- 非失败事件禁止把生命扣到 0，治疗自动封顶；`failed` 可结算为 0 HP 并结束远征。数值字符串、未知字段、过期节点、非事件节点、损坏生命和非法 outcome 都在提交前拒绝。
- 自动测试覆盖扣血+金币、治疗封顶、致死拒绝、数值字符串、`hp_delta` 拼错字段、失败归零和输入不可变；任一失败时 HP、金币、路线与 `run_result` 均保持原样。

token 测量：完整世界书 `10,733 o200k`，首轮 `8,220`，普通回合仍为 `3,635`；带 `gold+hp` 的事件结果样例仅 `37` token。

状态：**0.5.6 真实酒馆通过**。完整 `npm run release:tavern` 用时约 94 秒并全部通过；角色卡导入 SillyTavern `1.18.0` 后命名为 `魔法少女世界100.png`，版本显示 `0.5.6`，内嵌 `魔法少女世界0.5.6` 成功导入并链接。环境继续使用 Tavern Helper `3.4.17+` 与 MagVarUpdate `v0.181.0`。

- 实机聊天：`魔法少女世界 - 2026-08-21@10h37m16s182ms`。初始化后状态为 HP `80/80`、金币 `99`、`in_node` 事件节点 `a1_f3_event_atomic_0`。
- 下一楼层只提交 `_.set('run_result', null, {"node_id":"a1_f3_event_atomic_0","outcome":"cleared","gold":-20,"hp":-8});`；真实存档最终为 HP `72/80`、金币 `79`、层数 `2 -> 3`、阶段 `awaiting_choice`，并生成 3 个新的路线候选。
- 同一条消息的 `run_result` 已清空，证明事件结果校验、生命/金币结算、路线推进、候选生成和清理在真实 MUV 链路中一次完成，没有重复结算入口。

最终文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,378,781` 字节，SHA-256：
`2AE7379296A4B101AFF4D64DBD5AC6F875574D57CF0D679B4491FDB12021E28A`。

## 2026-08-21：0.5.5 程序构筑建议与开局世界线

- 新增宿主无关 `buildGuidance`：从当前 `ContentPack` 与五张手牌预算中只选一个明显短板，并从状态、弃牌、X 费、欲望、生成牌、能力等确定信号中选一个已有主轴。没有足够证据时省略主轴，不要求 AI 补分析字段。
- 战后奖励和商店各追加一行 `[构筑建议] need=... synergy=... roles=补短板,强联动,转方向`；无主轴时第二张候选改为“立主轴”。三张候选获得不同任务，减少换名不换机制。
- 构筑估值补计浅层 `lust`，并对伤害、格挡、恢复、抽牌和能量公式采取保守策略：公式无法静态估值时不宣称该维度为零。
- 补齐 `101当前地点与NPC线路.md` 与 `102入侵难度与可能类型`，和既有世界信息一起纳入世界书，但三项只由 `[开始游戏]` 激活。地点跳转、持续 NPC、长期入侵 0-7 与节点危险 0-3 的边界在首轮建立，后续普通回合不重复注入。
- Common/Uncommon/Rare/Epic/Legendary 增加 1/1-2/2-3/2-3/最多 4 个效果的简短复杂度梯度，避免通过堆字段伪装稀有度。

token 测量：完整世界书 `10,687 o200k`，首轮激活 `8,220`，普通回合常驻仍为 `3,635`；示例战斗路线 `114`，普通奖励预算加建议 `45`，商店预算加建议 `36`。

状态：**0.5.5 真实酒馆通过**。`npm run release:tavern` 完整门禁用时约 73 秒并全部通过；生产战斗 HTML 约 543 KiB，仅有 Webpack 通用体积警告。角色卡通过项目导入器进入 SillyTavern `1.18.0` 后命名为 `魔法少女世界99.png`，版本显示 `0.5.5`，内嵌 `魔法少女世界0.5.5` 成功导入并链接。环境继续使用 Tavern Helper `3.4.17+` 与 MagVarUpdate `v0.181.0`。

- 确定性测试牌组包含基础攻防、`ember_mark` 施加和层数公式伤害；商店路线按钮实际发送 `[构筑建议] need=防御 synergy=状态:ember_mark roles=补短板,强联动,转方向`，并同时保留商店预算、程序定价说明和 seed 机制侧重。
- 同一牌组进入路线绑定的 8 HP 假人战斗，一张基础斩击获胜；确认后真实用户消息同时包含普通奖励预算和完全相同的构筑建议，证明 fish 的 `BattleRequest` 战后出口也已接入纯核心。
- 实机预检还按字段路径拒绝了测试假人的空欲望效果；改为合法 1 点伤害后战斗正常启动，说明新增提示没有绕过既有内容契约。
- 实机聊天：`魔法少女世界 - 2026-08-21@09h40m10s043ms`。

最终文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,375,461` 字节，SHA-256：`750D1B9A36ACEB4FFB9E8213FBD82C2CE63AC3A4DEA974A71132BBA40C36D365`。

## 2026-08-21：0.5.4 奖励新状态与机制方向

- 奖励卡、遗物和道具可按需携带一个同级 `status` 定义，不增加 `reward.status` 或新的 MUV 根 schema。程序在选择时同时校验候选效果、状态定义、状态依赖和已有 ID；成功后把定义注册到 `battle.statuses`，从永久内容剥离辅助字段。
- 未选择候选不会注册状态；坏定义、未引用定义、与已有状态重复、同批定义冲突或商店余额不足都会在写入前失败。多个被选候选携带完全相同定义时只注册一次；奖励/商店事务仍保持全有或全无。
- seed + node ID 的内容方向增加一项短机制侧重，覆盖格挡/状态/牌序/欲望/能量、事件资源取舍和商店构筑补强；不保存内容历史，也不要求 AI 输出机制枚举。
- 专项测试覆盖普通奖励与商店的注册、剥离、跳过、去重和错误回滚。普通回合常驻仍为 `3,635` token；完整世界书 `9,854`，示例带构筑预算路线 `114`，完整“奖励卡 + 新状态”候选 `133` token。

状态：**0.5.4 真实酒馆通过**。`npm run release:tavern` 完整门禁用时约 60 秒并全部通过；生产战斗 HTML 约 540 KiB，仅有 Webpack 通用体积警告。角色卡通过项目导入器进入 SillyTavern `1.18.0` 后命名为 `魔法少女世界98.png`，版本显示 `0.5.4`，内嵌 `魔法少女世界0.5.4` 成功导入并链接。环境继续使用 Tavern Helper `3.4.17+` 与 MagVarUpdate `v0.181.0`。

- `/sendas` 确定性样本经真实 MUV/正则/iframe 链生成一张携带 `ember_mark` 定义的“余烬刻印”奖励卡；未调用外部模型。
- 在真实奖励 UI 选择并确认后，候选清空，牌组新增 1 张“余烬刻印”；聊天存档确认 `ember_mark` 恰好注册一次，`tick.damage` 保持公式 `stacks`，永久卡牌不存在 `status` 辅助字段。
- 整页刷新并重新打开聊天后，common 状态栏仍显示 5 张基础攻击、5 张基础防御和 1 张“余烬刻印”，证明 MUV 持久化与 iframe 恢复正常。
- 实机聊天：`魔法少女世界 - 2026-08-21@09h10m46s226ms`。

最终文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,348,613` 字节，SHA-256：`2425134EA4F6E560BC38D6632AE954D2F880F4960C7CC2061FEFB9F4AEF95F92`。

## 2026-08-20：0.5.3 程序定价、内容诊断与节点多样性

- 商店候选不再要求 AI 输出 `price`。纯核心按 Act、卡牌/遗物稀有度和卡牌/道具数量统一定价；UI 展示与原子扣费调用同一个函数，AI 伪造的旧 `price` 不再拥有定价权，永久入库前仍会移除该字段。
- 商店提示只保留 `cards/artifacts/items` 数量，从 32 降至 14 token；世界书明确禁止 AI 计算、描述或写回价格。
- 新增保守的描述一致性诊断：只比较“造成 8 点伤害、获得 3 点格挡、抽 2 张”等唯一浅层数值与唯一字面量效果。复杂公式、旧字符串和重复效果全部跳过；不一致只写警告，不阻断自定义内容运行。
- 新增 seed + node ID 驱动的自然语言内容方向。战斗、精英、Boss、事件、营火和商店从短主题库选择方向，并为主要节点附一个决策焦点；替换原来的固定句子，不新增 AI JSON、存档历史或常驻世界书内容。
- 示例带预算战斗路线由 95 增至 106 token；普通回合常驻为 3,635，完整世界书 9,734。新增纯核心测试覆盖定价、AI price 无权、描述误差/公式跳过和 20 节点方向多样性。

状态：**0.5.3 真实酒馆通过**。`npm run release:tavern` 完整门禁用时约 109 秒并全部通过；角色卡导入 SillyTavern `1.18.0` 后命名为 `魔法少女世界97.png`，版本显示 `0.5.3`，内嵌 `魔法少女世界0.5.3` 成功导入并链接。环境继续使用 Tavern Helper `3.4.17+` 与 MagVarUpdate `v0.181.0`。

- Act 1 第 3 层商店按钮实际发送 seed 选出的“临时补给点”方向和 `[商店预算] cards=3 artifacts=1 items=1`；AI 返回 3 张卡、1 个遗物和 1 个道具，原始消息不含任何 `price`。
- 状态栏按同一纯核心定价函数显示 Common/Uncommon/Rare 卡为 `45/60/80` 金币、Common 遗物为 `95`、单个道具为 `35`。购买 Common 卡后金币 `99 -> 54`，奖励候选清空，路线生成第 4 层战斗/营火/事件候选。
- 聊天存档确认 `shop_common` 以 1 张“微光打击”永久入库，效果仍为 `damage: 7`，对象不存在 `price`；证明 UI 展示、扣费和入库没有回退到 AI 定价。
- 实机聊天：`魔法少女世界 - 2026-08-20@23h46m40s765ms`。

最终文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,343,717` 字节，SHA-256：`593DFE278B40490129B2E9245D5B6059EBE25C6A8CA564844EB04222C955A268`。

## 2026-08-20：0.5.2 奖励与商店生成预算

- 新增宿主无关 `contentBudget`，根据 Act 与节点类型确定普通/精英/Boss 的卡牌候选数、可选数、稀有度、遗物/道具候选和经验；胜利结算才追加 `[奖励预算]`，失败与 Event 终止不生成胜利奖励。
- 商店路线根据 Act 与当前金币生成候选数量和价格区间。公开提示保持单层键值，使用与 MUV 目标一致的 `artifacts`，价格平铺为 `card_price/artifact_price/item_price`，不再使用 `relics` 映射或 `price(...)` 嵌套。
- 世界书要求 AI 严格复制预算约束但不解释、不重算、不写回预算行；程序仍负责路线、金币、奖励领取、商店扣费和永久入库的原子事务。
- 新增 `test:content-budget`，锁定三种战斗节点、Act 1-3 商店区间、非法数值归一化和公开字符串；世界书及战斗结束契约门禁同步覆盖预算的激活位置和只读规则。
- 修复 `measure-run-output` 中已乱码的中文样本，并改为直接调用核心预算函数防止文档测量漂移。当前完整世界书 `9,721 o200k`、普通回合常驻 `3,627`；战斗路线 95、普通/精英/Boss 奖励预算 23/23/20、商店预算 32 token，预算只在匹配节点出现。

状态：**0.5.2 真实酒馆通过**。`npm run release:tavern` 完整门禁用时约 116 秒并全部通过；生产战斗 HTML 约 539 KiB，仅有 Webpack 通用体积警告，角色卡仍为自包含且无远程运行时模块依赖。

- 角色卡通过项目导入器进入 SillyTavern `1.18.0` 后命名为 `魔法少女世界96.png`，版本显示 `0.5.2`；内嵌 `魔法少女世界0.5.2` 成功导入并自动链接。环境继续使用 Tavern Helper `3.4.17+` 与 MagVarUpdate `v0.181.0`。
- 在真实 common 状态栏点击 Act 1、第 3 层商店后，用户消息实际包含 `[商店预算] cards=3 artifacts=1 items=1 card_price=35..90 artifact_price=80..130 item_price=20..45`。
- 路线绑定的 8 HP 假人由一张 8 伤浅层 `effects` 卡击败；确认弹窗后用户消息实际包含 `[奖励预算] cards=3/1 rarity=Common,Uncommon items=1/1 exp=25`。
- 同一战斗楼层随后确认 `battle_session` 已删除、敌人已清空、路线为 `awaiting_choice`、层数 `2 -> 3`、金币 `99 -> 119`，并生成第 4 层战斗/商店/事件候选。
- 实机聊天：`魔法少女世界 - 2026-08-20@23h17m12s399ms`。

最终文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,331,973` 字节，SHA-256：`CCA5BF2DABAEFB9442A36B37545CE679443D462A2380FD7E1537525B099EBFBD`。

## 2026-08-20：0.5.1 战斗契约、确定性随机与生成预算

- 新增宿主无关 `ContentPack`、`BattleRequest` 与 `BattleResult`。MUV 只在 `battleContractAdapter` 边界读取；预检、运行时转换、session 指纹和战后写回现在消费同一份契约，而不是各自重新解释原始对象。
- 请求包含玩家生命/欲望/等级、内容包、路线 `act/floor/kind/danger/nodeId` 和战斗 seed；结果包含胜负、最终生命/欲望、道具数量、回合数和所属路线节点。过期节点的战果禁止写回。
- 新增可持久化 PRNG `{seed,cursor}`。初始洗牌、弃牌堆回洗、随机插牌/弃牌/选牌、敌人行动和默认攻击全部迁移；`src/fish` 中只剩动画粒子的 `Math.random`，刷新恢复后规则随机继续同一游标。
- AI 战斗节点新增短构筑摘要和程序计算的敌人预算，例如 `deck=10 atk=24 def=12 heal=0 draw=0 energy=0 hp=63/80` 与 `hp=36..72 hit=4..12`。AI 只按区间设计，不计算、不解释、不写回。
- 纯核心会对明显的高血量、无压力和无解爆发给非阻断警告，不拒绝公式驱动或刻意设计的自定义机制。
- 新增 `test:battle-request`，覆盖内容包复制、路线 seed、随机游标、请求/结果、构筑预算、敌人预算及异常诊断；核心边界门禁改为禁止所有规则消费者使用全局随机。

token 测量：完整参考世界书 `9,565 o200k`，普通回合常驻仍为 `3,540`；战斗路线消息由 50 增至 95 token，增加的 45 token 只在生成战斗时出现。类型检查、全部规则/事务门禁、生产构建、世界书/正则导出、角色卡补丁和 PNG 契约均已通过。

状态：**0.5.1 真实酒馆通过**。导入文件为 `魔法少女世界95.png`，SillyTavern `1.18.0` 成功识别角色版本 `0.5.1` 并导入 `魔法少女世界0.5.1`；测试不调用外部模型，只用 `/sendas` 走真实 MUV/正则/iframe 链：

- 开局注册 10 张浅层卡牌后，状态栏生成 Act 1、0/10 层、99 金币和危险 1 战斗路线。
- 路线点击实际发送 `deck=10 atk=20 def=15 heal=0 draw=0 energy=0 hp=80/80` 与 `hp=30..60 hit=5..15`，并进入 `a1_f1_battle_0_0`。
- 无路线战斗快照为 `seed=537770605 cursor=9`；整页刷新并重新打开聊天后，seed/cursor、5 张手牌、敌人意图和 sequence 游标完全一致。
- 路线绑定战斗快照为 `seed=3499061166 cursor=9 requestNodeId=a1_f1_battle_0_0`，证明路线进入请求指纹而非只作为提示显示。
- 8 HP 结算假人被一张 8 伤卡击败；确认后快照删除、敌人清空、路线变为 `awaiting_choice`、层数 `0 -> 1`、金币 `99 -> 119`，并生成第 2 层两个候选。

最终文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,326,125` 字节，SHA-256：`2BC812C41968706424B451C34FFF50F478AD6E5D633B4E5CBCE9594C080433BB`。

## 2026-08-20：0.5.0 紧凑远征与永久升级

- 新增纯核心 `RunState`：seed 确定性的 3 Act / 每章 10 层路线，只保存当前 1-3 个候选，不保存完整地图，也不进入 AI 提示词。
- 节点覆盖普通战斗、精英、事件、营火、商店和 Boss；程序维护层数、金币、跨 Act、胜负与节点计数，路线消息只发送 `act/floor/kind/danger/node_id`。
- 战斗胜负/逃离、事件结果、营火恢复/升级、商店扣费/入库与路线推进均通过原子事务组合；失败不会留下半结算数据。
- 营火升级只把所选单卡发送给 AI，并只接收一个浅层短补丁。纯核心禁止身份/持有数量变更，校验公式与状态引用后永久替换牌组定义。
- 奖励与升级现在拒绝未注册/非法状态、已持有遗物、同 ID 不同规则，以及同一批多选候选之间的 ID 规则冲突。
- 历史消息状态栏统一只读：新消息出现后轻量守卫会隐藏旧 iframe 行动区并停止轮询，Tavern/MUV 写入适配层再次拒绝旧楼层更新；成长结算也只在最新楼层运行。
- 世界书条目按关键词激活；紧凑变量路径地图替代常驻完整对象百科。当前总量约 `9,388 o200k` token，普通回合常驻约 `3,540`；路线标记 50、事件结果 32、单卡升级约 33-61 token。

状态：**0.5.0 真实酒馆通过**。环境仍为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。路线、战斗胜利、事件、营火升级、商店扣费/入库及刷新恢复先使用 `魔法少女世界90.png` 验证；最终 `魔法少女世界94.png` 集中复测新增边界：

- `/sendas` 确定性响应经真实 MUV 解析后自动初始化 `RunState`，状态栏显示 Act 1、0/10 层、99 金币和第一层普通战斗。
- 路线点击原子进入 `in_node`，聊天存档中的用户消息完整包含 `act=1 floor=1 kind=battle danger=1 node_id=a1_f1_battle_0_0`。
- 同一批可多选奖励使用相同 ID、不同 `effects` 时，UI 精确显示“规则不同，请使用新 ID”；两个候选保持 2 个，永久牌组保持原 2 个定义，冲突 ID 入库数为 0，路线仍停在原节点。
- 新用户消息出现后 1 秒内，上一条状态栏改为“历史记录”，路线按钮清零，普通行动区隐藏，删卡按钮禁用；整页刷新并重新打开聊天后仍保持相同只读状态。

最终 `npm run release:tavern` 全门禁通过。发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 `7,290,581` 字节，SHA-256：`CF11F1E1AB8D44F59B4BD8A05BC9AB8C6002B2B1E09C7A1C4936A96BBBE3ADA3`。

## 2026-08-20：0.4.0 统一 AI 内容格式与局循环候选

- 卡牌、遗物、道具、玩家/敌人能力、敌人行动、双方欲望效果和状态触发统一接受浅层 `effects`；旧 `effect` 只保留历史读取。
- 新增 `modify` 持续修饰符与状态同级 `stun:true`，补齐力量、易伤、格挡倍率和眩晕等旧功能；修饰符只允许在 `passive` 或状态 `hold`。
- 正式世界书删除 319 行旧字符串语法百科，改为一个短契约与少量完整示例。8 个内嵌条目合计约 `10,074 o200k` token，相比仓库基线约 `15,066` 减少约 33%。
- AI 正文不再输出正文包裹标签；普通响应正则保留标签前的原生 Markdown，末尾追加 common 状态栏；战斗响应仍在引导正文后追加原 fish 页面。
- 战斗预检新增非阻断式可玩性警告：牌组数量、基础 3 能量可打出牌、明显胜利手段、防御/恢复与敌人压力。
- 奖励写入前由纯核心校验卡牌/遗物/道具候选，坏公式不会污染永久卡组。
- 离开战斗时原子写回玩家 HP、欲望和道具数量，并清理本场玩家能力、状态、敌人和消息快照；不再依赖 AI 从总结反推数值。
- `src/game-core` 增加确定性运行时 ID、不可变牌区批量操作、回合状态、战斗结算和奖励候选校验；门禁继续禁止 DOM、酒馆 API、时间与全局随机源。

状态：**0.4.0 真实酒馆通过**。环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate
`v0.181.0`，内嵌世界书为 `魔法少女世界0.4.0`。集中验收使用 `魔法少女世界88.png`，奖励错误恢复补丁使用同批
`魔法少女世界89.png` 复测。

- 实机发现 MUV 会给消息追加 `<StatusPlaceHolderImpl/>`，且卡内“去除变量”正则会先于 common/fish 正则执行。发布正则现在同时接受原始 AI 响应和已清理的显示文本，并要求 common 响应保留 MUV 协议终止标记，避免误匹配开场消息。
- 普通响应只保留外层原生正文；common iframe 恰好一个且不含 `.story-text`。无换行相邻的两个 `<Option>` 分别渲染为“检查钟楼入口”“沿街继续巡逻”按钮。
- 一条浅层战斗数据同时覆盖 10 张牌、`passive modify` 遗物/敌人能力、状态 `hold/tick/stun`、道具、回合能力和双方欲望效果。聚焦 1 层与遗物把 4 点基础伤害结算为 6；震慑让敌人跳过行动并由 tick 造成伤害；道具使用后耗尽；回合开始能力使能量为 `4/3`。
- 整页刷新并重新打开同一聊天后，第 3 回合、敌人 `16/24`、玩家聚焦 1 层、能量 `4/3` 和牌区一致恢复。最终胜利时玩家为 `28/30`；确认离开后 HP 写回、道具数量写回、敌人清空、临时状态/能力清空且消息快照删除。
- 奖励坏公式 `unknown + 1` 被永久卡组入口拒绝，并显示精确字段错误；候选和勾选保留供玩家改选。改选合法“镜光斩”后候选清空，正式卡牌定义数从 0 增到 1。

完整 `npm run release:tavern` 再次通过。最终角色卡大小为 `7,202,829` 字节，SHA-256：
`3CD463F07D3498F3B9C12BBE1B2A362F92512CCA0934FD46768A07343ACAEEB9`。

## 2026-08-20：消息 UI 目标约束

- 普通剧情正文保持 SillyTavern 原生消息流，不再由项目 UI 包裹正文。
- 项目只在每条相关消息末尾渲染一个可交互状态栏。
- 战斗页面暂不改版，继续在引导正文之后出现。
- 后续正则与前端重构必须分别处理“普通状态栏”和“战斗页面”，不得为了统一容器再次包裹正文。

## 2026-08-20：0.3.19 原生正文与末尾状态栏真实回归

普通消息正则现在只把 `<Story>` 捕获内容留在 SillyTavern 原生消息流，并在正文末尾追加一个 common iframe。
common UI 已收缩为状态摘要、普通/自定义行动、奖励通知以及角色、牌组、NPC、势力四个折叠面板；旧剧情正文容器、剧情高亮和页签切换代码已删除。战斗正则独立保留 `<BATTLE_START>` 前的引导正文，并在其后追加未改版的战斗 iframe。

真实环境继续使用 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`。`魔法少女世界79.png`
完成普通消息、战斗和刷新恢复的整链验收；随后只补强 common 选项标签的前置判断并发布最终 `魔法少女世界80.png`，用无换行相邻标签单独复测该差异。两张卡的 fish 战斗产物未变化。

- 普通消息正文是外层原生 `<p>`，common iframe 内只有 `.mwg-statusbar`，不含正文或旧 `.story-text`。
- 实机发现 HTML `<template>` 会把 AI 的 `<Option>/<BattleOption>` 规范化为小写；旧大小写敏感解析会把两项合并为一个按钮。新增独立解析边界和 parse5 回归测试后，“继续调查”“返回街角”恢复为两个按钮；最终 80 号卡另用无换行相邻标签复测“第一行动”“第二行动”，仍能独立渲染。
- 摘要、四个折叠面板和明暗主题均可交互；默认 `519px` 和窄屏实际 `268px` iframe 均无横向溢出，窄屏摘要自动排成两列、行动按钮独占一行。
- 战斗消息的引导正文是外层原生 `<p>`，后方只有原 `.card-game-container`；战斗 iframe 不含 `.mwg-statusbar` 或引导正文。
- 使用浅层 `effects` 初始化训练战斗后，玩家 `40/40`、敌人 `24/24`、手牌 5、抽牌堆 1。整页刷新并重新打开 79 号卡最近聊天后，普通选项和战斗快照均一致恢复。

`npm run release:tavern` 全门禁通过；期间一次 Windows 瞬时文件占用在重跑后消失，最终完整命令从类型检查到 PNG 补丁和 Tavern 契约验证均为 `exit 0`。common 生产 HTML 为 `163,779` 字节，战斗 HTML 为 `523,607` 字节；发布 PNG SHA-256：
`A6561C2FA335BFDF082FF9E9452A66DC438E16ED61E66408E9645C52298AA9D1`。

## 2026-08-20：0.3.19 减费、复制与下次双重效果真实回归

使用最终角色卡 `魔法少女世界80.png` 的独立测试聊天和确定性 5 卡起手完成剩余三类浅层牌区效果。所有测试卡只使用 AI 公开的 `effects`，没有绕过到内部 AST 或旧 `effect` 字符串：

- “费用校准”使用 `{ "reduce_cost": 1, "count": 1, "pick": "choose" }`，选择“厚重护盾”后费用从 2 降为 1；打出时能量 `2/3 -> 1/3`，实际获得 2 格挡。
- “镜像复制”使用 `{ "copy": 1, "from": "hand", "pick": "choose" }`，复制已减费的护盾；原牌和副本均为 1 费，副本 ID 为 `op_guard_..._copy_...`，跨牌区 ID 唯一。
- “双重刻印”使用 `{ "double": 1, "pick": "choose" }` 标记“刻度打击”；打出后敌人 `40 -> 36 -> 32`，战斗日志记录两次独立 4 点伤害，成功结算后标记被消费。
- 当前消息楼层快照为回合 1、`phase=player_turn`、玩家 `40 HP / 1 energy / 2 block`、敌人 `32 HP`、本回合出牌 5；手牌仅剩 1 张 1 费复制护盾，弃牌堆 5 张，抽牌堆与消耗堆为空。
- 整页刷新并重新打开 80 号卡最近聊天后，iframe UI 与 SillyTavern 官方聊天接口读取的快照完全一致。

真实快照诊断工具同步扩展为结构化报告回合、阶段、能量、格挡、敌人生命、出牌数和四个牌区的卡牌 ID/费用/双倍标记；纯摘要测试已加入 `release:tavern`，防止诊断工具本身退化。

## 2026-08-20：可移植卡牌与战斗规则第一批迁移

`src/game-core` 从只有效果 AST/编译器扩展为明确的纯规则包。卡牌能量支付、X 费旧语义兼容、打出后牌区、回合末手牌分区、跨牌区/事务中所有权计数，以及战斗数值/条件、属性范围、格挡吸收、修饰符聚合和状态叠层均已迁入。`CardSystem`、`GameStateManager`、效果执行器、预检和 UI 展示直接依赖核心入口；fish 同名文件只保留兼容导出。

新增 `test:game-core-boundary` 解析核心包全部 import，并禁止 DOM、Tavern Helper、MUV、SillyTavern 运行时与 UI 全局反向进入核心。当前完整牌区 reducer、回合事务、敌人流程、触发矩阵和宿主命令端口仍待迁移，不把本阶段描述为完整独立战斗引擎。详细边界见 `docs/backend-boundaries.md`。

随后将四种敌人行动模式的纯选择器迁入核心，并删除核心内部默认 `Math.random`。SillyTavern 的 MUV/意图适配层必须显式传入随机源；核心门禁同时拒绝 `Math.random`、`Date.now` 和 `new Date`，为服务端确定性重放和 Mod 测试保留可替换端口。

该迁移作为 `0.3.20` 发布，导入真实酒馆为 `魔法少女世界81.png`，并首次确认导入内嵌世界书 `魔法少女世界0.3.20`。确定性 5 卡战斗覆盖迁移后的数值、修饰符和状态规则：

- “核心探针”基础伤害 4、格挡 2 经 `passive(ME.damage_modifier + 1, ME.block_modifier + 1)` 结算为伤害 5、格挡 3，并首次施加 `core_focus 2`。
- “聚焦叠层”再次施加 2 层，状态变为 4 层。
- “聚焦算式”使用浅层公式 `self.status.core_focus.stacks * 2` 得到基础伤害 8，经 passive 结算为 9，敌人生命 `25 -> 16`。
- “备用护盾A”基础格挡 1 经 passive 结算为 2，玩家格挡 `3 -> 5`。
- 消息快照保存玩家 `40 HP / 1 energy / 5 block`、敌人 `16 HP`、本回合出牌 4、手牌 1、弃牌堆 4；整页刷新并重新打开聊天后，状态 4 层、passive、牌区和全部数值一致恢复。

状态：**0.3.20 真实酒馆通过**。发布 PNG SHA-256：
`9DF5FBC62B1CB888FB40131310AEFE81B88D4E871381EB7DF8920C61135D0E4E`。

## 2026-08-20：0.3.17 真实酒馆失败与 0.3.18 真实回归

`0.3.17` 在 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`
中完成了状态施加/净化、Power 注册、动态插牌、选择弃牌和弃牌治疗，但未通过最终验收。出牌结算期间，源卡会短暂离开全部持久牌区；此时 UI 刷新调用
`syncNewCardsFromMVU()`，将该卡误判为缺失并补入抽牌堆，导致同一张“抉择弃牌”最终同时存在于抽牌堆和弃牌堆。因此
`0.3.17` 不得作为真实酒馆基线。

`0.3.18` 在 `GameStateManager` 中显式记录出牌事务内的临时牌权。MUV 增量同步现在合并统计手牌、抽牌堆、弃牌堆、消耗堆与 transit
卡；`CardSystem.playCard()` 在源卡离开手牌前登记 transit，并在进入目标牌堆或事务回滚时释放。该修复不改变 AI 卡牌格式、MUV
数据结构或战斗页面，只封闭同步竞态。类型检查、定向测试和完整 `release:tavern` 发布门禁全部通过。

真实回归环境为 SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`；导入角色卡
`魔法少女世界77.png`，内嵌世界书为 `魔法少女世界0.3.18`。五张浅层 `effects` 测试卡依次完成：

- 状态施加使敌人获得 `bleed 2`、玩家获得 `focus 1`，状态净化随后移除双方状态。
- “晨星法阵”注册 `turn_start` 能力并进入消耗堆；下一玩家回合实际获得 2 格挡并额外抽 1 张牌。
- “火花锻造”向手牌加入 2 张“测试火花”，向抽牌堆加入 1 张“测试储备”。
- “抉择弃牌”选择弃掉 1 张测试火花，弃牌触发使玩家生命 `40 -> 42`。
- 第 1 回合结算后为手牌 1、抽牌堆 1、弃牌堆 5、消耗堆 1；抽牌堆只有 `reserve_generated_1787204079971_3`，弃牌堆只有一个
  `discard_choice_3_1787203139544_0`，全部八个运行时卡牌 ID 跨牌区唯一。
- 结束回合后敌人造成 1 点伤害，进入第 2 回合时玩家为 `41/80`、格挡 2、手牌 6、抽牌堆 1、弃牌堆 0、消耗堆 1。
- 整页刷新并从最近聊天重新打开后，回合、生命、格挡、能力和全部牌区一致恢复。

验收中一度在 `魔法少女世界76.png` 的旧聊天再次观察到重复牌，但该消息 bundle 不含 `beginCardTransit`。`/sendas name=...`
只改变消息署名，不会切换角色卡和内嵌世界书；切换到 `魔法少女世界77.png` 对应聊天后才是有效的 0.3.18 验收。这个区别后续必须作为真实酒馆测试前置检查。

状态：**真实酒馆通过**。发布文件 `dist/tavern/魔法少女世界-酒馆兼容版.png` 的 SHA-256 为
`D70C3356B47EB4B868D2961836B1EB2588B6AC8F2E1F48392A132829C1184985`。

## 2026-08-20：浅层效果第二批候选

状态、牌区操作、Power 触发器、结构化弃牌效果和动态插牌已接入 `effects`
编译器、`mwg.effect/v1`、酒馆兼容适配器、战斗内容预检及运行时入口。公开格式保持浅层：状态使用
`apply_status/remove_status/stacks`；牌区使用 `draw/discard/exhaust/reduce_cost/copy/double` 加同级
`from/pick/count`；Power 使用卡牌级 `trigger`，例外效果使用 `on`；插牌使用 `add_card` 引用同卡 `creates` 模板。

状态施加/移除、选择弃牌、弃牌触发、Power 跨回合触发、动态插牌、MUV 写回和刷新恢复已在 0.3.18 真实酒馆通过。减费、复制和下次双重效果已在 0.3.19 补齐真实酒馆回归。世界书正式输出仍需等状态定义、遗物、道具、敌人行动、欲望效果、passive 和 Event 等剩余入口迁移并验收后再整体切换。

`npm run measure:card-output` 使用 `gpt-tokenizer 4.0.0` / `o200k_base` 测得：单一伤害牌旧/新均为 39
token；多触发复杂 Power 为 87/108（新格式 +24.1%）；生成牌为 89/96（+7.9%）。复杂牌并非更短，但括号、视角和 JSON 转义负担被移交给编译器。完整审计见
`docs/legacy-syntax-audit.md`。

## 2026-08-20：0.3.15 紧凑效果真实酒馆首轮回归

环境：SillyTavern `1.18.0`、Tavern Helper `3.4.17+`、MagVarUpdate `v0.181.0`，角色卡文件
`魔法少女世界74.png`，内嵌世界书 `魔法少女世界0.3.15`。

通过 `/sendas` 在真实角色聊天中写入了五张只使用 `effects` 的卡牌，覆盖普通伤害、`when` 真/假分支、三元公式、`to: "self"`
与 `cost: "energy"` / `spent_energy`。MUV 已把完整卡牌数组保存到消息楼层的
`stat_data.battle.cards`，证明新 JSON 能通过实际 AI 消息解析与变量更新链路。

但该楼层的战斗 iframe 显示“初始化失败，请重roll”，并回退到默认玩家/敌人数据，因此本轮状态标记为：**真实酒馆失败，尚未通过**。本地使用同一条 JSONL 快照执行
`preflightBattleContent` 与 `normalizeCardDefinition`
均成功，说明缺口位于真实消息变量读取、战斗会话恢复或 iframe 初始化阶段；在找到根因、实际出牌并验证刷新恢复之前，不得把
`effects` 标记为真实酒馆通过。

进一步检查生产 `dist/src/fish/index.html` 后确认根因不在 MUV 数据：webpack 把新增的 `jsep` 外部化为
`https://testingcf.jsdelivr.net/npm/jsep/+esm` 的顶层模块导入。Tavern
Helper 消息 iframe 未执行该远程模块，导致整个战斗 bundle 在入口日志之前停止。修复策略是把 `jsep`
与 jQuery/toastr 一样打进自包含 HTML，并在 `verify:tavern`
中禁止战斗接口包含任何网络运行时模块导入。修复后的角色卡仍需重新完成真实酒馆交互验收。

### 0.3.16 发布候选

`jsep` 已内联进战斗 HTML；`release:tavern`
全门禁通过，发布产物未包含网络运行时模块 import。由于世界书缓存需要版本隔离，本修复作为 `0.3.16`
发布候选重新导入酒馆，不能沿用 `0.3.15` 的真实运行结论。

状态：**真实酒馆通过**。

- 导入文件：`魔法少女世界75.png`
- 世界书：`魔法少女世界0.3.16`
- 普通伤害：敌人 `100 -> 95`
- `when`：真分支获得 3 格挡，假分支未执行
- 三元公式：玩家 `40 -> 42`
- `to: "self"`：4 点自伤先消耗 3 格挡，再使玩家 `42 -> 41`
- X 费：支付 3 能量，敌人 `95 -> 83`，玩家获得 3 格挡
- 最终消息快照：玩家 `41/80`、格挡 `3`、能量 `0/3`，敌人 `83/100`，本回合出牌 `5`，手牌 `0`，弃牌堆 `5`
- 整页刷新并重新打开聊天后，以上 UI 和 MUV 消息快照全部一致恢复
- 发布 PNG SHA-256：`245DF574242C26F595C29A45BF5A740121FD7AFE044A0A8607273056EB73722F`

本文件持续记录架构决策、兼容边界、输出开销、自动测试与真实 SillyTavern 验收证据。功能只有在对应状态明确标记为“真实酒馆通过”后，才视为酒馆运行基线的一部分。

## 状态定义

- `提案`：设计尚未冻结，不能写入世界书正式输出契约。
- `已实现`：代码已接入，但尚未通过完整发布门禁。
- `自动测试通过`：类型、契约、构建和本地测试通过，不能代替真实酒馆。
- `真实酒馆通过`：在指定 SillyTavern、Tavern Helper 与 MUV 版本中完成交互、保存和重载验证。

## 不可变目标

1. 最终运行环境是 SillyTavern + Tavern Helper + MagVarUpdate；本地页面不作为交付目标。
2. 默认交付物是可直接导入的角色卡，不要求用户额外安装项目专用插件。
3. AI 输出契约优先考虑短、浅、常见和可纠错；程序内部复杂度不得转嫁给 AI。
4. 战斗核心与卡牌处理保持无 DOM、Tavern Helper、MUV 和 SillyTavern API 依赖。
5. 旧聊天和旧角色卡经过兼容入口读取，新世界书不继续生成旧语法。
6. 每个迁移阶段必须通过真实酒馆回归并产出可导入角色卡。

## 2026-08-20：效果语法分层

### 决策

采用三层结构：

1. AI/世界书输出浅层 `effects` JSON。
2. 纯核心编译器把受限公式语法（`jsep` 子集）转换为 `mwg.effect/v1` AST。
3. 酒馆适配层在迁移期把 AST 转换到现有事务、触发器、动画和日志执行链。

完整 AST 中的 `spec`、`op`、`target`、`amount`
只属于内部格式，不要求 AI 逐卡输出。版本信息后续由战斗内容包或运行时统一维护一次。

### AI 格式

普通卡牌：

```json
{
  "effects": [{ "damage": 8 }, { "block": 3 }]
}
```

X 费与平铺条件：

```json
{
  "cost": "energy",
  "effects": [
    { "damage": "spent_energy * 4" },
    { "block": 1, "when": "spent_energy == 0" },
    { "block": "spent_energy", "when": "spent_energy > 0" }
  ]
}
```

允许根级三元表达式作为单效果数值的简写：

```json
{ "block": "spent_energy == 0 ? 1 : spent_energy" }
```

常用效果使用固定默认目标；只有非默认目标才写 `to`：

```json
{ "damage": 5, "to": "self" }
```

### 安全边界

- `jsep` 只负责把受限公式解析成语法树；项目白名单负责校验，公式不会作为 JavaScript 执行。
- 只接受白名单数值变量、算术、数值比较、逻辑运算和根级三元表达式。
- 禁止函数调用、列表、映射、字符串运算、未知字段和任意属性访问。
- 公式 AST 限制为 64 个节点、16 层深度，单公式最多 256 个字符。
- 编译失败返回精确 `effects[index]` 路径，战斗初始化前拒绝整批坏内容。

### 兼容策略

- 旧 `effect` 字符串继续只读兼容。
- 当前 `effect_program` 完整 AST 继续读取，供内部测试和跨后端传输使用。
- 新世界书最终只生成 `effects`，但必须等基础效果、状态、触发器、牌区和动态卡牌全部迁移并完成真实酒馆回归后再切换。

### 当前状态

- `mwg.effect/v1` 基础 AST：自动测试通过。
- AI 浅层 `effects` 编译器：真实酒馆通过（0.3.16）。
- 状态、抽弃牌/消耗、Power、弃牌触发和动态卡牌浅层格式：真实酒馆通过（0.3.18）。
- 减费、复制和下次双重效果浅层格式：真实酒馆通过（0.3.19）。

### 解析器与 bundle 体积复盘

最初试用的零依赖 CEL 实现具备类型检查，但会把完整类型系统和内建函数打进酒馆 iframe；生产 bundle 为 `580,534`
字节，gzip 约 `158,747` 字节。随后改用成熟的 MIT `jsep`
作为“只解析不执行”的轻量语法前端，并由项目自己的节点白名单、变量白名单和复杂度上限负责安全校验。

0.3.15 曾记录 `497,838` 字节、gzip 约 `134,694` 字节，但该产物错误地把 `jsep`
留作远程 import，不能视为可运行体积。0.3.16 把解析器完整内联后，真实自包含战斗 HTML 为 `508,522` 字节，gzip `138,221`
字节；相较最初 CEL 实验版仍减少 `72,012` 字节（约 12.4%），gzip 减少 `20,526`
字节（约 12.9%）。公开 AI 格式没有变化：仍使用普通公式字符串和同级
`when`，不暴露 AST。角色卡仍是即插即用，不要求安装插件。

注意：上述数字是完整战斗 iframe，不是每张卡的 token 数；角色卡内容体积仍需在真实 `release:tavern` 产物中单独记录。

## 已确认真实基线

当前最近的真实基线为 `0.3.22`、`魔法少女世界84.png`：

- SillyTavern `1.18.0`
- Tavern Helper `3.4.17+`
- MagVarUpdate `v0.181.0`
- 继承 0.3.14 的 `draw + 0`、`exile.draw.all`、双重效果、出牌计数与消息快照基线。
- 继承 0.3.16 的浅层 `effects`、`when`、三元公式、`to`、X 费和刷新恢复基线。
- 新增状态施加/移除、抽弃牌/消耗、Power、弃牌触发、动态插牌和 transit 牌权保护的真实回归。
- 新增减费、复制、下次双重效果、选择 UI、消息快照写回和刷新恢复的真实回归。
- 新增原生剧情正文、末尾交互状态栏、独立选项解析、原战斗页面衔接和刷新恢复回归。
- 新增可移植卡牌规则、战斗数学、修饰符和状态叠层边界，以及迁移后数值/状态/passive/快照真实回归。
- 新增可移植敌人行动选择器；顺序攻击/防御、游标、当前意图、敌人格挡和刷新恢复均通过真实酒馆回归。
- 启动前内容预检会拒绝空的敌人欲望效果，并显示精确字段路径，不写入半初始化会话快照。
- 新增不可变牌区 reducer 与显式随机洗牌端口；出牌、系统弃牌、回洗、重抽、消息快照和刷新恢复均通过真实酒馆回归。
- 修复实际生产回合入口未清零 `cardsPlayedThisTurn` 的旧问题，回合开始触发现在统一观察当前回合计数。
- 发布 PNG SHA-256：`761579F26C6AF9685B9AD4602AC1AC41A8BF1F13E570CE1E098D703FB4B6E026`。

完整逐版本证据保存在 `docs/worldbook-migration.md`。后续新角色卡必须在相同或明确更新后的环境中重新验收。

## 批次发布策略

为减少重复构建、导入和浏览器操作，后续默认按一个可回滚的架构批次推进多个纯核心模块，再统一发布角色卡：

1. 纯 `game-core` 规则先用类型检查、确定性单元测试和边界门禁连续推进。
2. 同一批次内不为每个无宿主副作用的小改动单独导入角色卡。
3. 触及 MUV、Tavern Helper、消息快照、回合事务或 UI 时，立即安排针对性真实酒馆测试。
4. 每个批次结束仍必须跑完整 `release:tavern`，并在最终 PNG 上完成至少一条覆盖本批风险的真实交互与刷新恢复。
## 2026-08-22：牌组可玩性诊断跨宿主拆分（0.5.40 follow-up）

- 新增纯核心 `src/game-core/deckPlayability.ts`，统一处理牌组数量、基础能量可打出牌、胜利压力和防御/恢复信号；输入只包含标准化卡牌字段与共享 `ContentAnalysis`，不接触 MUV、Tavern Helper、DOM 或 SillyTavern。
- `src/fish/core/battleContentPreflight.ts` 只做 MUV/旧内容适配、调用核心诊断并映射本地化警告，不再维护第二套牌组判断；网站、服务和 Mod 可直接复用同一 API。
- 新增 `scripts/test-deck-playability.mjs` 并纳入 `release:tavern`；类型检查、核心边界、完整发布、角色卡补丁和本机 Tavern Helper + MUV 契约均通过。
- 本次不新增 AI 字段、不改变 `effects` JSON、不改变正文/状态栏分流或战斗 iframe 位置。最终发布卡仍为 `0.5.40`，SHA-256：`FDB0FB0B9EE98A0D056D45B9F539B26AD6F1BDCD4DFF573F85FF747C8723EBFB`；重新导入本机酒馆返回 `魔法少女世界149.png`。
## 2026-08-22：跨宿主目录与 MUV 包装规则收敛（0.5.40 follow-up）

- `src/game-core/contentCatalog.ts` 成为卡牌类型、卡牌稀有度和遗物稀有度的唯一目录；内容契约、奖励候选校验和 Tavern 内容适配器不再各自维护 `Set`。
- `contentAnalysis.hasContentMetric()` 统一正数/动态公式指标判断；牌组可玩性、敌人预算和 Tavern 敌人预检共享同一攻击压力谓词。
- `src/runtime/mvuArrays.ts` 统一 MagVarUpdate 数组包装展开。fish 内容转换和 common 奖励/远征事务仅通过不同选项消费它，不再重复维护标记集合和递归展开器；旧元数据包装和原有数组语义保持兼容。
- 相关核心、奖励、MUV 适配、Tavern 边界和完整类型检查测试已通过；本阶段不增加 AI 字段，不改变 MUV schema、正文状态栏或战斗 iframe 链路。
- 完整 `npm run release:tavern` 用时约 159 秒并通过；最新发布卡 `dist/tavern/魔法少女世界-酒馆兼容版.png` 为 7,604,941 字节，SHA-256：`DD6F2EC53FDC63ADE6A49D90257C44D98017F7B053CDE0D98AF24F0F5AAD810F`。导入 `http://127.0.0.1:8012/` 后酒馆返回 `魔法少女世界150.png`，内嵌正则启用成功。
## 2026-08-22：成长与远征节点结算计划跨宿主拆分（0.5.40 follow-up）

- 新增纯核心 `progression.ts`、`runNodeSettlement.ts`：经验多级升级、偶数级删牌次数、营火恢复、商店价格/余额/路线完成和当前节点前置条件均返回不可变计划。
- `common/progression.ts` 只保留旧函数名并把计划应用到 MUV battle；`common/runTransactions.ts` 只负责读取/展开 MUV、clone、奖励写入、价格清理和最终提交，网站/服务/Mod 可直接复用核心计划。
- 事件、营火、商店和通用路线完成统一消费 `requireActiveRunNode()`；没有新增 AI 字段或改变 MUV schema，旧聊天兼容入口保持不变。
- 新增 `docs/run-settlement-boundaries.md` 与核心/宿主静态门禁；局部类型、路线、升级、奖励事务和核心边界测试通过。
- 首轮完整发布在最终 Tavern 契约检查中发现旧中文异常提示被英文核心文案替换，已恢复兼容文案并重新跑通全量门禁。第二轮 `npm run release:tavern` 用时约 149 秒；最终卡 7,608,309 字节，SHA-256：`BDB1009DE084FDF138A3D108E30BF5D02AEF3819704ADE2EFAB66DB92A6BD964`；导入酒馆返回 `魔法少女世界151.png`，`verify:tavern` 和内嵌正则启用均通过。

## 2026-08-23：动态状态注册表与楼层渲染约束收口（0.5.74）

- 新增纯核心 `src/game-core/statusDefinitionRuntime.ts` 与 `StatusDefinitionRegistry`，统一状态字段规范化、现代结构化触发器编译、旧字符串只读兼容和定义查询。现代状态程序不再回编译成旧 `ME/OP` 字符串，避免状态执行、hold 修饰符和展示出现第二套语义。
- `src/fish/combat/dynamicStatusManager.ts` 收缩为当前消息楼层 MUV 读取适配器；删除状态定义写回、时间戳、手工添加和强制重载 API。每次读取先清空旧缓存，切换/刷新失败不会残留上一楼层定义。
- 开始页、common 状态栏和 fish 战斗页的渲染生命周期冻结：正则统一 `placement=[2]`、`minDepth=0,maxDepth=0`；start 额外要求 `message_id=0`，common/fish 只挂最新 AI 楼层；正文保持原生展示，状态栏和战斗容器通过轻量 shell + 共享角色运行时挂载，不重复包裹正文或整页正则替换。
- 自动状态/核心边界/Tavern 契约检查通过。首轮完整 `release:tavern` 的所有测试与构建通过，但 Windows 在最终覆盖旧 PNG 时出现一次瞬时文件占用；幂等重跑 `patch:card` 与 `verify:tavern` 后成功。最终卡为 `7,887,581` 字节，SHA-256：`1385991F861C50D3CFA6D73C8C0E115E172040728F4C5196443DDCA3A134EF25`；共享运行时为 `1,001,048` 字节，SHA-256：`CACD600C665CCFFA4A2DBEC783D49D703035016BE165E8E3AF6B04C6177865D6`。
- 最终卡先导入长期测试 dataRoot 为 `魔法少女世界195.png`；该目录累积 200 张历史角色卡，`/api/characters/all` 扫描长期不返回并使前端循环报告 `Settings not ready`。保留原数据不动后，切换到已有的 4 卡 selfcontained dataRoot，重新导入为 `魔法少女世界2.png` 并确认世界书 `魔法少女世界0.5.74`。隔离夹具 `battle-repair-effects-2026-08-23T06-59-00Z` 在真实 SillyTavern `1.18.0` 完成五卡回归：玩家 `68/80 HP`、9 格挡、`4/3` 能量，敌人 `27/36 HP`、`20/100` 欲望与 2 层 `weak`，玩家 `focus` 已移除，牌区 `0/6/5/0`。整页刷新并重新打开后全部恢复；原生正文在 iframe 外、战斗页在正文后，消息 iframe 恰好 1 个且无残留 modal。`0.5.74` 已成为最新真实酒馆基线。
- 同一卡与世界书又运行隔离夹具 `battle-repair-status-2026-08-23T07-27-07Z`，覆盖现代状态完整生命周期。依次施加、获得格挡、叠层、移除并重新施加后，玩家为 `45/80 HP`、8 格挡、1 层 `star_mark`；其中 `hold` 按当前 1 层分别修饰施加触发与普通格挡。结束回合后 `tick` 治疗 1，层数 `-1` 归零再触发 `remove` 治疗 3，敌人 6 点攻击被格挡吸收，最终为 `49/80 HP`、0 格挡、无状态、回合 2，牌区 `5/0/5/0`。官方消息快照、整页刷新和从最近聊天重开三者一致；当前楼层仍只有一个战斗 iframe，引导正文在外。本轮不改开始页或战斗布局，只验证首楼层 start、最新楼层 common/fish 的轻量挂载约束。
# 2026-08-25 / 0.5.94 开始页与 MVU 内容交接

- 开始页默认收敛为剧情/爬塔两个入口；爬塔暂禁用，剧情模式点击后展开角色、世界、剧情、卡牌、偏好五组配置。
- 复用既有阵营、身份、白木市地点数据，新增的世界观与构筑偏好仍由单行浅层 JSON 交给 AI；只发送非空值。
- 卡牌规范采用“短规则常驻第二轮、长规则按场景激活”：常驻条目为 324 `o200k_base` token，第二轮基础上下文合计 3281；完整卡牌生成与战斗规则不进入普通 MVU 回合。
- 首轮初始化从历史 `[开始游戏]` 关键词改为当前回复 `<CHARACTER_INIT_PENDING>` 显式交接，修复额外模型只更新时间地点、不创建卡组的问题。
- 普通剧情已确认获得/失去战斗内容时使用 `<CONTENT_PENDING>` 交接，剧情模型只写事实，MVU 模型负责公式和变量。

# 2026-08-25 / 0.5.95 开始页自由配置

- 开始页校验缩减为只要求选择剧情模式；其余字段填多少提交多少，全部留空时只发送 `{"mode":"story"}`。
- 职业和开场地点改为自由文本，剧情页取消方向、节奏与语气预设；第一阶段剧情自然补全用户没有填写的身份、地点和能力主题，不追问表单。
- 白木市的城市、地点和旧职业数据保留在源码中，但不再绑定当前表单，供后续世界内容和爬塔模式复用。
- 角色卡、角色名和世界书同步升为 `0.5.95`，避免 SillyTavern 复用同名 `0.5.94` 的缓存内容。

# 2026-08-25 / 0.5.96 首轮卡组与原楼层 MVU 修复

- 首轮初始化把 `battle.cards` 设为不可替代的卡牌目标；即使开场剧情立即进入战斗，也必须先完成卡组、遗物、道具、核心资源、欲望满溢和等级，再注册敌人。
- 角色运行时监听 MVU `VARIABLE_UPDATE_ENDED`：具有 `type/rarity/cost/quantity/effects` 的卡牌若误写进 `player_abilities`，会迁移到 `battle.cards`，真正带 `trigger` 的能力保留。AI 直接输出的 `<BATTLE_START>` 会被移除，只有运行时门禁可以生成启动标记。
- fish 与 common 的修复入口改用同一个当前楼层额外模型宿主：临时注入有界修复标记，触发 MVU 自带“重试额外模型解析”事件，成功后清理标记；不创建消息、不调用剧情模型，失败恢复原消息和变量快照。
- 自动测试覆盖错位卡牌迁移、AI 越权启动拦截、玩家/敌人联合修复标记，以及修复过程聊天楼层创建次数为零。
