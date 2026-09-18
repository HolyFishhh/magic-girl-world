import { resolveStatusApplication, resolveStatusStacksChange } from './statusApplication';

/** Isolated holder-action-phase application. This is not whole-combat reachability:
 * other cards, statuses, enemies and lifecycle effects may change the stacks. */
export function projectStatusThroughNextTurn(input: {
  incomingStacks: number;
  currentStacks?: number;
  maxStacks?: number;
  stacksChange?: number | string;
}) {
  const validNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const validChange = input.stacksChange === undefined
    || (typeof input.stacksChange === 'number' && Number.isFinite(input.stacksChange))
    || (typeof input.stacksChange === 'string' && /^(?:keep|reset|x(?:\d+(?:\.\d+)?|\.\d+))$/i.test(input.stacksChange.trim()));
  if (!validNumber(input.incomingStacks) || (input.currentStacks !== undefined && !validNumber(input.currentStacks))
    || (input.maxStacks !== undefined && !validNumber(input.maxStacks)) || !validChange)
    return { projected: false as const, reason: 'unsupported_or_invalid_numeric_input' as const };
  const applied = resolveStatusApplication(input.currentStacks, input.incomingStacks, input.maxStacks);
  // An absent/zero-layer status is not revived by a positive decay rule.
  const afterTurnEnd = applied.nextStacks > 0 ? resolveStatusStacksChange(applied.nextStacks, input.stacksChange) : 0;
  return {
    projected: true as const,
    initialStacks: input.currentStacks ?? null,
    applicationTrigger: applied.trigger,
    afterApplication: applied.nextStacks,
    afterTurnEnd,
    presentAtNextTurnStart: afterTurnEnd > 0,
    assumption: 'effect executes in holder action phase from initialStacks; no intervening stack changes or lifecycle side effects' as const,
    wholeCombatVerified: false as const,
  };
}
