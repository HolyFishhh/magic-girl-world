/** Versioned, executable conveniences. Story-specific definitions always remain authored content. */
export interface BuiltinStatusDefinition extends Record<string, unknown> {
    id: string;
    name: string;
    emoji: string;
    type: 'buff' | 'debuff';
    stacks_change: number | 'keep' | 'reset';
    triggers: Record<string, unknown>;
}
export declare const BUILTIN_STATUS_DEFINITIONS: readonly BuiltinStatusDefinition[];
/** Only exact built-in IDs can be resolved without a saved definition. Explicit authored definitions win at each call site. */
export declare function builtinStatusDefinition(id: string): Readonly<BuiltinStatusDefinition> | undefined;
/** Materialize only referenced conveniences, including dependencies, without changing authored definitions. */
export declare function expandBuiltinStatusDefinitions(values: readonly unknown[], content: unknown, knownStatusIds?: Iterable<string>): any[];
/** Authoring-only scope: never used as an execution or repair quality gate. */
export declare function builtinStatusUsageContract(): string;
/** Shared reference boundary for worldbooks, generation and finite repair. */
export declare function builtinStatusReferenceContract(): string;
export declare function builtinStatusAuthoringContract(): string;
