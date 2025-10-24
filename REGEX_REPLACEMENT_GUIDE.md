# 正则替换指南

## 概述
本文档说明了如何使用正则表达式将AI输出的内容替换到HTML页面中。

## 当前正则表达式

### 原始正则（仅支持普通选项）
```javascript
/<Story>([\s\S]*?)<\/Story>[\s\S]*?<Options>([\s\S]*?)<\/Options>/gm
```

### 新的正则（统一选项格式）
```javascript
/<Story>([\s\S]*?)<\/Story>[\s\S]*?<Options>([\s\S]*?)<\/Options>/gm
```

**规则**:
- **Story块**: 剧情内容
- **Options块**: 包含所有选项，通过不同标签名区分类型
  - `<Option>`: 普通选项
  - `<BattleOption>`: 战斗选项
- 捕获组：$1=Story, $2=Options（包含所有选项）

## 捕获组说明

- **$1**: Story内容 - 剧情描述文本
- **$2**: Options内容 - 包含所有选项（普通选项用Option标签，战斗选项用BattleOption标签）

## HTML替换目标

在 `src/common/index.html` 中：

```html
<div class="story-text">$1</div>
<div class="options-text">$2</div>
<div class="battle-options-text">$3</div>
```

## AI输出示例

### 包含战斗选项的完整输出
```xml
<Story>
你走进了一个阴暗的洞穴，突然听到了低沉的咆哮声。一只巨大的洞穴熊出现在你面前，它的眼中闪烁着愤怒的光芒。
</Story>
<Options>
<Option id="1">🏃 立即逃跑</Option>
<Option id="2">🕵️ 尝试悄悄绕过</Option>
<Option id="3">🗣️ 尝试与熊交流</Option>
<BattleOption id="1">⚔️ 与洞穴熊战斗</BattleOption>
<BattleOption id="2">🔥 使用火焰魔法攻击</BattleOption>
</Options>
```

### 仅包含普通选项的输出
```xml
<Story>
你来到了一个宁静的村庄，村民们正在准备晚餐。空气中弥漫着美食的香味。
</Story>
<Options>
<Option id="1">🏠 寻找旅店休息</Option>
<Option id="2">🍽️ 询问是否可以共进晚餐</Option>
<Option id="3">📰 打听当地的消息</Option>
</Options>
```

### 仅包含战斗选项的输出
```xml
<Story>
敌人已经发现了你！一场战斗不可避免，你必须选择你的战斗策略。
</Story>
<Options>
<BattleOption id="1">⚔️ 正面强攻</BattleOption>
<BattleOption id="2">🏹 远程射击</BattleOption>
<BattleOption id="3">🛡️ 防御反击</BattleOption>
</Options>
```

## 正则匹配结果

### 有战斗选项的情况
- **$1**: "你走进了一个阴暗的洞穴..."
- **$2**: "\n<Option id=\"1\">🏃 立即逃跑</Option>\n<Option id=\"2\">🕵️ 尝试悄悄绕过</Option>\n<Option id=\"3\">🗣️ 尝试与熊交流</Option>\n"
- **$3**: "\n<BattleOption id=\"1\">⚔️ 与洞穴熊战斗</BattleOption>\n<BattleOption id=\"2\">🔥 使用火焰魔法攻击</BattleOption>\n"

### 无战斗选项的情况
- **$1**: "你来到了一个宁静的村庄..."
- **$2**: "\n<Option id=\"1\">🏠 寻找旅店休息</Option>\n<Option id=\"2\">🍽️ 询问是否可以共进晚餐</Option>\n<Option id=\"3\">📰 打听当地的消息</Option>\n"
- **$3**: undefined 或 空字符串

### 仅战斗选项的情况
- **$1**: "敌人已经发现了你！一场战斗不可避免..."
- **$2**: "\n" (空的Options内容)
- **$3**: "\n<BattleOption id=\"1\">⚔️ 正面强攻</BattleOption>\n<BattleOption id=\"2\">🏹 远程射击</BattleOption>\n<BattleOption id=\"3\">🛡️ 防御反击</BattleOption>\n"

## 奖励页面正则表达式

### 奖励页面触发正则
```javascript
/<REWARD>([\s\S]*?)<\/REWARD>/gm
```

**规则**:
- **REWARD块**: 奖励页面触发标签
- 捕获组：$1=REWARD内容（通常包含UpdateVariable）

### 奖励页面AI输出示例
```xml
<Story>
你成功击败了洞穴熊！战斗的经验让你变得更加强大，同时你在熊的巢穴中发现了一些宝物。
</Story>
<Options>
<Option id="1">🔍 继续探索洞穴深处</Option>
<Option id="2">🏠 返回村庄休息</Option>
<Option id="3">📦 整理战利品</Option>
</Options>
<REWARD>
<UpdateVariable>
<Analysis>
战斗胜利，玩家获得经验和奖励选择
</Analysis>
_.add('battle.exp', 50);//击败洞穴熊获得经验
_.assign('reward.card', {
  "id": "power_strike",
  "name": "力量打击",
  "type": "Attack",
  "rarity": "Common",
  "cost": 2,
  "damage": 12,
  "description": "造成12点伤害",
  "emoji": "💪"
});//可选卡牌奖励
_.assign('reward.item', {
  "id": "healing_potion",
  "name": "治疗药水",
  "type": "Consumable",
  "rarity": "Common",
  "effect": "恢复20点生命值",
  "description": "使用后恢复20点生命值",
  "emoji": "🧪"
});//可选道具奖励
</UpdateVariable>
</REWARD>
```

### 奖励页面正则匹配结果
- **$1**: "\n<UpdateVariable>\n<Analysis>...\n</UpdateVariable>\n"

## 注意事项

1. **BattleOptions是可选的** - 正则使用了 `(?:...)?` 来表示可选匹配
2. **REWARD是可选的** - 只在需要触发奖励页面时才包含
3. **直接替换** - 捕获的内容会直接替换到HTML中，不进行额外处理
4. **保持XML格式** - AI输出必须严格遵循XML格式，否则正则匹配失败
5. **空战斗选项** - 当没有战斗选项时，$3为空，对应的HTML区域会显示为空
6. **奖励页面触发** - 当检测到REWARD标签时，会触发奖励页面替换当前页面内容
