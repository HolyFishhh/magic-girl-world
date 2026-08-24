import { resolveStatusOwnershipTriggers, type AbilityTrigger, type StatusOwnershipChange } from './battleTriggers';

export type BattleSide = 'player' | 'enemy';
export type TriggerConsumer = 'ability' | 'relic';
export type TriggeredAttribute = 'hp' | 'lust' | 'block';

export interface BattleTriggerDispatch {
  consumer: TriggerConsumer;
  target: BattleSide;
  trigger: AbilityTrigger;
  context: Readonly<Record<string, unknown>>;
}

export interface AttributeTriggerContext {
  attribute: string;
  change: number;
  target: BattleSide;
  source: BattleSide;
}

const ATTRIBUTE_TRIGGERS: Readonly<
  Record<TriggeredAttribute, Readonly<Record<'increase' | 'decrease', readonly [AbilityTrigger, AbilityTrigger | null]>>>
> = {
  hp: {
    increase: ['take_heal', 'deal_heal'],
    decrease: ['take_damage', 'deal_damage'],
  },
  lust: {
    increase: ['lust_increase', 'deal_lust_increase'],
    decrease: ['lust_decrease', 'deal_lust_decrease'],
  },
  block: {
    increase: ['gain_block', null],
    decrease: ['lose_block', null],
  },
};

function otherSide(side: BattleSide): BattleSide {
  return side === 'player' ? 'enemy' : 'player';
}

/** Resolve the shared ability-first, relic-second order for one player-owned event. */
export function resolvePlayerTriggerDispatch(
  trigger: AbilityTrigger,
  context: Readonly<Record<string, unknown>> = {},
): BattleTriggerDispatch[] {
  return [
    { consumer: 'ability', target: 'player', trigger, context },
    { consumer: 'relic', target: 'player', trigger, context },
  ];
}

/** Resolve ability and player-relic notifications caused by one actual attribute delta. */
export function resolveAttributeTriggerDispatch(context: AttributeTriggerContext): BattleTriggerDispatch[] {
  if (!Number.isFinite(context.change) || context.change === 0) return [];
  if (context.attribute !== 'hp' && context.attribute !== 'lust' && context.attribute !== 'block') return [];

  const direction = context.change > 0 ? 'increase' : 'decrease';
  const [receiverTrigger, sourceTrigger] = ATTRIBUTE_TRIGGERS[context.attribute][direction];
  const amount = Math.abs(context.change);
  const triggerContext = context.attribute === 'hp' && direction === 'decrease' ? { damage: amount } : { amount };
  const dispatches: BattleTriggerDispatch[] = [
    { consumer: 'ability', target: context.target, trigger: receiverTrigger, context: triggerContext },
  ];

  if (sourceTrigger && context.source !== context.target) {
    dispatches.push({ consumer: 'ability', target: context.source, trigger: sourceTrigger, context: triggerContext });
  }

  if (context.target === 'player') {
    dispatches.push({ consumer: 'relic', target: 'player', trigger: receiverTrigger, context: triggerContext });
  } else if (sourceTrigger && context.source === 'player') {
    dispatches.push({ consumer: 'relic', target: 'player', trigger: sourceTrigger, context: triggerContext });
  }

  return dispatches;
}

export interface StatusOwnershipDispatchContext {
  target: BattleSide;
  statusType: string;
  change: StatusOwnershipChange;
}

/** Resolve holder, opposing observer, and player-relic events for one status ownership transition. */
export function resolveStatusOwnershipTriggerDispatch(
  context: StatusOwnershipDispatchContext,
): BattleTriggerDispatch[] {
  const triggers = resolveStatusOwnershipTriggers(context.statusType, context.change);
  if (!triggers) return [];
  const observer = otherSide(context.target);
  const triggerContext = { targetType: context.target, statusType: context.statusType };
  return [
    { consumer: 'ability', target: context.target, trigger: triggers.owner, context: triggerContext },
    { consumer: 'ability', target: observer, trigger: triggers.observer, context: triggerContext },
    {
      consumer: 'relic',
      target: 'player',
      trigger: context.target === 'player' ? triggers.owner : triggers.observer,
      context: triggerContext,
    },
  ];
}
