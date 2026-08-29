import jsep from 'jsep';

import { ABILITY_TRIGGER_SET, REGISTERABLE_EFFECT_TRIGGER_SET } from './battleTriggers';
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
  type CardType,
  type CardValueOperator,
  type CardValueStat,
  type CardZone,
  type ConditionExpression,
  type EffectNode,
  type EffectProgram,
  type EffectEnemySpawnDefinition,
  type EffectTarget,
  type EffectTrigger,
  type GeneratedCardDefinition,
  type EffectModifierOperator,
  type ModifierStat,
  type NumericExpression,
  type EffectCardPatch,
  type EffectCardUpgradeChange,
  type EffectCardAttachmentDefinition,
  validateEffectProgram,
} from './effectDsl';
import type { CardMoveReason } from './battleEventJournal';
import type { EventHistoryMetric, EventTriggerQuery } from './battleEventJournal';
import { resolveEventTriggerQueryInput, resolveTriggerInput } from './triggerInput';
import type { EnemyTargetSelector } from './combatantCollection';
import { validateCardCost, type CardCost } from './combatResource';
import type { SummonSelector } from './summonUnit';
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
  triggerQuery?: EventTriggerQuery;
  /** Optional condition shared by every top-level effect in a named definition. */
  when?: unknown;
  creates?: unknown;
  statusNames?: Readonly<Record<string, string>>;
  implicitTarget?: EffectTarget;
  /** Relative side whose combatant collection may be addressed by `targets`. */
  enemyCollectionTarget?: EffectTarget;
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
const MODIFIER_STATS = new Set<ModifierStat>(['damage', 'damage_taken', 'lust', 'lust_taken', 'heal', 'block', 'summon_capacity']);
const MODIFIER_OPERATORS = new Set<EffectModifierOperator>(['add', 'subtract', 'multiply', 'divide', 'set']);
const CARD_VALUE_STATS = new Set<CardValueStat>(['damage', 'block', 'lust', 'stacks']);
const CARD_VALUE_OPERATORS = new Set<CardValueOperator>(['add', 'subtract', 'multiply', 'divide']);
const CARD_PLAY_RULES = new Set<CardPlayRuleKind>([
  'replay', 'free', 'retain_hand', 'retain_block', 'limit_draw', 'limit_block_gain',
  'limit_energy_gain', 'deny_card_play', 'allow_card_play', 'limit_card_play', 'card_destination',
]);
const DAMAGE_KINDS = new Set(['attack', 'effect', 'hp_loss', 'retaliation', 'damage_over_time']);
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

function compileCompactSummonSelector(
  value: unknown,
  path: string,
  issues: CompactEffectValidationIssue[],
): SummonSelector | null {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_SUMMON_SELECTOR', 'summon selector must be an object');
    return null;
  }
  rejectUnknownEntryKeys(
    value,
    ['owner', 'pick', 'count', 'id', 'template_id', 'tags', 'slot', 'include_untargetable'],
    path,
    issues,
    false,
  );
  const owner = value.owner ?? 'self';
  const pick = value.pick ?? 'left';
  const stableId = (entry: unknown): entry is string =>
    typeof entry === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry);
  if (!['self', 'opponent', 'any'].includes(String(owner)))
    addIssue(issues, `${path}.owner`, 'INVALID_SUMMON_OWNER', 'owner must be self, opponent, or any');
  if (!['left', 'right', 'choose', 'first', 'last', 'random', 'random_n', 'all', 'lowest_hp', 'highest_hp', 'by_id'].includes(String(pick)))
    addIssue(issues, `${path}.pick`, 'INVALID_SUMMON_PICK', 'unsupported summon pick mode');
  if (value.count !== undefined && (!Number.isSafeInteger(value.count) || Number(value.count) < 1))
    addIssue(issues, `${path}.count`, 'INVALID_SUMMON_COUNT', 'summon selector count must be a positive safe integer');
  if (pick === 'all' && value.count !== undefined)
    addIssue(issues, `${path}.count`, 'INVALID_SUMMON_COUNT', 'all cannot include count');
  if (pick === 'by_id' && !stableId(value.id))
    addIssue(issues, `${path}.id`, 'MISSING_SUMMON_ID', 'by_id requires a stable summon instance id');
  if (value.id !== undefined && !stableId(value.id))
    addIssue(issues, `${path}.id`, 'INVALID_SUMMON_ID', 'summon instance id must be stable English');
  if (value.template_id !== undefined && !stableId(value.template_id))
    addIssue(issues, `${path}.template_id`, 'INVALID_SUMMON_ID', 'summon template_id must be stable English');
  if (value.slot !== undefined && !stableId(value.slot))
    addIssue(issues, `${path}.slot`, 'INVALID_SUMMON_SLOT', 'summon slot must be stable English');
  if (value.tags !== undefined && (
    !Array.isArray(value.tags) || value.tags.length < 1 || value.tags.length > 32 ||
    value.tags.some(tag => !stableId(tag)) || new Set(value.tags).size !== value.tags.length
  )) addIssue(issues, `${path}.tags`, 'INVALID_SUMMON_TAGS', 'summon tags must be unique stable English ids');
  if (value.include_untargetable !== undefined && typeof value.include_untargetable !== 'boolean')
    addIssue(issues, `${path}.include_untargetable`, 'INVALID_SUMMON_SELECTOR', 'include_untargetable must be boolean');
  if (issues.some(issue => issue.path === path || issue.path.startsWith(`${path}.`))) return null;
  return {
    owner: owner as SummonSelector['owner'],
    pick: pick as SummonSelector['pick'],
    ...(value.count !== undefined ? { count: Number(value.count) } : {}),
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(typeof value.template_id === 'string' ? { templateId: value.template_id } : {}),
    ...(Array.isArray(value.tags) ? { tags: value.tags as string[] } : {}),
    ...(typeof value.slot === 'string' ? { slot: value.slot } : {}),
    ...(typeof value.include_untargetable === 'boolean' ? { includeUntargetable: value.include_untargetable } : {}),
  };
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
  if (/^spent_resource\.[A-Za-z_][A-Za-z0-9_]*$/.test(path)) return `context.${path}`;
  if (/^x_resource\.[A-Za-z_][A-Za-z0-9_]*$/.test(path)) return `context.${path}`;
  if (path === 'x_value') return 'context.x_value';
  if (path === 'stacks') return 'context.status_stacks';
  if (path === 'orb_value') return 'context.orb_value';
  if (path === 'turn_number') return 'battle.turn_number';
  if (path === 'cards_played_this_turn') return 'battle.cards_played_this_turn';
  if (path === 'attacks_played_this_turn') return 'battle.attacks_played_this_turn';
  if (path === 'skills_played_this_turn') return 'battle.skills_played_this_turn';
  // Models often treat battle counters like actor attributes. Their meaning is
  // still unambiguous, so accept the harmless `self.` prefix at the boundary.
  if (path === 'self.turn_number') return 'battle.turn_number';
  if (path === 'self.cards_played_this_turn') return 'battle.cards_played_this_turn';
  if (path === 'self.attacks_played_this_turn') return 'battle.attacks_played_this_turn';
  if (path === 'self.skills_played_this_turn') return 'battle.skills_played_this_turn';
  if (/^(self|opponent)\.(hp|max_hp|lust|max_lust|energy|max_energy|block)$/.test(path)) return path;
  if (/^self\.(hand_size|draw_pile_size|discard_pile_size|exhaust_pile_size)$/.test(path)) return path;
  if (/^(self|opponent)\.status\.[A-Za-z0-9_]+\.stacks$/.test(path)) return path;
  if (/^(self|opponent)\.resource\.[A-Za-z_][A-Za-z0-9_]*\.(current|max)$/.test(path)) return path;
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
  if (node.type === 'CallExpression') {
    const call = node as jsep.CallExpression;
    const name = call.callee.type === 'Identifier' ? (call.callee as jsep.Identifier).name : '';
    const literal = (index: number): string | null => {
      const argument = call.arguments[index] as jsep.Expression | undefined;
      return argument?.type === 'Literal' && typeof (argument as jsep.Literal).value === 'string'
        ? String((argument as jsep.Literal).value)
        : null;
    };
    if (name === 'last_card_type') {
      const cardType = literal(0);
      if (!cardType || !CARD_TYPES.has(cardType)) {
        addIssue(issues, path, 'INVALID_CARD_TYPE', 'last_card_type requires one supported card type string');
        return null;
      }
      return { op: 'last_card_type', cardType: cardType as CardType };
    }
    if (name === 'intent_is') {
      const intentType = literal(0);
      if (!intentType) {
        addIssue(issues, path, 'INVALID_INTENT_TYPE', 'intent_is requires one non-empty intent type string');
        return null;
      }
      return { op: 'intent_type', intentType };
    }
    if (name === 'pile_empty' || name === 'only_card') {
      const zone = literal(0);
      if (!zone || !['hand', 'draw', 'discard', 'exhaust', 'all', 'combat'].includes(zone)) {
        addIssue(issues, path, 'INVALID_CARD_ZONE', `${name} requires a supported card zone string`);
        return null;
      }
      const cardType = literal(1);
      if (cardType && !CARD_TYPES.has(cardType)) {
        addIssue(issues, path, 'INVALID_CARD_TYPE', `${name} received an unsupported card type`);
        return null;
      }
      const selector: CardSelector = {
        zone: zone as CardSelector['zone'],
        pick: 'all',
        ...(cardType ? { filter: { types: [cardType as CardType] } } : {}),
      };
      return {
        op: 'compare',
        relation: 'eq',
        left: { op: 'count_cards', selector },
        right: name === 'pile_empty' ? 0 : 1,
      };
    }
  }
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
  if (isRecord(value) && isRecord(value.history)) {
    const raw = value.history;
    rejectUnknownEntryKeys(
      value,
      ['history'],
      path,
      issues,
      false,
    );
    rejectUnknownEntryKeys(
      raw,
      [
        'metric', 'scope', 'event', 'phase', 'reason', 'source_kind', 'source_id', 'damage_type',
        'card_type', 'template_id', 'card_instance_id', 'actor_id', 'target_id',
      ],
      `${path}.history`,
      issues,
      false,
    );
    const metric = raw.metric;
    if (!['count', 'last_damage', 'last_hp_loss', 'last_heal', 'last_resource_spent', 'last_turn', 'last_sequence'].includes(String(metric))) {
      addIssue(issues, `${path}.history.metric`, 'INVALID_HISTORY_METRIC', `Unsupported history metric: ${String(metric)}`);
      return null;
    }
    const query = resolveEventTriggerQueryInput(raw) || { scope: 'combat' as const };
    const expression: NumericExpression = {
      op: 'history',
      metric: metric as EventHistoryMetric,
      scope: query.scope,
      ...(query.filter ? { filter: query.filter } : {}),
    };
    return { kind: 'number', value: expression };
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
  enemyCollectionTarget: EffectTarget = 'opponent',
): EnemyTargetSelector | undefined {
  if (value === undefined) return undefined;
  if (target !== enemyCollectionTarget) {
    addIssue(
      issues,
      path,
      'INVALID_TARGET_SELECTOR',
      `targets can only address the ${enemyCollectionTarget} combatant collection in this source context`,
    );
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
  if (!['hand', 'draw', 'discard', 'exhaust', 'all', 'combat'].includes(zone)) {
    addIssue(issues, `${path}.from`, 'INVALID_CARD_ZONE', `from must be hand, draw, discard, exhaust, all, or combat: ${String(zone)}`);
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
  if ((zone === 'all' || zone === 'combat') && pick !== 'all') {
    addIssue(issues, `${path}.pick`, 'INVALID_CARD_PICK', 'from: all/combat requires pick: all');
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
  'name',
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
  'root_only',
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
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || !value.name.trim())
      addIssue(issues, `${path}.name`, 'INVALID_CARD_FILTER', 'name must be a non-empty card name');
    else filter.name = value.name.trim();
  }
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
    const costIssue = validateCardCost(value.cost);
    if (costIssue) addIssue(issues, `${path}.cost`, 'INVALID_CARD_FILTER', costIssue);
    else filter.cost = typeof value.cost === 'object' ? structuredClone(value.cost) as CardCost : value.cost as CardCost;
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
  if (value.root_only !== undefined) {
    if (typeof value.root_only !== 'boolean')
      addIssue(issues, `${path}.root_only`, 'INVALID_CARD_FILTER', 'root_only must be boolean');
    else filter.rootOnly = value.root_only;
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
  let cost: CardCost | undefined;
  if (type !== 'Curse') {
    const candidate = value.cost ?? 0;
    const costIssue = validateCardCost(candidate);
    if (costIssue) {
      addIssue(issues, `${path}.cost`, 'INVALID_CARD_COST', costIssue);
      return null;
    }
    cost = typeof candidate === 'object' ? structuredClone(candidate) as CardCost : candidate as CardCost;
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
  enemyCollectionTarget: EffectTarget = 'opponent',
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
  const compileNestedEffects = (raw: unknown, nestedPath: string): EffectNode[] | null => {
    if (raw === undefined) return [];
    const entries = normalizeCompactEffectEntries(raw);
    if (!entries) {
      addIssue(issues, nestedPath, 'INVALID_EFFECT_LIST', 'nested effects must be an array or effect object');
      return null;
    }
    const compiled = entries.map((entry, index) =>
      compileEntry(
        entry,
        `${nestedPath}[${index}]`,
        issues,
        templates,
        templateStack,
        statusNames,
        implicitTarget,
        enemyCollectionTarget,
      ));
    return compiled.some(entry => entry === null) ? null : (compiled as EffectNode[][]).flat();
  };
  const amountOperation = AMOUNT_OPERATIONS[operation];
  if (amountOperation) {
    rejectUnknownEntryKeys(
      value,
      [operation, ...(operation === 'damage' ? ['hits', 'damage_type', 'bypass_block', 'lifesteal'] : []), 'to', 'targets', 'when'],
      path,
      issues,
    );
    const target = compileTarget(value.to, implicitTarget ?? amountOperation.target, `${path}.to`, issues);
    const formula = compileFormula(value[operation], `${path}.${operation}`, issues);
    const damageKind = value.damage_type;
    if (operation === 'damage' && damageKind !== undefined && !DAMAGE_KINDS.has(String(damageKind)))
      addIssue(issues, `${path}.damage_type`, 'INVALID_DAMAGE_KIND', `Unsupported damage type: ${String(damageKind)}`);
    if (operation === 'damage' && value.bypass_block !== undefined && typeof value.bypass_block !== 'boolean')
      addIssue(issues, `${path}.bypass_block`, 'INVALID_DAMAGE_PACKET', 'bypass_block must be boolean');
    if (operation === 'damage' && damageKind === 'hp_loss' && value.bypass_block === false)
      addIssue(issues, `${path}.bypass_block`, 'CONFLICTING_DAMAGE_PACKET', 'hp_loss always bypasses block');
    const lifesteal = operation === 'damage' && value.lifesteal !== undefined
      ? compileFormula(value.lifesteal, `${path}.lifesteal`, issues)
      : null;
    if (lifesteal?.kind === 'choice')
      addIssue(issues, `${path}.lifesteal`, 'INVALID_LIFESTEAL_FORMULA', 'lifesteal does not accept a conditional formula');
    if (target && formula) {
      const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget);
      node = lowerFormula(formula, amount => ({
        op: amountOperation.op,
        target,
        ...(targetSelector ? { targetSelector } : {}),
        amount,
        ...(operation === 'damage' && DAMAGE_KINDS.has(String(damageKind))
          ? { damageKind: damageKind as Exclude<import('./battleEventJournal').DamageKind, 'execute'> }
          : {}),
        ...(operation === 'damage' && typeof value.bypass_block === 'boolean'
          ? { bypassBlock: value.bypass_block }
          : {}),
        ...(operation === 'damage' && lifesteal?.kind === 'number'
          ? { lifesteal: lifesteal.value }
          : {}),
      } as EffectNode));
    }
  } else if (operation === 'resource' || operation === 'set_resource') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'when'], path, issues);
    const raw = value[operation];
    if (!isRecord(raw)) {
      addIssue(issues, `${path}.${operation}`, 'INVALID_RESOURCE_EFFECT', `${operation} must be an object`);
    } else {
      const amountField = operation === 'resource' ? 'amount' : 'value';
      rejectUnknownEntryKeys(raw, ['id', amountField], `${path}.${operation}`, issues, false);
      const id = raw.id;
      if (typeof id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || id === 'energy')
        addIssue(issues, `${path}.${operation}.id`, 'INVALID_RESOURCE_ID', 'resource id must be stable English and cannot be energy');
      const amount = compileFormula(raw[amountField], `${path}.${operation}.${amountField}`, issues);
      const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
      const targetSelector = target
        ? compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget)
        : undefined;
      if (target && typeof id === 'string' && amount?.kind === 'number') {
        node = operation === 'resource'
          ? { op: 'gain_resource', target, ...(targetSelector ? { targetSelector } : {}), resource: id, amount: amount.value }
          : { op: 'set_resource', target, ...(targetSelector ? { targetSelector } : {}), resource: id, value: amount.value };
      } else if (amount?.kind === 'choice') {
        addIssue(issues, `${path}.${operation}.${amountField}`, 'INVALID_RESOURCE_EFFECT', 'resource effects do not accept conditional formula values');
      }
    }
  } else if (operation === 'spawn_enemy') {
    rejectUnknownEntryKeys(value, [operation, 'when'], path, issues);
    const raw = value.spawn_enemy;
    if (!isRecord(raw)) {
      addIssue(issues, `${path}.spawn_enemy`, 'INVALID_ENEMY_DEFINITION', 'spawn_enemy must be an object');
    } else {
      rejectUnknownEntryKeys(raw, [
        'id', 'name', 'emoji', 'description', 'max_hp', 'hp', 'max_lust', 'lust', 'block',
        'actions', 'abilities', 'status_effects', 'lust_effect', 'action_mode', 'action_config',
        'action_priority', 'speed', 'tags', 'resources', 'stance', 'orb_slots', 'orbs',
        'count', 'capacity',
      ], `${path}.spawn_enemy`, issues, false);
      const stableId = (entry: unknown): entry is string =>
        typeof entry === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry);
      if (!stableId(raw.id)) addIssue(issues, `${path}.spawn_enemy.id`, 'INVALID_ENEMY_ID', 'enemy id must be stable English');
      if (typeof raw.name !== 'string' || !raw.name.trim())
        addIssue(issues, `${path}.spawn_enemy.name`, 'INVALID_ENEMY_NAME', 'enemy name is required');
      if (typeof raw.emoji !== 'string' || !raw.emoji.trim())
        addIssue(issues, `${path}.spawn_enemy.emoji`, 'INVALID_ENEMY_EMOJI', 'enemy emoji is required');
      if (raw.description !== undefined && typeof raw.description !== 'string')
        addIssue(issues, `${path}.spawn_enemy.description`, 'INVALID_ENEMY_DESCRIPTION', 'enemy description must be text');
      if (!validateAuthoredNumber(raw.max_hp, `${path}.spawn_enemy.max_hp`, issues) || Number(raw.max_hp) <= 0)
        addIssue(issues, `${path}.spawn_enemy.max_hp`, 'INVALID_ENEMY_HP', 'enemy max_hp must be positive');
      for (const field of ['hp', 'max_lust', 'lust', 'block'] as const) {
        if (raw[field] !== undefined && (
          !validateAuthoredNumber(raw[field], `${path}.spawn_enemy.${field}`, issues) || Number(raw[field]) < 0
        )) addIssue(issues, `${path}.spawn_enemy.${field}`, 'INVALID_ENEMY_STAT', `${field} must be non-negative`);
      }
      for (const field of ['action_priority', 'speed'] as const) {
        if (raw[field] !== undefined && (!Number.isInteger(raw[field]) || Math.abs(Number(raw[field])) > 999))
          addIssue(issues, `${path}.spawn_enemy.${field}`, 'INVALID_ENEMY_ORDER', `${field} is out of range`);
      }
      if (raw.tags !== undefined && (
        !Array.isArray(raw.tags) || raw.tags.length > 32 || raw.tags.some(tag => !stableId(tag)) ||
        new Set(raw.tags).size !== raw.tags.length
      )) addIssue(issues, `${path}.spawn_enemy.tags`, 'INVALID_ENEMY_TAGS', 'enemy tags must be unique stable English ids');
      const importNestedIssues = (result: CompactEffectCompilationResult, nestedPath: string): boolean => {
        if (result.ok) return true;
        result.issues.forEach(issue => addIssue(
          issues,
          `${nestedPath}${issue.path === '$' ? '' : issue.path.slice(1)}`,
          issue.code,
          issue.message,
        ));
        return false;
      };
      let nestedValid = true;
      if (!Array.isArray(raw.actions) || raw.actions.length < 1 || raw.actions.length > 24) {
        addIssue(issues, `${path}.spawn_enemy.actions`, 'INVALID_ENEMY_ACTIONS', 'enemy actions must contain 1 to 24 entries');
        nestedValid = false;
      } else {
        raw.actions.forEach((entry, index) => {
          const actionPath = `${path}.spawn_enemy.actions[${index}]`;
          if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) {
            addIssue(issues, actionPath, 'INVALID_ENEMY_ACTION', 'enemy action requires a name');
            nestedValid = false;
            return;
          }
          if (entry.trigger !== undefined) {
            addIssue(issues, `${actionPath}.trigger`, 'INVALID_ENEMY_ACTION', 'enemy actions cannot register triggers');
            nestedValid = false;
          }
          if (entry.weight !== undefined && (
            typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight <= 0
          )) {
            addIssue(issues, `${actionPath}.weight`, 'INVALID_ENEMY_ACTION', 'enemy action weight must be positive');
            nestedValid = false;
          }
          nestedValid = importNestedIssues(compileCompactEffectListInternal(entry.effects, {
            creates: entry.creates,
            when: entry.when,
            statusNames,
            enemyCollectionTarget: 'self',
          }), `${actionPath}.effects`) && nestedValid;
        });
      }
      if (raw.abilities !== undefined && (!Array.isArray(raw.abilities) || raw.abilities.length > 24)) {
        addIssue(issues, `${path}.spawn_enemy.abilities`, 'INVALID_ENEMY_ABILITIES', 'enemy abilities must be an array with at most 24 entries');
        nestedValid = false;
      } else if (Array.isArray(raw.abilities)) {
        raw.abilities.forEach((entry, index) => {
          const abilityPath = `${path}.spawn_enemy.abilities[${index}]`;
          if (!isRecord(entry) || !stableId(entry.id)) {
            addIssue(issues, `${abilityPath}.id`, 'INVALID_ENEMY_ABILITY', 'enemy ability requires a stable English id');
            nestedValid = false;
            return;
          }
          const resolved = resolveTriggerInput(entry);
          if (typeof resolved.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(resolved.trigger)) {
            addIssue(issues, `${abilityPath}.trigger`, 'INVALID_TRIGGER', 'enemy ability trigger is invalid');
            nestedValid = false;
            return;
          }
          if (resolved.structured && resolved.immediateEffects !== undefined) {
            addIssue(issues, `${abilityPath}.effects`, 'INVALID_ENEMY_ABILITY', 'triggered enemy abilities cannot also contain immediate effects');
            nestedValid = false;
          }
          nestedValid = importNestedIssues(compileCompactEffectListInternal(resolved.triggeredEffects, {
            creates: entry.creates,
            statusNames,
            enemyCollectionTarget: 'self',
          }), `${abilityPath}.effects`) && nestedValid;
        });
      }
      if (!isRecord(raw.lust_effect)) {
        addIssue(issues, `${path}.spawn_enemy.lust_effect`, 'INVALID_ENEMY_LUST_EFFECT', 'enemy lust_effect must be an object');
        nestedValid = false;
      } else {
        if (typeof raw.lust_effect.name !== 'string' || !raw.lust_effect.name.trim()) {
          addIssue(issues, `${path}.spawn_enemy.lust_effect.name`, 'INVALID_ENEMY_LUST_EFFECT', 'enemy lust effect requires a name');
          nestedValid = false;
        }
        nestedValid = importNestedIssues(compileCompactEffectListInternal(raw.lust_effect.effects, {
          creates: raw.lust_effect.creates,
          when: raw.lust_effect.when,
          statusNames,
          enemyCollectionTarget: 'self',
        }), `${path}.spawn_enemy.lust_effect.effects`) && nestedValid;
      }
      if (raw.status_effects !== undefined && !Array.isArray(raw.status_effects)) {
        addIssue(issues, `${path}.spawn_enemy.status_effects`, 'INVALID_ENEMY_STATUSES', 'enemy status_effects must be an array');
        nestedValid = false;
      }
      const count = compileFormula(raw.count ?? 1, `${path}.spawn_enemy.count`, issues);
      const capacity = raw.capacity ?? 8;
      if (!Number.isInteger(capacity) || Number(capacity) < 1 || Number(capacity) > 12)
        addIssue(issues, `${path}.spawn_enemy.capacity`, 'INVALID_ENEMY_CAPACITY', 'enemy capacity must be 1 to 12');
      if (
        nestedValid && stableId(raw.id) && typeof raw.name === 'string' && raw.name.trim() &&
        typeof raw.emoji === 'string' && raw.emoji.trim() && typeof raw.max_hp === 'number' &&
        raw.max_hp > 0 && count && Number.isInteger(capacity)
      ) {
        const enemy = structuredClone(Object.fromEntries(
          Object.entries(raw).filter(([key]) => key !== 'count' && key !== 'capacity'),
        )) as unknown as EffectEnemySpawnDefinition;
        node = lowerFormula(count, amount => ({
          op: 'spawn_enemy', enemy, count: amount, capacity: Number(capacity),
        }));
      }
    }
  } else if (operation === 'summoner_effects') {
    rejectUnknownEntryKeys(value, [operation, 'when'], path, issues);
    const effects = compileNestedEffects(value.summoner_effects, `${path}.summoner_effects`);
    if (effects && effects.length > 0) node = { op: 'summoner_effects', effects };
    else if (effects && effects.length === 0)
      addIssue(issues, `${path}.summoner_effects`, 'EMPTY_SUMMONER_EFFECTS', 'summoner_effects requires at least one nested effect');
  } else if (operation === 'spawn_summon') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const raw = value.spawn_summon;
    if (!isRecord(raw)) {
      addIssue(issues, `${path}.spawn_summon`, 'INVALID_SUMMON_DEFINITION', 'spawn_summon must be an object');
    } else {
      rejectUnknownEntryKeys(raw, [
        'id', 'name', 'emoji', 'description', 'has_hp', 'max_hp', 'block', 'tags', 'resources', 'modifiers',
        'action', 'actions', 'abilities', 'actions_per_activation', 'action_priority', 'speed', 'intercept', 'slot',
        'on_existing', 'on_defeated', 'retain_corpse', 'capabilities', 'count', 'capacity', 'overflow',
      ], `${path}.spawn_summon`, issues, false);
      const stableId = (entry: unknown): entry is string =>
        typeof entry === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry);
      if (!stableId(raw.id)) addIssue(issues, `${path}.spawn_summon.id`, 'INVALID_SUMMON_ID', 'summon id must be stable English');
      if (typeof raw.name !== 'string' || !raw.name.trim())
        addIssue(issues, `${path}.spawn_summon.name`, 'INVALID_SUMMON_NAME', 'summon name is required');
      if (typeof raw.emoji !== 'string' || !raw.emoji.trim())
        addIssue(issues, `${path}.spawn_summon.emoji`, 'INVALID_SUMMON_EMOJI', 'summon emoji is required');
      if (raw.description !== undefined && typeof raw.description !== 'string')
        addIssue(issues, `${path}.spawn_summon.description`, 'INVALID_SUMMON_DESCRIPTION', 'summon description must be text');
      if (raw.has_hp !== undefined && typeof raw.has_hp !== 'boolean')
        addIssue(issues, `${path}.spawn_summon.has_hp`, 'INVALID_SUMMON_HP_MODE', 'summon has_hp must be boolean');
      const hasHp = raw.has_hp !== false;
      if (hasHp && (!validateAuthoredNumber(raw.max_hp, `${path}.spawn_summon.max_hp`, issues) || Number(raw.max_hp) <= 0))
        addIssue(issues, `${path}.spawn_summon.max_hp`, 'INVALID_SUMMON_HP', 'HP summons require positive max_hp');
      if (!hasHp && raw.max_hp !== undefined && raw.max_hp !== 0)
        addIssue(issues, `${path}.spawn_summon.max_hp`, 'INVALID_SUMMON_HP', 'HP-less summons omit max_hp or use zero');
      if (raw.block !== undefined && (!validateAuthoredNumber(raw.block, `${path}.spawn_summon.block`, issues) || Number(raw.block) < 0))
        addIssue(issues, `${path}.spawn_summon.block`, 'INVALID_SUMMON_BLOCK', 'summon block must be non-negative');
      for (const [field, minimum, maximum] of [
        ['actions_per_activation', 0, 20], ['action_priority', -999, 999], ['speed', -999, 999],
      ] as const) {
        if (raw[field] !== undefined && (!Number.isInteger(raw[field]) || Number(raw[field]) < minimum || Number(raw[field]) > maximum))
          addIssue(issues, `${path}.spawn_summon.${field}`, 'INVALID_SUMMON_ORDER', `${field} is out of range`);
      }
      if (raw.tags !== undefined && (
        !Array.isArray(raw.tags) || raw.tags.length > 32 || raw.tags.some(tag => !stableId(tag)) ||
        new Set(raw.tags).size !== raw.tags.length
      )) addIssue(issues, `${path}.spawn_summon.tags`, 'INVALID_SUMMON_TAGS', 'summon tags must be unique stable English ids');
      if (raw.slot !== undefined && !stableId(raw.slot))
        addIssue(issues, `${path}.spawn_summon.slot`, 'INVALID_SUMMON_SLOT', 'summon slot must be stable English');
      if (raw.on_existing !== undefined && !['reinforce', 'replace'].includes(String(raw.on_existing)))
        addIssue(issues, `${path}.spawn_summon.on_existing`, 'INVALID_SUMMON_POLICY', 'on_existing must be reinforce or replace');
      if (raw.on_defeated !== undefined && !['new_instance', 'revive_reset', 'revive_reinforce'].includes(String(raw.on_defeated)))
        addIssue(issues, `${path}.spawn_summon.on_defeated`, 'INVALID_SUMMON_POLICY', 'unsupported on_defeated policy');
      if ((raw.on_existing !== undefined || raw.on_defeated !== undefined) && raw.slot === undefined)
        addIssue(issues, `${path}.spawn_summon`, 'MISSING_SUMMON_SLOT', 'unique summon policies require slot');
      if (raw.retain_corpse !== undefined && typeof raw.retain_corpse !== 'boolean')
        addIssue(issues, `${path}.spawn_summon.retain_corpse`, 'INVALID_SUMMON_POLICY', 'retain_corpse must be boolean');
      if (raw.resources !== undefined && !isRecord(raw.resources))
        addIssue(issues, `${path}.spawn_summon.resources`, 'INVALID_SUMMON_RESOURCES', 'summon resources must be an object');
      else if (isRecord(raw.resources)) {
        for (const [resourceId, resource] of Object.entries(raw.resources)) {
          const resourcePath = `${path}.spawn_summon.resources.${resourceId}`;
          if (!stableId(resourceId) || !isRecord(resource)) {
            addIssue(issues, resourcePath, 'INVALID_SUMMON_RESOURCE', 'summon resource definition is invalid');
            continue;
          }
          rejectUnknownEntryKeys(resource, ['id', 'name', 'emoji', 'current', 'max', 'refresh'], resourcePath, issues, false);
          if (
            resource.id !== resourceId || typeof resource.name !== 'string' || !resource.name.trim() ||
            typeof resource.emoji !== 'string' || !resource.emoji.trim() ||
            !Number.isInteger(resource.current) || Number(resource.current) < 0 ||
            !Number.isInteger(resource.max) || Number(resource.max) < 1 || Number(resource.current) > Number(resource.max) ||
            !['reset', 'retain'].includes(String(resource.refresh))
          ) addIssue(issues, resourcePath, 'INVALID_SUMMON_RESOURCE', 'summon resource requires matching id, display fields, valid range, and refresh policy');
        }
      }
      if (raw.modifiers !== undefined && (
        !isRecord(raw.modifiers) || Object.values(raw.modifiers).some(entry => typeof entry !== 'number' || !Number.isFinite(entry))
      )) addIssue(issues, `${path}.spawn_summon.modifiers`, 'INVALID_SUMMON_MODIFIER', 'summon modifiers must be finite numbers');
      if (raw.intercept !== undefined && !isRecord(raw.intercept))
        addIssue(issues, `${path}.spawn_summon.intercept`, 'INVALID_SUMMON_INTERCEPT', 'summon intercept must be an object');
      else if (isRecord(raw.intercept)) {
        rejectUnknownEntryKeys(raw.intercept, ['mode', 'priority', 'max_per_turn'], `${path}.spawn_summon.intercept`, issues, false);
        if (raw.intercept.mode !== 'unblocked_attack')
          addIssue(issues, `${path}.spawn_summon.intercept.mode`, 'INVALID_SUMMON_INTERCEPT', 'intercept mode must be unblocked_attack');
        if (raw.intercept.priority !== undefined && !Number.isInteger(raw.intercept.priority))
          addIssue(issues, `${path}.spawn_summon.intercept.priority`, 'INVALID_SUMMON_INTERCEPT', 'intercept priority must be an integer');
        if (raw.intercept.max_per_turn !== undefined && (!Number.isInteger(raw.intercept.max_per_turn) || Number(raw.intercept.max_per_turn) < 1))
          addIssue(issues, `${path}.spawn_summon.intercept.max_per_turn`, 'INVALID_SUMMON_INTERCEPT', 'max_per_turn must be a positive integer');
      }
      if (raw.capabilities !== undefined && !isRecord(raw.capabilities))
        addIssue(issues, `${path}.spawn_summon.capabilities`, 'INVALID_SUMMON_CAPABILITY', 'summon capabilities must be an object');
      else if (isRecord(raw.capabilities)) {
        rejectUnknownEntryKeys(raw.capabilities, ['selectable', 'accepts_status', 'acts', 'intercepts'], `${path}.spawn_summon.capabilities`, issues, false);
        for (const [key, entry] of Object.entries(raw.capabilities)) {
          if (typeof entry !== 'boolean')
            addIssue(issues, `${path}.spawn_summon.capabilities.${key}`, 'INVALID_SUMMON_CAPABILITY', 'summon capabilities must be boolean');
        }
      }
      const compiledActions: import('./summonUnit').SummonActionDefinition[] = [];
      if (raw.actions !== undefined && (!Array.isArray(raw.actions) || raw.actions.length > 20)) {
        addIssue(issues, `${path}.spawn_summon.actions`, 'INVALID_SUMMON_ACTIONS', 'summon actions must be an array with at most 20 entries');
      } else if (Array.isArray(raw.actions)) {
        raw.actions.forEach((entry, index) => {
          const actionPath = `${path}.spawn_summon.actions[${index}]`;
          if (!isRecord(entry)) {
            addIssue(issues, actionPath, 'INVALID_SUMMON_ACTION', 'summon action must be an object');
            return;
          }
          rejectUnknownEntryKeys(entry, ['id', 'name', 'emoji', 'description', 'weight', 'fixed', 'effects', 'creates', 'when'], actionPath, issues, false);
          if (!stableId(entry.id)) addIssue(issues, `${actionPath}.id`, 'INVALID_SUMMON_ACTION', 'summon action requires a stable English id');
          if (typeof entry.name !== 'string' || !entry.name.trim())
            addIssue(issues, `${actionPath}.name`, 'INVALID_SUMMON_ACTION', 'summon action requires a name');
          if (entry.emoji !== undefined && (typeof entry.emoji !== 'string' || !entry.emoji.trim()))
            addIssue(issues, `${actionPath}.emoji`, 'INVALID_SUMMON_ACTION', 'summon action emoji must be text');
          if (entry.description !== undefined && typeof entry.description !== 'string')
            addIssue(issues, `${actionPath}.description`, 'INVALID_SUMMON_ACTION', 'summon action description must be text');
          if (entry.weight !== undefined && (typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight <= 0))
            addIssue(issues, `${actionPath}.weight`, 'INVALID_SUMMON_ACTION', 'summon action weight must be positive');
          if (entry.fixed !== undefined && typeof entry.fixed !== 'boolean')
            addIssue(issues, `${actionPath}.fixed`, 'INVALID_SUMMON_ACTION', 'summon action fixed must be boolean');
          const effects = compileNestedEffects(entry.effects, `${actionPath}.effects`);
          if (stableId(entry.id) && typeof entry.name === 'string' && entry.name.trim() && effects?.length) {
            compiledActions.push({
              id: entry.id,
              name: entry.name.trim(),
              ...(typeof entry.emoji === 'string' ? { emoji: entry.emoji.trim() } : {}),
              ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
              ...(typeof entry.weight === 'number' ? { weight: entry.weight } : {}),
              ...(entry.fixed === true ? { fixed: true } : {}),
              effectProgram: { spec: EFFECT_PROGRAM_SPEC, steps: effects },
            });
          }
        });
      }
      const compiledAbilities: import('./summonUnit').SummonAbilityDefinition[] = [];
      if (raw.abilities !== undefined && (!Array.isArray(raw.abilities) || raw.abilities.length > 20)) {
        addIssue(issues, `${path}.spawn_summon.abilities`, 'INVALID_SUMMON_ABILITIES', 'summon abilities must be an array with at most 20 entries');
      } else if (Array.isArray(raw.abilities)) {
        raw.abilities.forEach((entry, index) => {
          const abilityPath = `${path}.spawn_summon.abilities[${index}]`;
          if (!isRecord(entry)) {
            addIssue(issues, abilityPath, 'INVALID_SUMMON_ABILITY', 'summon ability must be an object');
            return;
          }
          rejectUnknownEntryKeys(entry, ['id', 'name', 'emoji', 'description', 'trigger', 'fixed', 'effects', 'creates'], abilityPath, issues, false);
          const resolved = resolveTriggerInput(entry);
          if (!stableId(entry.id)) addIssue(issues, `${abilityPath}.id`, 'INVALID_SUMMON_ABILITY', 'summon ability requires a stable English id');
          if (typeof resolved.trigger !== 'string' || !ABILITY_TRIGGER_SET.has(resolved.trigger))
            addIssue(issues, `${abilityPath}.trigger`, 'INVALID_TRIGGER', 'summon ability trigger is invalid');
          if (resolved.structured && resolved.immediateEffects !== undefined)
            addIssue(issues, `${abilityPath}.effects`, 'INVALID_SUMMON_ABILITY', 'triggered summon abilities cannot also contain immediate effects');
          if (entry.fixed !== undefined && typeof entry.fixed !== 'boolean')
            addIssue(issues, `${abilityPath}.fixed`, 'INVALID_SUMMON_ABILITY', 'summon ability fixed must be boolean');
          const effects = compileNestedEffects(resolved.triggeredEffects, `${abilityPath}.effects`);
          if (stableId(entry.id) && typeof resolved.trigger === 'string' && ABILITY_TRIGGER_SET.has(resolved.trigger) && effects?.length) {
            compiledAbilities.push({
              id: entry.id,
              ...(typeof entry.name === 'string' && entry.name.trim() ? { name: entry.name.trim() } : {}),
              ...(typeof entry.emoji === 'string' && entry.emoji.trim() ? { emoji: entry.emoji.trim() } : {}),
              ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
              trigger: resolved.trigger,
              ...(resolved.eventQuery ? { eventQuery: resolved.eventQuery } : {}),
              ...(entry.fixed === true ? { fixed: true } : {}),
              effectProgram: { spec: EFFECT_PROGRAM_SPEC, steps: effects },
            });
          }
        });
      }
      const count = compileFormula(raw.count ?? 1, `${path}.spawn_summon.count`, issues);
      const capacity = raw.capacity ?? 3;
      if (!Number.isSafeInteger(capacity) || Number(capacity) < 1)
        addIssue(issues, `${path}.spawn_summon.capacity`, 'INVALID_SUMMON_CAPACITY', 'summon capacity must be a positive safe integer');
      const overflow = raw.overflow ?? 'replace_oldest';
      if (!['reject', 'replace_oldest', 'replace_lowest_hp'].includes(String(overflow)))
        addIssue(issues, `${path}.spawn_summon.overflow`, 'INVALID_SUMMON_OVERFLOW', 'unsupported summon overflow policy');
      const actionEffects = compileNestedEffects(raw.action, `${path}.spawn_summon.action`);
      if (
        target && stableId(raw.id) && typeof raw.name === 'string' && raw.name.trim() &&
        typeof raw.emoji === 'string' && raw.emoji.trim() && (!hasHp || (typeof raw.max_hp === 'number' && raw.max_hp > 0)) &&
        count && actionEffects && Number.isInteger(capacity) &&
        ['reject', 'replace_oldest', 'replace_lowest_hp'].includes(String(overflow))
      ) {
        const capabilities = isRecord(raw.capabilities) ? {
          ...(typeof raw.capabilities.selectable === 'boolean' ? { selectable: raw.capabilities.selectable } : {}),
          ...(typeof raw.capabilities.accepts_status === 'boolean' ? { acceptsStatus: raw.capabilities.accepts_status } : {}),
          ...(typeof raw.capabilities.acts === 'boolean' ? { acts: raw.capabilities.acts } : {}),
          ...(typeof raw.capabilities.intercepts === 'boolean' ? { intercepts: raw.capabilities.intercepts } : {}),
        } : undefined;
        const intercept = isRecord(raw.intercept) ? {
          mode: raw.intercept.mode,
          ...(Number.isInteger(raw.intercept.priority) ? { priority: Number(raw.intercept.priority) } : {}),
          ...(Number.isInteger(raw.intercept.max_per_turn) ? { maxPerTurn: Number(raw.intercept.max_per_turn) } : {}),
        } : undefined;
        const summon = {
          id: raw.id,
          name: raw.name.trim(),
          emoji: raw.emoji.trim(),
          hasHp,
          ...(hasHp ? { maxHp: raw.max_hp as number } : {}),
          ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
          ...(typeof raw.block === 'number' ? { block: raw.block } : {}),
          ...(Array.isArray(raw.tags) ? { tags: raw.tags as string[] } : {}),
          ...(isRecord(raw.resources) ? { resources: structuredClone(raw.resources) as any } : {}),
          ...(isRecord(raw.modifiers) ? { modifiers: structuredClone(raw.modifiers) as Record<string, number> } : {}),
          ...(actionEffects.length ? { actionProgram: { spec: EFFECT_PROGRAM_SPEC, steps: actionEffects } as EffectProgram } : {}),
          ...(compiledActions.length ? { actions: compiledActions } : {}),
          ...(compiledAbilities.length ? { abilities: compiledAbilities } : {}),
          ...(Number.isInteger(raw.actions_per_activation) ? { actionsPerActivation: Number(raw.actions_per_activation) } : {}),
          ...(Number.isInteger(raw.action_priority) ? { actionPriority: Number(raw.action_priority) } : {}),
          ...(Number.isInteger(raw.speed) ? { speed: Number(raw.speed) } : {}),
          ...(intercept ? { intercept: intercept as any } : {}),
          ...(typeof raw.slot === 'string' ? { slot: raw.slot } : {}),
          ...(typeof raw.on_existing === 'string' ? { onExisting: raw.on_existing as 'reinforce' | 'replace' } : {}),
          ...(typeof raw.on_defeated === 'string' ? { onDefeated: raw.on_defeated as 'new_instance' | 'revive_reset' | 'revive_reinforce' } : {}),
          ...(typeof raw.retain_corpse === 'boolean' ? { retainCorpse: raw.retain_corpse } : {}),
          ...(capabilities ? { capabilities } : {}),
        };
        node = lowerFormula(count, amount => ({
          op: 'spawn_summon', target, summon, count: amount,
          capacity: Number(capacity), overflow: overflow as 'reject' | 'replace_oldest' | 'replace_lowest_hp',
        }));
      }
    }
  } else if (
    operation === 'damage_summon' || operation === 'heal_summon' || operation === 'modify_summon' || operation === 'modify_summon_effect' ||
    operation === 'summon_resource' || operation === 'set_summon_resource' ||
    operation === 'apply_summon_status' || operation === 'remove_summon_status' ||
    operation === 'activate_summon' || operation === 'dismiss_summon' || operation === 'copy_summon'
  ) {
    rejectUnknownEntryKeys(value, [operation, 'when'], path, issues);
    const raw = value[operation];
    if (!isRecord(raw)) {
      addIssue(issues, `${path}.${operation}`, 'INVALID_SUMMON_EFFECT', `${operation} must be an object`);
    } else {
      const selector = compileCompactSummonSelector(raw.selector, `${path}.${operation}.selector`, issues);
      if (operation === 'damage_summon' || operation === 'heal_summon') {
        rejectUnknownEntryKeys(raw, ['selector', 'amount'], `${path}.${operation}`, issues, false);
        const amount = compileFormula(raw.amount, `${path}.${operation}.amount`, issues);
        if (selector && amount) node = lowerFormula(amount, resolved => ({
          op: operation === 'damage_summon' ? 'damage_summons' : 'heal_summons',
          selector,
          amount: resolved,
        }));
      } else if (operation === 'modify_summon' || operation === 'modify_summon_effect') {
        rejectUnknownEntryKeys(raw, ['selector', 'stat', 'add', 'subtract', 'multiply', 'divide', 'set'], `${path}.${operation}`, issues, false);
        const stats = operation === 'modify_summon'
          ? ['max_hp', 'block', 'actions_per_activation', 'speed', 'action_priority']
          : ['damage', 'block', 'lust', 'stacks'];
        if (!stats.includes(String(raw.stat)))
          addIssue(issues, `${path}.${operation}.stat`, 'INVALID_SUMMON_STAT', 'unsupported summon stat');
        const allowedOperators = operation === 'modify_summon'
          ? ['add', 'subtract', 'multiply', 'divide', 'set']
          : ['add', 'subtract', 'multiply', 'divide'];
        const authored = allowedOperators.filter(key => raw[key] !== undefined);
        if (authored.length !== 1)
          addIssue(issues, `${path}.${operation}`, 'INVALID_SUMMON_OPERATOR', `${operation} requires exactly one operator`);
        const formula = authored.length === 1 ? compileFormula(raw[authored[0]], `${path}.${operation}.${authored[0]}`, issues) : null;
        if (authored[0] === 'divide' && formula?.kind === 'number' && formula.value === 0)
          addIssue(issues, `${path}.${operation}.divide`, 'DIVISION_BY_ZERO', 'summon value cannot divide by zero');
        if (selector && formula && stats.includes(String(raw.stat))) node = lowerFormula(formula, resolved => operation === 'modify_summon'
          ? {
              op: 'modify_summons', selector,
              stat: raw.stat as import('./effectDsl').SummonValueStat,
              operator: authored[0] as import('./effectDsl').SummonValueOperator,
              value: resolved,
            }
          : {
              op: 'modify_summon_effects', selector,
              stat: raw.stat as CardValueStat,
              operator: authored[0] as CardValueOperator,
              value: resolved,
            });
      } else if (operation === 'summon_resource' || operation === 'set_summon_resource') {
        const amountField = operation === 'summon_resource' ? 'amount' : 'value';
        rejectUnknownEntryKeys(raw, ['selector', 'id', amountField], `${path}.${operation}`, issues, false);
        if (typeof raw.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.id))
          addIssue(issues, `${path}.${operation}.id`, 'INVALID_SUMMON_RESOURCE', 'summon resource id must be stable English');
        const amount = compileFormula(raw[amountField], `${path}.${operation}.${amountField}`, issues);
        if (selector && typeof raw.id === 'string' && amount) node = lowerFormula(amount, resolved => operation === 'summon_resource'
          ? { op: 'gain_summon_resource', selector, resource: raw.id as string, amount: resolved }
          : { op: 'set_summon_resource', selector, resource: raw.id as string, value: resolved });
      } else if (operation === 'apply_summon_status') {
        rejectUnknownEntryKeys(raw, ['selector', 'id', 'stacks'], `${path}.${operation}`, issues, false);
        if (typeof raw.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.id))
          addIssue(issues, `${path}.${operation}.id`, 'INVALID_STATUS_ID', 'summon status id must be registered');
        const stacks = compileFormula(raw.stacks ?? 1, `${path}.${operation}.stacks`, issues);
        if (selector && typeof raw.id === 'string' && stacks) node = lowerFormula(stacks, resolved => ({
          op: 'apply_summon_status', selector, status: raw.id as string, stacks: resolved,
        }));
      } else if (operation === 'remove_summon_status') {
        rejectUnknownEntryKeys(raw, ['selector', 'id'], `${path}.${operation}`, issues, false);
        if (typeof raw.id !== 'string' || (raw.id !== 'all' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.id)))
          addIssue(issues, `${path}.${operation}.id`, 'INVALID_STATUS_ID', 'summon status id must be registered or all');
        if (selector && typeof raw.id === 'string') node = { op: 'remove_summon_status', selector, status: raw.id };
      } else if (operation === 'activate_summon') {
        rejectUnknownEntryKeys(raw, ['selector'], `${path}.${operation}`, issues, false);
        if (selector) node = { op: 'activate_summons', selector };
      } else if (operation === 'dismiss_summon') {
        rejectUnknownEntryKeys(raw, ['selector', 'retain_corpse'], `${path}.${operation}`, issues, false);
        if (raw.retain_corpse !== undefined && typeof raw.retain_corpse !== 'boolean')
          addIssue(issues, `${path}.${operation}.retain_corpse`, 'INVALID_SUMMON_POLICY', 'retain_corpse must be boolean');
        if (selector) node = { op: 'dismiss_summons', selector, retainCorpse: raw.retain_corpse === true };
      } else {
        rejectUnknownEntryKeys(raw, ['selector', 'to', 'capacity', 'overflow'], `${path}.${operation}`, issues, false);
        const targetOwner = raw.to ?? 'same';
        const capacity = raw.capacity ?? 3;
        const overflow = raw.overflow ?? 'replace_oldest';
        if (!['same', 'self', 'opponent'].includes(String(targetOwner)))
          addIssue(issues, `${path}.${operation}.to`, 'INVALID_SUMMON_OWNER', 'copy_summon.to must be same, self, or opponent');
        if (!Number.isSafeInteger(capacity) || Number(capacity) < 1)
          addIssue(issues, `${path}.${operation}.capacity`, 'INVALID_SUMMON_CAPACITY', 'capacity must be a positive safe integer');
        if (!['reject', 'replace_oldest', 'replace_lowest_hp'].includes(String(overflow)))
          addIssue(issues, `${path}.${operation}.overflow`, 'INVALID_SUMMON_OVERFLOW', 'unsupported summon overflow policy');
        if (selector && ['same', 'self', 'opponent'].includes(String(targetOwner)) &&
          Number.isSafeInteger(capacity) && Number(capacity) >= 1 &&
          ['reject', 'replace_oldest', 'replace_lowest_hp'].includes(String(overflow))) {
          node = {
            op: 'copy_summons', selector,
            targetOwner: targetOwner as 'same' | 'self' | 'opponent',
            capacity: Number(capacity),
            overflow: overflow as 'reject' | 'replace_oldest' | 'replace_lowest_hp',
          };
        }
      }
    }
  } else if (operation === 'execute' || operation === 'kill') {
    rejectUnknownEntryKeys(
      value,
      [operation, ...(operation === 'execute' ? ['threshold_mode'] : []), 'exclude_tags', 'trigger_fatal', 'to', 'targets', 'when'],
      path,
      issues,
    );
    const target = compileTarget(value.to, implicitTarget ?? 'opponent', `${path}.to`, issues);
    const targetSelector = target
      ? compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget)
      : undefined;
    const excludeTags = value.exclude_tags;
    if (
      excludeTags !== undefined &&
      (!Array.isArray(excludeTags) || excludeTags.length < 1 || excludeTags.length > 32 ||
        excludeTags.some(tag => typeof tag !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tag)) ||
        new Set(excludeTags).size !== excludeTags.length)
    ) {
      addIssue(issues, `${path}.exclude_tags`, 'INVALID_ENTITY_TAGS', 'exclude_tags must contain 1 to 32 unique stable English IDs');
    }
    if (value.trigger_fatal !== undefined && typeof value.trigger_fatal !== 'boolean')
      addIssue(issues, `${path}.trigger_fatal`, 'INVALID_FATAL_FLAG', 'trigger_fatal must be boolean');
    if (operation === 'kill') {
      if (value.kill !== true) addIssue(issues, `${path}.kill`, 'INVALID_KILL', 'kill must be true');
      else if (target) node = {
        op: 'kill', target, ...(targetSelector ? { targetSelector } : {}),
        ...(Array.isArray(excludeTags) ? { excludeTags: excludeTags as string[] } : {}),
        ...(typeof value.trigger_fatal === 'boolean' ? { triggerFatal: value.trigger_fatal } : {}),
      };
    } else {
      const thresholdMode = value.threshold_mode ?? 'hp';
      if (thresholdMode !== 'hp' && thresholdMode !== 'hp_percent')
        addIssue(issues, `${path}.threshold_mode`, 'INVALID_EXECUTE_THRESHOLD', 'threshold_mode must be hp or hp_percent');
      const threshold = compileFormula(value.execute, `${path}.execute`, issues);
      if (target && threshold?.kind === 'number' && (thresholdMode === 'hp' || thresholdMode === 'hp_percent')) {
        node = {
          op: 'execute', target, ...(targetSelector ? { targetSelector } : {}), threshold: threshold.value, thresholdMode,
          ...(Array.isArray(excludeTags) ? { excludeTags: excludeTags as string[] } : {}),
          ...(typeof value.trigger_fatal === 'boolean' ? { triggerFatal: value.trigger_fatal } : {}),
        };
      } else if (threshold?.kind === 'choice') {
        addIssue(issues, `${path}.execute`, 'INVALID_EXECUTE_THRESHOLD', 'execute does not accept a conditional threshold formula');
      }
    }
  } else if (operation === 'stance') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const targetSelector = target
      ? compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget)
      : undefined;
    const raw = value.stance;
    if (raw === null) {
      if (target) node = { op: 'set_stance', target, ...(targetSelector ? { targetSelector } : {}), stance: null };
    } else if (!isRecord(raw)) {
      addIssue(issues, `${path}.stance`, 'INVALID_STANCE', 'stance must be an object or null');
    } else {
      rejectUnknownEntryKeys(raw, ['id', 'name', 'emoji', 'description', 'enter', 'exit', 'passive'], `${path}.stance`, issues, false);
      const id = raw.id;
      const name = raw.name;
      if (typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id))
        addIssue(issues, `${path}.stance.id`, 'INVALID_STANCE_ID', 'stance id must be stable English');
      if (typeof name !== 'string' || !name.trim())
        addIssue(issues, `${path}.stance.name`, 'INVALID_STANCE_NAME', 'stance name is required');
      if (raw.emoji !== undefined && typeof raw.emoji !== 'string')
        addIssue(issues, `${path}.stance.emoji`, 'INVALID_STANCE_EMOJI', 'stance emoji must be text');
      if (raw.description !== undefined && typeof raw.description !== 'string')
        addIssue(issues, `${path}.stance.description`, 'INVALID_STANCE_DESCRIPTION', 'stance description must be text');
      const enterEffects = compileNestedEffects(raw.enter, `${path}.stance.enter`);
      const exitEffects = compileNestedEffects(raw.exit, `${path}.stance.exit`);
      const passiveEffects = compileNestedEffects(raw.passive, `${path}.stance.passive`);
      if (target && typeof id === 'string' && typeof name === 'string' && name.trim() && enterEffects && exitEffects && passiveEffects) {
        node = {
          op: 'set_stance', target, ...(targetSelector ? { targetSelector } : {}),
          stance: {
            id, name: name.trim(),
            ...(typeof raw.emoji === 'string' ? { emoji: raw.emoji } : {}),
            ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
            ...(enterEffects.length ? { enterEffects } : {}),
            ...(exitEffects.length ? { exitEffects } : {}),
            ...(passiveEffects.length ? { passiveEffects } : {}),
          },
        };
      }
    }
  } else if (operation === 'channel_orb') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const targetSelector = target
      ? compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget)
      : undefined;
    const raw = value.channel_orb;
    if (!isRecord(raw)) {
      addIssue(issues, `${path}.channel_orb`, 'INVALID_ORB', 'channel_orb must be an object');
    } else {
      rejectUnknownEntryKeys(raw, ['id', 'name', 'emoji', 'description', 'value', 'passive', 'evoke'], `${path}.channel_orb`, issues, false);
      const id = raw.id;
      const name = raw.name;
      const orbValue = compileFormula(raw.value, `${path}.channel_orb.value`, issues);
      const passiveEffects = compileNestedEffects(raw.passive, `${path}.channel_orb.passive`);
      const evokeEffects = compileNestedEffects(raw.evoke, `${path}.channel_orb.evoke`);
      if (typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id))
        addIssue(issues, `${path}.channel_orb.id`, 'INVALID_ORB_ID', 'orb id must be stable English');
      if (typeof name !== 'string' || !name.trim())
        addIssue(issues, `${path}.channel_orb.name`, 'INVALID_ORB_NAME', 'orb name is required');
      if (raw.emoji !== undefined && typeof raw.emoji !== 'string')
        addIssue(issues, `${path}.channel_orb.emoji`, 'INVALID_ORB_EMOJI', 'orb emoji must be text');
      if (raw.description !== undefined && typeof raw.description !== 'string')
        addIssue(issues, `${path}.channel_orb.description`, 'INVALID_ORB_DESCRIPTION', 'orb description must be text');
      if (target && typeof id === 'string' && typeof name === 'string' && name.trim() && orbValue?.kind === 'number' && passiveEffects && evokeEffects) {
        node = {
          op: 'channel_orb', target, ...(targetSelector ? { targetSelector } : {}),
          orb: {
            id, name: name.trim(), value: orbValue.value,
            ...(typeof raw.emoji === 'string' ? { emoji: raw.emoji } : {}),
            ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
            ...(passiveEffects.length ? { passiveEffects } : {}),
            ...(evokeEffects.length ? { evokeEffects } : {}),
          },
        };
      }
    }
  } else if (operation === 'evoke_orb') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'pick', 'count', 'orb_id', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const targetSelector = target
      ? compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget)
      : undefined;
    const amount = value.evoke_orb;
    const pick = value.pick ?? (amount === 'all' ? 'all' : 'first');
    if (!['first', 'last', 'all'].includes(String(pick)))
      addIssue(issues, `${path}.pick`, 'INVALID_ORB_PICK', 'orb pick must be first, last, or all');
    const count = value.count ?? (typeof amount === 'number' ? amount : 1);
    if (pick !== 'all' && (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 100))
      addIssue(issues, `${path}.count`, 'INVALID_ORB_COUNT', 'orb count must be an integer from 1 to 100');
    if (amount !== 'all' && (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 100))
      addIssue(issues, `${path}.evoke_orb`, 'INVALID_ORB_COUNT', 'evoke_orb must be all or an integer from 1 to 100');
    if (value.orb_id !== undefined && (typeof value.orb_id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.orb_id)))
      addIssue(issues, `${path}.orb_id`, 'INVALID_ORB_ID', 'orb_id must be stable English');
    if (target && ['first', 'last', 'all'].includes(String(pick))) node = {
      op: 'evoke_orbs', target, ...(targetSelector ? { targetSelector } : {}),
      selector: {
        pick: pick as 'first' | 'last' | 'all',
        ...(pick !== 'all' ? { count: Number(count) } : {}),
        ...(typeof value.orb_id === 'string' ? { id: value.orb_id } : {}),
      },
    };
  } else if (operation === 'orb_slots') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const targetSelector = target
      ? compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget)
      : undefined;
    const amount = compileFormula(value.orb_slots, `${path}.orb_slots`, issues);
    if (target && amount?.kind === 'number')
      node = { op: 'set_orb_slots', target, ...(targetSelector ? { targetSelector } : {}), amount: amount.value };
  } else if (operation === 'modify_orb') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'pick', 'count', 'orb_id', 'add', 'subtract', 'multiply', 'divide', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const targetSelector = target
      ? compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget)
      : undefined;
    if (value.modify_orb !== 'value')
      addIssue(issues, `${path}.modify_orb`, 'INVALID_ORB_STAT', 'modify_orb currently accepts value');
    const operators = ['add', 'subtract', 'multiply', 'divide'] as const;
    const authored = operators.filter(key => value[key] !== undefined);
    if (authored.length !== 1) addIssue(issues, path, 'INVALID_ORB_VALUE_OPERATOR', 'modify_orb requires exactly one operator');
    const formula = authored.length === 1 ? compileFormula(value[authored[0]], `${path}.${authored[0]}`, issues) : null;
    if (authored[0] === 'divide' && formula?.kind === 'number' && formula.value === 0)
      addIssue(issues, `${path}.divide`, 'DIVISION_BY_ZERO', 'Orb value cannot divide by zero');
    const pick = value.pick ?? 'first';
    if (!['first', 'last', 'all'].includes(String(pick)))
      addIssue(issues, `${path}.pick`, 'INVALID_ORB_PICK', 'orb pick must be first, last, or all');
    if (value.count !== undefined && (!Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 100))
      addIssue(issues, `${path}.count`, 'INVALID_ORB_COUNT', 'orb count must be an integer from 1 to 100');
    if (value.orb_id !== undefined && (typeof value.orb_id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.orb_id)))
      addIssue(issues, `${path}.orb_id`, 'INVALID_ORB_ID', 'orb_id must be stable English');
    if (target && value.modify_orb === 'value' && authored.length === 1 && formula?.kind === 'number' && ['first', 'last', 'all'].includes(String(pick))) {
      node = {
        op: 'modify_orbs', target, ...(targetSelector ? { targetSelector } : {}),
        selector: {
          pick: pick as 'first' | 'last' | 'all',
          ...(pick !== 'all' ? { count: Number(value.count ?? 1) } : {}),
          ...(typeof value.orb_id === 'string' ? { id: value.orb_id } : {}),
        },
        operator: authored[0], value: formula.value,
      };
    }
  } else if (operation === 'extra_turn') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const amount = compileFormula(value.extra_turn, `${path}.extra_turn`, issues);
    if (target && amount?.kind === 'number') node = { op: 'grant_extra_turn', target, amount: amount.value };
  } else if (operation === 'end_turn') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    if (value.end_turn !== true) addIssue(issues, `${path}.end_turn`, 'INVALID_END_TURN', 'end_turn must be true');
    if (target && value.end_turn === true) node = { op: 'force_end_turn', target };
  } else if (operation === 'choose') {
    rejectUnknownEntryKeys(value, [operation, 'options', 'when'], path, issues);
    const choiceId = value.choose;
    if (typeof choiceId !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(choiceId))
      addIssue(issues, `${path}.choose`, 'INVALID_CHOICE_ID', 'choose must use a stable English ID');
    const rawOptions = value.options;
    if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 8) {
      addIssue(issues, `${path}.options`, 'INVALID_CHOICE_OPTIONS', 'choose requires 2 to 8 options');
    } else {
      const optionIds = new Set<string>();
      const options: import('./effectDsl').EffectChoiceOption[] = [];
      rawOptions.forEach((rawOption, optionIndex) => {
        const optionPath = `${path}.options[${optionIndex}]`;
        if (!isRecord(rawOption)) {
          addIssue(issues, optionPath, 'INVALID_CHOICE_OPTION', 'choice option must be an object');
          return;
        }
        rejectUnknownEntryKeys(rawOption, ['id', 'label', 'effects'], optionPath, issues, false);
        const id = rawOption.id;
        const label = rawOption.label;
        if (typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
          addIssue(issues, `${optionPath}.id`, 'INVALID_CHOICE_ID', 'choice option requires a stable English ID');
          return;
        }
        if (optionIds.has(id)) {
          addIssue(issues, `${optionPath}.id`, 'DUPLICATE_CHOICE_ID', `duplicate choice option: ${id}`);
          return;
        }
        optionIds.add(id);
        if (typeof label !== 'string' || !label.trim()) {
          addIssue(issues, `${optionPath}.label`, 'INVALID_CHOICE_LABEL', 'choice option requires a label');
          return;
        }
        const entries = normalizeCompactEffectEntries(rawOption.effects);
        if (!entries || entries.length === 0) {
          addIssue(issues, `${optionPath}.effects`, 'EMPTY_CHOICE_EFFECTS', 'choice option requires effects');
          return;
        }
        const compiled = entries.map((entry, effectIndex) =>
          compileEntry(
            entry,
            `${optionPath}.effects[${effectIndex}]`,
            issues,
            templates,
            templateStack,
            statusNames,
            implicitTarget,
            enemyCollectionTarget,
          ));
        if (compiled.some(entry => entry === null)) return;
        options.push({ id, label: label.trim(), effects: (compiled as EffectNode[][]).flat() });
      });
      if (typeof choiceId === 'string' && options.length === rawOptions.length)
        node = { op: 'choose_one', choiceId, options };
    }
  } else if (SET_OPERATIONS[operation]) {
    rejectUnknownEntryKeys(value, [operation, 'to', 'targets', 'when'], path, issues);
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    const formula = compileFormula(value[operation], `${path}.${operation}`, issues);
    const stat = SET_OPERATIONS[operation];
    if (target && formula) {
      const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget);
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
      const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget);
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
      const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget);
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
    const selectAll = value.pick === 'all' || value.from === 'all' || value.from === 'combat';
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
    const count = value.pick === 'all' || value.from === 'all' || value.from === 'combat'
      ? undefined
      : value.count === undefined
        ? 1
        : compileFixedCount(value.count, `${path}.count`, issues);
    const selectorSource = value.pick === 'all' || value.from === 'all' || value.from === 'combat' ? { ...value, pick: 'all' } : value;
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
  } else if (operation === 'attach_card') {
    rejectUnknownEntryKeys(
      value,
      [operation, ...CARD_SELECTOR_INPUT_KEYS, 'count', 'when'],
      path,
      issues,
    );
    const selector = compileCardSelector(value, path, issues, 'choose', value.count === undefined ? 1 : compileFixedCount(value.count, `${path}.count`, issues) ?? undefined);
    const raw = value.attach_card;
    let attachment: EffectCardAttachmentDefinition | null = null;
    if (!isRecord(raw)) {
      addIssue(issues, `${path}.attach_card`, 'INVALID_CARD_ATTACHMENT', 'attach_card must be an object');
    } else {
      rejectUnknownEntryKeys(raw, [
        'id', 'kind', 'name', 'description', 'emoji', 'scope', 'remove_on', 'remaining',
        'discard_reasons', 'priority', 'changes',
      ], `${path}.attach_card`, issues, false);
      const id = raw.id;
      const kind = raw.kind;
      const name = raw.name;
      const scope = raw.scope ?? (kind === 'enchantment' ? 'run' : 'combat');
      const removeOn = raw.remove_on;
      if (typeof id !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id))
        addIssue(issues, `${path}.attach_card.id`, 'INVALID_CARD_ATTACHMENT_ID', 'attachment id must be a stable identifier');
      if (kind !== 'enchantment' && kind !== 'affliction')
        addIssue(issues, `${path}.attach_card.kind`, 'INVALID_CARD_ATTACHMENT_KIND', 'kind must be enchantment or affliction');
      if (typeof name !== 'string' || !name.trim())
        addIssue(issues, `${path}.attach_card.name`, 'INVALID_CARD_ATTACHMENT_NAME', 'attachment name must be non-empty');
      if (raw.description !== undefined && (typeof raw.description !== 'string' || !raw.description.trim()))
        addIssue(issues, `${path}.attach_card.description`, 'INVALID_CARD_ATTACHMENT_DESCRIPTION', 'description must be non-empty');
      if (raw.emoji !== undefined && (typeof raw.emoji !== 'string' || !raw.emoji.trim()))
        addIssue(issues, `${path}.attach_card.emoji`, 'INVALID_CARD_ATTACHMENT_EMOJI', 'emoji must be non-empty');
      if (!['resolution', 'turn', 'until_played', 'combat', 'run', 'permanent'].includes(String(scope)))
        addIssue(issues, `${path}.attach_card.scope`, 'INVALID_CARD_PATCH_SCOPE', 'attachment scope is invalid');
      if (removeOn !== undefined && !['played', 'discarded', 'turn_end', 'combat_end', 'run_end', 'manual'].includes(String(removeOn)))
        addIssue(issues, `${path}.attach_card.remove_on`, 'INVALID_CARD_ATTACHMENT_REMOVAL', 'remove_on is invalid');
      if (raw.remaining !== undefined && (!Number.isInteger(raw.remaining) || Number(raw.remaining) < 1 || Number(raw.remaining) > 999))
        addIssue(issues, `${path}.attach_card.remaining`, 'INVALID_CARD_ATTACHMENT_DURATION', 'remaining must be 1..999');
      if (raw.priority !== undefined && (!Number.isInteger(raw.priority) || Math.abs(Number(raw.priority)) > 100000))
        addIssue(issues, `${path}.attach_card.priority`, 'INVALID_CARD_ATTACHMENT_PRIORITY', 'priority must be an integer');
      const validReasons = new Set<CardMoveReason>([
        'player_choice', 'random_effect', 'effect', 'turn_cleanup', 'scry', 'recover', 'exhaust',
        'generate', 'copy', 'transform', 'auto_play', 'other',
      ]);
      let discardReasons: CardMoveReason[] | undefined;
      if (raw.discard_reasons !== undefined) {
        if (removeOn !== 'discarded')
          addIssue(issues, `${path}.attach_card.discard_reasons`, 'INVALID_CARD_ATTACHMENT_REMOVAL', 'discard_reasons require remove_on discarded');
        if (!Array.isArray(raw.discard_reasons) || raw.discard_reasons.length < 1 ||
          raw.discard_reasons.some(reason => !validReasons.has(reason as CardMoveReason)) ||
          new Set(raw.discard_reasons).size !== raw.discard_reasons.length) {
          addIssue(issues, `${path}.attach_card.discard_reasons`, 'INVALID_DISCARD_REASON', 'discard_reasons must be unique valid reasons');
        } else discardReasons = raw.discard_reasons as CardMoveReason[];
      }

      const changes: EffectCardAttachmentDefinition['changes'] = [];
      if (!Array.isArray(raw.changes) || raw.changes.length < 1 || raw.changes.length > 32) {
        addIssue(issues, `${path}.attach_card.changes`, 'INVALID_CARD_ATTACHMENT', 'changes must contain 1..32 entries');
      } else raw.changes.forEach((change, index) => {
        const changePath = `${path}.attach_card.changes[${index}]`;
        if (!isRecord(change) || typeof change.kind !== 'string') {
          addIssue(issues, changePath, 'INVALID_CARD_ATTACHMENT', 'attachment change must include kind');
          return;
        }
        if (change.kind === 'play_access') {
          rejectUnknownEntryKeys(change, ['kind', 'mode'], changePath, issues, false);
          if (change.mode !== 'deny' && change.mode !== 'allow')
            addIssue(issues, `${changePath}.mode`, 'INVALID_CARD_PLAY_RULE', 'play_access mode must be deny or allow');
          else changes.push({ kind: 'play_access', mode: change.mode });
          return;
        }
        if (change.kind === 'discard_auto_play') {
          rejectUnknownEntryKeys(change, ['kind', 'reasons', 'failure_destination', 'only_player_turn'], changePath, issues, false);
          const reasons = change.reasons;
          const failureDestination = change.failure_destination ?? 'discard';
          const onlyPlayerTurn = change.only_player_turn ?? true;
          if (!Array.isArray(reasons) || reasons.length < 1 ||
            reasons.some(reason => !validReasons.has(reason as CardMoveReason)) ||
            new Set(reasons).size !== reasons.length)
            addIssue(issues, `${changePath}.reasons`, 'INVALID_DISCARD_REASON', 'discard auto-play reasons are invalid');
          if (!['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(String(failureDestination)))
            addIssue(issues, `${changePath}.failure_destination`, 'INVALID_CARD_DESTINATION', 'failure destination is invalid');
          if (typeof onlyPlayerTurn !== 'boolean')
            addIssue(issues, `${changePath}.only_player_turn`, 'INVALID_CARD_ATTACHMENT', 'only_player_turn must be boolean');
          if (Array.isArray(reasons) && reasons.length > 0 && reasons.every(reason => validReasons.has(reason as CardMoveReason)) &&
            ['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(String(failureDestination)) &&
            typeof onlyPlayerTurn === 'boolean') {
            changes.push({
              kind: 'discard_auto_play',
              reasons: reasons as CardMoveReason[],
              failureDestination: failureDestination as import('./cardRules').PlayedCardDestination,
              onlyPlayerTurn,
            });
          }
          return;
        }
        if (change.kind === 'numeric') {
          rejectUnknownEntryKeys(change, ['kind', 'stat', 'operator', 'value'], changePath, issues, false);
          const formula = compileFormula(change.value, `${changePath}.value`, issues);
          if (!CARD_VALUE_STATS.has(change.stat as CardValueStat)) addIssue(issues, `${changePath}.stat`, 'INVALID_CARD_VALUE_STAT', 'unsupported attachment stat');
          if (!CARD_VALUE_OPERATORS.has(change.operator as CardValueOperator)) addIssue(issues, `${changePath}.operator`, 'INVALID_CARD_VALUE_OPERATOR', 'unsupported attachment operator');
          if (change.operator === 'divide' && formula?.kind === 'number' && formula.value === 0)
            addIssue(issues, `${changePath}.value`, 'DIVISION_BY_ZERO', 'attachment change cannot divide by zero');
          if (formula?.kind === 'number' && !(change.operator === 'divide' && formula.value === 0) && CARD_VALUE_STATS.has(change.stat as CardValueStat) && CARD_VALUE_OPERATORS.has(change.operator as CardValueOperator))
            changes.push({ kind: 'numeric', stat: change.stat as CardValueStat, operator: change.operator as CardValueOperator, value: formula.value });
          return;
        }
        if (change.kind === 'cost' || change.kind === 'x_value') {
          rejectUnknownEntryKeys(change, ['kind', 'operator', 'value'], changePath, issues, false);
          const formula = compileFormula(change.value, `${changePath}.value`, issues);
          const operators = new Set(['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max']);
          if (!operators.has(String(change.operator))) addIssue(issues, `${changePath}.operator`, 'INVALID_CARD_COST_OPERATOR', 'unsupported attachment cost operator');
          if (change.operator === 'divide' && formula?.kind === 'number' && formula.value === 0)
            addIssue(issues, `${changePath}.value`, 'DIVISION_BY_ZERO', 'attachment change cannot divide by zero');
          if (formula?.kind === 'number' && !(change.operator === 'divide' && formula.value === 0) && operators.has(String(change.operator))) changes.push({
            kind: change.kind,
            operator: change.operator as import('./cardPatch').CardCostOperator,
            value: formula.value,
          });
          return;
        }
        if (change.kind === 'keyword') {
          rejectUnknownEntryKeys(change, ['kind', 'keyword', 'enabled'], changePath, issues, false);
          if (!['retain', 'exhaust', 'ethereal', 'innate'].includes(String(change.keyword)) || typeof change.enabled !== 'boolean')
            addIssue(issues, changePath, 'INVALID_CARD_KEYWORD', 'keyword attachment requires a supported keyword and enabled boolean');
          else changes.push({ kind: 'keyword', keyword: change.keyword as import('./cardPatch').CardKeyword, enabled: change.enabled });
          return;
        }
        if (change.kind === 'replay') {
          rejectUnknownEntryKeys(change, ['kind', 'extra'], changePath, issues, false);
          const formula = compileFormula(change.extra, `${changePath}.extra`, issues);
          if (formula?.kind === 'number') changes.push({ kind: 'replay', extra: formula.value });
          return;
        }
        if (change.kind === 'dynamic_cost') {
          rejectUnknownEntryKeys(change, ['kind', 'timing', 'operator', 'value', 'minimum', 'maximum'], changePath, issues, false);
          const formula = compileFormula(change.value, `${changePath}.value`, issues);
          const operators = new Set(['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max']);
          if (!['on_draw', 'while_in_hand', 'on_play'].includes(String(change.timing))) addIssue(issues, `${changePath}.timing`, 'INVALID_DYNAMIC_COST_TIMING', 'unsupported attachment timing');
          if (!operators.has(String(change.operator))) addIssue(issues, `${changePath}.operator`, 'INVALID_CARD_COST_OPERATOR', 'unsupported attachment cost operator');
          if (formula?.kind === 'number' && ['on_draw', 'while_in_hand', 'on_play'].includes(String(change.timing)) && operators.has(String(change.operator))) changes.push({
            kind: 'dynamic_cost', timing: change.timing as 'on_draw' | 'while_in_hand' | 'on_play',
            operator: change.operator as import('./cardPatch').CardCostOperator, value: formula.value,
            ...(typeof change.minimum === 'number' ? { minimum: change.minimum } : {}),
            ...(typeof change.maximum === 'number' ? { maximum: change.maximum } : {}),
          });
          return;
        }
        addIssue(issues, `${changePath}.kind`, 'INVALID_CARD_ATTACHMENT', `unsupported attachment change: ${change.kind}`);
      });
      if (
        typeof id === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id) &&
        (kind === 'enchantment' || kind === 'affliction') && typeof name === 'string' && name.trim() &&
        ['resolution', 'turn', 'until_played', 'combat', 'run', 'permanent'].includes(String(scope)) &&
        Array.isArray(raw.changes) && changes.length === raw.changes.length
      ) {
        attachment = {
          id,
          kind,
          name: name.trim(),
          ...(typeof raw.description === 'string' ? { description: raw.description.trim() } : {}),
          ...(typeof raw.emoji === 'string' ? { emoji: raw.emoji.trim() } : {}),
          scope: scope as import('./cardPatch').CardPatchScope,
          ...(['played', 'discarded', 'turn_end', 'combat_end', 'run_end', 'manual'].includes(String(removeOn))
            ? { removeOn: removeOn as import('./cardAttachment').CardAttachmentRemovalEvent }
            : {}),
          ...(typeof raw.remaining === 'number' ? { remaining: raw.remaining } : {}),
          ...(discardReasons ? { discardReasons } : {}),
          ...(typeof raw.priority === 'number' ? { priority: raw.priority } : {}),
          changes,
        };
      }
    }
    if (selector && attachment) node = { op: 'apply_card_attachment', selector, attachment };
  } else if (operation === 'upgrade_card') {
    rejectUnknownEntryKeys(
      value,
      [operation, ...CARD_SELECTOR_INPUT_KEYS, 'count', 'scope', 'levels', 'max_level', 'changes', 'when'],
      path,
      issues,
    );
    const selectAll = value.upgrade_card === 'all';
    const amount = selectAll ? undefined : compileFixedCount(value.upgrade_card, `${path}.upgrade_card`, issues);
    const selectorSource = selectAll ? { ...value, pick: 'all' } : value;
    const selector = amount === null ? null : compileCardSelector(selectorSource, path, issues, 'choose', amount);
    const scope = value.scope ?? 'combat';
    const levels = value.levels ?? 1;
    const maxLevel = value.max_level;
    if (!['combat', 'run', 'permanent'].includes(String(scope)))
      addIssue(issues, `${path}.scope`, 'INVALID_CARD_UPGRADE_SCOPE', 'upgrade scope must be combat, run, or permanent');
    if (!Number.isInteger(levels) || Number(levels) < 1 || Number(levels) > 99)
      addIssue(issues, `${path}.levels`, 'INVALID_CARD_UPGRADE_LEVEL', 'levels must be an integer from 1 to 99');
    if (maxLevel !== undefined && (!Number.isInteger(maxLevel) || Number(maxLevel) < 1 || Number(maxLevel) > 99))
      addIssue(issues, `${path}.max_level`, 'INVALID_CARD_UPGRADE_LEVEL', 'max_level must be an integer from 1 to 99');
    const rawChanges = value.changes;
    const changes: EffectCardUpgradeChange[] = [];
    if (!Array.isArray(rawChanges) || rawChanges.length < 1 || rawChanges.length > 32) {
      addIssue(issues, `${path}.changes`, 'INVALID_CARD_UPGRADE', 'changes must contain 1 to 32 entries');
    } else rawChanges.forEach((raw, index) => {
      const changePath = `${path}.changes[${index}]`;
      if (!isRecord(raw) || typeof raw.kind !== 'string') {
        addIssue(issues, changePath, 'INVALID_CARD_UPGRADE', 'upgrade change must be an object with kind');
        return;
      }
      if (raw.kind === 'numeric') {
        rejectUnknownEntryKeys(raw, ['kind', 'stat', 'operator', 'value'], changePath, issues, false);
        const formula = compileFormula(raw.value, `${changePath}.value`, issues);
        if (!CARD_VALUE_STATS.has(raw.stat as CardValueStat)) addIssue(issues, `${changePath}.stat`, 'INVALID_CARD_VALUE_STAT', 'unsupported upgrade stat');
        if (!CARD_VALUE_OPERATORS.has(raw.operator as CardValueOperator)) addIssue(issues, `${changePath}.operator`, 'INVALID_CARD_VALUE_OPERATOR', 'unsupported upgrade operator');
        if (formula?.kind === 'number' && CARD_VALUE_STATS.has(raw.stat as CardValueStat) && CARD_VALUE_OPERATORS.has(raw.operator as CardValueOperator))
          changes.push({ kind: 'numeric', stat: raw.stat as CardValueStat, operator: raw.operator as CardValueOperator, value: formula.value });
        return;
      }
      if (raw.kind === 'cost' || raw.kind === 'x_value') {
        rejectUnknownEntryKeys(raw, ['kind', 'operator', 'value'], changePath, issues, false);
        const formula = compileFormula(raw.value, `${changePath}.value`, issues);
        const operators = new Set(['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max']);
        if (!operators.has(String(raw.operator))) addIssue(issues, `${changePath}.operator`, 'INVALID_CARD_COST_OPERATOR', 'unsupported cost operator');
        if (formula?.kind === 'number' && operators.has(String(raw.operator))) changes.push({
          kind: raw.kind,
          operator: raw.operator as import('./cardPatch').CardCostOperator,
          value: formula.value,
        });
        return;
      }
      if (raw.kind === 'keyword') {
        rejectUnknownEntryKeys(raw, ['kind', 'keyword', 'enabled'], changePath, issues, false);
        if (!['retain', 'exhaust', 'ethereal', 'innate'].includes(String(raw.keyword)) || typeof raw.enabled !== 'boolean')
          addIssue(issues, changePath, 'INVALID_CARD_KEYWORD', 'keyword upgrade requires a supported keyword and enabled boolean');
        else changes.push({ kind: 'keyword', keyword: raw.keyword as import('./cardPatch').CardKeyword, enabled: raw.enabled });
        return;
      }
      if (raw.kind === 'replay') {
        rejectUnknownEntryKeys(raw, ['kind', 'extra'], changePath, issues, false);
        const formula = compileFormula(raw.extra, `${changePath}.extra`, issues);
        if (formula?.kind === 'number') changes.push({ kind: 'replay', extra: formula.value });
        return;
      }
      if (raw.kind === 'dynamic_cost') {
        rejectUnknownEntryKeys(raw, ['kind', 'timing', 'operator', 'value', 'minimum', 'maximum'], changePath, issues, false);
        const formula = compileFormula(raw.value, `${changePath}.value`, issues);
        const timing = raw.timing;
        const operators = new Set(['add', 'subtract', 'multiply', 'divide', 'set', 'min', 'max']);
        if (!['on_draw', 'while_in_hand', 'on_play'].includes(String(timing))) addIssue(issues, `${changePath}.timing`, 'INVALID_DYNAMIC_COST_TIMING', 'unsupported dynamic cost timing');
        if (!operators.has(String(raw.operator))) addIssue(issues, `${changePath}.operator`, 'INVALID_CARD_COST_OPERATOR', 'unsupported cost operator');
        if (formula?.kind === 'number' && ['on_draw', 'while_in_hand', 'on_play'].includes(String(timing)) && operators.has(String(raw.operator))) changes.push({
          kind: 'dynamic_cost', timing: timing as 'on_draw' | 'while_in_hand' | 'on_play',
          operator: raw.operator as import('./cardPatch').CardCostOperator, value: formula.value,
          ...(typeof raw.minimum === 'number' ? { minimum: raw.minimum } : {}),
          ...(typeof raw.maximum === 'number' ? { maximum: raw.maximum } : {}),
        });
        return;
      }
      addIssue(issues, `${changePath}.kind`, 'INVALID_CARD_UPGRADE', `unsupported upgrade change: ${raw.kind}`);
    });
    if (selector && Array.isArray(rawChanges) && changes.length === rawChanges.length && ['combat', 'run', 'permanent'].includes(String(scope)) && Number.isInteger(levels)) {
      node = {
        op: 'upgrade_cards', selector, scope: scope as 'combat' | 'run' | 'permanent', levels: Number(levels),
        ...(typeof maxLevel === 'number' ? { maxLevel } : {}), changes,
      };
    }
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
  } else if (operation === 'ensure_card') {
    rejectUnknownEntryKeys(value, [operation, 'to', 'minimum', 'include_copies', 'when'], path, issues);
    const templateId = value.ensure_card;
    const destination = value.to ?? 'hand';
    const minimum = value.minimum ?? 1;
    if (typeof templateId !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(templateId)) {
      addIssue(issues, `${path}.ensure_card`, 'INVALID_CARD_ID', 'ensure_card must reference a template ID');
    } else if (!templates.has(templateId)) {
      addIssue(issues, `${path}.ensure_card`, 'UNKNOWN_CARD_TEMPLATE', `Unknown card template: ${templateId}`);
    } else if (destination !== 'hand' && destination !== 'deck') {
      addIssue(issues, `${path}.to`, 'INVALID_CARD_ZONE', 'ensure_card to must be hand or deck');
    } else if (!Number.isInteger(minimum) || Number(minimum) < 1 || Number(minimum) > 100) {
      addIssue(issues, `${path}.minimum`, 'INVALID_CARD_COUNT', 'ensure_card minimum must be an integer from 1 to 100');
    } else if (value.include_copies !== undefined && typeof value.include_copies !== 'boolean') {
      addIssue(issues, `${path}.include_copies`, 'INVALID_CARD_FILTER', 'include_copies must be boolean');
    } else {
      const card = compileGeneratedCard(
        templates.get(templateId),
        `${path}.template(${templateId})`,
        issues,
        templates,
        templateStack,
        statusNames,
      );
      if (card) node = {
        op: 'ensure_card',
        zone: destination === 'hand' ? 'hand' : 'draw',
        card,
        minimum: Number(minimum),
        ...(value.include_copies === true ? { includeCopies: true } : {}),
      };
    }
  } else if (operation === 'card_rule') {
    const ruleFilterKeys = CARD_SELECTOR_INPUT_KEYS.filter(key => key !== 'from' && key !== 'pick');
    rejectUnknownEntryKeys(value, [operation, 'limit', 'extra', 'to', 'destination', 'priority', 'resources', ...ruleFilterKeys], path, issues, false);
    const rule = value.card_rule;
    const target = compileTarget(value.to, implicitTarget ?? 'self', `${path}.to`, issues);
    if (typeof rule !== 'string' || !CARD_PLAY_RULES.has(rule as CardPlayRuleKind)) {
      addIssue(issues, `${path}.card_rule`, 'INVALID_CARD_PLAY_RULE', `Unsupported card rule: ${String(rule)}`);
    }
    const requiresLimit = ['replay', 'free', 'limit_draw', 'limit_block_gain', 'limit_energy_gain', 'limit_card_play'].includes(String(rule));
    const requiresSelector = ['deny_card_play', 'allow_card_play', 'limit_card_play', 'card_destination'].includes(String(rule));
    if (requiresLimit && value.limit === undefined)
      addIssue(issues, `${path}.limit`, 'MISSING_CARD_RULE_LIMIT', 'this card_rule requires limit');
    if (!requiresLimit && value.limit !== undefined)
      addIssue(issues, `${path}.limit`, 'UNEXPECTED_CARD_RULE_LIMIT', 'this card_rule does not accept limit');
    const limitFormula =
      value.limit === 'all' || value.limit === undefined
        ? null
        : compileFormula(value.limit, `${path}.limit`, issues);
    if (limitFormula && (limitFormula.kind !== 'number' || !isSupportedModifierFormula(limitFormula.value))) {
      addIssue(issues, `${path}.limit`, 'INVALID_CARD_RULE_FORMULA', 'Card rule formulas may only use numbers and status stacks');
    }
    const extraFormula =
      rule === 'replay' ? compileFormula(value.extra ?? 1, `${path}.extra`, issues) : null;
    if (rule !== 'replay' && value.extra !== undefined)
      addIssue(issues, `${path}.extra`, 'UNEXPECTED_CARD_REPLAY_COUNT', 'only replay card_rule accepts extra');
    if (extraFormula && (extraFormula.kind !== 'number' || !isSupportedModifierFormula(extraFormula.value))) {
      addIssue(issues, `${path}.extra`, 'INVALID_CARD_RULE_FORMULA', 'Card rule formulas may only use numbers and status stacks');
    }
    const validLimit = !requiresLimit || value.limit === 'all' || limitFormula?.kind === 'number';
    const validExtra = rule !== 'replay' || extraFormula?.kind === 'number';
    const filter = compileCardSelectorFilter(value, path, issues);
    const hasAuthoredFilter = ruleFilterKeys.some(key => value[key] !== undefined);
    const selector = requiresSelector || hasAuthoredFilter
      ? { zone: 'hand' as const, pick: 'all' as const, ...(filter ? { filter } : {}) }
      : undefined;
    const destination = value.destination;
    if (rule === 'card_destination') {
      if (!['discard', 'exhaust', 'draw_top', 'draw_bottom', 'hand', 'remove'].includes(String(destination)))
        addIssue(issues, `${path}.destination`, 'INVALID_CARD_DESTINATION', 'card_destination rule requires a valid destination');
    } else if (destination !== undefined) {
      addIssue(issues, `${path}.destination`, 'UNEXPECTED_CARD_DESTINATION', 'only card_destination rule accepts destination');
    }
    const priority = value.priority ?? 0;
    if (!Number.isInteger(priority) || Math.abs(Number(priority)) > 100000)
      addIssue(issues, `${path}.priority`, 'INVALID_RULE_PRIORITY', 'priority must be an integer with absolute value at most 100000');
    let freeResources: 'all' | string[] | undefined;
    if (rule === 'free') {
      if (value.resources === undefined || value.resources === 'all') freeResources = 'all';
      else if (
        Array.isArray(value.resources) &&
        value.resources.length > 0 &&
        value.resources.every((id: unknown) => typeof id === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) &&
        new Set(value.resources).size === value.resources.length
      ) freeResources = [...value.resources];
      else addIssue(issues, `${path}.resources`, 'INVALID_RESOURCE_WAIVER', 'free resources must be all or unique resource IDs');
    } else if (value.resources !== undefined) {
      addIssue(issues, `${path}.resources`, 'UNEXPECTED_RESOURCE_WAIVER', 'only free card_rule accepts resources');
    }
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
        ...(requiresLimit
          ? { limit: value.limit === 'all' ? 'all' : (limitFormula as Extract<FormulaResult, { kind: 'number' }>).value }
          : {}),
        ...(rule === 'replay'
          ? { extra: (extraFormula as Extract<FormulaResult, { kind: 'number' }>).value }
          : {}),
        ...(selector ? { selector } : {}),
        ...(rule === 'card_destination' ? { destination: destination as import('./cardRules').PlayedCardDestination } : {}),
        ...(rule === 'free' && freeResources !== 'all' ? { freeResources } : {}),
        ...(priority !== 0 ? { priority: Number(priority) } : {}),
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
        const targetSelector = compileEnemyTargetSelector(value.targets, target, `${path}.targets`, issues, enemyCollectionTarget);
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
  enemyCollectionTarget: EffectTarget = 'opponent',
): EffectNode[] | null {
  if (!isRecord(value)) {
    addIssue(issues, path, 'INVALID_EFFECT', 'Effect must be an object');
    return null;
  }
  const operations = compactEffectOperationKeys(value);
  if (operations.length <= 1) {
    const hits =
      operations[0] === 'damage' && value.hits !== undefined ? compileHitCount(value.hits, `${path}.hits`, issues) : 1;
    const node = compileSingleEntry(
      value,
      path,
      issues,
      templates,
      templateStack,
      statusNames,
      implicitTarget,
      enemyCollectionTarget,
    );
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
      enemyCollectionTarget,
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
      options.enemyCollectionTarget,
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
              ...(options.triggerQuery ? { eventQuery: options.triggerQuery } : {}),
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
