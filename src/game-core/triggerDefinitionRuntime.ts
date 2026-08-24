import type { Ability, Relic } from './battleState';
import { normalizeAbilityTrigger, type AbilityTrigger } from './battleTriggers';
import type { EffectProgram } from './effectDsl';

type MaybePromise<T> = T | Promise<T>;
export type TriggerExecutionContext = Readonly<Record<string, unknown>>;

export interface AbilityTriggerPlan {
  source: Ability;
  trigger: AbilityTrigger;
  program: EffectProgram;
}

export interface RelicTriggerPlan {
  source: Relic;
  trigger: AbilityTrigger;
  program: EffectProgram;
}

/** Resolve one ability without executing or translating modern programs. */
export function resolveAbilityTriggerPlan(ability: Ability, requestedTrigger: string): AbilityTriggerPlan | null {
  const trigger = normalizeAbilityTrigger(requestedTrigger);
  if (!trigger || trigger === 'passive') return null;

  return normalizeAbilityTrigger(ability.trigger || '') === trigger
    ? { source: ability, trigger, program: ability.effectProgram }
    : null;
}

/** Resolve one relic without executing or translating modern programs. */
export function resolveRelicTriggerPlan(relic: Relic, requestedTrigger: string): RelicTriggerPlan | null {
  const trigger = normalizeAbilityTrigger(requestedTrigger);
  if (!trigger || trigger === 'passive') return null;

  return normalizeAbilityTrigger(relic.trigger || '') === trigger
    ? { source: relic, trigger, program: relic.effectProgram }
    : null;
}

export interface AbilityTriggerRuntimePorts {
  readAbilities(target: 'player' | 'enemy'): readonly Ability[] | undefined;
  execute(
    target: 'player' | 'enemy',
    plan: AbilityTriggerPlan,
    context: TriggerExecutionContext,
  ): MaybePromise<void>;
}

/** Portable ordered ability matching with recursion protection. */
export class AbilityTriggerRuntime {
  private readonly active = new Set<string>();

  public constructor(private readonly ports: AbilityTriggerRuntimePorts) {}

  public async run(
    target: 'player' | 'enemy',
    requestedTrigger: string,
    context: TriggerExecutionContext = {},
  ): Promise<void> {
    const trigger = normalizeAbilityTrigger(requestedTrigger);
    if (!trigger || trigger === 'passive') return;
    const activeKey = `${target}:${trigger}`;
    if (this.active.has(activeKey)) return;

    this.active.add(activeKey);
    try {
      for (const ability of [...(this.ports.readAbilities(target) || [])]) {
        const plan = resolveAbilityTriggerPlan(ability, trigger);
        if (plan) await this.ports.execute(target, plan, context);
      }
    } finally {
      this.active.delete(activeKey);
    }
  }
}

export interface RelicTriggerRuntimePorts {
  readRelics(): readonly Relic[] | undefined;
  execute(plan: RelicTriggerPlan, context: TriggerExecutionContext): MaybePromise<void>;
}

/** Portable ordered relic matching with recursion protection. */
export class RelicTriggerRuntime {
  private readonly active = new Set<AbilityTrigger>();

  public constructor(private readonly ports: RelicTriggerRuntimePorts) {}

  public async run(requestedTrigger: string, context: TriggerExecutionContext = {}): Promise<void> {
    const trigger = normalizeAbilityTrigger(requestedTrigger);
    if (!trigger || trigger === 'passive' || this.active.has(trigger)) return;

    this.active.add(trigger);
    try {
      for (const relic of [...(this.ports.readRelics() || [])]) {
        const plan = resolveRelicTriggerPlan(relic, trigger);
        if (plan) await this.ports.execute(plan, context);
      }
    } finally {
      this.active.delete(trigger);
    }
  }
}
