import {
  REGISTERABLE_EFFECT_TRIGGER_SET,
  type RegisterableEffectTrigger,
} from './battleTriggers';

export const EFFECT_PROGRAM_SPEC = 'mwg.effect/v1' as const;

export type EffectTarget = 'self' | 'opponent';

export type CardZone = 'hand' | 'draw' | 'discard' | 'all';
export type CardPick = 'random' | 'choose' | 'left' | 'right' | 'all';
export type RecoverCardZone = 'draw' | 'discard' | 'exhaust';
export type ModifierStat = 'damage' | 'damage_taken' | 'lust' | 'lust_taken' | 'heal' | 'block';
export type EffectModifierOperator = 'add' | 'subtract' | 'multiply' | 'divide' | 'set';
export type EffectTrigger = RegisterableEffectTrigger;

export interface CardSelector {
  zone: CardZone;
  pick: CardPick;
  count?: number;
}

export interface GeneratedCardDefinition {
  id: string;
  name: string;
  emoji: string;
  type: 'Attack' | 'Skill' | 'Power' | 'Event' | 'Curse';
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Corrupt';
  cost?: number | 'energy';
  description: string;
  program: EffectProgram;
  discardProgram?: EffectProgram;
  retain?: boolean;
  exhaust?: boolean;
  ethereal?: boolean;
}

export type NumericExpression =
  number | { op: 'var'; path: string } | BinaryNumericExpression | { op: 'negate'; value: NumericExpression };

export interface BinaryNumericExpression {
  op: 'add' | 'subtract' | 'multiply' | 'divide';
  left: NumericExpression;
  right: NumericExpression;
}

export type ConditionExpression =
  | ComparisonCondition
  | { op: 'all' | 'any'; conditions: ConditionExpression[] }
  | { op: 'not'; condition: ConditionExpression };

export interface ComparisonCondition {
  op: 'compare';
  relation: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  left: NumericExpression;
  right: NumericExpression;
}

export type EffectNode =
  | { op: 'damage'; target: EffectTarget; amount: NumericExpression }
  | { op: 'heal'; target: EffectTarget; amount: NumericExpression }
  | { op: 'gain_block'; target: EffectTarget; amount: NumericExpression }
  | { op: 'gain_energy'; target: EffectTarget; amount: NumericExpression }
  | { op: 'gain_lust'; target: EffectTarget; amount: NumericExpression }
  | {
      op: 'set_stat';
      target: EffectTarget;
      stat: 'hp' | 'lust' | 'energy' | 'block';
      value: NumericExpression;
    }
  | { op: 'apply_status'; target: EffectTarget; status: string; stacks: NumericExpression }
  | { op: 'remove_status'; target: EffectTarget; status: string }
  | { op: 'draw_cards'; amount: NumericExpression }
  | { op: 'scry_cards'; amount: NumericExpression }
  | { op: 'discard_cards'; selector: CardSelector; amount: NumericExpression }
  | { op: 'exhaust_cards'; selector: CardSelector; amount: NumericExpression }
  | { op: 'recover_cards'; source: RecoverCardZone; pick: 'random' | 'choose' | 'all'; amount: NumericExpression }
  | { op: 'reduce_card_cost'; selector: CardSelector; amount: NumericExpression }
  | { op: 'copy_cards'; selector: CardSelector }
  | { op: 'double_card_effect'; selector: CardSelector }
  | { op: 'add_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition; count: number }
  | {
      op: 'modify';
      target: EffectTarget;
      stat: ModifierStat;
      operator: EffectModifierOperator;
      value: NumericExpression;
    }
  | { op: 'register_trigger'; target: EffectTarget; trigger: EffectTrigger; effects: EffectNode[] }
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
}

export interface EffectExecutionContext {
  spentEnergy: number;
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
  | { type: 'copy_cards' | 'double_card_effect'; selector: CardSelector }
  | { type: 'add_card'; zone: 'hand' | 'draw'; card: GeneratedCardDefinition; count: number }
  | {
      type: 'modify';
      target: EffectTarget;
      stat: ModifierStat;
      operator: EffectModifierOperator;
      value: number;
    }
  | { type: 'register_trigger'; target: EffectTarget; trigger: EffectTrigger; effects: EffectNode[] }
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
const UNARY_NUMBER_OPS = new Set(['negate']);
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
  'copy_cards',
  'double_card_effect',
  'add_card',
  'modify',
  'register_trigger',
  'if',
  'narrate',
]);
const CARD_ZONES = new Set<CardZone>(['hand', 'draw', 'discard', 'all']);
const CARD_PICKS = new Set<CardPick>(['random', 'choose', 'left', 'right', 'all']);
const MODIFIER_STATS = new Set<ModifierStat>(['damage', 'damage_taken', 'lust', 'lust_taken', 'heal', 'block']);
const MODIFIER_OPERATORS = new Set<EffectModifierOperator>(['add', 'subtract', 'multiply', 'divide', 'set']);
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
  rejectUnknownKeys(value, ['zone', 'pick', 'count'], path, issues);
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
  if (value.zone === 'all' && value.pick !== 'all')
    addIssue(issues, path, 'INVALID_CARD_SELECTOR', '跨全部牌区时只能选择全部卡牌');
  if (value.pick === 'all' && value.count !== undefined)
    addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', '选择全部卡牌时不能再指定数量');
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
    rejectUnknownKeys(value, ['op', 'target', 'stat', 'value'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    if (!['hp', 'lust', 'energy', 'block'].includes(String(value.stat)))
      addIssue(issues, `${path}.stat`, 'INVALID_STAT', `不支持的属性: ${String(value.stat)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
  } else if (value.op === 'apply_status') {
    rejectUnknownKeys(value, ['op', 'target', 'status', 'stacks'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    if (typeof value.status !== 'string' || !STATUS_ID_PATTERN.test(value.status))
      addIssue(issues, `${path}.status`, 'INVALID_STATUS_ID', `状态 ID 无效: ${String(value.status)}`);
    validateNumericExpression(value.stacks, `${path}.stacks`, issues, depth + 1, counter);
  } else if (value.op === 'remove_status') {
    rejectUnknownKeys(value, ['op', 'target', 'status'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
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
  } else if (value.op === 'copy_cards' || value.op === 'double_card_effect') {
    rejectUnknownKeys(value, ['op', 'selector'], path, issues);
    validateCardSelector(value.selector, `${path}.selector`, issues);
  } else if (value.op === 'add_card') {
    rejectUnknownKeys(value, ['op', 'zone', 'card', 'count'], path, issues);
    if (value.zone !== 'hand' && value.zone !== 'draw')
      addIssue(issues, `${path}.zone`, 'INVALID_CARD_ZONE', '生成卡牌只能加入 hand 或 draw');
    if (!Number.isInteger(value.count) || (value.count as number) < 1 || (value.count as number) > 100)
      addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', '生成数量必须是 1 到 100 的整数');
    validateGeneratedCard(value.card, `${path}.card`, issues);
  } else if (value.op === 'modify') {
    rejectUnknownKeys(value, ['op', 'target', 'stat', 'operator', 'value'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
    if (!MODIFIER_STATS.has(value.stat as ModifierStat))
      addIssue(issues, `${path}.stat`, 'INVALID_MODIFIER', `不支持的修饰项: ${String(value.stat)}`);
    if (!MODIFIER_OPERATORS.has(value.operator as EffectModifierOperator))
      addIssue(issues, `${path}.operator`, 'INVALID_MODIFIER_OPERATOR', `不支持的修饰运算: ${String(value.operator)}`);
    validateNumericExpression(value.value, `${path}.value`, issues, depth + 1, counter);
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
  } else {
    rejectUnknownKeys(value, ['op', 'target', 'amount'], path, issues);
    if (!TARGETS.has(value.target as EffectTarget))
      addIssue(issues, `${path}.target`, 'INVALID_TARGET', `不支持的目标: ${String(value.target)}`);
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
  if (path === 'context.status_stacks') return context.statusStacks ?? 0;
  const statusMatch = path.match(/^(self|opponent)\.status\.([a-zA-Z0-9_]+)\.stacks$/);
  if (statusMatch) return state[statusMatch[1] as EffectTarget].statusStacks?.[statusMatch[2]] ?? 0;
  const entityMatch = path.match(/^(self|opponent)\.([a-z_]+)$/);
  if (!entityMatch) throw new EffectExecutionError('UNKNOWN_VARIABLE', path, `不支持的变量路径: ${path}`);
  return readCombatantVariable(state[entityMatch[1] as EffectTarget], entityMatch[2], path);
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
): number {
  const value = evaluateNumericExpression(expression, state, context, path);
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
  if (stat === 'hp') entity.hp = clamp(value, 0, entity.maxHp);
  else if (stat === 'lust') entity.lust = clamp(value, 0, entity.maxLust);
  else if (stat === 'energy') entity.energy = Math.max(0, value);
  else entity.block = Math.max(0, value);
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
  if (node.op === 'draw_cards') {
    events.push({ type: 'draw_cards', amount: evaluateAmount(node.amount, state, context, `${path}.amount`) });
    return;
  }
  if (node.op === 'scry_cards') {
    events.push({ type: 'scry_cards', amount: evaluateAmount(node.amount, state, context, `${path}.amount`) });
    return;
  }
  if (node.op === 'discard_cards' || node.op === 'exhaust_cards') {
    events.push({
      type: node.op,
      selector: clone(node.selector),
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`),
    });
    return;
  }
  if (node.op === 'recover_cards') {
    events.push({
      type: 'recover_cards',
      source: node.source,
      pick: node.pick,
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`),
    });
    return;
  }
  if (node.op === 'reduce_card_cost') {
    events.push({
      type: 'reduce_card_cost',
      selector: clone(node.selector),
      amount: evaluateAmount(node.amount, state, context, `${path}.amount`),
    });
    return;
  }
  if (node.op === 'copy_cards' || node.op === 'double_card_effect') {
    events.push({ type: node.op, selector: clone(node.selector) });
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
      value: evaluateNumericExpression(node.value, state, context, `${path}.value`),
    });
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
    const stacks = evaluateAmount(node.stacks, state, context, `${path}.stacks`);
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
    const value = evaluateNumericExpression(node.value, state, context, `${path}.value`);
    writeStat(entity, node.stat, value);
    events.push({ type: 'set_stat', target: node.target, stat: node.stat, value: readStat(entity, node.stat) });
    return;
  }
  const amount = evaluateAmount(node.amount, state, context, `${path}.amount`);
  if (node.op === 'damage') {
    const blocked = Math.min(entity.block, amount);
    entity.block -= blocked;
    const hpLost = Math.min(entity.hp, amount - blocked);
    entity.hp -= hpLost;
    events.push({ type: 'damage', target: node.target, requested: amount, blocked, hpLost });
  } else if (node.op === 'heal') {
    const previous = entity.hp;
    entity.hp = clamp(entity.hp + amount, 0, entity.maxHp);
    events.push({ type: 'heal', target: node.target, requested: amount, hpGained: entity.hp - previous });
  } else if (node.op === 'gain_block') {
    entity.block += amount;
    events.push({ type: 'gain_block', target: node.target, amount });
  } else if (node.op === 'gain_energy') {
    const previous = entity.energy;
    entity.energy = Math.max(0, entity.energy + amount);
    events.push({ type: 'gain_energy', target: node.target, amount: entity.energy - previous });
  } else {
    const previous = entity.lust;
    entity.lust = clamp(entity.lust + amount, 0, entity.maxLust);
    events.push({ type: 'gain_lust', target: node.target, amount: entity.lust - previous });
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
