# Fish 模块开发指南（后续开发统一约定）

本指南用于规范 fish 模块新增/修改的开发方式，确保“效果解析/执行/显示”的单一来源与可演进性，避免重复实现与多处同步维护。

## 1. 目录结构（核心相关）

- src/fish/combat/
  - unifiedEffectParser.ts 统一效果解析器（唯一解析）
  - unifiedEffectExecutor.ts 统一效果执行器（唯一执行）
  - dynamicStatusManager.ts 动态状态管理（AI/MVU 生成的状态定义与触发效果）
  - cardSystem.ts 卡牌系统（出牌、弃牌、选择等，调用统一执行器）
  - battleManager.ts 战斗流程（回合、战斗开始/结束，调用统一执行/遗物/状态）
- src/fish/modules/
  - relicEffectManager.ts 遗物管理（以 trigger(...) 片段提取后交给执行器）
  - enemyIntent.ts 敌人意图（统一由 shared/effectAnalysis 推断 + 统一显示）
  - battleLog.ts 战斗日志
- src/fish/ui/
  - unifiedEffectDisplay.ts 统一效果显示（解析表达式→标签；仅用于展示，不做执行）
  - animationManager.ts 动画入口（唯一动画入口；已移除兼容冗余方法）
  - battleUI.ts 战斗 UI（调用 unifiedEffectDisplay 生成标签，避免自写解析）
- src/fish/shared/
  - variableNames.ts 变量展示映射（统一来源）
  - selectorUtils.ts 选择器描述（统一来源）
  - effectStringUtils.ts 触发片段提取/旧 if 语法转换（公共工具）
  - effectAnalysis.ts 效果→意图推断（公共工具，避免各处重复字符串匹配）
- docs/
  - fish-dev-guide.md 本指南
  - backup/ 历史备份（不可作为实现依据）

## 2. 单一来源原则（非常重要）

- 解析：仅能由 combat/unifiedEffectParser.ts 提供。禁止在 UI、模块等再次正则解析效果字符串。
- 执行：仅能由 combat/unifiedEffectExecutor.ts 提供。卡牌、遗物、状态触发等均调用执行器，不得各自执行字符串。
- 展示：统一由 ui/unifiedEffectDisplay.ts 将表达式转为标签。不要在 UI 处手写解析/翻译表。
- 触发片段：使用 shared/effectStringUtils.extractTriggeredSegments，而不要在模块中复制实现。
- 意图推断：使用 shared/effectAnalysis.inferIntentFromEffect，禁止在不同模块各自写字符串 includes 匹配。
- 变量名/选择器展示：统一使用 shared/variableNames 与 shared/selectorUtils。

如果新增能力/语法：
1) 先在 Parser 定义解析（必要时补充 attributeDefinitions、操作符等）。
2) 在 Executor 落实执行逻辑（包含数值计算、上下文处理、动画/日志触发）。
3) 在 UnifiedEffectDisplay 增加展示映射（图标/颜色/文本），禁止在分散模块补丁式渲染。

## 3. 使用方式与开发注意

- 卡牌效果执行：
  - 始终通过 UnifiedEffectExecutor.executeEffectString(card.effect, /* sourceIsPlayer= */ true, context)
  - 不允许在卡牌处拼接/解析效果；上下文仅补充“使用前能量、卡牌信息”等。

- 遗物效果执行：
  - 先用 extractTriggeredSegments(relic.effect, trigger) 取出 trigger(...) 片段，再逐段交给执行器。
  - 禁止使用“trigger: effect”的旧风格；仅支持“trigger(effects)”。

- 状态效果：
  - 动态状态定义与触发效果由 DynamicStatusManager 提供；状态触发由 Executor 调用自身的 processStatusEffectsByTrigger 再次走统一执行。
  - UI 展示状态详情时，使用 UnifiedEffectDisplay.parseTriggeredEffectToTags(trigger, effect) 生成标签；不得自行解析。

- 敌人意图：
  - 统一使用 shared/effectAnalysis.inferIntentFromEffect 推断类型与数值；UI 标签用 UnifiedEffectDisplay。

- 弃牌与 on_discard：
  - cardSystem 已接好统一执行器路径；修改时务必保持“单一执行入口、不重复触发”。

- 动画与 UI：
  - 仅通过 ui/animationManager.ts 的现有方法；不要新建平行动画入口或遗留兼容函数。

## 4. 禁止事项（Do Not）

- 不要在任意模块新增对效果字符串的独立解析（includes/正则）来决定执行或展示。
- 不要在 UI、模块层重复维护“变量名→中文”的映射；统一用 shared/variableNames。
- 不要在遗物/卡牌/状态各自实现一套执行逻辑；一律交给 Executor。
- 不要使用“trigger: effect”的旧冒号语法；仅保留“trigger(effects)”。
- 不要复制粘贴 extractTriggeredSegments/if 语法转换逻辑；请从 shared/effectStringUtils 引用。

## 5. 扩展新效果的步骤

1) 设计效果字符串（例如：
   - 基础属性：`OP.hp - 10`
   - 状态：`ME.status apply strength 2`
   - 卡牌操作：`discard.hand.choose 2` / `reduce_cost.hand.all 1`
   - 能力：`turn_start(ME.energy + 1)`）
2) Parser：确保能解析该表达式（必要时扩展 attributeDefinitions、操作符等）
3) Executor：在对应执行分支处理（属性/状态/卡牌/能力）。涉及变量或表达式，使用 calculateDynamicValue。
4) Display：增加图标/颜色/文本映射（若属新类别）。
5) 验证：在卡牌/遗物/状态三处以同一表达式接入；UI 标签由 UnifiedEffectDisplay 自动解析。

## 6. Tavern（酒馆）助手方法使用注意

- 酒馆助手指代在 MVU/运行时提供的工具函数与数据注入（如 DynamicStatusManager、变量上下文、叙事触发等）。
- 使用原则：
  - 只在统一执行器（或其直接依赖）中使用与效果执行强相关的助手；避免在 UI 或分散模块调用。
  - 若需要从 MVU 变量派生动态行为（如 stacks 替换、战斗上下文变量），务必放在 Executor 中集中处理。
  - UI 层仅消费“已解析的表达式/标签结果”，不直接访问助手方法。

## 7. 调试与日志

- 默认减少 console 噪声，仅在错误与关键路径输出。
- 如需详细日志，可在 Executor 内开启 verbose（或后续引入统一 debug 开关）。

## 8. 回归与构建

- 每次完成修改后执行 `npm run build` 确认构建通过。
- 建议新增/修改效果后，分别用：
  - 一张卡牌
  - 一个遗物
  - 一个状态触发
  - 一条敌人行动
 进行最小场景验证，确保三个入口均可通过统一解析/执行/展示。

---
以上规范用于保障“单一来源，可持续演进”。任何新增功能若无法复用上述统一入口，请先在评审中讨论是否需要扩展 Parser/Executor/Display，而非在业务模块就地实现。
