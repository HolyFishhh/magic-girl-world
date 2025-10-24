

## 目录

1. [系统概述](#系统概述)
2. [架构设计](#架构设计)
3. [目录结构](#目录结构)
4. [核心模块说明](#核心模块说明)
5. [统一效果系统](#统一效果系统)
6. [数据流动](#数据流动)
7. [开发规范](#开发规范)
8. [常见任务](#常见任务)
9. [调试技巧](#调试技巧)
10. [注意事项与陷阱](#注意事项与陷阱)

---

## 系统概述

Fish RPG 是一个基于 TypeScript 的卡牌战斗系统，采用模块化设计，支持动态内容生成和复杂效果组合。

### 核心特性

- **统一效果表达式系统**: 使用统一的字符串语法表达所有游戏效果
- **动态内容生成**: 支持 AI 动态生成卡牌、状态、敌人等内容
- **单例模式架构**: 所有核心模块都是单例，确保状态一致性
- **事件驱动设计**: 模块间通过事件通信，降低耦合度
- **延迟死亡处理**: 确保所有效果执行完毕后才触发战斗结束

### 技术栈

- TypeScript
- jQuery (全局可用)
- SCSS (样式)
- SillyTavern MVU 变量系统

---

## 架构设计

### 设计原则

1. **单一职责**: 每个模块只负责一个明确的功能域
2. **依赖注入**: 通过单例获取依赖，避免循环依赖
3. **配置集中**: 效果、属性等配置集中在 `effectDefinitions.ts`
4. **代码复用**: 通用逻辑提取到 shared/ 目录
5. **类型安全**: 充分利用 TypeScript 类型系统

### 架构图

```
┌─────────────────────────────────────────────┐
│           index.ts (协调器)                  │
│         初始化 & 事件绑定                     │
└──────────┬──────────────────────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌─────────┐  ┌──────────┐
│ combat/ │  │  core/   │
│ 战斗系统 │  │状态管理  │
└────┬────┘  └─────┬────┘
     │             │
     └──────┬──────┘
            │
    ┌───────┴────────┐
    │                │
    ▼                ▼
┌────────┐      ┌────────┐
│  ui/   │      │modules/│
│UI显示  │      │功能模块│
└────────┘      └────────┘
```

---

## 目录结构

```
src/fish/
├── combat/                    # 战斗核心系统
│   ├── effectDefinitions.ts  # ⭐ 效果系统集中配置
│   ├── unifiedEffectParser.ts  # 效果字符串解析器
│   ├── unifiedEffectExecutor.ts # 效果执行器
│   ├── battleManager.ts       # 战斗流程管理
│   ├── cardSystem.ts          # 卡牌系统
│   ├── dynamicStatusManager.ts # 动态状态管理
│   ├── effectEngine.ts        # 效果引擎（包装器）
│   └── README_EFFECT_SYSTEM.md # 效果系统文档
│
├── core/                      # 核心状态管理
│   └── gameStateManager.ts   # ⭐ 游戏状态管理器
│
├── ui/                        # UI 显示层
│   ├── battleUI.ts           # 战斗UI主控
│   ├── unifiedEffectDisplay.ts # 效果显示转换器
│   ├── animationManager.ts   # 动画管理
│   ├── components.ts         # UI组件
│   ├── pileViewer.ts         # 牌堆查看器
│   ├── statusDetailViewer.ts # 状态详情查看
│   ├── lustOverflowDisplay.ts # 欲望溢出显示
│   ├── modifierDisplay.ts    # 修饰符显示
│   ├── card3DEffects.ts      # 卡牌3D效果
│   └── battleUI.ts           # 战斗UI
│
├── modules/                   # 功能模块
│   ├── battleLog.ts          # 战斗日志
│   ├── enemyIntent.ts        # 敌人意图显示
│   └── relicEffectManager.ts # 遗物效果管理
│
├── shared/                    # 共享工具
│   ├── effectAnalysis.ts     # 效果分析（意图推断）
│   ├── effectStringUtils.ts  # 效果字符串工具
│   ├── selectorUtils.ts      # 选择器描述工具
│   └── variableNames.ts      # 变量名映射
│
├── types/                     # 类型定义
│   └── index.ts              # ⭐ 所有类型定义
│
├── styles/                    # 样式文件
│   └── animations.scss       # 动画样式
│
├── test/                      # 测试文件
│   ├── ifStatementTest.ts    # 条件判断测试
│   └── runTests.ts           # 测试运行器
│
├── index.ts                   # ⭐ 主入口（协调器）
├── index.html                 # HTML结构
├── index.scss                 # 主样式
└── DEVELOPMENT_GUIDE.md      # 本文档
```

### 关键文件标识

- ⭐ 标记的文件是系统的核心，修改时需特别谨慎

---

## 核心模块说明

### 1. index.ts - 主协调器

**职责**:
- 初始化所有模块
- 设置事件监听器
- 协调模块间交互
- 提供全局API接口

**重要方法**:
```typescript
initialize(): Promise<void>           // 系统初始化
setupEventListeners(): void           // 设置事件监听
loadBattleData(): Promise<void>       // 加载战斗数据
triggerBattleStartEffects(): Promise<void> // 触发战斗开始效果
refreshUI(): Promise<void>            // 刷新UI
```

**注意事项**:
- ❗ 这个文件**只负责协调**，不包含业务逻辑实现
- ❗ 避免在此文件中添加复杂逻辑，应该放到对应模块
- ❗ 所有模块通过 `getInstance()` 获取单例
- ❗ 战斗开始效果的触发顺序很重要，不要随意调整

---

### 2. combat/effectDefinitions.ts - 效果系统配置中心

**职责**:
- 定义所有属性、触发器、操作符
- 配置执行优先级
- 提供查询工具函数

**核心接口**:
```typescript
interface AttributeDefinition {
  id: string              // 属性ID
  displayName: string     // 显示名称
  category: AttributeCategory // 类别
  dataType: 'number' | 'string' | 'boolean' | 'object'
  priority: number        // 执行优先级（越小越先执行）
  playerOnly?: boolean    // 是否仅玩家可用
}
```

**属性优先级规则**:
- **5**: 条件判断 (if-else)
- **10-19**: 最大值属性 (max_hp, max_lust, max_energy)
- **13-16**: 基础属性 (hp, lust, energy, block)
- **20-29**: 状态效果 (status)
- **30-39**: 修饰符 (damage_modifier等)
- **40-49**: 能力系统 (ability)
- **50-59**: 卡牌操作 (draw, discard, reduce_cost等)
- **60-69**: 特殊效果 (narrate)
- **999**: 未定义效果

**如何添加新效果**:
1. 在 `ATTRIBUTE_DEFINITIONS` 中添加属性定义
2. 在 `ATTRIBUTE_DISPLAY_CONFIG` 中添加 UI 显示配置（可选，用于卡牌效果显示）
3. 在 `unifiedEffectExecutor.ts` 中实现执行逻辑
4. 完成！UI 会自动使用集中配置

**特殊状态字段**:
- `stun` - 无法行动，通过状态的 `hold` 触发器使用（如 `"hold": "ME.stun"`）
  - 玩家被眩晕：无法打出任何卡牌
  - 敌人被眩晕：跳过行动（意图失效）

**UI 显示配置**:
- `TRIGGER_DISPLAY_CONFIG` - 触发器的显示名称、图标、颜色
- `ATTRIBUTE_DISPLAY_CONFIG` - 属性的显示名称、正负图标、颜色
- 所有 UI 层会自动使用这些配置，无需在多处定义

**注意事项**:
- ⚠️ priority 决定执行顺序，修改时要考虑连锁影响
- ⚠️ playerOnly 属性会影响目标解析逻辑
- ⚠️ 新增触发器需要同时在 `VALID_TRIGGERS` 和 `TRIGGER_DISPLAY_CONFIG` 中注册
- ⚠️ 格挡变化会自动触发 `gain_block` 和 `lose_block` 触发器

---

### 3. combat/unifiedEffectParser.ts - 效果解析器

**职责**:
- 解析效果字符串为结构化表达式
- 验证效果语法
- 生成人类可读描述

**核心方法**:
```typescript
parseEffectString(effectString: string): EffectExpression[]
describeEffect(effect: string): string
splitEffectsByComma(effectString: string): string[]  // 处理引号
```

**效果表达式结构**:
```typescript
interface EffectExpression {
  target?: 'ME' | 'OP'      // 目标（我方/对方）
  attribute: string          // 属性名
  operator: string           // 操作符
  value: string | number | object // 值
  isValid: boolean           // 是否有效
  errorMessage?: string      // 错误信息
  // ... 其他元数据
}
```

**解析规则**:
1. 逗号 `,` 是效果分隔符（引号内的逗号例外）
2. 支持单引号 `'` 和双引号 `"` 包裹字符串
3. 触发器使用括号 `trigger(effect1, effect2)`
4. 条件判断使用中括号 `if[condition][trueEffect]else[falseEffect]`


---

### 4. combat/unifiedEffectExecutor.ts - 效果执行器

**职责**:
- 执行解析后的效果表达式
- 处理效果副作用（触发器、动画等）
- 管理延迟死亡队列
- 应用修饰符计算

**核心方法**:
```typescript
executeEffectString(effectString: string, sourceIsPlayer: boolean): Promise<void>
executeExpression(expression: EffectExpression): Promise<void>
processAbilitiesAtTurnStart(target: 'player' | 'enemy'): Promise<void>
processPendingDeaths(): Promise<void>
```

**重要特性**:

1. **延迟死亡处理**:
```typescript
// 实体死亡不会立即结束战斗，而是标记到队列
private pendingDeaths: Set<'player' | 'enemy'> = new Set();

// 所有效果执行完毕后统一处理
await this.processPendingDeaths();
```

2. **修饰符系统**:
```typescript
// 支持 +, -, *, /, = 操作
// 修饰符会影响伤害、格挡等数值计算
private applyModifiers(value: number, modifierType: string): number
```

3. **触发器处理**:
- 回合开始/结束触发器
- 受伤/治疗触发器
- 格挡获得/失去触发器
- 状态变化触发器
- 能力触发器

**特殊检查方法**:
- `isStunned(targetType)` - 检查实体是否被眩晕（无法行动）

**注意事项**:
- ❗ 不要在效果执行中途直接调用 `handleEntityDeath`
- ❗ 修饰符计算顺序：加减法 → 乘除法 → 设置
- ❗ 触发器可能导致递归，需要防止无限循环
- ❗ `playerOnly` 属性会影响目标解析
- ❗ 格挡值变化时会自动触发对应触发器（gain_block/lose_block）

---

### 5. core/gameStateManager.ts - 游戏状态管理器

**职责**:
- 管理所有游戏状态（玩家、敌人、回合等）
- 与 SillyTavern MVU 变量同步
- 发布状态变化事件
- 提供状态查询接口

**核心方法**:
```typescript
loadFromSillyTavern(): Promise<boolean>  // 从MVU加载
saveToSillyTavern(): void                // 保存到MVU
updatePlayer(updates: Partial<Player>): void
updateEnemy(updates: Partial<Enemy>): void
drawCardsFromPile(count: number): Card[]
addEventListener(event: string, callback: Function): void
```

**状态同步流程**:
```
MVU变量 → loadFromSillyTavern() → gameState
                                      ↓
                                  业务逻辑
                                      ↓
gameState → saveToSillyTavern() → MVU变量
```

**MVU 变量路径**:
- 玩家数据: `variables.stat_data.battle.core`
- 卡牌数据: `variables.stat_data.battle.cards`
- 敌人数据: `variables.battle.enemy` (优先) 或 `variables.stat_data.battle.enemy`
- 遗物数据: `variables.stat_data.battle.artifacts`
- 状态定义: `variables.stat_data.battle.statuses`

**注意事项**:
- ⚠️ MVU 变量可能有多层嵌套数组，需要递归解析
- ⚠️ 敌人数据有两个可能的路径，需要都检查
- ⚠️ 修改状态后要调用 `saveToSillyTavern()` 持久化
- ⚠️ 事件监听器用于自动刷新 UI，不要滥用

---

### 6. combat/battleManager.ts - 战斗流程管理

**职责**:
- 管理战斗回合流程
- 执行敌人行动
- 处理回合切换
- 触发回合事件

**核心流程**:
```typescript
initializeBattle()    // 初始化战斗
  ↓
startPlayerTurn()     // 玩家回合开始
  ↓
[玩家出牌]
  ↓
endPlayerTurn()       // 玩家回合结束
  ↓
executeEnemyTurn()    // 敌人回合
  ↓
[循环]
```

**敌人回合流程**:
1. 清除敌人格挡（回合开始时）
2. 处理回合开始触发器
3. 执行敌人意图
4. 处理回合结束触发器
5. 为下回合生成新意图
6. 开始玩家回合

**注意事项**:
- ⚠️ 敌人格挡在**回合开始时**清零（让格挡在玩家回合生效）
- ⚠️ 玩家格挡在**回合开始时**清零
- ⚠️ 不要在 playCard 中检查死亡，由 UnifiedEffectExecutor 处理
- ⚠️ 敌人意图应该在上一回合结束时就生成好
- ⚠️ 敌人回合开始时会检查眩晕状态，如眩晕则跳过行动

---

### 7. combat/cardSystem.ts - 卡牌系统

**职责**:
- 管理卡牌抽取、弃牌、消耗
- 处理卡牌打出逻辑
- 计算卡牌费用（包括减费）
- 管理手牌限制

**核心方法**:
```typescript
playCard(cardId: string, targetType?: 'player' | 'enemy'): Promise<boolean>
drawCards(count: number): Card[]
discardCards(cards: Card[]): void
exhaustCard(card: Card): void
calculateCardCost(card: Card): number
```

**卡牌费用计算**:
```typescript
// 支持两种费用类型：
// 1. 数字：固定费用
// 2. "energy"：消耗所有能量
const cost = card.cost === 'energy' ? player.energy : (card.cost || 0);
```


**注意事项**:
- ⚠️ 诅咒牌（Curse）不能被打出
- ⚠️ 空灵牌（ethereal）回合结束时如果在手牌则消耗
- ⚠️ 保留牌（retain）不会在回合结束时弃牌
- ⚠️ 减费效果是临时的，原始费用不变
- ⚠️ 玩家被眩晕时无法打出任何卡牌

---

### 8. combat/dynamicStatusManager.ts - 动态状态管理

**职责**:
- 从 MVU 加载 AI 生成的状态定义
- 管理状态效果的触发器
- 处理状态层数变化规则

**状态定义结构**:
```typescript
interface DynamicStatusDefinition {
  id: string
  name: string
  type: 'buff' | 'debuff' | 'neutral'
  stacks_change?: number | string  // -1, +2, x0.5, reset, keep
  triggers: {
    apply?: string[]   // 施加时
    tick?: string[]    // 每回合
    remove?: string[]  // 移除时
    hold?: string[]    // 持有时（修饰符）
  }
}
```

**层数变化规则**:
- **数字**: 直接增减（-1 每回合-1层，+2 每回合+2层）
- **x0.5**: 每回合层数减半（向下取整）
- **reset**: 每回合清零
- **keep**: 不变化

**注意事项**:
- ⚠️ MVU 变量可能有多层嵌套，需要递归解析
- ⚠️ 状态定义要在初始化时从 MVU 刷新
- ⚠️ `hold` 触发器常用于修饰符效果
- ⚠️ 状态效果的 `ME/OP` 是相对于持有者的

---

### 9. ui/battleUI.ts - 战斗UI主控

**职责**:
- 刷新战斗界面显示
- 更新玩家/敌人状态
- 渲染手牌、状态、能力
- 更新牌堆计数

**核心方法**:
```typescript
refreshBattleUI(gameState: GameState): Promise<void>
updatePlayerDisplay(player: Player): void
updateEnemyDisplay(enemy: Enemy): void
updateHandCardsDisplay(hand: Card[]): void
```

**UI更新时机**:
- 回合开始/结束
- 卡牌打出
- 状态变化
- 牌堆变化
- 触发器效果

**注意事项**:
- ⚠️ 敌人意图只在回合切换时更新，避免频繁刷新
- ⚠️ 格挡为0时要隐藏格挡显示
- ⚠️ 手牌数量过多时要调整显示
- ⚠️ 使用 UnifiedEffectDisplay 转换效果显示

---

### 10. ui/unifiedEffectDisplay.ts - 效果显示转换器

**职责**:
- 将效果表达式转换为 UI 标签
- 生成颜色标注的效果文本
- 处理特殊效果的显示

**显示标签类型**:
```typescript
interface EffectDisplayTag {
  text: string    // 显示文本
  color: string   // 颜色
  type: 'damage' | 'heal' | 'buff' | 'debuff' | ...
}
```

**注意事项**:
- ⚠️ 玩家专属效果不需要显示目标前缀
- ⚠️ 数值要格式化为可读形式
- ⚠️ 负值操作符要正确处理（-(-5) 显示为 +5）

---



## 数据流动

### 游戏启动流程

```
1. index.ts → initialize()
   ↓
2. 加载 MVU 变量 → gameStateManager.loadFromSillyTavern()
   ↓
3. 刷新动态状态 → DynamicStatusManager.refreshFromMVU()
   ↓
4. 初始化战斗 → battleManager.initializeBattle()
   ↓
5. 触发战斗开始效果 → triggerBattleStartEffects()
   ↓
6. 刷新 UI → refreshUI()
```

### 卡牌使用流程

```
1. 用户点击卡牌 → index.ts 监听事件
   ↓
2. 播放动画 → animationManager.animateCardPlay()
   ↓
3. 执行卡牌 → cardSystem.playCard()
   ├─ 检查费用
   ├─ 扣除能量
   ├─ 解析效果 → unifiedEffectParser.parseEffectString()
   ├─ 执行效果 → unifiedEffectExecutor.executeEffectString()
   │  ├─ 按优先级排序
   │  ├─ 逐个执行表达式
   │  ├─ 触发副作用（动画、日志）
   │  ├─ 标记死亡到队列
   │  └─ 处理延迟死亡 → processPendingDeaths()
   ├─ 触发打出卡牌触发器
   ├─ 处理卡牌特性（exhaust, ethereal）
   └─ 将卡牌移到弃牌堆/消耗堆
   ↓
4. 刷新 UI → refreshUI()
```

### 回合切换流程

```
1. 玩家点击"结束回合" → battleManager.endPlayerTurn()
   ├─ 处理回合结束触发器
   ├─ 弃掉非保留手牌
   ├─ 处理空灵牌
   ├─ 玩家格挡清零
   └─ 切换到敌人回合
   ↓
2. 执行敌人回合 → battleManager.executeEnemyTurn()
   ├─ 敌人格挡清零（回合开始时）
   ├─ 处理敌人回合开始触发器
   ├─ 执行敌人意图
   ├─ 处理敌人回合结束触发器
   ├─ 生成下回合意图
   └─ 切换到玩家回合
   ↓
3. 开始玩家回合 → battleManager.startPlayerTurn()
   ├─ 回合数+1
   ├─ 恢复能量
   ├─ 抽牌
   ├─ 处理玩家回合开始触发器
   └─ 等待玩家操作
```

### MVU 变量同步

**读取路径**:
```typescript
// 玩家数据
variables.stat_data.battle.core        // 基础属性
variables.stat_data.battle.cards       // 卡牌
variables.stat_data.battle.artifacts   // 遗物

// 敌人数据（优先路径）
variables.battle.enemy                 
// 敌人数据（备用路径）
variables.stat_data.battle.enemy

// 状态定义
variables.stat_data.battle.statuses
```

**写入**:
```typescript
gameStateManager.saveToSillyTavern()
```

**同步时机**:
- 战斗初始化
- 状态变化（生命值、能量等）
- 战斗结束
- 重要事件（升级、获得遗物等）

---

## 开发规范

### 代码风格

1. **使用 TypeScript 类型**:
```typescript
// ✅ 好
function updateHP(target: 'player' | 'enemy', value: number): void { }

// ❌ 差
function updateHP(target, value) { }
```

2. **单例模式**:
```typescript
// ✅ 好
export class MyManager {
  private static instance: MyManager;
  
  private constructor() { }
  
  public static getInstance(): MyManager {
    if (!MyManager.instance) {
      MyManager.instance = new MyManager();
    }
    return MyManager.instance;
  }
}

// ❌ 差 - 直接导出实例
export const myManager = new MyManager();
```

3. **异步操作使用 async/await**:
```typescript
// ✅ 好
async function executeEffect(effect: string): Promise<void> {
  await this.processEffect(effect);
  await this.triggerAnimations();
}

// ❌ 差 - Promise 链
function executeEffect(effect: string): Promise<void> {
  return this.processEffect(effect)
    .then(() => this.triggerAnimations());
}
```

4. **日志规范**:
```typescript
// ✅ 好 - 使用表情符号和清晰的层级
console.log('🎮 初始化战斗系统');
console.log('  ├─ 加载玩家数据');
console.log('  ├─ 加载敌人数据');
console.log('  └─ 初始化UI');
console.error('❌ 初始化失败:', error);

// ❌ 差 - 无结构的日志
console.log('init battle');
console.log(error);
```

### 注释规范

1. **文件头注释**:
```typescript
/**
 * 模块名称 - 简短描述
 * 
 * 负责:
 * 1. 职责1
 * 2. 职责2
 * 
 * 重要事项:
 * - 注意事项1
 * - 注意事项2
 */
```

2. **方法注释**:
```typescript
/**
 * 执行效果字符串
 * @param effectString - 效果字符串（统一表达式语法）
 * @param sourceIsPlayer - 效果来源是否为玩家
 * @param context - 执行上下文（可选）
 * @returns Promise<void>
 */
public async executeEffectString(
  effectString: string,
  sourceIsPlayer: boolean,
  context?: any
): Promise<void> { }
```

3. **复杂逻辑注释**:
```typescript
// 延迟死亡处理：标记实体死亡但不立即结束战斗
// 这样可以确保所有效果都执行完毕
if (newValue <= 0) {
  this.pendingDeaths.add(targetType);
}
```

### 错误处理

1. **捕获并记录错误**:
```typescript
try {
  await this.executeEffect(effect);
} catch (error) {
  console.error('❌ 执行效果失败:', effect, error);
  // 可选：显示用户友好的错误信息
  AnimationManager.getInstance().showErrorNotification('效果执行失败');
}
```

2. **验证输入**:
```typescript
if (!effectString || typeof effectString !== 'string') {
  console.error('❌ 无效的效果字符串:', effectString);
  return;
}
```

3. **提供有用的错误信息**:
```typescript
throw new Error(`无法解析效果: ${effectString}。原因: ${reason}`);
```

---

## 常见任务

### 添加新卡牌效果

1. 在 `effectDefinitions.ts` 添加定义:
```typescript
export const ATTRIBUTE_DEFINITIONS: Record<string, AttributeDefinition> = {
  // ... 现有定义 ...
  
  my_new_effect: {
    id: 'my_new_effect',
    displayName: '我的新效果',
    category: 'card',
    dataType: 'number',
    priority: 58,
    playerOnly: true,
  },
};
```

2. 在 `unifiedEffectExecutor.ts` 实现逻辑:
```typescript
private async executeCardEffect(expression: EffectExpression): Promise<void> {
  // ... 现有 case ...
  
  case 'my_new_effect':
    await this.handleMyNewEffect(expression);
    break;
}

private async handleMyNewEffect(expression: EffectExpression): Promise<void> {
  // 实现你的逻辑
  const value = this.resolveValue(expression.value);
  // ...
}
```

3. （可选）在 `unifiedEffectDisplay.ts` 添加显示逻辑:
```typescript
private getAttributeActionText(attribute: string, operator: string, value: any): string {
  // ... 现有 case ...
  
  case 'my_new_effect':
    return `我的新效果 ${value}`;
}
```

### 添加新触发器

1. 在 `effectDefinitions.ts` 注册触发器并配置 UI:
```typescript
// 添加类型定义
export type TriggerType =
  | 'battle_start'
  // ... 现有触发器 ...
  | 'my_new_trigger';

// 添加到有效触发器列表
export const VALID_TRIGGERS: TriggerType[] = [
  // ... 现有触发器 ...
  'my_new_trigger',
];

// 配置 UI 显示
export const TRIGGER_DISPLAY_CONFIG: Record<string, TriggerDisplayConfig> = {
  // ... 现有配置 ...
  my_new_trigger: { name: '我的新触发器', icon: '✨', color: '#a855f7' },
};
```

2. 在 `unifiedEffectExecutor.ts` 实现处理:
```typescript
public async processAbilitiesByTrigger(
  target: 'player' | 'enemy',
  trigger: string
): Promise<void> {
  // ... 现有逻辑 ...
  
  if (trigger === 'my_new_trigger') {
    // 触发你的逻辑
  }
}
```

3. 在适当的位置调用:
```typescript
// 例如在某个事件发生时
await this.effectEngine.processAbilitiesByTrigger('player', 'my_new_trigger');
```

### 添加新状态效果

在 SillyTavern 中通过 AI 生成状态定义:


系统会自动从 MVU 变量加载并处理。

### 添加新遗物

在 SillyTavern 中通过 AI 生成遗物:


系统会自动处理遗物效果。

### 调整执行优先级

在 `effectDefinitions.ts` 中修改 priority 值:
```typescript
{
  id: 'my_effect',
  // ...
  priority: 25,  // 改为更小的值可以让它更早执行
}
```

### 添加新修饰符

1. 在 `effectDefinitions.ts` 添加定义:
```typescript
my_new_modifier: {
  id: 'my_new_modifier',
  displayName: '我的新修饰符',
  category: 'modifier',
  dataType: 'number',
  priority: 35,
},
```

2. 在 `unifiedEffectExecutor.ts` 中应用修饰符:
```typescript
private applyModifiers(value: number, modifierType: string, entity: Player | Enemy): number {
  // ... 现有修饰符逻辑 ...
  
  if (modifierType === 'my_new_modifier') {
    const modifier = entity.modifiers?.['my_new_modifier'] || 0;
    value += modifier; // 或其他计算逻辑
  }
  
  return value;
}
```

### 添加新UI组件

1. 在 `ui/components.ts` 或新文件中创建组件类:
```typescript
export class MyNewComponent {
  private static instance: MyNewComponent;
  
  private constructor() {
    this.initialize();
  }
  
  public static getInstance(): MyNewComponent {
    if (!MyNewComponent.instance) {
      MyNewComponent.instance = new MyNewComponent();
    }
    return MyNewComponent.instance;
  }
  
  private initialize(): void {
    // 初始化逻辑
  }
  
  public render(data: any): void {
    // 渲染逻辑
  }
}
```

2. 在 `index.ts` 中初始化和使用:
```typescript
import { MyNewComponent } from './ui/myNewComponent';

class FishRPGCoordinator {
  private myNewComponent: MyNewComponent;
  
  constructor() {
    // ...
    this.myNewComponent = MyNewComponent.getInstance();
  }
}
```

---

## 调试技巧

### 使用浏览器控制台

```javascript
// 获取游戏状态
const gsm = window.GameStateManager?.getInstance();
const state = gsm?.getGameState();
console.log(state);

// 获取玩家信息
const player = gsm?.getPlayer();
console.log('玩家:', player);

// 获取敌人信息
const enemy = gsm?.getEnemy();
console.log('敌人:', enemy);

// 手动执行效果
const executor = window.UnifiedEffectExecutor?.getInstance();
await executor?.executeEffectString('OP.hp - 999', true);

// 手动刷新UI
await window.refreshBattleUI?.();
```

### 调试效果解析

在 `unifiedEffectParser.ts` 中添加调试日志:
```typescript
console.log('🔍 解析效果:', effectString);
console.log('  分割结果:', parts);
console.log('  解析后:', expressions);
```

### 调试效果执行

在 `unifiedEffectExecutor.ts` 中添加调试日志:
```typescript
console.log('🎯 执行效果:', expression);
console.log('  目标:', targetType);
console.log('  属性:', expression.attribute);
console.log('  操作:', expression.operator);
console.log('  值:', expression.value);
```

### 使用战斗日志

战斗日志会记录所有重要事件:
```typescript
BattleLog.logPlayerAction('卡牌', '使用了卡牌 xxx');
BattleLog.logDamage('玩家对敌人造成了10点伤害', 'player');
BattleLog.logHeal('玩家回复了5点生命', 'player');
```

点击界面上的"战斗日志"按钮查看。

### 断点调试

在关键位置设置断点:
- `unifiedEffectExecutor.ts` 的 `executeExpression()`
- `cardSystem.ts` 的 `playCard()`
- `battleManager.ts` 的 `executeEnemyTurn()`
- `gameStateManager.ts` 的 `loadFromSillyTavern()`

### MVU 变量检查

```javascript
// 获取 MVU 变量
const vars = getVariables({ type: 'message' });
console.log('MVU 变量:', vars);

// 检查战斗数据
console.log('战斗数据:', vars.stat_data?.battle);
console.log('敌人数据:', vars.battle?.enemy || vars.stat_data?.battle?.enemy);

// 检查状态定义
console.log('状态定义:', vars.stat_data?.battle?.statuses);
```


## 附录

### 相关文档

- [效果系统架构](./combat/README_EFFECT_SYSTEM.md)
- [变量说明](../../worldbook_new/1变量说明.md)
- [战斗内容生成要求](../../worldbook_new/2战斗内容生成要求.md)

### 项目约定

1. **不使用 vh 单位**: 使用宽度与 `aspect-ratio` 实现高度
2. **不直接使用 python**: 使用 uv 包管理工具
3. **全局库**: jQuery, jQuery-UI, Lodash, Toastr, YAML 全局可用
4. **样式导入**: 在 index.ts 中导入 SCSS
5. **加载/卸载**: 参考 `src/脚本示例/加载和卸载时执行函数.ts`


