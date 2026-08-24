# Tavern Helper 与 MUV 踩坑记录

更新时间：2026-08-24。

本文件只记录已经在文档、构建产物或真实酒馆中观察到的问题。新问题应记录“症状、原因、处理、回归”，避免上下文压缩后重复排查。

## P57：iframe 不继承 SillyTavern 宿主暗色主题

- 症状：普通状态栏的布局、按钮和数据都存在，但黑字叠在酒馆深色背景上，看起来像整份 UI 丢失。
- 原因：状态栏 iframe 有独立的 `document`、`localStorage` 和 `prefers-color-scheme`；宿主深色设置不会自动传入 iframe。旧版代码还会把自动判断结果写入旧的本地键，后续修改无法覆盖该缓存。
- 处理：common 主题初始化优先读取 `window.parent.document.body` 的实际背景亮度；CSS 暗色变量同时接受 `html[data-theme="dark"]` 和 `.mwg-statusbar[data-theme="dark"]`。本地存储改为只保存用户主动切换的 `mwg-ui-theme-choice`，旧键自然失效。
- 回归：真实酒馆普通夹具检查唯一 `.mwg-statusbar`、唯一 `style[data-mwg-runtime-style="common"]`、`html[data-theme="dark"]`，计算样式为背景 `rgb(23,26,31)`、正文 `rgb(244,245,247)`；`npm run test:common-interface` 通过。

## P58：根目录同名 PNG 可能仍是旧卡

- 症状：导入“最终卡”后世界书和脚本为空，或开始楼层重复出现加载壳。
- 原因：发布器默认把补丁写入 `dist/tavern/魔法少女世界-酒馆兼容版.png`，根目录的原始输入 PNG 不会自动变成兼容卡；用户手动选择根目录同名文件时实际导入了旧元数据。
- 处理：每次发布后把兼容产物同步为根目录 `魔法少女世界.png`，并在卡内校验 14 条世界书、7 条正则和 2 个角色脚本。历史导入目录中的旧副本不参与验收。
- 回归：根目录与 dist 卡 SHA-256 均为 `7DC4EB3C41609F2C366654109FEDB5C8F4B6ECF6C21C19D2B4F93D8837AB27D8`；真实酒馆导入新卡后普通夹具唯一状态栏通过。

## P00：API 夹具与浏览器活动角色竞争

- 症状：HTTP 夹具已经保存并把 `active_character` 设为新卡，旧的 SillyTavern 页面刷新后仍回到欢迎页。
- 原因：已打开的页面在刷新或初始化时会把自己的“未选角色”状态重新保存，覆盖夹具刚写入的 settings；多个标签页会放大竞争。
- 处理：关闭所有旧酒馆标签页，保存并激活单个夹具聊天，再打开一个新页面；HTTP 契约结果和浏览器 DOM 结果分开记录。
- 回归：不要仅凭欢迎页判断正则或角色脚本失败；先通过 `/api/settings/get`、角色 `chat` 字段和 `/api/chats/get` 确认夹具，再做单标签 DOM 检查。

`0.5.61` 再次观察到：即使 HTTP 夹具刚生成并成功导入 `魔法少女世界180.png`，旧浏览器标签刷新后仍可能停在欢迎页、看不到最新隔离聊天。此次不影响 API 夹具和发布契约，但浏览器 DOM 证据必须标为“未形成”，不能冒充真实页面通过。

`0.5.67` 进一步确认专用测试服积累大量 APNG 角色卡后，`/api/characters/all` 可耗时约 23 秒；页面在这段时间会显示“正在初始化…”并打印 `Settings not ready`。等待角色列表完成后，188 卡的 start/common DOM 和真实指针续写均正常。后续浏览器回归必须等待初始化真正结束，不能固定只等 1-2 秒。

`0.5.68` 再次命中同一竞争：API 已激活 189 卡夹具后直接刷新旧欢迎页，初始化完成仍显示默认助手。通过欢迎页“最近的聊天”明确打开对应 189 卡夹具后，common/fish DOM、世界书导入和真实路线点击均正常。因此后续无需反复刷新碰运气；等待角色列表结束后从最近聊天进入目标夹具即可。

`0.5.70` 导入 191 卡后再次复现：刷新期间“正在初始化…”持续约十余秒，结束后停在欢迎页；从“最近的聊天”打开 `battle-repair-valid-2026-08-23T03-42-09Z` 后立即恢复唯一 `0.5.70/fish` iframe。Statsig 网络超时与该竞争无关，不能当作项目运行时错误。

## P01：完整 bundle 放进正则替换文本

- 症状（迁移前）：`common-interface.json` 约 303 KB，`fish-interface.json` 约 627 KB；每个匹配楼层都要处理完整 HTML/CSS/JS。
- 原因：旧发布链直接把 Webpack 内联页面写入角色卡局部正则的 `replaceString`。
- 当前处理：`0.5.58` 已把 start/common/fish 全部迁到角色脚本运行时 + 轻量 iframe 壳；三份正则均约 3.2 KB，角色脚本资源只嵌入一次。
- 后续处理：继续把宿主调度和历史楼层加载从视图 bundle 中拆出，保留自包含回退。
- 回归：比较三份接口 JSON 大小，并验证普通正文仍在 iframe 外、战斗页仍在引导正文后。

## P02：Tavern 替换组与脚本内容发生二次解释

- 症状：bundle 中的 `$1`、`$<name>` 可能被当成正则替换组；`&&lt` 一类压缩后标识符可能被 HTML 解析成 entity。
- 原因：替换文本先经过 SillyTavern 正则引擎，再经过 Markdown/HTML 与 Tavern Helper iframe 渲染。
- 当前处理：`export-tavern-interface.mjs` 对脚本中的 `$` 和 entity 前缀转义；Terser 保留易冲突标识符。
- 最终处理：大型 bundle 移出 `replaceString` 后删除不再需要的转义，但最小 bootstrap 仍需契约测试。
- 回归：`verify:tavern` 模拟替换组处理，解析最终 HTML，并用经典脚本解析器检查唯一可执行脚本。

## P03：不要用运行时正则更新刷新 UI

- 症状：调用 `replaceTavernRegexes` 或 `updateTavernRegexesWith` 后整个聊天重载，触发 `CHAT_CHANGED`，脚本和楼层前端重新加载；之后的脚本逻辑还可能不再执行。
- 原因：这是 Tavern Helper 的安装/更新 API，不是视图状态 API。
- 处理：只在安装或升级时批量调用一次。运行时使用共享事件、DOM 更新或必要的 `renderOneMessage(message_id)`。
- 回归：普通出牌和状态更新不得调用正则更新 API；刷新聊天只能由明确用户动作或恢复测试触发。

## P04：角色卡局部正则导入后未获准执行

- 症状：角色卡成功导入，但局部正则不渲染。
- 原因：SillyTavern 按角色头像维护 `character_allowed_regex`。
- 处理：`import-tavern-card.mjs` 在导入后把实际返回的头像文件名加入许可列表。
- 回归：必须使用 SillyTavern 返回的新头像名验证，不能假定导入文件名保持不变。

## P05：Tavern Helper iframe 的识别条件

- 症状：HTML 被显示为普通代码或没有变成可交互 iframe。
- 原因：文档要求内容位于代码块中，并且同时包含 `<body>` 和 `</body>`。
- 处理：通用和战斗模块使用 fenced HTML；战斗 `body` 模式仍输出完整 body 标签。
- 回归：解析最终替换文本并断言代码围栏、body 标签、正文捕获组位置和 iframe 内根容器。

## P06：角色脚本生命周期不是普通网页生命周期

- 症状：使用 `DOMContentLoaded` 时脚本可能早于酒馆页面就绪；脚本重载后残留定时器或宿主监听。
- 原因：角色脚本运行在 Tavern Helper 管理的脚本环境中。
- 处理：脚本就绪使用 `$(() => {})`；关闭清理使用 `$(window).on('pagehide', ...)`；优先使用 Tavern Helper 的 `eventOn`，其监听会随 iframe 关闭自动卸载。
- 回归：切换聊天、编辑消息和完整刷新后不得出现重复监听、重复写回或重复战斗开始触发。

## P07：MUV 首次导入和世界书确认会占用启动时间

- 症状：首次导入卡片时战斗 iframe 显示 MUV 超时；确认内嵌世界书后刷新才能恢复。
- 原因：早期实现把 MUV 全局出现、世界书确认和当前楼层变量出现共用 8 秒预算。
- 处理：卡内 MUV loader 使用单例 Promise；MUV API、世界书和楼层 `stat_data.battle` 使用独立预算；轮询实际 API，不只相信全局通知。
- 回归：首次导入故意等待超过旧 8 秒再确认世界书，不刷新即可继续；后续刷新直接恢复。

## P08：消息变量必须绑定 iframe 所在楼层

- 症状：旧战斗楼层修改了最新消息，或者刷新后恢复到错误战斗快照。
- 原因：使用 `'latest'` 或未显式传 `message_id` 会把 iframe 与消息存档解耦。
- 处理：所有消息变量读写从 `getCurrentMessageId()` 得到楼层并显式传递；只有最新楼层可以写，历史楼层强制只读。
- 回归：打开历史战斗楼层时按钮禁用，MUV 最新消息不变；最新楼层出牌后只写对应消息。

## P09：`renderOneMessage` 只改变显示

- 症状：刷新单楼层后 UI 看似变化，但聊天数据或 MUV 没有保存；整页刷新后变化消失。
- 原因：Tavern Helper 文档明确说明楼层渲染 API 只影响显示。
- 处理：先通过唯一事务写 MUV/消息快照，再通知或刷新对应视图；禁止把 DOM 当存档。
- 回归：每个交互都检查界面、官方消息快照和整页刷新后三者一致。

## P10：共享接口必须等待真实能力可用

- 症状：`waitGlobalInitialized('Mvu')` 返回后立刻调用 API 仍失败，或首次导入时通知先于接口完成。
- 原因：共享全局通知和依赖脚本实际初始化可能存在时序差。
- 处理：等待共享接口后继续验证关键函数存在；`MagicGirlWorld` 运行时也应暴露 `ready()` 和诊断状态，不把“全局名字存在”等同于“可以写存档”。
- 回归：延迟注入 MUV API 的契约测试和真实首次导入测试都必须通过。

## P11：全量替换角色脚本树会破坏用户内容

- 症状：`replaceScriptTrees` 会清空已有同作用域脚本。
- 原因：该 API 语义是完全替换，不是按 ID upsert。
- 处理：发布阶段直接补丁角色卡内属于本项目的脚本；若必须运行时更新，只按稳定 ID 使用 `updateScriptTreesWith`，保留其他脚本。
- 回归：角色卡内项目脚本各一份，非项目脚本不被删除，重复导入不会累加同名运行时。

## P12：外部资源不能成为唯一运行链路

- 症状：CDN、证书、代理或跨域失败会让 iframe 空白；远端最新版还可能与卡内世界书/MUV schema 不匹配。
- 原因：外部脚本把网络和版本一致性引入每次加载。
- 处理：默认卡提供自包含运行时；服务器模式使用固定版本 URL 和完整性/版本校验，并提供卡内回退或明确错误。
- 回归：联网服务器模式、断网回退和错误版本拒绝三种情况分别测试。

## P13：渲染历史深度与代码高亮会放大前端压力

- 症状：长聊天加载多个前端楼层时卡顿，控制台重复打印大段代码。
- 原因：Tavern Helper 会按渲染深度处理楼层；SillyTavern 的代码高亮本身也有明显开销。
- 处理：运行时只让最新楼层加载完整交互，历史楼层只读或轻量；建议测试 Blob URL 渲染和取消前端代码高亮，但不能把用户手动配置当成程序正确性的前提。
- 回归：长聊天中检查实际活动 iframe 数、加载时间、历史楼层只读和最新楼层交互。

## P14：真实酒馆中仍有两个未归因错误

- 症状：浏览器观察到 `MutationObserver ... parameter 1 is not of type Node`，以及 `Type mismatch: expected object schema but got undefined at path`。`0.5.57` 新运行时挂载、原始消息选项读取、状态栏恢复和战斗交互没有新增第三类错误；`Type mismatch` 仍由 Tavern Helper `log.js` 报出。
- 原因：尚未确认来自项目、Tavern Helper、MUV 或其他脚本。
- 处理：不得把它们标记为已解决；下一次目标实机回归要记录堆栈、消息楼层和触发动作后再归因。
- 回归：空白新聊天、首次世界书确认、进入战斗、选择卡牌、刷新恢复各记录一次控制台差异。

`0.5.68` 最终 battle 恢复和 common 路线点击仍能观察到 `Type mismatch`，来源 URL 继续是 Tavern Helper iframe 的 `log.js`；同一时刻战斗 DOM、结构化用户消息、MUV `in_node` 提交和历史 iframe 卸载均成功。仓库内 `mvu.js` 表明该文本来自 schema 重建函数；当前 HTTP 夹具明确使用空 `schema: {}`，可触发“got undefined”这一分支，但尚不能据此证明真实新聊天中的同名错误全部来自夹具。后续应分别用真实首轮 MUV schema 与隔离夹具记录，修夹具时不能掩盖真实链路。

## P15：外部“实时编写前端或脚本”教程曾暂时无法读取

- 症状：早期读取 stagedog 教程时曾返回 `ERR_CONNECTION_CLOSED`，容易把“暂时不可达”误记为资料不存在。
- 原因：外部站点连接波动。
- 处理：2026-08-23 已成功读取教程；确认正则只应定位界面，复杂数据由 `getChatMessages(getCurrentMessageId())` 读取；大前端可以使用 HTTPS/版本化链接减轻代码块渲染，但默认角色卡仍保留自包含回退。
- 回归：外部教程只作为实现建议，最终仍以当前 Tavern Helper 文档、产物契约和真实酒馆为准。

## P16：构建器插入 bundle 时不能使用字符串替换值

- 症状：角色运行时模板明明调用了 `replaceAll`，生成结果中仍残留 `__MWG_VIEW_ASSETS__` 占位符，而且数量增加。
- 原因：完整 bundle 含有 `$&`、`$1` 等文本；JavaScript 的字符串替换值会把它们再次解释为匹配内容和捕获组。
- 处理：向模板插入 HTML/CSS/JS 资源时必须使用函数式替换 `replaceAll(marker, () => payload)`，确保 payload 按字面量写入。
- 回归：运行时导出器拒绝任何未解析占位符，产物脚本再由经典脚本解析器检查。

## P17：正则不应搬运整条消息或选项数据

- 症状：即使替换文本已经缩小，common 仍通过 `$1/$2` 搬运正文和 `<Options>`；正文、替换组、Markdown 和 iframe 会经历多次解析，复杂 AI 输出更容易被截断或误解释。
- 原因：把“定位界面位置”和“解析消息数据”混成了一个正则替换步骤。
- 处理：按照 Tavern Helper 实时编写教程的推荐写法，正则现在只移除 `<UpdateVariable>`、`<StatusPlaceHolderImpl/>`、`<BATTLE_START>` 等协议 marker 并插入壳；common 通过共享 `MagicGirlWorld.getMessageText(message_id)` 读取原始楼层后提取 `<Options>`，fish 继续按显式楼层读取 MUV。
- 回归：`verify:tavern` 模拟普通消息、MUV placeholder、战斗 marker 和替换结果，确认正文保留在 iframe 外、common 不误匹配战斗、产物不含任何 `$1/$2` 捕获组。

## P18：共享角色脚本 API 必须同时承担消息楼层门禁

- 症状：每个 iframe 各自轮询 MUV 和 `stat_data.battle`，不同视图可能使用不同超时、楼层或版本判断。
- 原因：角色脚本只共享资源，没有收口宿主能力。
- 处理：`MagicGirlWorld.waitForMessageReady(message_id, options)` 统一检查 Tavern Helper 版本、MUV API、世界书可读性和当前楼层战斗变量；`messageVariables.ts` 优先调用它，旧版本或本地环境才回退到兼容轮询。
- 回归：角色运行时契约测试验证显式 `message_id`、共享 `getMessageText`；真实酒馆回归仍要求首次世界书确认、历史楼层只读和刷新恢复。

## P19：导出时间戳会让相同源码得到不同 PNG 哈希

- 症状：代码和资源不变，仅重复运行 `export:tavern` 与 `patch:card`，最终 PNG 的 SHA-256 仍变化。
- 原因：`character-runtime-manifest.json` 和角色脚本内嵌 `new Date().toISOString()` 生成的 `generatedAt`。
- 处理：`0.5.57` 移除没有兼容价值的 `generatedAt`；继续保留卡版本、视图字节数和脚本稳定 ID 作为运行时诊断。
- 回归：相同版本与相同输入连续执行两次 `export:tavern` + `patch:card`，角色脚本与 PNG 哈希必须一致。

## P20：历史 HTML 的多余结束标签不能在加载迁移时顺手清理

- 症状：`src/start/index.html` 在第一组 `</body></html>` 后仍有结果区和背景节点；按源码文本截断会让角色创建结果面板或按钮消失。
- 原因：浏览器与 parse5 会把尾随节点重新归入同一个 `body`，实际生产 DOM 与文件的直观看法不同。
- 处理：`export-tavern-runtime.mjs` 从生产构建产物的 parse5 DOM 提取 body、style 和唯一脚本；本批只迁移资源位置，不同时整理历史 HTML 结构或改变开始页渲染模式。
- 回归：运行时 start asset 必须同时包含 `.magical-girl-creator`、`#create-character-btn`、`#result-section` 和 `#start-game-btn`，body asset 不得残留第二个脚本。

## P21：轻量 start 壳必须满足 Tavern Helper 的标准 iframe 识别条件

- 症状：第一次 `0.5.58` 实机候选保留非 fenced 完整文档壳；SillyTavern 把加载节点插入外层消息 DOM，内联 bootstrap 没有执行，界面永久停在“正在加载”。
- 原因：Tavern Helper 文档要求渲染内容同时位于代码围栏中并包含 `<body>...</body>`；旧完整 bundle 的兼容行为不能推导出轻量壳也会执行脚本。
- 处理：start 与 common/fish 统一导出 fenced `<body>` 壳，由 Tavern Helper 创建 iframe 后执行 bootstrap。共享运行时和视图资源不变。
- 回归：开始正则小于 10 KB、包含唯一 fenced body 和一个 bootstrap 脚本；真实 DOM 中加载节点的 `ownerDocument` 必须是 iframe 文档，随后出现 `.magical-girl-creator`。

## P22：共享资源不等于历史楼层自动降载

- 症状：bundle 虽只在角色脚本保存一份，但每个匹配的历史楼层仍会各自创建 iframe、复制视图资源并执行交互脚本，长聊天依然会累积前端压力。
- 原因：资源去重解决卡片存储和正则多次解析，不会改变 SillyTavern 对每个消息深度应用正则的行为。
- 处理：Tavern Helper 类型定义与 SillyTavern `1.18.0` 均以 `depth=0` 表示最新消息；三条项目界面正则统一设置 `minDepth=0,maxDepth=0`。开始 marker 只在首条消息，因此产生下一楼后自然停止渲染；common/fish 也只保留最新交互视图。
- 回归：导出契约要求三条正则深度均为 `0..0`；真实长聊天只应存在最新消息的 `TH-message-*` 项目前端 iframe，历史文本和 MUV 存档仍保留。

## P23：开始 marker 不应作用于用户交接消息

- 症状：角色创建按钮发送的浅层交接消息也包含 `[开始游戏]`；若 start 正则作用域包含用户输入，生成前可能短暂重新挂载开始表单。
- 原因：`minDepth=0,maxDepth=0` 只限制楼层深度，不限制消息来源；原配置 `[1,2]` 同时匹配用户和 AI。
- 处理：start 正则固定 `placement=[2]`，只处理 AI 输出中的初始 `[开始游戏]`；common/fish 也只处理 AI 输出。
- 回归：契约要求 start `placement=[2]`；历史 start 聊天和用户交接消息不应创建 iframe。

## P24：嵌套触发不能复用顶层动作门

- 症状：出牌后触发能力、状态或遗物时，内层执行被报告为 busy，或者内层事务释放了外层动作门；外层回合随后出现重复提交或无法继续。
- 原因：顶层 `BattleSessionActionGate` 同时被当成玩家动作互斥和所有效果事务互斥；触发器还各自维护 snapshot/catch/finally，失败策略不一致。
- 处理：`game-core/triggerTransaction.ts` 只提供无 gate 的嵌套事务协议；Tavern 和参考宿主通过 `triggerTransactionPorts()` 共享快照实现。遗物、能力、状态、弃牌和诅咒统一使用 `recover-and-continue`，由各自调用方保留日志文案；真正的玩家动作仍由 `runBattleSessionAtomicAction`、`playBattleSessionCard` 或回合协调器持有 gate。
- 回归：`test-trigger-transaction-core.mjs` 覆盖 commit、rollback、传播失败、恢复继续、回滚失败包装和外层 gate 保持；`test-reference-battle-session-host.mjs` 覆盖外层动作中嵌套触发回滚后继续提交。

## P25：楼层正则与 iframe 内刷新不能互相替代

- 症状：追加新消息后旧状态栏或旧战斗仍运行，或者一次状态变化重复追加多个状态栏/战斗根节点。
- 原因：把“哪些消息创建 iframe”和“一个 iframe 内如何刷新状态”混成同一职责；业务代码自行追加外层 UI、动态改正则，或为一次数值更新重复调用整楼渲染。
- 处理：start/common/fish 继续由角色局部正则的 `placement=[2]`、`minDepth=0,maxDepth=0` 决定唯一最新 AI 楼层；开始页额外依赖只在初始 AI 输出出现的 `[开始游戏]`。数值状态只更新 iframe 自身 DOM；当所属楼层从 latest 变成历史时，共享边界先禁用旧交互，再调用 Tavern Helper `refreshOneMessage(message_id)` 重新计算正则深度并自然卸载 iframe，失败才保留只读兜底。运行时不得新增第二套状态栏/战斗挂载器。
- 回归：导出契约检查三条正则的楼层范围和轻量壳；真实 start 历史聊天必须为零项目 iframe，common/fish 只允许最新消息各自匹配一个互斥视图。`0.5.67` 实测 common 追加用户楼层后项目 iframe 从 `1` 变为 `0`，AI 正文仍保留。

## P27：开始 marker 不能单靠正则保证只出现一次

- 症状：start 正则虽然限制 `placement=[2]`、`minDepth=0,maxDepth=0`，但 AI 后续正文若再次输出 `[开始游戏]`，最新楼层仍可能创建新的开始页 iframe。
- 原因：正则只能看到当前消息文本，不能判断聊天历史中的首条 AI 楼层；楼层范围也只表达“最新”，不表达“首条”。
- 处理：start 视图壳在挂载前读取 Tavern Helper `getCurrentMessageId()`，只有 `message_id === 0`（或本地无该 API 时）允许继续；后续楼层直接清空壳。所有视图根节点同时写入 `data-mwg-mounted-view`，同一 iframe 重复执行时不再插入第二份视图。
- 回归：角色运行时契约必须检查 start 壳包含首楼层门禁和单实例标记；真实酒馆仍需验证首条 `TH-message--0--0` 可见，追加消息后不再出现 start 表单。

## P26：浏览器能展开 iframe DOM 不等于自动 click 已到达交互层

- 症状：自动化可以在 Tavern Helper iframe 内唯一定位 `.card.clickable`，元素可见且 enabled，但 locator click 后外层 `$(document).on('click', '.card...')` 没有收到事件，卡牌和选择弹窗状态均不变。
- 原因：宿主抽屉、内嵌世界书确认框或欢迎页初始化层可能仍覆盖消息区域；旧控制面也可能无法沿 iframe 内 jQuery 委托链派发。不能据此判断卡牌逻辑失败，也不能把“卡片可见”写成“交互通过”。
- 处理：分别记录 HTTP/MUV 契约、iframe DOM 恢复和真实交互三层证据。点击前先确认世界书已导入、宿主抽屉和对话框已关闭，再以 HP、能量、牌区或快照变化作为交互成功信号；无状态变化时先检查宿主覆盖层，不重复点击或直接修改测试结论。
- 回归：`0.5.71` 首次点击时世界书侧栏仍展开，战斗数值没有变化；关闭侧栏后使用同一稳定卡牌 ID 点击，“三重星芒”正常使敌人 `36 -> 27`、能量 `3 -> 2`、手牌 `5 -> 4`。结束回合、消息快照和整页刷新恢复随后通过，证明这次无变化来自宿主覆盖层而非 iframe 委托或卡牌规则。

## P28：拆出宿主不能复制第二套执行器

- 症状：为了缩短 `UnifiedEffectExecutor`，新建类后又复制现代/旧效果执行、触发顺序或状态事务，短期文件变小但行为出现两个来源。
- 原因：把“宿主编排所有权”误当成“重写具体副作用”；触发器、牌区与现代命令随后会在两套实现中漂移。
- 处理：`TavernBattleTriggerHost` 只拥有能力/状态生命周期和嵌套事务；`TavernEffectCommandHost` 路由现代命令，其中卡牌命令直接进入唯一 `CardEffectRuntime`，其余命令才适配到既有战斗副作用；`TavernRelicTriggerHost` 只拥有遗物生命周期；`TavernCardEffectHost` 只归一化旧卡牌语法。`CardSystem` 只提供 Tavern 选择、抽弃牌/消耗生命周期和呈现端口，不拥有牌区规则。
- 回归：能力、状态、事务、遗物、伤害、牌区和核心边界测试明确拒绝现代卡牌命令往返旧表达式、`CardSystem` 恢复重复选择/牌区 API、或旧执行器重新拥有触发事务；旧 `RelicEffectManager` 路径不得恢复。

## P29：开始页改版不能阻塞楼层渲染收口

- 症状：为了以后重做开始页，当前迁移不断扩大表单、布局或视图状态，反而增加卡内资源和真实酒馆验证面。
- 原因：把一次性角色创建 UI 的未来改版与当前“只在正确楼层挂载”的运行时职责混在一起。
- 处理：当前开始页只保留可用功能，不继续复杂化；start 正则只匹配 AI 输出且固定最新楼层，bootstrap 再要求 `message_id === 0`。正文由 SillyTavern 原生展示；common 状态栏和 fish 战斗页只在对应最新 AI 楼层末尾互斥挂载，状态更新不创建第二套外层 UI。
- 回归：`test:tavern-character-runtime` 与 `verify:tavern` 同时检查三条正则 `placement=[2]`、`minDepth=0,maxDepth=0`、start 首楼层门禁、单实例标记、正文不被 iframe 包裹和 common/fish 互斥。

## P30：复杂提示词不能拼入 `/send` STScript

- 症状：common 生成的路线、升级或修复提示包含 `||`、JSON、引号或换行时，文本可能被 STScript 重新解释，导致截断、管道误分段或发送失败。
- 原因：`triggerSlash(command)` 接收完整 STScript；`/send ${prompt}` 把领域文本与命令语言拼成一个字符串。提示词越复杂，转义面越大。
- 处理：`TavernCommonActionHost` 使用官方 `createChatMessages([{role:'user',message:prompt}], {refresh:'affected'})` 创建结构化用户消息，只把固定常量 `/trigger` 交给 `triggerSlash`。不传插入位置，兼容旧 `insert_at` 和新 `insert_before` 的默认末尾行为。MUV `v0.181.0` 处理下一条 AI 回复时会向前寻找最近的 `stat_data`，所以用户消息无需复制大份 `data`。
- 回归：单元测试要求含 `||` 和 JSON 的 prompt 字节级原样进入 `message`；创建失败回滚准备状态，`/trigger` 失败因消息已创建而保留状态，并拒绝并发 continuation。真实酒馆回归需确认用户楼层内容完整且下一条 AI/MUV 从正确节点继续。

## P31：MUV 准备状态回滚必须保留“字段不存在”

- 症状：路线重试或营火升级请求在用户消息创建失败后，原本不存在的 `run_result/run_upgrade` 被回滚成显式 `null`；短期逻辑通常仍能运行，但后续字段存在性判断、旧聊天兼容或增量显示会观察到不同状态。
- 原因：准备阶段只保存了字段值，没有同时保存 `hasOwnProperty`；`undefined` 无法区分“键不存在”和“键存在但值为空”。
- 处理：`TavernRunActionHost` 使用统一的可选字段快照 `{present,value}`，进入失败时按原状态赋值或删除；路线进入仍只在当前节点 ID 与准备节点一致时恢复旧 `run`，避免覆盖已经前进的新状态。
- 回归：宿主测试覆盖进入节点、普通重试和营火升级三条创建失败路径，明确断言原本缺失的键在回滚后仍缺失；消息已创建但 `/trigger` 失败仍不回滚。

## P32：选牌弹窗返回值不是可信规则输入

- 症状：弃牌费用、预见/取回或历史选择器各自直接接收卡牌对象；重复 ID、越界数量、已不在候选集的卡或取消语义会在不同入口得到不同处理。
- 原因：UI 同时拥有候选、规则与返回值解释，三个调用点只约定“返回数组或抛异常”，没有可移植协议。
- 处理：`game-core/cardSelection.ts` 只用稳定 ID 建立自动/交互计划，并校验重复、范围、取消和宿主响应；`TavernCardSelectionHost` 唯一负责对象映射与通用 modal。牌区移动、效果执行和消息快照随机源仍属于既有宿主，不在选择层复制。
- 回归：`test-card-selection.mjs` 覆盖自动/交互模式、稳定顺序、取消、非法响应、重复候选和注入随机源；结构门禁拒绝 `CardSystem` 直接调用选择 presenter 或恢复专用弃牌 modal。

## P33：兼容展示不能拥有第二套旧语法解释器

- 症状：同一旧 `effect` 字符串在执行、敌人意图和标签中显示不同含义；复杂公式还可能被展示正则截取为错误固定数值。
- 原因：`effectAnalysis.ts` 和 `UnifiedEffectDisplay` 在统一 parser 之外又维护 `key:value`、状态与基础属性正则 fallback。
- 处理：`TavernLegacyEffectHost` 是旧字符串 parser 的唯一所有者，同时提供宽松只读解析、描述和意图摘要；执行仍使用严格 `compile()`。UI 和 MUV adapter 只消费该宿主结果，非法文本原样安全显示，不猜测执行语义。
- 回归：旧格式与现代公式的意图聚焦测试覆盖伤害、欲望、防御、治疗、buff/debuff 和非法文本；结构门禁禁止兼容 facade/UI 重新导入 parser、正则推断或 `parseEffectDescriptionSimple()`。

## P34：首次角色卡文件名仍需要确认内嵌世界书

- 症状：最终卡已通过自动发布，真实酒馆第一次打开无模型 battle 夹具时 MUV 仍可能超时；重新打开后又完全正常。
- 原因：SillyTavern 会按新的角色卡文件名再次询问是否导入内嵌世界书。确认前 `character_world` 尚未绑定当前版本，MUV 无法读取目标 schema；确认框与欢迎页初始化竞争还可能占用等待窗口。
- 处理：每个最终导入文件都先在角色管理中确认导入当前版本世界书，并核对 `character_world`；随后重新打开同一隔离夹具。不得通过增加第二个 MUV loader、无限重试或放宽 schema 来掩盖导入前置条件。
- 回归：`0.5.72` 的 `魔法少女世界193.png` 已确认并链接 `魔法少女世界0.5.72`；同版本预见夹具的唯一 fish iframe、原生正文、通用选择、消息快照与刷新恢复均已验证。整页刷新落到 P00 欢迎页后，从最近聊天重开恢复回合 1、格挡 20、手牌/抽牌/弃牌 `4/6/2`，且无残留 modal 或重复项目 iframe。

## P36：结构化续写必须覆盖全部动态提示入口

- 症状：common 已改用结构化消息，但角色创建、战斗修复或战后提示仍通过 `/send ${prompt}`；只要内容含 `||`、JSON、引号或换行，仍可能被 STScript 截断或重解释。
- 原因：把 common 的局部修复误当成全局消息边界，没有盘点所有 continuation 调用方。
- 处理：`TavernContinuationHost` 统一四个入口，只允许 `createChatMessages` 接收动态文本，`triggerSlash` 只能接收固定 `/trigger`。调用方保留自己的领域准备/回滚，不复制消息事务。
- 回归：结构测试扫描生产 start/common/fish/runtime，不允许动态 `/send `；共享宿主测试覆盖特殊字符、并发、消息创建失败与生成失败。`0.5.70` 实机修复用户消息保留了完整错误列表，旧 iframe 正常卸载。

## P37：战斗退出回滚必须恢复完整楼层变量

- 症状：战后结算清除了 `battle_session` 并修改 `stat_data`，随后创建用户消息失败；若只恢复战斗数据，私有快照、MUV 元数据或会话指纹仍与 UI 不一致，重新打开可能无法恢复战斗。
- 原因：跨越消息变量、MUV 结算和 continuation 的准备事务只保存了业务字段，没有保存宿主实际持久化边界。
- 处理：`TavernBattleEndHost` 在任何准备写入前保存完整当前楼层变量；清快照或结算失败、以及用户消息未创建时，使用完整变量替换并重新加载战斗。消息已经创建后 `/trigger` 失败则不回滚，避免用户楼层指向旧战斗状态。
- 回归：自动测试分别注入清快照失败、结算失败、创建消息失败和 `/trigger` 失败，断言前三者完整恢复、最后一者保留结算；`BattleSessionStore.clear()` 不得吞错或留下错误的内部 generation/fingerprint。

## P35：选牌实机要同时验证 DOM 唯一性与牌区结果

- 症状：只看到弹窗无法证明旧专用 modal 已删除；只看到牌区变化也无法证明三个入口使用同一选择协议。
- 原因：历史实现曾同时存在通用选牌和弃牌专用弹窗，调用方又直接信任 Card 对象数组。单一截图或单元测试不能覆盖 Tavern iframe 委托事件、选择范围和 MUV 写回。
- 处理：真实指针回归同时记录通用 modal 数量、旧 modal 数量、候选范围、选择数量和确认后的牌区计数；规则层继续只信任核心校验后的稳定 ID。
- 回归：`0.5.69` 的预见夹具中 `.card-selection-modal=1`、`.discard-selection-modal=0`，显示 `0-3` 张；选择一张后抽牌堆 `7 -> 6`、弃牌堆 `0 -> 2`，刷新并重开仍恢复相同牌区、格挡 20 和 4 张手牌。这条证据替代 P26 中旧浏览器控制面无法派发 click 时留下的交互缺口。

## P38：现代卡牌命令不能往返旧表达式

- 症状：现代浅层 JSON 已编译为明确 `EffectCommand`，Tavern 宿主却先把它转换成伪旧 `EffectExpression`，再由旧卡牌宿主和 `CardSystem` 重新解释选牌、牌区与卡牌修改；复杂卡牌会因此存在两套语义和两次适配。
- 原因：迁移宿主时只移动了方法位置，没有把现代命令的执行所有权一起移入可移植核心；兼容层被当成现代运行时使用。
- 处理：`CardEffectRuntime` 直接消费全部现代卡牌命令并持有两阶段牌区与选择协议；旧字符串只能由 `TavernCardEffectHost` 单向归一化后进入相同运行时。`0.5.73` 已进一步删除当时用于其余命令的 `effectCommandAdapter.ts`。不得为兼容输出反向扩展 AI 字段或 MUV schema。
- 回归：`test-card-effect-runtime.mjs`、`test-card-effect-host.mjs`、现代命令、牌区、事务与结构门禁共同覆盖；`0.5.72` 真实“星见”预见选择、快照和刷新恢复通过，输出格式与 token 不变。

## P39：现代数值命令不能继续借旧表达式执行

- 症状：现代 `EffectCommand` 已包含明确目标、数值、状态和修饰符，却仍先转成 `[mwg.effect/v1]` 伪旧 `EffectExpression`，再进入面向历史字符串的通用 switch；数值规则、状态生命周期和叙事边界因此仍与旧 parser 数据结构耦合。
- 原因：早期直连只移除了“现代 AST 回编译成旧字符串”，保留了第二层“现代命令适配成旧表达式”，导致迁移看似完成但执行所有权仍在兼容层。
- 处理：`BattleEffectRuntime` 直接执行现代伤害、治疗、格挡、能量、欲望、`set_*` 和修饰符；状态、能力注册和叙事直达类型化宿主端口；删除 `effectCommandAdapter.ts`。旧 `executeExpression()` 仅由 `TavernLegacyEffectHost` 使用，不能重新成为现代入口。
- 回归：核心测试覆盖修饰符、格挡吸收中途触发、clamp、欲望溢出和死亡；结构门禁拒绝现代 host import `EffectExpression`。`0.5.73` 最终卡实测五张现代效果卡、官方消息快照和整页刷新恢复，最终为玩家 `68/80 HP`、9 格挡、`4/3` 能量，敌人 `27/36 HP`、`20/100` 欲望与 2 层 `weak`，玩家 `focus` 已移除。

## P40：动态状态不能把现代程序回编译成旧字符串

- 症状：状态的浅层 `effects` 已能编译为现代程序，但状态定义模块又把它们转换成伪 `ME/OP` 字符串；展示、hold 修饰符和触发执行会出现两种来源，复杂状态还会因为字符串格式化丢失结构信息。
- 原因：把“旧聊天兼容”误当成“现代状态的存储格式”，并让 fish 状态管理器同时承担规范化、写回 MUV、时间戳和注册表职责。
- 处理：`game-core/statusDefinitionRuntime.ts` 统一规范化和注册。现代触发器只进入 `triggerPrograms`，旧字符串只进入 `triggers`；`DynamicStatusManager` 只读取当前楼层 MUV 并代理查询，读取失败先清空缓存。写回 MUV 仍由战斗状态/快照宿主负责，不由定义注册表写回。
- 回归：状态定义核心、动态状态、状态生命周期、被动修饰符、战斗触发、核心边界和 Tavern 契约测试通过；结构门禁拒绝核心依赖 Tavern/MUV/DOM/日期，也拒绝 fish 恢复状态定义写 API。`0.5.74` 真实夹具依次执行 `apply -> hold -> stack -> remove -> apply`，得到 `45 HP / 8 block / star_mark:1`；结束回合执行 `tick -> stacks_change:-1 -> remove`，敌人攻击后得到 `49 HP / 0 block / 无状态 / turn 2`。官方消息快照、刷新和最近聊天重开一致，且原生正文外只有一个战斗 iframe。

## P41：SillyTavern 主应用未完成初始化时不能归因到角色卡

- 症状：新标签通过第一段英文 `Initializing...` 后又长期停在中文“正在初始化”，页面没有角色、消息或项目 iframe；重复刷新和重启服务仍可能只看到 `Settings not ready, scheduling another save`。
- 原因：故障发生在 SillyTavern 设置/角色目录初始化阶段，角色卡的共享脚本和正则壳尚未开始执行。多标签长期运行会放大设置快照竞争，但关闭标签和重启后仍需以“是否出现目标消息 iframe”为判断边界。
- 处理：先核对服务端 `settings.json`、角色 PNG、聊天 JSONL 和嵌入正则权限，再读取浏览器控制台。只有进入目标消息 iframe 后出现 `MagicGirlWorld`、MUV 或 Tavern Helper 错误，才归因到项目代码。不得把 HTTP 导入成功或自动契约通过写成真实交互通过。
- 回归：`0.5.74` 首次导入长期 dataRoot 为 `魔法少女世界195.png` 时触发该问题；该目录含 200 张历史卡，角色目录 API 长期不返回。切换到已有的 4 卡 selfcontained dataRoot 后，`魔法少女世界2.png` 在同一 SillyTavern `1.18.0` 正常初始化并完成五卡、状态、快照、刷新和单楼层 iframe 回归，证明阻断不在角色卡运行时。

## P42：迁移触发器时不能让静态测试锁住旧宿主实现

- 症状：能力/遗物定义匹配和递归门禁已经迁入核心，旧测试仍要求 fish 宿主出现 `activeTriggers`、自行遍历 relic 或解析 ability；为了让测试通过会被迫保留第二套规则。事件 dispatch 若仍只转发 `target,trigger`，伤害/格挡数值 context 也会在迁移时静默丢失。
- 原因：测试约束了旧类的实现文本，而不是“核心拥有规则、宿主拥有事务与呈现”的行为边界；调用签名又没有覆盖完整事件 context。
- 处理：核心 `AbilityTriggerRuntime/RelicTriggerRuntime` 持有计划解析、顺序和递归集合；宿主测试只要求委托核心，并继续检查每项计划包在 `runTriggerTransaction` 内。`runBattleTriggerDispatches` 的 context 原样进入 ability runtime，再由宿主补入 `triggerType/abilityContext`。
- 回归：核心测试覆盖现代优先、旧别名、嵌套片段、同触发递归跳过、异常后重试和外部参考宿主；`0.5.75` 实机首张牌得到 6 伤害与 15 格挡，刷新后第二张得到 7 伤害并把格挡增至 30，再次刷新恢复同值，证明定义没有重复注册、门禁没有卡死、事件顺序和消息快照一致。

## P43：生命周期迁移后测试必须跟随规则所有权

- 症状：状态生命周期已经迁入核心，遗物矩阵、触发事务和触发目录测试仍要求 fish 中存在 `processStatusOwnershipTriggers`、`status_tick` 或 `status_remove` 实现文本，完整发布因此在功能测试之后失败。
- 原因：静态测试锁定了旧宿主私有方法名，而不是“核心拥有规则、Tavern 宿主只注入端口”的边界。
- 处理：测试直接读取 `StatusLifecycleRuntime` 的事务与所有权分发，并明确拒绝 fish 恢复 `resolveStatusApplication/applyStacksDecay/removeOne/clearLegacyDirectModifiers`。呈现事件里的 `status_removed` 文本不能被误判为旧事务实现。
- 回归：`0.5.76` 完整发布门禁通过，实机状态夹具覆盖施加、hold、叠层、显式移除、重新施加、tick、衰减移除、消息快照和刷新恢复。

## P44：首次夹具必须在世界书确认后重新创建

- 症状：刚导入新文件名后立即创建战斗夹具，iframe 可在内嵌世界书确认框出现前开始加载；确认后旧 iframe 仍可能持有未初始化 schema，点击卡牌报 `expected object schema but got undefined`。
- 原因：角色卡导入 API、前端角色选择、内嵌世界书确认和 MUV iframe 初始化是四个独立时序。夹具里预填 `initialized_lorebooks` 不能替代 SillyTavern 把当前角色文件链接到真实世界书。
- 处理：先选择最终角色卡并确认 `魔法少女世界<version>`，随后重新创建一个全新时间戳夹具，再从最近聊天打开。确认前生成的夹具不得作为实机证据。
- 回归：`0.5.76` 首个 `08-47-37Z` 夹具因确认时序废弃；确认世界书后创建的 `08-52-55Z` 夹具完整通过，刷新重开仍是 `49/80 HP`、无状态、回合 2、唯一 iframe。

## P45：旧语法兼容不再是产品约束

- 完成：`0.5.77` 的 AI 与生产运行时只支持现代浅层 JSON + 简易公式；旧 `ME/OP`、`target.trigger(effects)`、旧条件/选择器/插牌字符串及其 parser、host、adapter、反向展示转换和专用测试已删除。
- 约束：先封存已实机通过的 `0.5.76` 角色卡作为回退点，再按世界书、调用点、模块、测试顺序删除。不得保留两套执行器，也不得用更深 JSON 或新增 MUV 字段换取程序实现方便。
- 回归要求：新卡只用现代夹具做一次完整发布与真实酒馆回归；旧聊天失败属于明确的版本边界，不再触发兼容修复。

## P46：Windows 文件占用不能让发布器无限失败

- 症状：连续构建或 SillyTavern 正在读取产物时，写入运行时、正则或角色卡偶发 `UNKNOWN`、`EBUSY`、`EPERM`，同一份源码重跑又能成功。
- 原因：Windows 防病毒扫描、浏览器或酒馆进程可能短暂持有文件句柄；这不是内容契约错误，但也不能用无限重试掩盖真实路径和权限问题。
- 处理：发布器只对这三类可恢复文件占用错误执行有限次数、短退避重试；其他错误立即抛出。重试耗尽仍失败，并保留目标路径与原始错误。
- 回归：最终 `npm run release:tavern` 在 SillyTavern 运行期间完整通过，产物哈希可重复读取；错误码不在白名单时测试必须立即失败。

## P47：清理兼容模块后必须扫描未接入 npm 的孤立脚本

- 症状：类型检查和完整发布都通过，但仓库中仍可能存在未被 `package.json` 调用、引用已删除模块的旧测试；维护者单独运行时才发现失败。
- 原因：删除生产入口和发布门禁时，只沿当前命令依赖图清理，没有扫描全部可执行脚本中的源码路径。
- 处理：兼容清理收尾同时扫描 `scripts/` 对已删除 parser、host、adapter、selector 和 UI 文件的引用。删除不再代表现代行为的孤立测试；现代选择和展示继续由核心测试与 `EffectProgramDisplay` 门禁覆盖。
- 回归：`0.5.77` 已删除 `test-card-selector-syntax.mjs` 和无人使用的 fish 历史类型重导出；最终静态扫描不得出现对已删除模块的正向引用。

## P48：可移植快照不能继续藏在 Tavern 模块

- 症状：网站或 Mod 虽能复用 `game-core` 战斗规则，但必须复制 fish 的 fingerprint、schema 和运行时对象完整性校验，保存格式会逐宿主漂移。
- 原因：快照最初和消息变量命名空间写入放在同一个 `fish/core/battleSession.ts`，规则契约与 Tavern 存储边界没有真正分开。
- 处理：`game-core/battleSnapshot.ts` 只接受纯对象并显式接收 `savedAt`；fish 适配器只包裹命名空间，外部宿主可以直接使用同一 schema。日期不再由纯核心隐式读取。
- 回归：portable bundle 和声明消费者实际执行快照读取；boundary 门禁拒绝核心/适配器依赖 Tavern、MUV、DOM、`Date.now`、`Math.random` 或动态代码。

## P49：独立 bundle 必须验证真实消费者而非只看文件存在

- 症状：可以生成 `.mjs` 和 `.d.ts`，但导出名、类型路径或运行时入口可能互相不一致，外部项目安装后才失败。
- 原因：单纯检查文件大小和构建退出码不能证明 package exports、声明路径和实际运行时相符。
- 处理：发布清单固定 card/battle/combined 三个入口、版本和哈希；测试从磁盘动态导入三个 bundle，执行核心行为，并用独立 `tsconfig.portable-consumer.json` 编译外部消费者夹具。
- 回归：`npm run build:portable`、`npm run test:portable-package` 和 `npm run test:portable-boundary` 纳入 `release:tavern`。

## P50：教程模板和未接入界面不能长期留在生产源码树

- 症状：维护者在 `src/` 看到第二套手机聊天、动态空间、脚本/界面模板和示例，会误以为它们仍是角色卡功能，搜索、类型审计和重构范围被无关代码放大。
- 原因：初始 Tavern Helper 模板仓库内容与项目源码一起提交，但 `config.yaml` 从未构建这些入口，生产模块也没有 import。
- 处理：删除不可达目录，Git 历史作为唯一存档；顶层源码目录白名单固定七个真实所有权根。未来示例应放文档或独立样例包，不能和生产入口并列。
- 回归：`test:source-layout` 纳入完整发布；删除前后角色卡和角色运行时哈希必须保持一致。

## P51：可选入口必须在真实 iframe 中可命中并验证写回

- 症状：DOM 快照能看到“开始远征”，按钮也显示 enabled，但入口位于 989px 高状态栏的牌组、遗物和道具之后；自动 click 会因外层聊天滚动与 iframe 内坐标换算超时，容易被误判为业务事件未绑定。
- 原因：Tavern Helper 的消息 iframe 会随内容自动增高，浏览器控制面定位到内层元素不等于外层视口已经滚到相同物理位置。与此同时，common 曾把初始化绑定放在 jQuery ready 中，深层入口的真实证据不足。
- 处理：远征入口移到“卡牌与资源”第一项；common 使用原生幂等 DOM readiness 和 document 委托绑定。点击前确认新角色世界书已导入、侧栏已关闭、iframe `data-mwg-runtime` 等于目标版本；点击后必须同时检查 UI 与消息 MUV，不以 locator 成功作为结论。
- 回归：`0.5.83` 的 `魔法少女世界11.png` 在夹具 `readiness-valid-2026-08-23T15-18-59Z` 中默认 `run=null`、路线隐藏。真实点击后状态栏显示“Act 1 · 选择第 1 层路线”，MUV 为 `awaiting_choice / act 1 / floor 0 / gold 99`，节点为 `a1_f1_battle_0_0`；整页刷新并从最近聊天重开后完全恢复。

## P52：MUV 字段迁移不能只靠全文搜索和终端显示

- 症状：世界书、初始化 JSON、宿主读取和程序写回各自看似正确，但某个旧字段仍藏在诊断脚本或历史文档的“当前规则”章节；Windows PowerShell 默认解码还可能把合法中文显示成乱码，导致误判文件损坏。
- 原因：文本搜索无法区分 AI 公共字段、核心内部 camelCase 类型和用于拒绝旧输入的负向测试；终端显示编码也不是文件字节或 JSON 解析结果。
- 处理：`mwg-mvu-stat-data/v1` 逐字段声明 shape、所有权、生命周期和操作，自动从 `变量初始化.json` 展开比对，并只扫描正式世界书与宿主边界的废弃路径。中文值必须用 UTF-8 JSON 解析或字节检查确认，不能依据未指定 `-Encoding utf8` 的终端输出修改。
- 回归：当前 57 个路径全部覆盖；正式世界书、status/MUV/battle settlement 适配器和快照报告无旧字段回退。`player_alignment` 经 UTF-8 JSON 解析确认为“绝对中立”，文件没有发生编码损坏。

## P53：主体战斗夹具不能默认创建可选远征

- 症状：普通战斗 UI、状态生命周期和快照都通过，但官方变量报告显示 `run.phase=in_node` 与 `requestNodeId`；这只能证明远征内战斗，不能证明普通角色扮演中的独立战斗不依赖路线状态。
- 原因：历史 `test-real-tavern-battle-repair.mjs` 为了同时测试路线结算，在每个场景里无条件创建并进入第一层节点。远征改为可选后，夹具默认值没有随产品边界调整。
- 处理：真实战斗夹具默认 `mode=ordinary` 并写入 `run=null`；仅在命令末尾显式传 `run` 时创建远征节点。主体回归报告必须同时确认 `run=null` 和 `requestNodeId=null`。
- 回归：`0.5.84` 的普通状态战斗完成出牌、回合、状态 tick/衰减/移除、官方快照、整页刷新和最近聊天重开；快照为回合 2、`41/80 HP`、牌区 `5/0/5/0`，且 `run/requestNodeId` 均为 null。

## P54：战后审计必须区分候选内容与奖励操作

- 症状：模型生成“仔细查看本场已触发的遗物回声链路”作为正常剧情行动，粗粒度正则因为同时看到“查看”和“遗物”而误报为“查看奖励”；领取后 `reward.*` 已被清空，旧审计又把正确终态误报为候选数量为零。
- 原因：奖励操作是语义组合，不是任意动词与卡牌名词共现；待领取数组还是一次性 UI 状态，不能作为完成整个闭环后的唯一证据。
- 处理：只拒绝明确围绕“奖励/战利品/候选”的领取、放弃、跳过、查看和选择，或以领取动词开头并命中实际候选名的 Option。终态审计优先读取待领取 MUV；候选已清空时，从不可变 AI 回复的逐行 `_.assign('reward.*', JSON)` 重建候选，并使用 JSON5 解析而不是执行文本。
- 回归：`battle-repair-loop-2026-08-23T18-28-06Z` 在领取后仍还原 3 卡和 1 道具，正确报告 1 张坏卡、其余候选合法；验证“回声观测/镜光药水”永久入库、候选清空、普通剧情续写和 3 个下一步 Option，最终 `ok=true`。

## P55：酒馆侧栏覆盖层会吞掉 iframe 自动点击

- 症状：奖励领取后 Option 可见且 enabled，浏览器点击却没有创建消息；重复定位按钮和检查宿主代码均正常。
- 原因：连接 API 后左侧 API drawer 仍保持 `openIcon`，其透明/可视覆盖层位于消息 iframe 上方。自动化定位能命中 iframe 内按钮，但物理点击由侧栏接收；这不是 common 事件丢失。
- 处理：实机自动交互前检查并关闭所有顶层 drawer，再点击 iframe 控件；点击后同时验证聊天消息数量、最新楼层角色和 `/trigger` 状态，不以 locator 成功作为发送证据。
- 回归：关闭 API drawer 后，同一个 Option 立即创建“用户的选择是”楼层并附一次性奖励摘要，`deepseek-v4-flash` 返回普通剧情；刷新重开后最新状态栏恢复。

## P56：导入角色卡后必须切换当前卡并确认内嵌世界书

- 症状：PNG 文件解包能看到 `character_book`、`regex_scripts` 和 `tavern_helper`，但酒馆助手面板显示“没有找到脚本”，MUV 报“未能找到世界书”。
- 原因：SillyTavern 导入角色卡不会替用户完成当前角色切换；首次导入内嵌世界书还需要确认弹窗。酒馆助手脚本面板默认打开“全局脚本”或“预设脚本”，这两个列表为空时不能推断角色脚本丢失。
- 处理：在角色管理中点击最新 `魔法少女世界*.png`，确认内嵌世界书，或从“更多... -> 导入角色卡的世界书”手动执行；随后在 Tavern Helper “脚本”页切换到角色脚本库。远程酒馆导入后也必须完成同样步骤。
- 回归：本地 SillyTavern `1.18.0` + Tavern Helper `4.9.3` 选择 `魔法少女世界1.png` 后显示 `[MVU]变量初始化成功`、世界书 `魔法少女世界0.5.86`，角色脚本库显示“MVU变量框架”和“魔法少女世界运行时”；酒馆官方导出 PNG 往返后仍保留 14 条世界书、7 条正则和 2 个脚本。

同名卡补充：SillyTavern/Tavern Helper 会以角色显示名判断是否需要刷新角色脚本。发布卡现在使用 `魔法少女世界 0.5.86`，避免从旧的同名 `魔法少女世界` 切换时复用空的脚本状态。

脚本授权补充：角色卡只能携带脚本内容和每个脚本自身的 `enabled` 标记，不能替用户开启 Tavern Helper 的角色脚本总开关。项目的本地 `import:tavern-card` 验收工具会把发布角色名加入 `extension_settings.tavern_helper.script.enabled.characters`；用户在其他酒馆手动导入时，仍需首次在 Tavern Helper 的“脚本 -> 角色脚本”页开启当前角色的总开关。这是 Tavern Helper 的安全授权，不属于 PNG 导出内容。

## P14：严格宿主边界与当前 MUV 结构

- 不要在角色卡运行时伪造 `getVariables`、消息 ID、续写或 MUV API。伪宿主会让独立页面看似可用，却把真实酒馆的注入时序、世界书链接和消息楼层错误推迟到用户现场。
- common/fish 入口只连接真实 Tavern Helper。缺少核心函数时立即失败并显示缺失函数；消息操作必须携带所属 iframe 的明确 `message_id`，不得静默回退 `latest`。
- `$__META_EXTENSIBLE__$` 是 `变量初始化.json` 的 MUV schema 标记，只能在 runtime 顶层数组边界过滤。当前项目不接受旧 `[值, 描述]` 或 `[items, description]` 包装，禁止把 MUV 包装规则带进 `game-core` 或 portable bundle。
# 0.5.87 复盘

- 不要把 `dist/tavern` 中的 PNG 当作第二个发布卡。它只应保存 JSON/运行时调试资产；用户和导入脚本统一使用根目录 `魔法少女世界.png`。
- Tavern Helper 会对正则替换文本做 Markdown/HTML 二次处理。bootstrap 必须使用 ES5，且脚本段不能出现反引号、可选链、原始 `<` 或 `</script>`。
- `minDepth=0,maxDepth=2` 只决定 common 是否挂载，不能决定交互权限。common 在 depth 1/2 必须主动变成只读；超过窗口后才调用 `refreshOneMessage` 卸载。
- MVU 额外模型配置必须使用 `[config_override]` 和 `模型来源=与插头相同`，不能把密钥写进角色卡。`[mvu_plot]` 与 `[mvu_update]` 只写在世界书条目 comment，且发布器要同步更新 comment。
