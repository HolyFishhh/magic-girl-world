import type { BattleSide, BattleTriggerDispatch } from './battleEventDispatch';
import type { AbilityTrigger } from './battleTriggers';

type MaybePromise<T> = T | Promise<T>;

export interface BattleTriggerConsumerPorts {
  runAbility(target: BattleSide, trigger: AbilityTrigger, context: Readonly<Record<string, unknown>>): MaybePromise<void>;
  runRelic(trigger: AbilityTrigger, context: Readonly<Record<string, unknown>>): MaybePromise<void>;
}

/** Execute an already-resolved dispatch list in its declared receiver/source order. */
export async function runBattleTriggerDispatches(
  dispatches: readonly BattleTriggerDispatch[],
  ports: BattleTriggerConsumerPorts,
): Promise<void> {
  for (const dispatch of dispatches) {
    if (dispatch.consumer === 'ability') {
      await ports.runAbility(dispatch.target, dispatch.trigger, dispatch.context);
    } else {
      await ports.runRelic(dispatch.trigger, dispatch.context);
    }
  }
}
