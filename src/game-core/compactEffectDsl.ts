import jsep from 'jsep';

import { REGISTERABLE_EFFECT_TRIGGER_SET } from './battleTriggers';
import {
  COMPACT_EFFECT_BUNDLE_OPERATION_SET,
  COMPACT_EFFECT_SAFE_AUXILIARY_BUNDLE_OPERATION_SET,
  COMPACT_EFFECT_META_KEY_SET,
  compactBundleMetaKeys,
  compactEffectOperationKeys,
  normalizeCompactEffectEntries,
  projectCompactOperation,
  sortCompactBundleOperations,
} from './compactEffectContract';

import {
  EFFECT_PROGRAM_SPEC,
  type CardPick,
  type CardPlayRuleKind,
  type CardSelector,
  type CardSelectorFilter,
  type CardValueOperator,
  type CardValueStat,
  type CardZone,
  type ConditionExpression,
  type EffectNode,
  type EffectProgram,
  type EffectTarget,
  type EffectTrigger,
  type GeneratedCardDefinition,
  type EffectModifierOperator,
  type ModifierStat,
  type NumericExpression,
  type EffectCardPatch,
  validateEffectProgram,
} from './effectDsl';
import type { EnemyTargetSelector } from './combatantCollection';
import {
  describeCompactCardWhenNeeded,
  isMechanicalDescriptionRestatement,
  needsCompactRuleDescription,
  normalizeChinesePlayerDescription,
} from './contentDescription';

export interface CompactEffectValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type CompactEffectCompilationResult =
  { ok: true; value: EffectProgram } | { ok: false; issues: CompactEffectValidationIssue[] };

export interface CompactEffectCompilationOptions {
  trigger?: unknown;
  /** Optional condition shared by every top-level effect in a named definition. */
  when?: unknown;
  creates?: unknown;
  statusNames?: Readonly<Record<string, string>>;
  implicitTarget?: EffectTarget;
}

type FormulaResult =
  | { kind: 'number'; value: NumericExpression }
  | { kind: 'choice'; condition: ConditionExpression; then: FormulaResult; else: FormulaResult };

type AmountOperation = 'damage' | 'heal' | 'gain_block' | 'gain_energy' | 'gain_lust';

const MAX_FORMULA_LENGTH = 256;
const AMOUNT_OPERATIONS: Record<string, { op: AmountOperation; target: EffectTarget }> = {
  damage: { op: 'damage', target: 'opponent' },
  heal: { op: 'heal', target: 'self' },
  block: { op: 'gain_block', target: 'self' },
  energy: { op: 'gain_energy', target: 'self' },
  lust: { op: 'gain_lust', target: 'opponent' },
};
const SET_OPERATIONS: Record<string, 'hp' | 'lust' | 'energy' | 'block'> = {
  set_hp: 'hp',
  set_lust: 'lust',
  set_energy: 'energy',
  set_block: 'block',
};
const MODIFIER_STATS = new Set<ModifierStat>(['damage', 'damage_taken', 'lust', 'lust_taken', 'heal', 'block']);
const MODIFIER_OPERATORS = new Set<EffectModifierOperator>(['add', 'subtract', 'multiply', 'divide', 'set']);
const CARD_VALUE_STATS = new Set<CardValueStat>(['damage', 'block', 'lust', 'stacks']);
const CARD_VALUE_OPERATORS = new Set<CardValueOperator>(['add', 'subtract', 'multiply', 'divide']);
const CARD_PLAY_RULES = new Set<CardPlayRuleKind>(['replay', 'free']);
const ARITHMETIC_OPERATORS: Record<string, 'add' | 'subtract' | 'multiply' | 'divide'> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
};
const COMPARISON_OPERATORS: Record<string, 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'> = {
  '==': 'eq',
  '!=': 'neq',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addIssue(issues: CompactEffectValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function hasAtMostOneAuthoredDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-7;
}

function validateAuthoredNumber(
  value: unknown,
  path: string,
  issues: CompactEffectValidationIssue[],
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addIssue(issues, path, 'INVALID_NUMBER', 'Number must be finite');
    return false;
  }
  if (!hasAtMostOneAuthoredDecimal(value)) {
    addIssue(issues, path, 'TOO_MANY_DECIMALS', 'AI-authored numbers may contain at most one decimal place');
    return false;
  }
  return true;
}

function rejectUnknownEntryKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: CompactEffectValidationIssue[],
  allowTrigger = true,
): void {
  const allowedKeys = new Set(allowTrigger ? [...allowed, 'on'] : allowed);
  Object.keys(value).forEach(key => {
    if (!allowedKeys.has(key)) addIssue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', `Unknown field: ${key}`);
  });
}

function readVariablePath(node: jsep.Expression): string | null {
  if (node.type === 'Identifier') return (node as jsep.Identifier).name;
  if (node.type !== 'MemberExpression') return null;
  const member = node as jsep.MemberExpression;
  if (member.computed || member.property.type !== 'Identifier') return null;
  const parentPath = readVariablePath(member.object);
  return parentPath ? `${parentPath}.${(member.property as jsep.Identifier).name}` : null;
}

function normalizeVariablePath(path: string): string | null {
  if (path === 'spent_energy') return 'context.spent_energy';
  if (path === 'x_value') return 'context.x_value';
  if (path === 'stacks') return 'context.status_stacks';
  if (path === 'turn_number') return 'battle.turn_number';
  if (path === 'cards_played_this_turn') return 'battle.cards_played_this_turn';
  if (path === 'attacks_played_this_turn') return 'battle.attacks_played_this_turn';
  if (path === 'skills_played_this_turn') return 'battle.skills_played_this_turn';
  if (/^(self|opponent)\.(hp|max_hp|lust|max_lust|energy|max_energy|block)$/.test(path)) return path;
  if (/^self\.(hand_size|draw_pile_size|discard_pile_size|exhaust_pile_size)$/.test(path)) return path;
  if (/^(self|opponent)\.status\.[A-Za-z0-9_]+\.stacks$/.test(path)) return path;
  return null;
}

function compileLiteral(
  node: jsep.Literal,
  path: string,
  issues: CompactEffectValidationIssue[],
): NumericExpression | null {
  const value = node.value;
  return validateAuthoredNumber(value, path, issues) ? value : null;
}

function compileNumericAst(
  node: jsep.Expression,
  path: string,
  issues: CompactEffectValidationIssue[],
): NumericExpression | null {
  if (node.type === 'Literal') return compileLiteral(node as jsep.Literal, path, issues);
  if (node.type === 'Identifier' || node.type === 'MemberExpression') {
    const rawPath = readVariablePath(node);
    const variablePath = rawPath ? normalizeVariablePath(rawPath) : null;
    if (!variablePath) addIssue(issues, path, 'UNKNOWN_VARIABLE', `Unsupported variable: ${rawPath || node.type}`);
    return variablePath ? { op: 'var', path: variablePath } : null;
  }
  if (node.type === 'UnaryExpression' && (node as jsep.UnaryExpression).operator === '-') {
    const nested = compileNumericAst((node as jsep.UnaryExpression).argument, `${path}.value`, issues);
    return nested !== null ? { op: 'negate', value: nested } : null;
  }
  if (node.type === 'BinaryExpression') {
    const binary = node as jsep.BinaryExpression;
    const arithmetic = ARITHMETIC_OPERATORS[binary.operator];
    if (arithmetic) {
      const left = compileNumericAst(binary.left, `${path}.left`, issues);
      const right = compileNumericAst(binary.right, `${path}.right`, issues);
      return left !== null && right !== null ? { op: arithmetic, left, right } : null;
    }
  }
  addIssue(issues, path, 'UNSUPPORTED_FORMULA', `Unsupported numeric CEL node: ${node.type}`);
  return null;
}

function compileConditionAst(
  node: jsep.Expression,
  path: string,
  issues: CompactEffectValidationIssue[],
): ConditionExpression | null {
  if (node.type === 'BinaryExpression') {
    const binary = node as jsep.BinaryExpression;
    const relation = COMPARISON_OPERATORS[binary.operator];
    if (relation) {
      const left = compileNumericAst(binary.left, `${path}.left`, issues);
      const right = compileNumericAst(binary.right, `${path}.right`, issues);
      return left !== null && right !== null ? { op: 'compare', relation, left, right } : null;
    }
    if (binary.operator === '&&' || binary.operator === '||') {
      const left = compileConditionAst(binary.left, `${path}.conditions[0]`, issues);
      const right = compileConditionAst(binary.right, `${path}.conditions[1]`, issues);
      return left && right ? { op: binary.operator === '&&' ? 'all' : 'any', conditions: [left, right] } : null;
    }
  }
  if (node.type === 'UnaryExpression' && (node as jsep.UnaryExpression).operator === '!') {
    const condition = compileConditionAst((node as jsep.UnaryExpression).argument, `${path}.condition`, issues);
    return condition ? { op: 'not', condition } : null;
  }
  addIssue(issues, path, 'UNSUPPORTED_CONDITION', `Unsupported boolean CEL node: ${node.type}`);
  return null;
}

function inspectAstLimits(node: jsep.Expression, depth = 0): { nodes: number; depth: number } {
  const children: jsep.Expression[] = [];
  if (node.type === 'BinaryExpression') {
    children.push((node as jsep.BinaryExpression).left, (node as jsep.BinaryExpression).right);
  } else if (node.type === 'UnaryExpression') {
    children.push((node as jsep.UnaryExpression).argument);
  } else if (node.type === 'ConditionalExpression') {
    const conditional = node as jsep.ConditionalExpression;
    children.push(conditional.test, conditional.consequent, conditional.alternate);
  } else if (node.type === 'MemberExpression') {
    const member = node as jsep.MemberExpression;
    children.push(member.object, member.property);
  } else if (node.type === 'CallExpression') {
    const call = node as jsep.CallExpression;
    children.push(call.callee, ...call.arguments);
  } else if (node.type === 'ArrayExpression') {
    children.push(
      ...(node as jsep.ArrayExpression).elements.filter((entry): entry is jsep.Expression => entry !== null),
    );
  } else if (node.type === 'Compound') {
    children.push(...(node as jsep.Compound).body);
  }
  return children.reduce(
    (result, child) => {
      const nested = inspectAstLimits(child, depth + 1);
      return { nodes: result.nodes + nested.nodes, depth: Math.max(result.depth, nested.depth) };
    },
    { nodes: 1, depth },
  );
}

function parseCel(source: string, path: string, issues: CompactEffectValidationIssue[]): jsep.Expression | null {
  if (!source.trim()) {
    addIssue(issues, path, 'EMPTY_FORMULA', 'Formula cannot be empty');
    return null;
  }
  if (source.length > MAX_FORMULA_LENGTH) {
    addIssue(issues, path, 'FORMULA_TOO_LONG', `Formula cannot exceed ${MAX_FORMULA_LENGTH} characters`);
    return null;
  }
  try {
    const ast = jsep(source);
    const limits = inspectAstLimits(ast);
    if (limits.nodes > 64 || limits.depth > 16) {
      addIssue(issues, path, 'CEL_TOO_COMPLEX', 'Formula cannot exceed 64 nodes or 16 levels');
      return null;
    }
    return ast;
  } catch (error) {
    addIssue(issues, path, 'INVALID_CEL', error instanceof Error ? error.message : String(error));
    return null;
  }
}

function compileFormula(value: unknown, path: string, issues: CompactEffectValidationIssue[]): FormulaResult | null {
  if (typeof value === 'number') {
    return validateAuthoredNumber(value, path, issues) ? { kind: 'number', value } : null;
  }
  if (typeof value !== 'string') {
    addIssue(issues, path, 'INVALID_FORMULA', 'Effect value must be a number or CEL formula string');
    return null;
  }
  const ast = parseCel(value, path, issues);
  if (!ast) return null;
  if (ast.type === 'ConditionalExpression') {
    const conditional = ast as jsep.ConditionalExpression;
    const condition = compileConditionAst(conditional.test, `${path}.condition`, issues);
    const thenValue = compileFormulaAst(conditional.consequent, `${path}.then`, issues);
    const elseValue = compileFormulaAst(conditional.alternate, `${path}.else`, issues);
    return condition && thenValue && elseValue ? { kind: 'choice', condition, then: thenValue, else: elseValue } : null;
  }
  const expression = compileNumericAst(ast, path, issues);
  return expression !== null ? { kind: 'number', value: expression } : null;
}

function compileFormulaAst(
  ast: jsep.Expression,
  path: string,
  issues: CompactEffectValidationIssue[],
): FormulaResult | null {
  if (ast.type === 'ConditionalExpression') {
    const conditional = ast as jsep.ConditionalExpression;
    const condition = compileConditionAst(conditional.test, `${path}.condition`, issues);
    const thenValue = compileFormulaAst(conditional.consequent, `${path}.then`, issues);
    const elseValue = compileFormulaAst(conditional.alternate, `${path}.else`, issues);
    return condition && thenValue && elseValue ? { kind: 'choice', condition, then: thenValue, else: elseValue } : null;
  }
  const expression = compileNumericAst(ast, path, issues);
  return expression !== null ? { kind: 'number', value: expression } : null;
}

function compileWhen(value: unknown, path: string, issues: CompactEffectValidationIssue[]): ConditionExpression | null {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'INVALID_CONDITION', 'when must be a CEL formula string');
    return null;
  }
  const ast = parseCel(value, path, issues);
  return ast ? compileConditionAst(ast, path, issues) : null;
}

function lowerFormula(formula: FormulaResult, createNode: (amount: NumericExpression) => EffectNode): EffectNode {
  if (formula.kind === 'number') return createNode(formula.value);
  return {
    op: 'if',
    condition: formula.condition,
    then: [lowerFormula(formula.then, createNode)],
    else: [lowerFormula(formula.else, createNode)],
  };
}

function isSupportedModifierFormula(expression: NumericExpression): boolean {
  if (typeof expression === 'number') return true;
  if (expression.op === 'var') return expression.path === 'context.status_stacks';
  if (expression.op === 'negate' || expression.op === 'floor' || expression.op === 'ceil' || expression.op === 'abs') return isSupportedModifierFormula(expression.value);
  if (expression.op === 'clamp_min') return isSupportedModifierFormula(expression.value);
  if (expression.op === 'min' || expression.op === 'max') return expression.values.every(isSupportedModifierFormula);
  if (expression.op === 'count_cards' || expression.op === 'count_statuses' || expression.op === 'history' || expression.op === 'intent_value') return false;
  return isSupportedModifierFormula(expression.left) && isSupportedModifierFormula(expression.right);
}

function compileTarget(
  value: unknown,
  defaultTarget: EffectTarget,
  path: string,
  issues: CompactEffectValidationIssue[],
): EffectTarget | null {
  const target = value === undefined ? defaultTarget : value;
  if (target !== 'self' && target !== 'opponent') {
    addIssue(issues, path, 'INVALID_TARGET', `Target must be self or opponent: ${String(target)}`);
    return null;
  }
  return target;
}

function compileEnemyTargetSelector(
  value: unknown,
  target: EffectTarget,
  path: string,
  issues: CompactEffectValidationIssue[],
): EnemyTargetSelector | undefined {
  if (value === undefined) return undefined;
  if (target !== 'opponent') {
    addIssue(issues, path, 'INVALID_TARGET_SELECTOR', 'targets can only be used with opponent');
    return undefined;
  }
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_TARGET_SELECTOR', 'targets must be an object');
    return undefined;
  }
  const mode = value.mode;
  const allowed = new Set(['active', 'by_id', 'all', 'random', 'random_n', 'lowest_hp', 'highest_hp']);
  if (typeof mode !== 'string' || !allowed.has(mode)) {
    addIssue(issues, `${path}.mode`, 'INVALID_TARGET_SELECTOR', `Unsupported target mode: ${String(mode)}`);
    return undefined;
  }
  const keys = new Set(
    mode === 'by_id'
      ? ['mode', 'id']
      : mode === 'random' || mode === 'random_n'
        ? ['mode', 'count', 'allow_repeat', 'retarget']
        : ['mode'],
  );
  Object.keys(value).filter(key => !keys.has(key)).forEach(key =>
    addIssue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', `Unknown target selector field: ${key}`),
  );
  if (mode === 'by_id') {
    if (typeof value.id !== 'string' || !value.id.trim()) {
      addIssue(issues, `${path}.id`, 'INVALID_TARGET_SELECTOR', 'by_id requires a non-empty id');
      return undefined;
    }
    return { mode, id: value.id.trim() };
  }
  if (mode === 'random' || mode === 'random_n') {
    if (value.allow_repeat !== undefined && typeof value.allow_repeat !== 'boolean')
      addIssue(issues, `${path}.allow_repeat`, 'INVALID_TARGET_SELECTOR', 'allow_repeat must be boolean');
    if (value.retarget !== undefined && value.retarget !== 'locked' && value.retarget !== 'each_hit')
      addIssue(issues, `${path}.retarget`, 'INVALID_TARGET_SELECTOR', 'retarget must be locked or each_hit');
    const common: { allowRepeat?: boolean; retarget?: 'locked' | 'each_hit' } = {
      ...(value.allow_repeat === true ? { allowRepeat: true } : {}),
      ...(value.retarget === 'each_hit' || value.retarget === 'locked' ? { retarget: value.retarget } : {}),
    };
    if (mode === 'random_n') {
      if (!Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 100) {
        addIssue(issues, `${path}.count`, 'INVALID_TARGET_SELECTOR', 'random_n count must be an integer from 1 to 100');
        return undefined;
      }
      return { mode, count: Number(value.count), ...common };
    }
    return { mode, ...common };
  }
  return { mode } as EnemyTargetSelector;
}

function compileCardSelector(
  value: Record<string, unknown>,
  path: string,
  issues: CompactEffectValidationIssue[],
  defaultPick: CardPick,
  count?: number,
): CardSelector | null {
  const zone = (value.from ?? 'hand') as CardZone;
  const pick = (value.pick ?? defaultPick) as CardPick;
  if (!['hand', 'draw', 'discard', 'exhaust', 'all'].includes(zone)) {
    addIssue(issues, `${path}.from`, 'INVALID_CARD_ZONE', `from must be hand, draw, discard, exhaust, or all: ${String(zone)}`);
    return null;
  }
  if (!['random', 'choose', 'left', 'right', 'top', 'bottom', 'all'].includes(pick)) {
    addIssue(
      issues,
      `${path}.pick`,
      'INVALID_CARD_PICK',
      `pick must be random, choose, left, right, top, bottom, or all: ${String(pick)}`,
    );
    return null;
  }
  if ((pick === 'left' || pick === 'right') && zone !== 'hand') {
    addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', 'left/right can only select cards from hand');
    return null;
  }
  if ((pick === 'top' || pick === 'bottom') && !['draw', 'discard', 'exhaust'].includes(zone)) {
    addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', 'top/bottom can only select cards from ordered piles');
    return null;
  }
  if (zone === 'all' && pick !== 'all') {
    addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', 'from: all requires pick: all');
    return null;
  }
  if (pick === 'all' && count !== undefined) {
    addIssue(issues, `${path}.count`, 'INVALID_CARD_COUNT', 'pick: all does not accept count');
    return null;
  }
  const filter = compileCardSelectorFilter(value, path, issues);
  return {
    zone,
    pick,
    ...(count === undefined ? {} : { count }),
    ...(filter ? { filter } : {}),
  };
}

const CARD_TYPES = new Set(['Attack', 'Skill', 'Power', 'Event', 'Curse']);
const CARD_RARITIES = new Set(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt']);
const CARD_ORIGINS = new Set(['deck', 'generated', 'copied', 'transformed']);
const CARD_SELECTOR_INPUT_KEYS = [
  'from',
  'pick',
  'card_type',
  'rarity',
  'cost',
  'min_cost',
  'max_cost',
  'tag',
  'template_id',
  'run_instance_id',
  'combat_instance_id',
  'origin',
  'upgraded',
] as const;

function stringArray(value: unknown): string[] | null {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value) && value.length > 0 && value.every(entry => typeof entry === 'string' && entry.trim())) {
    return value.map(entry => String(entry).trim());
  }
  return null;
}

function compileCardSelectorFilter(
  value: Record<string, unknown>,
  path: string,
  issues: CompactEffectValidationIssue[],
): CardSelectorFilter | null {
  const filter: CardSelectorFilter = {};
  if (value.card_type !== undefined) {
    const types = stringArray(value.card_type);
    if (!types || types.some(type => !CARD_TYPES.has(type)))
      addIssue(issues, `${path}.card_type`, 'INVALID_CARD_FILTER', 'card_type contains an unsupported card type');
    else filter.types = types as CardSelectorFilter['types'];
  }
  if (value.rarity !== undefined) {
    const rarities = stringArray(value.rarity);
    if (!rarities || rarities.some(rarity => !CARD_RARITIES.has(rarity)))
      addIssue(issues, `${path}.rarity`, 'INVALID_CARD_FILTER', 'rarity contains an unsupported rarity');
    else filter.rarities = rarities as CardSelectorFilter['rarities'];
  }
  if (value.tag !== undefined) {
    const tags = stringArray(value.tag);
    if (!tags) addIssue(issues, `${path}.tag`, 'INVALID_CARD_FILTER', 'tag must be a string or non-empty string list');
    else filter.tags = tags;
  }
  if (value.cost !== undefined) {
    if (value.cost !== 'energy' && (typeof value.cost !== 'number' || !Number.isFinite(value.cost) || value.cost < 0))
      addIssue(issues, `${path}.cost`, 'INVALID_CARD_FILTER', 'cost must be a non-negative number or energy');
    else filter.cost = value.cost as number | 'energy';
  }
  for (const [source, target] of [['min_cost', 'minCost'], ['max_cost', 'maxCost']] as const) {
    if (value[source] === undefined) continue;
    if (typeof value[source] !== 'number' || !Number.isFinite(value[source]) || (value[source] as number) < 0)
      addIssue(issues, `${path}.${source}`, 'INVALID_CARD_FILTER', `${source} must be a non-negative number`);
    else filter[target] = value[source] as number;
  }
  if (filter.minCost !== undefined && filter.maxCost !== undefined && filter.minCost > filter.maxCost)
    addIssue(issues, path, 'INVALID_CARD_FILTER', 'min_cost cannot exceed max_cost');
  for (const [source, target] of [
    ['template_id', 'templateId'],
    ['run_instance_id', 'runInstanceId'],
    ['combat_instance_id', 'combatInstanceId'],
  ] as const) {
    if (value[source] === undefined) continue;
    if (typeof value[source] !== 'string' || !value[source].trim())
      addIssue(issues, `${path}.${source}`, 'INVALID_CARD_FILTER', `${source} must be a non-empty string`);
    else filter[target] = value[source].trim();
  }
  if (value.origin !== undefined) {
    if (typeof value.origin !== 'string' || !CARD_ORIGINS.has(value.origin))
      addIssue(issues, `${path}.origin`, 'INVALID_CARD_FILTER', 'origin is unsupported');
    else filter.origin = value.origin as CardSelectorFilter['origin'];
  }
  if (value.upgraded !== undefined) {
    if (typeof value.upgraded !== 'boolean')
      addIssue(issues, `${path}.upgraded`, 'INVALID_CARD_FILTER', 'upgraded must be boolean');
    else filter.upgraded = value.upgraded;
  }
  return Object.keys(filter).length > 0 ? filter : null;
}

function compileFixedCount(value: unknown, path: string, issues: CompactEffectValidationIssue[]): number | null {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) {
    addIssue(issues, path, 'INVALID_CARD_COUNT', 'Card count must be an integer from 1 to 100');
    return null;
  }
  return value as number;
}

function compileHitCount(value: unknown, path: string, issues: CompactEffectValidationIssue[]): number | null {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20) {
    addIssue(issues, path, 'INVALID_HIT_COUNT', 'hits must be an integer from 1 to 20');
    return null;
  }
  return value as number;
}

function cloneEffectNode(node: EffectNode): EffectNode {
  return JSON.parse(JSON.stringify(node)) as EffectNode;
}

function repeatDamageNode(node: EffectNode, hits: number): EffectNode[] {
  if (hits <= 1) return [node];
  if (node.op === 'register_trigger') {
    return [
      {
        ...node,
        effects: node.effects.flatMap(effect => repeatDamageNode(effect, hits)),
      },
    ];
  }
  if (node.op === 'if') {
    return [
      {
        ...node,
        then: node.then.flatMap(effect => repeatDamageNode(effect, hits)),
        ...(node.else ? { else: node.else.flatMap(effect => repeatDamageNode(effect, hits)) } : {}),
      },
    ];
  }
  return Array.from({ length: hits }, () => cloneEffectNode(node));
}

function applyWhen(
  node: EffectNode,
  value: unknown,
  path: string,
  issues: CompactEffectValidationIssue[],
): EffectNode | null {
  if (value === undefined) return node;
  const condition = compileWhen(value, `${path}.when`, issues);
  return condition ? { op: 'if', condition, then: [node] } : null;
}

function applyTrigger(
  node: EffectNode,
  value: unknown,
  path: string,
  issues: CompactEffectValidationIssue[],
): EffectNode | null {
  if (value === undefined) return node;
  if (typeof value !== 'string' || !REGISTERABLE_EFFECT_TRIGGER_SET.has(value)) {
    addIssue(issues, `${path}.on`, 'INVALID_TRIGGER', `Unsupported effect trigger: ${String(value)}`);
    return null;
  }
  return { op: 'register_trigger', target: 'self', trigger: value as EffectTrigger, effects: [node] };
}

function compileGeneratedCard(
  value: unknown,
  path: string,
  issues: CompactEffectValidationIssue[],
  templates: ReadonlyMap<string, Record<string, unknown>>,
  templateStack: readonly string[],
  statusNames?: Readonly<Record<string, string>>,
): GeneratedCardDefinition | null {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_CARD_TEMPLATE', 'Card template must be an object');
    return null;
  }
  rejectUnknownEntryKeys(
    value,
    [
      'id',
      'name',
      'emoji',
      'type',
      'rarity',
      'cost',
      'description',
      'effects',
      'discard_effects',
      'trigger',
      'when',
      'retain',
      'exhaust',
      'ethereal',
    ],
    path,
    issues,
    false,
  );
  const id = value.id;
  const name = value.name;
  if (typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    addIssue(issues, `${path}.id`, 'INVALID_CARD_ID', 'Template id must use letters, numbers, and underscores');
    return null;
  }
  if (templateStack.includes(id)) {
    addIssue(issues, path, 'CARD_TEMPLATE_CYCLE', `Card template cycle: ${[...templateStack, id].join(' -> ')}`);
    return null;
  }
  if (typeof name !== 'string' || !name.trim()) {
    addIssue(issues, `${path}.name`, 'INVALID_CARD_NAME', 'Template name cannot be empty');
    return null;
  }
  if (!(Array.isArray(value.effects) || isRecord(value.effects))) {
    addIssue(issues, `${path}.effects`, 'EMPTY_EFFECTS', 'Card template must contain effects');
    return null;
  }
  const type = (value.type ?? 'Skill') as GeneratedCardDefinition['type'];
  const rarity = (value.rarity ?? 'Common') as GeneratedCardDefinition['rarity'];
  if (!['Attack', 'Skill', 'Power', 'Event', 'Curse'].includes(type)) {
    addIssue(issues, `${path}.type`, 'INVALID_CARD_TYPE', `Unsupported template type: ${String(type)}`);
    return null;
  }
  if (!['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Corrupt'].includes(rarity)) {
    addIssue(issues, `${path}.rarity`, 'INVALID_CARD_RARITY', `Unsupported template rarity: ${String(rarity)}`);
    return null;
  }
  if (type !== 'Power' && value.trigger !== undefined) {
    addIssue(issues, `${path}.trigger`, 'INVALID_TRIGGER', 'Only Power templates can register a trigger');
    return null;
  }
  const nested = compileCompactEffectListInternal(
    value.effects,
    { trigger: value.trigger, when: value.when, creates: Array.from(templates.values()), statusNames },
    [...templateStack, id],
  );
  if (!nested.ok) {
    nested.issues.forEach(issue => {
      const nestedPath =
        issue.path === '$.trigger'
          ? `${path}.trigger`
          : `${path}.effects${issue.path === '$' ? '' : issue.path.slice(1)}`;
      addIssue(issues, nestedPath, issue.code, issue.message);
    });
    return null;
  }
  let discardProgram: EffectProgram | undefined;
  const discardEffects = value.discard_effects;
  if (discardEffects !== undefined) {
    const discard = compileCompactEffectListInternal(
      discardEffects,
      { creates: Array.from(templates.values()), statusNames },
      [...templateStack, id],
    );
    if (!discard.ok) {
      discard.issues.forEach(issue =>
        addIssue(
          issues,
          `${path}.discard_effects${issue.path === '$' ? '' : issue.path.slice(1)}`,
          issue.code,
          issue.message,
        ),
      );
      return null;
    }
    discardProgram = discard.value;
  }
  let cost: number | 'energy' | undefined;
  if (type !== 'Curse') {
    if (value.cost === 'energy') cost = 'energy';
    else {
      const numericCost = value.cost ?? 0;
      if (!Number.isInteger(numericCost) || (numericCost as number) < 0) {
        addIssue(issues, `${path}.cost`, 'INVALID_CARD_COST', 'Template cost must be a non-negative integer or energy');
        return null;
      }
      cost = numericCost as number;
    }
  }
  const authoredDescription = normalizeChinesePlayerDescription(value.description);
  const result: GeneratedCardDefinition = {
    id,
    name: name.trim(),
    emoji: typeof value.emoji === 'string' ? value.emoji : '🃏',
    type,
    rarity,
    cost,
    description:
      authoredDescription && (!isMechanicalDescriptionRestatement(authoredDescription) || needsCompactRuleDescription(value))
        ? authoredDescription
        : describeCompactCardWhenNeeded(value, { includeKeywords: false, statusNames }),
    program: nested.value,
    discardProgram,
    retain: value.retain === true || undefined,
    exhaust: type === 'Power' || value.exhaust === true || undefined,
    ethereal: value.ethereal === true || undefined,
  };
  return result;
}

function compileSingleEntry(
  value: unknown,
  path: string,
  issues: CompactEffectValidationIssue[],
  templates: ReadonlyMap<string, Record<string, unknown>>,
  templateStack: readonly string[],
  statusNames?: Readonly<Record<string, string>>,
  implicitTarget?: EffectTarget,
): EffectNode | null {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_EFFECT', 'Effect must be an object');
    return null;
  }
  const operationKeys = compactEffectOperationKeys(value);
  if (operationKeys.length !== 1) {
    addIssue(issues, path, 'INVALID_EFFECT', 'Effect must contain one operation plus optional to/when fields');
    return null;
  }
  const operation = operationKeys[0];

  let node: EffectNode | null = null;
  const amountOperation = AMOUNT_OPERATIONS[operation];
  if (amountOperation) {
    rejectUnknownEntryKeys(value, [operation, ...(operation === 'damage' ? ['hits'] : []), 'to', 'targets', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? amountOperation.target, `${path}.to`, issues);
    const formula = compileFormula(value[operation], `${path}.${operation}`, issues);
    if (target && formula) {
      const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues);
      node = lowerFormula(formula, amount => ({ op: amountOperation.op, target, ...(targetSelector ? { targetSelector } : {}), amount }));
    }
  } else if (SET_OPERATIONS[operation]) {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const formula = compileFormula(value[operation], `${path}.${operation}`, issues);
    const stat = SET_OPERATIONS[operation];
    if (target && formula) {
      const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues);
      node = lowerFormula(formula, assignedValue => ({ op: 'set_stat', target, ...(targetSelector ? { targetSelector } : {}), stat, value: assignedValue }));
    }
  } else if (operation === 'narrate') {
    rejectUnknownEntryKeys(value, [operation, 'when'], path, issues);
    if (value.to !== undefined) addIssue(issues, `${path}.to`, 'INVALID_TARGET', 'narrate does not accept to');
    if (typeof value.narrate !== 'string' || !value.narrate.trim()) {
      addIssue(issues, `${path}.narrate`, 'EMPTY_NARRATION', 'Narration must be a non-empty string');
    } else {
      node = { op: 'narrate', text: value.narrate };
    }
  } else if (operation === 'apply_status') {
    rejectUnknownEntryKeys(value, [operation, 'stacks', 'to', 'targets', 'when'], path, issues);
    const status = value.apply_status;
    const target = compileTarget(value.to, implicitTarget ?? 'opponent', `${path}.to`, issues);
    if (typeof status !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(status)) {
      addIssue(issues, `${path}.apply_status`, 'INVALID_STATUS_ID', 'apply_status must be a simple status ID');
    }
    const stacks = compileFormula(value.stacks ?? 1, `${path}.stacks`, issues);
    if (target && typeof status === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(status) && stacks) {
      const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues);
      node = lowerFormula(stacks, amount => ({ op: 'apply_status', target, ...(targetSelector ? { targetSelector } : {}), status, stacks: amount }));
    }
  } else if (operation === 'remove_status') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'when'], path, issues);
    const status = value.remove_status;
    const target = compileTarget(value.to, implicitTarget ?? 'opponent', `${path}.to`, issues);
    if (
      typeof status !== 'string' ||
      (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(status) && !['all', 'buffs', 'debuffs'].includes(status))
    ) {
      addIssue(
        issues,
        `${path}.remove_status`,
        'INVALID_STATUS_ID',
        'remove_status must be a status ID, all, buffs, or debuffs',
      );
    } else if (target) {
      const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues);
      node = { op: 'remove_status', target, ...(targetSelector ? { targetSelector } : {}), status };
    }
  } else if (operation === 'draw') {
    rejectUnknownEntryKeys(value, [operation, 'when'], path, issues);
    const amount = compileFormula(value.draw, `${path}.draw`, issues);
    if (amount) node = lowerFormula(amount, count => ({ op: 'draw_cards', amount: count }));
  } else if (operation === 'scry') {
    rejectUnknownEntryKeys(value, [operation, 'when'], path, issues);
    const amount = compileFormula(value.scry, `${path}.scry`, issues);
    if (amount) node = lowerFormula(amount, count => ({ op: 'scry_cards', amount: count }));
  } else if (operation === 'seek') {
    rejectUnknownEntryKeys(value, [operation, 'when'], path, issues);
    const amount = compileFormula(value.seek, `${path}.seek`, issues);
    if (amount) node = lowerFormula(amount, count => ({ op: 'recover_cards', source: 'draw', pick: 'choose', amount: count }));
  } else if (operation === 'discard' || operation === 'exhaust') {
    rejectUnknownEntryKeys(value, [operation, ...CARD_SELECTOR_INPUT_KEYS, 'when'], path, issues);
    const selectAll = value[operation] === 'all';
    const selectorSource = selectAll ? { ...value, pick: 'all' } : value;
    const selector = compileCardSelector(selectorSource, path, issues, 'random');
    const amount = selectAll
      ? ({ kind: 'number', value: 1 } as FormulaResult)
      : compileFormula(value[operation], `${path}.${operation}`, issues);
    if (selector && amount) {
      node = lowerFormula(amount, count => ({
        op: operation === 'discard' ? 'discard_cards' : 'exhaust_cards',
        selector,
        amount: count,
      }));
    }
  } else if (operation === 'recover') {
    rejectUnknownEntryKeys(value, [operation, 'from', 'pick', 'when'], path, issues);
    const source = value.from ?? 'discard';
    const selectAll = value.recover === 'all';
    const pick = selectAll ? 'all' : (value.pick ?? 'choose');
    if (source !== 'discard' && source !== 'exhaust') {
      addIssue(issues, `${path}.from`, 'INVALID_CARD_ZONE', 'recover from must be discard or exhaust');
    }
    if (pick !== 'random' && pick !== 'choose' && pick !== 'all') {
      addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', 'recover pick must be random, choose, or all');
    }
    if (!selectAll && pick === 'all') {
      addIssue(issues, `${path}.recover`, 'INVALID_CARD_COUNT', 'pick: all requires recover: all');
    }
    const amount = selectAll
      ? ({ kind: 'number', value: 1 } as FormulaResult)
      : compileFormula(value.recover, `${path}.recover`, issues);
    if (
      amount &&
      (source === 'discard' || source === 'exhaust') &&
      (pick === 'random' || pick === 'choose' || pick === 'all') &&
      (selectAll || pick !== 'all')
    ) {
      node = lowerFormula(amount, count => ({ op: 'recover_cards', source, pick, amount: count }));
    }
  } else if (operation === 'reduce_cost') {
    rejectUnknownEntryKeys(value, [operation, ...CARD_SELECTOR_INPUT_KEYS, 'count', 'when'], path, issues);
    const count = value.count === undefined ? 1 : compileFixedCount(value.count, `${path}.count`, issues);
    const selector = count === null ? null : compileCardSelector(value, path, issues, 'choose', count);
    const amount = compileFormula(value.reduce_cost, `${path}.reduce_cost`, issues);
    if (selector && amount)
      node = lowerFormula(amount, reduction => ({ op: 'reduce_card_cost', selector, amount: reduction }));
  } else if (operation === 'modify_card') {
    rejectUnknownEntryKeys(
      value,
      [operation, ...CARD_SELECTOR_INPUT_KEYS, 'count', 'add', 'subtract', 'multiply', 'divide', 'when'],
      path,
      issues,
      false,
    );
    const stat = value.modify_card;
    const operatorKeys = Array.from(CARD_VALUE_OPERATORS).filter(key => value[key] !== undefined);
    const selectAll = value.pick === 'all' || value.from === 'all';
    const count = selectAll ? undefined : value.count === undefined ? 1 : compileFixedCount(value.count, `${path}.count`, issues);
    const selectorSource = selectAll ? { ...value, pick: 'all' } : value;
    const selector = count === null ? null : compileCardSelector(selectorSource, path, issues, 'choose', count);
    if (typeof stat !== 'string' || !CARD_VALUE_STATS.has(stat as CardValueStat)) {
      addIssue(issues, `${path}.modify_card`, 'INVALID_CARD_VALUE_STAT', `Unsupported card value: ${String(stat)}`);
    }
    if (operatorKeys.length !== 1) {
      addIssue(
        issues,
        path,
        'INVALID_CARD_VALUE_OPERATOR',
        'modify_card requires exactly one of add/subtract/multiply/divide',
      );
    } else {
      const operator = operatorKeys[0] as CardValueOperator;
      const formula = compileFormula(value[operator], `${path}.${operator}`, issues);
      if (operator === 'divide' && formula?.kind === 'number' && formula.value === 0) {
        addIssue(issues, `${path}.divide`, 'DIVISION_BY_ZERO', 'modify_card cannot divide by zero');
      } else if (formula && (formula.kind !== 'number' || !isSupportedModifierFormula(formula.value))) {
        addIssue(
          issues,
          `${path}.${operator}`,
          'INVALID_CARD_VALUE_FORMULA',
          'Card value formulas may only use numbers and status stacks',
        );
      } else if (
        selector &&
        formula?.kind === 'number' &&
        typeof stat === 'string' &&
        CARD_VALUE_STATS.has(stat as CardValueStat)
      ) {
        node = {
          op: 'modify_card_value',
          selector,
          stat: stat as CardValueStat,
          operator,
          value: formula.value,
        };
      }
    }
  } else if (operation === 'patch_card') {
    rejectUnknownEntryKeys(
      value,
      [operation, ...CARD_SELECTOR_INPUT_KEYS, 'count', 'add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max', 'extra', 'enabled', 'scope', 'match', 'future_copies', 'timing', 'minimum', 'maximum', 'when'],
      path,
      issues,
      false,
    );
    const patchType = value.patch_card;
    const scope = value.scope ?? 'combat';
    const match = value.match ?? 'instance';
    const includeFutureCopies = value.future_copies === true;
    const count = value.pick === 'all' || value.from === 'all'
      ? undefined
      : value.count === undefined
        ? 1
        : compileFixedCount(value.count, `${path}.count`, issues);
    const selectorSource = value.pick === 'all' || value.from === 'all' ? { ...value, pick: 'all' } : value;
    const selector = count === null ? null : compileCardSelector(selectorSource, path, issues, 'choose', count);
    if (!['resolution', 'turn', 'until_played', 'combat', 'run', 'permanent'].includes(String(scope)))
      addIssue(issues, `${path}.scope`, 'INVALID_CARD_PATCH_SCOPE', `Unsupported card patch scope: ${String(scope)}`);
    if (!['instance', 'run_instance', 'template', 'filter'].includes(String(match)))
      addIssue(issues, `${path}.match`, 'INVALID_CARD_PATCH_MATCH', `Unsupported card patch match: ${String(match)}`);
    if (value.future_copies !== undefined && typeof value.future_copies !== 'boolean')
      addIssue(issues, `${path}.future_copies`, 'INVALID_CARD_PATCH', 'future_copies must be boolean');
    if (includeFutureCopies && match !== 'template' && match !== 'filter')
      addIssue(issues, `${path}.future_copies`, 'INVALID_CARD_PATCH_MATCH', 'future_copies requires template or filter match');

    let patch: EffectCardPatch | null = null;
    const common = {
      scope: scope as EffectCardPatch['scope'],
      match: match as NonNullable<EffectCardPatch['match']>,
      ...(includeFutureCopies ? { includeFutureCopies: true } : {}),
    };
    if (typeof patchType === 'string' && CARD_VALUE_STATS.has(patchType as CardValueStat)) {
      const keys = Array.from(CARD_VALUE_OPERATORS).filter(key => value[key] !== undefined);
      if (keys.length !== 1) addIssue(issues, path, 'INVALID_CARD_VALUE_OPERATOR', 'numeric patch requires exactly one arithmetic operator');
      else {
        const operator = keys[0] as CardValueOperator;
        const formula = compileFormula(value[operator], `${path}.${operator}`, issues);
        if (operator === 'divide' && formula?.kind === 'number' && formula.value === 0)
          addIssue(issues, `${path}.divide`, 'DIVISION_BY_ZERO', 'card patch cannot divide by zero');
        else if (formula?.kind === 'number') patch = { ...common, kind: 'numeric', stat: patchType as CardValueStat, operator, value: formula.value };
      }
    } else if (patchType === 'cost') {
      const operators = ['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max'] as const;
      const keys = operators.filter(key => value[key] !== undefined);
      if (keys.length !== 1) addIssue(issues, path, 'INVALID_CARD_COST_OPERATOR', 'cost patch requires exactly one cost operator');
      else {
        const operator = keys[0];
        const formula = compileFormula(value[operator], `${path}.${operator}`, issues);
        if (operator === 'divide' && formula?.kind === 'number' && formula.value === 0)
          addIssue(issues, `${path}.divide`, 'DIVISION_BY_ZERO', 'cost patch cannot divide by zero');
        else if (formula?.kind === 'number') patch = { ...common, kind: 'cost', operator, value: formula.value };
      }
    } else if (patchType === 'replay') {
      const formula = compileFormula(value.extra, `${path}.extra`, issues);
      if (formula?.kind === 'number') patch = { ...common, kind: 'replay', extra: formula.value };
    } else if (patchType === 'x_value') {
      const operators = ['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max'] as const;
      const keys = operators.filter(key => value[key] !== undefined);
      if (keys.length !== 1) addIssue(issues, path, 'INVALID_X_VALUE_OPERATOR', 'X value patch requires exactly one operator');
      else {
        const operator = keys[0];
        const formula = compileFormula(value[operator], `${path}.${operator}`, issues);
        if (operator === 'divide' && formula?.kind === 'number' && formula.value === 0)
          addIssue(issues, `${path}.divide`, 'DIVISION_BY_ZERO', 'X value patch cannot divide by zero');
        else if (formula?.kind === 'number') patch = { ...common, kind: 'x_value', operator, value: formula.value };
      }
    } else if (patchType === 'dynamic_cost') {
      const operators = ['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max'] as const;
      const keys = operators.filter(key => value[key] !== undefined);
      const timing = value.timing;
      if (!['on_draw', 'while_in_hand', 'on_play'].includes(String(timing)))
        addIssue(issues, `${path}.timing`, 'INVALID_DYNAMIC_COST_TIMING', 'dynamic cost timing must be on_draw, while_in_hand, or on_play');
      if (keys.length !== 1) addIssue(issues, path, 'INVALID_CARD_COST_OPERATOR', 'dynamic cost patch requires exactly one operator');
      else {
        const operator = keys[0];
        const formula = compileFormula(value[operator], `${path}.${operator}`, issues);
        const minimum = value.minimum;
        const maximum = value.maximum;
        if (minimum !== undefined && (typeof minimum !== 'number' || !Number.isFinite(minimum)))
          addIssue(issues, `${path}.minimum`, 'INVALID_DYNAMIC_COST_BOUND', 'minimum must be a finite number');
        if (maximum !== undefined && (typeof maximum !== 'number' || !Number.isFinite(maximum)))
          addIssue(issues, `${path}.maximum`, 'INVALID_DYNAMIC_COST_BOUND', 'maximum must be a finite number');
        if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum)
          addIssue(issues, path, 'INVALID_DYNAMIC_COST_BOUND', 'minimum cannot exceed maximum');
        if (operator === 'divide' && formula?.kind === 'number' && formula.value === 0)
          addIssue(issues, `${path}.divide`, 'DIVISION_BY_ZERO', 'dynamic cost cannot divide by zero');
        else if (formula?.kind === 'number' && ['on_draw', 'while_in_hand', 'on_play'].includes(String(timing))) {
          patch = {
            ...common,
            kind: 'dynamic_cost',
            timing: timing as 'on_draw' | 'while_in_hand' | 'on_play',
            operator,
            value: formula.value,
            ...(typeof minimum === 'number' ? { minimum } : {}),
            ...(typeof maximum === 'number' ? { maximum } : {}),
          };
        }
      }
    } else if (['retain', 'exhaust', 'ethereal', 'innate'].includes(String(patchType))) {
      if (typeof value.enabled !== 'boolean') addIssue(issues, `${path}.enabled`, 'INVALID_CARD_PATCH', 'keyword patch requires enabled boolean');
      else patch = { ...common, kind: 'keyword', keyword: patchType as 'retain' | 'exhaust' | 'ethereal' | 'innate', enabled: value.enabled };
    } else {
      addIssue(issues, `${path}.patch_card`, 'INVALID_CARD_PATCH', `Unsupported card patch type: ${String(patchType)}`);
    }
    if (selector && patch) node = { op: 'apply_card_patch', selector, patch };
  } else if (operation === 'copy' || operation === 'double') {
    rejectUnknownEntryKeys(value, [operation, ...CARD_SELECTOR_INPUT_KEYS, 'when'], path, issues);
    const selectAll = value[operation] === 'all';
    const count = selectAll ? undefined : compileFixedCount(value[operation], `${path}.${operation}`, issues);
    const selectorSource = selectAll ? { ...value, pick: 'all' } : value;
    const selector = count === null ? null : compileCardSelector(selectorSource, path, issues, 'choose', count);
    if (selector) node = { op: operation === 'copy' ? 'copy_cards' : 'double_card_effect', selector };
  } else if (operation === 'auto_play') {
    rejectUnknownEntryKeys(value, [operation, ...CARD_SELECTOR_INPUT_KEYS, 'count', 'free', 'when'], path, issues);
    const selectAll = value.auto_play === 'all';
    const amount = selectAll ? undefined : compileFixedCount(value.auto_play, `${path}.auto_play`, issues);
    const selectorSource = selectAll
      ? { ...value, from: value.from ?? 'draw', pick: 'all' }
      : { ...value, from: value.from ?? 'draw' };
    const selector = amount === null ? null : compileCardSelector(selectorSource, path, issues, 'top', amount ?? undefined);
    if (value.free !== undefined && typeof value.free !== 'boolean')
      addIssue(issues, `${path}.free`, 'INVALID_AUTO_PLAY_COST', 'free must be boolean');
    if (selector && (value.free === undefined || typeof value.free === 'boolean'))
      node = { op: 'auto_play_cards', selector, free: value.free !== false };
  } else if (operation === 'card_destination') {
    rejectUnknownEntryKeys(value, [operation, 'when'], path, issues);
    const destination = value.card_destination;
    if (!['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(String(destination)))
      addIssue(issues, `${path}.card_destination`, 'INVALID_CARD_DESTINATION', `Unsupported card destination: ${String(destination)}`);
    else node = { op: 'set_card_destination', destination: destination as import('./cardRules').PlayedCardDestination };
  } else if (operation === 'move_card' || operation === 'remove_card') {
    rejectUnknownEntryKeys(
      value,
      [operation, ...CARD_SELECTOR_INPUT_KEYS, 'count', 'destination', 'position', 'when'],
      path,
      issues,
    );
    const selectAll = value[operation] === 'all';
    const amount = selectAll ? 100 : compileFixedCount(value[operation], `${path}.${operation}`, issues);
    const selectorSource = selectAll ? { ...value, pick: 'all' } : value;
    const selector = amount === null ? null : compileCardSelector(selectorSource, path, issues, 'choose', amount);
    if (operation === 'remove_card') {
      if (value.destination !== undefined) addIssue(issues, `${path}.destination`, 'UNKNOWN_FIELD', 'remove_card does not accept destination');
      if (value.position !== undefined) addIssue(issues, `${path}.position`, 'UNKNOWN_FIELD', 'remove_card does not accept position');
      if (selector && amount !== null) node = { op: 'remove_cards', selector, amount };
    } else {
      const destinations = { hand: 'hand', draw: 'drawPile', discard: 'discardPile', exhaust: 'exhaustPile' } as const;
      const destination = destinations[value.destination as keyof typeof destinations];
      const position = value.position ?? 'top';
      if (!destination)
        addIssue(issues, `${path}.destination`, 'INVALID_CARD_ZONE', 'move_card destination must be hand, draw, discard, or exhaust');
      if (position !== 'top' && position !== 'bottom')
        addIssue(issues, `${path}.position`, 'INVALID_CARD_POSITION', 'move_card position must be top or bottom');
      if (selector && amount !== null && destination && (position === 'top' || position === 'bottom'))
        node = { op: 'move_cards', selector, amount, destination, position };
    }
  } else if (operation === 'transform_card') {
    rejectUnknownEntryKeys(value, [operation, ...CARD_SELECTOR_INPUT_KEYS, 'count', 'when'], path, issues);
    const templateId = value.transform_card;
    const count = value.count === undefined ? 1 : compileFixedCount(value.count, `${path}.count`, issues);
    const selector = count === null ? null : compileCardSelector(value, path, issues, 'choose', count);
    if (typeof templateId !== 'string' || !templateId.trim())
      addIssue(issues, `${path}.transform_card`, 'INVALID_CARD_TEMPLATE', 'transform_card must reference a template ID');
    const template = typeof templateId === 'string' ? templates.get(templateId) : undefined;
    if (typeof templateId === 'string' && !template)
      addIssue(issues, `${path}.transform_card`, 'MISSING_CARD_TEMPLATE', `Unknown card template: ${templateId}`);
    const replacement = template
      ? compileGeneratedCard(template, `${path}.transform_card`, issues, templates, templateStack, statusNames)
      : null;
    if (selector && replacement) node = { op: 'transform_cards', selector, replacement };
  } else if (operation === 'add_card') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'count', 'when'], path, issues);
    const templateId = value.add_card;
    const destination = value.to ?? 'hand';
    const count = value.count === undefined ? 1 : compileFixedCount(value.count, `${path}.count`, issues);
    if (typeof templateId !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(templateId)) {
      addIssue(issues, `${path}.add_card`, 'INVALID_CARD_ID', 'add_card must reference a template ID');
    } else if (!templates.has(templateId)) {
      addIssue(issues, `${path}.add_card`, 'UNKNOWN_CARD_TEMPLATE', `Unknown card template: ${templateId}`);
    } else if (destination !== 'hand' && destination !== 'deck') {
      addIssue(issues, `${path}.to`, 'INVALID_CARD_ZONE', 'add_card to must be hand or deck');
    } else if (count !== null) {
      const card = compileGeneratedCard(
        templates.get(templateId),
        `${path}.template(${templateId})`,
        issues,
        templates,
        templateStack,
        statusNames,
      );
      if (card) node = { op: 'add_card', zone: destination === 'hand' ? 'hand' : 'draw', card, count };
    }
  } else if (operation === 'card_rule') {
    rejectUnknownEntryKeys(value, [operation, 'limit', 'extra', 'to'], path, issues, false);
    const rule = value.card_rule;
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    if (typeof rule !== 'string' || !CARD_PLAY_RULES.has(rule as CardPlayRuleKind)) {
      addIssue(issues, `${path}.card_rule`, 'INVALID_CARD_PLAY_RULE', `Unsupported card rule: ${String(rule)}`);
    }
    if (value.limit === undefined) {
      addIssue(issues, `${path}.limit`, 'MISSING_CARD_RULE_LIMIT', 'card_rule requires limit');
    }
    const limitFormula =
      value.limit === 'all' || value.limit === undefined
        ? null
        : compileFormula(value.limit, `${path}.limit`, issues);
    if (limitFormula && (limitFormula.kind !== 'number' || !isSupportedModifierFormula(limitFormula.value))) {
      addIssue(issues, `${path}.limit`, 'INVALID_CARD_RULE_FORMULA', 'Card rule formulas may only use numbers and status stacks');
    }
    const extraFormula =
      rule === 'replay' ? compileFormula(value.extra ?? 1, `${path}.extra`, issues) : null;
    if (rule === 'free' && value.extra !== undefined) {
      addIssue(issues, `${path}.extra`, 'UNEXPECTED_CARD_REPLAY_COUNT', 'free card_rule does not accept extra');
    }
    if (extraFormula && (extraFormula.kind !== 'number' || !isSupportedModifierFormula(extraFormula.value))) {
      addIssue(issues, `${path}.extra`, 'INVALID_CARD_RULE_FORMULA', 'Card rule formulas may only use numbers and status stacks');
    }
    const validLimit = value.limit === 'all' || limitFormula?.kind === 'number';
    const validExtra = rule === 'free' || extraFormula?.kind === 'number';
    if (
      target &&
      typeof rule === 'string' &&
      CARD_PLAY_RULES.has(rule as CardPlayRuleKind) &&
      validLimit &&
      validExtra
    ) {
      node = {
        op: 'card_play_rule',
        target,
        rule: rule as CardPlayRuleKind,
        limit: value.limit === 'all' ? 'all' : (limitFormula as Extract<FormulaResult, { kind: 'number' }>).value,
        ...(rule === 'replay'
          ? { extra: (extraFormula as Extract<FormulaResult, { kind: 'number' }>).value }
          : {}),
      };
    }
  } else if (operation === 'schedule') {
    rejectUnknownEntryKeys(
      value,
      [operation, 'phase', 'priority', 'repeat_every', 'repeats', 'effects', 'when'],
      path,
      issues,
      false,
    );
    const afterTurns = value.schedule;
    const phase = value.phase ?? 'turn_start';
    const priority = value.priority ?? 0;
    const repeatEvery = value.repeat_every;
    const repeats = value.repeats;
    if (!Number.isInteger(afterTurns) || Number(afterTurns) < 0 || Number(afterTurns) > 999)
      addIssue(issues, `${path}.schedule`, 'INVALID_SCHEDULE_DELAY', 'schedule must be an integer from 0 to 999');
    if (!['turn_start', 'before_draw', 'after_draw', 'turn_end'].includes(String(phase)))
      addIssue(issues, `${path}.phase`, 'INVALID_SCHEDULE_PHASE', `Unsupported schedule phase: ${String(phase)}`);
    if (!Number.isInteger(priority) || Math.abs(Number(priority)) > 100000)
      addIssue(issues, `${path}.priority`, 'INVALID_SCHEDULE_PRIORITY', 'priority must be an integer with absolute value at most 100000');
    if (repeatEvery !== undefined && (!Number.isInteger(repeatEvery) || Number(repeatEvery) < 1 || Number(repeatEvery) > 999))
      addIssue(issues, `${path}.repeat_every`, 'INVALID_SCHEDULE_REPEAT', 'repeat_every must be an integer from 1 to 999');
    if (repeats !== undefined && (!Number.isInteger(repeats) || Number(repeats) < 1 || Number(repeats) > 999))
      addIssue(issues, `${path}.repeats`, 'INVALID_SCHEDULE_REPEAT', 'repeats must be an integer from 1 to 999');
    if ((repeatEvery === undefined) !== (repeats === undefined))
      addIssue(issues, path, 'INCOMPLETE_SCHEDULE_REPEAT', 'repeat_every and repeats must be provided together');
    if (!(Array.isArray(value.effects) || isRecord(value.effects))) {
      addIssue(issues, `${path}.effects`, 'EMPTY_SCHEDULE_EFFECTS', 'schedule requires nested effects');
    } else {
      const nested = compileCompactEffectListInternal(
        value.effects,
        { creates: Array.from(templates.values()), statusNames },
        templateStack,
      );
      if (!nested.ok) {
        nested.issues.forEach(issue =>
          addIssue(
            issues,
            `${path}.effects${issue.path === '$' ? '' : issue.path.slice(1)}`,
            issue.code,
            issue.message,
          ),
        );
      } else if (
        Number.isInteger(afterTurns) &&
        Number(afterTurns) >= 0 &&
        Number(afterTurns) <= 999 &&
        ['turn_start', 'before_draw', 'after_draw', 'turn_end'].includes(String(phase)) &&
        Number.isInteger(priority) &&
        Math.abs(Number(priority)) <= 100000 &&
        (repeatEvery === undefined || (Number.isInteger(repeatEvery) && Number(repeatEvery) >= 1 && Number(repeatEvery) <= 999)) &&
        (repeats === undefined || (Number.isInteger(repeats) && Number(repeats) >= 1 && Number(repeats) <= 999)) &&
        ((repeatEvery === undefined) === (repeats === undefined))
      ) {
        node = {
          op: 'schedule_effect',
          afterTurns: Number(afterTurns),
          phase: phase as 'turn_start' | 'before_draw' | 'after_draw' | 'turn_end',
          ...(Number(priority) !== 0 ? { priority: Number(priority) } : {}),
          ...(repeatEvery !== undefined ? { repeatEvery: Number(repeatEvery), repeats: Number(repeats) } : {}),
          effects: nested.value.steps,
        };
      }
    }
  } else if (operation === 'modify') {
    rejectUnknownEntryKeys(
      value,
      [operation, 'add', 'subtract', 'multiply', 'divide', 'set', 'to', 'targets'],
      path,
      issues,
      false,
    );
    const stat = value.modify;
    const modifierKeys = Array.from(MODIFIER_OPERATORS).filter(key => value[key] !== undefined);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    if (typeof stat !== 'string' || !MODIFIER_STATS.has(stat as ModifierStat)) {
      addIssue(issues, `${path}.modify`, 'INVALID_MODIFIER', `Unsupported modifier: ${String(stat)}`);
    }
    if (modifierKeys.length !== 1) {
      addIssue(
        issues,
        path,
        'INVALID_MODIFIER_OPERATOR',
        'modify requires exactly one of add/subtract/multiply/divide/set',
      );
    } else {
      const operator = modifierKeys[0] as EffectModifierOperator;
      const formula = compileFormula(value[operator], `${path}.${operator}`, issues);
      if (formula && (formula.kind !== 'number' || !isSupportedModifierFormula(formula.value))) {
        addIssue(
          issues,
          `${path}.${operator}`,
          'INVALID_MODIFIER_FORMULA',
          'Modifier formulas may only use numbers and status stacks',
        );
      } else if (target && formula && typeof stat === 'string' && MODIFIER_STATS.has(stat as ModifierStat)) {
        const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues);
        node = lowerFormula(formula, result => ({
          op: 'modify',
          target,
          ...(targetSelector ? { targetSelector } : {}),
          stat: stat as ModifierStat,
          operator,
          value: result,
        }));
      }
    }
  } else {
    addIssue(issues, `${path}.${operation}`, 'UNKNOWN_EFFECT', `Unknown compact effect: ${operation}`);
  }
  if (!node) return null;
  const conditional = applyWhen(node, value.when, path, issues);
  return conditional ? applyTrigger(conditional, value.on, path, issues) : null;
}

function compileEntry(
  value: unknown,
  path: string,
  issues: CompactEffectValidationIssue[],
  templates: ReadonlyMap<string, Record<string, unknown>>,
  templateStack: readonly string[],
  statusNames?: Readonly<Record<string, string>>,
  implicitTarget?: EffectTarget,
): EffectNode[] | null {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_EFFECT', 'Effect must be an object');
    return null;
  }
  const operations = compactEffectOperationKeys(value);
  if (operations.length <= 1) {
    const hits =
      operations[0] === 'damage' && value.hits !== undefined ? compileHitCount(value.hits, `${path}.hits`, issues) : 1;
    const node = compileSingleEntry(value, path, issues, templates, templateStack, statusNames, implicitTarget);
    if (!node || hits === null) return null;
    return operations[0] === 'damage' ? repeatDamageNode(node, hits) : [node];
  }

  if (value.hits !== undefined) {
    addIssue(issues, `${path}.hits`, 'INVALID_EFFECT_BUNDLE', 'hits requires a separate damage effect object');
    return null;
  }
  const auxiliaryOperations = operations.filter(operation => !COMPACT_EFFECT_BUNDLE_OPERATION_SET.has(operation));
  const hasOneSafeAuxiliary =
    auxiliaryOperations.length === 1 &&
    COMPACT_EFFECT_SAFE_AUXILIARY_BUNDLE_OPERATION_SET.has(auxiliaryOperations[0]);
  if (auxiliaryOperations.length > 0 && !hasOneSafeAuxiliary) {
    auxiliaryOperations
      .forEach(operation =>
        addIssue(
          issues,
          `${path}.${operation}`,
          'INVALID_EFFECT_BUNDLE',
          'This operation must remain a separate effect object',
        ),
      );
    addIssue(
      issues,
      path,
      'INVALID_EFFECT_BUNDLE',
      'Only common numeric, status, and draw effects may share one object; use separate array entries for other operations',
    );
    return null;
  }

  const allowedMeta = compactBundleMetaKeys(operations);
  Object.keys(value).forEach(key => {
    if (COMPACT_EFFECT_META_KEY_SET.has(key) && !allowedMeta.has(key)) {
      addIssue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', `Unknown bundle field: ${key}`);
    }
  });
  if (issues.some(issue => issue.path === path || issue.path.startsWith(`${path}.`))) return null;

  const orderedOperations = [
    ...sortCompactBundleOperations(operations.filter(operation => COMPACT_EFFECT_BUNDLE_OPERATION_SET.has(operation))),
    ...auxiliaryOperations,
  ];
  const nodes = orderedOperations.map(operation =>
    compileSingleEntry(
      projectCompactOperation(value, operation, false),
      path,
      issues,
      templates,
      templateStack,
      statusNames,
      implicitTarget,
    ),
  );
  if (nodes.some(node => node === null)) return null;

  let grouped = nodes as EffectNode[];
  if (value.when !== undefined) {
    const condition = compileWhen(value.when, `${path}.when`, issues);
    if (!condition) return null;
    grouped = [{ op: 'if', condition, then: grouped }];
  }
  if (value.on !== undefined) {
    if (typeof value.on !== 'string' || !REGISTERABLE_EFFECT_TRIGGER_SET.has(value.on)) {
      addIssue(issues, `${path}.on`, 'INVALID_TRIGGER', `Unsupported effect trigger: ${String(value.on)}`);
      return null;
    }
    grouped = [{ op: 'register_trigger', target: 'self', trigger: value.on as EffectTrigger, effects: grouped }];
  }
  return grouped;
}

/** Compile an AI-facing `effects` array into the portable internal AST. */
function compileCompactEffectListInternal(
  value: unknown,
  options: CompactEffectCompilationOptions = {},
  templateStack: readonly string[] = [],
): CompactEffectCompilationResult {
  const issues: CompactEffectValidationIssue[] = [];
  const entries = normalizeCompactEffectEntries(value);
  if (!entries || entries.length === 0) {
    return {
      ok: false,
      issues: [{ path: '$', code: 'EMPTY_EFFECTS', message: 'effects must contain at least one effect' }],
    };
  }
  if (entries.length > 256) {
    return {
      ok: false,
      issues: [{ path: '$', code: 'TOO_MANY_EFFECTS', message: 'effects cannot exceed 256 entries' }],
    };
  }
  const templates = new Map<string, Record<string, unknown>>();
  if (options.creates !== undefined) {
    if (!Array.isArray(options.creates)) {
      addIssue(issues, '$.creates', 'INVALID_CARD_TEMPLATES', 'creates must be an array');
    } else {
      options.creates.forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entry.id)) {
          addIssue(issues, `$.creates[${index}].id`, 'INVALID_CARD_ID', 'Template id is invalid');
        } else if (templates.has(entry.id)) {
          addIssue(issues, `$.creates[${index}].id`, 'DUPLICATE_CARD_TEMPLATE', `Duplicate template: ${entry.id}`);
        } else {
          templates.set(entry.id, entry);
        }
      });
    }
  }
  const directObject = !Array.isArray(value);
  const steps = entries.map((entry, index) =>
    compileEntry(
      entry,
      directObject ? '$' : `$[${index}]`,
      issues,
      templates,
      templateStack,
      options.statusNames,
      options.implicitTarget,
    ),
  );
  if (steps.some(entry => entry === null) || issues.length > 0) return { ok: false, issues };
  let programSteps = (steps as EffectNode[][]).flat();
  if (options.when !== undefined) {
    const condition = compileWhen(options.when, '$.when', issues);
    if (!condition) return { ok: false, issues };
    programSteps = [{ op: 'if', condition, then: programSteps }];
  }
  if (options.trigger !== undefined) {
    if (typeof options.trigger !== 'string' || !REGISTERABLE_EFFECT_TRIGGER_SET.has(options.trigger)) {
      addIssue(issues, '$.trigger', 'INVALID_TRIGGER', `Unsupported card trigger: ${String(options.trigger)}`);
      return { ok: false, issues };
    }
    const explicitTriggers = programSteps.filter(step => step.op === 'register_trigger');
    const defaultTriggerEffects = programSteps.filter(step => step.op !== 'register_trigger');
    programSteps = [
      ...(defaultTriggerEffects.length > 0
        ? [
            {
              op: 'register_trigger' as const,
              target: 'self' as const,
              trigger: options.trigger as EffectTrigger,
              effects: defaultTriggerEffects,
            },
          ]
        : []),
      ...explicitTriggers,
    ];
  }
  const program: EffectProgram = { spec: EFFECT_PROGRAM_SPEC, steps: programSteps };
  const validation = validateEffectProgram(program);
  if (!validation.ok) {
    return {
      ok: false,
      issues: validation.issues.map(item => ({ path: item.path, code: item.code, message: item.message })),
    };
  }
  return { ok: true, value: program };
}

/** Compile AI-facing shallow effects and optional card templates into the portable internal AST. */
export function compileCompactEffectList(
  value: unknown,
  options: CompactEffectCompilationOptions = {},
): CompactEffectCompilationResult {
  return compileCompactEffectListInternal(value, options);
}
