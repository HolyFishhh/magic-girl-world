import type {
  CardSelector,
  ConditionExpression,
  EffectNode,
  EffectProgram,
  NumericExpression,
} from '../../game-core';
import { analyzeEffectProgram } from '../../game-core';
import { TRIGGER_DEFINITIONS } from '../combat/effectDefinitions';
import { escapeHtml } from '../shared/html';

export type IntentType = 'attack' | 'lust_attack' | 'defend' | 'heal' | 'buff' | 'debuff' | 'special';

export interface EffectProgramSummary {
  type: IntentType;
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

function tag(text: string, style: keyof typeof TAG_STYLE): EffectDisplayTag {
  return { text, ...TAG_STYLE[style] };
}

function describeNumber(value: NumericExpression): string {
  if (typeof value === 'number') return String(value);
  if (value.op === 'var') {
    const names: Record<string, string> = {
      spent_energy: '已消耗能量',
      current_status_stacks: '当前层数',
      current_turn: '当前回合',
      cards_played_this_turn: '本回合出牌数',
      attacks_played_this_turn: '本回合攻击牌数',
      skills_played_this_turn: '本回合技能牌数',
      'self.hp': '自身生命',
      'self.max_hp': '自身最大生命',
      'self.lust': '自身欲望',
      'self.energy': '自身能量',
      'self.block': '自身格挡',
      'opponent.hp': '对方生命',
      'opponent.max_hp': '对方最大生命',
      'opponent.lust': '对方欲望',
      'opponent.energy': '对方能量',
      'opponent.block': '对方格挡',
    };
    return names[value.path] || value.path;
  }
  if (value.op === 'negate') return `-${describeNumber(value.value)}`;
  const symbols = { add: '+', subtract: '-', multiply: '×', divide: '÷' } as const;
  return `(${describeNumber(value.left)}${symbols[value.op]}${describeNumber(value.right)})`;
}

function describeCondition(value: ConditionExpression): string {
  if (value.op === 'not') return `非(${describeCondition(value.condition)})`;
  if ('conditions' in value) {
    return value.conditions.map(describeCondition).join(value.op === 'all' ? '且' : '或');
  }
  const symbols = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' } as const;
  return `${describeNumber(value.left)}${symbols[value.relation]}${describeNumber(value.right)}`;
}

function describeSelector(selector: CardSelector): string {
  const zones = { hand: '手牌', draw: '抽牌堆', discard: '弃牌堆', all: '全部牌区' } as const;
  const picks = { random: '随机', choose: '选择', left: '最左侧', right: '最右侧', all: '全部' } as const;
  return `${zones[selector.zone]}${picks[selector.pick]}${selector.count ? `${selector.count}张` : ''}`;
}

function targetName(target: 'self' | 'opponent'): string {
  return target === 'self' ? '自身' : '对方';
}

function nodeTags(node: EffectNode): EffectDisplayTag[] {
  switch (node.op) {
    case 'damage':
      return [tag(`${targetName(node.target)}受到${describeNumber(node.amount)}点伤害`, 'attack')];
    case 'heal':
      return [tag(`${targetName(node.target)}回复${describeNumber(node.amount)}点生命`, 'heal')];
    case 'gain_block':
      return [tag(`${targetName(node.target)}获得${describeNumber(node.amount)}点格挡`, 'defend')];
    case 'gain_energy':
      return [tag(`${targetName(node.target)}获得${describeNumber(node.amount)}点能量`, 'energy')];
    case 'gain_lust':
      return [tag(`${targetName(node.target)}增加${describeNumber(node.amount)}点欲望`, 'lust')];
    case 'set_stat':
      return [tag(`${targetName(node.target)}的${node.stat}变为${describeNumber(node.value)}`, 'special')];
    case 'apply_status':
      return [tag(`${targetName(node.target)}获得${describeNumber(node.stacks)}层${node.status}`, node.target === 'self' ? 'buff' : 'debuff')];
    case 'remove_status':
      return [tag(`${targetName(node.target)}移除${node.status}`, 'special')];
    case 'draw_cards':
      return [tag(`抽${describeNumber(node.amount)}张牌`, 'card')];
    case 'scry_cards':
      return [tag(`预见${describeNumber(node.amount)}张牌`, 'card')];
    case 'discard_cards':
      return [tag(`弃掉${describeSelector(node.selector)}，至多${describeNumber(node.amount)}张`, 'card')];
    case 'exhaust_cards':
      return [tag(`消耗${describeSelector(node.selector)}，至多${describeNumber(node.amount)}张`, 'card')];
    case 'recover_cards':
      return [tag(`从${node.source}取回${describeNumber(node.amount)}张牌`, 'card')];
    case 'reduce_card_cost':
      return [tag(`${describeSelector(node.selector)}费用降低${describeNumber(node.amount)}`, 'energy')];
    case 'copy_cards':
      return [tag(`复制${describeSelector(node.selector)}`, 'card')];
    case 'double_card_effect':
      return [tag(`${describeSelector(node.selector)}效果翻倍`, 'card')];
    case 'add_card':
      return [tag(`将${node.count}张${node.card.name}加入${node.zone === 'hand' ? '手牌' : '抽牌堆'}`, 'card')];
    case 'modify': {
      const operations = { add: '+', subtract: '-', multiply: '×', divide: '÷', set: '=' } as const;
      return [tag(`${targetName(node.target)}${node.stat}${operations[node.operator]}${describeNumber(node.value)}`, node.target === 'self' ? 'buff' : 'debuff')];
    }
    case 'register_trigger': {
      const trigger = TRIGGER_DEFINITIONS[node.trigger]?.name || node.trigger;
      const details = node.effects.flatMap(nodeTags).map(entry => entry.text).join('，');
      return [tag(`${trigger}：${details}`, 'special')];
    }
    case 'if': {
      const thenText = node.then.flatMap(nodeTags).map(entry => entry.text).join('，');
      const elseText = (node.else || []).flatMap(nodeTags).map(entry => entry.text).join('，');
      return [tag(`若${describeCondition(node.condition)}：${thenText}${elseText ? `；否则：${elseText}` : ''}`, 'special')];
    }
    case 'narrate':
      return [tag(node.text, 'special')];
  }
}

export function summarizeEffectProgram(program: EffectProgram): EffectProgramSummary {
  const analysis = analyzeEffectProgram(program);
  if (!analysis) return { type: 'special' };
  const damage = analysis.damage > 0 ? analysis.damage : undefined;
  const lustDamage = analysis.lust > 0 ? analysis.lust : undefined;
  const block = analysis.metrics.defense > 0 ? analysis.metrics.defense : undefined;
  let type: IntentType = 'special';
  if (damage) type = 'attack';
  else if (lustDamage) type = 'lust_attack';
  else if (block) type = 'defend';
  else if (analysis.metrics.sustain > 0) type = 'heal';
  else if (program.steps.some(node => node.op === 'apply_status' && node.target === 'opponent')) type = 'debuff';
  else if (program.steps.some(node => node.op === 'apply_status' || node.op === 'modify')) type = 'buff';
  return { type, damage, lustDamage, block };
}

export class EffectProgramDisplay {
  private static instance: EffectProgramDisplay;

  public static getInstance(): EffectProgramDisplay {
    if (!EffectProgramDisplay.instance) EffectProgramDisplay.instance = new EffectProgramDisplay();
    return EffectProgramDisplay.instance;
  }

  public programToTags(program?: EffectProgram | null): EffectDisplayTag[] {
    return program?.steps.flatMap(nodeTags) || [];
  }

  public triggeredProgramToTags(trigger: string, program?: EffectProgram | null): EffectDisplayTag[] {
    const tags = this.programToTags(program);
    if (tags.length === 0) return [];
    const config = TRIGGER_DEFINITIONS[trigger];
    return [
      {
        text: `${config?.name || trigger}：${tags.map(entry => entry.text).join('，')}`,
        icon: config?.icon || '◆',
        color: config?.color || '#64748b',
        category: 'special',
      },
    ];
  }

  public createEffectTagsHTML(tags: EffectDisplayTag[]): string {
    return this.createTagsHTML(tags, '');
  }

  public createCompactEffectTagsHTML(tags: EffectDisplayTag[]): string {
    return this.createTagsHTML(tags, 'compact');
  }

  public createWrappedEffectTagsHTML(tags: EffectDisplayTag[]): string {
    return this.createTagsHTML(tags, 'wrapped');
  }

  private createTagsHTML(tags: EffectDisplayTag[], variant: '' | 'compact' | 'wrapped'): string {
    if (tags.length === 0) return '';
    const className = variant ? ` ${variant}` : '';
    return `<div class="effect-tags-container${className}">${tags
      .map(entry => `<span class="effect-tag${className} effect-${entry.category}" style="background:${escapeHtml(entry.color)}18;border:1px solid ${escapeHtml(entry.color)}99;color:${escapeHtml(entry.color)}">${escapeHtml(entry.icon)} ${escapeHtml(entry.text)}</span>`)
      .join('')}</div>`;
  }
}
