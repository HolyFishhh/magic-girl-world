# 魔法少女世界

面向 `SillyTavern + 酒馆助手 + MagVarUpdate` 的 AI 角色扮演卡牌战斗角色卡。发布目标是真实酒馆消息楼层，不提供独立网页玩法。

## 当前发布

- 版本：`0.5.155`
- 角色显示名：`魔法少女世界 0.5.155`
- 唯一交付卡：根目录 `魔法少女世界.png`
- SillyTavern 实测基线：`1.18.0`
- 酒馆助手最低版本：`3.4.17`，实测版本：`4.9.3`
- MagVarUpdate：固定 commit `0a730cd4a9b99689d1135a49b542c780b977c24c`

角色卡内嵌世界书、7 条正则、MVU 脚本和角色运行时。`dist/tavern/` 仅保存调试 JSON/JS，不再输出第二张 PNG。

## 导入与启用

1. 在 SillyTavern 导入根目录 `魔法少女世界.png`。
2. 在角色管理中明确选择显示名为 `魔法少女世界 0.5.155` 的新卡，不要继续使用旧版本角色。
3. 首次出现“包含内嵌世界书”提示时选择“是”。若未出现，在角色“更多...”中执行“导入角色卡的世界书”。
4. 在酒馆助手的“脚本 -> 角色脚本”中启用当前角色。应能看到“MVU变量框架”和“魔法少女世界运行时”。全局脚本或预设脚本列表为空不代表角色脚本丢失。
5. 看到 MVU 初始化成功后开始新对话。

SillyTavern 会缓存同名角色、世界书和脚本状态。每次正式发布都会更换角色显示名与世界书名；测试时必须导入并选择新版本。

本地验证默认使用 `http://127.0.0.1:8012/`：

```bash
npm run import:tavern-card
```

该脚本通过 SillyTavern 官方导入接口上传 PNG，并为本地测试环境启用角色正则和角色脚本权限。其他酒馆仍需完成上述首次授权。

## 游戏流程

开始页只在首条 AI 消息渲染一次，提供剧情模式和暂不可用的爬塔模式入口。角色名、形象、世界观、身份、开场时机和卡牌体系都可留空；世界观与卡牌预设只提供方向，具体元素、状态和公式由剧情与 MVU 模型现场生成。变量模型直接使用 MVU 内置破限，无需额外安装或注册 preset；配置和调用时机见 `docs/mvu-extra-model-preset.md`。

普通回合：

```text
玩家输入
  -> 主模型输出原生剧情正文
  -> MVU 额外模型更新当前楼层变量
  -> 正文末尾追加状态栏
```

战斗回合：

```text
主模型完整描写敌人和遭遇，末尾输出 <BATTLE_PENDING>
  -> MVU 额外模型按这段描述注册敌人数据
  -> 角色运行时校验 enemy.name 与 actions
  -> 成功后转换为 <BATTLE_START>
  -> 引导正文后显示单屏战斗页
```

主模型不输出变量、JSON、公式、敌人数值或 AI 选项。它能读取玩家卡牌的自然语言效果、遗物、道具、状态、NPC 和势力，以剧情方式帮助玩家围绕现有机制建立构筑。第二阶段额外模型只负责把已完成剧情转换为变量更新，避免叙事与数值互相带偏。

MVU 默认配置为：额外模型解析、自动请求、内置破限、最近 2 层、最多 2 次顺序请求，并只向额外模型发送 `[mvu_update]` 世界书。角色卡不再注册、读取或切换任何 SillyTavern preset。兼容假流式、“模型来源=与插头相同”、关闭 thinking 和关闭 Gemini 随机头部由卡内加载器在当前版本首次安装时写入全局 MVU 设置。顶部独立 MVU 浮窗只显示第二轮的生成、应用和完成进度；完成后的本轮变量变化由对应消息楼层中的独立 HTML 完整展示。角色卡不保存 API Key；后续可在 MVU 面板切换独立模型。

## AI 内容格式

AI 只生成浅层 JSON + 简易公式。外部内容使用 `effects`，卡牌弃牌效果使用 `discard_effects`。程序内部会编译为类型化 `EffectProgram`；AI 不需要输出内部 AST。

简单卡牌：

```json
{"id":"moon_slash","name":"月轮斩","type":"Attack","rarity":"Common","cost":1,"quantity":5,"effects":{"damage":8}}
```

X 费与条件：

```json
{"id":"last_light","name":"终末星光","type":"Attack","rarity":"Rare","cost":"energy","quantity":1,"effects":{"damage":"spent_energy * 5 + self.block","when":"self.hp < self.max_hp / 2"}}
```

生成牌：

```json
{"id":"spark_forge","name":"火花锻造","type":"Skill","rarity":"Uncommon","cost":1,"quantity":1,"effects":{"add_card":"spark","count":2},"creates":[{"id":"spark","name":"火花","type":"Attack","rarity":"Common","cost":0,"effects":{"damage":3},"exhaust":true}]}
```

已删除并拒绝旧 `effect/discard_effect` 字符串、`ME/OP/ALL`、`target.trigger(...)`、字符串条件/选择器和深层 `spec/op/steps` AST。完整协议见 `docs/ai-card-format-v1.md` 与 `worldbook_new/2战斗内容生成要求.md`。

## UI 规则

- 正文始终由 SillyTavern 原生渲染，不包进 iframe。
- common 状态栏只追加在正文末尾，使用初版暖白少女日记和彩色书签风格。
- 状态栏默认保留最新三条 AI 楼层；历史楼层只读，超出窗口后卸载。
- 战斗页只出现在最新战斗引导正文之后，固定为“敌人 / 手牌 / 我方”三层横屏卡牌结构。
- 战斗结束页沿用星空主题，并按胜利、失败或终止显示不同强调色；玩家可以补充可选的战后行动，与压缩后的完整回合摘要一起交给剧情模型。
- 拖牌与点击始终共存：拖动使用角色卡自身的 Pointer Events、实体卡跟随、投放区反馈和飞向战斗舞台动画；连续点击同一张牌两次也可直接出牌，不依赖浏览器原生 HTML 拖放。
- 战斗页在桌面和手机 iframe 内都禁止页面横纵滚动；手牌按可用宽度重叠并在尺寸变化时重排。
- 桌面鼠标与触屏共用 Pointer Events 拖牌链路；页面不再提供拖动/点击模式切换按钮。
- AI 生成选项已删除；玩家使用酒馆输入框或状态栏自定义行动。奖励候选仍由程序界面选择。
- 战斗结束将最终数值、牌区计数和本场完整战斗事件流传给剧情模型，帮助续写战后剧情；奖励预算只通过 `reward.request` 交给第二阶段，不再污染剧情模型输入。

## 架构

- `src/game-core/`：无 Tavern、DOM、MUV 依赖的内容契约、公式、状态、牌区、回合、事务和战斗终态。
- `src/portable/`：供网站、服务或 Mod 使用的 card/battle/combined ESM 出口。
- `src/fish/core/`：SillyTavern/MVU 宿主适配、楼层快照和副作用端口。
- `src/fish/ui/`：战斗 iframe 呈现与交互，不解析 AI 文本。
- `src/common/`：正文末尾状态栏、奖励事务和可选远征入口。
- `src/runtime/`：角色级共享运行时、楼层变量、MVU readiness 和战斗交接。
- `src/sillytavern-extension/`：可选的顶层构筑评分、流派知识图谱、第二轮动态注入和敌人数值校准扩展。
- `worldbook_new/`：当前唯一 AI 协议。

卡牌处理和战斗后端可从 `dist/portable/` 独立导入，不依赖酒馆助手、MUV 或 DOM。外部网站或 Mod 只需实现自己的状态、选择、事件和展示端口。

## 构建与验证

```bash
npm install
npm run release:tavern
```

`release:tavern` 会执行类型检查、现代语法/事务/战斗/MVU/楼层/HTML 安全测试、portable 构建、生产 UI 构建、角色运行时导出、PNG 补丁和卡内契约验证。

常用实机夹具：

```bash
npm run tavern:readiness-chat -- valid "魔法少女世界 0.5.93.png"
npm run tavern:battle-repair-chat -- status "魔法少女世界 0.5.93.png" ordinary
```

世界书 token 测量：

```bash
npm run measure:worldbook-roles
```

当前正式角色卡仍不强制依赖卡牌与敌人生成知识库；可选扩展的设计、安装和降级边界见 `docs/sillytavern-design-assistant-plugin.md`。

## 维护原则

- 不恢复旧 AI 字符串语法或第二套兼容执行器。
- 不为程序方便增加 AI 包装字段和嵌套层级。
- 同一规则只在 `game-core` 维护一次，fish 只做宿主适配和呈现。
- 远征保持可选，主体剧情与普通战斗不依赖 `run`。
- 发布后必须用全新版本名的最终 PNG 在真实 SillyTavern 回归。

重构过程见 `docs/refactor-log.md`，MVU 分工见 `docs/mvu-worldbook-boundary.md`，酒馆链路踩坑见 `docs/tavern-helper-pitfalls.md`。

玩家可见的完整版本记录见 `docs/player-release-notes.md`；正式发布前必须按 `docs/release-playbook.md` 汇总跨任务改动并同步角色卡与卡图仓库。
