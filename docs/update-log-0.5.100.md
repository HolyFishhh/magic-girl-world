# 0.5.100 本地验收记录

## 修复内容

- 世界书标记全部改为字面关键词匹配，修复 `[开始战斗]` 等方括号标记被当成正则字符类而误激活的问题。
- 首轮完整初始化不再只依赖 `<CHARACTER_INIT_PENDING>`；运行时读取 MVU 更新前快照，空卡组事务必须生成至少 10 张牌、遗物、道具、欲望效果、核心资源和等级。
- 第二阶段在剧情已经明确进入即时战斗、但主模型漏掉 `<BATTLE_PENDING>` 时，可以按紧凑敌人规范注册 `battle.enemy`。
- 运行时检测“空敌人变为合法敌人”并自动启动战斗，不读取或限制用户输入。
- 角色脚本兼容酒馆真实 iframe 边界，从父页面读取 `window.parent.Mvu` 并安装变量更新事件监听。
- 发布角色使用新名称 `魔法少女世界 0.5.100`，避免 SillyTavern/Tavern Helper 复用旧同名卡缓存。

## 真实酒馆证据

- 环境：SillyTavern `1.18.0`，Tavern Helper，固定 MVU，DeepSeek `deepseek-v4-flash`。
- `0.5.99` 真实双模型回复生成：5 种、总 quantity 10 的初始牌组；1 个遗物；1 个战斗道具；完整玩家欲望效果；敌人“噬心獠”58 HP、3 个行动。
- `0.5.100` 官方导入并链接世界书 `魔法少女世界0.5.100` 后，复用上述真实回复执行 MVU 重解析；回复没有 `<BATTLE_PENDING>`，运行时仍自动打开战斗页。
- 战斗页显示回合 1、噬心獠 58/58 HP、敌人意图、5 张起手牌、3/3 能量、玩家 100/100 HP、开战遗物格挡和可用道具。
- 内容校准结果：牌组 10 张，攻击预算 22、防御预算 14、抽牌 1、能量 1；敌人预算 33-66 HP、5-15 单次伤害，实际无预算警告。

## 自动验证

- `npm run typecheck`
- `npm run test:worldbook-contract`
- `npm run test:tavern-character-runtime`
- `npm run verify:tavern`
- `npm run tavern:calibrate-content -- "魔法少女世界 0.5.100.png" "runtime-handoff-replay-2026-08-25T09-43-00Z"`

本版本仅在本地工作区和本地酒馆验收，尚未提交或推送主项目与卡图仓库。
