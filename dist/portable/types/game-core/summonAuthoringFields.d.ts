/** Shared field names only. Validation and lifecycle semantics remain in the
 * compiler/runtime. Legacy spellings are not advertised to content authors. */
export declare const SUMMON_AUTHORING_FIELDS: readonly ["id", "name", "emoji", "description", "has_hp", "max_hp", "block", "tags", "resources", "modifiers", "actions", "abilities", "actions_per_activation", "action_priority", "speed", "intercept", "slot", "on_existing", "on_defeated", "retain_corpse", "capabilities", "count", "capacity", "overflow", "on_existing_effects"];
export declare const SUMMON_ACTION_AUTHORING_FIELDS: readonly ["id", "name", "emoji", "description", "dialogue", "weight", "fixed", "effects", "creates", "when"];
export declare const SUMMON_ABILITY_AUTHORING_FIELDS: readonly ["id", "name", "emoji", "description", "trigger", "fixed", "creates"];
export declare function summonAuthoringShape(placement: 'runtime' | 'initial-draft'): string;
