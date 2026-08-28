# 战斗 UI 与战后交接验收：0.5.134

## 验收目标

- 战斗页在真实 SillyTavern 消息 iframe 中完整显示，不需要横向滚动。
- 大生命条、大欲望条、emoji 状态托盘、遗物、能力和欲望效果均可查看。
- 桌面拖牌只拖动一张牌，具有跟随、光泽、有效投放区、取消返回和成功飞出动画；点击出牌仍可用。
- 胜利、失败、终止弹窗使用星空暗色主题和对应强调色。
- 战后行动输入可留空；填写后与按回合摘要、完整构筑机制、最终敌我状态一起发送。

## 自动验证

- `npm run typecheck`
- `npm run test:battle-terminal`
- `npm run test:event-flow`
- `npm run test:battle-snapshot-report`
- `npm run test:battle-session-store`
- `npm run test:battle-contract`
- `npm run test:mvu-battle-adapter`
- `node scripts/test-battle-log-report.mjs`
- `node scripts/test-battle-animation-target.mjs`
- `node scripts/test-restored-ability-metadata.mjs`
- `npm run build`

## 真实酒馆检查表

- [ ] 通过官方接口导入 `魔法少女世界 0.5.134.png`，读回世界书、正则和角色脚本。
- [ ] 明确导入并链接内嵌世界书 `魔法少女世界0.5.134`；缺少该文件时 MVU 会停在初始化等待，不能把它误判成战斗 UI 失败。
- [ ] 约 519px 宽消息 iframe 与宽屏视口无内容裁切。
- [ ] 拖牌不会带出整副手牌，取消与成功投放动画正确。
- [ ] 胜利弹窗为绿色强调，失败为红色强调，终止为灰蓝强调。
- [ ] 输入战后行动后，实际发送文本包含每个回合、全部构筑机制、最终敌我状态和玩家输入。
- [ ] 重新打开战斗楼层仍能恢复完整回合摘要与能力来源。

真实验收完成后在本文件追加聊天名、角色读回结果、截图要点、PNG 大小与 SHA-256。
