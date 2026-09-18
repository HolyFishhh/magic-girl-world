import {
  evaluateConditionExpression,
  type ConditionExpression,
  type CoreEffectState,
  type EffectNode,
  type EffectProgram,
  type NumericExpression,
} from '../../game-core/effectDsl';
import type { EnemyTargetSelector } from '../../game-core/combatantCollection';

export type HandCardConditionHighlightKind =
  | 'none'
  | 'current-target'
  | 'other-target'
  | 'partial'
  | 'unknown';

export interface HandCardConditionTarget { id: string; }

export interface HandCardConditionHighlight {
  kind: HandCardConditionHighlightKind;
  /** Text deliberately describes certainty and target scope; it never claims a future branch will resolve. */
  hint: string | null;
  /** Only a fully-known match for the active target receives the animated glow. */
  glows: boolean;
}

export interface HandCardConditionHighlightInput<TTarget extends HandCardConditionTarget = HandCardConditionTarget> {
  program: EffectProgram | undefined;
  targets: readonly TTarget[];
  activeTargetId: string | null | undefined;
  getState: (target: TTarget) => CoreEffectState;
}

/**
 * Read-only preflight for a card's immediately reachable conditional branch.
 *
 * A card can change battle state before a later condition, require execution-only context,
 * or resolve a target independently from the active enemy. Those branches are intentionally
 * reported as unknown rather than guessed. The caller owns state acquisition so this module
 * cannot mutate combat, consume payments, or draw RNG.
 */
export function evaluateHandCardConditionHighlight<TTarget extends HandCardConditionTarget>(
  input: HandCardConditionHighlightInput<TTarget>,
): HandCardConditionHighlight {
  const conditions = collectConditions(input.program?.steps || []);
  if (conditions.length === 0) return none();

  const first = input.program?.steps[0];
  if (!first || first.op !== 'if' || conditions.length !== 1 || usesUnpreviewableContext(first.condition)) return unknown();
  if (input.targets.length === 0) return { kind: 'unknown', hint: '暂无可判定目标', glows: false };

  try {
    const dependsOnTarget = conditionDependsOnOpponent(first.condition);
    const scope = resolveConditionScope(first, input.targets, input.activeTargetId, dependsOnTarget);
    if (!scope) return unknown();

    const matches = scope.targets.filter(target =>
      evaluateConditionExpression(first.condition, input.getState(target), { spentEnergy: 0 }),
    );
    if (matches.length > 0) {
      if (!dependsOnTarget) return { kind: 'current-target', hint: '条件满足：当前条件满足', glows: true };
      if (scope.kind === 'active') return { kind: 'current-target', hint: '条件满足：当前目标满足', glows: true };
      return { kind: 'current-target', hint: '条件满足：固定目标满足', glows: true };
    }

    if (dependsOnTarget && scope.kind === 'active') {
      const elsewhere = input.targets.filter(target => target.id !== scope.targets[0].id).filter(target =>
        evaluateConditionExpression(first.condition, input.getState(target), { spentEnergy: 0 }),
      );
      if (elsewhere.length > 0) return { kind: 'other-target', hint: '条件满足：其他目标满足', glows: false };
    }

    const state = input.getState(scope.targets[0]);
    if (isPartiallySatisfied(first.condition, state))
      return { kind: 'partial', hint: dependsOnTarget ? '条件满足：当前目标部分符合' : '条件满足：当前条件部分符合', glows: false };
    return none();
  } catch {
    // State reads are outside this module's control. A failed read must never block hand rendering.
    return unknown();
  }
}

function none(): HandCardConditionHighlight {
  return { kind: 'none', hint: null, glows: false };
}

function unknown(): HandCardConditionHighlight {
  return { kind: 'unknown', hint: '条件将在执行时判定', glows: false };
}

function resolveConditionScope<TTarget extends HandCardConditionTarget>(
  node: Extract<EffectNode, { op: 'if' }>,
  targets: readonly TTarget[],
  activeTargetId: string | null | undefined,
  dependsOnTarget: boolean,
): { kind: 'active' | 'fixed' | 'self'; targets: readonly TTarget[] } | null {
  const active = targets.find(target => target.id === activeTargetId) || targets[0];
  if (!dependsOnTarget) return { kind: 'self', targets: [active] };

  const selectors = collectOpponentTargetSelectors([...node.then, ...(node.else || [])]);
  if (selectors.length === 0 || selectors.every(selector => selector.mode === 'active'))
    return { kind: 'active', targets: [active] };
  if (!selectors.every(selector => selector.mode === 'by_id')) return null;
  const ids = new Set(selectors.map(selector => selector.id));
  if (ids.size !== 1) return null;
  const target = targets.find(entry => entry.id === selectors[0].id);
  return target ? { kind: 'fixed', targets: [target] } : null;
}

function collectOpponentTargetSelectors(nodes: readonly EffectNode[]): EnemyTargetSelector[] {
  const result: EnemyTargetSelector[] = [];
  const visit = (node: EffectNode): void => {
    if ('targetSelector' in node && node.target === 'opponent' && node.targetSelector) result.push(node.targetSelector);
    if (node.op === 'if') {
      node.then.forEach(visit);
      node.else?.forEach(visit);
    } else if (node.op === 'register_trigger' || node.op === 'schedule_effect' || node.op === 'summoner_effects') {
      node.effects.forEach(visit);
    } else if (node.op === 'choose_one') node.options.forEach(option => option.effects.forEach(visit));
  };
  nodes.forEach(visit);
  return result;
}

function conditionDependsOnOpponent(condition: ConditionExpression): boolean {
  if (condition.op === 'all' || condition.op === 'any') return condition.conditions.some(conditionDependsOnOpponent);
  if (condition.op === 'not') return conditionDependsOnOpponent(condition.condition);
  if (condition.op === 'stance_is') return condition.target === 'opponent';
  if (condition.op === 'intent_type') return true;
  if (condition.op !== 'compare') return false;
  return numericDependsOnOpponent(condition.left) || numericDependsOnOpponent(condition.right);
}

function numericDependsOnOpponent(expression: NumericExpression): boolean {
  if (typeof expression === 'number') return false;
  if (expression.op === 'var') return expression.path.startsWith('opponent.');
  if (expression.op === 'count_statuses') return expression.target === 'opponent';
  if (expression.op === 'intent_value') return true;
  if (expression.op === 'negate' || expression.op === 'floor' || expression.op === 'ceil' || expression.op === 'abs' || expression.op === 'clamp_min')
    return numericDependsOnOpponent(expression.value);
  if (expression.op === 'min' || expression.op === 'max') return expression.values.some(numericDependsOnOpponent);
  if (expression.op === 'count_cards' || expression.op === 'discard_count' || expression.op === 'history') return false;
  return numericDependsOnOpponent(expression.left) || numericDependsOnOpponent(expression.right);
}

function isPartiallySatisfied(condition: ConditionExpression, state: CoreEffectState): boolean {
  if (condition.op === 'all') {
    const values = condition.conditions.map(entry => evaluateConditionExpression(entry, state, { spentEnergy: 0 }));
    return values.some(Boolean) && !values.every(Boolean);
  }
  return false;
}

function collectConditions(nodes: readonly EffectNode[]): ConditionExpression[] {
  const result: ConditionExpression[] = [];
  const visit = (node: EffectNode): void => {
    if (node.op === 'if') {
      result.push(node.condition);
      node.then.forEach(visit);
      node.else?.forEach(visit);
      return;
    }
    if (node.op === 'register_trigger' || node.op === 'schedule_effect' || node.op === 'summoner_effects') {
      node.effects.forEach(visit);
      return;
    }
    if (node.op === 'choose_one') node.options.forEach(option => option.effects.forEach(visit));
  };
  nodes.forEach(visit);
  return result;
}

function usesUnpreviewableContext(condition: ConditionExpression): boolean {
  if (condition.op === 'all' || condition.op === 'any') return condition.conditions.some(usesUnpreviewableContext);
  if (condition.op === 'not') return usesUnpreviewableContext(condition.condition);
  if (condition.op === 'discarded_card_type' || condition.op === 'event_status_is' || condition.op === 'event_damage_kind') return true;
  if (condition.op !== 'compare') return false;
  return numericUsesUnpreviewableContext(condition.left) || numericUsesUnpreviewableContext(condition.right);
}

function numericUsesUnpreviewableContext(expression: NumericExpression): boolean {
  if (typeof expression === 'number') return false;
  if (expression.op === 'var')
    return expression.path.startsWith('context.') || expression.path === 'self.energy' || /^self\.resource\.[^.]+\.current$/.test(expression.path);
  if (expression.op === 'discard_count') return true;
  if (expression.op === 'negate' || expression.op === 'floor' || expression.op === 'ceil' || expression.op === 'abs' || expression.op === 'clamp_min')
    return numericUsesUnpreviewableContext(expression.value);
  if (expression.op === 'min' || expression.op === 'max') return expression.values.some(numericUsesUnpreviewableContext);
  if (expression.op === 'count_cards' || expression.op === 'count_statuses' || expression.op === 'history' || expression.op === 'intent_value') return false;
  return numericUsesUnpreviewableContext(expression.left) || numericUsesUnpreviewableContext(expression.right);
}
