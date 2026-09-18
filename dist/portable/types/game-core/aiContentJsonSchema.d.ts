export type AiJsonSchema = Record<string, any>;
/** Non-recursive card-rule field relationships for the bounded provider
 * outline. Derive them from the public contract instead of maintaining a
 * second rule/field table. Boolean property schemas preserve the meaning of
 * single-field prohibitions without repeating long `not/required` clauses at
 * every status/reward location. Formula validation remains in the compiler. */
export declare function createCardRuleFieldOutline(): AiJsonSchema;
declare const SHARED_CONTENT_DEFINITIONS: AiJsonSchema;
/**
 * Attach the one AI-facing effects grammar plus the content wrappers that use
 * it. Every structured generator calls this function, so schema and runtime
 * validation no longer drift between opening, node and reward requests.
 */
export declare function withAiContentDefinitions(value: AiJsonSchema): AiJsonSchema;
/**
 * Attach only definitions reachable from the supplied schema. Small bounded
 * repair protocols should not expose the model to the unrelated full content
 * grammar merely because they reuse a primitive formula or card-zone shape.
 */
export declare function withAiContentDefinitionsSubset(value: AiJsonSchema): AiJsonSchema;
export declare function aiSchemaRef(name: keyof typeof SHARED_CONTENT_DEFINITIONS | 'effectList' | 'cardCost'): AiJsonSchema;
export {};
