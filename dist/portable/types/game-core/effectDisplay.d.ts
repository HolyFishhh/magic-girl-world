export { describeOpeningDeckTransforms } from './towerOpeningTransforms';
import type { EffectNode, EffectProgram } from './effectDsl';
import { type CardAttachment } from './cardAttachment';
import type { EventTriggerQuery } from './battleEventJournal';
export type EffectIntentType = 'attack' | 'lust_attack' | 'defend' | 'heal' | 'buff' | 'debuff' | 'special';
export interface EffectProgramSummary {
    type: EffectIntentType;
    damage?: number;
    lustDamage?: number;
    block?: number;
}
export interface EffectDisplayTag {
    reference?: import('./contentDescription').ContentRuleReference;
    references?: Array<NonNullable<EffectDisplayTag['reference']>>;
    text: string;
    icon: string;
    color: string;
    category: 'beneficial' | 'harmful' | 'neutral' | 'utility' | 'special';
}
export interface EffectDisplayContext {
    /** Hand-only current-target estimate; callers omit this in rule/details views. */
    damageAmountText?: (node: Extract<EffectNode, {
        op: 'damage';
    }>) => string | undefined;
    referenceDepth?: number;
    collapseSummons?: boolean;
    statusNames?: Readonly<Record<string, string>>;
    /** Stable runtime enemy ID → visible name mapping for exact protection references. */
    enemyNames?: Readonly<Record<string, string>>;
    statusDefinitions?: Readonly<Record<string, unknown>>;
    resourceDescriptions?: Readonly<Record<string, string>>;
    opponentResourceDescriptions?: Readonly<Record<string, string>>;
    resourceNames?: Readonly<Record<string, string>>;
    resourceEmojis?: Readonly<Record<string, string>>;
    opponentResourceNames?: Readonly<Record<string, string>>;
    opponentResourceEmojis?: Readonly<Record<string, string>>;
    summonerResourceEmojis?: Readonly<Record<string, string>>;
    summonerResourceNames?: Readonly<Record<string, string>>;
    cardNames?: Readonly<Record<string, string>>;
    cardDefinitions?: Readonly<Record<string, unknown>>;
    summonNames?: Readonly<Record<string, string>>;
    stanceNames?: Readonly<Record<string, string>>;
    stanceDefinitions?: Readonly<Record<string, Record<string, unknown>>>;
    enemyActionNames?: Readonly<Record<string, string>>;
    resolveStatusName?: (statusId: string) => string | undefined;
    selfLabel?: string;
    opponentLabel?: string;
}
/** Shared card-attachment wording for hand, pile, selection and detail surfaces. */
export declare function cardAttachmentsToDisplayTags(attachments: readonly CardAttachment[] | undefined): EffectDisplayTag[];
export declare function effectProgramToDisplayTags(program?: EffectProgram | null, context?: EffectDisplayContext): EffectDisplayTag[];
export declare function triggeredEffectProgramToDisplayTags(trigger: string, program?: EffectProgram | null, context?: EffectDisplayContext, eventQuery?: EventTriggerQuery): EffectDisplayTag[];
export declare function compactContentToDisplayTags(value: unknown, context?: EffectDisplayContext): EffectDisplayTag[];
export declare function summarizeEffectProgram(program: EffectProgram): EffectProgramSummary;
export declare function cardRequirementDisplayTags(id: unknown, context?: EffectDisplayContext): EffectDisplayTag[];
/** Shared public trigger heading; hosts must escape HTML. */
export declare function battleTriggerDisplayName(trigger: string): string;
/** Display the executable tick boundary without conflating it with turn events or decay. */
export declare function statusTickTimingDisplayTag(status: {
    tick_timing?: 'before_action' | 'after_action';
}): EffectDisplayTag;
/** Appearance is a held-status rule, not a mutation of the saved base portrait. */
export declare function statusAppearanceDisplayTags(status: {
    character_emoji?: string;
}): EffectDisplayTag[];
