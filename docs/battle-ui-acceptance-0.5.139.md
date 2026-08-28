# 战斗 UI 与实体卡拖动验收：0.5.139

## 本轮结果

- 桌面端直接拖动当前实体卡，不再创建半透明副本或浏览器原生拖动虚影。
- 拖动使用 `requestAnimationFrame` 合并移动和 `translate3d`，出牌结算不等待表现动画；取消拖动时同一张卡平滑返回手牌。
- 顶部牌堆显示“牌组、抽牌、弃牌、消耗”及各自数量，不再只显示无意义数字。
- 完整牌组弹窗使用自适应网格，并在每张卡中保留费用、稀有度、类型、描述和完整中文效果。
- 欲望效果显示为“欲望效果：名称”，点击名称后展示所属方、完整描述和实际效果。
- 变量更新楼层默认折叠；纯攻击、无格挡或无治疗构筑不再触发偏好型错误。

## 自动回归

- `npm run typecheck`
- `npm run test:event-flow`
- `npm run test:pile-viewer-contract`
- `npm run test:modern-source-contract`
- `npm run test:player-content-readiness`
- `npm run test:battle-content-preflight`
- `npm run release:tavern`
- `npm run import:tavern-card`
- `npm run tavern:verify-import`

## 真实 SillyTavern 验收

环境：SillyTavern `1.18.0`，地址 `http://127.0.0.1:8012/`，消息 iframe 宽约 519px。

- 使用聊天 `battle-ui-fixture-0.5.139-2026-08-28T06-50-13Z` 进入 `player_turn`，初始手牌 6 张、能量 `3/3`、敌方生命 `100/100`、弃牌堆 2 张。
- 把实体“灰爪撕咬”拖到中央战斗舞台后，敌方生命变为 `88/100`、能量变为 `2/3`、手牌变为 5 张、弃牌堆变为 3 张。
- 出牌后 `.card-ghost` 为 0，`.enhanced-card.dragging` 为 0；手牌中没有残留副本或拖动状态。
- “完整牌组 (13张)”弹窗按四列网格显示，多张同名牌分别可见，没有横向裁切或叠牌。
- 点击“契约共鸣·魔力暴走”后，弹层显示我方欲望效果、完整描述、`自身获得2点能量` 与 `抽2张牌`。
- 顶部实际显示“牌组 13、抽牌 3、弃牌 2、消耗 2”，双方欲望效果均为文字名称入口。

## 最终角色卡

- 文件：`魔法少女世界.png`
- 大小：`7,991,901` 字节。
- SHA-256：`ABF200FA2440AC471D014A727AE2B3C07D70E0B36DA5169861CE453E1208B765`。
- 官方导入读回：角色 `魔法少女世界 0.5.139`、世界书 `魔法少女世界0.5.139`、20 条世界书、7 条正则、2 个角色脚本。
- 本轮不提交、不推送 Git。
