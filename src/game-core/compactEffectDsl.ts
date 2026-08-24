import jsep from 'jsep';

import { REGISTERABLE_EFFECT_TRIGGER_SET } from './battleTriggers';
import {
  COMPACT_EFFECT_BUNDLE_OPERATION_SET,
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
  type CardSelector,
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
  validateEffectProgram,
} from './effectDsl';
import { describeCompactCard } from './contentDescription';

export interface CompactEffectValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type CompactEffectCompilationResult =
  { ok: true; value: EffectProgram } | { ok: false; issues: CompactEffectValidationIssue[] };

export interface CompactEffectCompilationOptions {
  trigger?: unknown;
  creates?: unknown;
  statusNames?: Readonly<Record<string, string>>;
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
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addIssue(issues, path, 'INVALID_NUMBER', 'Formula numbers must be finite and safe');
    return null;
  }
  return value;
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
    if (!Number.isFinite(value)) addIssue(issues, path, 'INVALID_NUMBER', 'Number must be finite');
    return Number.isFinite(value) ? { kind: 'number', value } : null;
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
  if (expression.op === 'negate') return isSupportedModifierFormula(expression.value);
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

function compileCardSelector(
  value: Record<string, unknown>,
  path: string,
  issues: CompactEffectValidationIssue[],
  defaultPick: CardPick,
  count?: number,
): CardSelector | null {
  const zone = (value.from ?? 'hand') as CardZone;
  const pick = (value.pick ?? defaultPick) as CardPick;
  if (!['hand', 'draw', 'discard', 'all'].includes(zone)) {
    addIssue(issues, `${path}.from`, 'INVALID_CARD_ZONE', `from must be hand, draw, discard, or all: ${String(zone)}`);
    return null;
  }
  if (!['random', 'choose', 'left', 'right', 'all'].includes(pick)) {
    addIssue(
      issues,
      `${path}.pick`,
      'INVALID_CARD_PICK',
      `pick must be random, choose, left, right, or all: ${String(pick)}`,
    );
    return null;
  }
  if ((pick === 'left' || pick === 'right') && zone !== 'hand') {
    addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', 'left/right can only select cards from hand');
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
  return count === undefined ? { zone, pick } : { zone, pick, count };
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
  if ((type === 'Power') !== (value.trigger !== undefined)) {
    addIssue(issues, `${path}.trigger`, 'INVALID_TRIGGER', 'Only Power templates require trigger');
    return null;
  }
  const nested = compileCompactEffectListInternal(
    value.effects,
    { trigger: value.trigger, creates: Array.from(templates.values()), statusNames },
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
  const result: GeneratedCardDefinition = {
    id,
    name: name.trim(),
    emoji: typeof value.emoji === 'string' ? value.emoji : '🃏',
    type,
    rarity,
    cost,
    description:
      typeof value.description === 'string' && value.description.trim()
        ? value.description.trim()
        : describeCompactCard(value, { includeKeywords: false, statusNames }),
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
    rejectUnknownEntryKeys(value, [operation, ...(operation === 'damage' ? ['hits'] : []), 'to', 'when'], path, issues);
    const target = compileTarget(value.to, amountOperation.target, `${path}.to`, issues);
    const formula = compileFormula(value[operation], `${path}.${operation}`, issues);
    if (target && formula) {
      node = lowerFormula(formula, amount => ({ op: amountOperation.op, target, amount }));
    }
  } else if (SET_OPERATIONS[operation]) {
    rejectUnknownEntryKeys(value, [operation, 'to', 'when'], path, issues);
    const target = compileTarget(value.to, 'self', `${path}.to`, issues);
    const formula = compileFormula(value[operation], `${path}.${operation}`, issues);
    const stat = SET_OPERATIONS[operation];
    if (target && formula) {
      node = lowerFormula(formula, assignedValue => ({ op: 'set_stat', target, stat, value: assignedValue }));
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
    rejectUnknownEntryKeys(value, [operation, 'stacks', 'to', 'when'], path, issues);
    const status = value.apply_status;
    const target = compileTarget(value.to, 'opponent', `${path}.to`, issues);
    if (typeof status !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(status)) {
      addIssue(issues, `${path}.apply_status`, 'INVALID_STATUS_ID', 'apply_status must be a simple status ID');
    }
    const stacks = compileFormula(value.stacks ?? 1, `${path}.stacks`, issues);
    if (target && typeof status === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(status) && stacks) {
      node = lowerFormula(stacks, amount => ({ op: 'apply_status', target, status, stacks: amount }));
    }
  } else if (operation === 'remove_status') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'when'], path, issues);
    const status = value.remove_status;
    const target = compileTarget(value.to, 'opponent', `${path}.to`, issues);
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
      node = { op: 'remove_status', target, status };
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
    rejectUnknownEntryKeys(value, [operation, 'from', 'pick', 'when'], path, issues);
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
    rejectUnknownEntryKeys(value, [operation, 'from', 'pick', 'count', 'when'], path, issues);
    const count = value.count === undefined ? 1 : compileFixedCount(value.count, `${path}.count`, issues);
    const selector = count === null ? null : compileCardSelector(value, path, issues, 'choose', count);
    const amount = compileFormula(value.reduce_cost, `${path}.reduce_cost`, issues);
    if (selector && amount)
      node = lowerFormula(amount, reduction => ({ op: 'reduce_card_cost', selector, amount: reduction }));
  } else if (operation === 'copy' || operation === 'double') {
    rejectUnknownEntryKeys(value, [operation, 'from', 'pick', 'when'], path, issues);
    const selectAll = value[operation] === 'all';
    const count = selectAll ? undefined : compileFixedCount(value[operation], `${path}.${operation}`, issues);
    const selectorSource = selectAll ? { ...value, pick: 'all' } : value;
    const selector = count === null ? null : compileCardSelector(selectorSource, path, issues, 'choose', count);
    if (selector) node = { op: operation === 'copy' ? 'copy_cards' : 'double_card_effect', selector };
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
  } else if (operation === 'modify') {
    rejectUnknownEntryKeys(
      value,
      [operation, 'add', 'subtract', 'multiply', 'divide', 'set', 'to'],
      path,
      issues,
      false,
    );
    const stat = value.modify;
    const modifierKeys = Array.from(MODIFIER_OPERATORS).filter(key => value[key] !== undefined);
    const target = compileTarget(value.to, 'self', `${path}.to`, issues);
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
        node = lowerFormula(formula, result => ({
          op: 'modify',
          target,
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
): EffectNode[] | null {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_EFFECT', 'Effect must be an object');
    return null;
  }
  const operations = compactEffectOperationKeys(value);
  if (operations.length <= 1) {
    const hits =
      operations[0] === 'damage' && value.hits !== undefined ? compileHitCount(value.hits, `${path}.hits`, issues) : 1;
    const node = compileSingleEntry(value, path, issues, templates, templateStack, statusNames);
    if (!node || hits === null) return null;
    return operations[0] === 'damage' ? repeatDamageNode(node, hits) : [node];
  }

  if (value.hits !== undefined) {
    addIssue(issues, `${path}.hits`, 'INVALID_EFFECT_BUNDLE', 'hits requires a separate damage effect object');
    return null;
  }
  if (!operations.every(operation => COMPACT_EFFECT_BUNDLE_OPERATION_SET.has(operation))) {
    operations
      .filter(operation => !COMPACT_EFFECT_BUNDLE_OPERATION_SET.has(operation))
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

  const nodes = sortCompactBundleOperations(operations).map(operation =>
    compileSingleEntry(
      projectCompactOperation(value, operation, false),
      path,
      issues,
      templates,
      templateStack,
      statusNames,
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
    compileEntry(entry, directObject ? '$' : `$[${index}]`, issues, templates, templateStack, options.statusNames),
  );
  if (steps.some(entry => entry === null) || issues.length > 0) return { ok: false, issues };
  let programSteps = (steps as EffectNode[][]).flat();
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
