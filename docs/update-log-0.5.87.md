# 0.5.87 更新记录

## 本版修复

- 角色卡交付物统一为仓库根目录 `魔法少女世界.png`。发布和导入脚本不再默认使用第二张 `dist/tavern` 卡，避免用户导入旧元数据。
- 开始页 bootstrap 编译为 ES5 兼容语法，并拒绝反引号、可选链、原始 `<` 和 `</script>`，降低 SillyTavern/Tavern Helper 二次解析导致的 `Unexpected token '<'` 风险。
- 开始页先选择 `剧情模式` 或 `远征模式`。模式写入 `stat_data.game_mode`；远征起始内容通过门禁后由程序自动创建 `run`，剧情模式不显示远征入口。
- common 状态栏由 Tavern Helper 的 `minDepth=0,maxDepth=2` 渲染最近三层；最新层可操作，前两层只读，超过三层才卸载。战斗页仍只显示最新层。
- 移除状态栏暗色切换和暗色变量，common/start 使用不透明的浅色少女日记纸张风格。
- 职业状态变更会拆分为职业名和职业能力，不再直接把完整职业对象 JSON 打进状态栏。

## MVU 额外模型

- 固定使用 MagVarUpdate commit `0a730cd4a9b99689d1135a49b542c780b977c24c`。
- 嵌入关闭的 `[config_override]` 条目，启用 `额外模型解析` 和自动请求。MVU 的用户配置默认 `模型来源=与插头相同`，即使用酒馆当前主模型发起第二轮变量解析；用户可以在 MVU 设置中选择自己的额外模型方案。
- 角色卡不保存 API Key。独立模型的地址、密钥和模型名只存在酒馆/MVU 的用户配置。
- 世界书条目按 `[mvu_plot]` / `[mvu_update]` 分类，剧情轮次与变量轮次不再强迫同一模型同时生成长正文和完整变量命令。

## 兼容边界

- 目标环境：SillyTavern 1.18+、Tavern Helper 4.9+、MagVarUpdate 上述固定 commit。
- 本版不改 fish 战斗页面布局；远征的地图、营火、商店和 Boss 规则仍由现有可选模块负责。
