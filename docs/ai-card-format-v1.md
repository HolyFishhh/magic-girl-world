# AI 卡牌输出格式 v1

首次爬塔生成（单次开局与 registry 草稿两条入口）的 `opening.choices[].outcome.reward.cards` 可写 `{ "card_ref": "本次player.cards中的ID", "quantity": 2 }`，表示获得该非唯一卡的完全相同副本。只允许这两个字段，引用必须唯一且指向完整定义；不能指向模板、其他奖励、历史存档或附加规则覆盖。接收层先复制完整定义及模板依赖，再进行候选校验、有限修复和存档；未选择馈赠时不发牌。普通节点、持久化卡牌和修复槽仍使用完整可执行定义，不接受 `card_ref`。

卡牌可用根字段 `requires_summon:"模板ID"` 表示扣费前必须有我方对应存活召唤物。`activate_summon:{selector,action:{id,name,effects}}` 可令选中的召唤物执行临时新行动，伤害来源和 `self` 绑定该召唤，不覆盖预告的常规行动。完整语义见 [机制契约](mechanism-contract-regression.md)。

效果数值和公式中的常量最多保留两位小数，例如 `0.75`；运行时同样保留两位，界面最多显示一位。生命、欲望等 MVU 存档字段仍遵循各字段自己的精度与范围约束。

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

`description` 是可选的叙事补充，但通常建议用一句自然中文说明动作感、来源、形态或非数值特征。不要复述无条件的简单伤害、格挡、层数或抽牌数；只要存在 `when/on/trigger/discard_effects`、分支或多阶段规则，描述必须明确写出触发时机、条件和结果。程序会始终从已验证的可执行字段生成独立效果标签和权威规则说明；AI 叙事可以与规则并存，但不能代替、覆盖或歪曲规则。状态执行使用稳定 ID，界面从同场 `battle.statuses` 或奖励候选同级 `statuses`（旧单个 `status` 兼容）读取玩家可见名称。奖励候选的多个新状态必须形成从候选效果出发可达、依赖闭合的定义集合，领取时一次登记。所有玩家可见文本必须为自然中文，不得暴露英文 ID、公式路径或内部字段名；实际执行始终只以 `effects` 编译结果为准。

纯死牌 `Curse` 是唯一可以省略 `effects` 的卡牌：它本身不可打出并占据手牌位置，因此同时省略 `cost`，也不要写空数组、`narrate` 或零值占位。若诅咒在抽到、弃掉、回合末等时机确实会产生后果，则仍需用真实的 `effects`、`discard_effects` 或受支持字段完整表达；存在非法效果时不会因为类型是 `Curse` 而绕过校验。

卡牌只在确有需要时增加布尔标记：`"innate":true` 开战时优先进入起始手牌，`"retain":true` 跨回合保留，`"exhaust":true`
打出后消耗，`"ethereal":true` 未打出则回合末消耗。不要写 false 默认值。`innate`
只用于永久卡牌、奖励卡或营火升级，不用于战斗中才生成的 `creates` 模板。

奖励和商店不增加“多样性”字段。三张候选按 `[构筑建议] roles`
依次设计，并赋予清楚的名称、来源和叙事身份。机制相近或数值相同是允许的，例如不同来源的两件护符可以提供相同增益；它们必须使用不同稳定 ID，不能用同一 ID 表示不同对象。

奖励候选可以在自身同级携带 `statuses:[状态定义...]`，用于登记该候选独有、当前全局状态表中尚不存在的状态。即使只有一个新状态也使用数组；旧 `status:{状态定义}` 只作为已有存档和旧输出的兼容入口。候选直接使用的状态以及这些状态继续引用的新状态必须全部闭合在同一数组中；重复 ID 且规则相同会合并，规则不同会拒绝，未被候选直接或间接引用的定义也会拒绝。候选被领取或用作卡牌变形时，全部新状态与内容在同一次事务中写入，之后卡牌、遗物或道具本身不再保留 `status/statuses` 外壳。没有新状态时彻底省略这两个字段。

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

一个效果可以省略数组包装。只有 `damage/heal/block/energy/lust/apply_status/remove_status/draw` 中至少两个同时结算的操作可以合并为一个对象，共享同一个 `when/on`：

```json
"effects": { "damage": 8, "block": 5 }
"effects": { "damage": 6, "apply_status": "weak", "stacks": 2 }
```

组合对象按固定顺序展开，不依赖 JSON 字段排列。`damage_type/bypass_block/lifesteal` 只能修饰同对象的 `damage`，`stacks` 只能修饰同对象的 `apply_status`。`bypass_block` 只能写布尔值 `true`，表示该次伤害完全无视格挡，不能填写数字；当前不生成“只无视 N 点格挡”的描述。多段攻击只写一个浅层对象，如 `{"damage":4,"hits":3}`；`hits`
为 1-20 整数，每击分别结算格挡、伤害事件与触发器，不能与 `block/heal`
等组合字段同对象。需要前一个效果改变状态后再计算后一个效果时，必须改用数组。`modify`、牌区操作、`add_card`、`set_*`、召唤、当前姿态、姿态槽、增援、延迟、回合控制、选择和
`narrate` 保持单独对象。

## 公式

条件能力不扩大单个操作的既有公式权限：持续 `modify` 仍只允许数值和状态 `stacks`，不支持额外 `when` 或姿态公式。

姿态身份可在 `when` 或三元条件中写 `self.stance == 'balanced_flow'`、`opponent.stance != null`。仅支持相等/不等，可与其他合法条件组合；字符串是稳定姿态 ID，只有 `null` 表示无姿态（`'none'` 不是空值别名）。按当前效果来源绑定，召唤物自身没有主人姿态；`summoner_effects` 中才读取主人。身份不能参与数值运算、大小比较或函数调用，AI 无需输出内部 `stanceId`。每个条件分支的操作和数值必须在 effects 中明确表达，不能只在叙述中承诺效果。

公式使用受限公式语法（`jsep` 语法子集），只允许数值、`+ - * / %`、比较、逻辑运算、白名单变量，以及固定纯数学函数 `floor/ceil/abs/min/max`。`floor/ceil/abs` 恰好接收一个数值参数，`min/max` 接收 1 到 32 个数值参数；不允许对象方法、其他函数或 JavaScript，公式也不会被当作 JavaScript 执行。`%` 是取余，可用 `cards_played_this_turn % 3 == 0` 表达“本回合每打出第 3 张牌时”。除数或取余右值不能为 0。

可用变量包括：

- `spent_energy`
- `turn_number`
- `cards_played_this_turn`
- `attacks_played_this_turn`、`skills_played_this_turn`
- `self.hp`、`self.max_hp`、`self.lust`、`self.max_lust`、`self.energy`、`self.max_energy`、`self.block`
- `self/opponent.hand_size`、`self/opponent.draw_pile_size`、`self/opponent.discard_pile_size`、`self/opponent.exhaust_pile_size`；敌人来源可通过 `opponent` 读取玩家牌区，没有牌区的实体对应值为 `0`
- `opponent.hp`、`opponent.max_hp`、`opponent.lust`、`opponent.max_lust`、`opponent.energy`、`opponent.max_energy`、`opponent.block`
- `self.status.<id>.stacks`、`opponent.status.<id>.stacks`
- `self/opponent.buff_count`、`debuff_count`、`neutral_count`、`status_count` 分别读取当前有效的增益、减益、中性状态或全部状态数量
- `self/opponent.has_buff`、`has_debuff`、`has_neutral`、`has_status` 是可直接用于 `when` 或三元条件的真假判断
- `self/opponent.summon_count` 与 `has_summon` 分别读取同阵营存活召唤物数量和是否存在召唤物；`self/opponent.ally_count` 与 `has_ally` 分别读取当前实体以外的同阵营存活非召唤战斗实体数量和是否存在这类队友。四种存在判断都不是函数；数量字段可进入数值公式
- `event.damage_type` 只用于 `take_damage`、`deal_damage` 等当前确有伤害事件的 `when`，可与 `attack/effect/hp_loss/retaliation/damage_over_time/execute` 使用 `==` 或 `!=` 比较；它表示本次触发事件的实际伤害类型，不是角色属性，也不能进入数值公式

这些存在判断都是无参数布尔字段，不是函数。`self.has_status` 表示自身存在任意状态；若要判断一个指定状态，必须写 `self.status.<id>.stacks > 0` 或 `opponent.status.<id>.stacks > 0`，不能写 `self.has_status('id')`。除上述五个纯数学函数外，公式不允许任何函数调用。

`turn_number` 从 1 开始。本回合出牌、攻击牌和技能牌计数都包含当前正在结算的牌，并在下一玩家回合归零：

```json
{ "damage": "turn_number * 2" }
{ "damage": "attacks_played_this_turn * 3" }
{ "block": 5, "when": "cards_played_this_turn % 3 == 0" }
{ "damage": "opponent.has_debuff ? 24 : 18" }
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

状态也可以拥有同级 `creates`（至多 32 个模板），供其非 `hold/threshold_execute` 触发器的 `add_card/ensure_card/transform_card` 引用。例如 `triggers.on_discard:{add_card:"paper",count:1,to:"hand"}` 配合该状态自身的 `creates`，会在实际弃牌事件后生成新牌；回合结束清理不触发。registry 草稿仍仅在 `registry.templates` 定义一次，由程序分配模板，不要求 AI 重复技术容器。模板的效果在未来打出/弃掉时执行，不能偷偷捕获创建状态的 `stacks`；循环、未知引用和非法卡牌规则仍拒绝。需要每场都有此状态时，应由 AI 在已持有遗物的 `battle_start` 中施加，不能把本场活动状态永久化。

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

程序会生成“回合结束时，对自身造成当前层数点伤害；回合结束后减少1层；最多叠加12层。”。`triggers` 的生命周期键可用 `apply/stack/tick/remove/hold/threshold_execute`，也可直接使用公开战斗事件键监听状态持有期间发生的事件。每个触发值必须直接是浅层效果对象或数组，字符串触发器会被拒绝；不能再包成 `{effects:...}`、`{on,effects}` 或 `{when:X,effects:...}`。多个操作共享条件时，把 `when:X` 分别写进每个实际效果项；若某项本身已有条件 Y，则合并成 `when:"(X) && (Y)"`。触发值不能只有 `when`。

伤害事件可以按本次实际伤害种类细分。例如 `triggers.take_damage:{block:5,when:"event.damage_type == 'attack'"}` 表示只有受到攻击伤害时才获得格挡。公开推荐写法始终是 `event.damage_type`；运行时也会兼容模型偶尔写出的 `self.damage_type` 与 `opponent.damage_type`，三者都指当前事件而不是任一角色的永久属性。

状态事件没有“当前正在结算的卡牌”，所以不能使用 `replay_current`。需要让持有状态期间的下一张或前 N 张匹配牌额外完整结算时，在该状态的 `hold` 中使用 `card_rule:"replay"`、匹配牌型、`limit` 和 `extra`，并通过状态自身的生命周期控制持续时间。

回合结束的固定顺序是 `tick → stacks_change → 层数归零时 remove`。数字 `stacks_change` 表示给当前层数加上该数字并向下取整，`x倍率` 表示相乘后向下取整，`reset` 归零，`keep` 或省略表示不自动变化。`remove_status` 会立即移除整个状态，不能附带 `stacks` 表示减少部分层数；“每回合减少 1 层”应写在状态定义根部的 `stacks_change:-1`。

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
| `{ "replay_current": 1, "when": "skills_played_this_turn > 0" }` | 本回合打出过技能牌时，当前牌原效果结束后再完整结算 1 次，费用只支付一次；条件只写在 `when` |
| `{ "modify_card": "damage", "add": 2, "pick": "choose" }` | 选择 1 张手牌，使其中每段伤害增加 2 |

`choose/options` 是另一种机制，只用于 2..8 个预先定义的效果分支，固定写成 `{ "choose":"稳定英文ID", "options":[{"id":"分支ID","label":"显示名","effects":[...]}, ...] }`。它不用于从牌区选择卡牌；选牌必须在 `discard/recover/modify_card/copy/double/auto_play` 等对应操作同级使用 `pick:"choose"`、`from` 与筛选字段。

`from` 可用 `hand/draw/discard/all`，默认 `hand`。`pick` 可用 `random/choose/left/right/all`；`left/right`
只适用于手牌，`from: "all"` 必须配 `pick: "all"`。要操作多个牌区时写多条效果，不生成旧式组合选择器。

`seek` 单独使用，只写数量，不增加 `from/pick/count`。玩家从整个抽牌堆选择该数量张原卡加入手牌，牌堆不足或手牌空位不足时按可用数量处理；它不算抽牌、不触发 `on_draw`，并受 10 张手牌上限约束。

`recover` 单独使用 `from: "discard" | "exhaust"` 和 `pick: "random" | "choose" | "all"`，并支持与其他牌区操作相同的 `name/card_type/rarity/cost/min_cost/max_cost/tag/template_id/run_instance_id/combat_instance_id/origin/upgraded/keyword/exclude_keyword/root_only` 筛选。`keyword/exclude_keyword` 只接受 `retain/exhaust/ethereal/innate` 单值或数组；例如 `{ "recover":1, "from":"discard", "pick":"choose", "keyword":"exhaust" }` 会取回一张带“消耗”关键词的弃牌。取回只移动符合条件的原卡，不算抽牌、不触发 `on_draw`，并受 10 张手牌上限约束。

`scry` 单独使用，值为查看数量或公式；不搭配 `from/pick/count`。玩家可从实际牌库顶候选中选择 0 到 N 张置入弃牌堆，剩余卡牌保持原顺序；这个移动不触发 `on_draw/on_discard`。

`modify_card` 的值只用 `damage/block/lust/stacks`，并且恰好搭配 `add/subtract/multiply/divide` 中一个。它复用相同的 `from/pick/count` 选择器，修改选中卡牌中对应数值通道的所有步骤；不会修改 `hits`、费用、目标、触发器或卡牌类型。公式运算后的对应数值最低为 0。

每回合范围型出牌规则只放在 `passive` 能力/遗物或状态 `hold`。`card_rule:"replay"` 表示完整效果额外结算，`extra` 是额外次数；`card_rule:"free"` 表示不消耗能量且不能写 `extra`。两者都必须写 `limit`，其值为正数或 `"all"`。`card_rule` 不接受 `when/on`；条件持续规则放在对应状态的 `hold`，由状态的存在时间控制。免费打出的 X 费牌按使用 0 能量结算，规则不会改写卡牌原始费用。

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
  "effects": [{ "add_card": "spark", "to": "discard", "count": 2 }],
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

`to` 只接受 `hand/deck/discard`，默认 `hand`。`discard` 会把新实例直接放入弃牌堆，不视为从手牌弃掉，因此不会触发 `discard_effects`。模板 ID 必须唯一；未知引用和模板生成循环会在战斗启动前失败。模板也可使用 `trigger`
和 `discard_effects`，但不需要 `quantity`。

## 姿态内事件监听

姿态仍用浅层 `stance` 定义，互斥切换、`enter/exit/passive` 含义不变。需要“仅持有此姿态时响应事件”的机制，使用可选 `events`（1–16 个非 passive 结构化触发器），不要将 `trigger` 塞进持续修饰 `passive`，也不要注册成永久能力。

```json
{"stance":{"id":"balanced_flow","name":"均衡气流","emoji":"🌪️","events":[{"on":"attack_played","scope":"turn","ordinal":"first","effects":{"resource":{"id":"pressure","amount":1}}}]}}
```

`pressure` 仍由 AI 在资源定义中登记。这里是整个回合的首次攻击，不是进入姿态后的首次攻击；同回合重新进入不会重置序数。监听仅在该姿态生效期间运行，退出即停止；事件中才获得的姿态不追溯触发当前事件。已开始的单条效果继续完成，其余旧姿态监听停止。

事件效果的 `self` 是姿态持有者，普通操作的默认目标规则仍适用，不能继承授予者的状态目标、支付值或层数。`events` 不能再次注册永久触发器、引用原卡 `spent_resource`、状态 `stacks` 或重放原卡。筛选规则与已有结构化触发器共用；进入次数标识由程序生成和存档，不增加 AI 输出字段。无需也不支持调用 `self.has_stance`。

## 预检

新增开局生成检查：对于单一结构化事件触发器，若 description 以明确的“每回合开始/结束”或“战斗开始”起句，并包含与同一触发效果吻合的字面伤害、格挡、回复、抽牌或能量数值，会检查该时间与 `trigger.on` 是否矛盾。确定的冲突与结构错误同时送入既有的一次有限修复，AI 只能修改被指定的 on 字段，不能改写说明或删除效果掩盖问题。

这是有限句式检查，不是通用语义证明：混合即时/后续效果、多个时间、公式、引用、否定、传闻、被动规则等不作猜测，也不覆盖所有次数、目标或复杂文案。它只约束新生成的开局，不回写或阻断已有存档。可选 description 宜承载主题和演出，实际规则由 effects/trigger 生成；人物、职业、地点和生命等剧情字段仍由 AI 完整创作。没有自身效果的状态不能仅因 triggers 为空就删除，必须检查是否被其他规则当作标记读取。

没有眩晕且没有自身触发器的状态，规则展示会明确标注“仅记录状态层数，自身没有额外行动或数值修饰；可供其他规则读取”，并照常列出层数衰减和上限。该提示不证明存在读取者，也不判定它无用；状态仍可参与其他效果的层数公式和获得/失去状态事件。它不会自动实现 description 中的增援、概率或数值承诺。未知或无法显示的触发器不能仅凭空说明被识别成合法标记。

奖励候选和库存卡牌的规则段保留真实的固有、保留、消耗、空灵关键词，包括 Power 的固有消耗规则；这些展示面没有独立关键词徽章，不能省略规则后依赖 AI 叙述补回。

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

召唤物的具体主人身份是程序创建并保存的运行时字段，AI 不输出 `summonerId`、`summoner_id` 或 `ownerId`。`summoner_effects` 不随选中的敌人切换主人。主人死亡或旧存档身份不明时明确提示未执行，不把效果转给另一敌人。`slot` 的强化/复活限于同一具体主人；`copy_summon.to: "same"` 保留原主人，`"self"`/`"opponent"` 则绑定接收方，复制体不占原来的唯一槽位。容量仍按阵营计算。

`scripts/fixtures/ai-complex-content-v1.json` 是当前首轮完整构筑压力基线，覆盖 X 费公式、同条件组合、多触发 Power、弃牌/回收/减费、动态衍生牌和自定义状态。`npm run test:complex-card-output` 同时验证内容契约、公式执行、程序生成描述和精确错误路径。

- 单卡 AI JSON 的容器深度不超过 4；内部 AST 深度不计入 AI 输出。
- 单张复杂卡不超过 130 `o200k_base` token。
- 14 张牌、状态、遗物、道具和欲望效果组成的完整首轮夹具不超过 650 token。
- 同条件的常见数值、状态和抽牌效果合并在一个对象；只有顺序依赖或不同触发时机才使用 `effects` 数组。
- 动态牌只允许一层同级 `creates` 模板并用短 ID 引用，禁止模板循环。

这些限制是回归上限，不要求 AI 填满。普通基础牌仍应保持约 30 token，复杂卡只在机制确实需要时增加字段。
