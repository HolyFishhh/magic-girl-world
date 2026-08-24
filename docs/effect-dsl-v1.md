# 结构化效果语法与可移植核心

## 决策

`mwg.effect/v1` 是卡牌后端与战斗后端之间使用的内部 JSON AST，并由 `JSON Schema Draft 2020-12`
约束。它不是世界书或 AI 的输出格式；AI 只输出 `docs/ai-card-format-v1.md` 定义的浅层 `effects`
JSON，核心编译器再转换为该 AST。旧字符串效果不再接受。运行时不得使用 `eval`、`Function`
或执行 AI 提供的 JavaScript。

浅层输入支持两种等价形状：只有一个效果时可直接写对象；`damage/heal/block/energy/lust/apply_status/remove_status/draw`
等常见同条件操作可组合在一个对象中。`compactEffectContract.ts` 定义唯一展开顺序，编译、说明和 JSON
Schema 共用它；需要前后状态依赖时仍使用数组，数组顺序不会被改变。

多段攻击保持浅层：AI 写 `{"damage":4,"hits":3}`，编译器展开为三个普通 `damage`
节点。内部 AST、命令运行时和宿主因此无需新增“多段伤害”特例，每击自然独立消费格挡并产生伤害事件。`hits`
不允许进入组合对象，避免一份共享 `when/on` 同时暗示多段伤害和单次格挡等不清晰语义。

回合成长和连击也只使用公式：`turn_number`、`cards_played_this_turn`、`attacks_played_this_turn`、`skills_played_this_turn`。三种出牌计数包含当前正在结算的牌并在下一玩家回合归零；计数由出牌事务提交，不由公式执行器或宿主 UI 重复维护。

`on_exhaust` 是共享卡牌生命周期事件，不是新效果操作。打出后消耗、空灵和选择器消耗都在卡牌进入消耗堆后调用同一 Tavern 管线；能力先于玩家遗物结算，外层宿主事务负责完整回滚。

`on_draw` 与 `on_shuffle` 同样是共享生命周期事件：普通抽牌在卡牌进入手牌后逐张发出 `on_draw`，弃牌堆回洗后发出一次 `on_shuffle`；起始手牌初始化不发出这两个事件。内容契约禁止它们再次包含 `draw`。

牌型出牌事件也只扩展共享触发器目录：`card_played` 之后按牌型追加一个 `attack_played/skill_played/power_played`。AI
仍只写既有同级 `trigger/on`，不输出事件数组或分发 AST；Tavern 卡牌系统读取核心给出的有序触发器列表，并在每个事件内保持能力先、遗物后的顺序。

采用 AST 而不是另一种字符串公式，原因是每个操作、目标、变量和分支都有稳定字段，JSON
Schema 可以在效果执行前给出精确路径错误，也能被网站、TypeScript 后端或其他语言的适配器读取。

## 已删除语法审计

删除前的效果字符串叠加了多套语法；下表只记录弃用原因，不是可用格式：

| 层级        | 示例                           | AI 常见失败                                    |
| ----------- | ------------------------------ | ---------------------------------------------- |
| 效果链      | `ME.block + 2, draw + 1`       | 忘记逗号、在引号或 JSON 内错误分割             |
| 数学式      | `spent_energy * 4`             | 使用未知变量、除零、目标上下文错误             |
| 条件        | `if[ME.hp < 5][...]else[...]`  | 中括号不配对、空分支、尾部多余内容             |
| 能力/触发器 | `ME.turn_start(ME.block + 4)`  | 外层归属和内层 `ME/OP` 含义混淆                |
| 牌选择器    | `exile.draw.all`               | `+` 同时表示选择器组合与数值加法，省略域或数量 |
| 状态        | `ME.status apply poison 2`     | 状态 ID、层数和目标依赖空格位置                |
| 动态插牌    | `add_to_hand {"effect":"..."}` | JSON、引号和效果字符串需要多层转义             |
| 已删别名    | `damage:8`、`if(...)(...)`     | 多种格式混写，表面可读但语义不一致             |

解析、预检、执行和 UI 描述曾存在多条解释路径。`0.5.77` 已删除字符串 parser、host、adapter 和反向展示链。现代内容以 `EffectProgram` 为唯一规则来源：`effectProgramPolicy` 在纯核心执行入口约束策略，执行器按核心命令逐步消费，UI 直接遍历同一程序。

## 内部 AST 示例

```json
{
  "spec": "mwg.effect/v1",
  "steps": [
    {
      "op": "damage",
      "target": "opponent",
      "amount": {
        "op": "multiply",
        "left": { "op": "var", "path": "context.spent_energy" },
        "right": 4
      }
    },
    {
      "op": "gain_block",
      "target": "self",
      "amount": { "op": "var", "path": "context.spent_energy" }
    }
  ]
}
```

条件不再使用括号或中括号配对：

```json
{
  "op": "if",
  "condition": {
    "op": "compare",
    "relation": "eq",
    "left": { "op": "var", "path": "context.spent_energy" },
    "right": 0
  },
  "then": [{ "op": "gain_block", "target": "self", "amount": 1 }],
  "else": []
}
```

`self` 与 `opponent` 永远相对效果来源解释。上下文变量使用 `context.*`，战斗变量使用 `battle.*`，实体状态使用 `self.*` 或
`opponent.*`，不再依赖裸变量和隐式 `ME/OP`。

当前内部 AST 还包含 `apply_status/remove_status`、显式
`CardSelector`、`draw_cards/scry_cards/discard_cards/exhaust_cards/recover_cards/reduce_card_cost/copy_cards/double_card_effect`、`modify`、`register_trigger`
和
`add_card`。这些节点仍不由 AI 输出。纯核心执行器对不依赖具体卡牌实例的数值与状态操作直接结算；牌区、触发器和插牌返回领域命令，由卡牌后端或酒馆适配器消费。

## 模块边界

`src/game-core` 是可移植规则核心，必须满足：

- 不导入 DOM、UI、jQuery、Tavern Helper、MUV 或 SillyTavern API。
- 输入和输出均为可序列化普通对象。
- 随机数、时间和运行时卡牌 ID 由卡牌后端通过显式端口提供，不进入公式解释器。
- 命令执行失败时返回原状态，不留下部分结算。
- 状态变化同时返回领域事件，UI 和战斗日志消费同一事件，不再重新解析效果文本。

酒馆适配层负责把 `stat_data.battle`
转为核心输入、把结果写入消息快照，并把领域事件渲染到 iframe。网站和 Mod 适配器可以采用不同语言或状态模型，只需遵守同一 JSON
Schema 和效果语义，不要求直接复用酒馆代码。

## 当前实现

现代效果链路已经统一为：

```text
AI 浅层 effects
-> EffectProgram
-> effectCommandRuntime
-> 单条 EffectCommand
-> fish 宿主副作用
-> 消息快照 / MUV
```

`EffectProgram`
按原数组顺序逐条生成命令；每条命令完成后重新读取最新战斗状态，再计算下一步的公式和条件。胜利、失败或 Event 终止会立即短路，程序不会继续执行剩余步骤。现代程序不再整体编译回旧效果字符串。

该链路已经覆盖卡牌主效果、弃牌效果、Power、遗物、道具、双方能力、敌人行动、双方欲望、状态生命周期和动态卡牌。预检、快照恢复、三类战斗终态及 MUV 结算使用同一套核心语义；`effect`、`discard_effect`、`effect_program` 和外部 `effectProgram` 会在内容边界被拒绝。

`0.5.17` 已在真实 SillyTavern `1.18.0`、Tavern Helper `3.4.17+` 和 MagVarUpdate `v0.181.0`
中验证上述入口、顺序重算、整页刷新恢复与胜利/失败/Event 终止清理。

`0.5.18`
已把现有端口组装成无 DOM 的战斗会话协调器，并提供网站或 Mod 可参考的最小外部宿主适配器。协调器统一开战、出牌、道具和结束回合的动作互斥、事务及终态短路；酒馆 iframe 继续只负责输入输出、交互和宿主副作用。
