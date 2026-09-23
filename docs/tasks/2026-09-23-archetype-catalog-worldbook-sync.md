# 流派表与世界书补同步（2026-09-23）

## 发现与修复

此前新增的 `status_action` 复制／转移只混写在“状态净化”的摘要，卡牌额外／替代支付、状态伤害前／出牌前拦截则没有独立可选基础流派。流派世界书 ID 21 虽已安装且与当时源码逐字一致，但旧正文没有这些设计链。世界书的战斗 DSL 条目已支持结构字段；缺的是开局选择与流派设计引导。

本次把状态净化恢复为单纯移除，新增六个独立基础机制：状态复制、状态转移、额外支付、替代支付、伤害前拦截、出牌前拦截。流派目录由 138 项增至 144 项，12 类、67 个既有图谱节点不变。来源、身份、支付与拦截窗口边界同步进入《流派体系与设计方法》和生成的目录快照；六项能独立进入开局 Prompt。机制识别使用实际结构，不把复制当转移／净化、不把额外费用当替代费用、不把闲置状态或仅有名字的卡判成已拥有。

## 验证与本地安装

- `npm run test:tower-archetypes`、`node scripts/test-tower-foundation-recognition.mjs`、`node scripts/test-tower-foundation-guidance.mjs`、`npm run test:tower-archetype-picker`、`npm run test:worldbook-contract`、`npm run typecheck`、`npm run typecheck:st-extension`：均通过；浏览器隔离测试覆盖 390px / 1000px 的两开局入口、选择切换与清除，显示 144 项。该浏览器用例没有逐项实玩六个新机制。
- 源码提交 `3f8da60`。隔离候选 `archetype-sync-20260923-r1`：冻结 1035 个源码文件、保护原 dist 与已安装扩展 1031 个文件；构建前后保持原样。候选扩展与角色运行时均通过包契约，安装前 1035 个源码与 18 个候选产物哈希再核验一致。
- 更新且只更新本地测试酒馆 `http://127.0.0.1:8012/` 中最新角色 **魔法少女世界 1.0.3**（精确头像 **`魔法少女世界 1.0.3.png`**）的现有运行时、测试扩展五文件，以及世界书 ID 21「流派体系与设计方法」正文。旧版本角色卡、玩家聊天与存档不操作。
- 安装后角色运行时 API SHA-256 `6b31fb08afab6c3637b75ab928e69a3c4113640662f38ab257ec0df64619d140`；扩展五文件 HTTP 哈希与候选逐项一致；角色内嵌、已关联世界书和其 originalData 三处 ID 21 正文均与源码 SHA-256 `a867bf239d8961c58520746de61ac80027c706d51d37b5ff7555e16cca541119` 一致。安装器逐次确认选中聊天、非目标角色数据、设置不变。
- 本地可逆备份：`tmp/tavern-extension-backups/2026-09-23T03-45-58.404Z-40e8c389-8bf5-483d-9ebc-51130002749c/`、`tmp/tavern-runtime-backups/7b72824c-33c6-4812-8bc1-82c183c2c315/`、`tmp/tavern-worldbook-backups/440de06c-1a53-4009-9d30-ca91ba056159/`。证据 `tmp/build-binding-archetype-sync-20260923-r1.json`、`tmp/archetype-sync-install-verified-20260923-r1.json`。备份、候选和玩家数据不提交 Git。

未刷新用户酒馆页面、未调用真实模型或推进当前聊天／存档；需用户自行完整刷新页面后在测试角色上验收新流派选择与生成行为。不能把离线／隔离浏览器回归当作真实模型实玩验收。
