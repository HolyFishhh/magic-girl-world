/**
 * 效果系统的集中定义 - 所有效果、属性、触发器的元数据配置
 *
 * 添加新效果只需要在这里配置，无需修改多个文件
 */

/**
 * 属性类别
 */
export type AttributeCategory = 'basic' | 'status' | 'ability' | 'card' | 'special' | 'modifier';

/**
 * 属性定义接口
 */
export interface AttributeDefinition {
  id: string;
  displayName: string;
  category: AttributeCategory;
  dataType: 'number' | 'string' | 'boolean' | 'object';
  defaultValue?: any;
  minValue?: number;
  maxValue?: number;
  priority: number; // 执行优先级
  playerOnly?: boolean; // 是否仅玩家可用
  // UI 显示配置（可选）
  ui?: {
    positiveIcon?: string; // 正向变化图标
    negativeIcon?: string; // 负向变化图标
    positiveColor?: string; // 正向变化颜色
    negativeColor?: string; // 负向变化颜色
  };
}

/**
 * 触发器定义接口
 */
export interface TriggerDefinition {
  id: string;
  name: string; // 显示名称
  icon: string; // 图标
  color: string; // 颜色（十六进制）
}

/**
 * 触发器类型
 */
export type TriggerType =
  | 'battle_start'
  | 'ability_gain'
  | 'turn_start'
  | 'turn_end'
  | 'card_played'
  | 'on_discard'
  | 'passive'
  | 'take_damage'
  | 'take_heal'
  | 'deal_damage'
  | 'deal_heal'
  | 'lust_increase'
  | 'lust_decrease'
  | 'deal_lust_increase'
  | 'deal_lust_decrease'
  | 'gain_buff'
  | 'gain_debuff'
  | 'lose_buff'
  | 'lose_debuff'
  | 'enemy_gain_buff'
  | 'enemy_gain_debuff'
  | 'enemy_lose_buff'
  | 'enemy_lose_debuff'
  | 'gain_block'
  | 'lose_block'
  // 状态专用触发器（仅用于状态定义的 triggers 字段）
  | 'apply' // 状态施加时
  | 'tick' // 状态每回合（等同于 turn_start）
  | 'remove' // 状态移除时
  | 'hold' // 状态持有时（修饰符）
  | 'stack'; // 状态叠加时

/**
 * 操作符类型
 */
export type OperatorType = '+' | '-' | '*' | '/' | '=' | 'apply' | 'remove';

/**
 * 所有支持的属性定义（优先级：数字越小越先执行）
 */
export const ATTRIBUTE_DEFINITIONS: Record<string, AttributeDefinition> = {
  // ===== 基础属性 (优先级 10-19) =====
  max_hp: {
    id: 'max_hp',
    displayName: '最大生命值',
    category: 'basic',
    dataType: 'number',
    minValue: 1,
    priority: 10,
    ui: {
      positiveIcon: '💪',
      negativeIcon: '💔',
      positiveColor: '#44ff44',
      negativeColor: '#ff4444',
    },
  },
  max_lust: {
    id: 'max_lust',
    displayName: '最大欲望值',
    category: 'basic',
    dataType: 'number',
    minValue: 1,
    priority: 11,
    ui: {
      positiveIcon: '💖',
      negativeIcon: '💔',
      positiveColor: '#ff69b4',
      negativeColor: '#ff4444',
    },
  },
  max_energy: {
    id: 'max_energy',
    displayName: '最大能量',
    category: 'basic',
    dataType: 'number',
    minValue: 1,
    priority: 12,
    playerOnly: true,
    ui: {
      positiveIcon: '⚡',
      negativeIcon: '⚡',
      positiveColor: '#ffff00',
      negativeColor: '#888888',
    },
  },
  hp: {
    id: 'hp',
    displayName: '生命值',
    category: 'basic',
    dataType: 'number',
    minValue: 0,
    priority: 13,
    ui: {
      positiveIcon: '💚',
      negativeIcon: '💔',
      positiveColor: '#44ff44',
      negativeColor: '#ff4444',
    },
  },
  lust: {
    id: 'lust',
    displayName: '欲望值',
    category: 'basic',
    dataType: 'number',
    minValue: 0,
    priority: 14,
    ui: {
      positiveIcon: '💕',
      negativeIcon: '✨',
      positiveColor: '#ff69b4',
      negativeColor: '#87ceeb',
    },
  },
  energy: {
    id: 'energy',
    displayName: '当前能量',
    category: 'basic',
    dataType: 'number',
    minValue: 0,
    priority: 15,
    playerOnly: true,
    ui: {
      positiveIcon: '⚡',
      negativeIcon: '⚡',
      positiveColor: '#ffff00',
      negativeColor: '#888888',
    },
  },
  block: {
    id: 'block',
    displayName: '格挡',
    category: 'basic',
    dataType: 'number',
    minValue: 0,
    priority: 16,
    ui: {
      positiveIcon: '🛡️',
      negativeIcon: '🛡️',
      positiveColor: '#4169e1',
      negativeColor: '#888888',
    },
  },

  // ===== 状态效果 (优先级 20-29) =====
  status: {
    id: 'status',
    displayName: '状态效果',
    category: 'status',
    dataType: 'string',
    priority: 20,
  },

  // ===== 特殊状态字段 (优先级 21-29) =====
  stun: {
    id: 'stun',
    displayName: '无法行动',
    category: 'status',
    dataType: 'boolean',
    priority: 21,
  },

  // ===== 修饰符 (优先级 30-39) =====
  damage_modifier: {
    id: 'damage_modifier',
    displayName: '伤害修饰符',
    category: 'modifier',
    dataType: 'number',
    priority: 30,
    ui: {
      positiveIcon: '⚔️',
      negativeIcon: '⚔️',
      positiveColor: '#ef4444',
      negativeColor: '#ef4444',
    },
  },
  damage_taken_modifier: {
    id: 'damage_taken_modifier',
    displayName: '受伤害修饰符',
    category: 'modifier',
    dataType: 'number',
    priority: 31,
    ui: {
      positiveIcon: '🛡️',
      negativeIcon: '💔',
      positiveColor: '#3b82f6',
      negativeColor: '#ef4444',
    },
  },
  lust_damage_modifier: {
    id: 'lust_damage_modifier',
    displayName: '欲望伤害修饰符',
    category: 'modifier',
    dataType: 'number',
    priority: 32,
    ui: {
      positiveIcon: '💕',
      negativeIcon: '💕',
      positiveColor: '#ec4899',
      negativeColor: '#ec4899',
    },
  },
  lust_damage_taken_modifier: {
    id: 'lust_damage_taken_modifier',
    displayName: '受欲望伤害修饰符',
    category: 'modifier',
    dataType: 'number',
    priority: 33,
    ui: {
      positiveIcon: '💙',
      negativeIcon: '💖',
      positiveColor: '#3b82f6',
      negativeColor: '#ec4899',
    },
  },
  block_modifier: {
    id: 'block_modifier',
    displayName: '格挡修饰符',
    category: 'modifier',
    dataType: 'number',
    priority: 34,
    ui: {
      positiveIcon: '🛡️',
      negativeIcon: '🛡️',
      positiveColor: '#4169e1',
      negativeColor: '#8b5cf6',
    },
  },

  // ===== 能力系统 (优先级 50) =====
  ability: {
    id: 'ability',
    displayName: '能力',
    category: 'ability',
    dataType: 'string',
    priority: 50,
  },

  // ===== 卡牌操作 (优先级 60-69) =====
  draw: {
    id: 'draw',
    displayName: '抽牌',
    category: 'card',
    dataType: 'number',
    minValue: 0,
    priority: 60,
    playerOnly: true,
    ui: {
      positiveIcon: '🃏',
      negativeIcon: '🃏',
      positiveColor: '#ffd700',
      negativeColor: '#888888',
    },
  },
  discard: {
    id: 'discard',
    displayName: '弃牌',
    category: 'card',
    dataType: 'string',
    priority: 61,
    playerOnly: true,
    ui: {
      positiveIcon: '🗂️',
      negativeIcon: '🗂️',
      positiveColor: '#888888',
      negativeColor: '#ff4444',
    },
  },
  add_to_hand: {
    id: 'add_to_hand',
    displayName: '加入手牌',
    category: 'card',
    dataType: 'object',
    priority: 62,
    playerOnly: true,
  },
  add_to_deck: {
    id: 'add_to_deck',
    displayName: '加入抽牌堆',
    category: 'card',
    dataType: 'object',
    priority: 63,
    playerOnly: true,
  },
  exhaust: {
    id: 'exhaust',
    displayName: '消耗',
    category: 'card',
    dataType: 'number',
    minValue: 0,
    priority: 64,
    playerOnly: true,
  },
  reduce_cost: {
    id: 'reduce_cost',
    displayName: '降低费用',
    category: 'card',
    dataType: 'number',
    priority: 65,
    playerOnly: true,
  },
  copy_card: {
    id: 'copy_card',
    displayName: '复制卡牌',
    category: 'card',
    dataType: 'string',
    priority: 66,
    playerOnly: true,
  },
  trigger_effect: {
    id: 'trigger_effect',
    displayName: '触发效果',
    category: 'card',
    dataType: 'string',
    priority: 67,
    playerOnly: true,
  },
  exile: {
    id: 'exile',
    displayName: '放逐',
    category: 'card',
    dataType: 'string',
    priority: 68,
    playerOnly: true,
  },

  // ===== 特殊效果 (优先级 70+) =====
  narrate: {
    id: 'narrate',
    displayName: '叙事',
    category: 'special',
    dataType: 'string',
    priority: 70,
  },
};

/**
 * 所有触发器定义（包含显示配置）
 */
export const TRIGGER_DEFINITIONS: Record<string, TriggerDefinition> = {
  battle_start: { id: 'battle_start', name: '战斗开始时', icon: '🚀', color: '#ffd700' },
  ability_gain: { id: 'ability_gain', name: '获得能力时', icon: '🎯', color: '#8b5cf6' },
  turn_start: { id: 'turn_start', name: '回合开始时', icon: '🔄', color: '#4169e1' },
  turn_end: { id: 'turn_end', name: '回合结束时', icon: '🔚', color: '#9370db' },
  card_played: { id: 'card_played', name: '打出卡牌时', icon: '🃏', color: '#ff69b4' },
  on_card_played: { id: 'on_card_played', name: '打出卡牌时', icon: '🃏', color: '#ff69b4' }, // 兼容旧格式
  on_discard: { id: 'on_discard', name: '弃牌时', icon: '🗑️', color: '#6b7280' },
  passive: { id: 'passive', name: '被动效果', icon: '⭐', color: '#a855f7' },
  take_damage: { id: 'take_damage', name: '受到伤害时', icon: '💥', color: '#ff4444' },
  take_heal: { id: 'take_heal', name: '受到治疗时', icon: '💚', color: '#22c55e' },
  deal_damage: { id: 'deal_damage', name: '造成伤害时', icon: '⚔️', color: '#dc2626' },
  deal_heal: { id: 'deal_heal', name: '造成治疗时', icon: '🌟', color: '#16a34a' },
  lust_increase: { id: 'lust_increase', name: '欲望增加时', icon: '💖', color: '#ec4899' },
  lust_decrease: { id: 'lust_decrease', name: '欲望减少时', icon: '💙', color: '#3b82f6' },
  deal_lust_increase: { id: 'deal_lust_increase', name: '造成欲望增加时', icon: '💕', color: '#f97316' },
  deal_lust_decrease: { id: 'deal_lust_decrease', name: '造成欲望减少时', icon: '🧊', color: '#0ea5e9' },
  gain_block: { id: 'gain_block', name: '获得格挡时', icon: '🛡️', color: '#4169e1' },
  lose_block: { id: 'lose_block', name: '失去格挡时', icon: '💨', color: '#6b7280' },
  gain_buff: { id: 'gain_buff', name: '获得增益时', icon: '✨', color: '#10b981' },
  gain_debuff: { id: 'gain_debuff', name: '获得减益时', icon: '🌫️', color: '#ef4444' },
  lose_buff: { id: 'lose_buff', name: '失去增益时', icon: '💨', color: '#6b7280' },
  lose_debuff: { id: 'lose_debuff', name: '失去减益时', icon: '🌈', color: '#8b5cf6' },
  enemy_gain_buff: { id: 'enemy_gain_buff', name: '对方获得增益时', icon: '👥✨', color: '#f59e0b' },
  enemy_gain_debuff: { id: 'enemy_gain_debuff', name: '对方获得减益时', icon: '👥🌫️', color: '#84cc16' },
  enemy_lose_buff: { id: 'enemy_lose_buff', name: '对方失去增益时', icon: '👥💨', color: '#06b6d4' },
  enemy_lose_debuff: { id: 'enemy_lose_debuff', name: '对方失去减益时', icon: '👥🌈', color: '#d946ef' },
  // 状态专用触发器（一般不直接显示）
  apply: { id: 'apply', name: '施加时', icon: '✨', color: '#10b981' },
  tick: { id: 'tick', name: '每回合', icon: '⏱️', color: '#3b82f6' },
  remove: { id: 'remove', name: '移除时', icon: '💨', color: '#6b7280' },
  hold: { id: 'hold', name: '持有时', icon: '🤲', color: '#8b5cf6' },
  stack: { id: 'stack', name: '叠加时', icon: '📚', color: '#06b6d4' },
};

/**
 * 所有支持的触发器类型列表
 */
export const VALID_TRIGGERS: TriggerType[] = Object.keys(TRIGGER_DEFINITIONS) as TriggerType[];

/**
 * 所有支持的操作符
 */
export const VALID_OPERATORS: OperatorType[] = ['+', '-', '*', '/', '=', 'apply', 'remove'];

// ====== 向后兼容导出（避免破坏现有代码）======

/**
 * 触发器显示配置（向后兼容，直接使用 TRIGGER_DEFINITIONS）
 * @deprecated 请直接使用 TRIGGER_DEFINITIONS 或 getTriggerDefinition() 函数
 */
export const TRIGGER_DISPLAY_CONFIG = TRIGGER_DEFINITIONS;

/**
 * 属性显示配置（向后兼容，从 ATTRIBUTE_DEFINITIONS 中提取 UI 配置）
 * @deprecated UI 配置已集成到 ATTRIBUTE_DEFINITIONS.ui 中
 */
export const ATTRIBUTE_DISPLAY_CONFIG = Object.fromEntries(
  Object.entries(ATTRIBUTE_DEFINITIONS)
    .filter(([_, def]) => def.ui)
    .map(([key, def]) => [
      key,
      {
        name: def.displayName,
        positiveIcon: def.ui!.positiveIcon || '❓',
        negativeIcon: def.ui!.negativeIcon || '❓',
        positiveColor: def.ui!.positiveColor || '#888888',
        negativeColor: def.ui!.negativeColor || '#888888',
      },
    ]),
);

/**
 * 玩家独有属性列表（用于验证和选择器过滤）
 */
export const PLAYER_ONLY_ATTRIBUTES: string[] = Object.keys(ATTRIBUTE_DEFINITIONS).filter(
  key => ATTRIBUTE_DEFINITIONS[key].playerOnly,
);

/**
 * 玩家独有属性集合（用于快速查询）
 */
export const PLAYER_ONLY_ATTRIBUTES_SET: Set<string> = new Set(PLAYER_ONLY_ATTRIBUTES);

/**
 * 获取属性定义
 */
export function getAttributeDefinition(attributeId: string): AttributeDefinition | undefined {
  return ATTRIBUTE_DEFINITIONS[attributeId];
}

/**
 * 获取所有属性定义
 */
export function getAllAttributeDefinitions(): Map<string, AttributeDefinition> {
  return new Map(Object.entries(ATTRIBUTE_DEFINITIONS));
}

/**
 * 获取属性执行优先级
 */
export function getAttributePriority(attributeId: string): number {
  const def = ATTRIBUTE_DEFINITIONS[attributeId];
  return def ? def.priority : 999; // 未定义的属性使用最低优先级
}

/**
 * 检查是否为有效触发器
 */
export function isValidTrigger(trigger: string): boolean {
  return VALID_TRIGGERS.includes(trigger as TriggerType);
}

/**
 * 获取触发器定义
 */
export function getTriggerDefinition(trigger: string): TriggerDefinition | undefined {
  return TRIGGER_DEFINITIONS[trigger];
}

/**
 * 获取属性的 UI 显示配置
 */
export function getAttributeUIConfig(attribute: string): AttributeDefinition['ui'] | undefined {
  return ATTRIBUTE_DEFINITIONS[attribute]?.ui;
}

/**
 * 检查是否为有效操作符
 */
export function isValidOperator(operator: string): boolean {
  return VALID_OPERATORS.includes(operator as OperatorType);
}

/**
 * 检查是否为玩家独有属性
 */
export function isPlayerOnlyAttribute(attribute: string): boolean {
  return PLAYER_ONLY_ATTRIBUTES.includes(attribute);
}
