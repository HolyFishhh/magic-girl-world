import type { EventTriggerQuery } from './battleEventJournal';
export interface ResolvedTriggerInput {
    /** Raw trigger name. Validation remains the caller's responsibility. */
    trigger: unknown;
    /** Effects owned by the trigger, or the legacy sibling effects source. */
    triggeredEffects: unknown;
    /** Effects resolved immediately when a structured trigger is also present. */
    immediateEffects: unknown;
    structured: boolean;
    /** Optional event metadata/ordinal filter carried by the trigger definition. */
    eventQuery?: EventTriggerQuery;
}
export declare function resolveEventTriggerQueryInput(value: unknown): EventTriggerQuery | undefined;
/**
 * Resolve the AI-facing trigger boundary.
 *
 * The preferred shape keeps timing and behavior together:
 * `trigger: { on: "...", effects: {...} }`.
 * A sibling string trigger is still read so already-created saves remain playable.
 */
export declare function resolveTriggerInput(value: Record<string, unknown>): ResolvedTriggerInput;
export declare function isStructuredTriggerInput(value: unknown): value is {
    on?: unknown;
    effects?: unknown;
};
