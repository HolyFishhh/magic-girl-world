# 构筑场景评估

## 目的

构筑摘要需要能理解浅层 JSON 公式、状态层数和遗物修饰符，但不能把内部 AST、分析范围或额外字段交给 AI。评估因此只存在于 `src/game-core`，输出仍是原来的短预算行。

## 唯一入口

- `getContentAnalysisScenarios(options)`：提供固定的六个脱离宿主场景和权重。
- `summarizeBuildBudgetScenarios(pack, player)`：在同一组场景中计算卡牌、被动遗物/能力、当前状态触发器、状态层数和玩家欲望效果，返回 `expected/min/max`。
- `summarizeBuildBudget(pack, player)`：只返回 `expected`，保持既有调用契约。
- `formatBuildBudget(budget)`：继续生成 `deck=... atk=... def=...` 的扁平 AI 提示行。

## 场景输入

默认场景覆盖基线、低生命、满生命、敌人低生命、低能量和满能量。构筑调用会把玩家当前 `hp/maxHp` 作为基线传入；每个场景都重新使用同一个 `analyzeContentDefinition()` 和 `analyzeStatusDefinition()` 入口，因此公式、状态层数和修饰符不会由预算模块重复解析。

## 修饰符规则

`damage`、`block`、`heal` 修饰符只作用于内容中已经存在的对应基础分量。纯格挡牌不会因伤害修饰符获得攻击，纯攻击牌不会因格挡修饰符获得防御。欲望仍单独使用 `lust` 分量和统一欲望权重，不与 HP 伤害交叉。

## 宿主边界

场景范围是平衡诊断，不是战斗模拟。它不读取 DOM、MUV、Tavern Helper、当前消息或随机源，不写入 MUV，也不增加 AI JSON 字段。实时战斗继续由唯一的 EffectProgram 执行器读取真实宿主状态；网站、服务和 Mod 可以直接复用这些纯函数。
