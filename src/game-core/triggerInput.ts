export interface ResolvedTriggerInput {
  /** Raw trigger name. Validation remains the caller's responsibility. */
  trigger: unknown;
  /** Effects owned by the trigger, or the legacy sibling effects source. */
  triggeredEffects: unknown;
  /** Effects resolved immediately when a structured trigger is also present. */
  immediateEffects: unknown;
  structured: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve the AI-facing trigger boundary.
 *
 * The preferred shape keeps timing and behavior together:
 * `trigger: { on: "...", effects: {...} }`.
 * A sibling string trigger is still read so already-created saves remain playable.
 */
export function resolveTriggerInput(value: Record<string, unknown>): ResolvedTriggerInput {
  if (isRecord(value.trigger)) {
    return {
      trigger: value.trigger.on,
      triggeredEffects: value.trigger.effects,
      immediateEffects: value.effects,
      structured: true,
    };
  }
  return {
    trigger: value.trigger,
    triggeredEffects: value.effects,
    immediateEffects: undefined,
    structured: false,
  };
}

export function isStructuredTriggerInput(value: unknown): value is { on?: unknown; effects?: unknown } {
  return isRecord(value);
}
