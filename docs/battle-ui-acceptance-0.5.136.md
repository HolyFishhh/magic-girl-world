# 战斗 UI 与战后交接验收：0.5.136

## 本轮结果

- 战斗页面收敛为一套 `640px` 高布局，继续采用旧版星空视觉；敌方、战斗舞台、手牌、我方和底部操作区均在同一屏内。
- 桌面端由 Pointer Events 接管单张卡牌拖动，保留跟随、光泽、投放反馈、取消返回和成功飞出动画；`Animation.finished` 未返回时由 `420ms` 保险清理拖牌副本，不阻塞实际出牌。
- 战斗历史按回合压缩后交给剧情模型，同回合重复行动合并为 `名称×次数`。另行附带完整卡组、遗物、能力及来源、道具、双方欲望效果、敌方行动，以及最终敌我属性、状态和牌堆。
- 战后页面增加最多 500 字的可选玩家行动。内容与战报一起发送；留空时由剧情模型自然衔接。
- 胜利、失败和终止分别使用绿色、红色和灰蓝色强调，不再共用同一结果色。

## 自动回归

以下命令均通过：

- `npm run typecheck`
- `npm run test:event-flow`
- `npm run test:battle-snapshot-report`
- `npm run test:battle-session-store`
- `npm run test:battle-contract`
- `npm run test:mvu-battle-adapter`
- `npm run test:battle-terminal`
- `npm run build`
- `npm run export:tavern`
- `npm run test:tavern-character-runtime`
- `npm run patch:card`
- `npm run verify:tavern`
- `npm run import:tavern-card`
- `npm run tavern:verify-import`

`test:battle-session-store` 会主动模拟一次存储不可用并打印预期错误栈，进程退出码仍为 `0`，对应回滚断言通过。

## 真实 SillyTavern 验收

环境：SillyTavern `1.18.0`，地址 `http://127.0.0.1:8012/`，角色 `魔法少女世界 0.5.136`。

角色官方导入后读回：

- 世界书：`魔法少女世界0.5.136`
- 世界书条目：20
- 内嵌正则：7 条，允许运行
- 角色脚本：`MVU变量框架`、`魔法少女世界运行时`，允许运行
- 活跃角色文件：`魔法少女世界 0.5.136.png`

实际聊天：

- 可操作战斗：`battle-ui-fixture-0.5.136-2026-08-28T04-26-55Z`
- 胜利：`battle-ui-fixture-0.5.136-2026-08-28T04-45-58Z`
- 失败：`battle-ui-fixture-0.5.136-2026-08-28T04-47-37Z`
- 终止：`battle-ui-fixture-0.5.136-2026-08-28T04-42-29Z`

真实页面结果：

- 519px 宽、640px 高的消息 iframe 中，三种结算页 `body.scrollWidth === viewportWidth === 519`，没有横向溢出。
- 三种弹窗面板均为约 `495.2 × 411.7px`，完整显示结果、说明、自定义行动、计数器和两个操作按钮。
- 胜利结果色为 `rgb(76, 175, 80)`；失败为 `rgb(244, 67, 54)`；终止为 `rgb(84, 110, 122)`。
- 胜利页输入“先检查敌人的遗留物，再确认同伴是否受伤。”后，计数器由 `0/500` 更新为 `20/500`。
- 可操作战斗中拖出会抽牌的“西露风刃”后，能量由 `1/3` 降为 `0/3`，手牌仍为 6 张；`.card-ghost` 与 `.enhanced-card.dragging` 均归零，没有双重卡牌或残影。
- 浏览器仅出现控制插件自身的 Statsig 网络超时；页面内没有魔法少女世界运行时错误。

## 最终角色卡

- 文件：`魔法少女世界.png`
- 大小：`7,978,117` 字节
- SHA-256：`DEF1A63B2E49B7FE546C67F1B46F44BAF20D00F3E9B4C24E7DE449FABAFCAE8B`
- 本轮未提交、未推送 Git，等待正式发布确认。
