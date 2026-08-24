# 酒馆正则渲染说明

当前发布只包含三个轻量楼层壳。完整 HTML、CSS 和脚本由角色脚本 `MagicGirlWorld` 提供，正则不再携带大型页面，也不捕获正文。

| 视图 | 触发 | 楼层范围 | 行为 |
| --- | --- | --- | --- |
| start | `[开始游戏]` | 仅首条 AI 消息 | 渲染一次角色创建页 |
| common | `<StatusPlaceHolderImpl/>` | 最新三条 AI 消息 | 在原生正文末尾追加状态栏 |
| fish | `<BATTLE_START>` | 仅最新 AI 消息 | 在战斗引导正文后渲染战斗页 |

规则定义位于 `scripts/export-tavern-interface.mjs`，发布产物位于 `dist/tavern/*-interface.json`。

## 约束

- 正文由 SillyTavern 原生渲染，不进入 iframe。
- common 与 fish 互斥；战斗楼层不会再附加 common 状态栏。
- start 只允许消息 0，后续重复标记不会重建首页。
- common 的 `minDepth=0,maxDepth=2` 对应最新三层；历史层自动只读，超出窗口后卸载。
- fish 只允许最新楼层交互；变成历史层后禁用出牌和结算控件。
- `<Options>/<Option>/<BattleOption>` 已删除，不再由正则或前端解析。

## 为什么使用运行时壳

Tavern Helper 会再次解析正则替换中的 Markdown 与 HTML。直接把完整 bundle 塞进每条正则会增加聊天 DOM、重复脚本和前端压力。当前壳小于 10 KiB，只等待角色运行时并挂载对应资源；构建器会移除 CSS/JS 中的 BOM，避免后续 `:root` 变量整段失效。
