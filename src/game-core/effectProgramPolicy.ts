import {
  validateEffectProgram,
  type ConditionExpression,
  type EffectNode,
  type EffectProgram,
  type GeneratedCardDefinition,
  type NumericExpression,
} from './effectDsl';
import { normalizeCardCost } from './combatResource';

export type EffectTriggerPolicy = 'allow' | 'forbid' | 'require_root' | 'require_root_or_status';
export type EffectModifierPolicy = 'allow' | 'forbid' | 'only';

export interface EffectProgramPolicyOptions {
  triggerPolicy?: EffectTriggerPolicy;
  modifierPolicy?: EffectModifierPolicy;
  allowSpentEnergy?: boolean;
  /** Resource IDs whose actual paid amount may be read by the program. */
  allowSpentResources?: ReadonlySet<string>;
  /** Resource IDs whose resolved `all`/X value may be read by the program. */
  allowXResources?: ReadonlySet<string>;
  allowStatusStacks?: boolean;
  allowNarrate?: boolean;
  requireSingleNarrate?: boolean;
  knownStatusIds?: ReadonlySet<string>;
}

export interface EffectProgramPolicyIssue {
  path: string;
  code: string;
  message: string;
}

export type EffectProgramPolicyResult =
  | { ok: true; value: EffectProgram }
  | { ok: false; issues: EffectProgramPolicyIssue[] };

interface NormalizedPolicy {
  triggerPolicy: EffectTriggerPolicy;
  modifierPolicy: EffectModifierPolicy;
  allowSpentEnergy: boolean;
  allowSpentResources: ReadonlySet<string>;
  allowXResources: ReadonlySet<string>;
  allowStatusStacks: boolean;
  allowNarrate: boolean;
  requireSingleNarrate: boolean;
  knownStatusIds?: ReadonlySet<string>;
}

const SPECIAL_STATUS_IDS = new Set(['all', 'buffs', 'debuffs']);

function normalizePolicy(options: EffectProgramPolicyOptions): NormalizedPolicy {
  return {
    triggerPolicy: options.triggerPolicy ?? 'allow',
    modifierPolicy: options.modifierPolicy ?? 'allow',
    allowSpentEnergy: options.allowSpentEnergy === true,
    allowSpentResources: new Set(options.allowSpentResources || []),
    allowXResources: new Set(options.allowXResources || []),
    allowStatusStacks: options.allowStatusStacks === true,
    allowNarrate: options.allowNarrate === true,
    requireSingleNarrate: options.requireSingleNarrate === true,
    knownStatusIds: options.knownStatusIds,
  };
}

function addIssue(
  issues: EffectProgramPolicyIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function visitNumber(
  expression: NumericExpression,
  path: string,
  policy: NormalizedPolicy,
  issues: EffectProgramPolicyIssue[],
): void {
  if (typeof expression === 'number') return;
  if (expression.op === 'var') {
    if (expression.path === 'context.spent_energy' && !policy.allowSpentEnergy) {
      addIssue(issues, path, 'SPENT_ENERGY_NOT_ALLOWED', 'spent_energy 只允许用于 X 费卡牌主效果');
    }
    if (expression.path === 'context.x_value' && !policy.allowSpentEnergy) {
      addIssue(issues, path, 'X_VALUE_NOT_ALLOWED', 'x_value 只允许用于能量 X 费卡牌主效果');
    }
    const spentResource = expression.path.match(/^context\.spent_resource\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (spentResource && !policy.allowSpentResources.has(spentResource[1])) {
      addIssue(issues, path, 'SPENT_RESOURCE_NOT_ALLOWED', `当前卡牌不会支付资源 ${spentResource[1]}`);
    }
    const xResource = expression.path.match(/^context\.x_resource\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (xResource && !policy.allowXResources.has(xResource[1])) {
      addIssue(issues, path, 'X_RESOURCE_NOT_ALLOWED', `当前卡牌没有资源 ${xResource[1]} 的 X 费用`);
    }
    if (expression.path === 'context.status_stacks' && !policy.allowStatusStacks) {
      addIssue(issues, path, 'STATUS_STACKS_NOT_ALLOWED', 'stacks 只允许用于状态触发器');
    }
    return;
  }
  if (expression.op === 'negate' || expression.op === 'floor' || expression.op === 'ceil' || expression.op === 'abs') {
    visitNumber(expression.value, `${path}.value`, policy, issues);
    return;
  }
  if (expression.op === 'clamp_min') {
    visitNumber(expression.value, `${path}.value`, policy, issues);
    return;
  }
  if (expression.op === 'min' || expression.op === 'max') {
    expression.values.forEach((entry, index) => visitNumber(entry, `${path}.values[${index}]`, policy, issues));
    return;
  }
  if (expression.op === 'count_cards' || expression.op === 'count_statuses' || expression.op === 'history' || expression.op === 'intent_value') return;
  visitNumber(expression.left, `${path}.left`, policy, issues);
  visitNumber(expression.right, `${path}.right`, policy, issues);
}

function visitCondition(
  condition: ConditionExpression,
  path: string,
  policy: NormalizedPolicy,
  issues: EffectProgramPolicyIssue[],
): void {
  if (condition.op === 'compare') {
    visitNumber(condition.left, `${path}.left`, policy, issues);
    visitNumber(condition.right, `${path}.right`, policy, issues);
    return;
  }
  if (condition.op === 'not') {
    visitCondition(condition.condition, `${path}.condition`, policy, issues);
    return;
  }
  if (condition.op === 'last_card_type' || condition.op === 'intent_type') return;
  condition.conditions.forEach((entry, index) =>
    visitCondition(entry, `${path}.conditions[${index}]`, policy, issues),
  );
}

function generatedCardPolicy(card: GeneratedCardDefinition): NormalizedPolicy {
  const isPower = card.type === 'Power';
  const isEvent = card.type === 'Event';
  const costs = normalizeCardCost(card.cost);
  return normalizePolicy({
    triggerPolicy: isPower ? 'require_root_or_status' : 'forbid',
    modifierPolicy: 'forbid',
    allowSpentEnergy: costs.energy === 'all',
    allowSpentResources: new Set(Object.keys(costs)),
    allowXResources: new Set(Object.entries(costs).filter(([, value]) => value === 'all').map(([id]) => id)),
    allowNarrate: isEvent,
    requireSingleNarrate: isEvent,
  });
}

function visitProgram(
  program: EffectProgram,
  path: string,
  policy: NormalizedPolicy,
  issues: EffectProgramPolicyIssue[],
): void {
  if (
    policy.triggerPolicy === 'require_root' &&
    (program.steps.length === 0 || program.steps.some(node => node.op !== 'register_trigger'))
  ) {
    addIssue(issues, `${path}.steps`, 'ROOT_TRIGGER_REQUIRED', 'Power 的所有顶层效果必须注册为触发器');
  }
  const isDirectStatusPowerNode = (node: EffectNode): boolean =>
    node.op === 'apply_status' ||
    (node.op === 'if' &&
      node.then.length > 0 &&
      node.then.every(isDirectStatusPowerNode) &&
      (node.else || []).every(isDirectStatusPowerNode));
  if (
    policy.triggerPolicy === 'require_root_or_status' &&
    (program.steps.length === 0 ||
      (!program.steps.some(node => node.op === 'register_trigger') &&
        program.steps.some(node => !isDirectStatusPowerNode(node))))
  ) {
    addIssue(
      issues,
      `${path}.steps`,
      'ROOT_TRIGGER_REQUIRED',
      'Power 必须至少注册一个触发器，或只施加已注册状态',
    );
  }
  if (
    policy.requireSingleNarrate &&
    (program.steps.length !== 1 || program.steps[0]?.op !== 'narrate')
  ) {
    addIssue(issues, `${path}.steps`, 'SINGLE_NARRATE_REQUIRED', 'Event 主效果必须且只能包含一个顶层 narrate');
  }
  program.steps.forEach((node, index) => visitNode(node, `${path}.steps[${index}]`, policy, issues, true));
}

function visitGeneratedCard(
  card: GeneratedCardDefinition,
  path: string,
  parentPolicy: NormalizedPolicy,
  issues: EffectProgramPolicyIssue[],
): void {
  const policy = generatedCardPolicy(card);
  policy.knownStatusIds = parentPolicy.knownStatusIds;
  visitProgram(card.program, `${path}.program`, policy, issues);
  if (card.discardProgram) {
    visitProgram(
      card.discardProgram,
      `${path}.discardProgram`,
      normalizePolicy({
        triggerPolicy: 'forbid',
        modifierPolicy: 'forbid',
        knownStatusIds: parentPolicy.knownStatusIds,
      }),
      issues,
    );
  }
}

function containsDraw(node: EffectNode): boolean {
  if (node.op === 'draw_cards') return true;
  if (node.op === 'if') {
    return node.then.some(containsDraw) || (node.else || []).some(containsDraw);
  }
  if (node.op === 'register_trigger') return node.effects.some(containsDraw);
  return false;
}

function visitNode(
  node: EffectNode,
  path: string,
  policy: NormalizedPolicy,
  issues: EffectProgramPolicyIssue[],
  atRoot: boolean,
): void {
  if (node.op === 'if') {
    visitCondition(node.condition, `${path}.condition`, policy, issues);
    node.then.forEach((entry, index) => visitNode(entry, `${path}.then[${index}]`, policy, issues, false));
    (node.else || []).forEach((entry, index) =>
      visitNode(entry, `${path}.else[${index}]`, policy, issues, false),
    );
    return;
  }
  if (node.op === 'register_trigger') {
    if (policy.triggerPolicy === 'forbid' || !atRoot) {
      addIssue(issues, path, 'TRIGGER_NOT_ALLOWED', '此效果入口不允许注册触发器');
    }
    if ((node.trigger === 'on_draw' || node.trigger === 'on_shuffle') && node.effects.some(containsDraw)) {
      addIssue(
        issues,
        `${path}.effects`,
        'RECURSIVE_DRAW_NOT_ALLOWED',
        `${node.trigger} 触发器不能再次抽牌`,
      );
    }
    const nestedPolicy = { ...policy, triggerPolicy: 'forbid' as const, requireSingleNarrate: false };
    node.effects.forEach((entry, index) =>
      visitNode(entry, `${path}.effects[${index}]`, nestedPolicy, issues, false),
    );
    return;
  }
  if (node.op === 'choose_one') {
    node.options.forEach((option, optionIndex) =>
      option.effects.forEach((entry, effectIndex) =>
        visitNode(entry, `${path}.options[${optionIndex}].effects[${effectIndex}]`, policy, issues, false)),
    );
    return;
  }
  if (node.op === 'narrate') {
    if (!policy.allowNarrate || !atRoot) {
      addIssue(issues, path, 'NARRATE_NOT_ALLOWED', 'narrate 只允许作为 Event 的唯一顶层主效果');
    }
    return;
  }
  if (node.op === 'apply_card_patch') {
    if (node.patch.kind === 'numeric' || node.patch.kind === 'cost' || node.patch.kind === 'x_value' || node.patch.kind === 'dynamic_cost') {
      visitNumber(node.patch.value, `${path}.patch.value`, policy, issues);
    } else if (node.patch.kind === 'replay') {
      visitNumber(node.patch.extra, `${path}.patch.extra`, policy, issues);
    }
    return;
  }
  if (node.op === 'upgrade_cards') {
    node.changes.forEach((change, index) => {
      if (change.kind === 'numeric' || change.kind === 'cost' || change.kind === 'x_value' || change.kind === 'dynamic_cost')
        visitNumber(change.value, `${path}.changes[${index}].value`, policy, issues);
      else if (change.kind === 'replay') visitNumber(change.extra, `${path}.changes[${index}].extra`, policy, issues);
    });
    return;
  }
  if (node.op === 'set_stance') {
    if (!node.stance) return;
    for (const [field, effects] of [
      ['enterEffects', node.stance.enterEffects],
      ['exitEffects', node.stance.exitEffects],
    ] as const) {
      (effects || []).forEach((entry, index) =>
        visitNode(entry, `${path}.stance.${field}[${index}]`, policy, issues, false));
    }
    const passivePolicy = { ...policy, triggerPolicy: 'forbid' as const, modifierPolicy: 'only' as const, requireSingleNarrate: false };
    (node.stance.passiveEffects || []).forEach((entry, index) =>
      visitNode(entry, `${path}.stance.passiveEffects[${index}]`, passivePolicy, issues, false));
    return;
  }
  if (node.op === 'channel_orb') {
    visitNumber(node.orb.value, `${path}.orb.value`, policy, issues);
    for (const [field, effects] of [
      ['passiveEffects', node.orb.passiveEffects],
      ['evokeEffects', node.orb.evokeEffects],
    ] as const) {
      (effects || []).forEach((entry, index) =>
        visitNode(entry, `${path}.orb.${field}[${index}]`, policy, issues, false));
    }
    return;
  }
  if (node.op === 'modify_orbs') {
    visitNumber(node.value, `${path}.value`, policy, issues);
    return;
  }
  if (node.op === 'modify' || node.op === 'card_play_rule') {
    if (policy.modifierPolicy === 'forbid') {
      addIssue(issues, path, 'MODIFIER_NOT_ALLOWED', '持续规则只允许用于 passive 或状态 hold');
    }
    if (node.op === 'modify') {
      visitNumber(node.value, `${path}.value`, policy, issues);
    } else {
      if (node.limit !== undefined && node.limit !== 'all')
        visitNumber(node.limit, `${path}.limit`, policy, issues);
      if (node.extra !== undefined) visitNumber(node.extra, `${path}.extra`, policy, issues);
    }
    return;
  }
  if (policy.modifierPolicy === 'only') {
    addIssue(issues, path, 'ONLY_MODIFIERS_ALLOWED', 'passive 与状态 hold 只能包含持续修饰或出牌规则');
  }
  if (node.op === 'apply_card_attachment') {
    node.attachment.changes.forEach((change, index) => {
      if (change.kind === 'numeric' || change.kind === 'cost' || change.kind === 'x_value' || change.kind === 'dynamic_cost') {
        visitNumber(change.value, `${path}.attachment.changes[${index}].value`, policy, issues);
      } else if (change.kind === 'replay') {
        visitNumber(change.extra, `${path}.attachment.changes[${index}].extra`, policy, issues);
      }
    });
    return;
  }
  if (node.op === 'apply_status' || node.op === 'remove_status') {
    if (
      policy.knownStatusIds &&
      !SPECIAL_STATUS_IDS.has(node.status) &&
      !policy.knownStatusIds.has(node.status)
    ) {
      addIssue(issues, `${path}.status`, 'UNKNOWN_STATUS', `状态未注册: ${node.status}`);
    }
    if (node.op === 'apply_status') visitNumber(node.stacks, `${path}.stacks`, policy, issues);
    return;
  }
  if (node.op === 'add_card' || node.op === 'ensure_card') {
    visitGeneratedCard(node.card, `${path}.card`, policy, issues);
    return;
  }
  if (node.op === 'set_stat') {
    visitNumber(node.value, `${path}.value`, policy, issues);
    return;
  }
  if (node.op === 'set_resource') {
    visitNumber(node.value, `${path}.value`, policy, issues);
    return;
  }
  if ('amount' in node) visitNumber(node.amount, `${path}.amount`, policy, issues);
}

/** Enforce where a portable program may be used. */
export function validateEffectProgramPolicy(
  value: unknown,
  options: EffectProgramPolicyOptions = {},
): EffectProgramPolicyResult {
  const validation = validateEffectProgram(value);
  if (!validation.ok) return validation;
  const issues: EffectProgramPolicyIssue[] = [];
  visitProgram(validation.value, '$', normalizePolicy(options), issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: validation.value };
}
