# 魔法少女世界

面向 `SillyTavern + 酒馆助手 + MagVarUpdate` 的 AI 角色扮演卡牌战斗角色卡。项目以真实酒馆消息楼层为唯一发布环境，不以独立网页可玩为目标。

## 当前版本

- 当前候选：`0.5.87`
- SillyTavern 实机基线：`1.18.0`
- 酒馆助手最低版本：`3.4.17`，实机版本：`4.9.3`
- MagVarUpdate：`0a730cd4`（固定 commit，支持额外模型解析）
- 最终角色卡：仓库根目录 `魔法少女世界.png`（唯一可导入交付物）。`dist/tavern` 仅保存正则 JSON 与运行时调试产物。
- 角色显示名：`魔法少女世界 0.5.87`

发布器会把世界书、角色脚本、正则和 MVU 配置直接写入这张根目录卡；导入旧角色目录中的同名副本不会更新本项目。

版本和默认酒馆地址统一维护在 `release.config.json`。

## 内容协议

AI 只输出浅层 JSON 和简易公式。外部输入只接受 `effects`，卡牌的弃牌效果使用 `discard_effects`。以下入口已删除并会被拒绝：

- `effect`、`discard_effect`、`effect_program`、`effectProgram`
- `ME/OP/ALL`
- `target.trigger(...)`
- 字符串条件、字符串选牌器和字符串动态插牌
- 平铺 `battle` MUV 根；当前根固定为 `stat_data.battle`

简单卡牌：

```json
{"id":"moon_slash","name":"月轮斩","type":"Attack","rarity":"Common","cost":1,"quantity":5,"effects":{"damage":8}}
```

公式和条件：

```json
{"id":"last_light","name":"终末星光","type":"Attack","rarity":"Rare","cost":"energy","quantity":1,"effects":{"damage":"spent_energy * 5 + self.block","when":"self.hp < self.max_hp / 2"}}
```

生成卡牌：

```json
{"id":"spark_forge","name":"火花锻造","type":"Skill","rarity":"Uncommon","cost":1,"quantity":1,"effects":{"add_card":"spark","count":2},"creates":[{"id":"spark","name":"火花","type":"Attack","rarity":"Common","cost":0,"effects":{"damage":3},"exhaust":true}]}
```

AI 不输出内部 `mwg.effect/v1`。运行时在内容边界将浅层 JSON 编译为 `EffectProgram`，之后校验、执行、展示、预算和快照都只消费这一份类型化程序。

完整格式见 `docs/ai-card-format-v1.md` 和 `worldbook_new/2战斗内容生成要求.md`。

## 运行链路

```text
AI 回复
  -> MUV 写入当前消息 stat_data
  -> 酒馆助手按楼层挂载轻量 iframe 壳
  -> 角色卡内 MagicGirlWorld 运行时提供版本化 start/common/fish 资源
  -> 内容契约预检并编译 effects
  -> BattleStateStore + EffectProgram 运行战斗
  -> 私有消息快照保存进行中的战斗
  -> 结算适配器原子写回 MUV
```

生产代码的主要边界：

- `src/game-core/`：无 Tavern、DOM 和 MUV 依赖的内容契约、效果程序、状态、事务、牌区、回合和后端规则。
- `src/fish/core/`：SillyTavern/MUV 宿主适配、消息快照和运行时副作用端口。
- `src/fish/ui/`：fish iframe 的显示和交互，不解析 AI 字符串。
- `src/runtime/`：酒馆助手等待、共享角色运行时、MUV 读取与战后结算。
- `src/common/`：状态栏与远征/奖励事务。
- `worldbook_new/`：AI 当前唯一生成协议。
- `src/portable/`：可独立发布的 card/battle/combined ESM 公共入口；不依赖酒馆、MUV 或 DOM。

卡牌处理和战斗后端可以从 `src/game-core` 独立组合；网站、服务或 Mod 只需实现状态、选择、事务和呈现端口，不需要引入 Tavern Helper。

可选的后端包构建产物位于 `dist/portable/`：

```bash
npm run build:portable
npm run test:portable-package
```

其中 `card-backend.mjs` 只导出卡牌/内容契约，`battle-backend.mjs` 额外导出战斗状态、事务、快照和参考宿主，`magic-girl-core.mjs` 以命名空间同时提供两者。三者均带 `0.5.86` 版本清单、SHA-256 和 `.d.ts` 声明；外部消费者夹具会实际通过声明编译。

## UI 楼层规则

- start 只允许 AI 消息 0。
- common/fish 只允许最新 AI 楼层，且互斥挂载。
- 正文保持 SillyTavern 原生内容，不进入 iframe。
- common 仅在正文末尾追加可交互状态栏。
- 战斗页继续出现在原生战斗引导正文之后。
- 普通 AI 剧情是默认模式；`run` 初始为 `null`，不会自动生成路线、营火、商店或 Boss。
- 玩家在“卡牌与资源”中显式点击“开始远征”后，才创建并显示远征路线。
- 状态更新只刷新内部视图，不重新挂载消息外层页面。
- 历史楼层不得保留可运行的完整前端或重复 iframe。

## 构建发布

```bash
npm install
npm run release:tavern
```

`release:tavern` 依次执行类型检查、现代核心/事务/MUV/楼层测试、生产构建、酒馆正则导出、角色卡补丁和 PNG 契约验证。

导入本机酒馆：

```bash
npm run import:tavern-card
```

默认连接 `http://127.0.0.1:8012/`。导入新文件名后，仍需在 SillyTavern 中确认角色卡内嵌世界书；导入脚本会同步允许该角色的局部正则。

### 导入后首次启用

角色卡的世界书和酒馆助手脚本属于 SillyTavern 的角色卡扩展数据，不会在独立图片查看器中显示。导入后请：

1. 在角色管理中选择显示名为 `魔法少女世界 0.5.86` 的最新文件（通常是酒馆自动重命名后的 `魔法少女世界*.png`），不要继续使用根目录旧卡。
2. 首次出现“此角色包含内嵌世界书”提示时选择“是”。如果没有弹窗，在角色面板的“更多...”中选择“导入角色卡的世界书”。
3. 打开酒馆助手 `4.9.3` 的“脚本”页，确认切换到当前角色脚本库；应能看到“MVU变量框架”和“魔法少女世界运行时”。“全局脚本”或“预设脚本”为空不代表角色脚本丢失。
4. 状态栏出现 `[MVU]变量初始化成功` 且显示 `魔法少女世界0.5.86` 后，再开始聊天。

只导入 PNG 但不选择当前卡，或只打开全局/预设脚本库，会看到空列表；这是酒馆的选择和导入流程，不是卡内字段缺失。官方“导出并下载 -> PNG”往返测试会保留 14 条世界书、7 条正则和 2 个角色脚本。

开发模式只用于检查资源加载，不替代实机验收：

```bash
npm run dev:tavern
```

## 实机验收

`0.5.86` 已在 SillyTavern `1.18.0`、酒馆助手 `4.9.3`、MagVarUpdate `v0.181.0` 中通过最终 PNG 的普通剧情、普通战斗、AI 战后结算、奖励领取、剧情续写和刷新恢复回归。角色卡导入为 `魔法少女世界14.png`，并确认链接内嵌世界书 `魔法少女世界0.5.86`。

普通模式夹具 `readiness-valid-2026-08-23T16-07-44Z` 保持 `run=null`：原生正文位于 iframe 外，目标楼层只有一个状态栏 iframe；“继续调查/进入战斗”各一个，路线区不存在，展开“卡牌与资源”后只有一个“开始远征”。

普通战斗夹具 `battle-repair-status-2026-08-23T16-24-04Z` 同样保持 `run=null`。打出“星痕叠印”后手牌 `5 -> 4`、弃牌 `0 -> 1`，获得 1 层星痕与 3 格挡；结束回合后状态执行 tick、衰减和移除，进入回合 2，玩家 `41/80 HP`、无状态、手牌 5、抽牌堆 0、弃牌堆 5。官方消息快照和整页刷新后从最近聊天重开均恢复相同状态，原生引导正文仍在战斗 iframe 外且位于其前。

完整闭环夹具 `battle-repair-loop-2026-08-23T18-28-06Z` 从 `run=null` 开始。零费“闭环终击”结束战斗后，真实 `deepseek-v4-flash` 在同一回复生成 3 个领奖后的剧情 Option、3 张卡牌候选、1 个道具候选和 25 EXP。MUV 将 `LV1/90` 结算为 `LV2/15`；一张非法卡在 UI 中显示精确原因并禁用，其他候选仍可领取。领取“回声观测”和“镜光药水”后候选清空、永久内容各增加一次、Option 自动恢复；点击 Option 后奖励摘要进入结构化用户消息，模型返回普通剧情、下一组选项和最新状态栏。整页刷新并从最近聊天重开后只保留最新 AI 楼层的一个 iframe，等级、经验、牌组、道具、`run=null` 和空敌人均恢复。可用以下只读命令复核聊天文件：

```bash
npm run tavern:audit-battle-loop -- 魔法少女世界14.png battle-repair-loop-2026-08-23T18-28-06Z
```

`0.5.83` 的可选远征入口实机基线继续有效：只有玩家点击“开始远征”才创建 `run`。本批没有修改远征生产逻辑，也没有把 Boss、营火等内容加入普通流程。

发布批次至少验证：

1. 角色卡和版本化世界书可导入。
2. 原生正文不被 iframe 包裹，目标楼层只有一个 iframe。
3. 现代卡牌、能力、遗物、状态和敌人行动能执行。
4. 结束回合后的生命、格挡、状态、手牌和回合号正确。
5. 整页刷新及重开聊天后从当前消息私有快照恢复相同状态。
6. 战斗结束确认后只清理当前 `stat_data.battle` 的临时数据。
7. 普通剧情不会自动创建 `run`；手动开始后路线和 MUV 存档可刷新恢复。
8. 战后坏候选只能禁用自身，领取有效奖励后剧情 Option 必须恢复并能回到普通 AI 回复。

可创建隔离回归聊天：

```bash
npm run tavern:battle-repair-chat -- valid <导入后的角色文件名>
npm run tavern:battle-repair-chat -- status <导入后的角色文件名>
npm run tavern:battle-repair-chat -- triggers <导入后的角色文件名>
```

以上命令默认创建 `run=null` 的普通战斗。只有联调可选远征结算时才在末尾显式追加 `run`，例如 `npm run tavern:battle-repair-chat -- status <角色文件名> run`。

## 维护规则

- 不恢复旧字符串 parser、host、adapter 或反向编译展示链。
- 不为方便程序而增加 AI 包装字段；优先减少模型记忆、嵌套和 token。
- 一个规则只在核心维护一次，fish 只做宿主适配和呈现。
- 不在 UI 中用正则推断效果，展示直接读取 `EffectProgram` 或权威 `description`。
- 修改酒馆助手、MUV、快照、终态或发布器后，必须用最终 PNG 做真实 SillyTavern 回归。
- 当前主线固定使用 MUV `v0.181.0` 的随 AI 输出模式；上游“额外模型解析”升级记录在 `docs/future-mvu-extra-model.md`，不属于本版本运行契约。

重构过程、决策和踩坑记录见 `docs/refactor-log.md`、`docs/legacy-syntax-audit.md` 与 `docs/tavern-helper-pitfalls.md`。
