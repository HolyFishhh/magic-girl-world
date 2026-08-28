# 变量更新独立 HTML 验收：0.5.132

## 目标

把角色正则原有的“删除 `<UpdateVariable>`”改为在同一消息楼层渲染独立 HTML，并保证普通剧情与战斗消息都能显示本轮实际更新，不再依赖 `delta_data` 或普通状态栏内的变化摘要。

## 环境

- SillyTavern：`1.18.0`
- 酒馆助手：本地全局扩展 `third-party/JS-Slash-Runner`
- 角色：`魔法少女世界 0.5.132`
- 世界书：`魔法少女世界0.5.132`，20 条
- 角色正则：7 条
- 角色脚本：`MVU变量框架`、`魔法少女世界运行时`
- 测试聊天：`update-display-0.5.132-2026-08-28T02-15-52Z`

## 真实酒馆结果

- 通过官方接口导入并读回角色卡；角色正则与角色脚本权限均已启用。
- 普通楼层生成 2 个 iframe：`update` 与 `common`。战斗楼层生成 2 个 iframe：`update` 与 `fish`。页面中不再残留 `<UpdateVariable>`、`<StatusPlaceHolderImpl/>` 或 `<BATTLE_START>`。
- 使用“资源亲和者”回归块读取到 10 项命令：时间、地点、职业、服装、剧情物品、玩家核心、卡牌、遗物、道具和玩家欲望效果，无字段遗漏。
- 卡牌、遗物和道具的效果标签复用游戏核心展示规则。X 费卡在真实楼层显示为“对敌方造成（已支付能量×6）点伤害”，没有出现原始公式或英文效果字段。
- 职业能力只显示一次；空服装槽与缺省 emoji 不再显示为“无”。
- 战斗楼层同时显示敌人更新和战斗页面；战斗页读到玩家 `100/100`、敌人 `41/48`，证明独立更新 HTML 没有阻断战斗变量与 fish 初始化。
- 更新页和常态状态栏均限制在最近三层，战斗页仍只在最新楼层交互。普通状态栏中已没有旧“本次变化”区域。

## 自动验证

- `npm run typecheck`
- `npm run test:modern-source-contract`
- `npm run test:common-interface`
- `npm run build`
- `npm run export:tavern`
- `npm run test:tavern-character-runtime`
- `npm run patch:card`
- `npm run verify:tavern`
- `npm run tavern:verify-import`
- `npm run tavern:update-display-chat -- "魔法少女世界 0.5.132.png"`

## 最终产物

- 根角色卡：`魔法少女世界.png`
- 大小：`7,938,325` 字节
- SHA-256：`9F39A4E734F7433B742808B17971B0E821C4EB0005AB3AB9055C5159A3AAD0A3`

