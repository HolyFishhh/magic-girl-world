export { describeOpeningDeckTransforms } from './towerOpeningTransforms';
import { describeInterceptions } from './interception';
import { describeCardPayment } from './cardPayment';
import { describeStatusAction, type StatusActionSpec } from './statusAction';
import { describeEffectTarget } from './effectTargetDisplay';
import type { EnemyTargetSelector } from './combatantCollection';
import { describeSummonPlayRequirement } from './summonPlayRequirementDisplay';
import { describeResourceHalf } from './resourceAssignmentDisplay';
import { describeCardTraits, type LifecycleCard } from './cardLifecycle';
import { summonModifierDisplayGroups, joinSummonModifierDescriptions } from './summonModifierDisplayGrouping';
import {
  COMPACT_EFFECT_BUNDLE_OPERATION_SET,
  compactEffectOperationKeys,
  normalizeCompactEffectEntries,
  projectCompactOperation,
  sortCompactBundleOperations,
} from './compactEffectContract';
import { resolveTriggerInput, resolveEventTriggerQueryInput } from './triggerInput';
import { describeCardTypeCondition } from './cardConditionDisplay';
import { STATUS_EVENT_TRIGGERS } from './battleTriggers';
import type { EventTriggerQuery } from './battleEventJournal';
import { describeTriggerEventQuery } from './triggerDescription';
import { compactEffectDefaultTarget } from './compactEffectTarget';
import { collectStanceDefinitions, collectStanceNames, describeStanceFormula, describeStanceIdentity } from './stanceIdentityDisplay';
import { describeSummonSlotLifecycle } from './summonLifecycleDescription';
import { describeStatusEventIdentity } from './statusEventIdentityDisplay';
import { damageProtectionRuleDescription, normalizeDamageProtectionRule } from './damageProtection';
import { normalizeStatusDefenseRule, statusDefenseRuleDescription } from './statusDefense';
import { describeNonCombatSettlement, nonCombatSettlementReferences } from './nonCombatSettlementDisplay';
import type { ModifierStat } from './effectDsl';
import jsep from 'jsep';

export interface ContentRuleReference {
  kind?: 'resource' | 'stance';
  id: string; name: string; rules: string; flavor?: string;
  summon?: unknown; card?: unknown; stance?: unknown; stanceContext?: unknown;
  references?: ContentRuleReference[];
}

export interface CompactCardDescriptionOptions {
  inlineStatusDetails?: boolean;
  onSummonReference?: (reference: ContentRuleReference) => void;
  onCardReference?: (reference: ContentRuleReference) => void;
  onStanceReference?: (reference: ContentRuleReference) => void;
  cardDefinitions?: Readonly<Record<string, unknown>>;
  referenceTrail?: readonly string[];
  includeKeywords?: boolean;
  /** Program-owned context: status effects default to their exact holder. */
  implicitTarget?: 'self' | 'opponent';
  enemyCollectionTarget?: 'self' | 'opponent';
  statusNames?: Readonly<Record<string, string>>;
  /** Exact compiled definitions in this content's scope; display only, never inferred from prose. */
  statusDefinitions?: Readonly<Record<string, unknown>>;
  resourceNames?: Readonly<Record<string, string>>;
  resourceEmojis?: Readonly<Record<string, string>>;
  summonerResourceNames?: Readonly<Record<string, string>>;
  summonerResourceEmojis?: Readonly<Record<string, string>>;
  cardNames?: Readonly<Record<string, string>>;
  summonNames?: Readonly<Record<string, string>>;
  stanceNames?: Readonly<Record<string, string>>;
  stanceDefinitions?: Readonly<Record<string, Record<string, unknown>>>;
  enemyActionNames?: Readonly<Record<string, string>>;
  /** Stable runtime enemy ID → visible name mapping for exact protection references. */
  enemyNames?: Readonly<Record<string, string>>;
  /** Perspective for identity predicates; defaults are source-relative. */
  selfLabel?: string;
  opponentLabel?: string;
}

function stanceReference(id: string, options: CompactCardDescriptionOptions, definition?: Record<string, unknown>): ContentRuleReference | null {
  const stance = definition || options.stanceDefinitions?.[id];
  const name = (typeof stance?.name === 'string' && stance.name.trim()) || options.stanceNames?.[id];
  if (!stance || !name) return null;
  return { kind: 'stance', id, name, rules: '点击查看姿态的进入、持续、退出与触发效果。',
    flavor: typeof stance.description === 'string' ? stance.description : '', stance,
    stanceContext: {
      statusNames: options.statusNames, statusDefinitions: options.statusDefinitions,
      resourceNames: options.resourceNames, resourceEmojis: options.resourceEmojis,
      summonerResourceNames: options.summonerResourceNames, summonerResourceEmojis: options.summonerResourceEmojis,
      cardNames: options.cardNames, summonNames: options.summonNames, stanceNames: options.stanceNames,
      stanceDefinitions: options.stanceDefinitions, enemyActionNames: options.enemyActionNames,
      cardDefinitions: options.cardDefinitions,
      selfLabel: options.selfLabel, opponentLabel: options.opponentLabel,
    } };
}

function notifyStanceReference(id: string, options: CompactCardDescriptionOptions, definition?: Record<string, unknown>): void {
  const reference = stanceReference(id, options, definition);
  if (reference) (options.onStanceReference ?? options.onSummonReference)?.(reference);
}

const TRIGGER_LABELS: Record<string, string> = {
  battle_start: '战斗开始',
  passive: '持续生效',
  ability_gain: '被赋予能力',
  turn_start: '回合开始',
  turn_end: '回合结束',
  card_played: '打出卡牌',
  attack_played: '打出攻击牌',
  skill_played: '打出技能牌',
  power_played: '打出能力牌',
  on_discard: '有卡牌被弃掉',
  on_exhaust: '消耗牌',
  on_draw: '抽牌',
  on_shuffle: '洗牌',
  take_damage: '受到伤害',
  take_heal: '受到治疗',
  deal_damage: '造成伤害',
  deal_heal: '造成治疗',
  lust_increase: '自身欲望增加',
  lust_decrease: '自身欲望降低',
  deal_lust_increase: '使敌方欲望增加',
  deal_lust_decrease: '使敌方欲望降低',
  gain_buff: '被赋予增益',
  gain_debuff: '被赋予减益',
  lose_buff: '失去增益',
  lose_debuff: '失去减益',
  enemy_gain_buff: '敌方被赋予增益',
  enemy_gain_debuff: '敌方被赋予减益',
  enemy_lose_buff: '敌方失去增益',
  enemy_lose_debuff: '敌方失去减益',
  gain_block: '获得格挡',
  lose_block: '失去格挡',
  kill: '击败敌人',
  defeated: '被击败',
};

const STATUS_TRIGGER_LABELS: Record<string, string> = {
  apply: '首次被赋予',
  stack: '叠加',
  tick: '回合结束',
  remove: '移除',
  hold: '持续生效',
  threshold_execute: '回合末阈值结算',
};

const ZONE_LABELS: Record<string, string> = {
  hand: '手牌',
  draw: '抽牌堆',
  discard: '弃牌堆',
  exhaust: '消耗堆',
  all: '全部牌区',
  combat: '本场战斗全部牌区',
  deck: '抽牌堆',
};

const VARIABLE_LABELS: Array<[RegExp, string]> = [
  [/\bdiscard_count\b/g, '本次弃牌数量'],
  [/\b(?:event|self|opponent)\.damage_type\b/g, '本次伤害类型'],
  [/\bopponent\.has_summon\b/g, '敌方存在召唤物'],
  [/\bself\.has_summon\b/g, '自身存在召唤物'],
  [/\bopponent\.has_ally\b/g, '敌方仍有存活队友'],
  [/\bself\.has_ally\b/g, '自身仍有存活队友'],
  [/\bopponent\.summon_count\b/g, '敌方召唤物数量'],
  [/\bself\.summon_count\b/g, '自身召唤物数量'],
  [/\bopponent\.ally_count\b/g, '敌方存活队友数量'],
  [/\bself\.ally_count\b/g, '自身存活队友数量'],
  [/\bopponent\.hand_size\b/g, '对方手牌数'],
  [/\bopponent\.draw_pile_size\b/g, '对方抽牌堆数量'],
  [/\bopponent\.discard_pile_size\b/g, '对方弃牌堆数量'],
  [/\bopponent\.exhaust_pile_size\b/g, '对方消耗堆数量'],
  [/\bspent_energy\b/g, '使用能量'],
  [/\bevent_paid_energy\b|\bpaid_energy\b/g, '本次出牌实际支付能量'],
  [/\bpending_amount\b/g, '本次待结算伤害'],
  [/\bevent_paid_hp\b/g, '本次出牌实际支付生命'],
  [/\bevent_paid_discard\b/g, '本次出牌实际支付弃牌张数'],
  [/\bevent_paid_sacrifices\b/g, '本次出牌实际支付献祭数量'],
  [/\bevent_paid_total\b|\bpaid_cost\b/g, '本次出牌实际支付总费用'],
  [/\b(?:context\.)?x_value\b/g, 'X值（本次消耗量）'],
  [/\bturn_number\b/g, '当前回合数'],
  [/\bcards_played_this_turn\b/g, '本回合使用卡牌的次数'],
  [/\battacks_played_this_turn\b/g, '本回合使用攻击牌的次数'],
  [/\bskills_played_this_turn\b/g, '本回合使用技能牌的次数'],
  [/\bstacks\b/g, '当前层数'],
  [/\bself\.hand_size\b/g, '手牌数'],
  [/\bself\.draw_pile_size\b/g, '抽牌堆数量'],
  [/\bself\.discard_pile_size\b/g, '弃牌堆数量'],
  [/\bself\.exhaust_pile_size\b/g, '消耗堆数量'],
  [/\bself\.max_hp\b/g, '自身最大生命'],
  [/\bself\.max_lust\b/g, '自身最大欲望'],
  [/\bself\.max_energy\b/g, '自身最大能量'],
  [/\bself\.hp\b/g, '自身生命'],
  [/\bself\.lust\b/g, '自身欲望'],
  [/\bself\.energy\b/g, '自身能量'],
  [/\bself\.block\b/g, '自身格挡'],
  [/\bopponent\.max_hp\b/g, '敌方最大生命'],
  [/\bopponent\.max_lust\b/g, '敌方最大欲望'],
  [/\bopponent\.max_energy\b/g, '敌方最大能量'],
  [/\bopponent\.hp\b/g, '敌方生命'],
  [/\bopponent\.lust\b/g, '敌方欲望'],
  [/\bopponent\.energy\b/g, '敌方能量'],
  [/\bopponent\.block\b/g, '敌方格挡'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse authored CEL for display only, so nested expressions never depend on brittle text replacement. */
function formulaAstText(node: any, options: CompactCardDescriptionOptions = {}): string {
  const operand = (child: any, parent?: string, right = false): string => {
    const precedence: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '>=': 4, '<': 4, '<=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    const nested = ['BinaryExpression', 'ConditionalExpression', 'UnaryExpression'].includes(child.type);
    const safe = child.type === 'BinaryExpression' && parent && precedence[child.operator] !== undefined
      && precedence[parent] !== undefined && (precedence[child.operator] > precedence[parent]
        || (!right && precedence[child.operator] === precedence[parent]));
    return nested && !safe ? `（${formulaAstText(child, options)}）` : formulaAstText(child, options);
  };
  if (node.type === 'Literal') return typeof node.value === 'string' ? `'${node.value}'` : String(node.value);
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return `${formulaAstText(node.object, options)}.${formulaAstText(node.property, options)}`;
  if (node.type === 'UnaryExpression') return node.operator === '-' ? `-${operand(node.argument)}`
    : node.operator === '+' ? operand(node.argument) : `不满足“${conditionAstText(node.argument, options)}”`;
  if (node.type === 'ConditionalExpression') return `${formulaAstText(node.alternate, options)}；当${conditionAstText(node.test, options)}时改为${formulaAstText(node.consequent, options)}`;
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
    const values = node.arguments.map((argument: any) => formulaAstText(argument, options));
    if (['min', 'max'].includes(node.callee.name)) {
      if (values.length === 2 && node.arguments.some((arg: any) => arg.type === 'Literal' && typeof arg.value === 'number')) {
        const cap = node.arguments[1].type === 'Literal' ? 1 : 0;
        return `${values[1 - cap]}（${node.callee.name === 'min' ? '最多' : '至少'}${values[cap]}）`;
      }
      return `取${values.join('、')}中的${node.callee.name === 'min' ? '较小' : '较大'}值`;
    }
    if (node.callee.name === 'floor') return `向下取整（${values[0]}）`;
    if (node.callee.name === 'ceil') return `向上取整（${values[0]}）`;
    if (node.callee.name === 'abs') return `绝对值（${values[0]}）`;
    // Preserve unhandled public functions in full rather than dropping a term.
    throw new Error('Unsupported display function');
  }
  if (node.type === 'BinaryExpression') {
    if (node.operator === '/' && node.right.type === 'Literal' && node.right.value === 2) return `${operand(node.left)}的一半`;
    if (node.operator === '*' && node.right.type === 'Literal' && node.right.value === 0.5) return `${operand(node.left)}的一半`;
    if (node.operator === '*' && node.left.type === 'Literal' && node.left.value === 0.5) return `${operand(node.right)}的一半`;
    const operators: Record<string, string> = {
      '+': ' + ', '-': ' - ', '*': ' × ', '/': ' ÷ ', '%': '取余',
      '==': '等于', '===': '等于', '!=': '不等于', '!==': '不等于',
      '>': '高于', '>=': '达到', '<': '低于', '<=': '不高于', '&&': '且', '||': '或',
    };
    return `${operand(node.left, node.operator)}${operators[node.operator] || node.operator}${operand(node.right, node.operator, true)}`;
  }
  throw new Error('Unsupported display expression');
}

function formatFormulaText(text: string, options: CompactCardDescriptionOptions): string {
  text = describeStanceFormula(text, options.stanceNames, options);
  text = text.replace(/\b(self|opponent)\.status\.([A-Za-z0-9_]+)\.stacks\b/g, (_match, target: string, statusId: string) => `${target === 'self' ? '自身' : '敌方'}${displayStatusName(statusId, options)}层数`);
  text = text.replace(/\bspent_resource\.([A-Za-z_][A-Za-z0-9_]*)\b/g, (_match, id: string) => `使用${options.resourceNames?.[id] || id}`);
  text = text.replace(/\b(?:event_paid_resource|paid_resource)\.([A-Za-z_][A-Za-z0-9_]*)\b/g, (_match, id: string) => `本次出牌实际支付${options.resourceNames?.[id] || id}`);
  text = text.replace(/\bx_resource\.([A-Za-z_][A-Za-z0-9_]*)\b/g, (_match, id: string) => `${options.resourceNames?.[id] || id}的X值`);
  text = text.replace(/\b(self|opponent)\.resource\.([A-Za-z_][A-Za-z0-9_]*)\.(current|max)\b/g, (_match, target: string, id: string, field: string) => `${target === 'self' ? '自身' : '敌方'}${options.resourceNames?.[id] || id}${field === 'max' ? '上限' : '数量'}`);
  for (const [pattern, label] of VARIABLE_LABELS) text = text.replace(pattern, label);
  return text;
}

function parseFormula(value: unknown, options: CompactCardDescriptionOptions): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return formatFormulaText(formulaAstText(jsep(value), options), options) || null; } catch { return null; }
}

function conditionAstText(node: any, options: CompactCardDescriptionOptions): string {
  if (node?.type === 'BinaryExpression' && ['&&', '||'].includes(node.operator)) {
    const operand = (child: any): string => {
      const text = conditionAstText(child, options);
      return child.type === 'BinaryExpression' && ['&&', '||'].includes(child.operator)
        && child.operator !== node.operator ? `（${text}）` : text;
    };
    return `${operand(node.left)}${node.operator === '&&' ? '且' : '或'}${operand(node.right)}`;
  }
  if (node?.type === 'UnaryExpression' && node.operator === '!') {
    return `不满足“${conditionAstText(node.argument, options)}”`;
  }
  if (node?.type === 'BinaryExpression' && ['==', '!='].includes(node.operator)) {
    const stanceTarget = (candidate: any): 'self' | 'opponent' | null => candidate?.type === 'MemberExpression'
      && candidate.computed === false && candidate.object?.type === 'Identifier'
      && candidate.property?.type === 'Identifier' && candidate.property.name === 'stance'
      && ['self', 'opponent'].includes(candidate.object.name) ? candidate.object.name : null;
    const target = stanceTarget(node.left) || stanceTarget(node.right);
    const literal = stanceTarget(node.left) ? node.right : node.left;
    if (target && literal?.type === 'Literal' && (typeof literal.value === 'string' || literal.value === null)) {
      if (typeof literal.value === 'string') notifyStanceReference(literal.value, options);
      return describeStanceIdentity(target === 'self' ? (options.selfLabel || '自身') : (options.opponentLabel || '对方'),
        node.operator === '==' ? 'eq' : 'neq', literal.value, options.stanceNames);
    }
  }
  return condition(formulaAstText(node, options), options, false);
}

function conditionalFormula(value: unknown, options: CompactCardDescriptionOptions): { otherwise: string; condition: string; then: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const expression: any = jsep(value);
    if (expression.type !== 'ConditionalExpression') return null;
    return { otherwise: formatFormulaText(formulaAstText(expression.alternate, options), options), condition: conditionAstText(expression.test, options), then: formatFormulaText(formulaAstText(expression.consequent, options), options) };
  } catch { return null; }
}

function cappedFormula(value: unknown, options: CompactCardDescriptionOptions): { value: string; maximum: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const expression: any = jsep(value);
    if (expression.type !== 'CallExpression' || expression.callee?.name !== 'min' || expression.arguments.length !== 2) return null;
    const cap = expression.arguments[1].type === 'Literal' ? 1 : expression.arguments[0].type === 'Literal' ? 0 : -1;
    if (cap < 0 || typeof expression.arguments[cap].value !== 'number') return null;
    return { value: formatFormulaText(formulaAstText(expression.arguments[1 - cap], options), options), maximum: formatFormulaText(formulaAstText(expression.arguments[cap], options), options) };
  } catch { return null; }
}

function formula(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (typeof value === 'number') return String(value);
  const source = typeof value === 'string' ? value.trim() : String(value ?? '');
  return parseFormula(source, options) || formatFormulaText(source, options);
}

/** A resource delta is not a mandatory payment; keep the wording distinct. */
function resourceDelta(value: unknown, options: CompactCardDescriptionOptions): string {
  return typeof value === 'number' && value < 0
    ? `减少${formula(-value, options)}`
    : `获得${formula(value, options)}`;
}

/** Render a boolean expression as a readable condition instead of leaking code operators into player text. */
function condition(value: unknown, options: CompactCardDescriptionOptions = {}, parseStance = true): string {
  if (parseStance && typeof value === 'string' && value.includes('.stance')) {
    try { return conditionAstText(jsep(value), options); } catch { /* Preserve the readable fallback for unsupported expressions. */ }
  }
  if (typeof value === 'string') {
    let source = value.replace(/\b(self|opponent)\.stance\s*(={2,3}|!={1,2})\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\3/g,
      (_match, target: 'self' | 'opponent', operator: string, _quote: string, id: string) => {
        notifyStanceReference(id, options);
        return describeStanceIdentity(target === 'self' ? (options.selfLabel || '自身') : (options.opponentLabel || '对方'),
          operator.startsWith('!') ? 'neq' : 'eq', id, options.stanceNames);
      });
    source = source.replace(/(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*(={2,3}|!={1,2})\s*\b(self|opponent)\.stance/g,
      (_match, _quote: string, id: string, operator: string, target: 'self' | 'opponent') => {
        notifyStanceReference(id, options);
        return describeStanceIdentity(target === 'self' ? (options.selfLabel || '自身') : (options.opponentLabel || '对方'),
          operator.startsWith('!') ? 'neq' : 'eq', id, options.stanceNames);
      });
    value = source;
  }
  if (typeof value === 'string') value = value.replace(
    /((?:!\s*)+)\b(self|opponent)\.(has_summon|has_ally|has_buff|has_debuff|has_neutral|has_status|alive)\b/g,
    (_match, operators: string, target: 'self' | 'opponent', predicate: string) => {
      if ((operators.match(/!/g)?.length || 0) % 2 === 0) return `${target}.${predicate}`;
      const names: Record<string, string> = {
        has_summon: '不存在召唤物', has_ally: '没有存活队友', has_buff: '没有增益',
        has_debuff: '没有减益', has_neutral: '没有中性状态', has_status: '没有状态', alive: '已阵亡',
      };
      return `${target === 'self' ? '自身' : '敌方'}${names[predicate] || predicate}`;
    },
  );
  if (typeof value === 'string') value = value.replace(
    /(!\s*)?\b(last_card_type|discarded_card_type)\(\s*(['"])(Attack|Skill|Power|Event|Curse)\3\s*\)/g,
    (_match, negated: string | undefined, kind: 'last_card_type' | 'discarded_card_type', _quote: string, type: string) => describeCardTypeCondition(kind, type, Boolean(negated)),
  );
  if (typeof value === 'string') value = value.replace(
    /(!\s*)?\bevent_status_is\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2\s*\)/g,
    (_match, negated: string | undefined, _quote: string, id: string) => describeStatusEventIdentity(displayStatusName(id, options), Boolean(negated)),
  );
  let text = formula(value, options);
  text = text
    .replace(/\s*===?\s*/g, '等于')
    .replace(/\s*!==?\s*/g, '不等于')
    .replace(/\s*>=\s*/g, '不低于')
    .replace(/\s*<=\s*/g, '不高于')
    .replace(/\s*>\s*/g, '高于')
    .replace(/\s*<\s*/g, '低于')
    .replace(/\s*&&\s*/g, '且')
    .replace(/\s*\|\|\s*/g, '或');
  return text
    .replace(/((?:自身|敌方)[^且或高低等不]+?)\s*\/\s*2\b/g, '$1的一半')
    .replace(/使用能量等于0/g, '没有使用能量')
    .replace(/使用能量高于0/g, '使用了能量');
}

function targetPrefix(value: unknown, defaultTarget: 'self' | 'opponent'): string {
  const target = value === 'self' || value === 'opponent' ? value : defaultTarget;
  return target === 'self' ? '自身' : '敌方';
}

function selectionText(
  value: Record<string, unknown>,
  defaultPick: 'random' | 'choose',
  count: unknown,
  options: CompactCardDescriptionOptions,
): string {
  const zone = ZONE_LABELS[String(value.from ?? 'hand')] || '指定牌区';
  const pick = String(value.pick ?? defaultPick);
  const id = value.run_instance_id ?? value.combat_instance_id ?? value.id ?? value.template_id;
  const name = typeof value.name === 'string' ? value.name : typeof id === 'string' ? options.cardNames?.[id] : undefined;
  const { name: _name, id: _id, template_id: _template, run_instance_id: _run, combat_instance_id: _combat, ...otherFilters } = value;
  const filtered = cardRuleFilterText(id || name ? otherFilters : value, options);
  if (id || name) return (pick === 'all' || count === 'all' ? '所有同名卡牌' : '指定卡牌') + (name ? '（' + name + '）' : '')
    + (filtered !== '牌' ? `中${filtered}` : '');
  if (pick === 'all' || count === 'all') return `${zone}中的所有${filtered}`;
  const amount = formula(count ?? 1, options);
  const mode = pick === 'random' ? '随机' : pick === 'left' ? '最左侧' : pick === 'right' ? '最右侧' : '选择';
  return filtered === '牌' ? `${mode}${amount}张${zone}` : `${zone}中${mode}${amount}张${filtered}`;
}

function summonSelectionText(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (!isRecord(value)) return '指定召唤物';
  const owner = value.owner === 'opponent' ? '敌方' : value.owner === 'any' ? '双方' : '我方';
  const pick = String(value.pick ?? 'left');
  const count = Math.max(1, Math.floor(Number(value.count) || 1));
  const amount = count > 1 ? `${count}个` : '';
  const labels: Record<string, string> = {
    left: `最早的${amount}`, right: `最新的${amount}`, first: `最早的${amount}`, last: `最新的${amount}`, choose: `选择的${amount}`,
    random: '随机1个', random_n: `随机${count}个`, all: '全部',
    lowest_hp: `生命比例最低的${amount}`, highest_hp: `生命比例最高的${amount}`, by_id: `实例“${String(value.id || '未知')}”`, source: `当前触发的${amount}`,
  };
  const filters = [
    typeof value.id === 'string' && pick !== 'by_id' ? `实例“${value.id}”` : '',
    typeof value.template_id === 'string' ? `类型为“${options.summonNames?.[value.template_id] || value.template_id}”` : '',
    typeof value.slot === 'string' ? `位于“${value.slot}”唯一槽` : '',
    Array.isArray(value.tags) && value.tags.length ? `同时带有“${value.tags.join('、')}”标签` : '',
  ].filter(Boolean);
  return `${owner}${labels[pick] || `指定的${amount}`}${filters.length ? `${filters.join('且')}的` : pick === 'by_id' ? '的' : ''}召唤物`;
}

function nestedEffectText(
  effects: unknown,
  templates: ReadonlyMap<string, string>,
  options: CompactCardDescriptionOptions,
): string {
  const entries = normalizeCompactEffectEntries(effects);
  if (!entries) return '';
  return summonModifierDisplayGroups(entries.filter(isRecord), 'compact')
    .map(group => joinSummonModifierDescriptions(group.map(entry => describeEntry(entry, templates, options))))
    .filter(Boolean)
    .join('；');
}

const OPERATOR_LABELS: Readonly<Record<string, string>> = {
  add: '增加', subtract: '减少', multiply: '乘以', divide: '除以', set: '设为', min: '上限设为', max: '下限设为',
};

const PATCH_SCOPE_LABELS: Readonly<Record<string, string>> = {
  resolution: '本次结算', turn: '本回合', until_played: '直到打出', combat: '本场战斗',
  run: '本局游戏', permanent: '永久',
};

function cardRuleFilterText(
  value: Record<string, unknown>,
  options: CompactCardDescriptionOptions,
): string {
  const typeNames: Record<string, string> = {
    Attack: '攻击牌', Skill: '技能牌', Power: '能力牌', Event: '事件牌', Curse: '诅咒牌',
  };
  const rarityNames: Record<string, string> = {
    Common: '普通', Uncommon: '罕见', Rare: '稀有', Epic: '史诗', Legendary: '传说', Corrupt: '堕化',
  };
  const list = (input: unknown): string[] => Array.isArray(input) ? input.map(String) : input === undefined ? [] : [String(input)];
  const filters: string[] = [];
  if (typeof value.name === 'string' && value.name.trim()) filters.push(`名称:${value.name.trim()}`);
  if (typeof value.name_contains === 'string' && value.name_contains.trim()) filters.push(`名称包含「${value.name_contains.trim()}」`);
  const types = list(value.card_type);
  if (types.length) filters.push(types.map(type => typeNames[type] || type).join('/'));
  const rarities = list(value.rarity);
  if (rarities.length) filters.push(rarities.map(rarity => rarityNames[rarity] || rarity).join('/'));
  if (value.cost !== undefined) filters.push(`${formula(value.cost, options)}费`);
  if (value.min_cost !== undefined) filters.push(`至少${formula(value.min_cost, options)}费`);
  if (value.max_cost !== undefined) filters.push(`至多${formula(value.max_cost, options)}费`);
  const tags = list(value.tag);
  if (tags.length) filters.push(`标签:${tags.join('+')}`);
  const template = value.template_id ?? value.id;
  if (template !== undefined) filters.push(options.cardNames?.[String(template)] ? `卡牌:${options.cardNames[String(template)]}` : '指定卡牌');
  if (value.run_instance_id !== undefined) filters.push('指定整局实例');
  if (value.combat_instance_id !== undefined) filters.push('指定战斗实例');
  if (value.origin !== undefined) filters.push(`来源:${({ deck: '初始牌组', generated: '生成', copied: '复制', transformed: '变形' } as Record<string, string>)[String(value.origin)] || '指定来源'}`);
  if (value.upgraded !== undefined) filters.push(value.upgraded ? '已升级' : '未升级');
  const keywordNames: Record<string, string> = {
    retain: '保留', exhaust: '消耗', ethereal: '虚无', innate: '固有', sly: '灵巧',
  };
  const keywords = list(value.keyword);
  if (keywords.length) filters.push(keywords.map(keyword => keywordNames[keyword] || keyword).join('+'));
  const excludedKeywords = list(value.exclude_keyword);
  if (excludedKeywords.length) {
    filters.push(`不含${excludedKeywords.map(keyword => keywordNames[keyword] || keyword).join('+')}`);
  }
  if (value.root_only !== undefined) filters.push(value.root_only ? '仅谱系原卡' : '包含临时副本');
  return filters.length ? `符合“${filters.join('、')}”的牌` : '牌';
}

function displayStatusName(id: unknown, options: CompactCardDescriptionOptions): string {
  const value = String(id);
  return options.statusNames?.[value]?.trim() || '未注册状态';
}

function describeCardAttachmentChange(
  change: Record<string, unknown>,
  options: CompactCardDescriptionOptions,
): string {
  const operators: Record<string, string> = {
    add: '增加',
    subtract: '减少',
    multiply: '乘以',
    divide: '除以',
    set: '设为',
    min: '上限设为',
    max: '下限设为',
  };
  const stats: Record<string, string> = {
    damage: '伤害',
    block: '格挡',
    lust: '欲望',
    stacks: '状态层数',
  };
  const keywords: Record<string, string> = {
    retain: '保留',
    exhaust: '消耗',
    ethereal: '虚无',
    innate: '固有',
    sly: '灵巧',
  };
  const timings: Record<string, string> = {
    on_draw: '抽到时',
    while_in_hand: '留在手牌时',
    on_play: '打出时',
  };
  const kind = String(change.kind ?? '');
  if (kind === 'numeric') {
    return `${stats[String(change.stat)] || '数值'}${operators[String(change.operator)] || '调整为'}${formula(change.value, options)}`;
  }
  if (kind === 'cost' || kind === 'x_value') {
    return `${kind === 'cost' ? '费用' : 'X值'}${operators[String(change.operator)] || '调整为'}${formula(change.value, options)}`;
  }
  if (kind === 'keyword') {
    return `${change.enabled === false ? '移除' : '获得'}“${keywords[String(change.keyword)] || '卡牌关键词'}”`;
  }
  if (kind === 'replay') return `额外完整结算${formula(change.extra, options)}次`;
  if (kind === 'area') return '攻击改为对所有敌人生效';
  if (kind === 'hits') return `每段攻击增加${formula(change.add, options)}次命中`;
  if (kind === 'dynamic_cost') {
    return `${timings[String(change.timing)] || '结算时'}费用${operators[String(change.operator)] || '调整为'}${formula(change.value, options)}`;
  }
  if (kind === 'play_access') return change.mode === 'deny' ? '不可主动打出' : '允许主动打出';
  if (kind === 'discard_auto_play') {
    const reasonNames: Record<string, string> = {
      player_choice: '主动选择弃牌',
      random_effect: '随机效果弃牌',
      effect: '战斗效果弃牌',
      turn_cleanup: '回合结束弃牌',
      scry: '预见弃牌',
      recover: '取回移动',
      exhaust: '消耗移动',
      generate: '生成移动',
      copy: '复制移动',
      transform: '变形移动',
      auto_play: '自动打出移动',
      other: '其他移动',
    };
    const reasons = Array.isArray(change.reasons)
      ? change.reasons.map(reason => reasonNames[String(reason)] || String(reason)).join('、')
      : '指定原因';
    const destinations: Record<string, string> = {
      discard: '弃牌堆',
      exhaust: '消耗堆',
      draw_top: '抽牌堆顶',
      draw_bottom: '抽牌堆底',
      hand: '手牌',
      remove: '移出本场战斗',
    };
    return `因${reasons}从手牌弃掉时免费自动打出，失败后移至${destinations[String(change.failure_destination)] || '指定牌区'}`;
  }
  return '';
}

/** Keep internal IDs and formula paths out of player-facing AI prose. */
export function normalizeChinesePlayerDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || /[A-Za-z_]/.test(text)) return '';
  return text;
}

/** Detect prose that merely repeats literal mechanic numbers already shown as effect tags. */
export function isMechanicalDescriptionRestatement(value: unknown): boolean {
  const text = normalizeChinesePlayerDescription(value);
  if (!text) return false;
  return /(?:造成|恢复|回复|获得|赋予|增加|减少|施加|移除|抽取?|弃掉|消耗|费用)[^。；，]{0,18}\d+(?:\.\d+)?(?:点|层|张|次|能量|生命|欲望|格挡|伤害)/.test(
    text,
  );
}

function describeSingleOperation(
  value: Record<string, unknown>,
  operation: string,
  templates: ReadonlyMap<string, string>,
  options: CompactCardDescriptionOptions,
): string {
  const amount = formula(value[operation], options);
  const selectorTeam = value.targets && typeof value.targets === 'object' && !Array.isArray(value.targets)
    ? (value.targets as Record<string, unknown>).team : undefined;
  const target = targetPrefix(
    value.to,
    value.targets !== undefined
      ? selectorTeam === 'self' ? 'self' : selectorTeam === 'opponent' ? 'opponent' : options.enemyCollectionTarget ?? 'opponent'
      : options.implicitTarget ?? compactEffectDefaultTarget(operation),
  );
  const statusTarget = value.targets && typeof value.targets === 'object'
    ? describeEffectTarget(target === '自身' ? 'self' : 'opponent', { selfLabel: options.selfLabel, opponentLabel: options.opponentLabel }, value.targets as EnemyTargetSelector)
    : target;
  let text = '';
  const valueFormula = conditionalFormula(value[operation], options);
  const cappedValue = cappedFormula(value[operation], options);

  switch (operation) {
    case 'damage':
      text = valueFormula
        ? `${target === '自身' ? '对自身' : '对敌方'}造成${valueFormula.otherwise}点伤害；如果${valueFormula.condition}，则造成${valueFormula.then}点伤害`
        : value.damage_type === 'hp_loss'
        ? `使${target === '自身' ? '自身' : '敌方'}失去${Number(value.hits) > 1 ? `${value.hits}次` : ''}${amount}点生命`
        : target === '自身'
          ? `对自身造成${Number(value.hits) > 1 ? `${value.hits}次` : ''}${amount}点伤害`
          : `对敌方造成${Number(value.hits) > 1 ? `${value.hits}次` : ''}${amount}点伤害`;
      if (value.bypass_block === true || value.damage_type === 'hp_loss') text += '，无视格挡';
      if (value.lifesteal !== undefined) text += `，并按实际生命损失的${formula(value.lifesteal, options)}倍恢复生命`;
      break;
    case 'execute':
      text = `当${target === '自身' ? '自身' : '敌方'}生命不高于${formula(value.execute, options)}${value.threshold_mode === 'hp_percent' ? '%' : '点'}时将其处决`;
      break;
    case 'kill':
      text = `直接击杀${target === '自身' ? '自身' : '敌方'}`;
      break;
    case 'heal':
      text = target === '自身' ? `恢复${amount}点生命` : `使敌方恢复${amount}点生命`;
      break;
    case 'block':
      text = valueFormula
        ? `${target === '自身' ? '获得' : '使敌方获得'}${valueFormula.otherwise}点格挡；当${valueFormula.condition}时改为${valueFormula.then}点`
        : cappedValue
          ? `${target === '自身' ? '获得' : '使敌方获得'}等同于${cappedValue.value}的格挡，最多${cappedValue.maximum}点`
        : target === '自身' ? `获得${amount}点格挡` : `使敌方获得${amount}点格挡`;
      break;
    case 'energy':
      text = target === '自身' ? `获得${amount}点能量` : `使敌方获得${amount}点能量`;
      break;
    case 'resource': {
      const resource = isRecord(value.resource) ? value.resource : {};
      const name = options.resourceNames?.[String(resource.id)] || String(resource.id || '资源');
      const change = resourceDelta(resource.amount, options);
      text = (options.resourceEmojis?.[String(resource.id)] ? `${options.resourceEmojis[String(resource.id)]} ` : '') + (target === '自身' ? `${change}点${name}` : `使敌方${change}点${name}`);
      break;
    }
    case 'set_resource': {
      const resource = isRecord(value.set_resource) ? value.set_resource : {};
      const name = options.resourceNames?.[String(resource.id)] || String(resource.id || '资源');
      text = (options.resourceEmojis?.[String(resource.id)] ? `${options.resourceEmojis[String(resource.id)]} ` : '') + `将${target}${name}设为${describeResourceHalf(resource.value, target === '自身' ? 'self' : 'opponent', String(resource.id)) ?? formula(resource.value, options)}`;
      break;
    }
    case 'lust':
      text = target === '自身' ? `增加${amount}点欲望` : `使敌方增加${amount}点欲望`;
      break;
    case 'set_hp':
      text = `将${target}生命设为${amount}`;
      break;
    case 'set_lust':
      text = `将${target}欲望设为${amount}`;
      break;
    case 'set_energy':
      text = `将${target}能量设为${amount}`;
      break;
    case 'set_block':
      text = `将${target}格挡设为${amount}`;
      break;
    case 'narrate':
      text = String(value.narrate ?? '').trim();
      break;
    case 'apply_status':
      text = `为${statusTarget}赋予${formula(value.stacks ?? 1, options)}层${displayStatusName(value.apply_status, options)}`;
      if (options.statusDefinitions && options.inlineStatusDetails !== false) {
        const definition = typeof value.apply_status === 'string'
          && Object.hasOwn(options.statusDefinitions, value.apply_status)
          ? options.statusDefinitions[value.apply_status] : undefined;
        if (isRecord(definition) && definition.id === value.apply_status) {
          // One level only: status graphs may be cyclic. The inner effect's
          // self/opponent are relative to its holder, not this card's caster.
          const rules = describeCompactStatus(definition, { ...options, statusDefinitions: undefined,
            selfLabel: undefined, opponentLabel: undefined, implicitTarget: 'self' });
          text += `（状态规则；以下自身指状态持有者：${rules}）`;
        } else text += '（状态定义不可用，无法展示其触发规则）';
      }
      break;
    case 'status_action':
      text = describeStatusAction(value.status_action as StatusActionSpec, options.statusNames);
      break;
    case 'remove_status': {
      const names: Record<string, string> = { all: '全部状态', buffs: '全部增益', debuffs: '全部减益' };
      text = `移除${statusTarget}的${names[String(value.remove_status)] || displayStatusName(value.remove_status, options)}`;
      break;
    }
    case 'draw':
      text = `抽${amount}张牌`;
      break;
    case 'scry':
      text = `查看抽牌堆顶${amount}张牌，可将任意张置入弃牌堆`;
      break;
    case 'persistent_growth': {
      const stat = { max_hp: '生命上限', max_lust: '欲望上限', damage: '伤害', lust: '欲望伤害' }[String(value.persistent_growth)] || '属性';
      const operator = ['add', 'subtract', 'set'].find(key => value[key] !== undefined);
      if (operator) text = `${value.summon_template ? `${options.summonNames?.[String(value.summon_template)] || '指定召唤物'}的` : ''}${stat}永久${OPERATOR_LABELS[operator]}${formula(value[operator], options)}`;
      break;
    }
    case 'seek':
      text = `从抽牌堆选择${amount}张牌加入手牌`;
      break;
    case 'discard':
      text = `弃掉${selectionText(value, 'random', value.discard, options)}`;
      break;
    case 'exhaust':
      text = `消耗${selectionText(value, 'random', value.exhaust, options)}`;
      break;
    case 'recover': {
      if (cardRuleFilterText(value, options) !== '牌') {
        text = `将${selectionText({ ...value, from: value.from ?? 'discard' }, 'choose', value.recover, options)}取回手牌`;
        break;
      }
      const zone = ZONE_LABELS[String(value.from ?? 'discard')] || String(value.from ?? '弃牌堆');
      const pick = String(value.pick ?? 'choose');
      text =
        pick === 'all' || value.recover === 'all'
          ? `将${zone}中的所有牌取回手牌`
          : pick === 'random'
            ? `从${zone}随机取回${amount}张牌`
            : `从${zone}选择${amount}张牌取回手牌`;
      break;
    }
    case 'reduce_cost':
      text = `使${selectionText(value, 'choose', value.count ?? 1, options)}费用降低${amount}`;
      break;
    case 'modify_card': {
      const stats: Record<string, string> = {
        damage: '伤害',
        block: '格挡',
        lust: '欲望',
        stacks: '状态层数',
      };
      const operator = ['add', 'subtract', 'multiply', 'divide'].find(key => value[key] !== undefined) || 'add';
      const verbs: Record<string, string> = {
        add: '增加',
        subtract: '减少',
        multiply: '乘以',
        divide: '除以',
      };
      text = `使${selectionText(value, 'choose', value.count ?? 1, options)}的${stats[String(value.modify_card)] || '数值'}${verbs[operator]}${formula(value[operator], options)}`;
      break;
    }
    case 'patch_card': {
      const kind = String(value.patch_card ?? '');
      const scope = PATCH_SCOPE_LABELS[String(value.scope ?? 'combat')] || '指定期限内';
      const selected = selectionText(value, 'choose', value.count ?? 1, options);
      const operator = ['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max'].find(key => value[key] !== undefined);
      const subjects: Record<string, string> = {
        damage: '伤害', block: '格挡', lust: '欲望', stacks: '状态层数', cost: '费用', x_value: 'X值',
      };
      if (kind === 'replay') text = `使${selected}在${scope}额外结算${formula(value.extra, options)}次`;
      else if (kind === 'area') text = `使${selected}在${scope}攻击所有敌人`;
      else if (kind === 'hits') text = `使${selected}在${scope}每段攻击增加${formula(value.add, options)}次命中`;
      else if (['retain', 'exhaust', 'ethereal', 'innate', 'sly'].includes(kind)) {
        const keywords: Record<string, string> = { retain: '保留', exhaust: '消耗', ethereal: '虚无', innate: '固有', sly: '灵巧' };
        text = `使${selected}在${scope}${value.enabled === false ? '移除' : '获得'}“${keywords[kind]}”`;
      } else if (kind === 'dynamic_cost' && operator) {
        const timings: Record<string, string> = { on_draw: '抽到时', while_in_hand: '留在手牌时', on_play: '打出时' };
        text = `使${selected}在${scope}${timings[String(value.timing)] || '结算时'}费用${OPERATOR_LABELS[operator]}${formula(value[operator], options)}`;
      } else if (operator) {
        text = `使${selected}${kind === 'damage' || kind === 'lust' ? '造成的' : '的'}${subjects[kind] || '数值'}${OPERATOR_LABELS[operator]}${formula(value[operator], options)}（${scope}）`;
      }
      if (text && value.future_copies === true) text += '，之后生成的同类牌也生效';
      break;
    }
    case 'copy':
      text = `复制${selectionText(value, 'choose', value.copy, options)}到手牌`;
      break;
    case 'double':
      text = `使${selectionText(value, 'choose', value.double, options)}下次主效果执行两次`;
      break;
    case 'add_card': {
      const id = String(value.add_card);
      const definition = options.cardDefinitions?.[id];
      const cardName = templates.get(id) || options.cardNames?.[id] || (isRecord(definition) ? String(definition.name || '') : '') || '指定卡牌';
      describeCreatedCardReference(id, cardName, options);
      const destination = value.to === 'deck' ? '抽牌堆' : value.to === 'discard' ? '弃牌堆' : '手牌';
      text = `将${formula(value.count ?? 1, options)}张${cardName}加入${destination}`;
      break;
    }
    case 'ensure_card': {
      const id = String(value.ensure_card);
      const definition = options.cardDefinitions?.[id];
      const cardName = templates.get(id) || options.cardNames?.[id] || (isRecord(definition) ? String(definition.name || '') : '') || '指定卡牌';
      describeCreatedCardReference(id, cardName, options);
      text = `本场战斗中确保至少有${formula(value.minimum ?? 1, options)}张${cardName}`;
      break;
    }
    case 'upgrade_card': {
      const scope: Record<string, string> = { combat: '本场战斗', run: '本局游戏', permanent: '永久' };
      const changes = Array.isArray(value.changes)
        ? value.changes.filter(isRecord).map(change => describeCardAttachmentChange(change, options)).filter(Boolean)
        : [];
      text = changes.map(change => `使${selectionText(value, 'choose', value.upgrade_card, options)}的${change}（${scope[String(value.scope ?? 'run')] || '本局游戏'}）`).join('；');
      break;
    }
    case 'modify': {
      const subjects: Record<ModifierStat, string> = {
        damage: `${target}造成的伤害`,
        damage_taken: `${target}受到的伤害`,
        lust: `${target}造成的欲望伤害`,
        lust_taken: `${target}受到的欲望伤害`,
        heal: `${target}的治疗量`,
        block: `${target}获得的格挡`,
        summon_capacity: `${target}的召唤容量`,
        draw_per_turn: `${target}的回合基础抽牌数`,
      };
      const operator = ['add', 'subtract', 'multiply', 'divide', 'set'].find(key => value[key] !== undefined) || 'set';
      const verbs: Record<string, string> = {
        add: '增加',
        subtract: '减少',
        multiply: '乘以',
        divide: '除以',
        set: '设为',
      };
      text = `${subjects[String(value.modify) as ModifierStat] || `${target}的未知属性`}${verbs[operator]}${formula(value[operator], options)}${value.damage_type ? `（仅${({ attack: "攻击伤害", effect: "效果伤害", hp_loss: "生命流失", retaliation: "反伤", damage_over_time: "持续伤害" } as Record<string, string>)[String(value.damage_type)]}）` : ""}`;
      break;
    }
    case 'card_rule': {
      const filteredCards = cardRuleFilterText(value, options);
      const scope = value.limit === 'all'
        ? `所有${filteredCards}`
        : value.limit !== undefined
          ? `前${formula(value.limit, options)}张${filteredCards}`
          : filteredCards;
      const ruleText: Record<string, string> = {
        retain_hand: '回合结束时保留全部手牌',
        retain_block: '回合开始时保留格挡',
        limit_draw: `每次至多抽${formula(value.limit, options)}张牌`,
        limit_block_gain: `每次至多获得${formula(value.limit, options)}点格挡`,
        limit_energy_gain: `每次至多获得${formula(value.limit, options)}点能量`,
        deny_card_play: '禁止打出符合条件的卡牌',
        allow_card_play: '允许打出符合条件但通常不可打出的卡牌',
        limit_card_play: `每回合至多打出${formula(value.limit, options)}张符合条件的卡牌`,
        card_destination: '符合条件的卡牌结算后改为移至指定区域',
        ethereal: '符合条件的卡牌获得虚无，回合结束仍在手中则本场消耗',
      };
      text = value.card_rule === 'free'
        ? `每回合${scope}不消耗${Array.isArray(value.resources) ? value.resources.map(id => options.resourceNames?.[String(id)] || (id === 'energy' ? '能量' : '指定资源')).join('、') : '任何资源'}`
        : value.card_rule === 'replay'
          ? `每回合${scope}额外结算${formula(value.extra ?? 1, options)}次`
          : ruleText[String(value.card_rule)] || '';
      break;
    }
    case 'attach_card': {
      if (!isRecord(value.attach_card)) break;
      const attachment = value.attach_card;
      const kind = attachment.kind === 'enchantment' ? '附魔' : '负面附着';
      const removal: Record<string, string> = {
        resolution_end: '本次效果结算后移除',
        played: '打出后移除',
        discarded: '符合弃牌原因后移除',
        turn_end: '回合结束移除',
        combat_end: '持续本场战斗',
        run_end: '持续本次流程',
        manual: '持续存在',
      };
      const defaultRemoval: Record<string, string> = {
        resolution: 'resolution_end',
        turn: 'turn_end',
        until_played: 'played',
        combat: 'combat_end',
        run: 'run_end',
        permanent: 'manual',
      };
      const removeOn = String(attachment.remove_on ?? defaultRemoval[String(attachment.scope)] ?? 'manual');
      const changes = Array.isArray(attachment.changes)
        ? attachment.changes.filter(isRecord).map(change => describeCardAttachmentChange(change, options)).filter(Boolean)
        : [];
      const remaining = Number(attachment.remaining) > 1 ? `，剩余${attachment.remaining}次` : '';
      text = `使${selectionText(value, 'choose', value.count ?? 1, options)}获得${kind}“${String(attachment.name ?? '')}”（${removal[removeOn] || '按规则移除'}${remaining}）`;
      if (changes.length > 0) text += `：${changes.join('，')}`;
      break;
    }
    case 'auto_play':
      text = `自动${value.free === true ? '免费' : ''}打出${selectionText(value, 'random', value.auto_play, options)}`;
      break;
    case 'replay_current':
      text = `此牌原效果结算后额外完整结算${formula(value.replay_current, options)}次，费用只支付一次`;
      break;
    case 'card_destination': {
      const destinations: Record<string, string> = {
        discard: '弃牌堆', exhaust: '消耗堆', draw_top: '抽牌堆顶', draw_bottom: '抽牌堆底',
        hand: '手牌', remove: '本场战斗外',
      };
      text = `此牌结算后移至${destinations[String(value.card_destination)] || '指定牌区'}`;
      break;
    }
    case 'move_card': {
      const destination: Record<string, string> = { hand: '手牌', draw: '抽牌堆', discard: '弃牌堆', exhaust: '消耗堆' };
      text = `将${selectionText(value, 'choose', value.move_card, options)}移至${destination[String(value.destination)] || '指定牌区'}${value.destination === 'draw' || value.destination === 'discard' || value.destination === 'exhaust' ? (value.position === 'bottom' ? '底部' : '顶部') : ''}`;
      break;
    }
    case 'remove_card':
      text = `从本场战斗移除${selectionText(value, 'choose', value.remove_card, options)}`;
      break;
    case 'transform_card':
      text = `将${selectionText(value, 'choose', value.count ?? 1, options)}变形为${templates.get(String(value.transform_card)) || options.cardNames?.[String(value.transform_card)] || '指定卡牌'}`;
      break;
    case 'stance': {
      if (value.stance === null) text = `使${target}退出当前姿态`;
      else if (isRecord(value.stance)) {
        const id = String(value.stance.id || '');
        const name = String(value.stance.name || value.stance.id || '未命名');
        if (id) notifyStanceReference(id, options, value.stance);
        text = `使${target}进入姿态“${name}”`;
      }
      break;
    }
    case 'channel_orb': {
      if (!isRecord(value.channel_orb)) break;
      const orb = value.channel_orb;
      const passive = nestedEffectText(orb.passive, templates, options);
      const evoke = nestedEffectText(orb.evoke, templates, options);
      text = `使${target}向姿态槽充能姿态“${String(orb.name || orb.id || '未命名')}”（数值${formula(orb.value, options)}`;
      if (passive) text += `；被动：${passive}`;
      if (evoke) text += `；激发：${evoke}`;
      text += '）';
      break;
    }
    case 'evoke_orb': {
      const pick = value.pick ?? (value.evoke_orb === 'all' ? 'all' : 'first');
      text = `使${target}激发${pick === 'all' ? '全部' : pick === 'last' ? '末尾' : '最前'}${pick === 'all' ? '' : `${formula(value.evoke_orb, options)}个`}姿态${value.orb_id ? `（类型${value.orb_id}）` : ''}`;
      break;
    }
    case 'orb_slots':
      text = `将${target}的姿态槽设为${amount}`;
      break;
    case 'modify_orb': {
      const operator = ['add', 'subtract', 'multiply', 'divide'].find(key => value[key] !== undefined);
      const pick = value.pick === 'all' ? '全部' : value.pick === 'last' ? '末尾' : '最前';
      if (operator) text = `使${target}${pick}姿态的数值${OPERATOR_LABELS[operator]}${formula(value[operator], options)}`;
      break;
    }
    case 'extra_turn':
      text = `使${target}获得${amount}个额外回合`;
      break;
    case 'end_turn':
      text = `强制结束${target}的当前回合`;
      break;
    case 'schedule': {
      const phases: Record<string, string> = {
        turn_start: '回合开始时', before_draw: '抽牌前', after_draw: '抽牌后', turn_end: '回合结束时',
      };
      const nested = nestedEffectText(value.effects, templates, options);
      const timing = Number(value.schedule) === 0 ? `本${phases[String(value.phase ?? 'turn_start')]}` : `${value.schedule}回合后的${phases[String(value.phase ?? 'turn_start')]}`;
      text = `${timing}结算：${nested}`;
      if (value.repeat_every !== undefined && value.repeats !== undefined) text += `，之后每${value.repeat_every}回合重复，共${value.repeats}次`;
      break;
    }
    case 'choose': {
      if (!Array.isArray(value.options)) break;
      const details = value.options.filter(isRecord).map(option => {
        const result = nestedEffectText(option.effects, templates, options);
        return `“${String(option.label || option.id || '未命名')}”：${result}`;
      });
      const count = value.count === undefined ? 1 : value.count;
      text = `${count === 1 ? '选择一项' : `选择${String(count)}项`}：\n${details.join('\n')}`;
      break;
    }
    case 'spawn_summon': {
      if (!isRecord(value.spawn_summon)) break;
      const summon = value.spawn_summon;
      const resources = (Array.isArray(summon.resources) ? summon.resources : isRecord(summon.resources) ? Object.values(summon.resources) : []).filter(isRecord);
      const summonOptions = { ...options, summonerResourceNames: options.resourceNames, summonerResourceEmojis: options.resourceEmojis,
        resourceNames: { ...options.resourceNames, ...Object.fromEntries(resources.map(resource => [String(resource.id), String(resource.name || resource.id)])) },
        resourceEmojis: { ...options.resourceEmojis, ...Object.fromEntries(resources.map(resource => [String(resource.id), String(resource.emoji || '◆')])) } };
      const amountText = formula(summon.count ?? 1, options);
      text = `使${target}召唤${amountText}个“${String(summon.name || summon.id || '未命名')}”`;
      const details: string[] = [];
      if (summon.has_hp === false) details.push('无生命值');
      else if (summon.max_hp !== undefined) details.push(`${formula(summon.max_hp, options)}点生命`);
      if (summon.block) details.push(`初始${formula(summon.block, options)}点格挡`);
      if (summon.actions_per_activation !== undefined) details.push(`每次激活行动${summon.actions_per_activation}次`);
      if (summon.has_hp !== false && (!isRecord(summon.capabilities) || summon.capabilities.intercepts !== false)) {
        const intercept = isRecord(summon.intercept) ? summon.intercept : {};
        details.push(`承接计入召唤者易伤的攻击，减伤与格挡按实际承伤者计算${intercept.max_per_turn !== undefined ? `，每回合最多拦截${intercept.max_per_turn}次` : ''}`);
      } else {
        details.push('不拦截攻击');
      }
      const overflowText: Record<string, string> = {
        reject: '不再新增', replace_oldest: '替换最早召唤物', replace_lowest_hp: '替换生命最低的召唤物',
      };
      details.push(`${summon.capacity === undefined ? '所属阵营召唤容量：我方默认3，敌方默认无上限' : `所属阵营召唤容量${summon.capacity}`}，新增实例超出容量时${overflowText[String(summon.overflow ?? 'replace_oldest')] || '策略未识别'}`);
      const lifecycle = describeSummonSlotLifecycle({
        slot: typeof summon.slot === 'string' ? summon.slot : undefined,
        hasHp: summon.has_hp !== false,
        maxHp: typeof summon.max_hp === 'number' ? summon.max_hp : undefined,
        onExisting: typeof summon.on_existing === 'string' ? summon.on_existing : undefined,
        onDefeated: typeof summon.on_defeated === 'string' ? summon.on_defeated : undefined,
        customRepeat: summon.on_existing_effects !== undefined,
      });
      if (lifecycle) details.push(lifecycle);
      if (summon.on_existing_effects) details.push(`重复召唤追加：${nestedEffectText(summon.on_existing_effects, templates, options)}`);
      const singleAction = nestedEffectText(summon.action, templates, summonOptions);
      if (singleAction) details.push(`行动：${singleAction}`);
      if (Array.isArray(summon.actions)) {
        for (const action of summon.actions.filter(isRecord)) {
          details.push(`行动“${String(action.name || action.id || '未命名')}”：${nestedEffectText(action.effects, templates, summonOptions)}`);
        }
      }
      if (Array.isArray(summon.abilities)) {
        for (const ability of summon.abilities.filter(isRecord)) {
          const resolved = resolveTriggerInput(ability);
          details.push(`能力“${String(ability.name || ability.id || '未命名')}”·${TRIGGER_LABELS[String(resolved.trigger)] || String(resolved.trigger || '未知时机')}${describeTriggerEventQuery(resolved.eventQuery)}：${nestedEffectText(resolved.triggeredEffects, templates, summonOptions)}`);
        }
      }
      if (options.onSummonReference) options.onSummonReference({ id: String(summon.id || summon.name), name: String(summon.name || summon.id), rules: details.join('；'), summon: { ...summon, displayResourceNames: options.resourceNames, displayResourceEmojis: options.resourceEmojis } });
      else if (details.length) text += `（${details.join('；')}）`;
      break;
    }
    case 'wait': text = '空过（不产生战斗效果）'; break;
    case 'say': text = `台词：“${String(value.say)}”`; break;
    case 'enemy_intent': text = `将当前敌人的下次行动改为“${options.enemyActionNames?.[String(value.enemy_intent)] || String(value.enemy_intent)}”`; break;
    case 'spawn_enemy': {
      if (!isRecord(value.spawn_enemy)) break;
      const enemy = value.spawn_enemy;
      const enemyOptions = { ...options, enemyActionNames: Object.fromEntries((Array.isArray(enemy.actions) ? enemy.actions : []).filter(isRecord).map(action => [String(action.id), String(action.name)])) };
      text = `敌方增援${formula(enemy.count ?? 1, options)}个“${String(enemy.name || enemy.id || '未命名')}”`;
      const details: string[] = [];
      if (enemy.victory_on_defeat === true) details.push('最终击倒即胜利（复活成功不算击倒）');
      details.push('固定五前排（显示从左到右5→1），满员进入候补，上场前不参与战斗');
      if (enemy.capacity !== undefined) details.push(`存活敌人容量${enemy.capacity}（含候补）`);
      if (enemy.max_hp !== undefined) details.push(`${formula(enemy.hp ?? enemy.max_hp, options)}/${formula(enemy.max_hp, options)}生命`);
      if (typeof enemy.escape_when === 'string' && enemy.escape_when.trim()) details.push(`满足${formula(enemy.escape_when, options)}时准备逃跑，，至少预警一回合；倒计时为0的回合结束时逃跑`);
      if (Array.isArray(enemy.actions)) {
        for (const action of enemy.actions.filter(isRecord)) details.push(`行动“${String(action.name || action.id || '未命名')}”：${nestedEffectText(action.effects, templates, enemyOptions)}`);
      }
      if (Array.isArray(enemy.abilities)) for (const ability of enemy.abilities.filter(isRecord)) details.push(`能力“${String(ability.name || ability.id)}”：${describeCompactMain(ability, enemyOptions)}`);
      if (details.length) text += `（${details.join('；')}）`;
      break;
    }
    case 'damage_summon':
    case 'heal_summon': {
      const payload = isRecord(value[operation]) ? value[operation] as Record<string, unknown> : {};
      text = `${operation === 'damage_summon' ? '对' : '使'}${summonSelectionText(payload.selector, options)}${operation === 'damage_summon' ? `造成${formula(payload.amount, options)}点伤害` : `恢复${formula(payload.amount, options)}点生命`}`;
      break;
    }
    case 'modify_summon':
    case 'modify_summon_effect': {
      const payload = isRecord(value[operation]) ? value[operation] as Record<string, unknown> : {};
      const operator = ['add', 'subtract', 'multiply', 'divide', 'set'].find(key => payload[key] !== undefined);
      const stats: Record<string, string> = {
        max_hp: '最大生命', block: '格挡', actions_per_activation: '每次激活行动次数', speed: '速度',
        action_priority: '行动优先级', damage: '行动与能力伤害', lust: '行动与能力欲望', stacks: '行动与能力状态层数',
      };
      if (operator) text = operation === 'modify_summon_effect' ? `为${summonSelectionText(payload.selector, options)}，赋予${stats[String(payload.stat)] || '数值'}${OPERATOR_LABELS[operator]}${formula(payload[operator], options)}（本场战斗）` : `使${summonSelectionText(payload.selector, options)}的${stats[String(payload.stat)] || '数值'}${OPERATOR_LABELS[operator]}${formula(payload[operator], options)}`;
      break;
    }
    case 'summon_resource':
    case 'set_summon_resource': {
      const payload = isRecord(value[operation]) ? value[operation] as Record<string, unknown> : {};
      const name = options.resourceNames?.[String(payload.id)] || String(payload.id || '资源');
      text = operation === 'summon_resource'
        ? `使${summonSelectionText(payload.selector, options)}${resourceDelta(payload.amount, options)}点${name}`
        : `将${summonSelectionText(payload.selector, options)}的${name}设为${formula(payload.value, options)}`;
      if (options.resourceEmojis?.[String(payload.id)]) text = `${options.resourceEmojis[String(payload.id)]} ${text}`;
      break;
    }
    case 'apply_summon_status':
    case 'remove_summon_status': {
      const payload = isRecord(value[operation]) ? value[operation] as Record<string, unknown> : {};
      text = operation === 'apply_summon_status'
        ? `为${summonSelectionText(payload.selector, options)}赋予${formula(payload.stacks ?? 1, options)}层${displayStatusName(payload.id, options)}`
        : `移除${summonSelectionText(payload.selector, options)}的${payload.id === 'all' ? '全部状态' : displayStatusName(payload.id, options)}`;
      break;
    }
    case 'trigger_summon_death': {
      const payload = value.trigger_summon_death;
      if (isRecord(payload)) text = `触发${summonSelectionText(payload.selector, options)}的死亡能力（不使其退场）`;
      break;
    }
    case 'activate_summon':
    case 'dismiss_summon': {
      const payload = isRecord(value[operation]) ? value[operation] as Record<string, unknown> : {};
      text = operation === 'activate_summon'
        ? payload.action && isRecord(payload.action)
          ? `命令${summonSelectionText(payload.selector, options)}发动${String(payload.action.name || payload.action.id || '指定行动')}`
          : `立即激活${summonSelectionText(payload.selector, options)}`
        : `遣散${summonSelectionText(payload.selector, options)}${payload.retain_corpse === true ? '并保留倒下记录' : ''}`;
      break;
    }
    case 'copy_summon': {
      const payload = isRecord(value.copy_summon) ? value.copy_summon : {};
      const owners: Record<string, string> = { same: '原阵营', self: '我方', opponent: '敌方' };
      text = `复制${summonSelectionText(payload.selector, options)}到${owners[String(payload.to ?? 'same')] || '原阵营'}`;
      break;
    }
    case 'guard': {
      const nested = nestedEffectText(value.effects, templates, options);
      text = nested && typeof value.guard === 'string'
        ? `若${condition(value.guard, options)}，依次执行（组条件仅判断一次）：${nested}` : '';
      break;
    }
    case 'summoner_effects': {
      const nested = nestedEffectText(value.summoner_effects, templates, { ...options, resourceNames: options.summonerResourceNames || options.resourceNames, resourceEmojis: options.summonerResourceEmojis || options.resourceEmojis });
      text = nested ? `作用于召唤者：${nested}` : '';
      break;
    }
  }

  return text;
}

function describeEntry(
  value: Record<string, unknown>,
  templates: ReadonlyMap<string, string>,
  options: CompactCardDescriptionOptions,
): string {
  const operations = compactEffectOperationKeys(value);
  if (operations.length === 0) return '';
  if (operations.length > 1 && !operations.every(operation => COMPACT_EFFECT_BUNDLE_OPERATION_SET.has(operation))) {
    return '';
  }
  const texts = sortCompactBundleOperations(operations)
    .map(operation =>
      describeSingleOperation(projectCompactOperation(value, operation, false), operation, templates, options),
    )
    .filter(Boolean);
  if (texts.length !== operations.length) return '';
  let text = texts.join('，并');
  if (typeof value.when === 'string' && value.when.trim()) text = `当${condition(value.when, options)}时，${text}`;
  if (typeof value.on === 'string' && value.on.trim()) {
    text = `${TRIGGER_LABELS[value.on] || value.on}时，${text}`;
  }
  return text;
}

function describeCreatedCardReference(id: string, name: string, options: CompactCardDescriptionOptions): void {
  const notify = options.onCardReference ?? options.onSummonReference;
  if (!notify) return;
  const card = options.cardDefinitions?.[id];
  if (!isRecord(card)) return;
  const trail = options.referenceTrail || [];
  const references: ContentRuleReference[] = [];
  const nested = { ...options, referenceTrail: [...trail, id],
    onCardReference: trail.includes(id) || trail.length >= 8 ? undefined : (reference: ContentRuleReference) => references.push(reference),
    onSummonReference: undefined };
  notify({ id, name, card, rules: describeCompactCard(card, nested), references,
    flavor: normalizeChinesePlayerDescription(card.description) });
}

function describeProtectionRule(value: Record<string, unknown>, options: CompactCardDescriptionOptions): string | null {
  const rule = normalizeDamageProtectionRule(value.protection);
  return rule ? damageProtectionRuleDescription(rule, {
    resolveTargetName: targetId => options.enemyNames?.[targetId],
  }) : null;
}

function describeCompactEffectGroups(
  effects: unknown,
  creates: unknown,
  options: CompactCardDescriptionOptions = {},
): string[] {
  const entries = normalizeCompactEffectEntries(effects);
  if (!entries) return [];
  const definitions = { ...options.cardDefinitions };
  const nextOptions = { ...options, cardDefinitions: definitions,
    stanceNames: { ...collectStanceNames(effects, creates), ...options.stanceNames },
    stanceDefinitions: { ...collectStanceDefinitions(effects, creates), ...options.stanceDefinitions } };
  const templates = new Map<string, string>();
  if (Array.isArray(creates)) for (const entry of creates) {
    if (isRecord(entry) && typeof entry.id === 'string' && typeof entry.name === 'string') {
      templates.set(entry.id, entry.name.trim() || entry.id);
      definitions[entry.id] = entry;
    }
  }
  const groups = summonModifierDisplayGroups(entries.filter(isRecord), 'compact')
    .map(group => joinSummonModifierDescriptions(group.map(effect => describeEntry(effect, templates, nextOptions))))
    .filter(Boolean);
  // Result consumers must stay with the operation that produced the count, in execution order.
  const usesDiscardCount = (entry: unknown): boolean => typeof entry === 'string' ? /\bdiscard_count\b/.test(entry)
    : Array.isArray(entry) ? entry.some(usesDiscardCount) : isRecord(entry) && Object.values(entry).some(usesDiscardCount);
  return usesDiscardCount(entries) && groups.length ? [groups.join('；')] : groups;
}

export function describeCompactEffectList(
  effects: unknown,
  creates?: unknown,
  options: CompactCardDescriptionOptions = {},
): string {
  return describeCompactEffectGroups(effects, creates, options).join('；');
}

/** Structured top-level rule groups for pill rendering. Each group preserves its own bundle and timing. */
export function describeCompactContentRuleGroups(value: unknown, options: CompactCardDescriptionOptions = {}): string[] {
  if (!isRecord(value)) return [];
  const acquired = describeAcquisitionGroup(value, options);
  const protection = describeProtectionRule(value, options);
  const trigger = resolveTriggerInput(value);
  const immediateGroups = (effects: unknown) => {
    const groups = describeCompactEffectGroups(effects, value.creates, options);
    return groups.length && value.when !== undefined ? [`当${condition(value.when, options)}时，${groups.join('；')}`] : groups;
  };
  const triggeredGroups = (effects: unknown) => {
    const entries = normalizeCompactEffectEntries(effects) || [];
    const defaultEffects = entries.filter(effect => !isRecord(effect) || typeof effect.on !== 'string');
    const overridden = entries.filter(effect => isRecord(effect) && typeof effect.on === 'string');
    const prefix = trigger.trigger === 'passive' ? '持续生效，' : `${TRIGGER_LABELS[String(trigger.trigger)] || trigger.trigger}${describeTriggerEventQuery(trigger.eventQuery)}时，`;
    return [...describeCompactEffectGroups(defaultEffects, value.creates, options).map(text => prefix + text),
      ...describeCompactEffectGroups(overridden, value.creates, options)];
  };
  if (trigger.structured) {
    return [...immediateGroups(trigger.immediateEffects), ...(typeof trigger.trigger === 'string' ? triggeredGroups(trigger.triggeredEffects) : []), ...(protection ? [protection] : []), ...acquired];
  }
  if (typeof trigger.trigger !== 'string') return [...immediateGroups(value.effects), ...(protection ? [protection] : []), ...acquired];
  const groups = triggeredGroups(value.effects);
  return [...(groups.length && value.when !== undefined ? [`当${condition(value.when, options)}时，${groups.join('；')}`] : groups), ...(protection ? [protection] : []), ...acquired];
}

export function describeCompactCardRuleGroups(value: unknown, options: CompactCardDescriptionOptions = {}): string[] {
  if (!isRecord(value)) return [];
  const main = [...describeCardPayment(value.payment, options.resourceNames, options.summonNames, options.resourceEmojis), ...describeCompactContentRuleGroups(value, options)];
  const discarded = describeCompactEffectList(value.discard_effects, value.creates, options);
  return [
    ...(options.includeKeywords !== false ? describeCardTraits(value as LifecycleCard).map(trait => trait.name) : []),
    ...(describeSummonPlayRequirement(value.requires_summon, options.summonNames) ? [describeSummonPlayRequirement(value.requires_summon, options.summonNames)!] : []),
    ...(value.type === 'Curse' && main.length ? [`回合结束时，${main.join('；')}`] : main),
    ...(discarded ? [`此牌被战斗效果弃掉后，${discarded}`] : []),
  ];
}

function describeTriggeredEffectList(
  effects: unknown,
  creates: unknown,
  trigger: string,
  options: CompactCardDescriptionOptions,
  eventQuery?: EventTriggerQuery,
): string {
  const entries = normalizeCompactEffectEntries(effects);
  if (!entries) return '';
  const defaultEffects: unknown[] = [];
  const overriddenEffects: unknown[] = [];
  for (const effect of entries) {
    if (isRecord(effect) && typeof effect.on === 'string') overriddenEffects.push(effect);
    else defaultEffects.push(effect);
  }
  const parts: string[] = [];
  const defaultText = describeCompactEffectList(defaultEffects, creates, options);
  if (defaultText) {
    parts.push(
      trigger === 'passive' ? `持续生效，${defaultText}` : `${TRIGGER_LABELS[trigger] || trigger}${describeTriggerEventQuery(eventQuery)}时，${defaultText}`,
    );
  }
  const overriddenText = describeCompactEffectList(overriddenEffects, creates, options);
  if (overriddenText) parts.push(overriddenText);
  return parts.join('；');
}

function describeCompactMain(value: Record<string, unknown>, options: CompactCardDescriptionOptions): string {
  const trigger = resolveTriggerInput(value);
  if (trigger.structured) {
    const immediate = describeCompactEffectList(trigger.immediateEffects, value.creates, options);
    const conditionalImmediate =
      immediate && value.when !== undefined ? `当${condition(value.when, options)}时，${immediate}` : immediate;
    const triggered =
      typeof trigger.trigger === 'string'
        ? describeTriggeredEffectList(trigger.triggeredEffects, value.creates, trigger.trigger, options, trigger.eventQuery)
        : '';
    return [conditionalImmediate, triggered].filter(Boolean).join('；');
  }
  const main =
    typeof trigger.trigger === 'string'
      ? describeTriggeredEffectList(value.effects, value.creates, trigger.trigger, options)
      : describeCompactEffectList(value.effects, value.creates, options);
  return main && value.when !== undefined ? `当${condition(value.when, options)}时，${main}` : main;
}

const DYNAMIC_VALUE_FIELDS = new Set([
  'damage',
  'heal',
  'block',
  'energy',
  'lust',
  'set_hp',
  'set_lust',
  'set_energy',
  'set_block',
  'stacks',
  'draw',
  'scry',
  'seek',
  'discard',
  'exhaust',
  'recover',
  'reduce_cost',
  'copy',
  'double',
  'replay_current',
  'count',
  'add',
  'subtract',
  'multiply',
  'divide',
  'set',
]);

function compactEffectsNeedRuleExplanation(effects: unknown): boolean {
  const entries = normalizeCompactEffectEntries(effects);
  if (!entries) return false;
  return entries.some(entry => {
    if (!isRecord(entry)) return false;
    if (typeof entry.guard === 'string' && entry.guard.trim()) return true;
    if (typeof entry.when === 'string' && entry.when.trim()) return true;
    if (typeof entry.on === 'string' && entry.on.trim()) return true;
    return Object.entries(entry).some(([key, nested]) => {
      if (!DYNAMIC_VALUE_FIELDS.has(key) || typeof nested !== 'string') return false;
      const text = nested.trim();
      return text !== '' && text !== 'all' && !/^-?\d+(?:\.\d+)?$/.test(text);
    });
  });
}

function hasCompactEffects(effects: unknown): boolean {
  const entries = normalizeCompactEffectEntries(effects);
  return Boolean(entries?.some(isRecord));
}

/**
 * Simple literal effects are already clearer as UI tags. Only synthesize a rules
 * sentence when conditions, formulas or secondary programs would otherwise be hidden.
 */
export function needsCompactRuleDescription(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isRecord(value.payment) ||
    typeof value.requires_summon === 'string' ||
    (typeof value.when === 'string' && value.when.trim() !== '') ||
    typeof value.trigger === 'string' ||
    isRecord(value.trigger) ||
    compactEffectsNeedRuleExplanation(value.effects) ||
    compactEffectsNeedRuleExplanation(value.discard_effects) ||
    hasCompactEffects(value.discard_effects) ||
    (Array.isArray(value.creates) && value.creates.length > 0)
    || value.on_acquire !== undefined
  );
}

function describeAcquisitionGroup(value: Record<string, unknown>, options: CompactCardDescriptionOptions): string[] {
  if (value.on_acquire === undefined) return [];
  const text = describeNonCombatSettlement(value.on_acquire, options);
  for (const reference of nonCombatSettlementReferences(value.on_acquire,
    item => describeCompactContent(item, { ...options, onSummonReference: undefined, onCardReference: undefined }))) {
    (options.onCardReference ?? options.onSummonReference)?.(reference);
  }
  return text ? [`获得时：${text}`] : [];
}

/** Build player-facing rules for relics, items, abilities and other shallow effect definitions. */
export function describeCompactContent(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (!isRecord(value)) return '';
  const main = describeCompactMain(value, options);
  const parts = [main, describeProtectionRule(value, options), ...describeAcquisitionGroup(value, options)].filter(Boolean);
  return parts.length ? `${parts.join('；')}。` : '';
}

export function describeCompactContentWhenNeeded(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  return needsCompactRuleDescription(value) ? describeCompactContent(value, options) : '';
}

function mergeAuthoredAndRuleDescription(authored: string, rules: string): string {
  if (!authored) return rules;
  if (!rules) return authored;
  return `${authored.replace(/[。！？；]+$/u, '')}。${rules}`;
}

/** Keep creative prose, but always replace authored mechanical restatements with rules generated from executable data. */
export function resolveCompactContentDescription(
  value: unknown,
  options: CompactCardDescriptionOptions = {},
): string {
  if (!isRecord(value)) return '';
  const authored = normalizeChinesePlayerDescription(value.description);
  const narrative = authored && !isMechanicalDescriptionRestatement(authored) ? authored : '';
  const rules = describeCompactContentWhenNeeded(value, options);
  return mergeAuthoredAndRuleDescription(narrative, rules);
}

export function describeStatusStackChange(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0) return `回合结束后增加${formula(value)}层`;
    if (value < 0) return `回合结束后减少${formula(Math.abs(value))}层`;
    return '';
  }
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'reset') return '回合结束后移除';
  const multiplier = normalized.match(/^x((?:\d+(?:\.\d+)?|\.\d+))$/);
  return multiplier ? `回合结束后层数乘以${multiplier[1]}并向下取整` : '';
}

/** Build player-facing status rules, including triggers, stun, decay and stack cap. */
export function describeCompactStatus(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  const groups = describeCompactStatusRuleGroups(value, options);
  return groups.length ? `${groups.join('；')}。` : '';
}

export function describeCompactStatusRuleGroups(value: unknown, options: CompactCardDescriptionOptions = {}): string[] {
  if (!isRecord(value)) return [];
  const parts: string[] = [];
  if (typeof value.character_emoji === 'string' && value.character_emoji.trim()) parts.push(`持有期间人物外观变为${value.character_emoji}，移除后恢复；多个外观状态以最后获得且仍持有的状态为准`);
  if (value.stun === true) parts.push('持有时无法行动');
  const protection = normalizeDamageProtectionRule(value.protection);
  if (protection) parts.push(damageProtectionRuleDescription(protection, { resolveTargetName: targetId => options.enemyNames?.[targetId] }));
  const defense = normalizeStatusDefenseRule(value.defense);
  if (defense) parts.push(...statusDefenseRuleDescription(defense));
  parts.push(...describeInterceptions(value.intercepts, { formula: v => formula(v, options), condition: v => condition(v, options), effects: v => describeCompactEffectList(v, value.creates, options) }));
  if (isRecord(value.triggers)) {
    for (const trigger of [
      'hold',
      'apply',
      'stack',
      'tick',
      'threshold_execute',
      'remove',
      ...STATUS_EVENT_TRIGGERS,
    ]) {
      const effects = value.triggers[trigger];
      const text = describeCompactEffectList(effects, value.creates, { ...options, implicitTarget: 'self' });
      if (text) {
        parts.push(
          trigger === 'hold'
            ? `${STATUS_TRIGGER_LABELS[trigger]}，${text}`
            : trigger === 'tick'
              ? `持有者${value.tick_timing === 'after_action' ? '行动后' : '行动前'}，${text}`
              : STATUS_EVENT_TRIGGERS.includes(trigger as (typeof STATUS_EVENT_TRIGGERS)[number])
                ? `${TRIGGER_LABELS[trigger] || trigger}时，${text}`
                : `${STATUS_TRIGGER_LABELS[trigger] || trigger}时，${text}`,
        );
      }
    }
  }
  // Missing/empty trigger maps are legal layer markers, not authored bonuses.
  // This is a local structural statement only: another rule may read the
  // layers or observe application/removal. Unknown or unrenderable triggers
  // must not be described as a proven marker merely because their text is empty.
  if (value.stun !== true && !protection && !defense && (value.triggers == null || (isRecord(value.triggers) && Object.keys(value.triggers).length === 0))) {
    parts.push('仅记录状态层数，自身没有额外行动或数值修饰；可供其他规则读取');
  }
  const stackChange = describeStatusStackChange(value.stacks_change);
  if (stackChange) parts.push(stackChange);
  const maxStacks = value.maxStacks;
  if (Number.isInteger(maxStacks) && Number(maxStacks) > 0) parts.push(`最多叠加${maxStacks}层`);
  if (parts.length === 0) parts.push('持续记录层数');
  return parts;
}

export function canGenerateCompactStatusDescription(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.triggers !== undefined) {
    if (!isRecord(value.triggers)) return false;
    if (Object.values(value.triggers).some(effects => normalizeCompactEffectEntries(effects) === null)) return false;
  }
  return describeCompactStatus(value) !== '';
}

/** Build player-facing card rules from the same shallow fields the compiler validates. */
export function describeCompactCard(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (!isRecord(value)) return '';
  const parts: string[] = [];
  if (options.includeKeywords !== false) {
    parts.push(...describeCardTraits(value as LifecycleCard).map(trait => trait.name));
  }

  const requirement = describeSummonPlayRequirement(value.requires_summon, options.summonNames);
  if (requirement) parts.push(requirement);
  parts.push(...describeCardPayment(value.payment, options.resourceNames, options.summonNames, options.resourceEmojis));
  let main = describeCompactMain(value, options);
  if (main && value.type === 'Curse') main = `回合结束时，${main}`;
  if (main) parts.push(main);

  const discarded = describeCompactEffectList(value.discard_effects, value.creates, options);
  if (discarded) parts.push(`此牌被战斗效果弃掉后，${discarded}`);
  return parts.length > 0 ? `${parts.join('。')}。` : '';
}

export function describeCompactCardWhenNeeded(value: unknown, options: CompactCardDescriptionOptions = {}): string {
  if (!isRecord(value) || !needsCompactRuleDescription(value)) return '';
  const parts: string[] = [...describeCardPayment(value.payment, options.resourceNames, options.summonNames, options.resourceEmojis)];
  const requirement = describeSummonPlayRequirement(value.requires_summon, options.summonNames);
  if (requirement) parts.push(requirement);

  const mainNeedsRule =
    typeof value.requires_summon === 'string' ||
    (typeof value.when === 'string' && value.when.trim() !== '') ||
    typeof value.trigger === 'string' ||
    isRecord(value.trigger) ||
    compactEffectsNeedRuleExplanation(value.effects) ||
    (Array.isArray(value.creates) && value.creates.length > 0);
  if (mainNeedsRule) {
    let main = describeCompactMain(value, options);
    if (main && value.type === 'Curse') main = `回合结束时，${main}`;
    if (main) parts.push(main);
  }
  const discarded = describeCompactEffectList(value.discard_effects, value.creates, options);
  if (discarded) parts.push(`此牌被战斗效果弃掉后，${discarded}`);
  return parts.length > 0 ? `${parts.join('。')}。` : '';
}

/** Card-specific display description with authoritative conditional and discard rules. */
export function resolveCompactCardDescription(
  value: unknown,
  options: CompactCardDescriptionOptions = {},
): string {
  if (!isRecord(value)) return '';
  const authored = normalizeChinesePlayerDescription(value.description);
  const narrative = authored && !isMechanicalDescriptionRestatement(authored) ? authored : '';
  const rules = describeCompactCardWhenNeeded(value, options);
  return mergeAuthoredAndRuleDescription(narrative, rules);
}

