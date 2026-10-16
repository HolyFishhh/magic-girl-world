# 开局缺失规划修复（1.0.5.1 本地候选）

## 根因与修复

新诊断明确记录 preset 已返回完整正文和 CHARACTER_INIT_PENDING，但没有 TOWER_DUNGEON_PLAN。控制器因此在机制生成前失败；不是空响应或 MVU 保存失败。玩家原文不提交。

在隔离工作树 tmp/fix-mvu-desire-20261015、分支 codex/fix-opening-plan-20261015 修复，原工作树不动。纯正文现在保留并承接到原有机制请求，新增 dungeonPlan 字段交 AI 创作规划，正常不增加调用次数。合法已有规划保持原路径；显式损坏、重复或未闭合标签仍报结构错误。

新路径若仍漏规划或结构无效，使用机制生成已有的唯一修复额度，只返回规划对象，不重写正文、卡组和馈赠；与空响应、传输、格式和定义修复共用额度。同步 Schema、文本传输白名单、解析和 run.dungeonPlan 保存链；规划不展示在正文。没有新机制、效果字段或存档格式，世界书和效果说明链不变。不生成默认规划，不增加强度、成长曲线或剧情质量门槛。

## 验证

- 开局控制器全测通过，新增纯正文直接成功、规划定点修复、修复仍无效、额度已耗尽、修复时切换聊天五场景；覆盖实际普通文本 Helper 适配、Schema、正文/卡组保留、一次写入和保存恢复。
- mystery-plan、initial-draft-contract-placement、initial-joint-repair、initial-source-field-repair、schema-prompt-transport、initial-schema-transport 通过。mystery-plan 的历史空提示断言已核对 HEAD 与当前 presenter，按现有“未知遭遇，进入后揭晓”同步，保留隐藏类型/秘密正文检查。
- 两套 TypeScript 检查、卡内运行时测试、完整扩展测试通过；网页、卡内运行时与扩展构建成功。网页构建仍有体积提示。未做真实 DS 渠道或 iOS 实机验收。

## 安装与发布边界

本地酒馆 http://127.0.0.1:8012/ 已备份更新扩展五文件及最新卡运行时。测试显示名 **魔法少女世界 1.0.5.1**，精确头像 **魔法少女世界 1.0.5.1.png**。扩展 HTTP 回读与卡内运行时逐项匹配构建哈希；367 份其他角色、聊天、世界书和设置文件不变，当前聊天与设置不变。未自动刷新、调用模型或推进存档；测试需用户自行完整刷新。

- 运行时 SHA-256：920c9bc46259899bb420016b5ef575805297d4c919aed9cb505350b406ad0052。
- 扩展 index.js SHA-256：fc10a2b9a8531672b22003ce8de0b17964de68379a388fc6130dc917a6a93642。
- 证据与备份：忽略目录 tmp/opening-plan-*、tmp/tavern-runtime-backups/、tmp/tavern-extension-backups/。

本轮尚未推送或正式发布；公开 v1.0.5.1 标签、附件、卡站与扩展分支保持原样，不能把本地候选当作公开修订。
