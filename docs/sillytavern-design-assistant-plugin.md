# SillyTavern 构筑与遭遇设计辅助器

> 这是面向维护者的架构说明。安装、运行边界、校准规则与诊断命令的单一操作文档见
> [`docs/design/sillytavern-mvu-design-assistant.md`](design/sillytavern-mvu-design-assistant.md)。

## 目标

扩展具有硬作用域边界：只有嵌入 `mwg.design-assistant-card/v1` 标记的魔法少女世界角色卡，且当前请求处于 MVU 额外模型阶段时才运行。它不会根据卡名或通用 `battle` 字段猜测目标，因此不会介入其他角色卡。

这个扩展把卡组模拟、流派知识图谱、敌人数值预算和敌人谱系从角色卡世界书中拆出来，作为 SillyTavern 顶层运行时长期工作。它只增强 MVU 第二轮变量模型，不修改第一轮剧情模型，也不限制玩家输入、卡组结构或题材。

扩展入口为 `src/sillytavern-extension/`，构建产物位于 `dist/sillytavern-extension/magic-girl-design-assistant/`。

## 运行链路

```text
聊天或变量变化
  -> 独立 Web Worker 在空闲时预热卡组影子模拟并缓存指纹结果
  -> MVU 开始额外模型解析
  -> 监听 Tavern Helper GENERATE_AFTER_DATA
  -> 确认 Mvu.isDuringExtraAnalysis() 为 true
  -> 动态查询构筑评分、相关流派子图、敌人预算和当前聊天谱系
  -> 在历史上下文之后、MVU 任务之前插入紧凑 system 上下文
  -> AI 输出 UpdateVariable
  -> mag_variable_update_ended
  -> 仅当敌人机械指纹发生变化时进行程序评分
  -> 可选地只缩放敌人生命与效果数值
  -> 将谱系写入 chatMetadata，MVU 再正常落盘
```

同时监听 `CHAT_COMPLETION_SETTINGS_READY` 作为不同 Tavern Helper 请求分支的兼容回退；同一请求通过标记去重，不会注入两次。

## 为什么不把它做成 MVU 工具智能体

SillyTavern 原生 Function Calling 不支持 quiet/background 请求。MVU 的额外模型请求也有自己的唯一提交工具，不能安全加入另一组查询工具并期待多轮工具循环。强行使用工具智能体会增加请求长度、延迟和失败面。

因此当前链路采用确定性程序预查询：模型收到的是已经算好的短上下文，不需要自行调用工具。生成后的敌人再由程序复评和校准。这比让第二轮模型先规划、再查工具、再输出变量更快，也更容易保证只产生一个有效 `UpdateVariable`。

完整模拟和生成后校准运行在扩展自带的 `design-worker.js` 中。冷启动计算不会冻结 SillyTavern 主界面，预热后的同构筑查询直接命中指纹缓存。

## 数据分层

### 机械和评分

- `src/game-core/` 是唯一可执行机械来源。
- 卡组评分包含 1、3、5、8 回合的生命输出、欲望压力、防护、治疗，以及爆发、持续、生存、经济、稳定、成长、控制和组合维度。
- 最大生命参与长期卡组评分；当前生命和当前欲望只用于本场可打性与难度安全封顶。

### 流派知识图谱

- `src/game-core/archetypeGraph.ts` 保存结构化流派节点、邻接边、桥接条件和机械反协同。
- 扩展将图转换为版本化节点/关系快照，存入 IndexedDB 数据库 `magic-girl-world-design-graph-v1`。
- 查询按当前卡组的多流派亲和度选取种子，再做有限深度邻接遍历；不会用卡名、职业、毒、烧伤等题材词硬匹配。
- 通用散卡保持 `scatterShare`，不会被强迫归入某个流派。

### 敌人谱系

- 每个聊天的敌人谱系存入 `chatMetadata.magicGirlDesignAssistant`，随聊天长期保留。
- 只有 AI 明确给出 `family_id` 等谱系字段时才建立同族关系。
- 图中保存族群、位阶、机械轴和少量招牌行动结构，用于后续同族、精英和首领继承。
- 敌人题材和名字不参与玩家流派评分。

## 程序校准边界

自动校准只在新敌人或敌人机械定义发生变化时运行一次。它可以调整：

- `hp` 与 `max_hp`，并保持剧情已经造成的当前生命比例；
- 行动、能力、欲望效果中的数值量；
- 多敌人共享的总体强度。

它不会修改敌人身份、描述、行动名称、行动顺序、命中次数、玩家卡组、奖励或剧情状态。旧格式玩家遗物或自由构筑也不会阻断敌人数值校准。

## 设置

扩展不在 SillyTavern 扩展面板中显示独立管理栏。检测到当前角色卡和设计辅助组件后，设置会并入角色卡的设置悬浮球：

- 启用第二轮设计上下文；
- 敌人难度 10% 到 110%，带 10、50、80、100、110 快捷锚点；
- 生成后自动校准敌人数值；
- 模拟精度；
- 关键提示和调试日志。

同一入口还会显示卡组多维评分、流派总览、敌人预算，以及 MVU 第二轮的生成进度和完整回复。未加载辅助组件时，这组设置自动隐藏，不影响角色卡原有功能。

顶层 API 为 `window.MagicGirlDesignAssistant`，可调用：

- `getSettings()`；
- `getStatus()`；
- `warmup()`；
- `queryKnowledgeGraph(ids, depth)`；
- `getKnowledgeGraphStats()`。

## 构建与本地安装

```powershell
npm run build:sillytavern-extension
npm run test:sillytavern-extension
npm run install:sillytavern-extension
```

默认安装到：

```text
D:\project\_codex-tavern-e2e\public\scripts\extensions\third-party\magic-girl-design-assistant
```

扩展是顶层模块，不需要重新导入角色卡。修改并重建后刷新 SillyTavern 页面即可加载新版本。角色卡中的原有评分仍保留为无插件降级路径；检测到扩展启用后，角色 iframe 会停止重复的后台深度卡组模拟和第二套自动校准。

## 验证重点

- 普通剧情请求不含 `[MWG_DESIGN_CONTEXT/v1]`；
- MVU 第二轮请求只含一个该标记；
- 上下文长度保持有界；
- 新敌人会评分与校准，单纯血量消耗不会触发重复校准；
- 当前生命伤势比例不被重置；
- 同族敌人继承谱系信息，非同族敌人不被名字相似误绑定；
- 禁用或未安装扩展后，角色卡仍可正常运行。
