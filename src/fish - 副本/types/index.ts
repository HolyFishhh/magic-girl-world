// 核心数据结构定义
export interface Card {
  id: string;
  name: string;
  cost: number | 'energy' | undefined; // 诅咒牌无消耗
  type: 'Attack' | 'Skill' | 'Power' | 'Event' | 'Corrupt' | 'Curse';
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
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

export interface Ability {
  id: string;
  trigger: 'passive' | 'battle_start' | 'turn_start' | 'turn_end' | 'card_played' | 'take_damage';
  effect: string;
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
  abilities?: Ability[]; // 战斗能力（战斗结束后清除）
  modifiers?: { [key: string]: number }; // 修饰符存储
  hand: Card[];
  drawPile: Card[];
  discardPile: Card[];
  exhaustPile: Card[];
  drawPerTurn: number;
  gender: 'Male' | 'Female'; // 已废弃：fish模块不再使用
  corruption: number; // 已废弃：fish模块不再使用
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
  energy: number;
  maxEnergy: number;
  block: number;
  statusEffects: StatusEffect[];
  intent: EnemyIntent;
  climaxPenalty: string;
  emoji: string;
  actions: EnemyAction[];
  nextAction: EnemyAction | null;
  onPlayerClimaxEffect?: string;
  lustEffect?: {
    name: string;
    description: string;
    effect: string;
  };
  abilities?: Ability[]; // 战斗能力（战斗结束后清除）
  dialogue: string;
  isBoss: boolean;
  modifiers?: { [key: string]: number }; // 修饰符存储
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
