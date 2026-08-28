import {
  REGISTERABLE_EFFECT_TRIGGER_SET,
  type RegisterableEffectTrigger,
} from './battleTriggers';
import { roundBattleValue } from './battleMath';
import type { CardOrigin } from './cardIdentity';
import type { PlayedCardDestination } from './cardRules';
import type { CardCostOperator, CardKeyword, CardPatchScope } from './cardPatch';
import type { EnemyTargetSelector } from './combatantCollection';

export const EFFECT_PROGRAM_SPEC = 'mwg.effect/v1' as const;

export type EffectTarget = 'self' | 'opponent';

export type CardZone = 'hand' | 'draw' | 'discard' | 'exhaust' | 'all';
export type CardPick = 'random' | 'choose' | 'left' | 'right' | 'top' | 'bottom' | 'all';
export type CardType = 'Attack' | 'Skill' | 'Power' | 'Event' | 'Curse';
export type CardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Corrupt';
export type RecoverCardZone = 'draw' | 'discard' | 'exhaust';
export type EffectCardPileZone = 'hand' | 'drawPile' | 'discardPile' | 'exhaustPile';
export type ModifierStat = 'damage' | 'damage_taken' | 'lust' | 'lust_taken' | 'heal' | 'block';
export type EffectModifierOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set';
export type CardValueStat = 'damage' | 'block' | 'lust' | 'stacks';
export type CardValueOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type CardPlayRuleKind = 'replay' | 'free';
export type EffectTrigger = RegisterableEffectTrigger;
export type EffectSchedulePhase = 'turn_start' | 'before_draw' | 'after_draw' | 'turn_end';

export interface CardSelector {
  zone: CardZone;
  pick: CardPick;
  count?: number;
  filter?: CardSelectorFilter;
}

export interface CardSelectorFilter {
  types?: CardType[];
  rarities?: CardRarity[];
  cost?: number | 'energy';
  minCost?: number;
  maxCost?: number;
  tags?: string[];
  templateId?: string;
  runInstanceId?: string;
  combatInstanceId?: string;
  origin?: CardOrigin;
  upgraded?: boolean;
}

export type CardPatchMatch = 'instance' | 'run_instance' | 'template' | 'filter';

interface EffectCardPatchBase {
  scope: CardPatchScope;
  match?: CardPatchMatch;
  includeFutureCopies?: boolean;
}

export type EffectCardPatch =
  | (EffectCardPatchBase & {
      kind: 'numeric';
      stat: CardValueStat;
      operator: CardValueOperator;
      value: NumericExpression;
    })
  | (EffectCardPatchBase & {
      kind: 'cost';
      operator: CardCostOperator;
      value: NumericExpression;
    })
  | (EffectCardPatchBase & { kind: 'keyword'; keyword: CardKeyword; enabled: boolean })
  | (EffectCardPatchBase & { kind: 'replay'; extra: NumericExpression })
  | (EffectCardPatchBase & { kind: 'x_value'; operator: CardCostOperator; value: NumericExpression })
  | (EffectCardPatchBase & {
      kind: 'dynamic_cost';
      timing: 'on_draw' | 'while_in_hand' | 'on_play';
      operator: CardCostOperator;
      value: NumericExpression;
      minimum?: number;
      maximum?: number;
    });

export interface GeneratedCardDefinition {
  id: string;
  name: string;
  emoji: string;
  type: CardType;
  rarity: CardRarity;
  cost?: number | 'energy';
  description: string;
  program: EffectProgram;
  discardProgram?: EffectProgram;
  retain?: boolean;
  exhaust?: boolean;
  ethereal?: boolean;
}

export type NumericExpression =
  | number
  | { op: 'var'; path: string }
  | BinaryNumericExpression
  | UnaryNumericExpression
  | { op: 'clamp_min'; value: NumericExpression; minimum: number }
  | AggregateNumericExpression
  | { op: 'count_cards'; selector: CardSelector }
  | { op: 'count_statuses'; target: EffectTarget }
  | { op: 'history'; metric: 'last_damage' | 'last_hp_loss' | 'last_heal' | 'last_resource_spent' }
  | { op: 'intent_value' };

export type BinaryNumericExpression = {
  [TOperator in 'add' | 'subtract' | 'multiply' | 'divide']: {
    op: TOperator;
    left: NumericExpression;
    right: NumericExpression;
  };
}['add' | 'subtract' | 'multiply' | 'divide'];

export type UnaryNumericExpression = {
  [TOperator in 'negate' | 'floor' | 'ceil' | 'abs']: { op: TOperator; value: NumericExpression };
}['negate' | 'floor' | 'ceil' | 'abs'];

export type AggregateNumericExpression = {
  [TOperator in 'min' | 'max']: { op: TOperator; values: NumericExpression[] };
}['min' | 'max'];

export type ConditionExpression =
  | ComparisonCondition
  | { op: 'all' | 'any'; conditions: ConditionExpression[] }
  | { op: 'not'; condition: ConditionExpression }
  | { op: 'last_card_type'; cardType: CardType }
  | { op: 'intent_type'; intentType: string };

export interface ComparisonCondition {
  op: 'compare';
  relation: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  left: NumericExpression;
  right: NumericExpression;
}

export type EffectNode =
  | { op: 'damage'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | { op: 'heal'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | { op: 'gain_block'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | { op: 'gain_energy'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | { op: 'gain_lust'; target: EffectTarget; targetSelector?: EnemyTargetSelector; amount: NumericExpression }
  | {
      op: 'set_stat';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      stat: 'hp' | 'lust' | 'energy' | 'block';
      value: NumericExpression;
    }
  | { op: 'apply_status'; target: EffectTarget; targetSelector?: EnemyTargetSelector; status: string; stacks: NumericExpression }
  | { op: 'remove_status'; target: EffectTarget; targetSelector?: EnemyTargetSelector; status: string }
  | { op: 'draw_cards'; amount: NumericExpression }
  | { op: 'scry_cards'; amount: NumericExpression }
  | { op: 'discard_cards'; selector: CardSelector; amount: NumericExpression }
  | { op: 'exhaust_cards'; selector: CardSelector; amount: NumericExpression }
  | { op: 'recover_cards'; source: RecoverCardZone; pick: 'random' | 'choose' | 'all'; amount: NumericExpression }
  | { op: 'reduce_card_cost'; selector: CardSelector; amount: NumericExpression }
  | {
      op: 'modify_card_value';
      selector: CardSelector;
      stat: CardValueStat;
      operator: CardValueOperator;
      value: NumericExpression;
    }
  | { op: 'copy_cards'; selector: CardSelector }
  | { op: 'double_card_effect'; selector: CardSelector }
  | { op: 'auto_play_cards'; selector: CardSelector; free: boolean }
  | { op: 'set_card_destination'; destination: PlayedCardDestination }
  | {
      op: 'move_cards';
      selector: CardSelector;
      amount: number;
      destination: EffectCardPileZone;
      position: 'top' | 'bottom';
    }
  | { op: 'remove_cards'; selector: CardSelector; amount: number }
  | { op: 'transform_cards'; selector: CardSelector; replacement: GeneratedCardDefinition }
  | { op: 'apply_card_patch'; selector: CardSelector; patch: EffectCardPatch }
  | { op: 'add_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition; count: number }
  | {
      op: 'modify';
      target: EffectTarget;
      targetSelector?: EnemyTargetSelector;
      stat: ModifierStat;
      operator: EffectModifierOperator;
      value: NumericExpression;
    }
  | {
      op: 'card_play_rule';
      target: EffectTarget;
      rule: CardPlayRuleKind;
      limit: NumericExpression | 'all';
      extra?: NumericExpression;
    }
  | { op: 'register_trigger'; target: EffectTarget; trigger: EffectTrigger; effects: EffectNode[] }
  | {
      op: 'schedule_effect';
      afterTurns: number;
      phase: EffectSchedulePhase;
      priority?: number;
      repeatEvery?: number;
      repeats?: number;
      effects: EffectNode[];
    }
  | { op: 'if'; condition: ConditionExpression; then: EffectNode[]; else?: EffectNode[] }
  | { op: 'narrate'; text: string };

export interface EffectProgram {
  spec: typeof EFFECT_PROGRAM_SPEC;
  steps: EffectNode[];
}

export interface CoreCombatantState {
  hp: number;
  maxHp: number;
  lust: number;
  maxLust: number;
  energy: number;
  maxEnergy: number;
  block: number;
  handSize?: number;
  drawPileSize?: number;
  discardPileSize?: number;
  exhaustPileSize?: number;
  statusStacks?: Record<string, number>;
}

export interface CoreEffectState {
  self: CoreCombatantState;
  opponent: CoreCombatantState;
  currentTurn: number;
  cardsPlayedThisTurn: number;
  attacksPlayedThisTurn: number;
  skillsPlayedThisTurn: number;
  cardZones?: {
    hand: CoreCardView[];
    draw: CoreCardView[];
    discard: CoreCardView[];
    exhaust: CoreCardView[];
  };
  history?: {
    lastDamage?: number;
    lastHpLoss?: number;
    lastHeal?: number;
    lastResourceSpent?: number;
    lastCardType?: string;
  };
  enemyIntentValue?: number;
  enemyIntentType?: string;
}

export interface CoreCardView {
  id: string;
  type?: CardType;
  rarity?: CardRarity;
  cost?: number | 'energy';
  tags?: string[];
  originalId?: string;
  templateId?: string;
  runInstanceId?: string;
  combatInstanceId?: string;
  origin?: CardOrigin;
  upgraded?: boolean;
  upgradeLevel?: number;
}

export interface EffectExecutionContext {
  spentEnergy: number;
  xValue?: number;
  statusStacks?: number;
}

export interface EffectValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type EffectValidationResult =
  { ok: true; value: EffectProgram } | { ok: false; issues: EffectValidationIssue[] };

export type CoreEffectEvent =
  | { type: 'damage'; target: EffectTarget; requested: number; blocked: number; hpLost: number }
  | { type: 'heal'; target: EffectTarget; requested: number; hpGained: number }
  | { type: 'gain_block'; target: EffectTarget; amount: number }
  | { type: 'gain_energy'; target: EffectTarget; amount: number }
  | { type: 'gain_lust'; target: EffectTarget; amount: number }
  | { type: 'set_stat'; target: EffectTarget; stat: 'hp' | 'lust' | 'energy' | 'block'; value: number }
  | { type: 'apply_status'; target: EffectTarget; status: string; stacks: number }
  | { type: 'remove_status'; target: EffectTarget; status: string }
  | { type: 'draw_cards'; amount: number }
  | { type: 'scry_cards'; amount: number }
  | { type: 'discard_cards' | 'exhaust_cards'; selector: CardSelector; amount: number }
  | { type: 'recover_cards'; source: RecoverCardZone; pick: 'random' | 'choose' | 'all'; amount: number }
  | { type: 'reduce_card_cost'; selector: CardSelector; amount: number }
  | {
      type: 'modify_card_value';
      selector: CardSelector;
      stat: CardValueStat;
      operator: CardValueOperator;
      value: number;
    }
  | { type: 'copy_cards' | 'double_card_effect'; selector: CardSelector }
  | { type: 'auto_play_cards'; selector: CardSelector; free: boolean }
  | { type: 'set_card_destination'; destination: PlayedCardDestination }
  | {
      type: 'move_cards';
      selector: CardSelector;
      amount: number;
      destination: EffectCardPileZone;
      position: 'top' | 'bottom';
    }
  | { type: 'remove_cards'; selector: CardSelector; amount: number }
  | { type: 'transform_cards'; selector: CardSelector; replacement: GeneratedCardDefinition }
  | { type: 'apply_card_patch'; selector: CardSelector; patch: EffectCardPatch }
  | { type: 'add_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition; count: number }
  | {
      type: 'modify';
      target: EffectTarget;
      stat: ModifierStat;
      operator: EffectModifierOperator;
      value: number;
    }
  | {
      type: 'card_play_rule';
      target: EffectTarget;
      rule: CardPlayRuleKind;
      limit: number | 'all';
      extra: number;
    }
  | { type: 'register_trigger'; target: EffectTarget; trigger: EffectTrigger; effects: EffectNode[] }
  | {
      type: 'schedule_effect';
      afterTurns: number;
      phase: EffectSchedulePhase;
      priority: number;
      repeatEvery?: number;
      repeats?: number;
      effects: EffectNode[];
    }
  | { type: 'narration'; text: string };

export type EffectExecutionResult =
  | { ok: true; state: CoreEffectState; events: CoreEffectEvent[] }
  | { ok: false; error: EffectExecutionError; state: CoreEffectState; events: [] };

export class EffectExecutionError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'EffectExecutionError';
  }
}

const MAX_AST_DEPTH = 32;
const MAX_AST_NODES = 256;
const TARGETS = new Set<EffectTarget>(['self', 'opponent']);
const BINARY_NUMBER_OPS = new Set(['add', 'subtract', 'multiply', 'divide']);
const UNARY_NUMBER_OPS = new Set(['negate', 'floor', 'ceil', 'abs']);
const RELATIONS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
const EFFECT_OPS = new Set([
  'damage',
  'heal',
  'gain_block',
  'gain_energy',
  'gain_lust',
  'set_stat',
  'apply_status',
  'remove_status',
  'draw_cards',
  'scry_cards',
  'discard_cards',
  'exhaust_cards',
  'recover_cards',
  'reduce_card_cost',
  'modify_card_value',
  'copy_cards',
  'double_card_effect',
  'auto_play_cards',
  'set_card_destination',
  'move_cards',
  'remove_cards',
  'transform_cards',
  'apply_card_patch',
  'add_card',
  'modify',
  'card_play_rule',
  'register_trigger',
  'schedule_effect',
  'if',
  'narrate',
]);
const CARD_ZONES = new Set<CardZone>(['hand', 'draw', 'discard', 'exhaust', 'all']);
const CARD_PICKS = new Set<CardPick>(['random', 'choose', 'left', 'right', 'top', 'bottom', 'all']);
const CARD_TYPES = new Set<CardType>(['Attack', 'Skill', 'Power', 'Event', 'Curse']);
const CARD_RARITIES = new Set<CardRarity>(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt']);
const CARD_ORIGINS = new Set<CardOrigin>(['deck', 'generated', 'copied', 'transformed']);
const CARD_PATCH_SCOPES = new Set<CardPatchScope>(['resolution', 'turn', 'until_played', 'combat', 'run', 'permanent']);
const CARD_PATCH_MATCHES = new Set<CardPatchMatch>(['instance', 'run_instance', 'template', 'filter']);
const CARD_COST_OPERATORS = new Set<CardCostOperator>(['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max']);
const CARD_KEYWORDS = new Set<CardKeyword>(['retain', 'exhaust', 'ethereal', 'innate']);
const MODIFIER_STATS = new Set<ModifierStat>(['damage', 'damage_taken', 'lust', 'lust_taken', 'heal', 'block']);
const MODIFIER_OPERATORS = new Set<EffectModifierOperator>(['add', 'subtract', 'multiply', 'divide', 'set']);
const CARD_VALUE_STATS = new Set<CardValueStat>(['damage', 'block', 'lust', 'stacks']);
const CARD_VALUE_OPERATORS = new Set<CardValueOperator>(['add', 'subtract', 'multiply', 'divide']);
const CARD_PLAY_RULES = new Set<CardPlayRuleKind>(['replay', 'free']);
const STATUS_ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isComparisonCondition(value: ConditionExpression): value is ComparisonCondition {
  return value.op === 'compare';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function addIssue(issues: EffectValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: EffectValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) addIssue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', `未知字段: ${key}`);
  }
}

function validateNumericExpression(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  counter.value += 1;
  if (counter.value > MAX_AST_NODES)
    return addIssue(issues, path, 'TOO_MANY_NODES', `AST 节点不能超过 ${MAX_AST_NODES}`);
  if (depth > MAX_AST_DEPTH) return addIssue(issues, path, 'TOO_DEEP', `AST 深度不能超过 ${MAX_AST_DEPTH}`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) addIssue(issues, path, 'NON_FINITE_NUMBER', '数字必须是有限值');
    return;
  }
  if (!isRecord(value) || typeof value.op !== 'string') {
    addIssue(issues, path, 'INVALID_NUMBER_EXPRESSION', '数值必须是有限数字或数值表达式对象');
    return;
  }
  if (value.op === 'var') {
    rejectUnknownKeys(value, ['op', 'path'], path, issues);
    if (typeof value.path !== 'string' || value.path.trim() === '')
      addIssue(issues, `${path}.path`, 'INVALID_VARIABLE_PATH', '变量路径必须是非空字符串');
    else if (!isSupportedVariablePath(value.path))
      addIssue(issues, `${path}.path`, 'UNKNOWN_VARIABLE', `不支持的变量路径: ${value.path}`);
    return;
  }
  if (BINARY_NUMBER_OPS.has(value.op)) {
    rejectUnknownKeys(value, ['op', 'left', 'right'], path, issues);
    validateNumericExpression(value.left, `${path}.left`, issues, depth + 1, counter);
    validateNumericExpression(value.right, `${path}.right`, issues, depth + 1, counter);
    return;
  }
  if (UNARY_NUMBER_OPS.has(value.op)) {
    rejectUnknownKeys(value, ['op', 'value'], path, issues);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    return;
  }
  if (value.op === 'clamp_min') {
    rejectUnknownKeys(value, ['op', 'value', 'minimum'], path, issues);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    if (typeof value.minimum !== 'number' || !Number.isFinite(value.minimum)) {
      addIssue(issues, `${path}.minimum`, 'NON_FINITE_NUMBER', 'clamp_min minimum 必须是有限数字');
    }
    return;
  }
  if (value.op === 'min' || value.op === 'max') {
    rejectUnknownKeys(value, ['op', 'values'], path, issues);
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 32)
      addIssue(issues, `${path}.values`, 'INVALID_NUMBER_EXPRESSION', 'min/max 需要 1 到 32 个数值');
    else value.values.forEach((entry, index) => validateNumericExpression(entry, `${path}.values[${index}]`, issues, depth + 1, counter));
    return;
  }
  if (value.op === 'count_cards') {
    rejectUnknownKeys(value, ['op', 'selector'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    return;
  }
  if (value.op === 'count_statuses') {
    rejectUnknownKeys(value, ['op', 'target'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    return;
  }
  if (value.op === 'history') {
    rejectUnknownKeys(value, ['op', 'metric'], path, issues);
    if (!['last_damage', 'last_hp_loss', 'last_heal', 'last_resource_spent'].includes(String(value.metric)))
      addIssue(issues, `${path}.metric`, 'INVALID_HISTORY_METRIC', `不支持的历史值: ${String(value.metric)}`);
    return;
  }
  if (value.op === 'intent_value') {
    rejectUnknownKeys(value, ['op'], path, issues);
    return;
  }
  addIssue(issues, `${path}.op`, 'UNKNOWN_NUMBER_OPERATOR', `不支持的数值运算: ${value.op}`);
}

function validateCondition(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  counter.value += 1;
  if (counter.value > MAX_AST_NODES)
    return addIssue(issues, path, 'TOO_MANY_NODES', `AST 节点不能超过 ${MAX_AST_NODES}`);
  if (depth > MAX_AST_DEPTH) return addIssue(issues, path, 'TOO_DEEP', `AST 深度不能超过 ${MAX_AST_DEPTH}`);
  if (!isRecord(value) || typeof value.op !== 'string')
    return addIssue(issues, path, 'INVALID_CONDITION', '条件必须是带 op 字段的对象');
  if (value.op === 'compare') {
    rejectUnknownKeys(value, ['op', 'relation', 'left', 'right'], path, issues);
    if (typeof value.relation !== 'string' || !RELATIONS.has(value.relation))
      addIssue(issues, `${path}.relation`, 'UNKNOWN_RELATION', `不支持的比较关系: ${String(value.relation)}`);
    validateNumericExpression(value.left, `${path}.left`, issues, depth + 1, counter);
    validateNumericExpression(value.right, `${path}.right`, issues, depth + 1, counter);
    return;
  }
  if (value.op === 'all' || value.op === 'any') {
    rejectUnknownKeys(value, ['op', 'conditions'], path, issues);
    if (!Array.isArray(value.conditions) || value.conditions.length === 0)
      return addIssue(issues, `${path}.conditions`, 'EMPTY_CONDITIONS', 'all/any 至少需要一个条件');
    value.conditions.forEach((condition, index) =>
      validateCondition(condition, `${path}.conditions[${index}]`, issues, depth + 1, counter),
    );
    return;
  }
  if (value.op === 'not') {
    rejectUnknownKeys(value, ['op', 'condition'], path, issues);
    validateCondition(value.condition, `${path}.condition`, issues, depth + 1, counter);
    return;
  }
  addIssue(issues, `${path}.op`, 'UNKNOWN_CONDITION_OPERATOR', `不支持的条件运算: ${value.op}`);
}

function validateCardSelector(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_CARD_SELECTOR', '卡牌选择器必须是对象');
  rejectUnknownKeys(value, ['zone', 'pick', 'count', 'filter'], path, issues);
  if (!CARD_ZONES.has(value.zone as CardZone))
    addIssue(issues, `${path}.zone`, 'INVALID_CARD_ZONE', `不支持的牌区: ${String(value.zone)}`);
  if (!CARD_PICKS.has(value.pick as CardPick))
    addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', `不支持的选择方式: ${String(value.pick)}`);
  if (
    value.count !== undefined &&
    (!Number.isInteger(value.count) || (value.count as number) < 1 || (value.count as number) > 100)
  ) {
    addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', '选择数量必须是 1 到 100 的整数');
  }
  if ((value.pick === 'left' || value.pick === 'right') && value.zone !== 'hand')
    addIssue(issues, path, 'INVALID_CARD_SELECTOR', '左侧/右侧选择只适用于手牌');
  if ((value.pick === 'top' || value.pick === 'bottom') && !['draw', 'discard', 'exhaust'].includes(String(value.zone)))
    addIssue(issues, path, 'INVALID_CARD_SELECTOR', '顶部/底部选择只适用于抽牌堆、弃牌堆或消耗堆');
  if (value.zone === 'all' && value.pick !== 'all')
    addIssue(issues, path, 'INVALID_CARD_SELECTOR', '跨全部牌区时只能选择全部卡牌');
  if (value.pick === 'all' && value.count !== undefined)
    addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', '选择全部卡牌时不能再指定数量');
  if (value.filter !== undefined) validateCardSelectorFilter(value.filter, `${path}.filter`, issues);
}

function validateStringList(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string> | null,
  issues: EffectValidationIssue[],
): void {
  if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string' || !entry.trim())) {
    addIssue(issues, path, 'INVALID_CARD_FILTER', '过滤列表必须是非空字符串数组');
    return;
  }
  if (allowed && value.some(entry => !allowed.has(entry))) {
    addIssue(issues, path, 'INVALID_CARD_FILTER', `过滤列表包含不支持的值: ${value.join(',')}`);
  }
}

function validateCardSelectorFilter(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_CARD_FILTER', '卡牌过滤器必须是对象');
  rejectUnknownKeys(
    value,
    ['types', 'rarities', 'cost', 'minCost', 'maxCost', 'tags', 'templateId', 'runInstanceId', 'combatInstanceId', 'origin', 'upgraded'],
    path,
    issues,
  );
  if (value.types !== undefined) validateStringList(value.types, `${path}.types`, CARD_TYPES, issues);
  if (value.rarities !== undefined) validateStringList(value.rarities, `${path}.rarities`, CARD_RARITIES, issues);
  if (value.tags !== undefined) validateStringList(value.tags, `${path}.tags`, null, issues);
  if (value.cost !== undefined && value.cost !== 'energy' && (typeof value.cost !== 'number' || !Number.isFinite(value.cost) || value.cost < 0))
    addIssue(issues, `${path}.cost`, 'INVALID_CARD_FILTER', '费用过滤必须是非负有限数值或 energy');
  for (const key of ['minCost', 'maxCost'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0))
      addIssue(issues, `${path}.${key}`, 'INVALID_CARD_FILTER', '费用边界必须是非负有限数值');
  }
  if (typeof value.minCost === 'number' && typeof value.maxCost === 'number' && value.minCost > value.maxCost)
    addIssue(issues, path, 'INVALID_CARD_FILTER', '最低费用不能高于最高费用');
  for (const key of ['templateId', 'runInstanceId', 'combatInstanceId'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key].trim()))
      addIssue(issues, `${path}.${key}`, 'INVALID_CARD_FILTER', '身份过滤值必须是非空字符串');
  }
  if (value.origin !== undefined && !CARD_ORIGINS.has(value.origin as CardOrigin))
    addIssue(issues, `${path}.origin`, 'INVALID_CARD_FILTER', `不支持的卡牌来源: ${String(value.origin)}`);
  if (value.upgraded !== undefined && typeof value.upgraded !== 'boolean')
    addIssue(issues, `${path}.upgraded`, 'INVALID_CARD_FILTER', '升级过滤必须是布尔值');
}

function validateEffectCardPatch(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_CARD_PATCH', '卡牌补丁必须是对象');
  const common = ['kind', 'scope', 'match', 'includeFutureCopies'];
  if (!CARD_PATCH_SCOPES.has(value.scope as CardPatchScope))
    addIssue(issues, `${path}.scope`, 'INVALID_CARD_PATCH_SCOPE', `不支持的补丁作用域: ${String(value.scope)}`);
  if (value.match !== undefined && !CARD_PATCH_MATCHES.has(value.match as CardPatchMatch))
    addIssue(issues, `${path}.match`, 'INVALID_CARD_PATCH_MATCH', `不支持的补丁目标范围: ${String(value.match)}`);
  if (value.includeFutureCopies !== undefined && typeof value.includeFutureCopies !== 'boolean')
    addIssue(issues, `${path}.includeFutureCopies`, 'INVALID_CARD_PATCH', 'includeFutureCopies 必须是布尔值');
  if (value.includeFutureCopies === true && value.match !== 'template' && value.match !== 'filter')
    addIssue(issues, `${path}.includeFutureCopies`, 'INVALID_CARD_PATCH_MATCH', '未来副本只适用于模板或过滤器范围');

  if (value.kind === 'numeric') {
    rejectUnknownKeys(value, [...common, 'stat', 'operator', 'value'], path, issues);
    if (!CARD_VALUE_STATS.has(value.stat as CardValueStat))
      addIssue(issues, `${path}.stat`, 'INVALID_CARD_VALUE_STAT', `不支持的卡牌数值类型: ${String(value.stat)}`);
    if (!CARD_VALUE_OPERATORS.has(value.operator as CardValueOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_CARD_VALUE_OPERATOR', `不支持的数值补丁运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.kind === 'cost') {
    rejectUnknownKeys(value, [...common, 'operator', 'value'], path, issues);
    if (!CARD_COST_OPERATORS.has(value.operator as CardCostOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_CARD_COST_OPERATOR', `不支持的费用补丁运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.kind === 'keyword') {
    rejectUnknownKeys(value, [...common, 'keyword', 'enabled'], path, issues);
    if (!CARD_KEYWORDS.has(value.keyword as CardKeyword))
      addIssue(issues, `${path}.keyword`, 'INVALID_CARD_KEYWORD', `不支持的卡牌关键词: ${String(value.keyword)}`);
    if (typeof value.enabled !== 'boolean')
      addIssue(issues, `${path}.enabled`, 'INVALID_CARD_PATCH', '关键词补丁 enabled 必须是布尔值');
  } else if (value.kind === 'replay') {
    rejectUnknownKeys(value, [...common, 'extra'], path, issues);
    validateNumericExpression(value.extra, `${path}.extra`, issues, depth + 1, counter);
  } else if (value.kind === 'x_value') {
    rejectUnknownKeys(value, [...common, 'operator', 'value'], path, issues);
    if (!CARD_COST_OPERATORS.has(value.operator as CardCostOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_X_VALUE_OPERATOR', `不支持的X值补丁运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.kind === 'dynamic_cost') {
    rejectUnknownKeys(value, [...common, 'timing', 'operator', 'value', 'minimum', 'maximum'], path, issues);
    if (!['on_draw', 'while_in_hand', 'on_play'].includes(String(value.timing)))
      addIssue(issues, `${path}.timing`, 'INVALID_DYNAMIC_COST_TIMING', `不支持的动态费用时机: ${String(value.timing)}`);
    if (!CARD_COST_OPERATORS.has(value.operator as CardCostOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_CARD_COST_OPERATOR', `不支持的动态费用运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
    if (value.minimum !== undefined && (typeof value.minimum !== 'number' || !Number.isFinite(value.minimum)))
      addIssue(issues, `${path}.minimum`, 'INVALID_DYNAMIC_COST_BOUND', '动态费用下限必须是有限数值');
    if (value.maximum !== undefined && (typeof value.maximum !== 'number' || !Number.isFinite(value.maximum)))
      addIssue(issues, `${path}.maximum`, 'INVALID_DYNAMIC_COST_BOUND', '动态费用上限必须是有限数值');
    if (typeof value.minimum === 'number' && typeof value.maximum === 'number' && value.minimum > value.maximum)
      addIssue(issues, path, 'INVALID_DYNAMIC_COST_BOUND', '动态费用下限不能大于上限');
  } else {
    rejectUnknownKeys(value, common, path, issues);
    addIssue(issues, `${path}.kind`, 'INVALID_CARD_PATCH', `不支持的卡牌补丁类型: ${String(value.kind)}`);
  }
}

function validateGeneratedCard(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_GENERATED_CARD', '生成卡牌必须是对象');
  rejectUnknownKeys(
    value,
    [
      'id',
      'name',
      'emoji',
      'type',
      'rarity',
      'cost',
      'description',
      'program',
      'discardProgram',
      'retain',
      'exhaust',
      'ethereal',
    ],
    path,
    issues,
  );
  if (typeof value.id !== 'string' || !STATUS_ID_PATTERN.test(value.id))
    addIssue(issues, `${path}.id`, 'INVALID_CARD_ID', `生成卡牌 ID 无效: ${String(value.id)}`);
  if (typeof value.name !== 'string' || !value.name.trim())
    addIssue(issues, `${path}.name`, 'INVALID_CARD_NAME', '生成卡牌名称不能为空');
  if (typeof value.emoji !== 'string') addIssue(issues, `${path}.emoji`, 'INVALID_CARD_EMOJI', 'emoji 必须是字符串');
  if (!['Attack', 'Skill', 'Power', 'Event', 'Curse'].includes(String(value.type)))
    addIssue(issues, `${path}.type`, 'INVALID_CARD_TYPE', `不支持的卡牌类型: ${String(value.type)}`);
  if (!['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt'].includes(String(value.rarity)))
    addIssue(issues, `${path}.rarity`, 'INVALID_CARD_RARITY', `不支持的稀有度: ${String(value.rarity)}`);
  if (value.type === 'Curse') {
    if (value.cost !== undefined) addIssue(issues, `${path}.cost`, 'INVALID_CARD_COST', 'Curse 不能带 cost');
  } else if (value.cost !== 'energy' && (!Number.isInteger(value.cost) || (value.cost as number) < 0)) {
    addIssue(issues, `${path}.cost`, 'INVALID_CARD_COST', '卡牌费用必须是非负整数或 energy');
  }
  if (typeof value.description !== 'string')
    addIssue(issues, `${path}.description`, 'INVALID_CARD_DESCRIPTION', 'description 必须是字符串');
  for (const flag of ['retain', 'exhaust', 'ethereal'] as const) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean')
      addIssue(issues, `${path}.${flag}`, 'INVALID_CARD_FLAG', `${flag} 必须是布尔值`);
  }
  const program = validateEffectProgram(value.program);
  if (!program.ok) {
    program.issues.forEach(issue =>
      addIssue(issues, `${path}.program${issue.path === '$' ? '' : issue.path.slice(1)}`, issue.code, issue.message),
    );
  }
  if (value.discardProgram !== undefined) {
    const discardProgram = validateEffectProgram(value.discardProgram);
    if (!discardProgram.ok) {
      discardProgram.issues.forEach(issue =>
        addIssue(
          issues,
          `${path}.discardProgram${issue.path === '$' ? '' : issue.path.slice(1)}`,
          issue.code,
          issue.message,
        ),
      );
    }
  }
}

function validateEnemyTargetSelector(value: unknown, path: string, issues: EffectValidationIssue[]): void {
  if (!isRecord(value)) return addIssue(issues, path, 'INVALID_TARGET_SELECTOR', '敌人目标选择器必须是对象');
  const mode = value.mode;
  const modes = new Set(['active', 'by_id', 'all', 'random', 'random_n', 'lowest_hp', 'highest_hp']);
  if (!modes.has(String(mode)))
    addIssue(issues, `${path}.mode`, 'INVALID_TARGET_SELECTOR', `不支持的敌人目标模式：${String(mode)}`);
  const randomMode = mode === 'random' || mode === 'random_n';
  rejectUnknownKeys(
    value,
    mode === 'by_id'
      ? ['mode', 'id']
      : randomMode
        ? ['mode', 'count', 'allowRepeat', 'retarget']
        : ['mode'],
    path,
    issues,
  );
  if (mode === 'by_id' && (typeof value.id !== 'string' || !value.id.trim()))
    addIssue(issues, `${path}.id`, 'INVALID_TARGET_SELECTOR', '指定目标必须提供非空敌人 ID');
  if (mode === 'random_n' && (!Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 100))
    addIssue(issues, `${path}.count`, 'INVALID_TARGET_SELECTOR', '随机目标次数必须是 1 到 100 的整数');
  if (value.allowRepeat !== undefined && typeof value.allowRepeat !== 'boolean')
    addIssue(issues, `${path}.allowRepeat`, 'INVALID_TARGET_SELECTOR', 'allowRepeat 必须是布尔值');
  if (value.retarget !== undefined && value.retarget !== 'locked' && value.retarget !== 'each_hit')
    addIssue(issues, `${path}.retarget`, 'INVALID_TARGET_SELECTOR', 'retarget 只能是 locked 或 each_hit');
}

function validateTargetSelectorForNode(value: Record<string, any>, path: string, issues: EffectValidationIssue[]): void {
  if (value.targetSelector === undefined) return;
  if (value.target !== 'opponent')
    addIssue(issues, `${path}.targetSelector`, 'INVALID_TARGET_SELECTOR', '敌人集合选择器只能用于 opponent');
  validateEnemyTargetSelector(value.targetSelector, `${path}.targetSelector`, issues);
}

function validateEffectNode(
  value: unknown,
  path: string,
  issues: EffectValidationIssue[],
  depth: number,
  counter: { value: number },
): void {
  counter.value += 1;
  if (counter.value > MAX_AST_NODES)
    return addIssue(issues, path, 'TOO_MANY_NODES', `AST 节点不能超过 ${MAX_AST_NODES}`);
  if (depth > MAX_AST_DEPTH) return addIssue(issues, path, 'TOO_DEEP', `AST 深度不能超过 ${MAX_AST_DEPTH}`);
  if (!isRecord(value) || typeof value.op !== 'string')
    return addIssue(issues, path, 'INVALID_EFFECT', '效果必须是带 op 字段的对象');
  if (!EFFECT_OPS.has(value.op))
    return addIssue(issues, `${path}.op`, 'UNKNOWN_EFFECT_OPERATOR', `不支持的效果操作: ${value.op}`);
  else if (value.op === 'if') {
    rejectUnknownKeys(value, ['op', 'condition', 'then', 'else'], path, issues);
    validateCondition(value.condition, `${path}.condition`, issues, depth + 1, counter);
    if (!Array.isArray(value.then) || value.then.length === 0)
      addIssue(issues, `${path}.then`, 'EMPTY_EFFECT_BRANCH', 'then 至少需要一个效果');
    else
      value.then.forEach((effect, index) =>
        validateEffectNode(effect, `${path}.then[${index}]`, issues, depth + 1, counter),
      );
    if (value.else !== undefined) {
      if (!Array.isArray(value.else)) addIssue(issues, `${path}.else`, 'INVALID_EFFECT_BRANCH', 'else 必须是效果数组');
      else
        value.else.forEach((effect, index) =>
          validateEffectNode(effect, `${path}.else[${index}]`, issues, depth + 1, counter),
        );
    }
  } else if (value.op === 'narrate') {
    rejectUnknownKeys(value, ['op', 'text'], path, issues);
    if (typeof value.text !== 'string' || value.text.trim() === '')
      addIssue(issues, `${path}.text`, 'EMPTY_NARRATION', '叙事文本不能为空');
  } else if (value.op === 'set_stat') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'stat', 'value'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (!['hp', 'lust', 'energy', 'block'].includes(String(value.stat)))
      addIssue(issues, `${path}.stat`, 'INVALID_STAT', `不支持的属性: ${String(value.stat)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'apply_status') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'status', 'stacks'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (typeof value.status !== 'string' || !STATUS_ID_PATTERN.test(value.status))
      addIssue(issues, `${path}.status`, 'INVALID_STATUS_ID', `状态 ID 无效: ${String(value.status)}`);
    validateNumericExpression(value.stacks, `${path}.stacks`, issues, depth + 1, counter);
  } else if (value.op === 'remove_status') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'status'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (
      typeof value.status !== 'string' ||
      (!STATUS_ID_PATTERN.test(value.status) && !['all', 'buffs', 'debuffs'].includes(value.status))
    ) {
      addIssue(issues, `${path}.status`, 'INVALID_STATUS_ID', `状态 ID 无效: ${String(value.status)}`);
    }
  } else if (value.op === 'draw_cards' || value.op === 'scry_cards') {
    rejectUnknownKeys(value, ['op', 'amount'], path, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'discard_cards' || value.op === 'exhaust_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'recover_cards') {
    rejectUnknownKeys(value, ['op', 'source', 'pick', 'amount'], path, issues);
    if (value.source !== 'draw' && value.source !== 'discard' && value.source !== 'exhaust')
      addIssue(issues, `${path}.source`, 'INVALID_CARD_ZONE', '移入手牌的来源只能是 draw、discard 或 exhaust');
    if (value.pick !== 'random' && value.pick !== 'choose' && value.pick !== 'all')
      addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', '取回选择只能是 random、choose 或 all');
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'reduce_card_cost') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  } else if (value.op === 'modify_card_value') {
    rejectUnknownKeys(value, ['op', 'selector', 'stat', 'operator', 'value'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (!CARD_VALUE_STATS.has(value.stat as CardValueStat)) {
      addIssue(issues, `${path}.stat`, 'INVALID_CARD_VALUE_STAT', `不支持的卡牌数值类型: ${String(value.stat)}`);
    }
    if (!CARD_VALUE_OPERATORS.has(value.operator as CardValueOperator)) {
      addIssue(issues, `${path}.operator`, 'INVALID_CARD_VALUE_OPERATOR', `不支持的卡牌数值运算: ${String(value.operator)}`);
    }
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'copy_cards' || value.op === 'double_card_effect') {
    rejectUnknownKeys(value, ['op', 'selector'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
  } else if (value.op === 'auto_play_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'free'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (value.free !== true && value.free !== false)
      addIssue(issues, `${path}.free`, 'INVALID_AUTO_PLAY_COST', '自动打出必须明确是否免费');
  } else if (value.op === 'set_card_destination') {
    rejectUnknownKeys(value, ['op', 'destination'], path, issues);
    if (!['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(String(value.destination)))
      addIssue(issues, `${path}.destination`, 'INVALID_CARD_DESTINATION', `不支持的结算后牌区: ${String(value.destination)}`);
  } else if (value.op === 'move_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount', 'destination', 'position'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (typeof value.amount !== 'number' || !Number.isInteger(value.amount) || value.amount < 1 || value.amount > 100)
      addIssue(issues, `${path}.amount`, 'INVALID_CARD_COUNT', '移动数量必须是 1 到 100 的整数');
    if (!['hand', 'drawPile', 'discardPile', 'exhaustPile'].includes(String(value.destination)))
      addIssue(issues, `${path}.destination`, 'INVALID_CARD_ZONE', `不支持的目标牌区: ${String(value.destination)}`);
    if (value.position !== 'top' && value.position !== 'bottom')
      addIssue(issues, `${path}.position`, 'INVALID_CARD_POSITION', '牌区位置只能是 top 或 bottom');
  } else if (value.op === 'remove_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'amount'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    if (typeof value.amount !== 'number' || !Number.isInteger(value.amount) || value.amount < 1 || value.amount > 100)
      addIssue(issues, `${path}.amount`, 'INVALID_CARD_COUNT', '移除数量必须是 1 到 100 的整数');
  } else if (value.op === 'transform_cards') {
    rejectUnknownKeys(value, ['op', 'selector', 'replacement'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateGeneratedCard(value.replacement, `${path}.replacement`, issues);
  } else if (value.op === 'apply_card_patch') {
    rejectUnknownKeys(value, ['op', 'selector', 'patch'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
    validateEffectCardPatch(value.patch, `${path}.patch`, issues, depth, counter);
  } else if (value.op === 'add_card') {
    rejectUnknownKeys(value, ['op', 'zone', 'card', 'count'], path, issues);
    if (value.zone !== 'hand' && value.zone !== 'draw')
      addIssue(issues, `${path}.zone`, 'INVALID_CARD_ZONE', '生成卡牌只能加入 hand 或 draw');
    if (!Number.isInteger(value.count) || (value.count as number) < 1 || (value.count as number) > 100)
      addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', '生成数量必须是 1 到 100 的整数');
    validateGeneratedCard(value.card, `${path}.card`, issues);
  } else if (value.op === 'modify') {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'stat', 'operator', 'value'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    if (!MODIFIER_STATS.has(value.stat as ModifierStat))
      addIssue(issues, `${path}.stat`, 'INVALID_MODIFIER', `不支持的修饰项: ${String(value.stat)}`);
    if (!MODIFIER_OPERATORS.has(value.operator as EffectModifierOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_MODIFIER_OPERATOR', `不支持的修饰运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'card_play_rule') {
    rejectUnknownKeys(value, ['op', 'target', 'rule', 'limit', 'extra'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget)) {
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    }
    if (!CARD_PLAY_RULES.has(value.rule as CardPlayRuleKind)) {
      addIssue(issues, `${path}.rule`, 'INVALID_CARD_PLAY_RULE', `不支持的出牌规则: ${String(value.rule)}`);
    }
    if (value.limit !== 'all') {
      validateNumericExpression(value.limit, `${path}.limit`, issues, depth + 1, counter);
    }
    if (value.rule === 'replay') {
      if (value.extra === undefined) {
        addIssue(issues, `${path}.extra`, 'MISSING_CARD_REPLAY_COUNT', '重复结算规则必须提供 extra');
      } else {
        validateNumericExpression(value.extra, `${path}.extra`, issues, depth + 1, counter);
      }
    } else if (value.extra !== undefined) {
      addIssue(issues, `${path}.extra`, 'UNEXPECTED_CARD_REPLAY_COUNT', '免消耗规则不能提供 extra');
    }
  } else if (value.op === 'register_trigger') {
    rejectUnknownKeys(value, ['op', 'target', 'trigger', 'effects'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    if (!REGISTERABLE_EFFECT_TRIGGER_SET.has(value.trigger as string))
      addIssue(issues, `${path}.trigger`, 'INVALID_TRIGGER', `不支持的触发器: ${String(value.trigger)}`);
    if (!Array.isArray(value.effects) || value.effects.length === 0) {
      addIssue(issues, `${path}.effects`, 'EMPTY_TRIGGER_EFFECTS', '触发器至少需要一个效果');
    } else {
      value.effects.forEach((effect, index) => {
        if (isRecord(effect) && effect.op === 'register_trigger') {
          addIssue(issues, `${path}.effects[${index}]`, 'NESTED_TRIGGER', '触发器不能嵌套触发器');
        } else {
          validateEffectNode(effect, `${path}.effects[${index}]`, issues, depth + 1, counter);
        }
      });
    }
  } else if (value.op === 'schedule_effect') {
    rejectUnknownKeys(
      value,
      ['op', 'afterTurns', 'phase', 'priority', 'repeatEvery', 'repeats', 'effects'],
      path,
      issues,
    );
    const afterTurns = value.afterTurns;
    const priority = value.priority;
    const repeatEvery = value.repeatEvery;
    const repeats = value.repeats;
    if (typeof afterTurns !== 'number' || !Number.isInteger(afterTurns) || afterTurns < 0 || afterTurns > 999)
      addIssue(issues, `${path}.afterTurns`, 'INVALID_SCHEDULE_DELAY', '延迟回合必须是 0 到 999 的整数');
    if (!['turn_start', 'before_draw', 'after_draw', 'turn_end'].includes(String(value.phase)))
      addIssue(issues, `${path}.phase`, 'INVALID_SCHEDULE_PHASE', `不支持的调度阶段: ${String(value.phase)}`);
    if (priority !== undefined && (typeof priority !== 'number' || !Number.isInteger(priority) || Math.abs(priority) > 100000))
      addIssue(issues, `${path}.priority`, 'INVALID_SCHEDULE_PRIORITY', '调度优先级必须是绝对值不超过 100000 的整数');
    if (repeatEvery !== undefined && (typeof repeatEvery !== 'number' || !Number.isInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 999))
      addIssue(issues, `${path}.repeatEvery`, 'INVALID_SCHEDULE_REPEAT', '重复间隔必须是 1 到 999 的整数');
    if (repeats !== undefined && (typeof repeats !== 'number' || !Number.isInteger(repeats) || repeats < 1 || repeats > 999))
      addIssue(issues, `${path}.repeats`, 'INVALID_SCHEDULE_REPEAT', '重复次数必须是 1 到 999 的整数');
    if ((repeatEvery === undefined) !== (repeats === undefined))
      addIssue(issues, path, 'INCOMPLETE_SCHEDULE_REPEAT', '重复调度必须同时提供 repeatEvery 与 repeats');
    if (!Array.isArray(value.effects) || value.effects.length === 0) {
      addIssue(issues, `${path}.effects`, 'EMPTY_SCHEDULE_EFFECTS', '预约效果至少需要一个效果');
    } else {
      value.effects.forEach((effect, index) => {
        if (isRecord(effect) && effect.op === 'schedule_effect')
          addIssue(issues, `${path}.effects[${index}]`, 'NESTED_SCHEDULE', '预约效果不能直接嵌套预约效果');
        else validateEffectNode(effect, `${path}.effects[${index}]`, issues, depth + 1, counter);
      });
    }
  } else {
    rejectUnknownKeys(value, ['op', 'target', 'targetSelector', 'amount'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    validateTargetSelectorForNode(value, path, issues);
    validateNumericExpression(value.amount, `${path}.amount`, issues, depth + 1, counter);
  }
}

export function isSupportedVariablePath(path: string): boolean {
  if (
    [
      'battle.turn_number',
      'battle.cards_played_this_turn',
      'battle.attacks_played_this_turn',
      'battle.skills_played_this_turn',
      'context.spent_energy',
      'context.x_value',
      'context.status_stacks',
    ].includes(path)
  )
    return true;
  if (/^(self|opponent)\.(hp|max_hp|lust|max_lust|energy|max_energy|block)$/.test(path)) return true;
  if (/^self\.(hand_size|draw_pile_size|discard_pile_size|exhaust_pile_size)$/.test(path)) return true;
  return /^(self|opponent)\.status\.[a-zA-Z0-9_]+\.stacks$/.test(path);
}

export function validateEffectProgram(value: unknown): EffectValidationResult {
  const issues: EffectValidationIssue[] = [];
  if (!isRecord(value))
    return { ok: false, issues: [{ path: '$', code: 'INVALID_PROGRAM', message: '效果程序必须是对象' }] };
  rejectUnknownKeys(value, ['spec', 'steps'], '$', issues);
  if (value.spec !== EFFECT_PROGRAM_SPEC)
    addIssue(issues, '$.spec', 'UNSUPPORTED_SPEC', `spec 必须是 ${EFFECT_PROGRAM_SPEC}`);
  if (!Array.isArray(value.steps) || value.steps.length === 0)
    addIssue(issues, '$.steps', 'EMPTY_PROGRAM', 'steps 至少需要一个效果');
  else {
    const counter = { value: 0 };
    value.steps.forEach((effect, index) => validateEffectNode(effect, `$.steps[${index}]`, issues, 0, counter));
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as EffectProgram } : { ok: false, issues };
}

function readCombatantVariable(entity: CoreCombatantState, field: string, path: string): number {
  const fields: Record<string, number | undefined> = {
    hp: entity.hp,
    max_hp: entity.maxHp,
    lust: entity.lust,
    max_lust: entity.maxLust,
    energy: entity.energy,
    max_energy: entity.maxEnergy,
    block: entity.block,
    hand_size: entity.handSize,
    draw_pile_size: entity.drawPileSize,
    discard_pile_size: entity.discardPileSize,
    exhaust_pile_size: entity.exhaustPileSize,
  };
  const value = fields[field];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new EffectExecutionError('MISSING_VARIABLE', path, `变量没有有限数值: ${path}`);
  return value;
}

export function resolveNumericVariable(path: string, state: CoreEffectState, context: EffectExecutionContext): number {
  if (path === 'battle.turn_number') return state.currentTurn;
  if (path === 'battle.cards_played_this_turn') return state.cardsPlayedThisTurn;
  if (path === 'battle.attacks_played_this_turn') return state.attacksPlayedThisTurn;
  if (path === 'battle.skills_played_this_turn') return state.skillsPlayedThisTurn;
  if (path === 'context.spent_energy') return context.spentEnergy;
  if (path === 'context.x_value') return context.xValue ?? context.spentEnergy;
  if (path === 'context.status_stacks') return context.statusStacks ?? 0;
  const statusMatch = path.match(/^(self|opponent)\.status\.([a-zA-Z0-9_]+)\.stacks$/);
  if (statusMatch) return state[statusMatch[1] as EffectTarget].statusStacks?.[statusMatch[2]] ?? 0;
  const entityMatch = path.match(/^(self|opponent)\.([a-z_]+)$/);
  if (!entityMatch) throw new EffectExecutionError('UNKNOWN_VARIABLE', path, `不支持的变量路径: ${path}`);
  return readCombatantVariable(state[entityMatch[1] as EffectTarget], entityMatch[2], path);
}

function coreCardMatchesFilter(card: CoreCardView, filter?: CardSelectorFilter): boolean {
  if (!filter) return true;
  if (filter.types && (!card.type || !filter.types.includes(card.type))) return false;
  if (filter.rarities && (!card.rarity || !filter.rarities.includes(card.rarity))) return false;
  if (filter.cost !== undefined && card.cost !== filter.cost) return false;
  if (filter.minCost !== undefined && (typeof card.cost !== 'number' || card.cost < filter.minCost)) return false;
  if (filter.maxCost !== undefined && (typeof card.cost !== 'number' || card.cost > filter.maxCost)) return false;
  if (filter.tags && !filter.tags.every(tag => card.tags?.includes(tag))) return false;
  if (filter.templateId && (card.templateId || card.originalId) !== filter.templateId) return false;
  if (filter.runInstanceId && card.runInstanceId !== filter.runInstanceId) return false;
  if (filter.combatInstanceId && (card.combatInstanceId || card.id) !== filter.combatInstanceId) return false;
  if (filter.origin && card.origin !== filter.origin) return false;
  const upgraded = card.upgraded === true || (card.upgradeLevel || 0) > 0;
  return filter.upgraded === undefined || filter.upgraded === upgraded;
}

export function evaluateNumericExpression(
  expression: NumericExpression,
  state: CoreEffectState,
  context: EffectExecutionContext,
  path = '$',
): number {
  if (typeof expression === 'number') {
    if (!Number.isFinite(expression)) throw new EffectExecutionError('NON_FINITE_NUMBER', path, '数字必须是有限值');
    return expression;
  }
  if (expression.op === 'var') return resolveNumericVariable(expression.path, state, context);
  if (expression.op === 'negate') {
    const value = evaluateNumericExpression(expression.value, state, context, `${path}.value`);
    return -value;
  }
  if (expression.op === 'floor' || expression.op === 'ceil' || expression.op === 'abs') {
    const value = evaluateNumericExpression(expression.value, state, context, `${path}.value`);
    return expression.op === 'floor' ? Math.floor(value) : expression.op === 'ceil' ? Math.ceil(value) : Math.abs(value);
  }
  if (expression.op === 'clamp_min') {
    const value = evaluateNumericExpression(expression.value, state, context, `${path}.value`);
    return Math.max(expression.minimum, value);
  }
  if (expression.op === 'min' || expression.op === 'max') {
    const values = expression.values.map((entry, index) => evaluateNumericExpression(entry, state, context, `${path}.values[${index}]`));
    return expression.op === 'min' ? Math.min(...values) : Math.max(...values);
  }
  if (expression.op === 'count_cards') {
    const zones = state.cardZones;
    if (!zones) throw new EffectExecutionError('MISSING_VARIABLE', path, '卡牌集合未提供');
    const selectedZones = expression.selector.zone === 'all'
      ? ['hand', 'draw', 'discard'] as const
      : [expression.selector.zone] as const;
    const cards = selectedZones.flatMap(zone => zones[zone]);
    return cards.filter(card => coreCardMatchesFilter(card, expression.selector.filter)).length;
  }
  if (expression.op === 'count_statuses') {
    return Object.values(state[expression.target].statusStacks || {}).filter(stacks => stacks > 0).length;
  }
  if (expression.op === 'history') {
    const history = state.history;
    if (!history) throw new EffectExecutionError('MISSING_VARIABLE', path, '历史数值未提供');
    return {
      last_damage: history.lastDamage,
      last_hp_loss: history.lastHpLoss,
      last_heal: history.lastHeal,
      last_resource_spent: history.lastResourceSpent,
    }[expression.metric] ?? 0;
  }
  if (expression.op === 'intent_value') return state.enemyIntentValue ?? 0;
  const left = evaluateNumericExpression(expression.left, state, context, `${path}.left`);
  const right = evaluateNumericExpression(expression.right, state, context, `${path}.right`);
  let result: number;
  switch (expression.op) {
    case 'add':
      result = left + right;
      break;
    case 'subtract':
      result = left - right;
      break;
    case 'multiply':
      result = left * right;
      break;
    case 'divide':
      if (right === 0) throw new EffectExecutionError('DIVISION_BY_ZERO', path, '不能除以 0');
      result = left / right;
      break;
  }
  if (!Number.isFinite(result)) throw new EffectExecutionError('NON_FINITE_RESULT', path, '表达式结果必须是有限值');
  return result;
}

export function evaluateConditionExpression(
  condition: ConditionExpression,
  state: CoreEffectState,
  context: EffectExecutionContext,
  path = '$',
): boolean {
  if (condition.op === 'not')
    return !evaluateConditionExpression(condition.condition, state, context, `${path}.condition`);
  if (condition.op === 'all' || condition.op === 'any') {
    const values = condition.conditions.map((entry, index) =>
      evaluateConditionExpression(entry, state, context, `${path}.conditions[${index}]`),
    );
    return condition.op === 'all' ? values.every(Boolean) : values.some(Boolean);
  }
  if (!isComparisonCondition(condition)) {
    throw new EffectExecutionError('UNKNOWN_CONDITION_OPERATOR', path, `不支持的条件运算: ${condition.op}`);
  }
  const left = evaluateNumericExpression(condition.left, state, context, `${path}.left`);
  const right = evaluateNumericExpression(condition.right, state, context, `${path}.right`);
  switch (condition.relation) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
}

function evaluateAmount(
  expression: NumericExpression,
  state: CoreEffectState,
  context: EffectExecutionContext,
  path: string,
  discrete = false,
): number {
  const evaluated = evaluateNumericExpression(expression, state, context, path);
  const value = discrete ? Math.floor(evaluated) : roundBattleValue(evaluated);
  if (value < 0) throw new EffectExecutionError('NEGATIVE_AMOUNT', path, '效果数量不能为负数');
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStat(entity: CoreCombatantState, stat: 'hp' | 'lust' | 'energy' | 'block'): number {
  return stat === 'hp' ? entity.hp : stat === 'lust' ? entity.lust : stat === 'energy' ? entity.energy : entity.block;
}

function writeStat(entity: CoreCombatantState, stat: 'hp' | 'lust' | 'energy' | 'block', value: number): void {
  if (stat === 'hp') entity.hp = roundBattleValue(clamp(value, 0, entity.maxHp));
  else if (stat === 'lust') entity.lust = roundBattleValue(clamp(value, 0, entity.maxLust));
  else if (stat === 'energy') entity.energy = Math.max(0, Math.floor(value));
  else entity.block = roundBattleValue(Math.max(0, value));
}

function executeNode(
  node: EffectNode,
  state: CoreEffectState,
  context: EffectExecutionContext,
  events: CoreEffectEvent[],
  path: string,
): void {
  if (node.op === 'if') {
    const branch = evaluateConditionExpression(node.condition, state, context, `${path}.condition`)
      ? node.then
      : node.else || [];
    branch.forEach((effect, index) => executeNode(effect, state, context, events, `${path}.branch[${index}]`));
    return;
  }
  if (node.op === 'narrate') {
    events.push({ type: 'narration', text: node.text });
    return;
  }
  if (node.op === 'schedule_effect') {
    events.push({
      type: 'schedule_effect',
      afterTurns: node.afterTurns,
      phase: node.phase,
      priority: node.priority || 0,
      ...(node.repeatEvery !== undefined ? { repeatEvery: node.repeatEvery } : {}),
      ...(node.repeats !== undefined ? { repeats: node.repeats } : {}),
      effects: clone(node.effects),
    });
    return;
  }
  if (node.op === 'draw_cards') {
    events.push({ type: 'draw_cards', amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true) });
    return;
  }
  if (node.op === 'scry_cards') {
    events.push({ type: 'scry_cards', amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true) });
    return;
  }
  if (node.op === 'discard_cards' || node.op === 'exhaust_cards') {
    events.push({
      type: node.op,
      selector: clone(node.selector),
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true),
    });
    return;
  }
  if (node.op === 'recover_cards') {
    events.push({
      type: 'recover_cards',
      source: node.source,
      pick: node.pick,
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true),
    });
    return;
  }
  if (node.op === 'reduce_card_cost') {
    events.push({
      type: 'reduce_card_cost',
      selector: clone(node.selector),
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`, true),
    });
    return;
  }
  if (node.op === 'modify_card_value') {
    events.push({
      type: 'modify_card_value',
      selector: clone(node.selector),
      stat: node.stat,
      operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    });
    return;
  }
  if (node.op === 'copy_cards' || node.op === 'double_card_effect') {
    events.push({ type: node.op, selector: clone(node.selector) });
    return;
  }
  if (node.op === 'auto_play_cards') {
    events.push({ type: 'auto_play_cards', selector: clone(node.selector), free: node.free });
    return;
  }
  if (node.op === 'set_card_destination') {
    events.push({ type: 'set_card_destination', destination: node.destination });
    return;
  }
  if (node.op === 'move_cards') {
    events.push({
      type: 'move_cards', selector: clone(node.selector), amount: node.amount,
      destination: node.destination, position: node.position,
    });
    return;
  }
  if (node.op === 'remove_cards') {
    events.push({ type: 'remove_cards', selector: clone(node.selector), amount: node.amount });
    return;
  }
  if (node.op === 'transform_cards') {
    events.push({ type: 'transform_cards', selector: clone(node.selector), replacement: clone(node.replacement) });
    return;
  }
  if (node.op === 'apply_card_patch') {
    const patch = clone(node.patch);
    if (patch.kind === 'numeric' || patch.kind === 'cost' || patch.kind === 'x_value') {
      patch.value = roundBattleValue(evaluateNumericExpression(patch.value, state, context, `${path}.patch.value`));
    } else if (patch.kind === 'replay') {
      patch.extra = Math.max(1, Math.floor(evaluateNumericExpression(patch.extra, state, context, `${path}.patch.extra`)));
    }
    events.push({ type: 'apply_card_patch', selector: clone(node.selector), patch });
    return;
  }
  if (node.op === 'add_card') {
    events.push({ type: 'add_card', zone: node.zone, card: clone(node.card), count: node.count });
    return;
  }
  if (node.op === 'modify') {
    events.push({
      type: 'modify',
      target: node.target,
      stat: node.stat,
      operator: node.operator,
      value: roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`)),
    });
    return;
  }
  if (node.op === 'card_play_rule') {
    const limit =
      node.limit === 'all'
        ? 'all'
        : Math.max(1, Math.floor(evaluateNumericExpression(node.limit, state, context, `${path}.limit`)));
    const extra =
      node.rule === 'replay' && node.extra !== undefined
        ? Math.max(1, Math.floor(evaluateNumericExpression(node.extra, state, context, `${path}.extra`)))
        : 0;
    events.push({ type: 'card_play_rule', target: node.target, rule: node.rule, limit, extra });
    return;
  }
  if (node.op === 'register_trigger') {
    events.push({
      type: 'register_trigger',
      target: node.target,
      trigger: node.trigger,
      effects: clone(node.effects),
    });
    return;
  }
  const entity = state[node.target];
  if (node.op === 'apply_status') {
    const stacks = evaluateAmount(node.stacks, state, context, `${path}.stacks`, true);
    entity.statusStacks = { ...(entity.statusStacks || {}) };
    entity.statusStacks[node.status] = (entity.statusStacks[node.status] || 0) + stacks;
    events.push({ type: 'apply_status', target: node.target, status: node.status, stacks });
    return;
  }
  if (node.op === 'remove_status') {
    entity.statusStacks = { ...(entity.statusStacks || {}) };
    if (node.status === 'all') entity.statusStacks = {};
    else if (node.status !== 'buffs' && node.status !== 'debuffs') delete entity.statusStacks[node.status];
    events.push({ type: 'remove_status', target: node.target, status: node.status });
    return;
  }
  if (node.op === 'set_stat') {
    const value = node.stat === 'energy'
      ? Math.floor(evaluateNumericExpression(node.value, state, context, `${path}.value`))
      : roundBattleValue(evaluateNumericExpression(node.value, state, context, `${path}.value`));
    writeStat(entity, node.stat, value);
    events.push({ type: 'set_stat', target: node.target, stat: node.stat, value: readStat(entity, node.stat) });
    return;
  }
  const amount = evaluateAmount(node.amount, state, context, `${path}.amount`, node.op === 'gain_energy');
  if (node.op === 'damage') {
    const blocked = roundBattleValue(Math.min(entity.block, amount));
    entity.block = roundBattleValue(entity.block - blocked);
    const hpLost = roundBattleValue(Math.min(entity.hp, amount - blocked));
    entity.hp = roundBattleValue(entity.hp - hpLost);
    events.push({ type: 'damage', target: node.target, requested: amount, blocked, hpLost });
  } else if (node.op === 'heal') {
    const previous = entity.hp;
    entity.hp = roundBattleValue(clamp(entity.hp + amount, 0, entity.maxHp));
    events.push({ type: 'heal', target: node.target, requested: amount, hpGained: roundBattleValue(entity.hp - previous) });
  } else if (node.op === 'gain_block') {
    entity.block = roundBattleValue(entity.block + amount);
    events.push({ type: 'gain_block', target: node.target, amount });
  } else if (node.op === 'gain_energy') {
    const previous = entity.energy;
    entity.energy = Math.max(0, entity.energy + amount);
    events.push({ type: 'gain_energy', target: node.target, amount: entity.energy - previous });
  } else {
    const previous = entity.lust;
    entity.lust = roundBattleValue(clamp(entity.lust + amount, 0, entity.maxLust));
    events.push({ type: 'gain_lust', target: node.target, amount: roundBattleValue(entity.lust - previous) });
  }
}

export function executeEffectProgram(
  value: unknown,
  inputState: CoreEffectState,
  context: EffectExecutionContext,
): EffectExecutionResult {
  const original = clone(inputState);
  const validation = validateEffectProgram(value);
  if (!validation.ok) {
    const first = validation.issues[0];
    return {
      ok: false,
      error: new EffectExecutionError(first.code, first.path, first.message),
      state: original,
      events: [],
    };
  }
  const state = clone(inputState);
  const events: CoreEffectEvent[] = [];
  try {
    validation.value.steps.forEach((effect, index) => executeNode(effect, state, context, events, `$.steps[${index}]`));
    return { ok: true, state, events };
  } catch (error) {
    const executionError =
      error instanceof EffectExecutionError
        ? error
        : new EffectExecutionError('EXECUTION_FAILED', '$', error instanceof Error ? error.message : '效果执行失败');
    return { ok: false, error: executionError, state: original, events: [] };
  }
}
