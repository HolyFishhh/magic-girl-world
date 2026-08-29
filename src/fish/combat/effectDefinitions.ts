import { normalizeAbilityTrigger } from '../../game-core/battleTriggers';

export interface AttributeDefinition {
  id: string;
  displayName: string;
}

export interface TriggerDefinition {
  id: string;
  name: string;
  icon: string;
  color: string;
}

const ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  max_hp: '最大生命值',
  max_lust: '最大欲望值',
  max_energy: '最大能量',
  hp: '生命值',
  lust: '欲望值',
  energy: '当前能量',
  block: '格挡',
  damage_modifier: '伤害修饰符',
  damage_taken_modifier: '受伤害修饰符',
  lust_damage_modifier: '欲望伤害修饰符',
  lust_damage_taken_modifier: '受欲望伤害修饰符',
  block_modifier: '格挡修饰符',
  summon_capacity_modifier: '召唤容量修饰符',
  heal_modifier: '治疗修饰符',
};

export const TRIGGER_DEFINITIONS: Readonly<Record<string, TriggerDefinition>> = {
  battle_start: { id: 'battle_start', name: '战斗开始时', icon: '🚀', color: '#d97706' },
  ability_gain: { id: 'ability_gain', name: '获得能力时', icon: '🎯', color: '#7c3aed' },
  turn_start: { id: 'turn_start', name: '回合开始时', icon: '🔄', color: '#2563eb' },
  turn_end: { id: 'turn_end', name: '回合结束时', icon: '🔚', color: '#7e22ce' },
  card_played: { id: 'card_played', name: '打出卡牌时', icon: '🃏', color: '#db2777' },
  attack_played: { id: 'attack_played', name: '打出攻击牌时', icon: '⚔️', color: '#dc2626' },
  skill_played: { id: 'skill_played', name: '打出技能牌时', icon: '🛡️', color: '#2563eb' },
  power_played: { id: 'power_played', name: '打出能力牌时', icon: '✨', color: '#9333ea' },
  on_discard: { id: 'on_discard', name: '弃牌时', icon: '🗑️', color: '#4b5563' },
  on_exhaust: { id: 'on_exhaust', name: '消耗牌时', icon: '🔥', color: '#ea580c' },
  on_draw: { id: 'on_draw', name: '抽牌时', icon: '🃏', color: '#ca8a04' },
  on_shuffle: { id: 'on_shuffle', name: '洗牌时', icon: '🔄', color: '#0f766e' },
  passive: { id: 'passive', name: '被动效果', icon: '⭐', color: '#9333ea' },
  take_damage: { id: 'take_damage', name: '受到伤害时', icon: '💥', color: '#dc2626' },
  take_heal: { id: 'take_heal', name: '受到治疗时', icon: '💚', color: '#16a34a' },
  deal_damage: { id: 'deal_damage', name: '造成伤害时', icon: '⚔️', color: '#b91c1c' },
  deal_heal: { id: 'deal_heal', name: '造成治疗时', icon: '🌟', color: '#15803d' },
  lust_increase: { id: 'lust_increase', name: '欲望增加时', icon: '💖', color: '#db2777' },
  lust_decrease: { id: 'lust_decrease', name: '欲望减少时', icon: '💙', color: '#2563eb' },
  deal_lust_increase: { id: 'deal_lust_increase', name: '造成欲望增加时', icon: '💕', color: '#ea580c' },
  deal_lust_decrease: { id: 'deal_lust_decrease', name: '造成欲望减少时', icon: '🧊', color: '#0284c7' },
  gain_block: { id: 'gain_block', name: '获得格挡时', icon: '🛡️', color: '#2563eb' },
  lose_block: { id: 'lose_block', name: '失去格挡时', icon: '💨', color: '#4b5563' },
  defeated: { id: 'defeated', name: '被击败时', icon: '💀', color: '#991b1b' },
  gain_buff: { id: 'gain_buff', name: '获得增益时', icon: '✨', color: '#059669' },
  gain_debuff: { id: 'gain_debuff', name: '获得减益时', icon: '🌫️', color: '#dc2626' },
  lose_buff: { id: 'lose_buff', name: '失去增益时', icon: '💨', color: '#4b5563' },
  lose_debuff: { id: 'lose_debuff', name: '失去减益时', icon: '🌈', color: '#7c3aed' },
  enemy_gain_buff: { id: 'enemy_gain_buff', name: '敌方获得增益时', icon: '✨', color: '#d97706' },
  enemy_gain_debuff: { id: 'enemy_gain_debuff', name: '敌方获得减益时', icon: '🌫️', color: '#65a30d' },
  enemy_lose_buff: { id: 'enemy_lose_buff', name: '敌方失去增益时', icon: '💨', color: '#0891b2' },
  enemy_lose_debuff: { id: 'enemy_lose_debuff', name: '敌方失去减益时', icon: '🌈', color: '#c026d3' },
  apply: { id: 'apply', name: '施加时', icon: '✨', color: '#059669' },
  stack: { id: 'stack', name: '叠加时', icon: '📚', color: '#0891b2' },
  tick: { id: 'tick', name: '每回合', icon: '⏱️', color: '#2563eb' },
  remove: { id: 'remove', name: '移除时', icon: '💨', color: '#4b5563' },
  hold: { id: 'hold', name: '持有时', icon: '🤲', color: '#7c3aed' },
};

export function getAttributeDefinition(attributeId: string): AttributeDefinition | undefined {
  const displayName = ATTRIBUTE_NAMES[attributeId];
  return displayName ? { id: attributeId, displayName } : undefined;
}

export function getTriggerDefinition(trigger: string): TriggerDefinition | undefined {
  return TRIGGER_DEFINITIONS[trigger] || TRIGGER_DEFINITIONS[normalizeAbilityTrigger(trigger) || ''];
}
