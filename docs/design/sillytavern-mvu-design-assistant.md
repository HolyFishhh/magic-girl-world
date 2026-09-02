# SillyTavern MVU 设计辅助器

## 目标

`magic-girl-design-assistant` 是独立的 SillyTavern 前端扩展。它不替代 MVU，不修改 Tavern Helper，也不要求模型主动调用工具。扩展在 MVU 额外模型请求真正发送前完成程序编排：

扩展只认角色卡构建流程写入的 `mwg.design-assistant-card/v1` 元数据标记。角色名、世界书名称或变量结构相似都不能触发它；群聊与其他角色卡即使安装了 MVU，也不会收到设计上下文或敌人数值校准。

1. 读取当前消息的最新 MVU 变量。
2. 将玩家卡牌、状态、遗物、能力、资源与当前敌人转换为统一 `ContentPack`。
3. 用影子战斗模拟计算卡组分数、多维能力、输出/防护时间线与置信度。
4. 查询结构化流派知识图谱，给出多流派占比和相邻演变方向。
5. 按玩家当前生命、欲望余量与可调难度生成敌人数值预算。
6. 从聊天级元数据查询敌人谱系、近期敌人和可继承行动。
7. 将短设计上下文插入 Tavern Helper 已组装好的第二轮 prompt。
8. MVU 应用结果后，对新敌人执行契约检查、程序评分与可选的确定性数值校准。

影子模拟与生成后校准优先运行在独立 `design-worker.js` 中，避免占用 SillyTavern 主渲染线程。Worker 不可用、加载失败或超时时会自动切换到有界缓存的兼容路径，本轮 MVU 请求不会因为后台线程故障而丢失。

## 为什么使用请求前编排

MVU 的工具调用模式只注册并提取自己的变量更新工具。额外注册的原生 SillyTavern Function Tool 不会进入 MVU 的执行循环；Tavern Helper 的 `generateRaw` 也只返回工具调用，不替扩展执行多轮工具对话。因此，扩展监听 Tavern Helper 必经的 `GENERATE_AFTER_DATA` 事件，在网络请求前主动完成查询和模拟。

该事件位于 Tavern Helper 的 prompt 构建之后、响应生成之前，能够覆盖：

- 当前预设与内置破限；
- `generate` 与 `generateRaw`；
- 与当前插头相同的模型；
- Tavern Helper 自定义 API。

扩展同时检查 `Mvu.isDuringExtraAnalysis()`，所以普通剧情生成不会收到平衡上下文。

实际生效必须同时满足两个条件：当前角色卡带有专属标记，并且 MVU 明确报告正在进行额外模型解析。第一轮剧情、其他角色卡的第一轮或第二轮都会直接退出。

## 兼容基线

实现按 SillyTavern 1.18.0、酒馆助手 4.9.3 与当前 MVU 接口逐项核对：

- SillyTavern 的 `manifest.json` 模块钩子用于 `activate` / `disable` 生命周期；
- `SillyTavern.getContext()` 提供 `extensionSettings`、`chatMetadata`、事件源与保存函数；
- 酒馆助手的 `generate`、`generateRaw` 与自定义 API 路径在请求发出前都会触发 `GENERATE_AFTER_DATA`；
- `CHAT_COMPLETION_SETTINGS_READY` 只作为兼容回退，同一请求通过上下文标记幂等去重；
- MVU 通过 `Mvu.isDuringExtraAnalysis()` 暴露额外模型阶段，并在 `mag_variable_update_ended(variables, variables_before_update)` 允许扩展对本次变量快照做最终程序校准。

因此扩展不注册额外 Function Tool，也不增加模型往返；它在网络请求前完成确定性查询，在 MVU 落盘前完成一次性数值复核。

## 数据归属

| 数据 | 保存位置 | 原因 |
| --- | --- | --- |
| 启用状态、难度、模拟精度 | `extensionSettings` | 用户级设置 |
| 敌人谱系、校准指纹、最近结果 | `chatMetadata` | 每个聊天独立的长期记忆 |
| 卡组、状态、当前战斗 | MVU 消息变量 | 唯一游戏事实来源 |
| 流派节点和邻接关系 | 项目 TypeScript 构建产物 + IndexedDB 校验快照 | 结构化查询、版本控制和快速恢复；失效时回退内置图 |
| 模拟结果 | 页面内按指纹缓存 | 避免增加变量体积和 prompt 长度 |

世界书仍负责变量格式和剧情语义，但不再承担大型流派图、数值模拟或敌人谱系数据库。

## 数值校准边界

自动校准只缩放敌人的以下已注册数值：

- `hp` 与 `max_hp`，并保持剧情已经造成的生命比例；
- 行动、能力、状态和欲望效果中的伤害、格挡、治疗、欲望与状态层数。

它不改动敌人身份、名称、描述、行动顺序、命中次数、目标选择、触发时机或剧情状态。模型输出无法通过战斗内容契约时，扩展保留原内容，交给现有自然语言修复流程。

当低置信度卡组遇到严重超预算敌人时，一次校准会限制改动幅度。扩展最多执行五次有界校准，每次都重新运行当前资源模拟；只要运行时机制可模拟，就会将遭遇降到可通关线。

## 构建与本地安装

```powershell
npm run build:sillytavern-extension
npm run test:sillytavern-extension
node scripts/test-sillytavern-extension-package.mjs
npm run install:sillytavern-extension
```

安装脚本默认寻找相邻目录 `D:\project\_codex-tavern-e2e`。其他酒馆目录可用：

```powershell
node scripts/install-sillytavern-design-assistant.mjs --tavern D:\path\to\SillyTavern
```

安装完成后刷新 SillyTavern。进入目标角色卡后，可在角色卡的设置悬浮球中调整 10% 到 110% 难度、模拟精度和自动校准；扩展不再占用 SillyTavern 的独立设置栏。

安装目录包含 `index.js`、`design-worker.js`、`index.css` 与 `manifest.json`；缺少 Worker 文件时构建和安装测试会直接失败。

## 运行诊断

角色卡悬浮设置面板显示最近一次状态：预热、注入、校准、成功或错误。打开“调试日志”后，控制台会输出本轮注入的完整短上下文。页面全局还暴露只读调试入口：

```js
MagicGirlDesignAssistant.getStatus()
MagicGirlDesignAssistant.getSettings()
MagicGirlDesignAssistant.getState()
```

谱系和设置均有版本字段；未来图谱或记忆结构发生语义变化时，应增加 spec 并显式迁移，而不是静默复用旧缓存。
