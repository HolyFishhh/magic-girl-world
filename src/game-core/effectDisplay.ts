import { analyzeEffectProgram } from './contentAnalysis';
import { compileCompactEffectList } from './compactEffectDsl';
import type { CardSelector, ConditionExpression, EffectNode, EffectProgram, NumericExpression } from './effectDsl';
import type { EnemyTargetSelector } from './combatantCollection';
import { resolveTriggerInput } from './triggerInput';
import { describeCardAttachmentRemaining, type CardAttachment } from './cardAttachment';
import { describeCardCost } from './combatResource';
import type { SummonSelector } from './summonUnit';

export type EffectIntentType = 'attack' | 'lust_attack' | 'defend' | 'heal' | 'buff' | 'debuff' | 'special';

export interface EffectProgramSummary {
  type: EffectIntentType;
  damage?: number;
  lustDamage?: number;
  block?: number;
}

export interface EffectDisplayTag {
  text: string;
  icon: string;
  color: string;
  category: 'beneficial' | 'harmful' | 'neutral' | 'utility' | 'special';
}

export interface EffectDisplayContext {
  statusNames?: Readonly<Record<string, string>>;
  resourceNames?: Readonly<Record<string, string>>;
  resolveStatusName?: (statusId: string) => string | undefined;
  selfLabel?: string;
  opponentLabel?: string;
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
  ability_gain: { name: '获得能力时', icon: '🎯', color: '#7c3aed' },
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
  defeated: { name: '被击败时', icon: '💀', color: '#991b1b' },
  gain_buff: { name: '获得增益时', icon: '✨', color: '#059669' },
  gain_debuff: { name: '获得减益时', icon: '🌫️', color: '#dc2626' },
  lose_buff: { name: '失去增益时', icon: '💨', color: '#4b5563' },
  lose_debuff: { name: '失去减益时', icon: '🌈', color: '#7c3aed' },
  enemy_gain_buff: { name: '敌方获得增益时', icon: '✨', color: '#d97706' },
  enemy_gain_debuff: { name: '敌方获得减益时', icon: '🌫️', color: '#65a30d' },
  enemy_lose_buff: { name: '敌方失去增益时', icon: '💨', color: '#0891b2' },
  enemy_lose_debuff: { name: '敌方失去减益时', icon: '🌈', color: '#c026d3' },
  apply: { name: '施加时', icon: '✨', color: '#059669' },
  stack: { name: '叠加时', icon: '📚', color: '#0891b2' },
  tick: { name: '每回合', icon: '⏱️', color: '#2563eb' },
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
    'context.x_value': 'X值',
    'context.status_stacks': '当前状态层数',
    'battle.turn_number': '当前回合数',
    'battle.cards_played_this_turn': '本回合出牌数',
    'battle.attacks_played_this_turn': '本回合攻击牌数',
    'battle.skills_played_this_turn': '本回合技能牌数',
    'self.hand_size': '手牌数',
    'self.draw_pile_size': '抽牌堆数量',
    'self.discard_pile_size': '弃牌堆数量',
    'self.exhaust_pile_size': '消耗堆数量',
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
  const xResource = path.match(/^context\.x_resource\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (xResource) return `${context.resourceNames?.[xResource[1]] || xResource[1]}的X值`;
  const entityResource = path.match(/^(self|opponent)\.resource\.([A-Za-z_][A-Za-z0-9_]*)\.(current|max)$/);
  if (entityResource) {
    const owner = entityResource[1] === 'self' ? self : opponent;
    const resource = context.resourceNames?.[entityResource[2]] || entityResource[2];
    return `${owner}${resource}${entityResource[3] === 'max' ? '上限' : '数量'}`;
  }
  const statusPath = path.match(/^(self|opponent)\.status\.([A-Za-z0-9_]+)\.stacks$/);
  return statusPath
    ? `${statusPath[1] === 'self' ? self : opponent}${displayStatusName(statusPath[2], context)}层数`
    : '未知变量';
}

function describeNumber(value: NumericExpression, context: EffectDisplayContext): string {
  if (typeof value === 'number') return String(value);
  if (value.op === 'var') return describeVariablePath(value.path, context);
  if (value.op === 'negate') return `-${describeNumber(value.value, context)}`;
  if (value.op === 'floor') return `向下取整(${describeNumber(value.value, context)})`;
  if (value.op === 'ceil') return `向上取整(${describeNumber(value.value, context)})`;
  if (value.op === 'abs') return `绝对值(${describeNumber(value.value, context)})`;
  if (value.op === 'clamp_min') return `不低于${value.minimum}的${describeNumber(value.value, context)}`;
  if (value.op === 'min' || value.op === 'max') return `${value.op === 'min' ? '最小值' : '最大值'}(${value.values.map(item => describeNumber(item, context)).join('、')})`;
  if (value.op === 'count_cards') return `${describeSelector(value.selector)}数量`;
  if (value.op === 'count_statuses') return `${targetName(value.target, context)}状态数量`;
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
  if (value.op === 'divide' && value.right === 2) return `${describeNumber(value.left, context)}的一半`;
  if (value.op === 'multiply' && value.right === 0.5) return `${describeNumber(value.left, context)}的一半`;
  if (value.op === 'multiply' && value.left === 0.5) return `${describeNumber(value.right, context)}的一半`;
  const symbols = { add: '+', subtract: '-', multiply: '×', divide: '÷' } as const;
  return `(${describeNumber(value.left, context)}${symbols[value.op]}${describeNumber(value.right, context)})`;
}

function describeCondition(value: ConditionExpression, context: EffectDisplayContext): string {
  if (value.op === 'not') return `不满足“${describeCondition(value.condition, context)}”`;
  if ('conditions' in value)
    return value.conditions
      .map(item => `“${describeCondition(item, context)}”`)
      .join(value.op === 'all' ? '并且' : '或者');
  if (value.op === 'last_card_type') return `上一张打出的牌为${value.cardType}`;
  if (value.op === 'intent_type') return `敌方意图为${value.intentType}`;
  const relations = { eq: '等于', neq: '不等于', gt: '高于', gte: '不低于', lt: '低于', lte: '不高于' } as const;
  const left = describeNumber(value.left, context);
  const right = describeNumber(value.right, context);
  if (left === '使用能量' && right === '0') {
    if (value.relation === 'eq' || value.relation === 'lte') return '没有使用能量';
    if (value.relation === 'gt' || value.relation === 'neq') return '使用了能量';
  }
  return `${left}${relations[value.relation]}${right}`;
}

function describeSelector(selector: CardSelector): string {
  const zones = {
    hand: '手牌', draw: '抽牌堆', discard: '弃牌堆', exhaust: '消耗堆',
    all: '全部常规牌区', combat: '本场战斗全部牌区',
  } as const;
  const picks = { random: '随机', choose: '选择', left: '最左侧', right: '最右侧', top: '顶部', bottom: '底部', all: '全部' } as const;
  const filter = selector.filter;
  const constraints: string[] = [];
  if (filter?.name) constraints.push(`名称:${filter.name}`);
  if (filter?.types?.length) constraints.push(filter.types.join('/'));
  if (filter?.rarities?.length) constraints.push(filter.rarities.join('/'));
  if (filter?.cost !== undefined) constraints.push(`${describeCardCost(filter.cost)}费`);
  if (filter?.minCost !== undefined) constraints.push(`至少${filter.minCost}费`);
  if (filter?.maxCost !== undefined) constraints.push(`至多${filter.maxCost}费`);
  if (filter?.tags?.length) constraints.push(`标签:${filter.tags.join('+')}`);
  if (filter?.templateId) constraints.push(`模板:${filter.templateId}`);
  if (filter?.runInstanceId) constraints.push('指定整局实例');
  if (filter?.combatInstanceId) constraints.push('指定战斗实例');
  if (filter?.origin) constraints.push(`来源:${filter.origin}`);
  if (filter?.upgraded !== undefined) constraints.push(filter.upgraded ? '已升级' : '未升级');
  return `${zones[selector.zone]}中${constraints.length ? `符合“${constraints.join('、')}”的` : ''}${picks[selector.pick]}${selector.count ? `${selector.count}张` : ''}`;
}

function describeSummonSelector(selector: SummonSelector): string {
  const owner = selector.owner === 'self' ? '我方'
    : selector.owner === 'opponent' ? '敌方' : '任意阵营';
  const picks: Record<SummonSelector['pick'], string> = {
    left: '最左侧、最早入场的',
    right: '最右侧、最晚入场的',
    choose: '手动选择的',
    first: '最早入场的',
    last: '最后入场的',
    random: '随机',
    random_n: '随机',
    all: '全部',
    lowest_hp: '生命比例最低的',
    highest_hp: '生命比例最高的',
    by_id: '指定的',
  };
  const filters = [
    selector.templateId ? `类型为${selector.templateId}` : '',
    selector.slot ? `位于${selector.slot}槽位` : '',
    selector.tags?.length ? `具有${selector.tags.join('、')}标签` : '',
  ].filter(Boolean);
  const amount = selector.pick === 'all' ? '' : `${selector.count || 1}个`;
  return `${owner}${filters.length ? `${filters.join('且')}的` : ''}${picks[selector.pick]}${amount}召唤单位`;
}

const targetName = (
  target: 'self' | 'opponent',
  context: EffectDisplayContext,
  selector?: EnemyTargetSelector,
): string => {
  if (target === 'self') return context.selfLabel || '自身';
  if (!selector || selector.mode === 'active') return context.opponentLabel || '敌方';
  if (selector.mode === 'all') return '所有敌方';
  if (selector.mode === 'random') return '随机敌方';
  if (selector.mode === 'random_n') return `随机敌方（${selector.count}次${selector.allowRepeat ? '，可重复' : ''}）`;
  if (selector.mode === 'lowest_hp') return '生命最低的敌方';
  if (selector.mode === 'highest_hp') return '生命最高的敌方';
  return '指定敌方';
};
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
    }[stat] || `${owner}的未知属性`
  );
}

function nodeTags(node: EffectNode, context: EffectDisplayContext): EffectDisplayTag[] {
  const number = (value: NumericExpression) => describeNumber(value, context);
  switch (node.op) {
    case 'damage': {
      const target = targetName(node.target, context, node.targetSelector);
      const prefix = node.damageKind === 'hp_loss'
        ? `使${target}失去${number(node.amount)}点生命`
        : node.damageKind === 'retaliation'
          ? `对${target}造成${number(node.amount)}点反伤`
          : node.damageKind === 'damage_over_time'
            ? `对${target}造成${number(node.amount)}点持续伤害`
            : `对${target}造成${number(node.amount)}点伤害`;
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
      return [tag(`${targetName(node.target, context, node.targetSelector)}获得${number(node.amount)}点格挡`, 'defend')];
    case 'gain_energy':
      return [tag(`${targetName(node.target, context, node.targetSelector)}获得${number(node.amount)}点能量`, 'energy')];
    case 'gain_resource':
      return [tag(`${targetName(node.target, context, node.targetSelector)}获得${number(node.amount)}点${context.resourceNames?.[node.resource] || node.resource}`, 'energy')];
    case 'set_resource':
      return [tag(`将${targetName(node.target, context, node.targetSelector)}的${context.resourceNames?.[node.resource] || node.resource}设为${number(node.value)}`, 'energy')];
    case 'gain_lust':
      return [tag(`${targetName(node.target, context, node.targetSelector)}增加${number(node.amount)}点欲望`, 'lust')];
    case 'set_stat':
      return [tag(`将${targetName(node.target, context, node.targetSelector)}${statName(node.stat)}设为${number(node.value)}`, 'special')];
    case 'apply_status':
      return [
        tag(
          `${targetName(node.target, context, node.targetSelector)}获得${number(node.stacks)}层${displayStatusName(node.status, context)}`,
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
      return [tag(`弃掉${describeSelector(node.selector)}，至多${number(node.amount)}张`, 'card')];
    case 'exhaust_cards':
      return [tag(`消耗${describeSelector(node.selector)}，至多${number(node.amount)}张`, 'card')];
    case 'recover_cards':
      return [
        tag(
          `从${{ draw: '抽牌堆', discard: '弃牌堆', exhaust: '消耗堆' }[node.source]}取回${number(node.amount)}张牌`,
          'card',
        ),
      ];
    case 'reduce_card_cost':
      return [tag(`${describeSelector(node.selector)}费用降低${number(node.amount)}`, 'energy')];
    case 'modify_card_value': {
      const stats = { damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const;
      const operations = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以' } as const;
      return [
        tag(
          `${describeSelector(node.selector)}的${stats[node.stat]}${operations[node.operator]}${number(node.value)}`,
          'card',
        ),
      ];
    }
    case 'copy_cards':
      return [tag(`复制${describeSelector(node.selector)}`, 'card')];
    case 'double_card_effect':
      return [tag(`${describeSelector(node.selector)}效果翻倍`, 'card')];
    case 'auto_play_cards':
      return [tag(`自动${node.free ? '免费' : ''}打出${describeSelector(node.selector)}`, 'card')];
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
      return [tag(`将${describeSelector(node.selector)}移至${zones[node.destination]}${node.position === 'top' ? '顶部' : '底部'}`, 'card')];
    }
    case 'remove_cards':
      return [tag(`从本场战斗移除${describeSelector(node.selector)}`, 'card')];
    case 'transform_cards':
      return [tag(`将${describeSelector(node.selector)}变形为${node.replacement.name}`, 'card')];
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
        const keywords = { retain: '保留', exhaust: '消耗', ethereal: '空灵', innate: '固有' } as const;
        return [tag(`${describeSelector(node.selector)}${scope}${node.patch.enabled ? '获得' : '移除'}“${keywords[node.patch.keyword]}”`, 'card')];
      }
      if (node.patch.kind === 'replay') {
        return [tag(`${describeSelector(node.selector)}${scope}额外结算${number(node.patch.extra)}次`, 'card')];
      }
      if (node.patch.kind === 'x_value') {
        const operators = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为' } as const;
        return [tag(`${describeSelector(node.selector)}${scope}X值${operators[node.patch.operator]}${number(node.patch.value)}`, 'card')];
      }
      if (node.patch.kind === 'dynamic_cost') {
        const timings = { on_draw: '抽到时', while_in_hand: '留在手牌时', on_play: '打出时' } as const;
        const operators = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为' } as const;
        return [tag(`${describeSelector(node.selector)}${scope}${timings[node.patch.timing]}费用${operators[node.patch.operator]}${number(node.patch.value)}`, 'card')];
      }
      const operators = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为' } as const;
      const subject = node.patch.kind === 'cost'
        ? '费用'
        : ({ damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const)[node.patch.stat];
      return [tag(`${describeSelector(node.selector)}${scope}${subject}${operators[node.patch.operator]}${number(node.patch.value)}`, 'card')];
    }
    case 'apply_card_attachment': {
      const attachment = node.attachment;
      const kind = attachment.kind === 'enchantment' ? '附魔' : '负面附着';
      const removal = {
        played: '打出后移除',
        discarded: '符合弃牌原因后移除',
        turn_end: '回合结束移除',
        combat_end: '持续本场战斗',
        run_end: '持续本次流程',
        manual: '持续存在',
      } as const;
      const defaultRemoval = {
        resolution: 'played', turn: 'turn_end', until_played: 'played',
        combat: 'combat_end', run: 'run_end', permanent: 'manual',
      } as const;
      const removeOn = attachment.removeOn || defaultRemoval[attachment.scope];
      const result = [tag(
        `${describeSelector(node.selector)}获得${kind}“${attachment.name}”（${removal[removeOn]}${attachment.remaining && attachment.remaining > 1 ? `，剩余${attachment.remaining}次` : ''}）`,
        attachment.kind === 'enchantment' ? 'buff' : 'debuff',
      )];
      for (const change of attachment.changes) {
        if (change.kind === 'play_access') {
          result.push(tag(change.mode === 'deny' ? '此牌不可主动打出' : '此牌允许主动打出', 'card'));
        } else if (change.kind === 'discard_auto_play') {
          result.push(tag(`在指定弃牌原因下免费自动打出；失败后移至${change.failureDestination}`, 'card'));
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
    case 'upgrade_cards':
      return [tag(`升级${describeSelector(node.selector)}${node.levels}级`, 'card')];
    case 'add_card':
      return [tag(`将${node.count}张${node.card.name}加入${node.zone === 'hand' ? '手牌' : '抽牌堆'}`, 'card')];
    case 'ensure_card':
      return [tag(
        `本场战斗中确保至少有${number(node.minimum)}张${node.card.name}${node.includeCopies ? '（计入临时复制牌）' : ''}`,
        'card',
      )];
    case 'spawn_summon': {
      const action = node.summon.actionProgram?.steps
        .flatMap(item => nodeTags(item, context)).map(item => item.text).join('；');
      return [tag(
        `${targetName(node.target, context)}召唤${number(node.count)}个「${node.summon.name}」${action ? `（行动：${action}）` : ''}`,
        'special',
      )];
    }
    case 'spawn_enemy':
      return [tag(
        `敌方增援${number(node.count)}个「${node.enemy.name}」${node.capacity ? `（场上敌人上限 ${node.capacity}）` : ''}`,
        'special',
      )];
    case 'damage_summons':
      return [tag(`对${describeSummonSelector(node.selector)}造成${number(node.amount)}点伤害`, 'attack')];
    case 'heal_summons':
      return [tag(`使${describeSummonSelector(node.selector)}恢复${number(node.amount)}点生命`, 'heal')];
    case 'modify_summons': {
      const stats = {
        max_hp: '最大生命', block: '格挡', actions_per_activation: '每次行动次数',
        speed: '速度', action_priority: '行动优先级',
      } as const;
      const operations = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为' } as const;
      return [tag(
        `${describeSummonSelector(node.selector)}的${stats[node.stat]}${operations[node.operator]}${number(node.value)}`,
        'special',
      )];
    }
    case 'modify_summon_effects': {
      const stats = { damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const;
      const operations = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以' } as const;
      return [tag(
        `${describeSummonSelector(node.selector)}的行动与能力${stats[node.stat]}${operations[node.operator]}${number(node.value)}（固定效果除外）`,
        'special',
      )];
    }
    case 'gain_summon_resource':
      return [tag(
        `${describeSummonSelector(node.selector)}获得${number(node.amount)}点${context.resourceNames?.[node.resource] || node.resource}`,
        'energy',
      )];
    case 'set_summon_resource':
      return [tag(
        `将${describeSummonSelector(node.selector)}的${context.resourceNames?.[node.resource] || node.resource}设为${number(node.value)}`,
        'energy',
      )];
    case 'apply_summon_status':
      return [tag(
        `${describeSummonSelector(node.selector)}获得${number(node.stacks)}层${displayStatusName(node.status, context)}`,
        'buff',
      )];
    case 'remove_summon_status':
      return [tag(
        `移除${describeSummonSelector(node.selector)}的${displayStatusName(node.status, context)}`,
        'special',
      )];
    case 'activate_summons':
      return [tag(`立即激活${describeSummonSelector(node.selector)}`, 'special')];
    case 'dismiss_summons':
      return [tag(
        `遣散${describeSummonSelector(node.selector)}${node.retainCorpse ? '并保留其倒下记录' : ''}`,
        'special',
      )];
    case 'copy_summons': {
      const owner = node.targetOwner === 'same' ? '原阵营'
        : node.targetOwner === 'self' ? '我方' : '敌方';
      return [tag(`复制${describeSummonSelector(node.selector)}到${owner}`, 'special')];
    }
    case 'summoner_effects': {
      const details = node.effects
        .flatMap(item => nodeTags(item, { ...context, selfLabel: '召唤者' }))
        .map(item => item.text)
        .join('，');
      return [tag(`作用于召唤者：${details}`, 'special')];
    }
    case 'modify': {
      const operations = { add: '+', subtract: '-', multiply: '×', divide: '÷', set: '=' } as const;
      return [
        tag(
          `${modifierSubject(node.target, node.stat, context, node.targetSelector)}${operations[node.operator]}${number(node.value)}`,
          node.target === 'self' ? 'buff' : 'debuff',
        ),
      ];
    }
    case 'card_play_rule': {
      const scope = node.limit === 'all' ? '所有牌' : node.limit !== undefined ? `前${number(node.limit)}张牌` : '卡牌';
      const selected = node.selector ? describeSelector(node.selector) : '卡牌';
      const labels: Record<string, string> = {
        retain_hand: '回合结束时保留全部手牌',
        retain_block: '回合开始时保留格挡',
        limit_draw: `每次至多抽${node.limit === 'all' ? '任意' : number(node.limit ?? 0)}张牌`,
        limit_block_gain: `每次至多获得${node.limit === 'all' ? '任意' : number(node.limit ?? 0)}点格挡`,
        limit_energy_gain: `每次至多获得${node.limit === 'all' ? '任意' : number(node.limit ?? 0)}点能量`,
        deny_card_play: `禁止打出${selected}`,
        allow_card_play: `允许打出${selected}，即使其通常不可打出`,
        limit_card_play: `每回合至多打出${node.limit === 'all' ? '任意数量的' : number(node.limit ?? 0)}${selected}`,
        card_destination: `${selected}结算后改为移至${node.destination || '指定区域'}`,
      };
      return [
        tag(
          node.rule === 'free'
            ? `每回合${scope}不消耗${node.freeResources === 'all' || !node.freeResources ? '任何资源' : node.freeResources.join('、')}`
            : node.rule === 'replay'
              ? `每回合${scope}额外结算${number(node.extra ?? 1)}次`
              : labels[node.rule] || node.rule,
          'special',
        ),
      ];
    }
    case 'set_stance': {
      if (!node.stance) return [tag(`${targetName(node.target, context, node.targetSelector)}退出当前姿态`, 'special')];
      const passive = (node.stance.passiveEffects || [])
        .flatMap(item => nodeTags(item, context)).map(item => item.text).join('；');
      return [tag(
        `${targetName(node.target, context, node.targetSelector)}进入姿态「${node.stance.name}」${passive ? `（持续：${passive}）` : ''}`,
        'special',
      )];
    }
    case 'channel_orb': {
      const passive = (node.orb.passiveEffects || []).flatMap(item => nodeTags(item, context)).map(item => item.text).join('；');
      const evoke = (node.orb.evokeEffects || []).flatMap(item => nodeTags(item, context)).map(item => item.text).join('；');
      return [tag(
        `${targetName(node.target, context, node.targetSelector)}充能 Orb「${node.orb.name}」（数值 ${number(node.orb.value)}${passive ? `；被动：${passive}` : ''}${evoke ? `；激发：${evoke}` : ''}）`,
        'special',
      )];
    }
    case 'evoke_orbs': {
      const position = node.selector.pick === 'all' ? '全部' : node.selector.pick === 'last' ? '末尾' : '最前';
      return [tag(
        `${targetName(node.target, context, node.targetSelector)}激发${position}${node.selector.pick === 'all' ? '' : `${node.selector.count || 1}个`} Orb${node.selector.id ? `（类型 ${node.selector.id}）` : ''}`,
        'special',
      )];
    }
    case 'set_orb_slots':
      return [tag(`将${targetName(node.target, context, node.targetSelector)}的 Orb 槽位设为 ${number(node.amount)}`, 'special')];
    case 'modify_orbs': {
      const operations = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以' } as const;
      const position = node.selector.pick === 'all' ? '全部' : node.selector.pick === 'last' ? '末尾' : '最前';
      return [tag(
        `${targetName(node.target, context, node.targetSelector)}${position} Orb 的数值${operations[node.operator]}${number(node.value)}`,
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
      return [tag(`${TRIGGER_STYLE[node.trigger]?.name || node.trigger}：${details}`, 'special')];
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
    case 'choose_one':
      return [tag(`从${node.options.map(option => option.label).join('、')}中选择一项`, 'special')];
    case 'if': {
      const thenText = node.then
        .flatMap(item => nodeTags(item, context))
        .map(item => item.text)
        .join('，');
      const elseText = (node.else || [])
        .flatMap(item => nodeTags(item, context))
        .map(item => item.text)
        .join('，');
      return [
        tag(
          `当${describeCondition(node.condition, context)}时，${thenText}${elseText ? `；否则，${elseText}` : ''}`,
          'special',
        ),
      ];
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
      index + count < tags.length &&
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

/** Shared card-attachment wording for hand, pile, selection and detail surfaces. */
export function cardAttachmentsToDisplayTags(
  attachments: readonly CardAttachment[] | undefined,
): EffectDisplayTag[] {
  const tags: EffectDisplayTag[] = [];
  const operators = { add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为' } as const;
  const stats = { damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数' } as const;
  const keywords = { retain: '保留', exhaust: '消耗', ethereal: '空灵', innate: '固有' } as const;
  const timings = { on_draw: '抽到时', while_in_hand: '留在手牌时', on_play: '打出时' } as const;
  for (const attachment of attachments || []) {
    const source = attachment.source.name || attachment.source.id;
    tags.push(tag(
      `${attachment.kind === 'enchantment' ? '附魔' : '负面附着'}“${attachment.name}”｜来源：${source}｜${describeCardAttachmentRemaining(attachment)}`,
      attachment.kind === 'enchantment' ? 'buff' : 'debuff',
    ));
    for (const change of attachment.changes) {
      if (change.kind === 'numeric') {
        tags.push(tag(`${stats[change.stat]}${operators[change.operator]}${change.value}`, 'card'));
      } else if (change.kind === 'cost' || change.kind === 'x_value') {
        tags.push(tag(`${change.kind === 'cost' ? '费用' : 'X值'}${operators[change.operator]}${change.value}`, 'energy'));
      } else if (change.kind === 'keyword') {
        tags.push(tag(`${change.enabled ? '获得' : '移除'}“${keywords[change.keyword]}”`, 'card'));
      } else if (change.kind === 'replay') {
        tags.push(tag(`额外完整结算${change.extra}次`, 'card'));
      } else if (change.kind === 'dynamic_cost') {
        tags.push(tag(`${timings[change.timing]}费用${operators[change.operator]}${typeof change.value === 'number' ? change.value : '公式值'}`, 'energy'));
      } else if (change.kind === 'play_access') {
        tags.push(tag(change.mode === 'deny' ? '不可主动打出' : '允许主动打出', 'card'));
      } else {
        const reasonNames: Partial<Record<import('./battleEventJournal').CardMoveReason, string>> = {
          player_choice: '主动选择', random_effect: '随机效果', effect: '战斗效果',
        };
        const reasons = change.reasons.map(reason => reasonNames[reason] || reason).join('、');
        tags.push(tag(`因${reasons}从手牌弃掉时免费自动打出；失败去向：${change.failureDestination}`, 'card'));
      }
    }
  }
  return tags;
}

export function effectProgramToDisplayTags(
  program?: EffectProgram | null,
  context: EffectDisplayContext = {},
): EffectDisplayTag[] {
  return coalesceRepeatedTags(program?.steps.flatMap(node => nodeTags(node, context)) || []);
}

export function triggeredEffectProgramToDisplayTags(
  trigger: string,
  program?: EffectProgram | null,
  context: EffectDisplayContext = {},
): EffectDisplayTag[] {
  const tags = effectProgramToDisplayTags(program, context);
  if (tags.length === 0) return [];
  const style = TRIGGER_STYLE[trigger];
  return [
    {
      text: `${style?.name || trigger}：${tags.map(item => item.text).join('，')}`,
      icon: style?.icon || '◆',
      color: style?.color || '#64748b',
      category: 'special',
    },
  ];
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
      ? triggeredEffectProgramToDisplayTags(triggeredBy, compiled.value, context)
      : effectProgramToDisplayTags(compiled.value, context);
  };
  const discardTags = compileTags(content.discard_effects, undefined, false).map(entry => ({
    ...entry,
    text: `此牌被战斗效果弃掉后：${entry.text}`,
    icon: '🗑️',
    color: '#4b5563',
    category: 'special' as const,
  }));
  if (trigger.structured) {
    return [
      ...compileTags(trigger.immediateEffects),
      ...compileTags(
        trigger.triggeredEffects,
        typeof trigger.trigger === 'string' ? trigger.trigger : undefined,
        false,
      ),
      ...discardTags,
    ];
  }
  return [
    ...compileTags(content.effects, typeof trigger.trigger === 'string' ? trigger.trigger : undefined),
    ...discardTags,
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
