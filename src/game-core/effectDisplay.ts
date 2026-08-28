import { analyzeEffectProgram } from './contentAnalysis';
import { compileCompactEffectList } from './compactEffectDsl';
import type { CardSelector, ConditionExpression, EffectNode, EffectProgram, NumericExpression } from './effectDsl';
import { resolveTriggerInput } from './triggerInput';

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
  const statusPath = path.match(/^(self|opponent)\.status\.([A-Za-z0-9_]+)\.stacks$/);
  return statusPath
    ? `${statusPath[1] === 'self' ? self : opponent}${displayStatusName(statusPath[2], context)}层数`
    : '未知变量';
}

function describeNumber(value: NumericExpression, context: EffectDisplayContext): string {
  if (typeof value === 'number') return String(value);
  if (value.op === 'var') return describeVariablePath(value.path, context);
  if (value.op === 'negate') return `-${describeNumber(value.value, context)}`;
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
  const zones = { hand: '手牌', draw: '抽牌堆', discard: '弃牌堆', all: '全部牌区' } as const;
  const picks = { random: '随机', choose: '选择', left: '最左侧', right: '最右侧', all: '全部' } as const;
  return `${zones[selector.zone]}${picks[selector.pick]}${selector.count ? `${selector.count}张` : ''}`;
}

const targetName = (target: 'self' | 'opponent', context: EffectDisplayContext): string =>
  target === 'self' ? context.selfLabel || '自身' : context.opponentLabel || '敌方';
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
  })[stat] || '未知属性';

function modifierSubject(target: 'self' | 'opponent', stat: string, context: EffectDisplayContext): string {
  const owner = targetName(target, context);
  return (
    {
      damage: `${owner}造成的伤害`,
      damage_taken: `${owner}受到的伤害`,
      lust: `${owner}造成的欲望伤害`,
      lust_taken: `${owner}受到的欲望伤害`,
      heal: `${owner}的治疗量`,
      block: `${owner}获得的格挡`,
    }[stat] || `${owner}的未知属性`
  );
}

function nodeTags(node: EffectNode, context: EffectDisplayContext): EffectDisplayTag[] {
  const number = (value: NumericExpression) => describeNumber(value, context);
  switch (node.op) {
    case 'damage':
      return [tag(`对${targetName(node.target, context)}造成${number(node.amount)}点伤害`, 'attack')];
    case 'heal':
      return [tag(`${targetName(node.target, context)}回复${number(node.amount)}点生命`, 'heal')];
    case 'gain_block':
      return [tag(`${targetName(node.target, context)}获得${number(node.amount)}点格挡`, 'defend')];
    case 'gain_energy':
      return [tag(`${targetName(node.target, context)}获得${number(node.amount)}点能量`, 'energy')];
    case 'gain_lust':
      return [tag(`${targetName(node.target, context)}增加${number(node.amount)}点欲望`, 'lust')];
    case 'set_stat':
      return [tag(`将${targetName(node.target, context)}${statName(node.stat)}设为${number(node.value)}`, 'special')];
    case 'apply_status':
      return [
        tag(
          `${targetName(node.target, context)}获得${number(node.stacks)}层${displayStatusName(node.status, context)}`,
          node.target === 'self' ? 'buff' : 'debuff',
        ),
      ];
    case 'remove_status':
      return [tag(`移除${targetName(node.target, context)}的${displayStatusName(node.status, context)}`, 'special')];
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
    case 'copy_cards':
      return [tag(`复制${describeSelector(node.selector)}`, 'card')];
    case 'double_card_effect':
      return [tag(`${describeSelector(node.selector)}效果翻倍`, 'card')];
    case 'add_card':
      return [tag(`将${node.count}张${node.card.name}加入${node.zone === 'hand' ? '手牌' : '抽牌堆'}`, 'card')];
    case 'modify': {
      const operations = { add: '+', subtract: '-', multiply: '×', divide: '÷', set: '=' } as const;
      return [
        tag(
          `${modifierSubject(node.target, node.stat, context)}${operations[node.operator]}${number(node.value)}`,
          node.target === 'self' ? 'buff' : 'debuff',
        ),
      ];
    }
    case 'register_trigger': {
      const details = node.effects
        .flatMap(item => nodeTags(item, context))
        .map(item => item.text)
        .join('，');
      return [tag(`${TRIGGER_STYLE[node.trigger]?.name || node.trigger}：${details}`, 'special')];
    }
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
  else if (program.steps.some(node => node.op === 'apply_status' || node.op === 'modify')) type = 'buff';
  return { type, damage, lustDamage, block };
}
