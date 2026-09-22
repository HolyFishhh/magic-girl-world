export { describeOpeningDeckTransforms } from './towerOpeningTransforms';
import { describeCardTraits } from './cardLifecycle';
import { describeEffectTarget as targetName } from './effectTargetDisplay';
import { describeSummonPlayRequirement } from './summonPlayRequirementDisplay';
import { describeResourceHalf } from './resourceAssignmentDisplay';
import { simplifyNumericDisplay } from './numericDisplaySimplification';
import { summonModifierDisplayGroups, joinSummonModifierDescriptions } from './summonModifierDisplayGrouping';
import { analyzeEffectProgram } from './contentAnalysis';
import { describeCardTypeCondition } from './cardConditionDisplay';
import { describeStanceIdentity } from './stanceIdentityDisplay';
import { compileCompactEffectList } from './compactEffectDsl';
import type { CardSelector, ConditionExpression, EffectNode, EffectProgram, NumericExpression } from './effectDsl';
import type { EnemyTargetSelector } from './combatantCollection';
import { resolveTriggerInput } from './triggerInput';
import { describeCardAttachmentRemaining, type CardAttachment } from './cardAttachment';
import { describeCardCost } from './combatResource';
import type { SummonSelector } from './summonUnit';
import type { EventTriggerQuery } from './battleEventJournal';
import { describeTriggerEventQuery } from './triggerDescription';
import { describeSummonSlotLifecycle } from './summonLifecycleDescription';
import { describeNonCombatSettlement, nonCombatSettlementReferences } from './nonCombatSettlementDisplay';
import { describeStatusEventIdentity } from './statusEventIdentityDisplay';
import { damageProtectionRuleDescription, normalizeDamageProtectionRule } from './damageProtection';
import { normalizeStatusDefenseRule, statusDefenseRuleDescription } from './statusDefense';

export type EffectIntentType = 'attack' | 'lust_attack' | 'defend' | 'heal' | 'buff' | 'debuff' | 'special';

export interface EffectProgramSummary {
  type: EffectIntentType;
  damage?: number;
  lustDamage?: number;
  block?: number;
}

export interface EffectDisplayTag {
  reference?: import('./contentDescription').ContentRuleReference;
  references?: Array<NonNullable<EffectDisplayTag['reference']>>;
  text: string;
  icon: string;
  color: string;
  category: 'beneficial' | 'harmful' | 'neutral' | 'utility' | 'special';
}

export interface EffectDisplayContext {
  /** Hand-only current-target estimate; callers omit this in rule/details views. */
  damageAmountText?: (node: Extract<EffectNode, { op: 'damage' }>) => string | undefined;
  referenceDepth?: number;
  collapseSummons?: boolean;
  statusNames?: Readonly<Record<string, string>>;
  /** Stable runtime enemy ID → visible name mapping for exact protection references. */
  enemyNames?: Readonly<Record<string, string>>;
  statusDefinitions?: Readonly<Record<string, unknown>>;
  resourceDescriptions?: Readonly<Record<string, string>>;
  opponentResourceDescriptions?: Readonly<Record<string, string>>;
  resourceNames?: Readonly<Record<string, string>>;
  resourceEmojis?: Readonly<Record<string, string>>;
  opponentResourceNames?: Readonly<Record<string, string>>;
  opponentResourceEmojis?: Readonly<Record<string, string>>;
  summonerResourceEmojis?: Readonly<Record<string, string>>;
  summonerResourceNames?: Readonly<Record<string, string>>;
  cardNames?: Readonly<Record<string, string>>;
  cardDefinitions?: Readonly<Record<string, unknown>>;
  summonNames?: Readonly<Record<string, string>>;
  stanceNames?: Readonly<Record<string, string>>;
  stanceDefinitions?: Readonly<Record<string, Record<string, unknown>>>;
  enemyActionNames?: Readonly<Record<string, string>>;
  resolveStatusName?: (statusId: string) => string | undefined;
  selfLabel?: string;
  opponentLabel?: string;
}

function stanceReference(id: string, context: EffectDisplayContext, definition?: Record<string, unknown>): NonNullable<EffectDisplayTag['reference']> | null {
  const stance = definition || context.stanceDefinitions?.[id];
  const name = (typeof stance?.name === 'string' && stance.name.trim()) || context.stanceNames?.[id];
  if (!stance || !name) return null;
  return { kind: 'stance', id, name, rules: '点击查看姿态的进入、持续、退出与触发效果。', stance,
    flavor: typeof stance.description === 'string' ? stance.description : '', stanceContext: {
      statusNames: context.statusNames, statusDefinitions: context.statusDefinitions,
      resourceDescriptions: context.resourceDescriptions,
      opponentResourceDescriptions: context.opponentResourceDescriptions, resourceNames: context.resourceNames,
      resourceEmojis: context.resourceEmojis, opponentResourceNames: context.opponentResourceNames,
      opponentResourceEmojis: context.opponentResourceEmojis, summonerResourceNames: context.summonerResourceNames,
      summonerResourceEmojis: context.summonerResourceEmojis, cardNames: context.cardNames,
      cardDefinitions: context.cardDefinitions,
      summonNames: context.summonNames, stanceNames: context.stanceNames, stanceDefinitions: context.stanceDefinitions,
      enemyActionNames: context.enemyActionNames, selfLabel: context.selfLabel, opponentLabel: context.opponentLabel,
    } };
}

function conditionStanceReferences(value: ConditionExpression, context: EffectDisplayContext): NonNullable<EffectDisplayTag['reference']>[] {
  if (value.op === 'stance_is' && value.stanceId) {
    const reference = stanceReference(value.stanceId, context);
    return reference ? [reference] : [];
  }
  if (value.op === 'not') return conditionStanceReferences(value.condition, context);
  if ('conditions' in value) return value.conditions.flatMap(condition => conditionStanceReferences(condition, context));
  return [];
}

const TAG_STYLE = {
  attack: { icon: '⚔️', color: '#ef4444', category: 'harmful' },
  lust: { icon: '💖', color: '#ec4899', category: 'harmful' },
  defend: { icon: '🛡️', color: '#3b82f6', category: 'beneficial' },
  heal: { icon: '💚', color: '#22c55e', category: 'beneficial' },
  energy: { icon: '⚡', color: '#eab308', category: 'beneficial' },
  card: { icon: '🃏', color: '#d97706', category: 'utility' },
  buff: { icon: '✨', color: '#10b981', category: 'beneficial' },
  debuff: { icon: '🌀', color: '#8b5cf6', category: 'harmful' },
  special: { icon: '◆', color: '#64748b', category: 'special' },
} as const satisfies Record<string, Omit<EffectDisplayTag, 'text'>>;

const TRIGGER_STYLE: Readonly<Record<string, { name: string; icon: string; color: string }>> = {
  battle_start: { name: '战斗开始时', icon: '🚀', color: '#d97706' },
  ability_gain: { name: '被赋予能力时', icon: '🎯', color: '#7c3aed' },
  turn_start: { name: '回合开始时', icon: '🔄', color: '#2563eb' },
  turn_end: { name: '回合结束时', icon: '🔚', color: '#7e22ce' },
  card_played: { name: '打出卡牌时', icon: '🃏', color: '#db2777' },
  attack_played: { name: '打出攻击牌时', icon: '⚔️', color: '#dc2626' },
  skill_played: { name: '打出技能牌时', icon: '🛡️', color: '#2563eb' },
  power_played: { name: '打出能力牌时', icon: '✨', color: '#9333ea' },
  on_discard: { name: '有卡牌被弃掉时', icon: '🗑️', color: '#4b5563' },
  on_exhaust: { name: '消耗牌时', icon: '🔥', color: '#ea580c' },
  on_draw: { name: '抽牌时', icon: '🃏', color: '#ca8a04' },
  on_shuffle: { name: '洗牌时', icon: '🔄', color: '#0f766e' },
  passive: { name: '被动效果', icon: '⭐', color: '#9333ea' },
  take_damage: { name: '受到伤害时', icon: '💥', color: '#dc2626' },
  take_heal: { name: '受到治疗时', icon: '💚', color: '#16a34a' },
  deal_damage: { name: '造成伤害时', icon: '⚔️', color: '#b91c1c' },
  deal_heal: { name: '造成治疗时', icon: '🌟', color: '#15803d' },
  lust_increase: { name: '欲望增加时', icon: '💖', color: '#db2777' },
  lust_decrease: { name: '欲望减少时', icon: '💙', color: '#2563eb' },
  deal_lust_increase: { name: '造成欲望增加时', icon: '💕', color: '#ea580c' },
  deal_lust_decrease: { name: '造成欲望减少时', icon: '🧊', color: '#0284c7' },
  gain_block: { name: '获得格挡时', icon: '🛡️', color: '#2563eb' },
  lose_block: { name: '失去格挡时', icon: '💨', color: '#4b5563' },
  kill: { name: '击败敌人时', icon: '⚔️', color: '#b91c1c' },
  defeated: { name: '被击败时', icon: '💀', color: '#991b1b' },
  gain_buff: { name: '被赋予增益时', icon: '✨', color: '#059669' },
  gain_debuff: { name: '被赋予减益时', icon: '🌫️', color: '#dc2626' },
  lose_buff: { name: '失去增益时', icon: '💨', color: '#4b5563' },
  lose_debuff: { name: '失去减益时', icon: '🌈', color: '#7c3aed' },
  enemy_gain_buff: { name: '敌方被赋予增益时', icon: '✨', color: '#d97706' },
  enemy_gain_debuff: { name: '敌方被赋予减益时', icon: '🌫️', color: '#65a30d' },
  enemy_lose_buff: { name: '敌方失去增益时', icon: '💨', color: '#0891b2' },
  enemy_lose_debuff: { name: '敌方失去减益时', icon: '🌈', color: '#c026d3' },
  apply: { name: '赋予时', icon: '✨', color: '#059669' },
  stack: { name: '叠加时', icon: '📚', color: '#0891b2' },
  tick: { name: '行动时', icon: '⏱️', color: '#2563eb' },
  remove: { name: '移除时', icon: '💨', color: '#4b5563' },
  hold: { name: '持有时', icon: '🤲', color: '#7c3aed' },
};

function tag(text: string, style: keyof typeof TAG_STYLE): EffectDisplayTag {
  return { text, ...TAG_STYLE[style] };
}

function displayStatusName(statusId: string, context: EffectDisplayContext): string {
  const groups: Record<string, string> = { all: '全部状态', buffs: '全部增益', debuffs: '全部减益' };
  return (
    groups[statusId] ||
    context.resolveStatusName?.(statusId)?.trim() ||
    context.statusNames?.[statusId]?.trim() ||
    '未注册状态'
  );
}

function describeVariablePath(path: string, context: EffectDisplayContext): string {
  const self = context.selfLabel || '自身';
  const opponent = context.opponentLabel || '敌方';
  const names: Record<string, string> = {
    'context.spent_energy': '使用能量',
    'context.event_paid_energy': '本次出牌实际支付能量',
    'context.event_paid_total': '本次出牌实际支付总费用',
    'context.x_value': 'X值（本次消耗量）',
    'context.status_stacks': '当前状态层数',
    'battle.turn_number': '当前回合数',
    'battle.cards_played_this_turn': '本回合使用卡牌的次数',
    'battle.attacks_played_this_turn': '本回合使用攻击牌的次数',
    'battle.skills_played_this_turn': '本回合使用技能牌的次数',
    'self.hand_size': '手牌数',
    'self.draw_pile_size': '抽牌堆数量',
    'self.discard_pile_size': '弃牌堆数量',
    'self.exhaust_pile_size': '消耗堆数量',
    'self.summon_count': `${self}召唤物数量`,
    'self.ally_count': `${self}存活队友数量`,
    'opponent.hand_size': '对方手牌数',
    'opponent.draw_pile_size': '对方抽牌堆数量',
    'opponent.discard_pile_size': '对方弃牌堆数量',
    'opponent.exhaust_pile_size': '对方消耗堆数量',
    'opponent.summon_count': `${opponent}召唤物数量`,
    'opponent.ally_count': `${opponent}存活队友数量`,
    'self.hp': `${self}生命`,
    'self.max_hp': `${self}最大生命`,
    'self.lust': `${self}欲望`,
    'self.max_lust': `${self}最大欲望`,
    'self.energy': `${self}能量`,
    'self.max_energy': `${self}最大能量`,
    'self.block': `${self}格挡`,
    'opponent.hp': `${opponent}生命`,
    'opponent.max_hp': `${opponent}最大生命`,
    'opponent.lust': `${opponent}欲望`,
    'opponent.max_lust': `${opponent}最大欲望`,
    'opponent.energy': `${opponent}能量`,
    'opponent.max_energy': `${opponent}最大能量`,
    'opponent.block': `${opponent}格挡`,
  };
  if (names[path]) return names[path];
  const spentResource = path.match(/^context\.spent_resource\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (spentResource) return `使用${context.resourceNames?.[spentResource[1]] || spentResource[1]}`;
  const eventPaidResource = path.match(/^context\.event_paid_resource\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (eventPaidResource) return `本次出牌实际支付${context.resourceNames?.[eventPaidResource[1]] || eventPaidResource[1]}`;
  const xResource = path.match(/^context\.x_resource\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (xResource) return `${context.resourceNames?.[xResource[1]] || xResource[1]}的X值`;
  const entityResource = path.match(/^(self|opponent)\.resource\.([A-Za-z_][A-Za-z0-9_]*)\.(current|max)$/);
  if (entityResource) {
    const owner = entityResource[1] === 'self' ? self : opponent;
    const resource = resourceLabel(entityResource[2], entityResource[1], context);
    return `${owner}${resource}${entityResource[3] === 'max' ? '上限' : '数量'}`;
  }
  const statusPath = path.match(/^(self|opponent)\.status\.([A-Za-z0-9_]+)\.stacks$/);
  return statusPath
    ? `${statusPath[1] === 'self' ? self : opponent}${displayStatusName(statusPath[2], context)}层数`
    : '未知变量';
}

function describeNumber(value: NumericExpression, context: EffectDisplayContext): string {
  return renderNumber(simplifyNumericDisplay(value), context);
}

function renderNumber(value: NumericExpression, context: EffectDisplayContext): string {
  if (typeof value === 'number') return String(value);
  if (value.op === 'var') return describeVariablePath(value.path, context);
  if (value.op === 'negate') return `-${renderNumber(value.value, context)}`;
  if (value.op === 'floor') return `向下取整(${renderNumber(value.value, context)})`;
  if (value.op === 'ceil') return `向上取整(${renderNumber(value.value, context)})`;
  if (value.op === 'abs') return `绝对值(${renderNumber(value.value, context)})`;
  if (value.op === 'clamp_min') return `最大值(${value.minimum}、${renderNumber(value.value, context)})`;
  if (value.op === 'min' || value.op === 'max') return `${value.op === 'min' ? '最小值' : '最大值'}(${value.values.map(item => renderNumber(item, context)).join('、')})`;
  if (value.op === 'discard_count') return '本次弃牌数量';
  if (value.op === 'count_cards') return `${describeSelector(value.selector, context)}数量`;
  if (value.op === 'count_statuses') {
    const typeName = value.statusType === 'buff' ? '增益' : value.statusType === 'debuff' ? '减益' : value.statusType === 'neutral' ? '中性状态' : '状态';
    return `${targetName(value.target, context)}${typeName}数量`;
  }
  if (value.op === 'history') return ({
    count: '符合条件的历史事件次数',
    last_damage: '最近一次伤害',
    last_hp_loss: '最近一次实际生命损失',
    last_heal: '最近一次治疗',
    last_resource_spent: '最近一次资源消耗',
    last_turn: '最近一次事件的回合',
    last_sequence: '最近一次事件的序号',
  } as const)[value.metric];
  if (value.op === 'intent_value') return '敌方意图数值';
  if (value.op === 'divide' && value.right === 2) return `${renderNumber(value.left, context)}的一半`;
  if (value.op === 'multiply' && value.right === 0.5) return `${renderNumber(value.left, context)}的一半`;
  if (value.op === 'multiply' && value.left === 0.5) return `${renderNumber(value.right, context)}的一半`;
  const symbols = { add: '+', subtract: '-', multiply: '×', divide: '÷', modulo: '取余' } as const;
  return `(${renderNumber(value.left, context)} ${symbols[value.op]} ${renderNumber(value.right, context)})`;
}

function resourceLabel(id: string, target: string, context: EffectDisplayContext): string {
  return (target === 'opponent' ? context.opponentResourceNames?.[id] : undefined) || context.resourceNames?.[id] || id;
}

function resourceTag(text: string, id: string, target: string, context: EffectDisplayContext): EffectDisplayTag {
  const emoji = (target === 'opponent' ? context.opponentResourceEmojis?.[id] : undefined) || context.resourceEmojis?.[id];
  const name = resourceLabel(id, target, context);
  const rules = (target === 'opponent' ? context.opponentResourceDescriptions?.[id] : context.resourceDescriptions?.[id]) || '战斗资源，可通过对应卡牌或能力获得和消耗。';
  return { ...tag(text, 'energy'), icon: emoji || '◆', reference: { id, name, rules, kind: 'resource' } };
}

function describeResourceDelta(value: NumericExpression, context: EffectDisplayContext): string {
  return typeof value === 'number' && value < 0
    ? `减少${describeNumber(-value, context)}`
    : `获得${describeNumber(value, context)}`;
}

function describeCondition(value: ConditionExpression, context: EffectDisplayContext): string {
  if (value.op === 'not') return `不满足“${describeCondition(value.condition, context)}”`;
  if ('conditions' in value)
    return value.conditions
      .map(item => `“${describeCondition(item, context)}”`)
      .join(value.op === 'all' ? '并且' : '或者');
  if (value.op === 'last_card_type') return describeCardTypeCondition(value.op, value.cardType);
  if (value.op === 'event_status_is') return describeStatusEventIdentity(displayStatusName(value.statusId, context));
  if (value.op === 'discarded_card_type') return describeCardTypeCondition(value.op, value.cardType);
  if (value.op === 'intent_type') return `敌方意图为${value.intentType}`;
  if (value.op === 'stance_is') {
    const holder = value.target === 'self' ? (context.selfLabel || '自身') : (context.opponentLabel || '对方');
    return describeStanceIdentity(holder, value.relation, value.stanceId, context.stanceNames);
  }
  if (value.op === 'event_damage_kind') {
    const names: Record<string, string> = {
      attack: '攻击伤害',
      effect: '效果伤害',
      hp_loss: '生命流失',
      retaliation: '反击伤害',
      damage_over_time: '持续伤害',
      execute: '处决伤害',
    };
    return `本次${value.relation === 'eq' ? '是' : '不是'}${names[value.damageKind] || value.damageKind}`;
  }
  const relations = { eq: '等于', neq: '不等于', gt: '高于', gte: '不低于', lt: '低于', lte: '不高于' } as const;
  const left = describeNumber(value.left, context);
  const right = describeNumber(value.right, context);
  if (left === '使用能量' && right === '0') {
    if (value.relation === 'eq' || value.relation === 'lte') return '没有使用能量';
    if (value.relation === 'gt' || value.relation === 'neq') return '使用了能量';
  }
  return `${left}${relations[value.relation]}${right}`;
}

function cappedBlockText(target: string, amount: NumericExpression, context: EffectDisplayContext): string | null {
  if (typeof amount === 'number' || amount.op !== 'min' || amount.values.length !== 2) return null;
  const cap = typeof amount.values[1] === 'number' ? 1 : typeof amount.values[0] === 'number' ? 0 : -1;
  if (cap < 0) return null;
  const value = amount.values[1 - cap], maximum = amount.values[cap];
  return `获得等同于${describeNumber(value, context)}的格挡，最多${describeNumber(maximum, context)}点`;
}

function conditionalValueText(node: Extract<EffectNode, { op: 'if' }>, context: EffectDisplayContext): string | null {
  if (node.then.length !== 1 || (node.else || []).length !== 1) return null;
  const [thenNode] = node.then;
  const [elseNode] = node.else || [];
  const plain = (value: EffectNode) => Object.keys(value).every(key => ['op', 'amount', 'target', 'targetSelector', 'damageKind', 'bypassBlock', 'hitGroup', 'lifesteal'].includes(key));
  if (!plain(thenNode) || !plain(elseNode)) return null;
  if (('hitGroup' in thenNode ? thenNode.hitGroup : undefined) !== ('hitGroup' in elseNode ? elseNode.hitGroup : undefined)) return null;
  if (JSON.stringify('targetSelector' in thenNode ? thenNode.targetSelector : undefined)
    !== JSON.stringify('targetSelector' in elseNode ? elseNode.targetSelector : undefined)) return null;
  if (thenNode.op === 'damage' && elseNode.op === 'damage' && thenNode.target === elseNode.target
    && [undefined, 'attack'].includes(thenNode.damageKind) && [undefined, 'attack'].includes(elseNode.damageKind)
    && !thenNode.bypassBlock && !elseNode.bypassBlock && thenNode.lifesteal === elseNode.lifesteal) {
    const target = targetName(elseNode.target, context, elseNode.targetSelector);
    return `对${target}造成${displayedDamageAmount(elseNode, context)}点伤害；如果${describeCondition(node.condition, context)}，则造成${displayedDamageAmount(thenNode, context)}点伤害${nodeTags(elseNode, context).slice(1).map(tag => `；${tag.text}`).join('')}`;
  }
  if (thenNode.op === 'gain_block' && elseNode.op === 'gain_block' && thenNode.target === elseNode.target) {
    const target = targetName(elseNode.target, context, elseNode.targetSelector);
    return `${target}获得${describeNumber(elseNode.amount, context)}点格挡；如果${describeCondition(node.condition, context)}，则获得${describeNumber(thenNode.amount, context)}点格挡`;
  }
  return null;
}

function describeCardFilter(filter: CardSelector['filter'], context: EffectDisplayContext = {}): string[] {
  const typeNames: Record<string, string> = {
    Attack: '攻击牌', Skill: '技能牌', Power: '能力牌', Event: '事件牌', Curse: '诅咒牌',
  };
  const rarityNames: Record<string, string> = {
    Common: '普通', Uncommon: '罕见', Rare: '稀有', Epic: '史诗', Legendary: '传说', Corrupt: '堕化',
  };
  const constraints: string[] = [];
  if (filter?.nameContains) constraints.push(`名称含「${filter.nameContains}」`);
  if (filter?.name) constraints.push(`名称:${filter.name}`);
  if (filter?.types?.length) constraints.push(filter.types.map(type => typeNames[type] || type).join('/'));
  if (filter?.rarities?.length) constraints.push(filter.rarities.map(rarity => rarityNames[rarity] || rarity).join('/'));
  if (filter?.cost !== undefined) constraints.push(`${describeCardCost(filter.cost)}费`);
  if (filter?.minCost !== undefined) constraints.push(`至少${filter.minCost}费`);
  if (filter?.maxCost !== undefined) constraints.push(`至多${filter.maxCost}费`);
  if (filter?.tags?.length) constraints.push(`标签:${filter.tags.join('+')}`);
  if (filter?.templateId) constraints.push(context.cardNames?.[filter.templateId] ? `卡牌:${context.cardNames[filter.templateId]}` : '指定卡牌');
  if (filter?.runInstanceId) constraints.push('指定整局实例');
  if (filter?.combatInstanceId) constraints.push('指定战斗实例');
  if (filter?.origin) constraints.push(`来源:${{ deck: '初始牌组', generated: '生成', copied: '复制', transformed: '变形' }[filter.origin] || '指定来源'}`);
  if (filter?.upgraded !== undefined) constraints.push(filter.upgraded ? '已升级' : '未升级');
  const keywordNames: Record<string, string> = {
    retain: '保留', exhaust: '消耗', ethereal: '虚无', innate: '固有', sly: '灵巧',
  };
  if (filter?.keywords?.length) {
    constraints.push(filter.keywords.map(keyword => keywordNames[keyword] || keyword).join('+'));
  }
  if (filter?.excludedKeywords?.length) {
    constraints.push(`不含${filter.excludedKeywords.map(keyword => keywordNames[keyword] || keyword).join('+')}`);
  }
  if (filter?.rootOnly !== undefined) constraints.push(filter.rootOnly ? '仅谱系原卡' : '包含临时副本');
  return constraints;
}

function describeSelector(selector: CardSelector, context: EffectDisplayContext = {}): string {
  const identity = selector.filter?.runInstanceId || selector.filter?.combatInstanceId || selector.filter?.templateId;
  const name = selector.filter?.name || (identity ? context.cardNames?.[identity] : undefined);
  if (name || identity) {
    const { name: _name, templateId: _template, runInstanceId: _run, combatInstanceId: _combat, ...rest } = selector.filter || {};
    const constraints = describeCardFilter(rest, context);
    return (selector.pick === 'all' ? '所有同名卡牌' : '指定卡牌') + (name ? '（' + name + '）' : '')
      + (constraints.length ? `中符合“${constraints.join('、')}”的牌` : '');
  }
  const zones = {
    hand: '手牌', draw: '抽牌堆', discard: '弃牌堆', exhaust: '消耗堆',
    all: '全部常规牌区', combat: '本场战斗全部牌区',
  } as const;
  const picks = { random: '随机', choose: '选择', left: '最左侧', right: '最右侧', top: '顶部', bottom: '底部', all: '全部' } as const;
  const constraints = describeCardFilter(selector.filter, context);
  return `${zones[selector.zone]}中${constraints.length ? `符合“${constraints.join('、')}”的` : ''}${picks[selector.pick]}${selector.count ? `${selector.count}张` : ''}`;
}

function describeCardDestination(destination: string): string {
  return ({
    discard: '弃牌堆', exhaust: '消耗堆', draw_top: '抽牌堆顶部',
    draw_bottom: '抽牌堆底部', hand: '手牌', remove: '移出本场战斗',
  } as Record<string, string>)[destination] || destination;
}

function displayRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function describeEventTriggerQuery(query: EventTriggerQuery | undefined, context: EffectDisplayContext): string {
  return describeTriggerEventQuery(query);
}

function describeSummonSelector(selector: SummonSelector, context: EffectDisplayContext = {}): string {
  const owner = selector.owner === 'self' ? '我方'
    : selector.owner === 'opponent' ? '敌方' : '任意阵营';
  const count = Math.max(1, Math.floor(Number(selector.count) || 1));
  const amount = count > 1 ? `${count}个` : '';
  const picks: Record<SummonSelector['pick'], string> = {
    left: `最早的${amount}`,
    right: `最新的${amount}`,
    choose: `手动选择的${amount}`,
    first: `最早的${amount}`,
    last: `最新的${amount}`,
    random: '随机1个',
    random_n: `随机${count}个`,
    all: '全部',
    lowest_hp: `生命比例最低的${amount}`,
    highest_hp: `生命比例最高的${amount}`,
    by_id: `实例“${selector.id || '未知'}”`,
    source: `当前触发的${amount}`,
  };
  const filters = [
    selector.templateId ? `类型为“${context.summonNames?.[selector.templateId] || selector.templateId}”` : '',
    selector.id && selector.pick !== 'by_id' ? `实例“${selector.id}”` : '',
    selector.slot ? `位于“${selector.slot}”唯一槽` : '',
    selector.tags?.length ? `同时带有“${selector.tags.join('、')}”标签` : '',
  ].filter(Boolean);
  return `${owner}${picks[selector.pick]}${filters.length ? `${filters.join('且')}的` : selector.pick === 'by_id' ? '的' : ''}召唤物`;
}

function summonSelectorReference(selector: SummonSelector, context: EffectDisplayContext): EffectDisplayTag['reference'] | undefined {
  const id = selector.templateId || selector.id;
  if (!id) return undefined;
  const name = selector.templateId ? context.summonNames?.[selector.templateId] || selector.templateId : selector.id!;
  return {
    id,
    name,
    rules: selector.templateId ? `召唤物类型：${name}` : `指定召唤物实例：${name}`,
    summon: { id, name },
  };
}


const statName = (stat: string): string =>
  ({
    hp: '生命',
    lust: '欲望',
    energy: '能量',
    block: '格挡',
    damage: '伤害',
    damage_taken: '受到的伤害',
    lust_taken: '受到的欲望伤害',
    heal: '治疗量',
    summon_capacity: '召唤容量',
    draw_per_turn: '回合基础抽牌数',
  })[stat] || '未知属性';

function modifierSubject(target: 'self' | 'opponent', stat: string, context: EffectDisplayContext, selector?: EnemyTargetSelector): string {
  const owner = targetName(target, context, selector);
  return (
    {
      damage: `${owner}造成的伤害`,
      damage_taken: `${owner}受到的伤害`,
      lust: `${owner}造成的欲望伤害`,
      lust_taken: `${owner}受到的欲望伤害`,
      heal: `${owner}的治疗量`,
      block: `${owner}获得的格挡`,
      summon_capacity: `${owner}的召唤容量`,
      draw_per_turn: `${owner}的回合基础抽牌数`,
    }[stat] || `${owner}的未知属性`
  );
}

function generatedCardReference(card: import('./effectDsl').GeneratedCardDefinition, context: EffectDisplayContext): NonNullable<EffectDisplayTag['reference']> {
  const depth = context.referenceDepth || 0;
  const tags = depth >= 8 ? [] : [...cardRequirementDisplayTags(card.requiresSummonTemplateId, context), ...effectProgramToDisplayTags(card.program, { ...context, referenceDepth: depth + 1 })];
  const discarded = card.discardProgram && depth < 8
    ? effectProgramToDisplayTags(card.discardProgram, { ...context, referenceDepth: depth + 1 }) : [];
  return { id: card.id, name: card.name, card, flavor: card.description,
    rules: [...describeCardTraits(card).map(trait => `${trait.name}：${trait.detail}`), ...tags.map(tag => tag.text), ...(discarded.length ? [`此牌被战斗效果弃掉后，${discarded.map(tag => tag.text).join('；')}`] : [])].join('；') || '请在牌库中查看此循环引用卡牌的规则',
    references: [...tags, ...discarded].flatMap(tag => [...(tag.reference ? [tag.reference] : []), ...(tag.references || [])]) };
}

function displayedDamageAmount(node: Extract<EffectNode, {op: 'damage'}>, context: EffectDisplayContext): string {
  const formula = describeNumber(node.amount, context);
  const estimate = context.damageAmountText?.(node);
  if (!estimate) return formula;
  return typeof node.amount === 'number' ? estimate : `${formula}（当前预计 ${estimate}）`;
}

function nodeTags(node: EffectNode, context: EffectDisplayContext): EffectDisplayTag[] {
  // Future effects, generated cards and summon actions have a different owner
  // or future snapshot; never apply the current hand's damage estimate to them.
  if (context.damageAmountText && !['damage', 'if', 'repeat'].includes(node.op)) context = { ...context, damageAmountText: undefined };
  const number = (value: NumericExpression) => describeNumber(value, context);
  switch (node.op) {
    case 'damage': {
      const target = targetName(node.target, context, node.targetSelector);
      const amount = displayedDamageAmount(node, context);
      const prefix = node.damageKind === 'hp_loss'
        ? `使${target}失去${amount}点生命`
        : node.damageKind === 'retaliation'
          ? `对${target}造成${amount}点反伤`
          : node.damageKind === 'damage_over_time'
            ? `对${target}造成${amount}点持续伤害`
            : `对${target}造成${amount}点伤害`;
      return [
        tag(`${prefix}${node.bypassBlock || node.damageKind === 'hp_loss' ? '（无视格挡）' : ''}`, 'attack'),
        ...(node.lifesteal !== undefined
          ? [tag(`按实际生命损失的${number(node.lifesteal)}倍恢复生命`, 'heal')]
          : []),
      ];
    }
    case 'execute':
      return [tag(
        `当${targetName(node.target, context, node.targetSelector)}生命不高于${number(node.threshold)}${node.thresholdMode === 'hp_percent' ? '%' : '点'}时将其处决${node.excludeTags?.length ? `（排除标签：${node.excludeTags.join('、')}）` : ''}`,
        'special',
      )];
    case 'kill':
      return [tag(
        `直接击杀${targetName(node.target, context, node.targetSelector)}${node.excludeTags?.length ? `（排除标签：${node.excludeTags.join('、')}）` : ''}`,
        'special',
      )];
    case 'heal':
      return [tag(`${targetName(node.target, context, node.targetSelector)}回复${number(node.amount)}点生命`, 'heal')];
    case 'gain_block':
      return [tag(`${targetName(node.target, context, node.targetSelector)}${cappedBlockText(targetName(node.target, context, node.targetSelector), node.amount, context) || `获得${number(node.amount)}点格挡`}`, 'defend')];
    case 'gain_energy':
      return [tag(`${targetName(node.target, context, node.targetSelector)}获得${number(node.amount)}点能量`, 'energy')];
    case 'gain_resource':
      return [resourceTag(`${targetName(node.target, context, node.targetSelector)}${describeResourceDelta(node.amount, context)}点${resourceLabel(node.resource, node.target, context)}`, node.resource, node.target, context)];
    case 'set_resource':
      return [resourceTag(`将${targetName(node.target, context, node.targetSelector)}的${resourceLabel(node.resource, node.target, context)}设为${describeResourceHalf(node.value, node.target, node.resource) ?? number(node.value)}`, node.resource, node.target, context)];
    case 'gain_lust':
      return [tag(`${targetName(node.target, context, node.targetSelector)}增加${number(node.amount)}点欲望`, 'lust')];
    case 'set_stat':
      return [tag(`将${targetName(node.target, context, node.targetSelector)}${statName(node.stat)}设为${number(node.value)}`, 'special')];
    case 'persistent_growth': {
      const stat = { max_hp: '生命上限', max_lust: '欲望上限', damage: '伤害', lust: '欲望伤害' }[node.stat];
      const operator = { add: '增加', subtract: '减少', set: '设为' } as const;
      const owner = node.summonTemplateId ? `${context.summonNames?.[node.summonTemplateId] || '指定召唤物'}的` : '';
      return [tag(`${owner}永久${stat}${operator[node.operator]}${number(node.value)}`, 'special')];
    }
    case 'apply_status':
      return [
        tag(
          `为${targetName(node.target, context, node.targetSelector)}赋予${number(node.stacks)}层${displayStatusName(node.status, context)}`,
          node.target === 'self' ? 'buff' : 'debuff',
        ),
      ];
    case 'remove_status':
      return [tag(`移除${targetName(node.target, context, node.targetSelector)}的${displayStatusName(node.status, context)}`, 'special')];
    case 'draw_cards':
      return [tag(`抽${number(node.amount)}张牌`, 'card')];
    case 'scry_cards':
      return [tag(`预见${number(node.amount)}张牌`, 'card')];
    case 'discard_cards':
      return [tag(`弃掉${describeSelector(node.selector, context)}，至多${number(node.amount)}张`, 'card')];
    case 'exhaust_cards':
      return [tag(`消耗${describeSelector(node.selector, context)}，至多${number(node.amount)}张`, 'card')];
    case 'recover_cards':
      return [
        tag(
          node.filter
            ? `从${{ draw: '抽牌堆', discard: '弃牌堆', exhaust: '消耗堆' }[node.source]}中取回${number(node.amount)}张符合“${describeCardFilter(node.filter, context).join('、')}”的牌`
            : `从${{ draw: '抽牌堆', discard: '弃牌堆', exhaust: '消耗堆' }[node.source]}取回${number(node.amount)}张牌`,
          'card',
        ),
      ];
    case 'reduce_card_cost':
      return [tag(`${describeSelector(node.selector, context)}费用降低${number(node.amount)}`, 'energy')];
    case 'modify_card_value': {
      const stats = { damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const;
      const operations = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以' } as const;
      return [
        tag(
          `${describeSelector(node.selector, context)}的${stats[node.stat]}${operations[node.operator]}${number(node.value)}`,
          'card',
        ),
      ];
    }
    case 'copy_cards':
      return [tag(`复制${describeSelector(node.selector, context)}`, 'card')];
    case 'double_card_effect':
      return [tag(`${describeSelector(node.selector, context)}效果翻倍`, 'card')];
    case 'auto_play_cards':
      return [tag(`自动${node.free ? '免费' : ''}打出${describeSelector(node.selector, context)}`, 'card')];
    case 'replay_current':
      return [tag(`此牌额外完整结算${number(node.count)}次（费用只支付一次）`, 'card')];
    case 'set_card_destination': {
      const destinations = {
        discard: '弃牌堆',
        exhaust: '消耗堆',
        draw_top: '抽牌堆顶部',
        draw_bottom: '抽牌堆底部',
        hand: '手牌',
        remove: '战斗外',
      } as const;
      return [tag(`结算后移至${destinations[node.destination]}`, 'card')];
    }
    case 'move_cards': {
      const zones = { hand: '手牌', drawPile: '抽牌堆', discardPile: '弃牌堆', exhaustPile: '消耗堆' } as const;
      return [tag(`将${describeSelector(node.selector, context)}移至${zones[node.destination]}${node.position === 'top' ? '顶部' : '底部'}`, 'card')];
    }
    case 'remove_cards':
      return [tag(`从本场战斗移除${describeSelector(node.selector, context)}`, 'card')];
    case 'transform_cards':
      return [{ ...tag(`将${describeSelector(node.selector, context)}变形为${node.replacement.name}`, 'card'), reference: generatedCardReference(node.replacement, context) }];
    case 'apply_card_patch': {
      const scopes = {
        resolution: '本次结算',
        turn: '本回合',
        until_played: '直到打出',
        combat: '本场战斗',
        run: '本局游戏',
        permanent: '永久',
      } as const;
      const scope = scopes[node.patch.scope];
      if (node.patch.kind === 'keyword') {
        const keywords = { retain: '保留', exhaust: '消耗', ethereal: '虚无', innate: '固有', sly: '灵巧' } as const;
        return [tag(`${describeSelector(node.selector, context)}${scope}${node.patch.enabled ? '获得' : '移除'}“${keywords[node.patch.keyword]}”`, 'card')];
      }
      if (node.patch.kind === 'replay') {
        return [tag(`${describeSelector(node.selector, context)}${scope}额外结算${number(node.patch.extra)}次`, 'card')];
      }
      if (node.patch.kind === 'area') return [tag(`使${describeSelector(node.selector, context)}的攻击改为对所有敌人生效（${scope}）`, 'card')];
      if (node.patch.kind === 'hits') {
        return [tag(`${describeSelector(node.selector, context)}${scope}每段攻击增加${number(node.patch.add)}次命中`, 'card')];
      }
      if (node.patch.kind === 'x_value') {
        const operators = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为' } as const;
        return [tag(`${describeSelector(node.selector, context)}${scope}X值${operators[node.patch.operator]}${number(node.patch.value)}`, 'card')];
      }
      if (node.patch.kind === 'dynamic_cost') {
        const timings = { on_draw: '抽到时', while_in_hand: '留在手牌时', on_play: '打出时' } as const;
        const operators = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为' } as const;
        return [tag(`${describeSelector(node.selector, context)}${scope}${timings[node.patch.timing]}费用${operators[node.patch.operator]}${number(node.patch.value)}`, 'card')];
      }
      const operators = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为' } as const;
      const subject = node.patch.kind === 'cost'
        ? '费用'
        : ({ damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const)[node.patch.stat];
      const action = node.patch.kind === 'numeric' && ['damage', 'lust'].includes(node.patch.stat) ? '造成的' : '的';
      return [tag(`使${describeSelector(node.selector, context)}${action}${subject}${operators[node.patch.operator]}${number(node.patch.value)}（${scope}）${node.patch.includeFutureCopies ? '，之后生成的同类牌也生效' : ''}`, 'card')];
    }
    case 'apply_card_attachment': {
      const attachment = node.attachment;
      const kind = attachment.kind === 'enchantment' ? '附魔' : '负面附着';
      const removal = {
        resolution_end: '本次效果结算后移除',
        played: '打出后移除',
        discarded: '符合弃牌原因后移除',
        turn_end: '回合结束移除',
        combat_end: '持续本场战斗',
        run_end: '持续本次流程',
        manual: '持续存在',
      } as const;
      const defaultRemoval = {
        resolution: 'resolution_end', turn: 'turn_end', until_played: 'played',
        combat: 'combat_end', run: 'run_end', permanent: 'manual',
      } as const;
      const removeOn = attachment.removeOn || defaultRemoval[attachment.scope];
      const result = [tag(
        `${describeSelector(node.selector, context)}获得${kind}“${attachment.name}”（${removal[removeOn]}${attachment.remaining && attachment.remaining > 1 ? `，剩余${attachment.remaining}次` : ''}）`,
        attachment.kind === 'enchantment' ? 'buff' : 'debuff',
      )];
      for (const change of attachment.changes) {
        if (change.kind === 'play_access') {
          result.push(tag(change.mode === 'deny' ? '此牌不可主动打出' : '此牌允许主动打出', 'card'));
        } else if (change.kind === 'discard_auto_play') {
          result.push(tag(`在指定弃牌原因下免费自动打出；失败后移至${describeCardDestination(change.failureDestination)}`, 'card'));
        } else {
          result.push(...nodeTags({
            op: 'apply_card_patch',
            selector: node.selector,
            patch: { ...change, scope: attachment.scope },
          } as EffectNode, context));
        }
      }
      return result;
    }
    case 'upgrade_cards': {
      const result: EffectDisplayTag[] = [];
      for (const change of node.changes) {
        result.push(...nodeTags({
          op: 'apply_card_patch',
          selector: node.selector,
          patch: { ...change, scope: node.scope, match: 'instance' },
        } as EffectNode, context));
      }
      return result;
    }
    case 'add_card':
      return [{ ...tag(
        `将${node.count}张${node.card.name}加入${node.zone === 'hand' ? '手牌' : node.zone === 'draw' ? '抽牌堆' : '弃牌堆'}`,
        'card',
      ), reference: generatedCardReference(node.card, context) }];
    case 'ensure_card':
      return [{ ...tag(
        `本场战斗中确保至少有${number(node.minimum)}张${node.card.name}${node.includeCopies ? '（计入临时复制牌）' : ''}`,
        'card',
      ), reference: generatedCardReference(node.card, context) }];
    case 'spawn_summon': {
      const summon = node.summon;
      const summonContext = { ...context, summonerResourceNames: context.resourceNames, summonerResourceEmojis: context.resourceEmojis,
        resourceNames: { ...context.resourceNames, ...Object.fromEntries(Object.entries(summon.resources || {}).map(([id, resource]) => [id, resource.name])) },
        resourceEmojis: { ...context.resourceEmojis, ...Object.fromEntries(Object.entries(summon.resources || {}).map(([id, resource]) => [id, resource.emoji || '◆'])) } };
      const overflow = {
        reject: '满员时召唤失败',
        replace_oldest: '满员时替换最早的召唤物',
        replace_lowest_hp: '满员时替换生命比例最低的召唤物',
      } as const;
      const tags: EffectDisplayTag[] = [tag(
        [
          `${targetName(node.target, context)}召唤${number(node.count)}个「${summon.name}」`,
          summon.hasHp === false ? '无生命值' : `${summon.maxHp}点生命`,
          summon.block ? `初始${summon.block}点格挡` : '',
          `每次激活行动${summon.actionsPerActivation ?? 1}次`,
          node.capacity ? `召唤容量${node.capacity}` : '所属阵营召唤容量：我方默认3，敌方默认无上限',
          node.overflow ? overflow[node.overflow] : '',
        ].filter(Boolean).join('；'),
        'special',
      )];
      const actionProgram = summon.actionProgram?.steps
        .flatMap(item => nodeTags(item, summonContext)).map(item => item.text).join('，');
      if (actionProgram) tags.push(tag(`行动：${actionProgram}`, 'special'));
      for (const action of summon.actions || []) {
        const details = action.effectProgram.steps
          .flatMap(item => nodeTags(item, summonContext)).map(item => item.text).join('，');
        tags.push(tag(
          `行动「${action.name}」${action.weight ? `（权重${action.weight}）` : ''}${action.fixed ? '（固定数值）' : ''}：${details}`,
          'special',
        ));
      }
      for (const ability of summon.abilities || []) {
        const details = ability.effectProgram.steps
          .flatMap(item => nodeTags(item, summonContext)).map(item => item.text).join('，');
        tags.push(tag(
          `能力「${ability.name || ability.id}」·${TRIGGER_STYLE[ability.trigger]?.name || ability.trigger}${describeEventTriggerQuery(ability.eventQuery, context)}${ability.fixed ? '（固定数值）' : ''}：${details}`,
          'special',
        ));
      }
      const resources = Object.values(summon.resources || {}).map(resource =>
        `${resource.name}${resource.current}/${resource.max}${resource.refresh === 'retain' ? '（保留）' : '（每回合重置）'}`,
      );
      if (resources.length) tags.push(tag(`资源：${resources.join('；')}`, 'energy'));
      const modifierNames: Record<string, string> = {
        damage_modifier: '造成伤害', damage_taken_modifier: '受到伤害',
        lust_damage_modifier: '造成欲望伤害', lust_damage_taken_modifier: '受到欲望伤害',
        heal_modifier: '治疗量', block_modifier: '格挡获取量',
      };
      for (const [key, value] of Object.entries(summon.modifiers || {})) {
        tags.push(tag(`${modifierNames[key] || key}${value >= 0 ? '+' : ''}${value}`, value >= 0 ? 'buff' : 'debuff'));
      }
      if (summon.hasHp !== false && summon.capabilities?.intercepts !== false) tags.push(tag(
        `援护攻击：先计召唤者易伤，再计承伤者减伤与格挡${summon.intercept?.maxPerTurn ? `（每回合至多${summon.intercept?.maxPerTurn}次）` : ''}`,
        'defend',
      ));
      if (summon.slot) {
        tags.push(tag(describeSummonSlotLifecycle({ ...summon, customRepeat: !!summon.onExistingProgram }), 'special'));
        if (summon.onExistingProgram) tags.push(tag(`重复召唤追加：${summon.onExistingProgram.steps.flatMap(step => nodeTags(step, context)).map(tag => tag.text).join('；')}`, 'special'));
      }
      const limitations = [
        summon.capabilities?.selectable === false ? '不可被选择' : '',
        summon.capabilities?.acceptsStatus === false ? '不接受状态' : '',
        summon.capabilities?.acts === false ? '不会自主行动' : '',
        summon.capabilities?.intercepts === false ? '不能援护' : '',
      ].filter(Boolean);
      if (limitations.length) tags.push(tag(limitations.join('；'), 'special'));
      return context.collapseSummons ? [{ ...tag(`${targetName(node.target, context)}召唤${number(node.count)}个「${summon.name}」`, 'special'),
        reference: { id: String(summon.id || summon.name), name: summon.name, rules: tags.map(entry => entry.text).join('\n'), summon: { ...summon, displayResourceNames: context.resourceNames, displayResourceEmojis: context.resourceEmojis } } }] : tags;
    }
    case 'wait': return [tag('空过（不产生战斗效果）', 'special')];
    case 'say': return [tag(`台词：“${node.text}”`, 'special')];
    case 'enemy_intent': return [tag(`将当前敌人的下次行动改为“${context.enemyActionNames?.[node.actionId] || node.actionId}”`, 'special')];
    case 'spawn_enemy': {
      const enemy = node.enemy;
      const enemyContext = { ...context, enemyActionNames: Object.fromEntries((enemy.actions || []).map((action:any) => [action.id, action.name])) };
      const tags: EffectDisplayTag[] = [tag(
        `敌方增援${number(node.count)}个“${enemy.name}”（${enemy.hp ?? enemy.max_hp}/${enemy.max_hp}生命${enemy.block ? `，${enemy.block}格挡` : ''}${node.capacity !== undefined && node.capacity < Number.MAX_SAFE_INTEGER ? `，存活敌人容量${node.capacity}（含候补）` : ''}）`,
        'special',
      )];
      if (typeof (enemy as any).escape_when === 'string' && (enemy as any).escape_when.trim()) {
        tags.push(tag('满足条件后准备逃跑，，至少预警一回合；倒计时为0的回合结束时逃跑', 'special'));
      }
      for (const rawAction of enemy.actions || []) {
        const action = displayRecord(rawAction);
        if (!action) continue;
        const details = compactContentToDisplayTags(
          { effects: action.effects, creates: action.creates, when: action.when },
          enemyContext,
        ).map(item => item.text).join('；');
        tags.push(tag(`行动“${String(action.name || action.id || '未命名')}”${details ? `：${details}` : ''}`, 'special'));
      }
      for (const rawAbility of enemy.abilities || []) {
        const ability = displayRecord(rawAbility);
        if (!ability) continue;
        const resolved = resolveTriggerInput(ability);
        const details = compactContentToDisplayTags(
          { effects: resolved.triggeredEffects, creates: ability.creates },
          enemyContext,
        ).map(item => item.text).join('；');
        tags.push(tag(
          `能力“${String(ability.name || ability.id || '未命名')}”·${TRIGGER_STYLE[String(resolved.trigger)]?.name || String(resolved.trigger || '未知时机')}${describeEventTriggerQuery(resolved.eventQuery, enemyContext)}${details ? `：${details}` : ''}`,
          'special',
        ));
      }
      const statuses = (enemy.status_effects || []).map(raw => displayRecord(raw)).filter(Boolean);
      if (statuses.length) tags.push(tag(
        `初始状态：${statuses.map(status => `${displayStatusName(String(status!.id || ''), context)}${status!.stacks ? `×${status!.stacks}` : ''}`).join('、')}`,
        'special',
      ));
      const lustEffect = displayRecord(enemy.lust_effect);
      if (lustEffect) {
        const details = compactContentToDisplayTags(
          { effects: lustEffect.effects, creates: lustEffect.creates, when: lustEffect.when },
          enemyContext,
        ).map(item => item.text).join('；');
        tags.push(tag(`欲望满溢“${String(lustEffect.name || '未命名')}”${details ? `：${details}` : ''}`, 'lust'));
      }
      const resources = Array.isArray(enemy.resources)
        ? enemy.resources
        : Object.values((enemy.resources || {}) as Record<string, unknown>);
      const resourceText = resources.map(raw => displayRecord(raw)).filter(Boolean).map(resource =>
        `${resource!.name || resource!.id} ${resource!.current ?? resource!.start ?? 0}/${resource!.max}`,
      );
      if (resourceText.length) tags.push(tag(`资源：${resourceText.join('、')}`, 'energy'));
      if (enemy.stance) tags.push(tag(`初始姿态：${String((enemy.stance as any).name || (enemy.stance as any).id || '未命名')}`, 'special'));
      if (enemy.orbs?.length) tags.push(tag(
        `初始姿态槽：${enemy.orbs.map(orb => String((orb as any).name || (orb as any).id || '未命名')).join('、')}`,
        'special',
      ));
      if (enemy.victory_on_defeat) tags.push(tag('最终击倒即胜利（复活成功不算击倒）', 'special'));
      tags.push(tag('固定五前排（显示从左到右5→1），满员进入候补，上场前不参与战斗', 'special'));
      return tags;
    }
    case 'damage_summons':
      return [tag(`对${describeSummonSelector(node.selector, context)}造成${number(node.amount)}点伤害`, 'attack')];
    case 'heal_summons':
      return [tag(`使${describeSummonSelector(node.selector, context)}恢复${number(node.amount)}点生命`, 'heal')];
    case 'modify_summons': {
      const stats = {
        max_hp: '最大生命', block: '格挡', actions_per_activation: '每次行动次数',
        speed: '速度', action_priority: '行动优先级',
      } as const;
      const operations = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为' } as const;
      return [tag(
        `${describeSummonSelector(node.selector, context)}的${stats[node.stat]}${operations[node.operator]}${number(node.value)}`,
        'special',
      )];
    }
    case 'modify_summon_effects': {
      const stats = { damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const;
      const operations = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以' } as const;
      const reference = summonSelectorReference(node.selector, context);
      return [{ ...tag(
        `为${describeSummonSelector(node.selector, context)}，赋予${stats[node.stat]}${operations[node.operator]}${number(node.value)}（本场战斗）`,
        'special',
      ), ...(reference ? { reference } : {}) }];
    }
    case 'gain_summon_resource':
      return [resourceTag(
        `${describeSummonSelector(node.selector, context)}${describeResourceDelta(node.amount, context)}点${context.resourceNames?.[node.resource] || node.resource}`,
        node.resource, 'self', context,
      )];
    case 'set_summon_resource':
      return [resourceTag(
        `将${describeSummonSelector(node.selector, context)}的${context.resourceNames?.[node.resource] || node.resource}设为${number(node.value)}`,
        node.resource, 'self', context,
      )];
    case 'apply_summon_status':
      return [tag(
        `为${describeSummonSelector(node.selector, context)}赋予${number(node.stacks)}层${displayStatusName(node.status, context)}`,
        'buff',
      )];
    case 'remove_summon_status':
      return [tag(
        `移除${describeSummonSelector(node.selector, context)}的${displayStatusName(node.status, context)}`,
        'special',
      )];
    case 'activate_summons':
      return [tag(node.trigger === 'defeated' ? `触发${describeSummonSelector(node.selector, context)}的死亡能力（不使其退场）` : node.suppliedAction
        ? `命令${describeSummonSelector(node.selector, context)}发动${node.suppliedAction.name}`
        : `立即激活${describeSummonSelector(node.selector, context)}`, 'special')];
    case 'dismiss_summons':
      return [tag(
        `遣散${describeSummonSelector(node.selector, context)}${node.retainCorpse ? '并保留其倒下记录' : ''}`,
        'special',
      )];
    case 'copy_summons': {
      const owner = node.targetOwner === 'same' ? '原阵营'
        : node.targetOwner === 'self' ? '我方' : '敌方';
      return [tag(`复制${describeSummonSelector(node.selector, context)}到${owner}`, 'special')];
    }
    case 'summoner_effects': {
      return node.effects.flatMap(item => nodeTags(item, { ...context, resourceNames: context.summonerResourceNames || context.resourceNames, resourceEmojis: context.summonerResourceEmojis || context.resourceEmojis, selfLabel: '召唤者' })).map(item => ({ ...item, text: `作用于召唤者：${item.text}` }));
    }
    case 'modify': {
      const operations = { add: '+', subtract: '-', multiply: '×', divide: '÷', set: '=' } as const;
      return [
        tag(
          `${modifierSubject(node.target, node.stat, context, node.targetSelector)}${operations[node.operator]}${number(node.value)}${node.damageKind ? `（仅${({ attack: "攻击伤害", effect: "效果伤害", hp_loss: "生命流失", retaliation: "反伤", damage_over_time: "持续伤害", execute: "处决" })[node.damageKind]}）` : ""}`,
          node.target === 'self' ? 'buff' : 'debuff',
        ),
      ];
    }
    case 'card_play_rule': {
      const filter = describeCardFilter(node.selector?.filter, context);
      const filteredCards = filter.length ? `符合“${filter.join('、')}”的牌` : '牌';
      const scope = node.limit === 'all'
        ? `所有${filteredCards}`
        : node.limit !== undefined
          ? `前${number(node.limit)}张${filteredCards}`
          : filteredCards;
      const selected = node.selector ? filteredCards : '卡牌';
      const labels: Record<string, string> = {
        retain_hand: '回合结束时保留全部手牌',
        retain_block: '回合开始时保留格挡',
        limit_draw: `每次至多抽${node.limit === 'all' ? '任意' : number(node.limit ?? 0)}张牌`,
        limit_block_gain: `每次至多获得${node.limit === 'all' ? '任意' : number(node.limit ?? 0)}点格挡`,
        limit_energy_gain: `每次至多获得${node.limit === 'all' ? '任意' : number(node.limit ?? 0)}点能量`,
        deny_card_play: `禁止打出${selected}`,
        allow_card_play: `允许打出${selected}，即使其通常不可打出`,
        limit_card_play: `每回合至多打出${node.limit === 'all' ? '任意数量的' : number(node.limit ?? 0)}${selected}`,
        card_destination: `${selected}结算后改为移至${node.destination ? describeCardDestination(node.destination) : '指定区域'}`,
        ethereal: `赋予${selected}虚无（回合结束仍在手中则本场消耗；来源离场后解除）`,
      };
      return [
        tag(
          node.rule === 'free'
            ? `每回合${scope}不消耗${node.freeResources === 'all' || !node.freeResources ? '任何资源' : node.freeResources.map(id => context.resourceNames?.[id] || (id === 'energy' ? '能量' : '指定资源')).join('、')}`
            : node.rule === 'replay'
              ? `每回合${scope}额外结算${number(node.extra ?? 1)}次`
              : labels[node.rule] || node.rule,
          'special',
        ),
      ];
    }
    case 'set_stance': {
      if (!node.stance) return [tag(`${targetName(node.target, context, node.targetSelector)}退出当前姿态`, 'special')];
      const holderContext = node.target === 'opponent' ? { ...context,
        selfLabel: targetName('opponent', context, node.targetSelector), opponentLabel: targetName('self', context),
      } : context;
      const reference = stanceReference(node.stance.id, holderContext, node.stance as unknown as Record<string, unknown>);
      return [{ ...tag(`${targetName(node.target, context, node.targetSelector)}进入姿态「${node.stance.name}」`, 'special'),
        ...(reference ? { reference } : {}) }];
    }
    case 'channel_orb': {
      const passive = (node.orb.passiveEffects || []).flatMap(item => nodeTags(item, context)).map(item => item.text).join('；');
      const evoke = (node.orb.evokeEffects || []).flatMap(item => nodeTags(item, context)).map(item => item.text).join('；');
      return [tag(
        `${targetName(node.target, context, node.targetSelector)}向姿态槽充能姿态「${node.orb.name}」（数值 ${number(node.orb.value)}${passive ? `；被动：${passive}` : ''}${evoke ? `；激发：${evoke}` : ''}）`,
        'special',
      )];
    }
    case 'evoke_orbs': {
      const position = node.selector.pick === 'all' ? '全部' : node.selector.pick === 'last' ? '末尾' : '最前';
      return [tag(
        `${targetName(node.target, context, node.targetSelector)}激发${position}${node.selector.pick === 'all' ? '' : `${node.selector.count || 1}个`}姿态${node.selector.id ? `（类型 ${node.selector.id}）` : ''}`,
        'special',
      )];
    }
    case 'set_orb_slots':
      return [tag(`将${targetName(node.target, context, node.targetSelector)}的姿态槽设为 ${number(node.amount)}`, 'special')];
    case 'modify_orbs': {
      const operations = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以' } as const;
      const position = node.selector.pick === 'all' ? '全部' : node.selector.pick === 'last' ? '末尾' : '最前';
      return [tag(
        `${targetName(node.target, context, node.targetSelector)}${position}姿态的数值${operations[node.operator]}${number(node.value)}`,
        'special',
      )];
    }
    case 'grant_extra_turn':
      return [tag(`${targetName(node.target, context)}获得${number(node.amount)}个额外回合`, 'special')];
    case 'force_end_turn':
      return [tag(`强制结束${targetName(node.target, context)}的当前回合`, 'special')];
    case 'register_trigger': {
      const details = node.effects
        .flatMap(item => nodeTags(item, context))
        .map(item => item.text)
        .join('，');
      return [tag(`为${targetName(node.target, context)}赋予能力：${TRIGGER_STYLE[node.trigger]?.name || node.trigger}${describeEventTriggerQuery(node.eventQuery, context)}，${details}`, 'buff')];
    }
    case 'schedule_effect': {
      const phases = {
        turn_start: '回合开始时',
        before_draw: '抽牌前',
        after_draw: '抽牌后',
        turn_end: '回合结束时',
      } as const;
      const details = node.effects
        .flatMap(item => nodeTags(item, context))
        .map(item => item.text)
        .join('，');
      const timing = node.afterTurns === 0 ? `本${phases[node.phase]}` : `${node.afterTurns}回合后的${phases[node.phase]}`;
      const repeat = node.repeatEvery && node.repeats
        ? `，之后每${node.repeatEvery}回合重复，合计${node.repeats}次`
        : '';
      return [tag(`${timing}：${details}${repeat}`, 'special')];
    }
    case 'choose_one': {
      const references: NonNullable<EffectDisplayTag['reference']>[] = [];
      const choices = node.options.map(option => {
        const tags = option.effects.flatMap(item => nodeTags(item, context));
        references.push(...tags.flatMap(item => [...(item.references || []), ...(item.reference ? [item.reference] : [])]));
        return `“${option.label}”：${tags.map(item => item.text).join('；')}`;
      });
      const count = node.count ?? 1;
      return [{ ...tag(`${count === 1 ? '选择一项' : `选择${count}项`}：\n${choices.join('\n')}`, 'special'), ...(references.length ? { references } : {}) }];
    }
    case 'if': {
      const compact = conditionalValueText(node, context);
      const stanceReferences = conditionStanceReferences(node.condition, context);
      if (compact) return [{ ...tag(compact, 'special'), ...(stanceReferences.length ? { references: stanceReferences } : {}) }];
      const children = [...node.then, ...(node.else || [])].flatMap(item => nodeTags(item, context));
      const references = [...stanceReferences, ...children.flatMap(item => [...(item.references || []), ...(item.reference ? [item.reference] : [])])];
      const thenText = node.then.flatMap(item => nodeTags(item, context)).map(item => item.text).join('，');
      const elseText = (node.else || []).flatMap(item => nodeTags(item, context)).map(item => item.text).join('，');
      return [{
        ...tag(`当${describeCondition(node.condition, context)}时，${thenText}${elseText ? `；否则，${elseText}` : ''}`, 'special'),
        ...(references.length ? { references } : {}),
      }];
    }
    case 'narrate':
      return [tag(node.text, 'special')];
  }
  return [];
}

function coalesceRepeatedTags(tags: EffectDisplayTag[]): EffectDisplayTag[] {
  const output: EffectDisplayTag[] = [];
  for (let index = 0; index < tags.length;) {
    const current = tags[index];
    let count = 1;
    while (
      index + count < tags.length && !current.text.includes('随机') &&
      tags[index + count].text === current.text &&
      tags[index + count].icon === current.icon &&
      tags[index + count].color === current.color &&
      tags[index + count].category === current.category
    ) {
      count += 1;
    }
    output.push(count > 1 ? { ...current, text: `${current.text} ×${count}` } : current);
    index += count;
  }
  return output;
}

/** Keep a compound operation and all its references inside a single display capsule. */
function combineRuleTags(tags: EffectDisplayTag[]): EffectDisplayTag[] {
  if (tags.length < 2) return tags;
  const references = tags.flatMap(item => [...(item.references || []), ...(item.reference ? [item.reference] : [])]);
  return [{ ...tags[0], text: tags.map(item => item.text).join('；'), ...(references.length ? { references } : {}) }];
}

/** Shared card-attachment wording for hand, pile, selection and detail surfaces. */
export function cardAttachmentsToDisplayTags(
  attachments: readonly CardAttachment[] | undefined,
): EffectDisplayTag[] {
  const tags: EffectDisplayTag[] = [];
  const operators = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为' } as const;
  const stats = { damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const;
  const keywords = { retain: '保留', exhaust: '消耗', ethereal: '虚无', innate: '固有', sly: '灵巧' } as const;
  const timings = { on_draw: '抽到时', while_in_hand: '留在手牌时', on_play: '打出时' } as const;
  for (const attachment of attachments || []) {
    const attachmentTags: EffectDisplayTag[] = [];
    const source = attachment.source.name || attachment.source.id;
    attachmentTags.push(tag(
      `${attachment.kind === 'enchantment' ? '附魔' : '负面附着'}“${attachment.name}”｜来源：${source}｜${describeCardAttachmentRemaining(attachment)}`,
      attachment.kind === 'enchantment' ? 'buff' : 'debuff',
    ));
    for (const change of attachment.changes) {
      if (change.kind === 'numeric') {
        attachmentTags.push(tag(`${stats[change.stat]}${operators[change.operator]}${change.value}`, 'card'));
      } else if (change.kind === 'cost' || change.kind === 'x_value') {
        attachmentTags.push(tag(`${change.kind === 'cost' ? '费用' : 'X值'}${operators[change.operator]}${change.value}`, 'energy'));
      } else if (change.kind === 'keyword') {
        attachmentTags.push(tag(`${change.enabled ? '获得' : '移除'}“${keywords[change.keyword]}”`, 'card'));
      } else if (change.kind === 'replay') {
        attachmentTags.push(tag(`额外完整结算${change.extra}次`, 'card'));
      } else if (change.kind === 'dynamic_cost') {
        attachmentTags.push(tag(`${timings[change.timing]}费用${operators[change.operator]}${typeof change.value === 'number' ? change.value : '公式值'}`, 'energy'));
      } else if (change.kind === 'play_access') {
        attachmentTags.push(tag(change.mode === 'deny' ? '不可主动打出' : '允许主动打出', 'card'));
      } else {
        const reasonNames: Partial<Record<import('./battleEventJournal').CardMoveReason, string>> = {
          player_choice: '主动选择', random_effect: '随机效果', effect: '战斗效果',
        };
        const reasons = change.reasons.map(reason => reasonNames[reason] || reason).join('、');
        attachmentTags.push(tag(`因${reasons}从手牌弃掉时免费自动打出；失败去向：${describeCardDestination(change.failureDestination)}`, 'card'));
      }
    }
    tags.push(...combineRuleTags(attachmentTags));
  }
  return tags;
}

export function effectProgramToDisplayTags(
  program?: EffectProgram | null,
  context: EffectDisplayContext = {},
): EffectDisplayTag[] {
  const steps = program?.steps || [];
  const groups = coalesceRepeatedTags(summonModifierDisplayGroups(steps, 'program').flatMap(group => {
    if (group.length > 1) {
      const tags = group.flatMap(node => nodeTags(node, context));
      return combineRuleTags(tags).map(item => ({ ...item, text: joinSummonModifierDescriptions(tags.map(tag => tag.text)) }));
    }
    const node = group[0];
    // Expanded summon detail panels retain their individual rows; card faces collapse the summon to a link.
    const tags = nodeTags(node, context);
    return node.op === 'spawn_summon' && !context.collapseSummons ? tags : combineRuleTags(tags);
  }));
  const usesDiscardCount = (value: unknown): boolean => value !== null && typeof value === 'object'
    && (('op' in value && value.op === 'discard_count') || Object.values(value).some(usesDiscardCount));
  return usesDiscardCount(steps) ? combineRuleTags(groups) : groups;
}

export function triggeredEffectProgramToDisplayTags(
  trigger: string,
  program?: EffectProgram | null,
  context: EffectDisplayContext = {},
  eventQuery?: EventTriggerQuery,
): EffectDisplayTag[] {
  const tags = effectProgramToDisplayTags(program, context);
  if (tags.length === 0) return [];
  const style = TRIGGER_STYLE[trigger];
  return tags.map(item => ({
      ...item,
      text: `${style?.name || trigger}${describeEventTriggerQuery(eventQuery, context)}：${item.text}`,
    }));
}

export function compactContentToDisplayTags(value: unknown, context: EffectDisplayContext = {}): EffectDisplayTag[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const content = value as Record<string, unknown>;
  const trigger = resolveTriggerInput(content);
  const compileTags = (effects: unknown, triggeredBy?: string, inheritRootWhen = true): EffectDisplayTag[] => {
    if (effects === undefined || effects === null) return [];
    const compiled = compileCompactEffectList(effects, {
      creates: content.creates,
      when: inheritRootWhen ? content.when : undefined,
      statusNames: context.statusNames,
    });
    if (!compiled.ok) return [];
    return triggeredBy
      ? triggeredEffectProgramToDisplayTags(triggeredBy, compiled.value, context, trigger.eventQuery)
      : effectProgramToDisplayTags(compiled.value, context);
  };
  const discardTags = compileTags(content.discard_effects, undefined, false).map(entry => ({
    ...entry,
    text: `此牌被战斗效果弃掉后：${entry.text}`,
    icon: '🗑️',
    color: '#4b5563',
    category: 'special' as const,
  }));
  const protection = normalizeDamageProtectionRule(content.protection);
  const protectionTags = protection ? [tag(damageProtectionRuleDescription(protection, {
    resolveTargetName: targetId => context.enemyNames?.[targetId],
  }), 'special')] : [];
  const defense = normalizeStatusDefenseRule(content.defense);
  const defenseTags = defense ? statusDefenseRuleDescription(defense).map(text => tag(text, 'special')) : [];
  const acquisition = content.on_acquire ?? content.onAcquire;
  const acquireText = acquisition === undefined ? '' : describeNonCombatSettlement(acquisition, context);
  const acquireTags = acquireText ? [{ ...tag(`获得时：${acquireText}`, 'special'), references: nonCombatSettlementReferences(acquisition,
    item => compactContentToDisplayTags(item, context).map(entry => entry.text).join('；')) }] : [];
  if (trigger.structured) {
    return [
      ...cardRequirementDisplayTags(content.requires_summon, context),
      ...compileTags(trigger.immediateEffects),
      ...compileTags(
        trigger.triggeredEffects,
        typeof trigger.trigger === 'string' ? trigger.trigger : undefined,
        false,
      ),
      ...discardTags,
      ...protectionTags,
      ...defenseTags,
      ...acquireTags,
    ];
  }
  return [
    ...cardRequirementDisplayTags(content.requires_summon, context),
    ...compileTags(content.effects, typeof trigger.trigger === 'string' ? trigger.trigger : undefined),
    ...discardTags,
    ...protectionTags,
    ...defenseTags,
    ...acquireTags,
  ];
}

export function summarizeEffectProgram(program: EffectProgram): EffectProgramSummary {
  const analysis = analyzeEffectProgram(program);
  if (!analysis) return { type: 'special' };
  const damage = analysis.damage > 0 ? analysis.damage : undefined;
  const lustDamage = analysis.lust > 0 ? analysis.lust : undefined;
  const block = analysis.metrics.defense > 0 ? analysis.metrics.defense : undefined;
  let type: EffectIntentType = 'special';
  if (damage) type = 'attack';
  else if (lustDamage) type = 'lust_attack';
  else if (block) type = 'defend';
  else if (analysis.metrics.sustain > 0) type = 'heal';
  else if (program.steps.some(node => node.op === 'apply_status' && node.target === 'opponent')) type = 'debuff';
  else if (program.steps.some(node => node.op === 'apply_status' || node.op === 'modify' || node.op === 'card_play_rule'))
    type = 'buff';
  return { type, damage, lustDamage, block };
}

export function cardRequirementDisplayTags(id: unknown, context: EffectDisplayContext = {}): EffectDisplayTag[] {
  const text = describeSummonPlayRequirement(id, context.summonNames);
  return text ? [tag(text, 'special')] : [];
}

/** Shared public trigger heading; hosts must escape HTML. */
export function battleTriggerDisplayName(trigger: string): string {
  return TRIGGER_STYLE[trigger]?.name || '触发时';
}

/** Display the executable tick boundary without conflating it with turn events or decay. */
export function statusTickTimingDisplayTag(status: { tick_timing?: 'before_action' | 'after_action' }): EffectDisplayTag {
  const after = status.tick_timing === 'after_action';
  return tag(`持有者${after ? '行动后' : '行动前'}结算 tick（省略时默认为行动前；层数仍在回合末衰减）`, 'special');
}

/** Appearance is a held-status rule, not a mutation of the saved base portrait. */
export function statusAppearanceDisplayTags(status: { character_emoji?: string }): EffectDisplayTag[] {
  return status.character_emoji ? [{ text: `持有期间人物外观变为${status.character_emoji}，移除后恢复；多个外观状态以最后获得且仍持有的状态为准`, icon: '🎭', category: 'beneficial', color: '#a78bfa' }] : [];
}
