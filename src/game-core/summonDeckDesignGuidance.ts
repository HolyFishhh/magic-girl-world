/** Authoring methods, never a quality gate or an automatic rewrite of legal cards. */
export function summonDeckDesignGuidance(): string {
  return [
    '[召唤构筑方法：选择有因果联系的模块，不要求全部塞进同一套牌]',
    '召唤不是只有放单位与增加攻击。先明确单位承担输出、防护、资源生产、回合成长或牺牲兑现中的哪些职责，再设计建立核心、维持核心和兑现核心的不同卡牌。单核心可围绕同槽强化、治疗、生命上限成长、被动和指令展开；多单位可围绕轮换、保护、死亡触发、复制和退场回收展开。单位名和故事外观不能代替可执行配合。',
    '召唤物的 actions 表达主动出招；abilities 使用真实 trigger 与 effects 表达被动，例如回合触发恢复生命。卡牌可用 apply_summon_status 赋予带触发器的状态，形成每回合恢复或成长；用 modify_summon、modify_summon_effect 改变单位属性和行动。生命转伤害的公式必须在召唤物行动中读取 self.hp 或 self.max_hp，不能误读召唤者生命；作用于召唤者时使用 summoner_effects。',
    '限定某种召唤物在场才能打出的牌，在卡牌根部写 requires_summon:"模板ID"，精确匹配我方存活召唤模板，不能仅在效果的 when 中写存在检查后仍收取费用。需要一张指令牌让指定单位发动新招时，使用 activate_summon 的 action，并明确 selector；新招不必来自原 actions，伤害和触发来源属于召唤物。临时指令不会替换预告中的常规行动。按公开字段协议表达，不发明字段。',
    '检查每条配合的对象身份、触发时点、次数和来源：启动牌是否真的能产生收益牌指定的模板/槽位/状态，核心尚未到场或已死亡时有哪些可用行动，随机目标是同一次选取还是分别抽取，持续成长是否来得及兑现。奖励优先补齐现有链条的缺口，也可以连接新的模块；不要因为玩家选了召唤就把所有牌做成重复召唤或纯加数值。',
  ].join('\n');
}
