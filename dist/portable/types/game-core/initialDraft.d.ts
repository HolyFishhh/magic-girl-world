import { INITIAL_DRAFT_SPEC } from './initialDraftEnvelope';
export { INITIAL_DRAFT_SPEC } from './initialDraftEnvelope';
type JsonObject = Record<string, any>;
export type DraftPath = Array<string | number>;
export type DraftRegistryKind = 'statuses' | 'resources' | 'templates';
export interface InitialDraftDiagnostic {
    code: 'INVALID_DRAFT' | 'UNKNOWN_FIELD' | 'INVALID_REGISTRY' | 'INVALID_DEFINITION_ID' | 'DUPLICATE_DEFINITION' | 'INLINE_DEFINITION' | 'UNKNOWN_STATUS_REF' | 'UNKNOWN_RESOURCE_REF' | 'UNKNOWN_TEMPLATE_REF' | 'INVALID_REFERENCE' | 'TEMPLATE_CYCLE' | 'UNSUPPORTED_TEMPLATE_OWNER';
    owner: DraftPath;
    path: DraftPath;
    ref?: string;
    relatedPath?: DraftPath;
    /** Only a central-registry reference can be repaired by a registry addition. */
    repairRegistry?: DraftRegistryKind;
    message: string;
}
export interface InitialDraft {
    spec: typeof INITIAL_DRAFT_SPEC;
    narrative: string;
    player: JsonObject;
    opening: JsonObject;
    registry: {
        statuses: JsonObject[];
        resources: JsonObject[];
        templates: JsonObject[];
    };
}
export interface CompiledInitialDraft {
    narrative: string;
    player: JsonObject;
    opening: JsonObject;
}
export type InitialDraftCompilation = {
    ok: true;
    value: CompiledInitialDraft;
    diagnostics: [];
} | {
    ok: false;
    diagnostics: InitialDraftDiagnostic[];
};
/**
 * Compile a registry draft to the EXISTING initial-response representation.
 * This is not a gameplay validator or a commit. The caller must still run the
 * authoritative content/opening/readiness checks before persisting any data.
 * Registry resources explicitly define the initial PLAYER pool; summon/enemy
 * pools remain local canonical data in v1. No mechanics are inferred from prose.
 */
export declare function compileInitialDraftToMvu(input: unknown): InitialDraftCompilation;
/**
 * Diagnostic-only preview. Missing references must not hide independent rule
 * errors before the one repair request is planned. The preview contains ONLY
 * authored/resolved definitions: absent definitions are never fabricated.
 * A preview is not a successful compilation and is never returned as content.
 * Callers must still compile and validate the repaired draft for publication.
 */
export declare function inspectInitialDraft<T>(input: unknown, inspectRules: (preview: CompiledInitialDraft) => readonly T[]): {
    references: InitialDraftDiagnostic[];
    rules: T[];
    inspected: boolean;
};
/** Deliberately NOT CompiledInitialDraft: every fragment may be missing or
 * malformed. Consumers may inspect independently usable authored regions but
 * must not treat this view as publishable content or fabricate missing peers.
 */
export interface InitialDraftFragments {
    narrative: unknown;
    player: unknown;
    opening: unknown;
}
export declare function inspectInitialDraftFragments<T>(input: unknown, inspectFragments: (fragments: InitialDraftFragments) => readonly T[]): {
    references: InitialDraftDiagnostic[];
    rules: T[];
    inspected: boolean;
};
