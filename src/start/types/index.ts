// 核心数据结构定义
export interface Card {
  id: string;
  name: string;
  cost: number;
  type: 'Attack' | 'Skill' | 'Power' | 'Event';
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Corrupt';
  emoji: string;
  effect: string;
  description: string;
  discard_effect?: string; // 卡牌被弃掉时触发的效果
  retain?: boolean;
  exhaust?: boolean;
  ethereal?: boolean; // 回合结束时消失
}

export interface StatusEffect {
  id: string;
  name: string;
  type: 'buff' | 'debuff' | 'neutral' | 'ens'; // ENS = 色情负面状态
  stacks: number;
  duration?: number; // undefined = 永久
  isPermanent: boolean;
  description: string;
  emoji: string;
  onApply?: string; // 效果触发脚本
  onTick?: string; // 每回合触发脚本
  onRemove?: string; // 移除时触发脚本
}

export interface Relic {
  id: string;
  name: string;
  description: string;
  effect: string;
  emoji: string;
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Boss' | 'ENS';
  trigger: string; // 触发条件脚本
}

export interface Player {
  maxHp: number;
  currentHp: number;
  maxLust: number;
  currentLust: number;
  energy: number;
  maxEnergy: number;
  block: number;
  statusEffects: StatusEffect[];
  relics: Relic[];
  deck: Card[];
  hand: Card[];
  drawPile: Card[];
  discardPile: Card[];
  exhaustPile: Card[];
  drawPerTurn: number;
  gender: 'Male' | 'Female';
  corruption: number;
}

export interface EnemyIntent {
  type: 'attack' | 'defend' | 'buff' | 'debuff' | 'special';
  value?: number;
  description: string;
  emoji: string;
}

export interface Enemy {
  id: string;
  name: string;
  maxHp: number;
  currentHp: number;
  maxLust: number;
  currentLust: number;
  block: number;
  statusEffects: StatusEffect[];
  intent: EnemyIntent;
  climaxPenalty: string;
  emoji: string;
  actions: EnemyAction[];
  nextAction: EnemyAction | null;
  onPlayerClimaxEffect?: string;
}

export interface EnemyAction {
  name: string;
  effect: string;
  description: string;
  weight: number; // 选择权重
}

export interface GameState {
  player: Player;
  enemy: Enemy | null;
  currentTurn: number;
  turnNumber?: number;
  phase: BattlePhase;
  isGameOver: boolean;
  winner: 'player' | 'enemy' | null;
  battleResult?: 'victory' | 'defeat' | 'ongoing';
  battleLog?: {
    cardsUsed: string[];
    actionsPerformed: string[];
  };
  sessionChoices?: string[];
  sessionDuration?: number;
  character: CharacterConfig | null;
  currentScene: string;
  initialized: boolean;
}

export type BattlePhase = 'setup' | 'player_turn' | 'enemy_turn' | 'game_over';

// ENS相关接口
export interface ENSDefinition {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: 'physical' | 'mental' | 'social' | 'magical';
  intensity: number; // 1-5级强度
  conversionRules: ConversionRule[];
  narrativePrompts: string[];
}

export interface ConversionRule {
  condition: string; // 触发条件
  targetStatus: string; // 目标状态ID
  probability: number; // 转换概率
}

// 协同效应接口
export interface SynergyRule {
  id: string;
  name: string;
  description: string;
  requirements: {
    relics?: string[];
    statusEffects?: string[];
    statusTypes?: string[];
    ensCount?: number;
    condition?: () => boolean;
  };
  effects: {
    statusModifier?: {
      type: string;
      targetStatus?: string;
      intensityBonus?: number;
      valueBonus?: number;
      description: string;
    };
    emergentEffect?: EmergentEffect;
    onTurnStart?: () => void;
    onCardPlay?: (cardId: string) => void;
    onConditionMet?: () => void;
  };
  priority: number;
}

export interface SynergyCondition {
  type: 'relic' | 'status' | 'card_type' | 'stat';
  target: string;
  value?: number;
  comparison?: 'equal' | 'greater' | 'less' | 'greater_equal' | 'less_equal';
}

export interface SynergyResult {
  ruleId: string;
  name: string;
  description: string;
  priority: number;
  effects: SynergyRule['effects'];
  isActive: boolean;
  intensity: number;
}

export interface EmergentEffect {
  name: string;
  description: string;
  modifier?: {
    permanentConversionRate?: number;
    damageMultiplier?: number;
    energyBonus?: number;
    [key: string]: number | undefined;
  };
}

// 平衡调整接口
export interface BalanceMetrics {
  winRate: number;
  averageBattleLength: number;
  cardUsageStats: Map<string, { uses: number; winRate: number }>;
  relicEffectiveness: Map<string, { games: number; winRate: number; avgSessionLength: number }>;
  ensAccumulationRate: number;
  playerPowerProgression: number[];
  difficultySpikes: number[];
  engagementMetrics: {
    sessionLength: number;
    retryRate: number;
    choiceVariation: number;
  };
}

export interface BalanceAdjustment {
  type: 'global' | 'cards' | 'relics' | 'enemies' | 'ens';
  target: string;
  adjustment: 'increase' | 'decrease' | 'buff' | 'nerf';
  magnitude: number;
  reason: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

// 动态内容生成约束
export interface CardConstraints {
  type: Card['type'];
  rarity?: Card['rarity'];
  theme?: string;
  powerLevel?: 'weak' | 'standard' | 'strong';
}

export interface RelicContext {
  category: 'combat' | 'ens' | 'utility';
  preferredRarity?: Relic['rarity'];
  theme?: string;
  designGoal?: string;
  playerStyle?: 'aggressive' | 'defensive' | 'balanced';
}

export interface PlayerState {
  currentHp: number;
  maxHp: number;
  statusEffects?: StatusEffect[];
  relics?: Relic[];
  progress?: string;
}

// 游戏事件接口
export interface EventChoice {
  text: string;
  outcome: string;
  effect: string;
  consequences: string;
}

export interface GameEvent {
  id: string;
  title: string;
  description: string;
  emoji: string;
  choices: EventChoice[];
  rarity: string;
  category: string;
}

// 玩家档案接口
export interface PlayerProfile {
  playerId: string;
  preferences: {
    ensContentLevel: number; // 0-5
    difficultyPreference: 'easy' | 'normal' | 'hard' | 'extreme';
    contentTags: string[];
  };
  statistics: {
    gamesPlayed: number;
    winRate: number;
    favoriteCards: string[];
    averageCorruption: number;
  };
  progression: {
    unlockedCards: string[];
    unlockedRelics: string[];
    achievements: string[];
  };
}

// 难度调整接口
export interface DifficultyMetrics {
  recentWinRate: number;
  averageHpRemaining: number;
  turnsToWin: number;
  resourceEfficiency: number;
}

export interface DifficultyAdjustment {
  enemyHpModifier: number;
  enemyDamageModifier: number;
  rewardQualityModifier: number;
  ensIntensityModifier: number;
}

export interface GameplayData {
  timestamp: number;
  battleResult: 'victory' | 'defeat' | 'ongoing';
  battleLength: number;
  playerHealth: number;
  ensStates: number;
  cardsUsed: string[];
  relicsActive: string[];
  playerChoices: string[];
  sessionDuration: number;
}

// 扩展现有接口

// 白木市魔法少女角色创建系统类型定义

// 城市地点定义
export interface Location {
  id: string;
  name: string;
  description: string;
  category: 'school' | 'public' | 'commercial' | 'residential' | 'religious' | 'entertainment';
  status?: 'available' | 'developing';
}

export interface City {
  id: string;
  name: string;
  description: string;
  emoji: string;
  status: 'available' | 'developing';
}

// 阵营定义
export type Faction = 'magical_girl' | 'evil_forces' | 'ordinary_people';

// 职业子类型
// 超自然身份类型定义
export interface SupernaturalIdentity {
  id: string;
  name: string;
  description: string;
  detailedDescription: string;
  icon: string;
  faction: Faction;
}

// 普通身份类型定义
export interface OrdinaryIdentity {
  id: string;
  name: string;
  description: string;
  icon: string;
}

// 角色创建配置
export interface CharacterConfig {
  faction: Faction;
  supernaturalIdentity: SupernaturalIdentity | null;
  ordinaryIdentity: OrdinaryIdentity;
  city: City;
  location: Location;
  customDescription?: string;
  name?: string;
}

// 白木市地点数据
export const SHIROKI_LOCATIONS: Location[] = [
  {
    id: 'shiroki_high',
    name: '白木高中',
    description: '{{user}}就读的学校，是城市高中教育的中心',
    category: 'school',
  },
  {
    id: 'shiroki_middle',
    name: '白木初中',
    description: '城市主要的初中之一，培养青少年学生',
    category: 'school',
  },
  {
    id: 'shiroki_elementary',
    name: '白木小学',
    description: '城市重点小学，为儿童提供优质教育',
    category: 'school',
  },
  {
    id: 'user_home',
    name: '{{user}}的家',
    description: '{{user}}的生活起居场所',
    category: 'residential',
  },
  {
    id: 'city_hall',
    name: '白木市政大楼',
    description: '市政府所在地，处理城市行政事务',
    category: 'public',
  },
  {
    id: 'forever_convenience',
    name: '永夜便利店',
    description: '24小时营业的超市，满足居民日常需求',
    category: 'commercial',
  },
  {
    id: 'shirakawa_mansion',
    name: '白川豪宅',
    description: '城市中一座神秘的大宅院',
    category: 'residential',
  },
  {
    id: 'shiroki_shopping_street',
    name: '白木商业街',
    description: '繁华的购物区，汇集各类商铺',
    category: 'commercial',
  },
  {
    id: 'shiroki_mall',
    name: '白木购物中心',
    description: '豪华商场，聚集高端品牌',
    category: 'commercial',
  },
  {
    id: 'night_market',
    name: '夜市小吃街',
    description: '汇集各种地方特色小吃的美食天堂',
    category: 'commercial',
  },
  {
    id: 'shiroki_shrine',
    name: '白木神社',
    description: '城市中历史悠久的神社，市民祈福之地',
    category: 'religious',
  },
  {
    id: 'central_park',
    name: '白木中央公园',
    description: '城市中心的大型公园，市民休闲娱乐场所',
    category: 'public',
  },
  {
    id: 'shiroki_hotspring',
    name: '白木温泉',
    description: '城市著名的温泉度假区',
    category: 'entertainment',
  },
  {
    id: 'shiroki_cinema',
    name: '白木影院',
    description: '大型电影院，放映各类影片',
    category: 'entertainment',
  },
];

// 超自然身份数据
export const SUPERNATURAL_IDENTITIES: SupernaturalIdentity[] = [
  // 魔法少女阵营
  {
    id: 'magical_guardian',
    name: '魔法守护者',
    description: '觉醒了魔法力量的守护者，守护正义与和平',
    detailedDescription:
      '天生的魔法使用者，通过与神明、精灵或概念意志签订契约获得力量。觉醒后会获得强大的魔法能力，能够变身并使用各种魔法技能来保护世界。',
    icon: '🌟',
    faction: 'magical_girl',
  },
  {
    id: 'guardian_spirit',
    name: '守护精灵',
    description: '辅助魔法守护者的神秘存在，提供指导和力量',
    detailedDescription:
      '通常为非人类的神秘存在，作为魔法守护者的引导者与力量之源。它们往往以可爱的小动物、玩偶或无机物的形态出现，负责寻找有资质的人类并引导他们签订契约。其本体可能极为强大，但受限于规则，只能以这种无害的形态示人。',
    icon: '✨',
    faction: 'magical_girl',
  },

  // 邪恶敌对势力
  {
    id: 'dark_witch',
    name: '黑暗魔女',
    description: '堕入黑暗的前魔法使用者，力量强大但内心扭曲',
    detailedDescription:
      '通常是因绝望、背叛或强烈欲望而堕落的前魔法守护者。她们的力量源于负面情感，虽然强大，但极不稳定。她们精通诅咒与黑魔法，将曾经守护的一切视为嘲讽，以散播痛苦为乐。',
    icon: '🔮',
    faction: 'evil_forces',
  },
  {
    id: 'shadow_apostle',
    name: '阴影使徒',
    description: '侍奉黑暗势力的神秘存在，散布恐惧和绝望',
    detailedDescription:
      '黑暗主宰的忠实仆从，形态各异，可能是被改造的人类，也可能是来自异界的阴影生物。他们没有自我，只为执行主人的命令而存在，是黑暗势力最主要的行动人员，负责在城市中制造混乱与恐慌。',
    icon: '👤',
    faction: 'evil_forces',
  },
  {
    id: 'fallen_guardian',
    name: '堕落守护者',
    description: '被黑暗侵蚀的前魔法守护者，在光明与黑暗间挣扎',
    detailedDescription:
      '与黑暗魔女不同，堕落守护者并非自愿堕落。他们可能是在战斗中被强行污染，或是为了守护某物而不得不借助禁忌力量。内心仍在光明与黑暗间痛苦挣扎，时而清醒，时而疯狂，是极不稳定的危险存在。',
    icon: '💔',
    faction: 'evil_forces',
  },
  {
    id: 'demon_lord',
    name: '魔王',
    description: '黑暗势力的统治者，拥有毁灭性的力量',
    detailedDescription:
      '黑暗势力的顶点，是所有邪恶存在的源头或最高统帅。他们的目标是颠覆世界秩序，将一切拖入混沌。每一位魔王都拥有足以与一个国家抗衡的恐怖力量，其存在本身就是对世界法则的挑战。',
    icon: '👹',
    faction: 'evil_forces',
  },

  // 普通人中的觉醒者
  {
    id: 'potential_awakener',
    name: '潜在觉醒者',
    description: '普通人中隐藏着超自然潜能的存在，尚未觉醒',
    detailedDescription:
      '生活在城市中的普通人，但血脉或灵魂中隐藏着尚未被发现的超自然潜能。他们可能会在某个契机下觉醒，成为魔法守护者，也可能被黑暗诱惑而堕落。目前，他们只是比常人稍微幸运或不幸一点的普通市民。',
    icon: '🌱',
    faction: 'ordinary_people',
  },
];

// 普通身份数据
export const ORDINARY_IDENTITIES: OrdinaryIdentity[] = [
  { id: 'student', name: '学生', description: '在校学习的学生，专注于学业和成长', icon: '📚' },
  { id: 'office_worker', name: '上班族', description: '忙碌的都市工作者，生活在规律的日常中', icon: '💼' },
  { id: 'shop_owner', name: '店主', description: '经营着小店的普通人，见证着城市的变化', icon: '🏪' },
  { id: 'teacher', name: '教师', description: '教书育人的老师，关心学生的成长', icon: '👨‍🏫' },
  { id: 'freelancer', name: '自由职业者', description: '独立工作的创作者，有着灵活的生活方式', icon: '💻' },
  { id: 'artist', name: '艺术家', description: '追求艺术创作的人，敏感而富有想象力', icon: '🎨' },
  { id: 'doctor', name: '医生', description: '救死扶伤的医疗工作者，守护他人健康', icon: '⚕️' },
  { id: 'police_officer', name: '警察', description: '维护治安的执法者，保护市民安全', icon: '👮' },
];

// 城市列表
export const CITIES: City[] = [
  {
    id: 'shiroki',
    name: '白木市',
    description: '存在怪谈和怪人组织，但在魔法少女的保护下，是相对安全的多元化都市。',
    emoji: '🏙️',
    status: 'available',
  },
  {
    id: 'kogyoku',
    name: '红玉市',
    description: '邪恶组织活动猖獗，其力量已严重影响到市民的日常生活。',
    emoji: '🌇',
    status: 'developing',
  },
  {
    id: 'kokuchou',
    name: '黑潮市',
    description: '极度混乱无序的法外之地，也是一个与外界几乎隔绝的神秘城市。',
    emoji: '🌃',
    status: 'developing',
  },
];

// 阵营信息
export const FACTION_INFO = {
  magical_girl: {
    name: '魔法少女阵营',
    description: '守护正义与和平的魔法使用者',
    color: '#ff69b4',
    icon: '🌟',
  },
  evil_forces: {
    name: '邪恶敌对势力',
    description: '企图破坏世界秩序的黑暗力量',
    color: '#8b0000',
    icon: '👿',
  },
  ordinary_people: {
    name: '普通人',
    description: '生活在现代社会中的普通民众',
    color: '#4682b4',
    icon: '👥',
  },
};
