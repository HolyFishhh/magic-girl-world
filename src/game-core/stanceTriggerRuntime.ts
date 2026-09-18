import type { ActiveStance } from './specialCombatContainers';
import { normalizeAbilityTrigger } from './battleTriggers';
import { resolveAbilityTriggerPlan, type AbilityTriggerPlan, type TriggerExecutionContext } from './triggerDefinitionRuntime';

type Side = 'player' | 'enemy';
export interface StanceTriggerRuntimePorts {
  readStance(side: Side, context: TriggerExecutionContext): ActiveStance | null | undefined;
  execute(side: Side, plan: AbilityTriggerPlan, context: TriggerExecutionContext): void | Promise<void>;
}

/**
 * A stance owns listeners only while this exact activation remains installed.
 * Prepare before other listeners run: a stance acquired mid-event cannot react
 * retroactively. The in-flight effect finishes, but leaving/re-entering cancels
 * any remaining listeners from the former activation. No permanent abilities
 * are added; save/load persists definitions in the ordinary stance snapshot.
 */
export class StanceTriggerRuntime {
  private readonly active = new Set<string>();
  public constructor(private readonly ports: StanceTriggerRuntimePorts) {}

  public prepare(side: Side, requestedTrigger: string, context: TriggerExecutionContext = {}): () => Promise<void> {
    const trigger = normalizeAbilityTrigger(requestedTrigger);
    const current = this.ports.readStance(side, context);
    // Some holders are live objects and others are defensive copies. Freeze
    // both definitions and identity uniformly before other listeners mutate.
    const stance = current ? structuredClone(current) : current;
    const plans = trigger && trigger !== 'passive' && stance
      ? (stance.events || []).map((event, index) => resolveAbilityTriggerPlan({
          id: `stance:${stance.id}:${index}`, name: stance.name, emoji: stance.emoji,
          trigger: event.trigger, ...(event.eventQuery ? { eventQuery: event.eventQuery } : {}),
          effectProgram: { spec: 'mwg.effect/v1', steps: event.effects },
        }, trigger, context)).filter((plan): plan is AbilityTriggerPlan => plan !== null)
      : [];
    const owner = side === 'enemy' && typeof context.enemyId === 'string' ? context.enemyId : side;
    const key = `${side}:${owner}:${trigger}`;
    let consumed = false;
    return async () => {
      if (consumed) return;
      consumed = true;
      if (!stance || !plans.length || this.active.has(key)) return;
      this.active.add(key);
      try {
        for (const plan of plans) {
          const live = this.ports.readStance(side, context);
          // Enemy read APIs deliberately return defensive copies. A persisted
          // activation identity, not JS object identity, distinguishes same-ID
          // re-entry. Initial/legacy stances have no identity until switched.
          if (!live || live.id !== stance.id || live.activationId !== stance.activationId
            || (stance.activationId === undefined && JSON.stringify(live) !== JSON.stringify(stance))) break;
          await this.ports.execute(side, plan, context);
        }
      } finally { this.active.delete(key); }
    };
  }
}
