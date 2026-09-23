# 剧情支付格式、通用预设与弃牌机制（2026-09-23）

## 问题与处理

- 用户截图和变量更新中的 `guardian_barrier`、`piercing_starlight`、`desperate_blessing` 把替代支付的生命代价写成 `alternatives[i].additional.hp`，正式协议只接受方案同层的 `hp`；分别保留 6、4、8 点生命代价，生成指引补合法示例，校验错误明确指出错误路径及正确层级。**没有**放宽 Schema、自动改写非法卡或修改现有玩家存档。
- 灵巧 `sly:true` 是弃置后免费打出原卡完整 `effects`；`discard_effects` 是独立弃牌触发。同卡组合时先弃牌效果、再灵巧打出，二者保留；世界书、公开协议与 Schema 描述提醒仅在确需两个独立效果时组合，避免收益重复书写。真实战斗回归证明两处分别执行一次。
- 七份世界书及两条后台创作协议同步：玩家卡组在没有明确要求时避免套通用预设，按剧情构思；玩家明确要求通用状态或通用力量 buff 时可直接引用 `sts_strength` 等预设。复杂/剧情敌人仍应贴合设定。只是创作指引，不拒绝合法内容。15 项白名单与展开/保存语义不变。

## 验证与本地测试安装

- 两套 TypeScript typecheck；卡牌支付契约、能力触发、内置状态集成、世界书契约、MVU 额外模型修复和剧情长流程测试均通过。
- `node scripts/build-local-candidate.mjs story-payment-preset-sly-20260923-r1`：隔离扩展与角色运行时构建、打包和产物检查通过；1035 份源文件、18 份产物的构建哈希复核通过，原 dist/已安装扩展的 1031 份受保护文件在构建期间不变。扩展 `index.js` SHA-256 `7e33ae1158931b7b3a74e46f1f789e98dfdb2728345f7130fb24fc584cb29c51`，角色运行时 `b066869d9b6b7f63f7b13e4a3689cc187630f089d868cf3e5bafd2227fd59081`；绑定证据在 `tmp/build-binding-story-payment-preset-sly-20260923-r1.json`。
- 本地测试酒馆 `127.0.0.1:8012`：安装前先核验七条世界书的三份副本仅有正文变化，备份精确目标卡 PNG/世界书 JSON 且哈希一致；分别由扩展、角色运行时、世界书受限安装器更新。回读核验七条世界书 ID `0,1,2,6,9,10,17`、扩展五文件的磁盘和 HTTP 哈希、卡内运行时哈希及角色其他字段。其他 358 份角色/聊天/世界书/设置受保护文件、选中聊天和全局设置均未变。安装前备份目录 `tmp/tavern-preinstall-target-7d97fb19-7a76-4cf1-ad95-02f82891515e`；另外三处安装器备份目录记录在 `tmp/install-extension-story-payment-preset-sly-20260923.json`、`tmp/install-runtime-story-payment-preset-sly-20260923.json`、`tmp/install-worldbook-story-payment-preset-sly-20260923.json`。
- 测试目标显示名 **魔法少女世界 1.0.3**，精确头像文件 **魔法少女世界 1.0.3.png**。未自动刷新页面、触发生成、改写或推进聊天/存档；用户需自行刷新页面后重试。没有真实模型生成、浏览器视觉或玩家实玩验收，Prompt 指令不能保证模型永远不犯相同错误；之前已经失败的原消息不会被自动修复。
