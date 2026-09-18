import type { BattleEventKind, BattleEventPhase, EventCounterFilter } from './battleEventJournal';
/** Shared public condition semantics, independent of status definition placement. */
export declare function triggerOwnershipContract(): string;
export declare function statusEventConditionContract(): string;
/** Technical facts implied by `on`, shared by authoring and execution. */
export declare const EVENT_KIND_BY_TRIGGER: Readonly<Record<string, BattleEventKind>>;
export declare const CARD_TYPE_BY_TRIGGER: Readonly<Record<string, string>>;
/** The public trigger fires at one phase, even when the journal records both before/after. */
export declare const EVENT_PHASE_BY_TRIGGER: Readonly<Record<string, BattleEventPhase>>;
export declare function impliedTriggerEventFilter(trigger: unknown): EventCounterFilter;
/** Contradictory authored filters must fail, never be silently overwritten. */
export declare function triggerEventFilterConflicts(trigger: unknown, filter?: EventCounterFilter): boolean;
/** Group identical facts once; the portable artifact is checked against these facts. */
export declare function triggerEventSchemaConstraints(): Record<string, unknown>[];
