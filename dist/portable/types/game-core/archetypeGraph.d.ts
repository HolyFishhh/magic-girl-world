import { type ContentMechanicRole } from './contentMechanicFeatures';
import type { ContentDefinition, ContentPack } from './contentPack';
export declare const ARCHETYPE_GRAPH_SPEC: "mwg.archetype-graph/v1";
export type ArchetypeFeatureField = 'operations' | 'axes' | 'targets' | 'zones' | 'triggers' | 'roles' | 'statuses' | 'resources';
export interface ArchetypeFeaturePredicate {
    field: ArchetypeFeatureField;
    values?: string[];
    mode?: 'all' | 'any';
    minimum?: number;
}
export interface WeightedArchetypeFeature extends ArchetypeFeaturePredicate {
    weight: number;
}
export interface ArchetypeNeighbor {
    target: string;
    transitionCost: number;
    bridgeFeatures: string[];
}
export interface ArchetypeNode {
    id: string;
    label: string;
    description: string;
    requiredFeatures: ArchetypeFeaturePredicate[];
    optionalFeatures: WeightedArchetypeFeature[];
    payoffFeatures: ArchetypeFeaturePredicate[];
    genericRoles: ContentMechanicRole[];
    antiSynergies: string[];
    neighbors: ArchetypeNeighbor[];
}
export interface ArchetypeAffinity {
    id: string;
    label: string;
    description: string;
    score: number;
    share: number;
    supportingCards: string[];
    missingPayoffs: string[];
}
export interface DeckArchetypeProfile {
    spec: typeof ARCHETYPE_GRAPH_SPEC;
    fingerprint: string;
    affinities: ArchetypeAffinity[];
    scatterShare: number;
    primary: string[];
    bridges: Array<{
        from: string;
        to: string;
        transitionCost: number;
        bridgeFeatures: string[];
    }>;
    cards: Array<{
        id: string;
        name: string;
        quantity: number;
        affinities: Array<Pick<ArchetypeAffinity, 'id' | 'label' | 'score'>>;
        /** Marginal total-deck score supplied by the reward planner. */
        scoreContribution?: number;
        scoreContributionRatio?: number;
    }>;
    evolutionSuggestions: Array<{
        from: string;
        to: string;
        label: string;
        description: string;
        transitionCost: number;
        bridgeFeatures: string[];
    }>;
}
export interface ArchetypeGraphIssue {
    code: 'DUPLICATE_ID' | 'SELF_EDGE' | 'DANGLING_EDGE' | 'DUPLICATE_EDGE' | 'EMPTY_REQUIREMENT';
    nodeId: string;
    detail: string;
}
export declare const ARCHETYPE_GRAPH: readonly ArchetypeNode[];
export declare function scoreContentArchetypes(definition: ContentDefinition, pack?: ContentPack): ArchetypeAffinity[];
export declare function profileDeckArchetypes(pack: ContentPack): DeckArchetypeProfile;
export declare function validateArchetypeGraph(graph?: readonly ArchetypeNode[]): ArchetypeGraphIssue[];
