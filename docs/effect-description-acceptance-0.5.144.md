# 条件效果中文说明验收（0.5.144）

## 目标

条件、触发器、分支和弃牌后效果必须显示真实时机与结果，不能依赖 AI 自行复述，也不能暴露内部公式字段或代码比较符。

## 统一行为

- 字面量和公式型 `discard_effects` 都会进入规则说明。
- 卡牌专属弃牌规则使用“此牌被战斗效果弃掉后”作为时机，不与遗物或能力的全局弃牌触发混淆。
- `when` 和内部 `if` 分支使用自然中文关系词；执行结果仍以编译后的效果程序为唯一依据。
- AI 叙事只补充动作、来源与质感；机械复述不会覆盖程序生成的权威规则。
- 战斗卡牌详情、完整牌组、普通状态栏、奖励与变量更新页共享同一效果解释核心。

## 自动验收

```text
npm run test:content-description
npm run test:battle-content-adapter
npm run test:common-interface
npm run test:pile-viewer-contract
npm run test:worldbook-contract
npm run typecheck
```

回归覆盖固定弃牌后格挡、条件格挡、结构化触发器、AI 叙事与权威规则合并、普通页标签和牌堆详情。

## 最终结果

- 完整 `npm run release:tavern` 用时约 282.3 秒并通过。
- SillyTavern 官方接口导入并读回：角色 `魔法少女世界 0.5.144`、世界书 `魔法少女世界0.5.144`、20 条世界书、7 条正则、2 个已授权角色脚本；当前活动角色为 `魔法少女世界 0.5.144.png`。
- 根目录唯一角色卡 `魔法少女世界.png` 为 `8,039,797` 字节，SHA-256 `6C1D261DE71164B6E5FC85F093BEFE84D15630AD9FAD028F7931DEF21EC05B89`。
