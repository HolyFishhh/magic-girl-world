import type { ContentDefinition, ContentPack } from './contentPack';
import { type ContentMechanicFeatures } from './contentMechanicFeatures';
/** Owned roots only. Merely declaring a status in the library grants no benefit. */
export declare function playerArchetypeDefinitions(pack: ContentPack): ContentDefinition[];
/** Keep executable ownership: a familiar's attack is summon output, not a player attack. */
export declare function extractArchetypeEvidence(definition: ContentDefinition, pack?: ContentPack): ContentMechanicFeatures;
