# AI 卡牌输出格式 v1

这是给世界书和 AI 使用的格式，不是战斗核心的内部 AST。AI 不需要输出 `spec`、`op`、`target`、`amount`、`left`、`right` 或
`steps`。

## 最小卡牌

```json
{
  "id": "moon_slash",
  "name": "月轮斩",
  "emoji": "🌙",
  "type": "Attack",
  "rarity": "Common",
  "cost": 1,
  "quantity": 5,
  "effects": { "damage": 8 }
}
```

`description` 是可选的叙事补充，但通常建议用一句自然中文说明动作感、来源、形态或非数值特征。不要复述无条件的简单伤害、格挡、层数或抽牌数；只要存在 `when/on/trigger/discard_effects`、分支或多阶段规则，描述必须明确写出触发时机、条件和结果。程序会始终从已验证的可执行字段生成独立效果标签和权威规则说明；AI 叙事可以与规则并存，但不能代替、覆盖或歪曲规则。状态执行使用稳定 ID，界面从同场 `battle.statuses` 或奖励候选同级 `status` 读取玩家可见名称。所有玩家可见文本必须为自然中文，不得暴露英文 ID、公式路径或内部字段名；实际执行始终只以 `effects` 编译结果为准。

卡牌只在确有需要时增加布尔标记：`"innate":true` 开战时优先进入起始手牌，`"retain":true` 跨回合保留，`"exhaust":true`
打出后消耗，`"ethereal":true` 未打出则回合末消耗。不要写 false 默认值。`innate`
只用于永久卡牌、奖励卡或营火升级，不用于战斗中才生成的 `creates` 模板。

奖励和商店不增加“多样性”字段。三张候选按 `[构筑建议] roles`
依次设计，并赋予清楚的名称、来源和叙事身份。机制相近或数值相同是允许的，例如不同来源的两件护符可以提供相同增益；它们必须使用不同稳定 ID，不能用同一 ID 表示不同对象。

## 常用效果

| AI 字段         | 默认目标   | 示例                                      |
| --------------- | ---------- | ----------------------------------------- |
| `damage`        | `opponent` | `{ "damage": 8 }`                         |
| `damage + hits` | `opponent` | `{ "damage": 4, "hits": 3 }`              |
| `heal`          | `self`     | `{ "heal": 5 }`                           |
| `block`         | `self`     | `{ "block": 6 }`                          |
| `energy`        | `self`     | `{ "energy": 1 }`                         |
| `lust`          | `opponent` | `{ "lust": 4 }`                           |
| `set_hp`        | `self`     | `{ "set_hp": 20 }`                        |
| `apply_status`  | `opponent` | `{ "apply_status": "weak", "stacks": 2 }` |
| `remove_status` | `opponent` | `{ "remove_status": "weak" }`             |
| `draw`          | 玩家       | `{ "draw": 2 }`                           |

非默认目标只需添加同级 `to`：

```json
{ "damage": 2, "to": "self" }
```

不要把简单效果写成内部 AST，也不要把公式拆成对象树。

一个效果可以省略数组包装。常见的数值、状态和抽牌操作还可以合并为一个对象，共享同一个 `when/on`：

```json
"effects": { "damage": 8, "block": 5 }
"effects": { "damage": 6, "apply_status": "weak", "stacks": 2 }
```

组合对象按固定顺序展开，不依赖 JSON 字段排列。多段攻击只写一个浅层对象，如 `{"damage":4,"hits":3}`；`hits`
为 1-20 整数，每击分别结算格挡、伤害事件与触发器，不能与 `block/heal`
等组合字段同对象。需要前一个效果改变状态后再计算后一个效果时，必须改用数组。`modify`、牌区操作、`add_card`、`set_*` 和
`narrate` 保持单独对象。

## 公式

公式使用受限公式语法（`jsep` 语法子集），只允许数值、比较、逻辑运算和白名单变量。公式不会被当作 JavaScript 执行。

可用变量包括：

- `spent_energy`
- `turn_number`
- `cards_played_this_turn`
- `attacks_played_this_turn`、`skills_played_this_turn`
- `self.hp`、`self.max_hp`、`self.lust`、`self.max_lust`、`self.energy`、`self.max_energy`、`self.block`
- `self.hand_size`、`self.draw_pile_size`、`self.discard_pile_size`、`self.exhaust_pile_size`
- `opponent.hp`、`opponent.max_hp`、`opponent.lust`、`opponent.max_lust`、`opponent.energy`、`opponent.max_energy`、`opponent.block`
- `self.status.<id>.stacks`、`opponent.status.<id>.stacks`

`turn_number` 从 1 开始。本回合出牌、攻击牌和技能牌计数都包含当前正在结算的牌，并在下一玩家回合归零：

```json
{ "damage": "turn_number * 2" }
{ "damage": "attacks_played_this_turn * 3" }
```

X 费示例：

```json
{
  "cost": "energy",
  "effects": [
    { "damage": "spent_energy * 4" },
    { "block": 1, "when": "spent_energy == 0" },
    { "block": "spent_energy", "when": "spent_energy > 0" }
  ]
}
```

单个数值需要二选一时可以使用三元式：

```json
{ "block": "spent_energy == 0 ? 1 : spent_energy" }
```

复杂分支优先拆成多条带 `when` 的并列效果。这样 AI 不需要生成嵌套条件树。

## 状态

```json
{
  "effects": [
    { "apply_status": "bleed", "stacks": 2 },
    { "remove_status": "weak", "to": "self" }
  ]
}
```

`stacks` 默认是 `1`。`remove_status` 也接受 `all`、`buffs`、`debuffs`。普通状态 ID 必须已经存在于同一战斗的
`battle.statuses`；引用未定义状态会在战斗启动前失败。

状态定义同样使用浅层效果，不写重复说明：

```json
{
  "id": "bleed",
  "name": "流血",
  "emoji": "🩸",
  "type": "debuff",
  "stacks_change": -1,
  "maxStacks": 12,
  "triggers": { "tick": { "damage": "stacks", "to": "self" } }
}
```

程序会生成“回合结束时，对自身造成当前层数点伤害；回合结束后减少1层；最多叠加12层。”。`triggers` 只用
`apply/stack/tick/remove/hold`；触发值必须使用浅层效果对象或数组，字符串触发器会被拒绝。

## 持续修饰符

修饰符只放在 `passive` 遗物/能力或状态 `hold`：

```json
{ "modify": "damage", "add": 2 }
{ "modify": "block", "add": "stacks * 3" }
```

`modify` 可用 `damage/damage_taken/lust/lust_taken/heal/block`，并恰好搭配 `add/subtract/multiply/divide/set`
之一。除状态 `hold` 的 `stacks` 外，修饰值只使用数字；不与 `when/on` 混用。

## 牌区操作

| 写法                                                 | 含义                                |
| ---------------------------------------------------- | ----------------------------------- |
| `{ "draw": 2 }`                                      | 抽 2 张牌                           |
| `{ "scry": 3 }`                                      | 查看牌库顶 3 张，可将任意张置入弃牌堆 |
| `{ "seek": 1 }`                                      | 从抽牌堆选择 1 张加入手牌           |
| `{ "discard": 2 }`                                   | 从手牌随机弃 2 张                   |
| `{ "discard": 1, "pick": "choose" }`                 | 从手牌选择弃 1 张                   |
| `{ "exhaust": "all", "from": "discard" }`            | 消耗弃牌堆全部卡牌                  |
| `{ "recover": 1, "from": "discard", "pick": "choose" }` | 从弃牌堆选择 1 张卡牌回到手牌       |
| `{ "recover": 1, "from": "exhaust", "pick": "random" }` | 从消耗堆随机取回 1 张卡牌           |
| `{ "reduce_cost": 1, "count": 2, "pick": "choose" }` | 选择 2 张手牌，各减 1 费            |
| `{ "copy": 1, "from": "draw", "pick": "random" }`    | 随机复制 1 张抽牌堆卡牌到手牌       |
| `{ "double": 1, "pick": "choose" }`                  | 选择 1 张手牌，使下次主效果执行两次 |
| `{ "modify_card": "damage", "add": 2, "pick": "choose" }` | 选择 1 张手牌，使其中每段伤害增加 2 |

`from` 可用 `hand/draw/discard/all`，默认 `hand`。`pick` 可用 `random/choose/left/right/all`；`left/right`
只适用于手牌，`from: "all"` 必须配 `pick: "all"`。要操作多个牌区时写多条效果，不生成旧式组合选择器。

`seek` 单独使用，只写数量，不增加 `from/pick/count`。玩家从整个抽牌堆选择该数量张原卡加入手牌，牌堆不足或手牌空位不足时按可用数量处理；它不算抽牌、不触发 `on_draw`，并受 10 张手牌上限约束。

`recover` 单独使用 `from: "discard" | "exhaust"` 和 `pick: "random" | "choose" | "all"`；取回只移动原卡，不算抽牌、不触发 `on_draw`，并受 10 张手牌上限约束。

`scry` 单独使用，值为查看数量或公式；不搭配 `from/pick/count`。玩家可从实际牌库顶候选中选择 0 到 N 张置入弃牌堆，剩余卡牌保持原顺序；这个移动不触发 `on_draw/on_discard`。

`modify_card` 的值只用 `damage/block/lust/stacks`，并且恰好搭配 `add/subtract/multiply/divide` 中一个。它复用相同的 `from/pick/count` 选择器，修改选中卡牌中对应数值通道的所有步骤；不会修改 `hits`、费用、目标、触发器或卡牌类型。公式运算后的对应数值最低为 0。

每回合范围型出牌规则只放在 `passive` 能力/遗物或状态 `hold`。`card_rule:"replay"` 表示完整效果额外结算，`extra` 是额外次数；`card_rule:"free"` 表示不消耗能量且不能写 `extra`。两者都必须写 `limit`，其值为正数或 `"all"`。免费打出的 X 费牌按使用 0 能量结算，规则不会改写卡牌原始费用。

## Power 触发器

持续能力使用一个结构化 `trigger`，把触发时机与对应效果放在一起：

```json
{
  "id": "moon_guard",
  "name": "月相守护",
  "type": "Power",
  "cost": 1,
  "trigger": {
    "on": "turn_start",
    "effects": [{ "block": 4 }, { "draw": 1, "when": "self.hp < self.max_hp / 2" }]
  }
}
```

若 Power 打出时还有即时效果，可在卡牌同级另写 `effects`；没有即时效果就省略。若 Power 的唯一作用是打出时施加已注册的持续状态，可以省略 `trigger`；除此以外 Power 必须提供合法的结构化触发器。条件直接放在对应效果对象中。

同一张 Power 需要第二种触发器时，只在例外效果上写 `on`：

```json
{
  "trigger": {
    "on": "turn_start",
    "effects": [{ "block": 4 }, { "apply_status": "bleed", "on": "take_damage" }]
  }
}
```

`Attack/Skill/Event/Curse` 不能注册持续触发器。`battle_start` 不用于打出后才注册的 Power；状态触发器
`apply/stack/tick/remove/hold` 也不能混入 Power。

构筑联动继续使用同一个触发对象：`card_played` 响应任意可打出的牌，`attack_played`、`skill_played`、`power_played`
分别只响应攻击牌、技能牌和能力牌。每次打牌先结算 `card_played`，再结算对应牌型事件；每个事件内玩家能力先于遗物。效果产生战斗终态后不再进入后续牌型事件。

```json
{"id":"blade_echo","name":"刃光回声","rarity":"Uncommon","trigger":{"on":"attack_played","effects":{"block":1}}}
```

遗物、能力或 Power 可用 `on_exhaust`：每张牌实际进入消耗堆后触发一次，覆盖打出后消耗、空灵和效果选择消耗。消耗牌本身不需要增加字段。`on_draw` 在牌进入手牌后逐张触发，`on_shuffle` 在弃牌堆回洗后触发一次；起始手牌不触发，且这两个触发器的效果不能再次抽牌，避免循环。

```json
{"id":"draw_guard","name":"抽牌护幕","rarity":"Uncommon","trigger":{"on":"on_draw","effects":{"block":1}}}
{"id":"recycle_focus","name":"回洗专注","rarity":"Rare","trigger":{"on":"on_shuffle","effects":{"energy":1}}}
```

## 弃牌触发

```json
{
  "effects": [{ "block": 2 }],
  "discard_effects": [{ "draw": 1 }, { "apply_status": "focus", "to": "self" }]
}
```

`discard_effects` 只在非系统弃牌时触发；`discard_effect` 已删除。

## 动态插牌

效果只引用同张卡的 `creates` 模板，不输出转义后的 JSON 字符串：

```json
{
  "id": "spark_forge",
  "name": "火花锻造",
  "type": "Skill",
  "cost": 1,
  "effects": [{ "add_card": "spark", "to": "hand", "count": 2 }],
  "creates": [
    {
      "id": "spark",
      "name": "火花",
      "type": "Attack",
      "cost": 0,
      "effects": [{ "damage": 3 }],
      "exhaust": true
    }
  ]
}
```

`to` 只接受 `hand/deck`，默认 `hand`。模板 ID 必须唯一；未知引用和模板生成循环会在战斗启动前失败。模板也可使用 `trigger`
和 `discard_effects`，但不需要 `quantity`。

## 预检

公式和条件仍只写在同级 `effects`
字段中。程序预算会在低生命、满生命、低能量、满能量和敌人低生命等固定脱离宿主场景中做加权估值，并保留观察到的最小/最大值供敌人压力诊断；这些场景数据不会写入 MUV、不会进入 AI
JSON，也不会改变真实战斗的实时公式结果。固定数字效果不做额外采样。

战斗创建前由跨宿主唯一的 `contentContract` 按 `battle.cards[index].effects[index]`
校验：未知变量、函数调用、数组/对象字面量、未知字段、非法目标、公式过长和不支持的运算都会阻止本场战斗初始化。SillyTavern 的 fish 预检只把该核心错误映射到酒馆字段路径，并额外检查实体数值、行动配置和可玩性警告；不会再次解释现代 JSON。

首轮 AI 回复还会在状态栏开放路线前经过 `playerContentReadiness`：除上述规则外，总
`quantity`、基础 3 能量可出牌、稳定胜利手段、遗物、道具、欲望满溢效果和初始生命/成长数据必须齐全；攻守与恢复比例不作硬性要求。失败时 AI 只收到
`[战斗内容修复]`
和最多四个字段路径/错误码；先前对象的名称或文本不会被复制回提示。修复说明位于独立条件世界书，正常首轮与战斗回合不增加字段或 token，修复也继续输出本文件的浅层 JSON，不输出内部 AST。

当前完整实机基线为角色卡 `0.5.54`。浅层 `effects` 已通过真实 SillyTavern `1.18.0` + Tavern Helper `3.4.17+` +
MagVarUpdate `v0.181.0`
回归，覆盖基础数值、公式、`when`、`to`、X 费、状态生命周期、牌区取回、牌库顶预见与抽牌堆检索、Power、遗物、道具、双方能力、敌人行动、双方欲望、结构化弃牌效果、动态插牌、消耗与三种牌型出牌事件。现代效果按数组顺序逐步执行，每一步从最新状态重算；消息快照、整页刷新恢复以及胜利、失败、Event 终止后的 MUV 写回和清理均已验证。完整取回卡为 `36 token`，完整预见卡为 `29 token`，完整检索卡为 `27 token`；检索的整个抽牌堆候选、原卡移动、非抽牌语义和刷新恢复已在 `0.5.54` 发布卡实测。界面保持原生引导正文，仅在末尾追加状态栏，战斗 iframe 仍在引导正文之后出现。

当前唯一外部效果来源为 `effects`。`effect`、`discard_effect`、`effect_program` 和 `effectProgram` 会被内容契约拒绝；内部 `mwg.effect/v1` AST 只在编译后的运行时与私有快照中存在。

## 复杂度门禁

`scripts/fixtures/ai-complex-content-v1.json` 是当前首轮完整构筑压力基线，覆盖 X 费公式、同条件组合、多触发 Power、弃牌/回收/减费、动态衍生牌和自定义状态。`npm run test:complex-card-output` 同时验证内容契约、公式执行、程序生成描述和精确错误路径。

- 单卡 AI JSON 的容器深度不超过 4；内部 AST 深度不计入 AI 输出。
- 单张复杂卡不超过 130 `o200k_base` token。
- 14 张牌、状态、遗物、道具和欲望效果组成的完整首轮夹具不超过 650 token。
- 同条件的常见数值、状态和抽牌效果合并在一个对象；只有顺序依赖或不同触发时机才使用 `effects` 数组。
- 动态牌只允许一层同级 `creates` 模板并用短 ID 引用，禁止模板循环。

这些限制是回归上限，不要求 AI 填满。普通基础牌仍应保持约 30 token，复杂卡只在机制确实需要时增加字段。
