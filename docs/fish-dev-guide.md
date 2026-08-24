# Fish 战斗前端开发指南

## 责任边界

- `combat/battleManager.ts`：只编排回合和敌人行动。
- `combat/cardSystem.ts`：只连接卡牌事务、选择 UI、牌区呈现和生命周期端口。
- `combat/unifiedEffectExecutor.ts`：类型化效果命令的 Tavern 协调器，不解析文本。
- `core/battleContentAdapter.ts`：把 AI 浅层 `effects` 编译为运行时对象。
- `core/battleContentPreflight.ts`：调用核心内容契约，再补充酒馆数值、行动配置和可玩性检查。
- `core/battleTriggerHost.ts`：能力与状态生命周期事务。
- `core/relicTriggerHost.ts`：遗物触发事务。
- `core/battleSessionStore.ts`：当前消息私有快照持久化。
- `ui/effectProgramDisplay.ts`：直接从 `EffectProgram` 生成标签和敌人意图摘要。

## 执行路径

AI 字段进入 fish 前必须满足：

```text
shallow effects -> compileCompactEffectList -> EffectProgram
EffectProgram -> TavernEffectCommandHost -> typed runtime/host ports
```

卡牌、遗物、道具、能力、敌人行动和欲望效果在运行时都强制包含 `effectProgram`。不得添加字符串 fallback。

## 状态与触发

- 能力和遗物使用同级 `trigger + effectProgram`。
- 状态定义使用 `triggers.{apply,stack,tick,remove,hold}`，每项在加载时编译为程序数组。
- `hold` 只允许 `modify`；其他状态触发禁止 `modify`。
- `apply/stack` 属于外层动作事务；`tick/remove` 使用可恢复的嵌套事务。
- passive 和 hold 修饰符由 `declarativeModifierRuntime.ts` 读取，不写入第二份临时规则。

## UI

- 卡面显示权威 `description`；工具提示和意图标签使用 `EffectProgramDisplay`。
- UI 不读取 AI 原始 `effects`，不解析公式或字符串。
- 所有插值文本经过 `escapeHtml`，属性经过 `escapeHtmlAttribute`。
- 选牌统一使用稳定卡牌 ID 和 `TavernCardSelectionHost`。
- 不改变消息楼层、正文分流和 iframe 挂载规则。

## 扩展效果

1. 在 `game-core/compactEffectDsl.ts` 设计最浅 AI 写法并编译到 `effectDsl.ts` 的节点。
2. 在 `effectCommandRuntime.ts` 生成类型化宿主命令。
3. 优先复用现有 `CardEffectRuntime`、`BattleEffectRuntime` 或状态/触发宿主。
4. 在 `contentDescription.ts` 和 `effectProgramDisplay.ts` 增加说明。
5. 覆盖内容契约、执行顺序、事务回滚、快照恢复和真实酒馆交互。

禁止添加 `effect`、`effect_program`、`ME/OP/ALL`、字符串条件/选择器或任何现代程序到旧文本的转换。
