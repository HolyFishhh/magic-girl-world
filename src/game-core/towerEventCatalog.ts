/** Maintained event-design menu. Entries describe capabilities, never add protocol fields. */
export type TowerEventCapability =
  | 'scalar_outcome'
  | 'registered_resources'
  | 'gain_cards'
  | 'reward'
  | 'card_removal_credit'
  | 'deck_remove'
  | 'persistent_growth'
  | 'deck_transform'
  | 'deck_duplicate'
  | 'random_deck_target'
  | 'repeat_stages'
  | 'seeded_random'
  | 'battle_challenge'
  | 'delayed_task'
  | 'memory_minigame'
  | 'cross_run_memory'
  | 'modular_creation';
export interface TowerEventMechanic {
  id: string;
  category: string;
  forms: string[];
  required: TowerEventCapability[];
  sources: string[];
  status: 'available' | 'planned';
}
export const AVAILABLE_TOWER_EVENT_CAPABILITIES: readonly TowerEventCapability[] = [
  'scalar_outcome',
  'registered_resources',
  'gain_cards',
  'reward',
  'card_removal_credit',
  'deck_remove',
  'deck_transform',
  'deck_duplicate',
  'random_deck_target',
  'repeat_stages',
];
export const TOWER_EVENT_MECHANICS: readonly TowerEventMechanic[] = [
  {
    id: 'deck-surgery',
    category: '牌组手术',
    forms: ['选择一张后删除', '删除后换完整奖励', '生命代价换指定删除'],
    required: ['deck_remove', 'reward'],
    sources: ['Living Wall', 'Zen Weaver'],
    status: 'available',
  },
  {
    id: 'resource-exchange',
    category: '多资源交换',
    forms: ['金币或生命二择', '注册资源支付换奖励', '诅咒牌与收益绑定'],
    required: ['scalar_outcome', 'registered_resources', 'gain_cards', 'reward'],
    sources: ['We Meet Again!', 'Ranwid the Elder', 'This or That?'],
    status: 'available',
  },
  {
    id: 'risk-choice',
    category: '风险权衡',
    forms: ['当前生命换金币', '生命上限换奖励', '当前欲望换立即收益'],
    required: ['scalar_outcome', 'reward'],
    sources: ['Big Fish', 'Jungle Maze Adventure', 'Winding Halls'],
    status: 'available',
  },
  {
    id: 'revealed-card-choice',
    category: '公开选牌',
    forms: ['三张完整牌选一', '强制代价牌随分支获得', '奖励槽限制选择'],
    required: ['gain_cards', 'reward'],
    sources: ['The Library'],
    status: 'available',
  },
  {
    id: 'vitality-growth',
    category: '休整与体质成长',
    forms: ['即时恢复或提高生命上限', '降低生命上限换取强力奖励', '当前生命与长期体质之间取舍'],
    required: ['scalar_outcome', 'reward'],
    sources: ['Big Fish', 'Shining Light'],
    status: 'available',
  },
  {
    id: 'repeat-stages',
    category: '重复递进',
    forms: ['继续或退出', '递增成本和预生成奖励', '固定阶段上限'],
    required: ['repeat_stages', 'scalar_outcome'],
    sources: ['Scrap Ooze', 'Knowing Skull', 'Tablet of Truth'],
    status: 'available',
  },
  {
    id: 'seeded-random',
    category: '风险随机',
    forms: ['固定 seed 的正负结果', '重掷支付', '预生成随机候选'],
    required: ['seeded_random', 'scalar_outcome'],
    sources: ['Wheel of Change', 'The Joust', 'Slippery Bridge'],
    status: 'planned',
  },
  {
    id: 'random-card-bargain',
    category: '随机索牌与交换',
    forms: ['进入阶段时随机指定持久牌实例', '交出这张牌换金币或物品', '拒绝交易保留原牌', '按牌类筛选随机目标'],
    required: ['random_deck_target', 'deck_remove', 'reward'],
    sources: ['We Meet Again!', 'Ranwid the Elder'],
    status: 'available',
  },
  {
    id: 'deck-mutation',
    category: '卡牌改造',
    forms: ['选择指定数量的牌换为预生成完整新牌', '按牌名或牌类筛选替换', '改善流派缺口或用负面牌换高收益'],
    required: ['deck_transform'],
    sources: ['Vampires', 'Self-Help Book', 'Amalgamator'],
    status: 'available',
  },
  {
    id: 'deck-copy',
    category: '复制关键牌',
    forms: ['选择非唯一卡制作副本', '金币、生命或注册资源换核心牌密度'],
    required: ['deck_duplicate', 'scalar_outcome'],
    sources: ['Duplicator'],
    status: 'available',
  },
  {
    id: 'desire-exchange',
    category: '欲望与抗性交易',
    forms: ['清除当前欲望或提高欲望上限', '降低欲望上限换即时收益', '欲望压力与生命、金币、注册资源组合交换'],
    required: ['scalar_outcome', 'registered_resources'],
    sources: ['Big Fish'],
    status: 'available',
  },
  {
    id: 'battle-challenge',
    category: '战斗挑战',
    forms: ['付费或战斗', '限回合目标', '战后多档奖励'],
    required: ['battle_challenge', 'reward'],
    sources: ['The Colosseum', 'Battleworn Dummy', 'Masked Bandits'],
    status: 'planned',
  },
  {
    id: 'delayed-task',
    category: '延迟任务',
    forms: ['未来节点兑现', '路线跳跃', '任务牌回执'],
    required: ['delayed_task'],
    sources: ['Secret Portal', 'The Legends Were True', 'The Lantern Key'],
    status: 'planned',
  },
  {
    id: 'permanent-growth',
    category: '专属机制成长',
    forms: ['欲望上限抗性成长', '同模板召唤成长'],
    required: ['persistent_growth'],
    sources: ['Abyssal Baths', 'Byrdonis Nest', 'Stone of All Time'],
    status: 'planned',
  },
  {
    id: 'memory-minigame',
    category: '记忆小游戏',
    forms: ['配对', '信息逐步揭示', '选择前不揭示结果'],
    required: ['memory_minigame', 'gain_cards'],
    sources: ['Match and Keep', 'Cursed Tome', 'The Trial'],
    status: 'planned',
  },
  {
    id: 'cross-run-memory',
    category: '跨局记忆',
    forms: ['存入下局取回', '跨 run 交换'],
    required: ['cross_run_memory'],
    sources: ['A Note For Yourself'],
    status: 'planned',
  },
  {
    id: 'modular-creation',
    category: '模块化创造',
    forms: ['类型与 rider 组合', '现有状态/资源/召唤关联', '预生成完整候选'],
    required: ['modular_creation', 'gain_cards'],
    sources: ['Tinker Time', 'Augmenter'],
    status: 'planned',
  },
];
export function availableTowerEventMechanics(
  available: readonly TowerEventCapability[] = AVAILABLE_TOWER_EVENT_CAPABILITIES,
): TowerEventMechanic[] {
  const set = new Set(available);
  return TOWER_EVENT_MECHANICS.filter(
    entry => entry.status === 'available' && entry.required.every(capability => set.has(capability)),
  );
}
export function towerEventGenerationGuidance(): string {
  const available = availableTowerEventMechanics();
  return [
    '[问号事件：当前可执行目录]',
    ...available.map(entry => `${entry.category}：${entry.forms.join('；')}。`),
    'card_removals 增加待处理删牌次数，获得后程序立即打开永久删牌选择，确认才扣次数；取消或中断保留次数，不表示未选牌就已经删牌。带指定范围、随机或代价的删牌用 deck_actions 的 remove，换牌用 transform 加完整 replacement，复制用 duplicate（不能复制唯一卡）。支持 choose/random 与指定数量，按持久实例结算。',
    'outcome 使用 hp/max_hp/lust/max_lust/gold/card_removals/resources/gain_cards/reward，以及独立先验 cost、deck_actions、grant。resources 仅引用已注册资源。cost 在收益前检查；不能用本次尚未获得的金币支付本次费用。grant 只含完整 cards/items 和 limits，支持 X 选 Y；强制代价牌放 gain_cards，不能伪装成可跳过的奖励。',
    '递进交易用 mwg.tower-event/v2 的 start_stage/stages/next_stage 有限无环阶段图；逐档价格和具体奖励在生成时全部写完，点击阶段不再请求 AI。每档提供离开选项；不要把“能继续花钱”写成没有结算的文案或无限循环。随机索牌只随机当前阶段的实际牌组目标，重开不重掷；不支持未声明的通用概率结果字段。',
    'max_lust 是欲望上限/抗性，lust 才是当前累积。组合事件可围绕流派缺口、注册资源、带召唤/状态/欲望机制的完整替换牌或遗物设计；这不等于允许任意修改召唤模板或新增事件脚本。未来任务、跨局存取、事件中途战斗再返回、记忆配对小游戏和通用附魔 patch 尚无完整协议，不能只靠故事声称已生效。',
  ].join('\n');
}
