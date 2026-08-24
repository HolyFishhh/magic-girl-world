# 后端边界

## 可移植核心

`src/game-core` 是卡牌处理与战斗后端的可移植边界，不依赖 Tavern Helper、MUV、DOM、jQuery、消息楼层、日期或全局随机数。

核心负责：

- 浅层内容编译、Schema 语义和状态引用检查
- `EffectProgram` 校验、公式求值和命令生成
- 卡牌费用、牌区、选牌、升级和奖励候选
- 伤害/治疗/格挡/欲望/修饰符规则
- 状态定义、生命周期和能力/遗物触发计划
- 回合、终态、路线、事件与结算计划
- 确定性随机和可回滚 `BattleStateStore`

核心不负责：

- MUV 路径读取或写回
- SillyTavern 消息创建和续写
- 弹窗、动画、日志、DOM 和 iframe
- 具体宿主的数据持久化

## 宿主端口

接入网站、服务或 Mod 时需要实现：

- 状态读取与更新
- 卡牌选择响应
- 事务 begin/commit/rollback
- 确定性随机源
- 效果呈现和终态处理
- 自己的持久化/序列化边界

参考组合位于 `src/adapters/referenceBattleRuntimeHost.ts`。Tavern 实现位于 `src/fish/core` 和 `src/runtime`，不是核心规则的一部分。

## 发布入口

`src/portable/cardBackend.ts`、`src/portable/battleBackend.ts` 和 `src/portable/index.ts` 是对外稳定入口。`npm run build:portable` 会生成：

- `card-backend.mjs`：AI 浅层 JSON、内容契约、卡区、卡牌效果、奖励与升级；不暴露 `BattleStateStore`。
- `battle-backend.mjs`：卡牌入口加战斗状态、效果、触发、回合、终态、快照和参考宿主。
- `magic-girl-core.mjs`：`cardBackend`/`battleBackend` 两个命名空间的合并入口。

构建还会生成 `package.json`、`manifest.json` 和 `types/portable/*.d.ts`。`test:portable-package` 会从磁盘导入三个 bundle、执行一次卡牌编译和战斗伤害、验证快照，并用外部消费者夹具编译声明；`test:portable-boundary` 扫描核心、适配器和入口，拒绝 Tavern/MUV/DOM/时间/全局随机依赖。

## 内容转换

```text
MUV stat_data.battle（直接数组/直接标量）
  -> runtime 仅过滤当前 MUV 初始化标记
  -> AI shallow JSON
  -> ContentPack
  -> validateContentPackContract
  -> battleContentAdapter
  -> runtime Card/Relic/Ability/EnemyAction
  -> EffectProgram runtime
```

外部内容不能直接提交内部 AST。内部程序也不能反向编译成 AI 文本或展示文本后重新执行。

`src/game-core` 不认识 `$__META_EXTENSIBLE__$`、`[值, 描述]` 或嵌套 MUV 数组。当前角色卡的 `变量初始化.json` 使用直接标量和直接数组；历史包装不会在 runtime 中展开。缺少 Tavern Helper API 时直接报错，不安装本地存储模拟器或伪造消息函数。

`test:portable-boundary` 会解析 TypeScript 的实际运行时导入图，而不是只搜索入口文本。卡牌入口不得依赖战斗状态、回合、快照、终态或参考宿主；战斗入口可以单向包含整个卡牌入口。两个闭包都禁止反向导入 `common/fish/runtime/start`，也禁止 DOM、MUV 标记、墙钟和全局随机数。

## 所有权

- `BattleStateStore`：战斗状态、随机游标和快照。
- `CardEffectRuntime`：牌区命令。
- `BattleEffectRuntime`：数值和修饰符命令。
- `StatusLifecycleRuntime`：状态 apply/stack/tick/decay/remove。
- `AbilityTriggerRuntime` / `RelicTriggerRuntime`：触发匹配和递归保护。
- `BattleSessionCoordinator`：外层动作顺序与事务。
- Tavern hosts：MUV、消息、选择 UI、动画和日志。

任何新实现都应扩展这些所有者之一，不能在 UI、适配器或特定内容类型旁路复制规则。
