import { type RunNodeKind } from './runState';
export declare const TOWER_NODE_RESULT_SPEC: "mwg.tower-node-result/v1";
export declare const TOWER_NODE_BATCH_RESULT_SPEC: "mwg.tower-node-batch-result/v1";
export declare const TOWER_OPENING_RESULT_SPEC: "mwg.tower-opening-result/v1";
export declare const TOWER_NODE_RESULT_TAG: "TOWER_NODE_RESULT";
export declare const TOWER_NODE_BATCH_RESULT_TAG: "TOWER_NODE_BATCH_RESULT";
export declare const TOWER_OPENING_RESULT_TAG: "TOWER_OPENING_RESULT";
export interface TowerGenerationJobDescriptor {
    nodeId: string;
    requestId: string;
    basedOnRevision: number;
    kind: RunNodeKind;
    act: number;
    floor: number;
    contentSeed: number;
    rewardSeed: number;
    difficultyMultiplier: number;
    shopMemoryCards?: Record<string, any>[];
}
export interface TowerGenerationContext {
    /** Authoritative gameplay facts, with program-only map/cache/schema data removed. */
    completeMvuContext?: string;
    /** Compact exact-ID registry repeated near the final output check. */
    contentReferenceContext?: string;
    worldContext?: string;
    playerContext?: string;
    deckBalanceContext?: string;
    enemyBudgetEnvelope?: import('./encounterBalance').EnemyBudgetEnvelope;
    enemyBudgets?: Record<string, import('./encounterBalance').EnemyBudgetEnvelope>;
    enemyLineageContext?: string;
    customRequirements?: string;
    difficultyPercent: number;
}
export interface TowerNodeResult {
    spec: typeof TOWER_NODE_RESULT_SPEC;
    node_id: string;
    request_id: string;
    based_on_revision: number;
    kind: RunNodeKind;
    title: string;
    narrative: string;
    payload: Record<string, unknown>;
    reward?: Record<string, unknown>;
    /** Program-authored after parsing; model output is never trusted for this field. */
    program_balance?: TowerProgramBalanceAudit;
    program_reward_seed?: number;
    program_shop_memory_ids?: string[];
}
export interface TowerNodeBatchResult {
    spec: typeof TOWER_NODE_BATCH_RESULT_SPEC;
    batch_id: string;
    based_on_revision: number;
    results: TowerNodeResult[];
}
export type TowerNodeBatchEntry = {
    nodeId: string;
    ok: true;
    result: TowerNodeResult;
} | {
    nodeId: string;
    ok: false;
    error: string;
};
/** Internal assessment, never an AI wire response or an activation bypass. */
export interface TowerNodeBatchInspection {
    batchId: string;
    basedOnRevision: number;
    entries: TowerNodeBatchEntry[];
}
export interface TowerProgramBalanceAudit {
    [key: string]: unknown;
    spec: string;
    winnableAtCurrentResources?: boolean;
    modelRepairUsed: boolean;
}
export interface TowerOpeningResult {
    spec: typeof TOWER_OPENING_RESULT_SPEC;
    request_id: string;
    based_on_revision: number;
    title: string;
    narrative: string;
    choices: Array<{
        id: string;
        label: string;
        description?: string;
        outcome: Record<string, unknown>;
    }>;
}
type TowerNodeScope = Pick<TowerGenerationJobDescriptor, 'nodeId' | 'requestId' | 'basedOnRevision' | 'kind'> & Partial<Pick<TowerGenerationJobDescriptor, 'act' | 'floor' | 'contentSeed' | 'rewardSeed' | 'shopMemoryCards'>>;
/**
 * `generateRaw` intentionally does not inherit the story preset or lorebook.
 * Keep the public AI grammar beside every structured worker request so models
 * never have to infer a generic `{ operation, target, amount }` vocabulary.
 * This is a syntax contract only: themes, mechanics and numbers remain free.
 */
export declare function formatCompactEffectAuthoringContract(placement?: 'runtime' | 'initial-draft'): string;
/**
 * Highlight the grammar fragments most relevant to the concrete failing
 * paths. This is an error-focused repair guide: callers pair it with the exact
 * rejected source, path-scoped preservation, the provider schema, and final
 * authoritative validation. Node repair flows may additionally include the
 * full gameplay contract when their broader payload requires it.
 */
export declare function formatCompactEffectRepairContract(error: unknown): string;
/** Complete gameplay prompt with only repeated state/topology kept compact. */
export declare function formatTowerNodeGenerationPrompt(job: TowerGenerationJobDescriptor, context: TowerGenerationContext): string;
/** Generate the complete currently reachable window in one model call. */
export declare function formatTowerNodeBatchGenerationPrompt(batchId: string, jobs: readonly TowerGenerationJobDescriptor[], context: TowerGenerationContext): string;
/** One bounded retry for providers that return JSON with a non-executable node shape. */
export declare function formatTowerNodeStructureRepairPrompt(job: TowerNodeScope, response: string, error: unknown, existingBattle?: unknown): string;
export declare function formatTowerNodeBatchStructureRepairPrompt(batchId: string, jobs: readonly TowerGenerationJobDescriptor[], response: string, error: unknown, existingBattle?: unknown): string;
/** Bounded repair for a structurally invalid opening gift response. */
export declare function formatTowerOpeningStructureRepairPrompt(job: Pick<TowerOpeningPromptInput, 'requestId' | 'basedOnRevision'>, response: string, error: unknown, existingBattle?: unknown): string;
export interface TowerOpeningPromptInput {
    requestId: string;
    basedOnRevision: number;
    seed: number;
    act?: number;
    context: TowerGenerationContext;
}
export declare function formatTowerOpeningGenerationPrompt(input: TowerOpeningPromptInput): string;
export interface TowerJsonSchema {
    name: string;
    description: string;
    strict: false;
    value: Record<string, unknown>;
}
export declare const TOWER_INITIAL_ROOT_REPAIR_SPEC: "mwg.tower-initial-root-repair/v1";
export declare const TOWER_INITIAL_SLOT_REPAIR_SPEC: "mwg.tower-initial-slot-repair/v1";
export type TowerInitialRepairSlotKind = 'effect_item' | 'literal_effect_sequence' | 'effect_item_sequence' | 'effect_order_strategy' | 'effect_sequence' | 'passive_effect_sequence' | 'trigger_on' | 'condition' | 'lust_condition' | 'missing_lust_effect' | 'first_card_event_condition' | 'description' | 'card_type' | 'status_type' | 'status_stacks_change' | 'status_tick_timing' | 'status_max_stacks' | 'status_stun' | 'status_character_emoji' | 'status_protection' | 'status_defense' | 'status_trigger_effect_item' | 'status_trigger_effect_sequence' | 'status_hold_effect_item' | 'status_hold_sequence' | 'trigger_mode_strategy' | 'summon_lifecycle_default' | 'resource_payment_strategy' | 'status_next_attack_modifier_strategy' | 'card_quantity_strategy' | 'unknown_effect_item_strategy' | 'skill_trigger_classification_strategy' | 'condition_alias_strategy' | 'add_card_destination' | 'discard_strategy' | 'card_copy_strategy' | 'remove_field';
export type TowerInitialRepairSlotAction = 'replace_effect' | 'replace_effect_sequence' | 'replace_trigger' | 'replace_value' | 'remove_invalid_field';
export interface TowerInitialRepairSlotSchemaTarget {
    token: string;
    kind: TowerInitialRepairSlotKind;
    action: TowerInitialRepairSlotAction;
    preserveId?: string;
    allowedModes?: readonly string[];
    operationNames?: readonly string[];
}
export interface TowerInitialRepairSlotRootSchemaTarget {
    token: string;
    slots: readonly TowerInitialRepairSlotSchemaTarget[];
    allowSupportStatuses?: boolean;
    allowSupportResources?: boolean;
    supportStatusIds?: readonly string[];
    supportResourceIds?: readonly string[];
}
export type TowerInitialRepairRootKind = 'narrative' | 'player' | 'player_status' | 'player_core' | 'player_card' | 'player_cards' | 'player_artifact' | 'player_artifacts' | 'player_item' | 'player_items' | 'player_status_definition' | 'player_statuses' | 'player_ability' | 'player_abilities' | 'player_active_status' | 'player_active_statuses' | 'player_lust_effect' | 'player_level' | 'player_exp' | 'opening' | 'opening_title' | 'opening_narrative' | 'opening_choice' | 'opening_choices';
export interface TowerInitialRepairSchemaTarget {
    token: string;
    kind: TowerInitialRepairRootKind;
    nullable?: boolean;
    preserveId?: string;
}
/**
 * Production initial repair protocol. The program chooses every writable slot;
 * the model can neither name a path nor replace an enclosing authored object.
 */
export declare function createTowerInitialSlotRepairJsonSchema(targets: readonly TowerInitialRepairSlotRootSchemaTarget[]): TowerJsonSchema;
/** One strict battle grammar shared by first generation and its bounded repair. */
export declare function createTowerInitialBattleRepairJsonSchema(): TowerJsonSchema;
/** First tower request: narrative, player state/deck, and opening gift in one response. */
export declare function createTowerInitialContentJsonSchema(options?: {
    allowCardReferences?: boolean;
}): TowerJsonSchema;
/**
 * One bounded repair emits only fixed-token replacements selected by the
 * program. Requiring every token makes it structurally impossible for the
 * model to repair one reported root while silently omitting another.
 */
export declare function createTowerInitialRootRepairJsonSchema(targets: readonly TowerInitialRepairSchemaTarget[]): TowerJsonSchema;
export declare function createTowerOpeningJsonSchema(): TowerJsonSchema;
export declare function createTowerNodeJsonSchema(kind: RunNodeKind, scope?: Partial<Pick<TowerGenerationJobDescriptor, 'nodeId' | 'act' | 'floor' | 'contentSeed' | 'rewardSeed' | 'shopMemoryCards'>>): TowerJsonSchema;
export declare function createTowerNodeBatchJsonSchema(batchId: string, jobs: readonly TowerGenerationJobDescriptor[]): TowerJsonSchema;
/**
 * Remove only closing braces/brackets that cannot close the currently open
 * JSON container. Some structured-output providers append one extra `}` after
 * every nested result object. This is a transport punctuation repair: it does
 * not add fields, choose values, or close a missing container on the model's
 * behalf. Strings and escaped quotes are preserved byte-for-byte.
 */
export declare function removeImpossibleJsonClosers(text: string): string;
/** Replace only semicolons which occur outside JSON strings. In JSON member
 * position they can only be a mistyped comma; semicolons inside narrative text
 * remain byte-for-byte unchanged. */
export declare function replaceOutsideStringJsonSemicolons(text: string): string;
export declare function parseTowerNodeResult(text: string, expected: TowerNodeScope): TowerNodeResult;
export declare function inspectTowerNodeBatchResult(text: string, batchId: string, jobs: readonly TowerGenerationJobDescriptor[], validate?: (result: TowerNodeResult, job: TowerGenerationJobDescriptor) => void): TowerNodeBatchInspection;
/** Existing strict consumers still require every member to be executable. */
export declare function parseTowerNodeBatchResult(text: string, batchId: string, jobs: readonly TowerGenerationJobDescriptor[]): TowerNodeBatchResult;
/** Inspect independent opening fields before spending a bounded repair request.
 * Reward rule/reference validation remains separate and must also run. */
export declare function collectTowerOpeningEnvelopeIssues(value: unknown): string[];
export declare function parseTowerOpeningResult(text: string, expected: Pick<TowerOpeningPromptInput, 'requestId' | 'basedOnRevision'>): TowerOpeningResult;
export {};
